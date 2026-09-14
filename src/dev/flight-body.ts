/**
 * Reading one flight record off the wire, for the two sinks that receive them.
 *
 * Separate from flight-path.ts because this side needs `node:http` types and
 * that file is imported by the client bundle. Separate from either sink
 * because both of them had it, comment included, and the comment is the point:
 * a multi-byte character split across a chunk boundary decodes to replacement
 * characters if each chunk is stringified on its own. That corrupts a log
 * nobody would think to question, and one copy of a trap is easier to keep
 * right than two.
 */

import type { IncomingMessage } from 'node:http';

/** Rejection reason when the body runs past the cap. The caller answers it:
 * the dev plugin hangs up, the deployed route sends a 413. */
export const TOO_LARGE = 'flight body over cap';

/**
 * The whole body as text, or a rejection.
 *
 * The socket is destroyed as soon as the cap is passed rather than at the end,
 * so a sender that ignores the answer stops costing memory immediately.
 */
export function readBody(req: IncomingMessage, cap: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        reject(new Error(TOO_LARGE));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}
