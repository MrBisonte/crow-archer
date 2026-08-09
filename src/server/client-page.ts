/**
 * The built client, as the server sees it.
 *
 * The build inlines everything into one `dist/index.html`, so there is exactly
 * one asset to serve and this interface says so. A second file would arrive as
 * a second implementation rather than as a loop in here that grew a branch.
 *
 * The server is handed one of these instead of reading the disk itself, which
 * is what lets the HTTP behaviour be tested with a fake in a line.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Where the page lives when nothing says otherwise, relative to the cwd. */
export const DEFAULT_CLIENT_DIR = 'dist';

export interface ClientPage {
  /** The page's HTML, or null when there is no build to serve. */
  read(): Promise<string | null>;
}

/**
 * Reads the page from disk on each request.
 *
 * This was cached for the life of the process on the grounds that the file
 * cannot change while the server runs. It can: rebuilding the client during
 * development does exactly that, and the cache then served the previous build
 * with no way to tell from the outside. A read happens once per page load, not
 * once per frame, so there was nothing to save.
 */
export class FileClientPage implements ClientPage {
  readonly #path: string;

  constructor(dir: string = DEFAULT_CLIENT_DIR) {
    this.#path = resolve(dir, 'index.html');
  }

  async read(): Promise<string | null> {
    try {
      return await readFile(this.#path, 'utf8');
    } catch {
      // A server with no build still serves sockets. Someone running only the
      // server, with the client opened from disk, is a supported way to play.
      return null;
    }
  }
}
