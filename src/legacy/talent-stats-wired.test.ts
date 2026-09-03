/**
 * Every numeric talent must actually reach the game.
 *
 * `TALENTS.STATS` maps a talent to the CONFIG figure it moves, and
 * `assertTalentStatsWired` already refuses to load a tree whose linear talent
 * has no row. That check is only half of it: a row proves the talent has a
 * figure, not that anything reads the talent's version of it.
 *
 * Twelve talents shipped past that check doing nothing at all. Each had a
 * STATS row and each consumer went on reading `CONFIG.theKey` directly, so
 * `TALENTS.stat` was computed and thrown away. The tree looked right, the
 * screen priced them, and the game never saw a single one.
 *
 * So this reads the source. For every talent with a STATS row, the CONFIG key
 * it names must be read through `TALENTS.stat` somewhere — and where it is
 * still read raw, that site has to be one of the few that legitimately want
 * the base figure.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { CHARACTERS } from '../net/protocol';
import { CHAR_TREES } from '../sim/talents';

const SRC = readFileSync(new URL('./game.js', import.meta.url), 'utf8');

/** `talentId -> CONFIG key`, lifted out of the STATS table in the source. */
function statsTable(): Record<string, string> {
  const block = /const STATS = \{([\s\S]*?)\n  \};/.exec(SRC);
  if (!block) throw new Error('TALENTS.STATS is not where this test expects it');
  const out: Record<string, string> = {};
  for (const m of block[1]!.matchAll(/(\w+):\s*\{ key: '(\w+)'/g)) out[m[1]!] = m[2]!;
  return out;
}

/**
 * Sites allowed to read a talent's figure raw.
 *
 * A cooldown chip and a meter fill draw progress as a fraction of the WHOLE
 * bar. If they read the shortened figure the bar would refill at the same
 * apparent rate however much the talent took off it, so the talent would be
 * invisible exactly where the player looks to see it. Those read the base on
 * purpose, and are named here rather than left to be argued about later.
 */
// The knight's chain window is the last of these. HELD STEP is keyed to the
// shared shiftChainSecs, and the wizard's reading of it is talent-aware on
// purpose while the knight's is not: a talent in the wizard's tree must not
// widen the knight's charge chain, and routing him through stat() is exactly
// how that would happen. See the STATS row that says so.
const MAY_READ_RAW = /cooldownChip|const fill = 1 -|fuse: s\.life \/|cooldown: wizBoltCD|knightChainTimer/;

describe('every numeric talent reaches the game', () => {
  const stats = statsTable();

  it('has a STATS row for every linear talent in every tree', () => {
    for (const char of CHARACTERS) {
      for (const spec of CHAR_TREES[char].talents) {
        if (spec.effect.kind !== 'linear') continue;
        expect(stats[spec.id], `${char}.${spec.id} moves no CONFIG figure`).toBeDefined();
      }
    }
  });

  it('names a CONFIG figure that exists', () => {
    for (const [id, key] of Object.entries(stats)) {
      expect(SRC.includes(`${key}:`), `${id} points at CONFIG.${key}, which is not defined`)
        .toBe(true);
    }
  });

  it('is read through TALENTS.stat by whatever consumes it', () => {
    // The check the twelve dead talents would have failed.
    const missing: string[] = [];
    for (const id of Object.keys(stats)) {
      // Either call form: the module's own consumers call the bare `stat`,
      // everything outside it goes through `TALENTS.stat`.
      if (!SRC.includes(`TALENTS.stat('${id}')`) && !SRC.includes(`stat('${id}')`)) {
        missing.push(id);
      }
    }
    expect(missing, `these talents move a figure nothing reads: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('leaves no consumer reading the base figure around the talent', () => {
    // The other half: a talent can be read in one place and bypassed in
    // another, which is worse than dead because it works only sometimes.
    const leaks: string[] = [];
    for (const [id, key] of Object.entries(stats)) {
      for (const rawLine of SRC.split('\n')) {
        // Prose, not code. A comment naming the figure is documentation,
        // and that includes a TRAILING one: `let sapperChargeCD = 0;  //
        // ... see CONFIG.sapperChargeCooldown` is a note, not a read.
        const line = rawLine.split('//')[0]!;
        if (!line.includes(`CONFIG.${key}`)) continue;
        const t = line.trimStart();
        if (t.startsWith('*') || t.startsWith('/*')) continue;
        if (line.includes(`${key}:`)) continue;          // the definition itself
        if (MAY_READ_RAW.test(line)) continue;           // deliberate, see above
        leaks.push(`${id} bypassed: ${line.trim()}`);
      }
    }
    expect(leaks, `talent figures read raw:\n${leaks.join('\n')}`).toEqual([]);
  });
});
