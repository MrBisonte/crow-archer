import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { WS_PATH } from './src/net/protocol';

/** Where `npm run server` listens, which is what the dev proxy forwards to. */
const SERVER_PORT = 8082;

// The build inlines everything into one dist/index.html, so the game keeps its
// "download one file and play" property with no network access at runtime.
export default defineConfig({
  plugins: [viteSingleFile()],
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
  },
});
