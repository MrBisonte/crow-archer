/**
 * Focus: the wizard's pool, and the first resource on the roster that is spent
 * rather than picked up.
 *
 * Everything else a hero has is either a cooldown or a pool that arrives off
 * the ground. Focus is neither, so the things worth pinning here are the ones
 * a cooldown would have got for free: that a spend actually subtracts, that
 * the two spends charge different amounts, that the chained blink is exempt,
 * and that running dry produces the broom rather than nothing at all.
 *
 * Driven through the real firing paths rather than by poking the pool: the
 * question is what a press costs, not what a number does.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { clearArena } from './arena-testkit';
import { devHooks as g } from './game.js';

/**
 * `points` is a real number — Focus climbs a little every frame rather than
 * jumping a whole pip every two seconds — and `spendable` is what that buys,
 * which is the figure most of these assertions want.
 */
interface Focus { points: number; spendable: number; max: number; melee: string }

const focus = (): Focus => g.focus() as unknown as Focus;

/** Sets the pool to an exact number of points, so a spend reads as a subtraction. */
function setFocus(points: number): void {
  (g.inv() as { focus: number }).focus = points;
}

/** One press of the primary, then far enough for the bolt to exist. */
function cast(): void {
  g.shoot();
  g.stepSim(1);
}

beforeEach(() => {
  for (const k of Object.keys(g.keys() as Record<string, boolean>)) {
    (g.keys() as Record<string, boolean>)[k] = false;
  }
  g.takeClock();
  g.pick('wizard');
  g.go('playing');
  g.generateMap('forest');
  // Open ground: a blink refuses a hop with no room, so on a generated map the
  // chain tests would be asking where the trees landed.
  clearArena();
  g.healHero();
  g.stepSim(1);
});

describe('the wizard opens with a full pool', () => {
  it('starts every run at maximum Focus', () => {
    expect(focus().points).toBe(focus().max);
    expect(focus().max).toBe(g.config().wizFocusMax);
  });

  it('banks nothing past the maximum', () => {
    // Otherwise a full pool quietly stores an overflow point that lands the
    // instant he spends one, and the pool is effectively one larger than it
    // says on the HUD.
    g.stepSim(600);
    expect(focus().points).toBe(focus().max);
  });
});

describe('what a cast costs', () => {
  it('spends exactly one point on a bolt', () => {
    const before = focus().points;
    cast();
    expect(focus().points).toBe(before - g.config().wizFocusBolt);
    expect(g.arrows().length).toBe(1);
  });

  it('spends two on a blink, against the bolt’s one', () => {
    setFocus(3);
    g.blink();
    expect(focus().points).toBe(3 - g.config().wizFocusBlink);
    // The asymmetry is the whole design: escaping is dearer than attacking.
    expect(g.config().wizFocusBlink).toBeGreaterThan(g.config().wizFocusBolt);
  });

  it('lets a full pool buy one bolt and one blink', () => {
    // The figure the pool was sized against, so it is worth asserting rather
    // than leaving to arithmetic that could drift out from under it.
    expect(g.config().wizFocusBolt + g.config().wizFocusBlink)
      .toBe(g.config().wizFocusMax);
  });

  it('charges nothing for Lightning Storm', () => {
    setFocus(2);
    g.secondary();
    g.stepSim(1);
    // Compared against what he can spend rather than the raw pool: the step
    // that resolves the cast also regenerates a sliver, so an exact equality
    // here would be asserting that the clock stopped.
    expect(focus().spendable, 'storm keeps its own cooldown and costs no Focus').toBe(2);
  });
});

describe('the chained hop is free', () => {
  it('charges the first blink and not the second', () => {
    setFocus(3);
    g.blink();
    const afterFirst = focus().points;
    expect(afterFirst).toBe(3 - g.config().wizFocusBlink);

    // Inside the chain window, so this is the free hop rather than a new blink.
    g.blink();
    expect(focus().points, 'the chained hop is paid for in skill, not Focus')
      .toBe(afterFirst);
  });

  it('refuses a first blink it cannot afford, without moving him', () => {
    setFocus(g.config().wizFocusBlink - 1);
    const before = { x: g.movementBlockers().x, y: g.movementBlockers().y };
    g.blink();
    expect(g.movementBlockers().x).toBe(before.x);
    expect(g.movementBlockers().y).toBe(before.y);
    expect(focus().points).toBe(g.config().wizFocusBlink - 1);
  });
});

