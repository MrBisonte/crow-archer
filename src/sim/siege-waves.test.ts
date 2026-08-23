import { describe, expect, it } from 'vitest';

import { BOSS_KINDS, ENEMY_KINDS, type BossKind, type EnemyKind } from './bestiary';
import { SIEGE_WAVE_COUNT, siegeLadder, siegeWave, type SiegeWave } from './siege-waves';

/** Every wave number the siege has, 1..SIEGE_WAVE_COUNT. */
const WAVES: readonly number[] =
  Array.from({ length: SIEGE_WAVE_COUNT }, (_unused, index) => index + 1);

/** How many distinct kinds a wave fields. */
const distinctKinds = (wave: SiegeWave): number =>
  new Set(wave.enemies.map((entry) => entry.kind)).size;

/** How many bodies a wave fields, bosses aside. */
const bodies = (wave: SiegeWave): number =>
  wave.enemies.reduce((total, entry) => total + entry.count, 0);

describe('the siege fields the whole game', () => {
  // The one that makes "every critter comes" true rather than intended. Driven
  // off the bestiary, so adding an enemy and forgetting to give it a wave fails
  // here instead of being noticed by a player who never met it.
  it('brings every enemy kind at least once across the ten waves', () => {
    const seen = new Set<EnemyKind>();
    for (const n of WAVES) for (const entry of siegeWave(n).enemies) seen.add(entry.kind);
    expect(seen).toEqual(new Set(ENEMY_KINDS));
  });

  it('brings every boss at least once across the ten waves', () => {
    const seen = new Set<BossKind>();
    for (const n of WAVES) for (const boss of siegeWave(n).bosses) seen.add(boss);
    expect(seen).toEqual(new Set(BOSS_KINDS));
  });

  it('sends no boss twice, so each arrival is the one time you meet it', () => {
    const all = WAVES.flatMap((n) => [...siegeWave(n).bosses]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the shape of the ladder', () => {
  // 1-3 introduce one kind at a time, so each is met on its own.
  it.each([1, 2, 3])('fields exactly one kind and no boss on wave %i', (n) => {
    const wave = siegeWave(n);
    expect(distinctKinds(wave)).toBe(1);
    expect(wave.bosses).toEqual([]);
  });

  // 4-6 pair them up: two answers to hold at once, still nothing leading them.
  it.each([4, 5, 6])('fields two or more kinds and no boss on wave %i', (n) => {
    const wave = siegeWave(n);
    expect(distinctKinds(wave)).toBeGreaterThanOrEqual(2);
    expect(wave.bosses).toEqual([]);
  });

  it.each([7, 8, 9, 10])('is led by at least one boss on wave %i', (n) => {
    expect(siegeWave(n).bosses.length).toBeGreaterThanOrEqual(1);
  });

  it('ends with two bosses on the field at once', () => {
    expect(siegeWave(SIEGE_WAVE_COUNT).bosses).toHaveLength(2);
  });

  it.each(WAVES)('lists no kind twice on wave %i', (n) => {
    const wave = siegeWave(n);
    expect(distinctKinds(wave)).toBe(wave.enemies.length);
  });
});

describe('the counts', () => {
  it.each(WAVES)('sends a real number of every kind it names on wave %i', (n) => {
    for (const entry of siegeWave(n).enemies) {
      expect(entry.count, `${entry.kind} on wave ${n}`).toBeGreaterThan(0);
      expect(Number.isInteger(entry.count), `${entry.kind} on wave ${n}`).toBe(true);
    }
  });

  it('brings more bodies every wave than the wave before', () => {
    for (const n of WAVES.slice(1)) {
      expect(bodies(siegeWave(n)), `wave ${n}`).toBeGreaterThan(bodies(siegeWave(n - 1)));
    }
  });

  // The arena is 33x21 tiles with about a third of it solid. Past roughly this
  // many bodies the player stops choosing which threat to answer and is simply
  // surrounded, which is the failure mode the ladder is paced to avoid.
  it('never crowds the arena past what it can hold', () => {
    for (const n of WAVES) expect(bodies(siegeWave(n)), `wave ${n}`).toBeLessThanOrEqual(14);
  });
});

describe('siegeWave', () => {
  it.each(WAVES)('answers with the wave numbered %i', (n) => {
    expect(siegeWave(n).wave).toBe(n);
  });

  it('gives the same wave for the same number, with no draw to carry', () => {
    expect(siegeWave(7)).toEqual(siegeWave(7));
  });

  // A finite ladder has an end, and a caller that has run off it is the caller
  // worth catching. All three of these are the same mistake.
  it.each([0, -1, SIEGE_WAVE_COUNT + 1, 1.5, Number.NaN])(
    'refuses %s, which is not a wave of this siege',
    (n) => {
      expect(() => siegeWave(n)).toThrow(RangeError);
    },
  );

  it('says what it wanted when it refuses', () => {
    expect(() => siegeWave(11)).toThrow(/1\.\.10/);
  });
});

describe('siegeLadder', () => {
  it('lays out exactly the waves the siege counts', () => {
    expect(siegeLadder()).toHaveLength(SIEGE_WAVE_COUNT);
  });

  it('lays them out in order, matching siegeWave rung for rung', () => {
    siegeLadder().forEach((entry, index) => {
      expect(entry.wave).toBe(index + 1);
      expect(entry).toEqual(siegeWave(index + 1));
    });
  });
});
