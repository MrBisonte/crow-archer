/**
 * Where the client looks for the lobby server when nothing overrides it.
 *
 * A page that was served over HTTP came from a server, and that server is the
 * one to talk to: deploying is then one process on one URL, with no build-time
 * address baked into the bundle and nothing to reconfigure per host.
 *
 * One host breaks that rule and has to be named: GitHub Pages serves the built
 * game and runs nothing, so a page from there has an origin that can answer
 * for the page and for nothing else. It is the one case where the address IS
 * baked in, and the two origins involved live here because the server reads
 * them too — they are its CORS allowlist (src/server/index.ts), and an
 * allowlist that disagreed with where the client points would fail as a
 * mystery rather than as a mismatch.
 *
 * A page opened from disk has no origin to derive from, so it falls back to the
 * local development server. That keeps the "download one file and play"
 * property: the standalone file still reaches a server running on the machine,
 * and `?server=` reaches any other one.
 */

import { WS_PATH } from './protocol';

/** Where a `file://` page looks, since it has no origin of its own. */
export const LOCAL_SERVER = `ws://127.0.0.1:8082${WS_PATH}`;

/** The deployed server: the one process that serves a page, a socket and the
 * flight sink. Named rather than derived, because the pages that need it most
 * were not served by it. */
export const SERVER_ORIGIN = 'https://crow-archer.fly.dev';

/** Where the build is published as a static page. Serves the game, runs
 * nothing, and is therefore the origin that cannot answer for itself. */
export const PAGES_ORIGIN = 'https://mrbisonte.github.io';

/**
 * The part of `window.location` this needs. Taking the two fields rather than a
 * Location keeps it a pure function of two strings, so the tests are a table
 * instead of a DOM.
 */
export interface PageOrigin {
  readonly protocol: string;
  readonly host: string;
}

/**
 * True for a page whose host runs no server of its own, so anything it needs a
 * server for has to be addressed absolutely. Two callers ask: the socket here,
 * and the flight recorder's endpoint (src/dev/flight-path.ts).
 */
export function isStaticHost(page: PageOrigin): boolean {
  return `${page.protocol}//${page.host}` === PAGES_ORIGIN;
}

/** The socket on the deployed server, for pages that cannot derive one. */
const DEPLOYED_SERVER = `${SERVER_ORIGIN.replace('https:', 'wss:')}${WS_PATH}`;

/**
 * The socket URL for a page at this origin.
 *
 * The scheme is upgraded alongside the page's: a page on HTTPS may not open an
 * insecure socket, and browsers block the mixed content rather than warn.
 */
export function defaultServerUrl(page: PageOrigin): string {
  if (!page.host) return LOCAL_SERVER;
  // Asked before the scheme, or a Pages visitor would be sent to open a socket
  // against a static host, which is a connection that can only ever fail.
  if (isStaticHost(page)) return DEPLOYED_SERVER;
  if (page.protocol === 'https:') return `wss://${page.host}${WS_PATH}`;
  if (page.protocol === 'http:') return `ws://${page.host}${WS_PATH}`;
  return LOCAL_SERVER;
}
