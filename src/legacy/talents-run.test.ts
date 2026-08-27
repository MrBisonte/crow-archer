/**
 * The talent system's wiring: mastery paid by real milestones, and drafted
 * talents reaching the figures the wizard's kit actually runs on.
 *
 * The tree arithmetic is pinned pure in sim/talents.test.ts; nothing here
 * re-checks a price or a threshold. What this file holds is the seams —
 * that a boss dying through the real death sequence banks mastery, that a
 * drafted LONG STEP moves the player further on a real blink, that FOCUS
 * DEPTH raises the ceiling the regen actually clamps to, and that the two
 * capstones change the storm and the bolt the way the rite promises.
 *
 * Grants persist across tests inside one run of this file (the bank is
 * module state, exactly like the FEATHERS wallet), so every test grants what
 * it needs and measures deltas — none assumes an empty bank.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ONE_SECOND, clearArena, stepPast } from './arena-testkit';
import { devHooks as g } from './game.js';

interface TalentState { mastery: number; levels: Record<string, number> }
interface Talents {
  state: () => TalentState;
  grant: (id: string, level: number) => void;
  draft: (id: string) => void;
  drafted: () => string[];
  sealCapstone: (id: string) => void;
  buy: (id: string) => { kind: string };
  blinkDistance: () => number;
  stormRadius: () => number;
  focusMax: () => number;
  stormCooldown: () => number;
}
const talents = (): Talents => g.talents() as unknown as Talents;

interface Focus { points: number; spendable: number; max: number; melee: string }
const focus = (): Focus => g.focus() as unknown as Focus;

/** Straight-line displacement of the player since `from` — the default aim
 * is diagonal, so a single axis under-reports a blink by cos 45. */
function movedSince(from: { x: number; y: number }): number {
  const p = g.player() as { x: number; y: number };
  return Math.hypot(p.x - from.x, p.y - from.y);
}
const playerAt = (): { x: number; y: number } => {
  const p = g.player() as { x: number; y: number };
  return { x: p.x, y: p.y };
};

/** Sets the pool to an exact number of points, so a spend reads clean. */
function setFocus(points: number): void {
  (g.inv() as { focus: number }).focus = points;
}

/** Empties the field and parks one crow at an exact spot from the player —
 * the forest opens with its own flock, which would drown a one-crow count. */
function parkCrowAt(dx: number): { hp: number } {
  (g.crows() as unknown[]).length = 0;
  g.spawnCrow();
  const p = g.player() as { x: number; y: number };
  const c = (g.crows() as { x: number; y: number; hp: number }[])[0]!;
  c.x = p.x + dx; c.y = p.y;
  return c;
}

beforeEach(() => {
  for (const k of Object.keys(g.keys() as Record<string, boolean>)) {
    (g.keys() as Record<string, boolean>)[k] = false;
  }
  g.takeClock();
  g.pick('wizard');
  g.go('playing');
  g.generateMap('forest');
  // Open ground: a blink refuses a hop with no room, and the storm tests
  // park a crow at an exact range.
  clearArena();
  g.healHero();
  g.stepSim(1);
});

describe('LONG STEP reaches the blink', () => {
  it('blinks the base distance with nothing drafted', () => {
    const from = playerAt();
    g.blink();
    expect(movedSince(from)).toBeCloseTo(g.config().wizBlinkDistance, 6);
  });

  it('blinks no further merely for owning it — undrafted is the base', () => {
    talents().grant('blinkReach', 2);
    const from = playerAt();
    g.blink();
    expect(movedSince(from)).toBeCloseTo(g.config().wizBlinkDistance, 6);
  });

  it('blinks 40 px further with two levels drafted', () => {
    talents().grant('blinkReach', 2);
    talents().draft('blinkReach');
    const from = playerAt();
    g.blink();
    expect(movedSince(from)).toBeCloseTo(g.config().wizBlinkDistance + 40, 6);
  });
});

describe('FOCUS DEPTH raises the ceiling the regen clamps to', () => {
  it('caps at the base pool with nothing drafted', () => {
    stepPast(10 * ONE_SECOND);
    expect(focus().points).toBe(g.config().wizFocusMax);
  });

  it('caps one higher — and the HUD reports it — when drafted', () => {
    talents().grant('focusDepth', 1);
    talents().draft('focusDepth');
    stepPast(10 * ONE_SECOND);
    expect(focus().points).toBe(g.config().wizFocusMax + 1);
    expect(focus().max).toBe(g.config().wizFocusMax + 1);
  });
});

