/**
 * Dev-server sink for the flight recorder (src/dev/flight-recorder.ts).
 *
 * POST /__flight appends one JSONL line per request to
 * `_flightlogs/session-<start>.jsonl`, each wrapped with the server's own
 * receive time — so when the page hangs and its beats stop, the gap between
 * `srv` stamps marks the freeze from the outside, which the hung page cannot.
 *
 * Lives inside the vite dev server because `npm run dev` already IS the
 * controlled instance a monitored playtest runs on; a second process would be
 * one more thing to forget. `apply: 'serve'` keeps it out of builds entirely.
 * The deployed server answers the same path for the published build — see
 * src/server/index.ts — and both read the format from src/dev/flight-path.ts.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Plugin } from 'vite';

import { FLIGHT_PATH, MAX_BODY_BYTES, toLine } from './flight-path';

export function flightSink(): Plugin {
  return {
    name: 'flight-sink',
    apply: 'serve',
    configureServer(server) {
      const dir = join(server.config.root, '_flightlogs');
      const file = join(dir, `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
      const ready = mkdir(dir, { recursive: true });
      server.config.logger.info(`flight sink: ${file}`);
      server.middlewares.use(FLIGHT_PATH, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        // Buffers, decoded once at the end: a multi-byte character split
        // across two chunks decodes to replacement characters if each chunk is
        // stringified on its own, which corrupts a log nobody would question.
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) { req.destroy(); return; }
          chunks.push(chunk);
        });
        req.on('end', () => {
          void ready
            .then(() => appendFile(file, `${toLine(Buffer.concat(chunks).toString('utf8'), Date.now())}\n`))
            .then(() => { res.statusCode = 204; res.end(); })
            .catch(() => { res.statusCode = 400; res.end(); });
        });
      });
    },
  };
}
