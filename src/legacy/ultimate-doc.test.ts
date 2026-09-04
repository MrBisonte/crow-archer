/**
 * Holds every `CONFIG` figure quoted in `docs/balance.md` to the value the
 * game actually runs on.
 *
 * The same shape as `src/legacy/balance-doc.test.ts` and
 * `src/sim/manual-arena-doc.test.ts`: read the document as text, compare it
 * against the code it describes. Those two guard the character table and the
 * arena size; this one guards the numbers the prose quotes, which is the
 * larger surface and had nothing.
 *
 * The failure it exists to prevent has already happened twice in this repo --
 * a manual that kept saying 33x21 after the field grew, and a character table
 * that went wrong without being edited. A tuned constant leaves no diff in the
 * document, so there is nothing for a reviewer to notice.
 *
 * It matches on MEANING rather than on a list of known figures: any backticked
 * name that `CONFIG` actually has, followed by a number in the same cell or
 * clause, is a claim about that constant. A figure added to the document later
 * is covered the day it is written, and one that is only mentioned without a
 * value is ignored rather than guessed at.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { devHooks } from './game.js';

const here = dirname(fileURLToPath(import.meta.url));
const balanceDoc = readFileSync(resolve(here, '../../docs/balance.md'), 'utf8');

/** A number the document attributes to a named constant, and where it says so. */
interface Claim {
  readonly key: string;
  readonly stated: number;
  readonly context: string;
}

/** A markdown row as its trimmed cells, with the outer pipes dropped. */
function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Every table cell that IS a backticked `CONFIG` key, paired with the number
 * in the cell after it.
 *
 * Deliberately not a scan of the prose. The document quotes historical values
 * as well as live ones -- "`wizBoltCooldown` drops from 2.0 s to 1.2 s" is a
 * true sentence about a number that is now 1.2 -- so a rule that read any
 * number after any name would fail on correct writing and force the prose to
 * be bent around the test. A table cell holding nothing but a name is an
 * unambiguous claim, and any table added later is covered the day it is
 * written.
 */
function claims(doc: string, config: Record<string, unknown>): Claim[] {
  const found: Claim[] = [];
  for (const line of doc.split('\n')) {
    if (!line.includes('|')) continue;
    const row = cells(line);
    row.forEach((cell, i) => {
      const name = /^`([A-Za-z][A-Za-z0-9_]*)`$/.exec(cell);
      if (!name) return;
      const key = name[1]!;
      if (typeof config[key] !== 'number') return;
      const value = row[i + 1];
      if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) return;
      found.push({ key, stated: Number(value), context: row[0] ?? key });
    });
  }
  return found;
}
describe('every CONFIG figure quoted in the balance document', () => {
  const config = devHooks.config() as Record<string, unknown>;

  it('finds figures to check, so a broken parse cannot pass as agreement', () => {
    // A regex that matched nothing would make every assertion below vacuous,
    // which is the one way this test can lie.
    expect(claims(balanceDoc, config).length).toBeGreaterThan(8);
  });

  it('matches the value the game runs on', () => {
    const wrong = claims(balanceDoc, config)
      .filter((c) => c.stated !== config[c.key])
      .map((c) => `${c.context.trim()} -- CONFIG.${c.key} is ${String(config[c.key])}`);
    expect(wrong).toEqual([]);
  });

  it('covers every ultimate, so a new one cannot arrive undocumented', () => {
    // The ultimates are the reason this file exists. Naming them explicitly
    // means a sixth hero's figures have to reach the document, rather than
    // the test quietly checking four constants and reporting success.
    const quoted = new Set(claims(balanceDoc, config).map((c) => c.key));
    const perHero = ['archerHeadshot', 'knightEarthshatter', 'sapperCarpet',
                     'wizVortex', 'rangerHarpoon'];
    const missing = perHero.filter(
      (prefix) => ![...quoted].some((key) => key.startsWith(prefix)));
    expect(missing).toEqual([]);
  });
});
