/**
 * The flight recorder's wire contract, and its one home: the endpoint path,
 * the body cap, and the line a sink appends.
 *
 * Three consumers, not two. The page that POSTs (flight-recorder.ts), the vite
 * dev-server plugin (flight-sink.ts), and the production server
 * (src/server/index.ts) all have to agree on these, and the two sinks have to
 * write the same file format or a log stops being one thing to read.
 *
 * It stays a module of its own because it is the part of the sink with no
 * `node:fs` in it and no vite: the client bundle must never see the first, and
 * the server must never see the second. Everything shared is therefore what is
 * left here, which is what makes the file worth having rather than an
 * indirection.
 */

/** The path a sink answers on. Relative, so a server that also serves the page
 * is reached without naming it. */
export const FLIGHT_PATH = '/__flight';

/** A request body big enough to need more than this is a bug, not a beat. */
export const MAX_BODY_BYTES = 1_000_000;

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
