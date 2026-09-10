/**
 * Binds the key table in `docs/manual.md` to the key map the game runs on.
 *
 * The same idea as `ultimate-doc.test.ts` does for `docs/balance.md`, and it
 * exists for the same reason, found the same way: the manual told players for
 * years that the second weapon was on `right click or Q`, and nothing in
 * `src/` bound `Q` to anything at all. A player pressed it, nothing happened,
 * and the document was the only thing that had ever said otherwise.
 *
 * Only a cell holding NOTHING BUT a backticked key name is bound, with the
 * default in the next cell. Prose is deliberately not scanned: the manual
 * names keys in sentences ("hold Q", "tap Shift") and those sentences have to
 * be free to read as English.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { devHooks as g } from './game.js';

/** Keys the menus own. Not in the manual's table, and deliberately so. */
const MENU_KEYS = new Set(['menuControls', 'back', 'restart', 'menu']);

/** What the table writes when the key is not typeable. */
const SPELLED = new Map([['(space)', ' ']]);

type Row = { name: string; shown: string };

function documentedKeys(): Row[] {
  const md = readFileSync(new URL('../../docs/manual.md', import.meta.url), 'utf8');
  const rows: Row[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] is the empty string before the leading pipe.
    const bound = /^`(\w+)`$/.exec(cells[2] ?? '');
    const name = bound?.[1];
    const shown = cells[3];
    if (name && shown) rows.push({ name, shown });
  }
  return rows;
}

describe('the manual and the key map', () => {
  const keys = () => (g.config() as { keys: Record<string, string> }).keys;

  it('documents a key for everything the player can press in a run', () => {
    const documented = new Set(documentedKeys().map((r) => r.name));
    const bound = Object.keys(keys()).filter((k) => !MENU_KEYS.has(k));
    // The exact set, not a count: a length check catches a deletion and
    // misses an addition, and an addition is how `net` would have gone
    // undocumented.
    expect(new Set(bound)).toEqual(documented);
  });

  it('gives the default each one actually has', () => {
    for (const row of documentedKeys()) {
      const want = SPELLED.get(row.shown) ?? row.shown;
      expect(keys()[row.name], `docs/manual.md says ${row.name} is ${row.shown}`)
        .toBe(want);
    }
  });

  it('finds rows at all, so a rewritten table cannot pass by vanishing', () => {
    expect(documentedKeys().length).toBeGreaterThan(5);
  });
});
