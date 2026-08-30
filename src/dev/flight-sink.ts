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
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Plugin } from 'vite';

import { FLIGHT_PATH } from './flight-path';

/** A request body big enough to need more than this is a bug, not a beat. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * One received body as the line to append: parsed, wrapped, re-serialised.
 * The server stamp wins a collision — the receive time is the one fact the
 * client cannot testify to. Throws on anything that is not a JSON object,
 * which the route answers with a 400.
 */
export function toLine(body: string, receivedAt: number): string {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('flight payload must be a JSON object');
  }
  return JSON.stringify({ ...parsed, srv: receivedAt });
}

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
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) req.destroy();
        });
        req.on('end', () => {
          void ready
            .then(() => appendFile(file, `${toLine(body, Date.now())}\n`))
            .then(() => { res.statusCode = 204; res.end(); })
            .catch(() => { res.statusCode = 400; res.end(); });
        });
      });
    },
  };
}
