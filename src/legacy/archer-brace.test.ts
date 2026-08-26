/**
 * Brace: what the archer buys by standing still.
 *
 * He is the only hero with no reason to be near anything, and the bill for
 * that is the smallest hit per press on the roster. Brace is where it is paid
 * back, so the two halves that matter are that it only accrues while he is
 * genuinely still, and that it reaches the arrows.
 *
 * Driven headlessly through devHooks, the way game.test.ts does: nothing here
 * needs a canvas.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { devHooks as g } from './game.js';

/** The live key map, which is what the movement code actually reads. */
const keys = (): Record<string, boolean> => g.keys() as Record<string, boolean>;

function clearKeys(): void {
  for (const k of Object.keys(keys())) keys()[k] = false;
}

/** A fresh archer, standing in a playable map with a full health bar. */
beforeEach(() => {
  clearKeys();
  g.takeClock();
  g.pick('archer');
  g.go('playing');
  g.generateMap('forest');
  g.respawnPlayer();
  g.healHero();
  g.stepSim(1);
});

describe('the archer braces by standing still', () => {
  it('fills while he holds position', () => {
    expect(g.brace().level).toBeLessThan(0.2);
    // A little longer than braceFillSecs at the fixed step, so it reaches full.
    g.stepSim(90);
    expect(g.brace().level).toBe(1);
  });

  it('drains faster than it fills once he walks', () => {
    g.stepSim(90);
    expect(g.brace().level).toBe(1);

    keys()['ArrowRight'] = true;
    g.stepSim(20);
    const walked = g.brace().level;
    clearKeys();

    // Twenty steps of walking has cost more than twenty steps of standing
    // still earned, which is the whole shape of the trade: a stance cannot be
    // banked and carried somewhere.
    expect(walked).toBeLessThan(1);
    g.stepSim(20);
    expect(g.brace().level).toBeGreaterThan(walked);
  });

  it('multiplies what an arrow is worth against a boss, and only then', () => {
    // Unbraced and braced are the two ends of the same number the arrows read.
    keys()['ArrowRight'] = true;
    g.stepSim(30);
    clearKeys();
    const loose = g.brace().bossMult;

    g.stepSim(90);
    const set = g.brace().bossMult;

    expect(loose).toBeCloseTo(1, 1);
    expect(set).toBeGreaterThan(loose);
    expect(set).toBe(g.config().braceBossMult);
  });

  it('puts the brace on the arrow that leaves the bow', () => {
    g.stepSim(90);
    expect(g.brace().level).toBe(1);

    g.shoot();
    g.stepSim(1);
    const shot = g.arrows()[0];
    expect(shot).toBeDefined();
    expect(shot?.dmgMult).toBe(g.config().braceBossMult);
  });

  it('does not carry into the next run', () => {
    // initGame clears it with the rest of the per-run state. Not a nicety: the
    // level is a live multiplier on damage, so a run that opened already
    // braced would open hitting a boss for nearly twice a plain arrow.
    g.stepSim(90);
    expect(g.brace().level).toBe(1);
    g.go('playing');
    expect(g.brace().level).toBe(0);
  });
});
