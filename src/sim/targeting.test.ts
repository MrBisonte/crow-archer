import { describe, expect, it } from 'vitest';

import { dist2, nearestHostile, nearestHostileWithin, type Targetable } from './targeting';
import { Team } from './team';

/** Named so a failed assertion says who got picked instead of dumping numbers. */
interface Body extends Targetable {
  readonly name: string;
}

const at = (name: string, x: number, y: number, team: Team): Body => ({ name, x, y, team });

describe('nearestHostile', () => {
  // The whole bastion feature rests on this one: guards stand between the hero
  // and the enemies, so a hero who can target a guard is a hero who shoots his
  // own escort in the back.
  it('never picks a same-team candidate, however close it stands', () => {
    const hero = at('hero', 0, 0, Team.A);
    const guard = at('guard', 1, 0, Team.A);
    const skeleton = at('skeleton', 500, 0, Team.ENEMY);

    expect(nearestHostile(hero, [guard, skeleton])).toBe(skeleton);
  });

  it('an enemy picks the nearer of the hero and a guard', () => {
    const skeleton = at('skeleton', 0, 0, Team.ENEMY);
    const hero = at('hero', 100, 0, Team.A);
    const guard = at('guard', 30, 0, Team.A);

    expect(nearestHostile(skeleton, [hero, guard])).toBe(guard);
    // Distance decides it, not the order the caller happened to build the list in.
    expect(nearestHostile(skeleton, [guard, hero])).toBe(guard);
  });

  it('returns null for an empty candidate list', () => {
    expect(nearestHostile(at('skeleton', 0, 0, Team.ENEMY), [])).toBeNull();
  });

  it('returns null when every candidate is on the same team as the seeker', () => {
    const hero = at('hero', 0, 0, Team.A);
    const guards = [at('guard1', 10, 0, Team.A), at('guard2', 0, 20, Team.A)];

    expect(nearestHostile(hero, guards)).toBeNull();
  });

  // Determinism, not neatness: a replay and every peer in a match must pick the
  // same target from the same state, so an exact tie has to have one answer.
  it('resolves an exact tie to the earliest candidate in the array', () => {
    const skeleton = at('skeleton', 0, 0, Team.ENEMY);
    const left = at('left', -40, 0, Team.A);
    const right = at('right', 40, 0, Team.A);
    // Not merely close: the same float, so nothing below is rounding luck.
    expect(dist2(skeleton, left)).toBe(dist2(skeleton, right));

    expect(nearestHostile(skeleton, [left, right])).toBe(left);
    // Reversing the array reverses the answer, which is what makes it the
    // array order deciding rather than something incidental about the bodies.
    expect(nearestHostile(skeleton, [right, left])).toBe(right);
  });

  // A caller that keeps every fighter in one flat array hands the seeker in
  // with the rest. Note that `canDamage` alone would also reject it, so this
  // pins the guarantee rather than the branch: if friendly fire ever becomes a
  // mode, this test is what stops a hero becoming his own nearest target.
  it('never returns the seeker itself when it appears among the candidates', () => {
    const hero = at('hero', 0, 0, Team.A);
    const skeleton = at('skeleton', 300, 0, Team.ENEMY);

    expect(nearestHostile(hero, [hero, skeleton])).toBe(skeleton);
    expect(nearestHostile(hero, [hero])).toBeNull();
  });

  it('skips a candidate with NaN coordinates', () => {
    const skeleton = at('skeleton', 0, 0, Team.ENEMY);
    const broken = at('broken', Number.NaN, Number.NaN, Team.A);
    const hero = at('hero', 900, 0, Team.A);

    expect(nearestHostile(skeleton, [broken, hero])).toBe(hero);
    expect(nearestHostile(skeleton, [broken])).toBeNull();
  });

  it('skips a candidate with an infinite coordinate', () => {
    const skeleton = at('skeleton', 0, 0, Team.ENEMY);
    const hero = at('hero', 900, 0, Team.A);

    expect(nearestHostile(skeleton, [at('far', Infinity, 0, Team.A), hero])).toBe(hero);
    expect(nearestHostile(skeleton, [at('far', 0, -Infinity, Team.A)])).toBeNull();
  });

  it('checks both axes, not just x', () => {
    const skeleton = at('skeleton', 0, 0, Team.ENEMY);
    const halfBroken = at('halfBroken', 5, Number.NaN, Team.A);
    const hero = at('hero', 900, 0, Team.A);

    expect(nearestHostile(skeleton, [halfBroken, hero])).toBe(hero);
  });

  // Failing towards "stand still" rather than "charge NaN".
  it('returns null when the position of the seeker itself is broken', () => {
    const lost = at('lost', Number.NaN, 0, Team.ENEMY);

    expect(nearestHostile(lost, [at('hero', 0, 0, Team.A)])).toBeNull();
  });
});

describe('nearestHostileWithin', () => {
  const guard = at('guard', 0, 0, Team.A);

  it('returns null when the only hostile is outside range', () => {
    const skeleton = at('skeleton', 41, 0, Team.ENEMY);

    expect(nearestHostileWithin(guard, [skeleton], 40)).toBeNull();
  });

  // The boundary is inclusive: at exactly `range` the target is in range. A
  // soldier stops at its reach, so exclusive would leave it unable to swing at
  // the spot it deliberately walked to.
  it('returns a hostile sitting exactly on the boundary', () => {
    const skeleton = at('skeleton', 40, 0, Team.ENEMY);

    expect(nearestHostileWithin(guard, [skeleton], 40)).toBe(skeleton);
  });

  it('picks the nearest of the hostiles that are in range', () => {
    const near = at('near', 0, 30, Team.ENEMY);
    const far = at('far', 39, 0, Team.ENEMY);
    const outside = at('outside', 200, 0, Team.ENEMY);

    expect(nearestHostileWithin(guard, [far, near, outside], 40)).toBe(near);
  });

  it('still refuses same-team candidates inside the range', () => {
    const hero = at('hero', 5, 0, Team.A);

    expect(nearestHostileWithin(guard, [hero], 40)).toBeNull();
  });

  // Squaring would turn a negative range into a positive reach, so the guard
  // that stops that is worth an assertion of its own.
  it('treats a negative or NaN range as no reach at all', () => {
    const skeleton = at('skeleton', 5, 0, Team.ENEMY);

    expect(nearestHostileWithin(guard, [skeleton], -10)).toBeNull();
    expect(nearestHostileWithin(guard, [skeleton], Number.NaN)).toBeNull();
    // Zero reach is still a real reach: something on top of you is in it.
    expect(nearestHostileWithin(guard, [at('onTop', 0, 0, Team.ENEMY)], 0)).not.toBeNull();
  });
});

describe('dist2', () => {
  it('returns the square of the distance, not the distance', () => {
    expect(dist2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
    expect(dist2({ x: 0, y: 0 }, { x: 3, y: 4 })).not.toBe(5);
  });

  it('is symmetric and zero at a point', () => {
    expect(dist2({ x: 7, y: -2 }, { x: -3, y: 5 })).toBe(dist2({ x: -3, y: 5 }, { x: 7, y: -2 }));
    expect(dist2({ x: 7, y: -2 }, { x: 7, y: -2 })).toBe(0);
  });
});
