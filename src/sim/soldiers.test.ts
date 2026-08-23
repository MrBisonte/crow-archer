import { describe, expect, it } from 'vitest';

import {
  COMMANDER_WAVE,
  SOLDIER_KINDS,
  SOLDIER_STATS,
  shieldFacing,
  shieldStops,
  waveComposition,
  type SoldierKind,
} from './soldiers';

/** How many distinct kinds a wave fields. */
const kindsIn = (wave: number): number => new Set(waveComposition(wave)).size;

/** How many of one kind a wave fields. */
const countOf = (wave: number, kind: SoldierKind): number =>
  waveComposition(wave).filter((k) => k === kind).length;

describe('waveComposition', () => {
  // The ramp Alex asked for: one kind, then pairs, then the lot.
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 2],
    [6, 3],
    [7, 3],
    [30, 3],
  ])('fields %i distinct kind(s) on wave %i', (wave, kinds) => {
    expect(kindsIn(wave)).toBe(kinds);
  });

  it('never sends an empty wave', () => {
    for (let wave = 1; wave <= 40; wave++) {
      expect(waveComposition(wave).length, `wave ${wave}`).toBeGreaterThan(0);
    }
  });

  // A band that always opened with the same kind would make the first two
  // waves of every run identical, and the pairs at 3-5 the same pair each time.
  it('rotates which kinds march, so consecutive waves differ', () => {
    expect(new Set(waveComposition(1))).not.toEqual(new Set(waveComposition(2)));
    expect(new Set(waveComposition(3))).not.toEqual(new Set(waveComposition(4)));
  });

  it('reaches every kind across the single-kind and paired bands', () => {
    const seen = new Set<SoldierKind>();
    for (let wave = 1; wave <= 5; wave++) for (const k of waveComposition(wave)) seen.add(k);
    expect(seen).toEqual(new Set(SOLDIER_KINDS));
  });

  it('brings more bodies once every kind is in play', () => {
    expect(waveComposition(6).length).toBeGreaterThan(waveComposition(1).length);
  });

  it('sends the same wave for the same number, with no draw to carry', () => {
    expect(waveComposition(4)).toEqual(waveComposition(4));
  });

  it('sends an even hand of each kind it fields', () => {
    for (let wave = 1; wave <= 12; wave++) {
      const counts = SOLDIER_KINDS.map((k) => countOf(wave, k)).filter((n) => n > 0);
      expect(new Set(counts).size, `wave ${wave} was lopsided`).toBe(1);
    }
  });

  it('treats a wave below the first band as the first band', () => {
    expect(waveComposition(0)).toEqual(waveComposition(1));
    expect(waveComposition(-3)).toEqual(waveComposition(1));
  });
});

describe('SOLDIER_STATS', () => {
  it.each(SOLDIER_KINDS)('has a row for %s', (kind) => {
    expect(SOLDIER_STATS[kind].hp).toBeGreaterThan(0);
    expect(SOLDIER_STATS[kind].speed).toBeGreaterThan(0);
  });

  // The three have to actually play differently, or they are one enemy with
  // three sprites. The shieldman soaks, the archer keeps its distance, and the
  // spearman closes.
  it('gives the shieldman the most health and the archer the least', () => {
    expect(SOLDIER_STATS.shieldman.hp).toBeGreaterThan(SOLDIER_STATS.spearman.hp);
    expect(SOLDIER_STATS.archer.hp).toBeLessThan(SOLDIER_STATS.spearman.hp);
  });

  it('gives the archer much the longest reach and the shieldman the shortest', () => {
    expect(SOLDIER_STATS.archer.reach).toBeGreaterThan(SOLDIER_STATS.spearman.reach);
    expect(SOLDIER_STATS.shieldman.reach).toBeLessThan(SOLDIER_STATS.spearman.reach);
  });

  it('makes the shieldman the slowest, so its health is not simply better', () => {
    expect(SOLDIER_STATS.shieldman.speed).toBeLessThan(SOLDIER_STATS.spearman.speed);
    expect(SOLDIER_STATS.shieldman.speed).toBeLessThan(SOLDIER_STATS.archer.speed);
  });
});

describe('the shieldman\'s guard', () => {
  const RIGHT = 0;
  const LEFT = Math.PI;

  it('stops a shot coming head on', () => {
    // Soldier facing right (+x); arrow travelling left (-x), so straight at it.
    expect(shieldStops(RIGHT, LEFT)).toBe(true);
  });

  it('lets a shot through from behind', () => {
    // Facing right, arrow also travelling right: it catches up from behind.
    expect(shieldStops(RIGHT, RIGHT)).toBe(false);
  });

  it.each([
    ['square from above', Math.PI / 2],
    ['square from below', -Math.PI / 2],
  ])('lets a shot through %s, so flanking is the answer to it', (_name, heading) => {
    expect(shieldStops(RIGHT, heading)).toBe(false);
  });

  it('covers a front arc rather than one exact angle', () => {
    // Half a right angle off dead centre is still the front.
    expect(shieldStops(RIGHT, LEFT - 0.4)).toBe(true);
    expect(shieldStops(RIGHT, LEFT + 0.4)).toBe(true);
  });

  // The guard is 120 degrees, so the flank starts 60 off its nose. Pinned as a
  // pair either side of that line, because the number is the whole mechanic:
  // widen it to 180 and there is no flank at all, only getting behind it.
  it('has a flank that opens 60 degrees off its nose', () => {
    const justInside = LEFT - (Math.PI / 3 - 0.02);
    const justOutside = LEFT - (Math.PI / 3 + 0.02);
    expect(shieldStops(RIGHT, justInside)).toBe(true);
    expect(shieldStops(RIGHT, justOutside)).toBe(false);
  });

  it('works the same whichever way the soldier happens to face', () => {
    expect(shieldStops(LEFT, RIGHT)).toBe(true);
    expect(shieldStops(LEFT, LEFT)).toBe(false);
  });

  it('is not fooled by an angle wound several turns round', () => {
    expect(shieldStops(RIGHT + Math.PI * 4, LEFT)).toBe(true);
  });
});

describe('shieldFacing', () => {
  it('faces the thing it is walking at', () => {
    expect(shieldFacing(0, 0, 100, 0)).toBeCloseTo(0, 6);
    expect(shieldFacing(0, 0, -100, 0)).toBeCloseTo(Math.PI, 6);
  });

  it('holds its last facing when it is standing exactly on the target', () => {
    expect(shieldFacing(50, 50, 50, 50, 1.23)).toBe(1.23);
  });
});

describe('COMMANDER_WAVE', () => {
  it('lands after the all-three band has had time to be felt', () => {
    expect(COMMANDER_WAVE).toBeGreaterThan(6);
  });
});
