/**
 * Guards the character-select table in `docs/balance.md` against the panel
 * that table describes.
 *
 * Two of its four columns are not facts anyone typed. HP and SPEED are
 * derived by `statPips` from `CHARACTER_STATS`, scaled against the roster's
 * best row, so neither is a per-character number: moving the ranger's speed
 * from 250 to 260 re-scales the other four rows. A reviewer reading that
 * commit sees one number change in `arena.ts` and four table rows that look
 * untouched and correct. The document goes wrong without being edited, which
 * is rot rather than staleness — there is no diff to notice.
 *
 * `docs/balance.md` says of the authored DAMAGE bar that `CHAR_PANELS` throws
 * at load if it disagrees with the ordering `bossDamageMult` gives, "so the
 * two cannot drift apart silently even though they are written in two
 * places". That guard is `assertPanelDamageOrder` and it is real, but it
 * covers code against code. The same table, restated four lines below that
 * sentence in the document itself, had nothing. This is the missing half.
 *
 * The comparison is against `charPanels()` — the built rows the game actually
 * draws — rather than against a second copy of the `statPips` arithmetic. A
 * formula re-implemented here would be the same duplication one level down:
 * it would agree with a broken `statPips` and let the document rot anyway.
 *
 * Reads the document as text, the way `src/sim/events.coverage.test.ts` reads
 * `events.ts` and `game.js`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { devHooks } from './game.js';

const here = dirname(fileURLToPath(import.meta.url));
const balanceDoc = readFileSync(resolve(here, '../../docs/balance.md'), 'utf8');

/**
 * The header that identifies the one table this guards. `docs/balance.md` has
 * four tables whose first column is `Character`, so the anchor is the whole
 * header row rather than its first cell.
 */
const PANEL_TABLE_HEADER = ['Character', 'RANGE', 'DAMAGE', 'HP', 'SPEED'];

/** A markdown row as its trimmed cells, with the outer pipes dropped. */
function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

/** True for the `|---|---|` rule that separates a header from its body. */
function isRuleRow(row: string): boolean {
  return cells(row).every(c => /^-+$/.test(c));
}

const lines = balanceDoc.split(/\r?\n/);
const headerAt = lines.findIndex(
  l => l.startsWith('|') && cells(l).join('|') === PANEL_TABLE_HEADER.join('|'));
const ruleRow = headerAt < 0 ? undefined : lines[headerAt + 1];

/** Every `|`-row under the header, stopping at the first line that is not one. */
const dataRows: string[] = [];
for (let i = headerAt + 2; headerAt >= 0 && i < lines.length; i++) {
  const line = lines[i];
  if (line === undefined || !line.startsWith('|')) break;
  dataRows.push(line);
}

/**
 * The table as written: character kind -> stat label -> pips.
 *
 * Keyed by every row found rather than by the roster, so a row for a
 * character with no panel lands in the key set below instead of being skipped
 * by a lookup that never ran.
 */
const documented = new Map<string, Record<string, number>>();
for (const row of dataRows) {
  const [name = '', ...values] = cells(row);
  const stats: Record<string, number> = {};
  PANEL_TABLE_HEADER.slice(1).forEach((label, i) => { stats[label] = Number(values[i]); });
  documented.set(name.toLowerCase(), stats);
}

describe('the character-select table in docs/balance.md', () => {
  it('finds the table it is meant to guard', () => {
    // A parse that matches nothing produces an empty table, and an empty
    // table agrees with everything. These three fail loudly instead.
    expect(headerAt, `no table headed "${PANEL_TABLE_HEADER.join(' | ')}"`)
      .toBeGreaterThanOrEqual(0);
    expect(ruleRow === undefined ? '' : ruleRow, 'header has no rule row under it')
      .toSatisfy(isRuleRow);
    expect(dataRows.length, 'header has no rows under it').toBeGreaterThan(0);
  });

  it('gives every row one whole number per column', () => {
    for (const row of dataRows) {
      expect(cells(row), row).toHaveLength(PANEL_TABLE_HEADER.length);
    }
    for (const [char, stats] of documented) {
      for (const [label, pips] of Object.entries(stats)) {
        expect(Number.isInteger(pips), `${char} ${label} is "${pips}"`).toBe(true);
      }
    }
  });

  it('lists exactly the characters that have a panel', () => {
    // The exact key set, not a count: a count catches a deletion and misses
    // an addition, and a sixth character is the likelier of the two.
    expect([...documented.keys()].sort())
      .toEqual(devHooks.charPanels().map(p => p.char).sort());
  });

  it('prints the pips the panel actually draws', () => {
    for (const panel of devHooks.charPanels()) {
      const drawn: Record<string, number> = {};
      for (const bar of panel.statBars) drawn[bar.label] = bar.pips;
      expect(documented.get(panel.char), panel.char).toEqual(drawn);
    }
  });
});