describe('running dry', () => {
  it('swings the broom instead of casting when the pool is empty', () => {
    setFocus(0);
    cast();
    expect(g.arrows().length, 'no bolt leaves an empty pool').toBe(0);
    expect(focus().melee).toBe('broom');
  });

  it('never takes the pool below zero', () => {
    setFocus(0);
    for (let i = 0; i < 5; i++) cast();
    expect(focus().points).toBeGreaterThanOrEqual(0);
    expect(focus().spendable).toBe(0);
  });

  it('gives the broom a longer cooldown than the pitchfork it copies', () => {
    // The broom is a rare save, not a way to fight: a wizard who can hold his
    // own in melee is not a glass cannon.
    expect(g.config().broomCooldownMult).toBeGreaterThan(1);
  });
});

describe('regeneration', () => {
  it('climbs steadily rather than jumping a whole point at a time', () => {
    // The bar used to sit still for two seconds and then jump a pip, which
    // reads as the HUD being stuck. What matters is that it moves *and* that
    // moving smoothly did not change when a cast becomes affordable.
    setFocus(0);
    const readings = [];
    for (let i = 0; i < 5; i++) { g.stepSim(6); readings.push(focus().points); }
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i], 'the pool is higher every tenth of a second')
        .toBeGreaterThan(readings[i - 1]!);
    }
    expect(readings.at(-1), 'and none of that is castable yet').toBeLessThan(1);
  });

  it('becomes spendable at the same moment it always did', () => {
    // The guarantee behind the change: smoother display, identical pacing.
    // Accumulating 1/wizFocusRegenSecs per second crosses 1.0 on the same frame
    // granting a whole point every wizFocusRegenSecs did.
    setFocus(0);
    const secs = g.config().wizFocusRegenSecs;
    g.stepSim(Math.floor(secs * 60) - 2);
    expect(focus().spendable, 'a hair under the interval buys nothing').toBe(0);
    g.stepSim(4);
    expect(focus().spendable).toBe(1);
  });

  it('keeps refilling while he casts, not only while he is idle', () => {
    // Deliberate, and worth pinning: a regeneration that paused while acting
    // would make the pool a second hidden cooldown, and two rates interacting
    // is a balance problem with no single dial to turn.
    //
    // Counted as bolts that actually left, not as points standing in the pool:
    // a hero pressing fire every frame spends each point the instant it lands,
    // so the pool reads zero throughout whether or not it is refilling.
    let bolts = 0;
    g.onEvent((e: { type: string; kind?: string }) => {
      if (e.type === 'WEAPON_FIRED' && e.kind === 'bolt') bolts += 1;
    });
    setFocus(0);
    const secs = g.config().wizFocusRegenSecs;
    const frames = Math.ceil(secs * 3 * 60);
    for (let i = 0; i < frames; i++) { g.shoot(); g.stepSim(1); }
    expect(bolts, 'three regen intervals of held fire should loose about three bolts')
      .toBeGreaterThanOrEqual(2);
  });

  it('stops at the maximum rather than banking past it', () => {
    setFocus(0);
    g.stepSim(60 * 60);
    expect(focus().points).toBe(focus().max);
  });

  it('carries the remainder across a spend instead of dropping it', () => {
    // A whole-point grant threw away whatever fraction was banked when it
    // fired. Holding the pool as a real number keeps it, which is both simpler
    // and slightly kinder: a cast at 1.4 leaves 0.4 toward the next one.
    setFocus(0);
    g.stepSim(Math.ceil(g.config().wizFocusRegenSecs * 60) + 12);
    const before = focus().points;
    expect(before).toBeGreaterThan(1);
    cast();
    expect(focus().points).toBeCloseTo(before - g.config().wizFocusBolt + 1 / 60 / g.config().wizFocusRegenSecs, 3);
  });
});
