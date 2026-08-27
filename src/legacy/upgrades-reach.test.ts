/**
 * Holds `AXIS_HEROES` against what the game actually does.
 *
 * The map claims that thirteen of the shop's forty cells are dead — that
 * QUIVER DEPTH does nothing for a knight, that POWDER KEG does nothing for the
 * sapper, that TINE REACH does nothing for the knight either. A claim like
 * that is worth precisely as much as the thing that checks it: written by hand
 * from a reading of `game.js`, it is right until somebody gives the knight a
 * crossbow, and then it is a screen confidently telling players the wrong
 * thing.
 *
 * ## What a dead cell is, and what it is not
 *
 * The first version of this file compared the CONFIG figure before and after
 * buying, and reported nine false failures. `applyToGame` sets
 * `arrows.max` for whoever is playing — the pool grows for the knight too. It
 * is just that he never draws from it. So the number always moves and the
 * number is not the question.
 *
 * The question is whether the hero ever touches what the axis raises. The
 * generic axes are asked as numbers, because `maxHP` and `speed` really are
 * per-hero functions. The kit axes are asked by playing: fire the hero's own
 * buttons and see which pool goes down, empty every pool and see whether a
 * melee swing comes out.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { CHARACTERS, type CharacterKind } from '../net/protocol';
import { AXIS_HEROES, UPGRADE_ORDER, type UpgradeId, axisReaches, maxLevel } from '../sim/upgrades';
import { devHooks as g } from './game.js';

interface Feathers {
  wallet: () => number;
  grant: (n: number) => void;
  spend: (n: number) => void;
  maxHP: () => number;
  speed: () => number;
  pfRange: () => number;
  wardStart: () => boolean;
  onCrowKill: (white: boolean) => number;
  applyToGame: () => void;
  levels: () => Record<string, number>;
}
const feathers = (): Feathers => g.feathers() as unknown as Feathers;

type Pool = 'arrows' | 'dynamites' | 'satchels' | 'bombs' | 'focus';
const inv = (): Record<string, number> => g.inv() as unknown as Record<string, number>;

function setLevels(id: UpgradeId | null): void {
  const levels = feathers().levels();
  for (const key of UPGRADE_ORDER) levels[key] = 0;
  if (id !== null) levels[id] = maxLevel(id);
  feathers().applyToGame();
}

/** Starts a run and clears whatever ceremony it staged in front of itself. */
function enterRun(char: CharacterKind): void {
  g.pick(char);
  g.go('playing');
  for (let i = 0; i < 8 && g.chooser() !== null; i++) g.chooserPick(0);
  g.healHero();
}

/**
 * Presses every firing button this hero has, a few times each.
 *
 * The secondary is pressed AND released. The archer's dynamite is a
 * charge-and-hold — `secondary()` only arms it and `throwDynamite` runs from
 * the release — so a probe that never let go reported that he does not spend
 * dynamite, which is the one hero the axis was named for.
 */
function useTheWholeKit(): void {
  const acts = [
    () => g.shoot(),
    () => { g.secondary(); g.stepSim(40); g.secondaryUp(); },
    () => { g.shift(); g.shiftUp(); },
  ];
  for (const act of acts) {
    for (let i = 0; i < 5; i++) { act(); g.stepSim(14); }
  }
}

/** Whether playing this hero ever draws the named pool down. */
function spendsFrom(char: CharacterKind, pool: Pool): boolean {
  enterRun(char);
  const before = inv()[pool]!;
  useTheWholeKit();
  return inv()[pool]! < before;
}

/**
 * Whether this hero ever swings the out-of-ammo melee, which is the only
 * thing `pfRange` reaches.
 *
 * Asked through the event bus rather than by watching a timer: `WEAPON_FIRED`
 * is what the swing announces, and the knight's answer is that he has no call
 * site at all — his sword is his primary and never runs out.
 */
