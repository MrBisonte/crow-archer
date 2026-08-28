/**
 * Holds every arena-size claim in the two manuals to the constants the game
 * actually generates from.
 *
 * `feat/playfield-55x33` changed `MAP_COLS`/`MAP_ROWS` from 33x21 to 55x33 and
 * shipped in v0.2.0. Both manuals kept saying 33x21 in three places, and the
 * retro page says of itself that every number in it is read off the real build.
 * The one line selling the document's accuracy was the line that had rotted.
 * Nothing caught it: no test reads prose, and the sentence was never edited, so
 * there was no diff for a reviewer to notice either.
 *
 * This is the same shape as `src/legacy/balance-doc.test.ts`: read the document
 * as text, compare it against the code it describes. Applied to the field
 * rather than the character table.
 *
 * It matches on meaning rather than on the three known sentences: any "N x M"
 * that sits near the words grid, tile or arena is a claim about the field, so
 * a fourth one added later is covered the day it is written. A test pinned to
 * the exact strings would pass while a new sentence went stale, which is the
 * failure it exists to prevent.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MAP_COLS, MAP_ROWS } from './arena-map';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '../..', rel), 'utf8');

/** A dimension a document states about the playfield, and where it says it. */
interface ArenaClaim {
  readonly cols: number;
  readonly rows: number;
  readonly context: string;
}

/**
 * Every `N x M` that shares a line or sentence with the words grid, tile or
 * arena. Both spellings of the separator, and the HTML entity, because one
 * manual is markdown and the other is a hand-written page.
 */
function arenaClaims(doc: string): ArenaClaim[] {
  const claims: ArenaClaim[] = [];
  for (const chunk of doc.split(/(?<=[.?!])\s+|\r?\n/)) {
    if (!/\b(?:grid|tiles?|arena)\b/i.test(chunk)) continue;
    for (const m of chunk.matchAll(/(\d+)\s*(?:x|×|&times;)\s*(\d+)/gi)) {
      claims.push({
        cols: Number(m[1]),
        rows: Number(m[2]),
        context: chunk.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 70),
      });
    }
  }
  return claims;
}

const MANUALS = [
  { file: 'docs/manual.md', claims: arenaClaims(read('docs/manual.md')) },
  { file: 'docs/manual.html', claims: arenaClaims(read('docs/manual.html')) },
] as const;

describe('the manuals describe the field the game generates', () => {
  it.each(MANUALS)('$file states the arena size at least once', ({ claims }) => {
    // Without this, deleting the sentence turns the guard below into a no-op
    // that passes forever on an empty list.
    expect(claims.length).toBeGreaterThan(0);
  });

  it.each(MANUALS)('$file agrees with MAP_COLS x MAP_ROWS everywhere', ({ claims }) => {
    const wrong = claims.filter(c => c.cols !== MAP_COLS || c.rows !== MAP_ROWS);
    expect(
      wrong.map(c => `${c.cols}x${c.rows} in "${c.context}"`),
      `the code generates ${MAP_COLS}x${MAP_ROWS}`,
    ).toEqual([]);
  });
});
