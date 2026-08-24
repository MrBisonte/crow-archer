import { describe, expect, it } from 'vitest';

import {
  TOWER_MAX_HP,
  damageTower,
  makeTower,
  makeTowers,
  standingTowers,
  towerAt,
  towerStanding,
  type Tower,
  type TowerSite,
} from './towers';

/** The two sites a bastion run gets, standing in for whatever the map picked. */
const SITES: readonly TowerSite[] = [
  { row: 4, col: 7 },
  { row: 4, col: 25 },
];

/** A tower that has been hit for exactly what it takes to bring it down. */
const rubble = (row = 0, col = 0): Tower => {
  const tower = makeTower(row, col);
  damageTower(tower, TOWER_MAX_HP);
  return tower;
};

/**
 * How many bodies the opening three waves put on the map altogether, read off
 * the siege ladder (3 + 4 + 5) and written out here rather than imported.
 *
 * `TOWER_MAX_HP` is balanced against the ladder, so the band below is the one
 * place the two are checked against each other — but importing the table would
 * make this file fail whenever somebody retunes a wave's count, which is a
 * change to their numbers and not a fault in this module. Stated as a local
 * constant, a retune fails nothing until somebody comes here and confirms the
 * band still holds, which is exactly when the question is worth asking.
 */
const EARLY_WAVE_BODIES = 12;

/** A late wave is a dozen bodies; this is one camping a tower for two of them. */
const SUSTAINED_LATE_PRESSURE = 24;

describe('TOWER_MAX_HP', () => {
  // The "a few stray hits" half of the number. Early on the player is still
  // working out that a tower is somewhere to stand rather than something to
  // garrison, and a tower lost to wave 2 teaches him the wrong lesson.
  it('shrugs off every body the opening waves could throw at it', () => {
    const tower = makeTower(0, 0);
    for (let hit = 0; hit < EARLY_WAVE_BODIES; hit++) damageTower(tower, 1);
    expect(towerStanding(tower)).toBe(true);
  });

  // The other half: a tower a late wave actually camps on comes down inside
  // two of them. Without this, a number tuned upwards for "feel" turns the
  // towers into scenery that never falls, and the whole cover mechanic is inert.
  it('comes down to a late wave that camps on it', () => {
    const tower = makeTower(0, 0);
    for (let hit = 0; hit < SUSTAINED_LATE_PRESSURE; hit++) damageTower(tower, 1);
    expect(towerStanding(tower)).toBe(false);
  });
});

describe('makeTower', () => {
  it('stands a fresh tower at full hp on the tile it was given', () => {
    const tower = makeTower(3, 11);
    expect(tower.row).toBe(3);
    expect(tower.col).toBe(11);
    expect(tower.hp).toBe(TOWER_MAX_HP);
    expect(tower.maxHp).toBe(TOWER_MAX_HP);
    expect(towerStanding(tower)).toBe(true);
  });

  it('carries its own ceiling, so a HUD has both ends of the fraction', () => {
    const tower = makeTower(0, 0);
    damageTower(tower, 5);
    expect(tower.maxHp).toBe(TOWER_MAX_HP);
    expect(tower.hp).toBe(TOWER_MAX_HP - 5);
  });
});

describe('makeTowers', () => {
  it('builds one tower per site, in the order the sites came in', () => {
    const towers = makeTowers(SITES);
    expect(towers).toHaveLength(SITES.length);
    expect(towers.map((tower) => [tower.row, tower.col])).toEqual([
      [4, 7],
      [4, 25],
    ]);
  });

  // The classic shared-object-literal bug: fill an array from one literal and
  // every tower is the same tower, so the first hit anything takes fells all of
  // them at once. Invisible until a tower collapses in two places.
  it('hands out separate towers rather than one shared body', () => {
    const towers = makeTowers(SITES);
    const [near, far] = towers;
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    if (near === undefined || far === undefined) return;

    damageTower(near, TOWER_MAX_HP);
    expect(near.hp).toBe(0);
    expect(far.hp).toBe(TOWER_MAX_HP);
    expect(near).not.toBe(far);
  });

  it('copes with no sites at all, since a map without towers is still a map', () => {
    expect(makeTowers([])).toEqual([]);
  });
});

