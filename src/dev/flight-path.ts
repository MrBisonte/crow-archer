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

import { SERVER_ORIGIN, isStaticHost, type PageOrigin } from '../net/server-url';

/** The path a sink answers on. Relative, so a server that also serves the page
 * is reached without naming it. */
export const FLIGHT_PATH = '/__flight';

/** A request body big enough to need more than this is a bug, not a beat. */
export const MAX_BODY_BYTES = 1_000_000;

/**
 * Where a page at this origin POSTs its records.
 *
 * Relative wherever the page came from a server, which is both the vite dev
 * server and the deployed one — that is the address they have always used and
 * it keeps working with no origin named. A page from a static host has no sink
 * of its own, so it names the deployed one; that request is cross-origin, and
 * the route answers the header that lets it land.
 *
 * A `file://` page keeps the relative path and so reaches nothing. Deliberate:
 * a downloaded copy is somebody else's machine, and the recorder gives up
 * after five failed sends rather than retrying forever.
 */
export function flightEndpoint(page: PageOrigin): string {
  return isStaticHost(page) ? `${SERVER_ORIGIN}${FLIGHT_PATH}` : FLIGHT_PATH;
}

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
