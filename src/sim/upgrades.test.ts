import { describe, expect, it } from 'vitest';

import {
  NEW_PROGRESS,
  NO_UPGRADES,
  UPGRADES,
  UPGRADE_ORDER,
  featherYield,
  feathersFrom,
  isMaxed,
  levelOf,
  levelsFrom,
  maxLevel,
  nextCost,
  perkHeld,
  purchase,
  statValue,
  type Progress,
  type UpgradeId,
  type UpgradeLevels,
} from './upgrades';

/** A level record with one axis raised, and everything else untouched. */
const at = (id: UpgradeId, level: number): UpgradeLevels => ({ ...NO_UPGRADES, [id]: level });

const withFeathers = (feathers: number, levels: UpgradeLevels = NO_UPGRADES): Progress =>
  ({ feathers, levels });

describe('the upgrade table', () => {
  it('lists every upgrade exactly once, in one order', () => {
    expect(UPGRADE_ORDER).toEqual(Object.keys(UPGRADES));
    expect(new Set(UPGRADE_ORDER).size).toBe(UPGRADE_ORDER.length);
  });

  it('starts every upgrade in the table at zero, with no row missing', () => {
    expect(Object.keys(NO_UPGRADES).sort()).toEqual([...UPGRADE_ORDER].sort());
    for (const id of UPGRADE_ORDER) expect(NO_UPGRADES[id]).toBe(0);
  });

  it('has at least one buyable level everywhere, priced upward', () => {
    for (const id of UPGRADE_ORDER) {
      const { costs } = UPGRADES[id];
      expect(costs.length).toBeGreaterThan(0);
      for (let i = 1; i < costs.length; i++) expect(costs[i]!).toBeGreaterThan(costs[i - 1]!);
    }
  });

  it('takes its maximum level from the cost list rather than a second number', () => {
    for (const id of UPGRADE_ORDER) expect(maxLevel(id)).toBe(UPGRADES[id].costs.length);
  });

  it('keeps the four original axes at the prices they shipped with', () => {
    expect(UPGRADES.arrows.costs).toEqual([5, 12, 25]);
    expect(UPGRADES.hp.costs).toEqual([8, 20, 40]);
    expect(UPGRADES.pfRange.costs).toEqual([6, 15, 30]);
    expect(UPGRADES.speed.costs).toEqual([7, 18, 35]);
  });

  it('gives every row a label and a description for the screen to draw', () => {
    for (const id of UPGRADE_ORDER) {
      expect(UPGRADES[id].label.length).toBeGreaterThan(0);
      expect(UPGRADES[id].desc.length).toBeGreaterThan(0);
    }
  });

  it('buys a perk once and a stat repeatedly', () => {
    expect(UPGRADES.ward.effect.kind).toBe('unlock');
    expect(maxLevel('ward')).toBe(1);
    expect(UPGRADES.arrows.effect.kind).toBe('linear');
  });
});

describe('level costs', () => {
  it('charges each level in turn as the previous one is bought', () => {
    expect(nextCost(NO_UPGRADES, 'arrows')).toBe(5);
    expect(nextCost(at('arrows', 1), 'arrows')).toBe(12);
    expect(nextCost(at('arrows', 2), 'arrows')).toBe(25);
  });

  it('has nothing left to charge at the top of the tree', () => {
    expect(nextCost(at('arrows', 3), 'arrows')).toBeNull();
    expect(isMaxed(at('arrows', 3), 'arrows')).toBe(true);
    expect(isMaxed(at('arrows', 2), 'arrows')).toBe(false);
  });

  it('maxes a perk on its single level', () => {
    expect(nextCost(NO_UPGRADES, 'ward')).toBe(45);
    expect(nextCost(at('ward', 1), 'ward')).toBeNull();
    expect(isMaxed(at('ward', 1), 'ward')).toBe(true);
  });

  it('never reads a cost off the end for a level record that overshoots', () => {
    // A save file claiming level 99 must not index past the cost list.
    expect(nextCost(at('speed', 99), 'speed')).toBeNull();
    expect(levelOf(at('speed', 99), 'speed')).toBe(maxLevel('speed'));
  });
});

describe('stat deltas', () => {
  it('adds nothing at level zero, whatever the base', () => {
    for (const base of [0, 10, 200]) {
      expect(statValue(NO_UPGRADES, 'hp', base)).toBe(base);
      expect(statValue(NO_UPGRADES, 'speed', base)).toBe(base);
    }
  });

  it('steps each stat by its own per-level figure', () => {
    expect(statValue(at('hp', 3), 'hp', 10)).toBe(13); // +1 / level
    expect(statValue(at('speed', 3), 'speed', 200)).toBe(260); // +20 / level
    expect(statValue(at('pfRange', 2), 'pfRange', 52)).toBe(68); // +8 / level
    expect(statValue(at('arrows', 3), 'arrows', 16)).toBe(22); // +2 / level
    expect(statValue(at('tools', 3), 'tools', 4)).toBe(7); // +1 / level
    expect(statValue(at('restore', 2), 'restore', 5)).toBe(9); // +2 / level
  });

  it('stacks on the base it is given, so a faster pace keeps its head start', () => {
    // Arrow capacity starts from the pace preset, not from a constant here.
    expect(statValue(at('arrows', 1), 'arrows', 10)).toBe(12); // calm
    expect(statValue(at('arrows', 1), 'arrows', 30)).toBe(32); // nightmare
  });

  it('clamps a nonsense level instead of scaling by it', () => {
    expect(statValue(at('hp', 99), 'hp', 10)).toBe(13);
    expect(statValue(at('hp', -5), 'hp', 10)).toBe(10);
  });
});