describe('WIDER SKY reaches the storm', () => {
  // The crow is parked between the base radius (450) and the one-level
  // radius (500): the same cast either reaches it or does not, and nothing
  // moves before the cast resolves — the storm damages synchronously.
  const EDGE = 480;

  it('leaves the edge crow alive at the base radius', () => {
    talents().grant('stormWidth', 1);
    parkCrowAt(EDGE);
    g.secondary();
    g.stepSim(1);
    expect((g.crows() as unknown[]).length).toBe(1);
  });

  it('kills the edge crow once the level is drafted', () => {
    talents().grant('stormWidth', 1);
    talents().draft('stormWidth');
    parkCrowAt(EDGE);
    g.secondary();
    g.stepSim(1);
    expect((g.crows() as unknown[]).length).toBe(0);
  });
});

describe('the rite: STORMCALLER', () => {
  it('halves the wait between storms, and only when sealed', () => {
    expect(talents().stormCooldown()).toBe(g.config().stormCooldown);
    talents().sealCapstone('stormcaller');
    expect(talents().stormCooldown()).toBe(g.config().stormCooldown / 2);
  });

  it('lets a sealed wizard cast again after half the base wait', () => {
    talents().sealCapstone('stormcaller');
    g.secondary();
    stepPast(Math.ceil((g.config().stormCooldown / 2 + 0.2) * ONE_SECOND));
    const crow = parkCrowAt(40);
    g.secondary();
    g.stepSim(1);
    expect(crow.hp).toBeLessThanOrEqual(0);
  });
});

describe('the rite: OVERCHANNEL', () => {
  it('swings the broom dry when the capstone is not sealed', () => {
    g.blink();
    setFocus(0);
    g.shoot();
    g.stepSim(1);
    expect(focus().melee).toBe('broom');
  });

  it('casts free from an empty pool inside the window a blink opens', () => {
    talents().sealCapstone('overchannel');
    g.blink();
    expect(g.wizOverchannel() as number).toBeCloseTo(g.config().wizOverchannelSecs, 3);
    setFocus(0);
    g.shoot();
    g.stepSim(1);
    // A bolt in flight from an empty pool is the whole claim: the cast
    // happened and it spent nothing (the sliver below one is regen).
    expect(g.arrows().length).toBe(1);
    expect(focus().points).toBeGreaterThanOrEqual(0);
    expect(focus().spendable).toBe(0);
  });

  it('closes the window: dry casting is the broom again once it expires', () => {
    talents().sealCapstone('overchannel');
    g.blink();
    stepPast(Math.ceil((g.config().wizOverchannelSecs + 0.3) * ONE_SECOND));
    setFocus(0);
    g.shoot();
    g.stepSim(1);
    expect(g.arrows().length, 'no bolt leaves an empty pool').toBe(0);
    expect(focus().melee).toBe('broom');
  });
});

describe('mastery is paid by real milestones', () => {
  it('banks boss_down plus stage_cleared when a stage boss dies for real', () => {
    const before = talents().state().mastery;
    g.spawnBossNow(2);
    g.go('boss_fight');
    const boss = g.boss() as { hp: number; x: number; y: number };
    boss.hp = 1;
    g.blast(boss.x, boss.y);
    // The death sequence runs 1.2 s before the tail pays out and hands off.
    stepPast(Math.ceil(1.5 * ONE_SECOND));
    expect(talents().state().mastery - before).toBe(3);
  });

  it('banks run_won at the one door into the win screen', () => {
    const before = talents().state().mastery;
    g.go('win');
    expect(talents().state().mastery - before).toBe(3);
  });
});

describe('buying goes through the FEATHERS wallet', () => {
  it('refuses an open-tier talent the wallet cannot cover', () => {
    // Tier 1 is open at any rank, so this pins the wallet coupling alone;
    // the mastery gate itself is pinned pure in sim/talents.test.ts.
    const purse = g.feathers() as unknown as { wallet: () => number; spend: (n: number) => void };
    purse.spend(purse.wallet());
    // Ungranted first: an earlier test walked this ladder to its top, and a
    // maxed talent would answer before the wallet got to.
    talents().grant('blinkReach', 0);
    expect(talents().buy('blinkReach').kind).toBe('tooPoor');
  });
});
