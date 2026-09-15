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

import { readBody } from './flight-body';
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
        void Promise.all([readBody(req, MAX_BODY_BYTES), ready])
          .then(([body]) => appendFile(file, `${toLine(body, Date.now())}\n`))
          .then(() => { res.statusCode = 204; res.end(); })
          // A body over the cap lands here too, on a socket already hung up.
          .catch(() => { res.statusCode = 400; res.end(); });
      });
    },
  };
}