describe('perks', () => {
  it('is not held until it is bought, and held from the first level', () => {
    expect(perkHeld(NO_UPGRADES, 'ward')).toBe(false);
    expect(perkHeld(at('ward', 1), 'ward')).toBe(true);
  });
});

describe('feather yield', () => {
  it('pays the plain kill value with nothing bought', () => {
    expect(featherYield(NO_UPGRADES, 1)).toBe(1);
    expect(featherYield(NO_UPGRADES, 3)).toBe(3);
  });

  it('rounds a fractional bonus up rather than paying nothing for the upgrade', () => {
    // 1 x 1.25 = 1.25. Flooring pays 1, which is what buying it bought.
    expect(featherYield(at('plume', 1), 1)).toBe(1);
    expect(featherYield(at('plume', 1), 2)).toBe(3); // 2.5
    expect(featherYield(at('plume', 2), 2)).toBe(3); // 3.0
    expect(featherYield(at('plume', 2), 3)).toBe(5); // 4.5
  });

  it('is worth more at the second level than the first, on a real kill', () => {
    const white = 3; // a white crow at its best roll
    expect(featherYield(at('plume', 2), white)).toBeGreaterThan(
      featherYield(at('plume', 1), white),
    );
  });
});

describe('buying', () => {
  it('takes the cost off the wallet and adds the level', () => {
    const result = purchase(withFeathers(10), 'arrows');
    expect(result.kind).toBe('bought');
    if (result.kind !== 'bought') return;
    expect(result.spent).toBe(5);
    expect(result.progress.feathers).toBe(5);
    expect(result.progress.levels.arrows).toBe(1);
  });

  it('leaves the progress it was handed untouched', () => {
    const before = withFeathers(10);
    purchase(before, 'arrows');
    expect(before.feathers).toBe(10);
    expect(before.levels.arrows).toBe(0);
  });

  it('touches no other axis', () => {
    const result = purchase(withFeathers(10), 'arrows');
    if (result.kind !== 'bought') throw new Error('expected a purchase');
    for (const id of UPGRADE_ORDER) {
      if (id !== 'arrows') expect(result.progress.levels[id]).toBe(0);
    }
  });

  it('refuses when the wallet is short, and says by how much', () => {
    const result = purchase(withFeathers(3), 'arrows');
    expect(result).toEqual({ kind: 'tooPoor', cost: 5, short: 2 });
  });

  it('buys at exactly the asking price', () => {
    const result = purchase(withFeathers(5), 'arrows');
    expect(result.kind).toBe('bought');
  });

  it('refuses a level that does not exist, however rich the wallet', () => {
    expect(purchase(withFeathers(9999, at('ward', 1)), 'ward')).toEqual({ kind: 'maxed' });
  });

  it('walks the whole cost list, one purchase at a time', () => {
    let progress = withFeathers(5 + 12 + 25);
    const spent: number[] = [];
    for (let i = 0; i < 3; i++) {
      const result = purchase(progress, 'arrows');
      if (result.kind !== 'bought') throw new Error(`stopped at level ${i}: ${result.kind}`);
      spent.push(result.spent);
      progress = result.progress;
    }
    expect(spent).toEqual([5, 12, 25]);
    expect(progress.feathers).toBe(0);
    expect(purchase(progress, 'arrows')).toEqual({ kind: 'maxed' });
  });

  it('starts a new save with nothing bought and nothing to spend', () => {
    expect(NEW_PROGRESS.feathers).toBe(0);
    expect(purchase(NEW_PROGRESS, 'arrows')).toEqual({ kind: 'tooPoor', cost: 5, short: 5 });
  });
});

describe('reading a save file', () => {
  it('starts everything at zero when there is nothing to read', () => {
    for (const raw of [null, undefined, 42, 'nonsense', []]) {
      expect(levelsFrom(raw)).toEqual(NO_UPGRADES);
    }
  });

  it('keeps the levels an older save did have, and zeroes the axes it never knew', () => {
    // A save written before POWDER KEG, FLETCHER CACHE, PLUME BOUNTY or WARD.
    const levels = levelsFrom({ arrows: 2, hp: 1, pfRange: 0, speed: 3 });
    expect(levels.arrows).toBe(2);
    expect(levels.hp).toBe(1);
    expect(levels.speed).toBe(3);
    expect(levels.tools).toBe(0);
    expect(levels.plume).toBe(0);
    expect(levels.ward).toBe(0);
  });

  it('drops an id the table has never heard of', () => {
    expect(Object.keys(levelsFrom({ arrows: 1, wingspan: 9 })).sort())
      .toEqual([...UPGRADE_ORDER].sort());
  });

  it('clamps a level the table cannot price', () => {
    expect(levelsFrom({ arrows: 99 }).arrows).toBe(3);
    expect(levelsFrom({ arrows: -4 }).arrows).toBe(0);
    expect(levelsFrom({ arrows: 1.9 }).arrows).toBe(1);
  });

  it('ignores a level that is not a number at all', () => {
    expect(levelsFrom({ arrows: '3', hp: NaN, speed: Infinity })).toEqual(NO_UPGRADES);
  });

  it('reads the wallet the same way', () => {
    expect(feathersFrom(12)).toBe(12);
    expect(feathersFrom(12.7)).toBe(12);
    expect(feathersFrom(-3)).toBe(0);
    expect(feathersFrom(undefined)).toBe(0);
    expect(feathersFrom('12')).toBe(0);
    expect(feathersFrom(NaN)).toBe(0);
  });
});
