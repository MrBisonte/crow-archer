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
 * Reads the page from disk once and remembers it. The file cannot change while
 * the process runs, so re-reading it per request would buy nothing and cost a
 * syscall on a path that is otherwise pure memory.
 */
export class FileClientPage implements ClientPage {
  readonly #path: string;
  #cached: string | null = null;

  constructor(dir: string = DEFAULT_CLIENT_DIR) {
    this.#path = resolve(dir, 'index.html');
  }

  async read(): Promise<string | null> {
    if (this.#cached !== null) return this.#cached;
    try {
      this.#cached = await readFile(this.#path, 'utf8');
      return this.#cached;
    } catch {
      // A server with no build still serves sockets. Someone running only the
      // server, with the client opened from disk, is a supported way to play.
      return null;
    }
  }
}
