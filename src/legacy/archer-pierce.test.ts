/**
 * The power shot's pierce.
 *
 * `archerPowerPierce` is set on the arrow at release and the manual sells it —
 * "pierces up to 3 bodies" — but the only thing that ever read it was the
 * renderer, which draws a pip per body left. The javelin's hit path honoured
 * `pierceLeft`; the ordinary arrow path spliced the arrow on its first contact
 * whatever it was carrying, and a power arrow goes down the ordinary path. So
 * a third of what the hold buys did not exist.
 *
 * Skeletons rather than crows as the bodies. A crow's y is driven by its own
 * flight every step, so a position written onto one is gone by the next frame,
 * and crows spawn beyond the right edge — placing the shooter relative to one
 * puts him off the map and the arrow leaves it before reaching anything.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { clearArena } from './arena-testkit';
import { devHooks as g } from './game.js';

/** Bodies in a line along +x from the hero, closer together than the arrow's reach. */
function lineUp(count: number): void {
  const p = g.player() as { x: number; y: number };
  for (let i = 0; i < count; i++) {
    g.spawnSkeleton();
    const s = (g.skeletons() as { x: number; y: number }[]).at(-1);
    if (s) { s.x = p.x + 30 * (i + 1); s.y = p.y; }
  }
}

/** Looses a fully drawn power shot along +x. */
function fullPowerShot(): void {
  (g.player() as { aimAngle: number }).aimAngle = 0;
  g.shift();
  g.holdDraw(2);      // past archerDrawMaxSecs, so the draw reads as full
  g.shiftUp();
}

beforeEach(() => {
  for (const k of Object.keys(g.keys() as Record<string, boolean>)) {
    (g.keys() as Record<string, boolean>)[k] = false;
  }
  g.takeClock();
  g.pick('archer');
  g.go('playing');
  g.generateMap('forest');
  // Open ground, or the shot is a question about where the generator put its
  // trees: a power arrow spends a pierce charge on the first thing it meets,
  // and a trunk in the lane makes three bodies short of five read as two. This
  // flaked about one run in five before the clear.
  clearArena();
  g.healHero();
  (g.skeletons() as unknown[]).length = 0;
  (g.arrows() as unknown[]).length = 0;
  g.stepSim(1);
});

describe('a fully drawn power shot', () => {
  it('leaves the bow carrying the pierce the config promises', () => {
    fullPowerShot();
    const shot = (g.arrows() as { power?: boolean; pierceLeft?: number }[])[0];
    expect(shot?.power).toBe(true);
    expect(shot?.pierceLeft).toBe(g.config().archerPowerPierce);
  });

  it('passes through every body its pierce pays for', () => {
    // The bug in one assertion: the arrow used to be spliced on first contact,
    // so two of these three walked away from a fully drawn shot.
    lineUp(3);
    fullPowerShot();
    g.stepSim(12);
    expect((g.skeletons() as unknown[]).length).toBe(0);
  });

  it('spends one body of pierce per hit rather than all at once', () => {
    lineUp(3);
    fullPowerShot();
    const opening = (g.arrows() as { pierceLeft?: number }[])[0]?.pierceLeft ?? 0;

    g.stepSim(1);
    const afterFirst = (g.arrows() as { pierceLeft?: number }[])[0];
    expect(afterFirst, 'consumed by the first body it met').toBeDefined();
    expect(afterFirst?.pierceLeft).toBe(opening - 1);
  });

  it('stops once its pierce is spent, rather than clearing the line', () => {
    lineUp(g.config().archerPowerPierce + 2);
    const before = (g.skeletons() as unknown[]).length;

    fullPowerShot();
    g.stepSim(20);

    const killed = before - (g.skeletons() as unknown[]).length;
    expect(killed).toBe(g.config().archerPowerPierce);
  });

  it('is spent on the first body when it was only tapped', () => {
    // A tap gets the bottom of every range, pierce included, so it behaves
    // like an ordinary arrow. That is the decision the key is asking about.
    lineUp(3);
    (g.player() as { aimAngle: number }).aimAngle = 0;
    g.shift();
    g.shiftUp();       // released without holding, so the draw reads as ~0
    g.stepSim(12);
    expect((g.skeletons() as unknown[]).length).toBe(2);
  });
});
