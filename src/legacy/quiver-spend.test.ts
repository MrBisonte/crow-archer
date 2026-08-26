/**
 * Which shaft leaves the quiver first.
 *
 * The archer and the ranger draw on the same three pools by design, and until
 * `spendShaft` this rule was written out three times — once per firing path.
 * Three copies of a priority is how the two of them come to disagree about it
 * without anyone deciding they should, so it is pinned here rather than left
 * to whichever copy a reader happens to open.
 *
 * Driven through the real firing paths rather than by calling the helper: the
 * point is what a press actually spends, not what a function returns.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { devHooks as g } from './game.js';

type Quiver = { arrows: number; ricochetArrows: number; fireArrows: number };

const quiver = (): Quiver => g.inv() as unknown as Quiver;

/** Loads the quiver with an exact hand, so a spend is readable as a subtraction. */
function load(arrows: number, ricochet: number, fire: number): void {
  const inv = quiver();
  inv.arrows = arrows;
  inv.ricochetArrows = ricochet;
  inv.fireArrows = fire;
}

/** One press, then far enough for the arrow to exist. */
function loose(): void {
  g.shoot();
  g.stepSim(1);
}

beforeEach(() => {
  g.takeClock();
  g.pick('archer');
  g.go('playing');
  g.generateMap('forest');
  g.healHero();
  g.stepSim(1);
});

describe('the quiver spends its best shaft first', () => {
  it('takes a fire arrow while any remain', () => {
    load(5, 5, 2);
    loose();
    expect(quiver()).toMatchObject({ arrows: 5, ricochetArrows: 5, fireArrows: 1 });
    expect(g.arrows()[0]?.type).toBe('fire');
  });

  it('falls to ricochet once the fire arrows are gone, not to plain', () => {
    load(5, 2, 0);
    loose();
    expect(quiver()).toMatchObject({ arrows: 5, ricochetArrows: 1, fireArrows: 0 });
    expect(g.arrows()[0]?.type).toBe('ricochet');
  });

  it('takes a plain arrow only when nothing better is left', () => {
    load(3, 0, 0);
    loose();
    expect(quiver()).toMatchObject({ arrows: 2, ricochetArrows: 0, fireArrows: 0 });
    expect(g.arrows()[0]?.type).toBe('normal');
  });

  it('spends nothing at all on an empty quiver', () => {
    load(0, 0, 0);
    loose();
    expect(quiver()).toMatchObject({ arrows: 0, ricochetArrows: 0, fireArrows: 0 });
    // He swings the pitchfork instead; what matters here is that no shaft was
    // conjured and no pool went negative.
    expect(g.arrows().length).toBe(0);
  });

  it('spends the same order for the ranger, who shares the quiver', () => {
    // The whole reason the priority has one home: two characters, three
    // firing paths, and nothing else keeping them agreed.
    g.pick('ranger');
    g.go('playing');
    g.generateMap('forest');
    g.healHero();
    g.stepSim(1);
    load(5, 5, 2);
    loose();
    expect(quiver()).toMatchObject({ arrows: 5, ricochetArrows: 5, fireArrows: 1 });
    // One press, one shaft, three bolts on the field.
    expect(g.arrows().every((a: { type: string }) => a.type === 'fire')).toBe(true);
  });
});