describe('damageTower', () => {
  it('takes the hit off the tower and leaves it standing', () => {
    const tower = makeTower(0, 0);
    expect(damageTower(tower, 3)).toBe(false);
    expect(tower.hp).toBe(TOWER_MAX_HP - 3);
    expect(towerStanding(tower)).toBe(true);
  });

  // The return value's whole job: the caller plays the collapse on the one call
  // that crossed zero, not on every frame something keeps shooting the rubble.
  it('reports the fall exactly once, on the call that crosses zero', () => {
    const tower = makeTower(0, 0);
    for (let hit = 1; hit < TOWER_MAX_HP; hit++) {
      expect(damageTower(tower, 1), `hit ${hit}`).toBe(false);
    }
    expect(damageTower(tower, 1)).toBe(true);
    expect(tower.hp).toBe(0);
  });

  it('reports false for every hit after the one that felled it', () => {
    const tower = rubble();
    expect(tower.hp).toBe(0);
    for (let hit = 0; hit < 5; hit++) {
      expect(damageTower(tower, 4), `follow-up ${hit}`).toBe(false);
      expect(tower.hp).toBe(0);
    }
  });

  it('never digs the hp below zero, however large the single hit', () => {
    const tower = makeTower(0, 0);
    expect(damageTower(tower, TOWER_MAX_HP * 100)).toBe(true);
    expect(tower.hp).toBe(0);
  });

  it('holds at zero under the largest number that is still a number', () => {
    const tower = rubble();
    damageTower(tower, Number.MAX_SAFE_INTEGER);
    expect(tower.hp).toBe(0);
  });

  // Ignored, not applied as a repair. Damage in this game is usually the result
  // of a subtraction, and the day one comes out flat or negative the failure
  // should be a hit that did nothing rather than a tower that healed itself.
  // Infinity is here for a separate reason: it is genuinely greater than zero,
  // so a sign check alone would let it through and flatten the tower in one call.
  it.each([
    ['zero', 0],
    ['negative', -7],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('ignores a %s hit entirely', (_label, amount) => {
    const tower = makeTower(0, 0);
    damageTower(tower, 6);
    const before = tower.hp;

    expect(damageTower(tower, amount)).toBe(false);
    expect(tower.hp).toBe(before);
    expect(towerStanding(tower)).toBe(true);
  });

  // NaN in particular must not reach the hp: a poisoned hp answers false to
  // every comparison, so the tower would be neither standing nor fallen and
  // nothing downstream could ever tell you why.
  it('leaves a usable number in hp after a NaN hit', () => {
    const tower = makeTower(0, 0);
    damageTower(tower, Number.NaN);
    expect(Number.isFinite(tower.hp)).toBe(true);
    expect(tower.hp).toBe(TOWER_MAX_HP);
  });

  it('does not resurrect a fallen tower with a negative hit', () => {
    const tower = rubble();
    expect(damageTower(tower, -TOWER_MAX_HP)).toBe(false);
    expect(tower.hp).toBe(0);
    expect(towerStanding(tower)).toBe(false);
  });

  it('touches only the tower it was handed', () => {
    const [near, far] = makeTowers(SITES);
    if (near === undefined || far === undefined) throw new Error('two sites, two towers');

    damageTower(near, 9);
    expect(far.hp).toBe(TOWER_MAX_HP);
  });
});

describe('towerStanding', () => {
  it('is true while there is anything left of it and false at zero', () => {
    const tower = makeTower(0, 0);
    expect(towerStanding(tower)).toBe(true);
    damageTower(tower, TOWER_MAX_HP - 1);
    expect(towerStanding(tower)).toBe(true);
    damageTower(tower, 1);
    expect(towerStanding(tower)).toBe(false);
  });
});

describe('standingTowers', () => {
  it('drops the fallen and keeps the rest, in the order they were given', () => {
    const towers = makeTowers([
      { row: 1, col: 1 },
      { row: 2, col: 2 },
      { row: 3, col: 3 },
    ]);
    const middle = towers[1];
    if (middle === undefined) throw new Error('three sites, three towers');
    damageTower(middle, TOWER_MAX_HP);

    expect(standingTowers(towers).map((tower) => tower.row)).toEqual([1, 3]);
  });

  // The run's own list is fixed at the start — something still has to draw the
  // rubble — so this is a view of it, not a replacement for it.
  it('leaves the run’s own list alone', () => {
    const towers = makeTowers(SITES);
    const first = towers[0];
    if (first === undefined) throw new Error('two sites, two towers');
    damageTower(first, TOWER_MAX_HP);

    expect(standingTowers(towers)).toHaveLength(1);
    expect(towers).toHaveLength(2);
  });

  // Both towers down is an ordinary state of a run in progress, not an ending.
  // If this ever throws or a loss condition grows here, read the module doc.
  it('answers with nothing once both towers are down, and that is not an ending', () => {
    const towers = makeTowers(SITES);
    for (const tower of towers) damageTower(tower, TOWER_MAX_HP);
    expect(standingTowers(towers)).toEqual([]);
  });
});

describe('towerAt', () => {
  it('finds the tower standing on the tile', () => {
    const towers = makeTowers(SITES);
    const found = towerAt(towers, 4, 25);
    expect(found).not.toBeNull();
    expect(found?.col).toBe(25);
  });

  it('answers null for a tile that never had a tower', () => {
    expect(towerAt(makeTowers(SITES), 9, 9)).toBeNull();
  });

  // The decision, pinned: rubble does not block. Cover has to actually go away
  // when a tower falls, or losing one costs the hero a sprite and nothing else
  // and the map's one mechanic is inert. A caller stopping an arrow reads this
  // and gets the truth about the arrow's flight, in the same frame the tower
  // came down. If low cover is ever wanted, it wants its own `rubbleAt`.
  it('answers null for a tile whose tower has fallen', () => {
    const towers = makeTowers(SITES);
    const near = towers[0];
    if (near === undefined) throw new Error('two sites, two towers');

    expect(towerAt(towers, 4, 7)).toBe(near);
    damageTower(near, TOWER_MAX_HP);
    expect(towerAt(towers, 4, 7)).toBeNull();
  });

  it('stops blocking the instant the tower falls, with no transition', () => {
    const towers = makeTowers(SITES);
    const near = towers[0];
    if (near === undefined) throw new Error('two sites, two towers');

    damageTower(near, TOWER_MAX_HP - 1);
    expect(towerAt(towers, 4, 7)).toBe(near); // one hit left, still cover
    damageTower(near, 1);
    expect(towerAt(towers, 4, 7)).toBeNull(); // rubble, and open ground
  });

  it('does not confuse a row for a column on a tile that mirrors it', () => {
    const towers = makeTowers([{ row: 2, col: 8 }]);
    expect(towerAt(towers, 2, 8)).not.toBeNull();
    expect(towerAt(towers, 8, 2)).toBeNull();
  });

  it('answers null against no towers at all', () => {
    expect(towerAt([], 0, 0)).toBeNull();
  });
});

describe('the module as a whole', () => {
  // Replays are the reason the rest of the bastion takes its randomness as an
  // argument. This module takes none, so the check available is the strongest
  // one: nothing here may reach for the ambient source either.
  it('never reaches for Math.random, so a bastion replay is exact', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('towers.ts must not use Math.random');
    };
    try {
      const towers = makeTowers(SITES);
      for (const tower of towers) {
        damageTower(tower, 4);
        towerStanding(tower);
      }
      standingTowers(towers);
      towerAt(towers, 4, 7);
      expect(towers).toHaveLength(2);
    } finally {
      Math.random = original;
    }
  });

  it('gives the same run of towers the same fate from the same hits', () => {
    const run = (): number[] => {
      const towers = makeTowers(SITES);
      const hits = [1, 5, 0, -3, Number.NaN, 7, 2, Number.POSITIVE_INFINITY, 6];
      const felled: number[] = [];
      for (const tower of towers) {
        hits.forEach((amount, at) => {
          if (damageTower(tower, amount)) felled.push(at);
        });
      }
      return [...towers.map((tower) => tower.hp), ...felled];
    };
    expect(run()).toEqual(run());
  });
});
