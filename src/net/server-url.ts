/**
 * Where the client looks for the lobby server when nothing overrides it.
 *
 * A page that was served over HTTP came from a server, and that server is the
 * one to talk to: deploying is then one process on one URL, with no build-time
 * address baked into the bundle and nothing to reconfigure per host.
 *
 * A page opened from disk has no origin to derive from, so it falls back to the
 * local development server. That keeps the "download one file and play"
 * property: the standalone file still reaches a server running on the machine,
 * and `?server=` reaches any other one.
 */

import { WS_PATH } from './protocol';

/** Where a `file://` page looks, since it has no origin of its own. */
export const LOCAL_SERVER = `ws://127.0.0.1:8082${WS_PATH}`;

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
 * The socket URL for a page at this origin.
 *
 * The scheme is upgraded alongside the page's: a page on HTTPS may not open an
 * insecure socket, and browsers block the mixed content rather than warn.
 */
export function defaultServerUrl(page: PageOrigin): string {
  if (!page.host) return LOCAL_SERVER;
  if (page.protocol === 'https:') return `wss://${page.host}${WS_PATH}`;
  if (page.protocol === 'http:') return `ws://${page.host}${WS_PATH}`;
  return LOCAL_SERVER;
}