function swingsFallbackMelee(char: CharacterKind): boolean {
  enterRun(char);
  let swung = false;
  const off = g.onEvent((e: { type: string; kind?: string }) => {
    if (e.type === 'WEAPON_FIRED' && (e.kind === 'pitchfork' || e.kind === 'broom')) swung = true;
  }) as unknown as (() => void) | undefined;
  const bag = inv();
  for (const key of ['arrows', 'fireArrows', 'ricochetArrows', 'bombs', 'fireBombs',
    'iceBombs', 'dynamites', 'satchels', 'focus']) bag[key] = 0;
  useTheWholeKit();
  if (typeof off === 'function') off();
  return swung;
}

/** Whether the axis moves a figure this hero is handed. */
function movesAFigure(char: CharacterKind, read: () => number, id: UpgradeId): boolean {
  enterRun(char);
  setLevels(null);
  const before = read();
  setLevels(id);
  const after = read();
  setLevels(null);
  return after !== before;
}

/** Whether an axis does anything at all for a hero, measured. */
function measureReach(id: UpgradeId, char: CharacterKind): boolean {
  switch (id) {
    case 'hp': return movesAFigure(char, () => feathers().maxHP(), id);
    case 'speed': return movesAFigure(char, () => feathers().speed(), id);
    case 'plume': return movesAFigure(char, () => {
      // The bounty is a multiplier on a roll, so the floor of many white kills
      // is what stays deterministic.
      feathers().spend(feathers().wallet());
      let least = Infinity;
      for (let i = 0; i < 40; i++) {
        const before = feathers().wallet();
        feathers().onCrowKill(true);
        least = Math.min(least, feathers().wallet() - before);
      }
      return least;
    }, id);
    case 'ward': return movesAFigure(char, () => (feathers().wardStart() ? 1 : 0), id);
    // The quiver: capacity is worth nothing to a hero who never draws from it,
    // and neither is what a pickup puts back.
    case 'arrows':
    case 'restore': return spendsFrom(char, 'arrows');
    // What the hero throws. The sapper's pouch is the pool this axis does not
    // set, so his cell is dead even though he throws more than anyone.
    case 'tools': return spendsFrom(char, 'dynamites') || spendsFrom(char, 'satchels');
    case 'pfRange': return swingsFallbackMelee(char);
  }
  throw new Error(`no reach probe for '${id}'`);
}

describe('AXIS_HEROES says which upgrades reach which hero', () => {
  beforeEach(() => { setLevels(null); });

  it('names every axis the shop sells, and no stranger', () => {
    // A missing row would read as "reaches nobody" and grey the axis out on
    // every screen; a stray one would describe an axis that is not for sale.
    expect(new Set(Object.keys(AXIS_HEROES))).toEqual(new Set(UPGRADE_ORDER));
  });

  it('names only real characters, once each', () => {
    for (const [id, heroes] of Object.entries(AXIS_HEROES)) {
      for (const char of heroes) {
        expect(CHARACTERS, `${id} names '${char}'`).toContain(char);
      }
      expect(new Set(heroes).size, `${id} repeats a hero`).toBe(heroes.length);
    }
  });

  it('leaves no axis reaching nobody', () => {
    // An axis nobody can use is not a dead cell, it is a dead row, and it
    // should be deleted rather than greyed out on all five screens.
    for (const id of UPGRADE_ORDER) {
      expect(AXIS_HEROES[id].length, `${id} reaches nobody`).toBeGreaterThan(0);
    }
  });

  it('still has dead cells to be worth having', () => {
    // The guard against the lazy fix: marking every cell live would satisfy
    // every check below and make the map a decoration.
    const dead = CHARACTERS.flatMap(
      (c) => UPGRADE_ORDER.filter((id) => !axisReaches(id, c)));
    expect(dead.length, 'the map claims nothing is dead').toBeGreaterThan(0);
  });

  for (const char of CHARACTERS) {
    describe(char, () => {
      for (const id of UPGRADE_ORDER) {
        const claimed = axisReaches(id, char);
        it(`${claimed ? 'reaches' : 'does not reach'} ${id}`, () => {
          expect(measureReach(id, char),
            `${id} is claimed ${claimed ? 'live' : 'dead'} for the ${char} and plays otherwise`)
            .toBe(claimed);
        });
      }
    });
  }
});
