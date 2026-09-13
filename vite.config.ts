import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { WS_PATH } from './src/net/protocol';
import { flightSink } from './src/dev/flight-sink';

/** Where `npm run server` listens, which is what the dev proxy forwards to. */
const SERVER_PORT = 8082;

// The build inlines everything into one dist/index.html, so the game keeps its
// "download one file and play" property with no network access at runtime.
export default defineConfig({
  plugins: [viteSingleFile(), flightSink()],
  server: {
    port: 8081,
    // In production one process serves the page and the socket, so the client
    // derives the socket's address from the page's. Dev splits them across two
    // ports, and this proxy puts them back on one so that derivation is the
    // same code in both places rather than a branch on which one is running.
    proxy: { [WS_PATH]: { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Vitest's default is 5 s, and the slowest tests here run about 2 s on an
    // idle machine -- a siege test that steps 240 frames, or one that throws
    // two nets and waits for each to land. Two and a half times headroom is
    // not enough on a developer's box: this session watched two different
    // tests go red exactly once each, in a full run, with background work on
    // the same cores, and neither could be reproduced afterwards. Both were
    // seed-swept clean (200 maps and 120 maps, zero bad), so the cause was the
    // clock and not the game.
    //
    // The same shape as `preview-tab-skews-the-suite`, which is a browser
    // preview driving rAF on the cores vitest wants. A false red in the
    // pre-commit gate teaches people to re-run it, which is how a true red
    // gets waved through.
    testTimeout: 20_000,
  },
});
