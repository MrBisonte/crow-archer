/**
 * Who a fighter aims at.
 *
 * `team.ts` has always known who may damage whom, but nothing ever asked it to
 * choose. Single player never had to: the hero was the only thing on the
 * player's side, so every enemy AI hardcoded it and was right. The bastion map
 * puts allied guards on the field, and the moment an enemy has two things it
 * could attack, "the player" stops being an answer and becomes a decision.
 *
 * This module is that decision and nothing else. It owns no array, keeps no
 * state, and has never heard of crows, skeletons or soldiers: callers pass in
 * the candidates they already have and get back one of their own objects.
 * Staying that narrow is what lets an enemy choosing between a hero and a
 * guard, and a guard choosing between skeletons, be one function instead of
 * two near-identical loops that drift apart the first time one is edited.
 *
 * `battle-world.ts` already has a private `#nearestEnemy` doing this
 * arithmetic for homing shots — the same idea with a respawn filter bolted on.
 * It should end up calling this instead, so the rule lives in one place. That
 * is a change to a live multiplayer loop and it is deliberately not made in
 * the same breath as introducing the file it would call.
 *
 * Pure: no DOM, no randomness, no I/O, nothing that runs at import time. This
 * is called per entity per frame and the simulation has to be replayable.
 */

import { canDamage, type Team } from './team';

/**
 * The minimum a thing must expose to be aimed at or to do the aiming.
 *
 * Three fields rather than a shared entity type, because the callers do not
 * agree on what an entity is: a hero, a guard and a skeleton are different
 * shapes in different files, and a position and a team is all they overlap on.
 * Structural typing means each of them already satisfies this without being
 * told about it. `readonly` says out loud that picking a target never moves
 * anybody — this module answers a question, it does not run a turn.
 */
export interface Targetable {
  readonly x: number;
  readonly y: number;
  readonly team: Team;
}

/**
 * Squared distance between two points, in world pixels squared.
 *
 * Exported because a caller that compares distances at all — "is that closer
 * than my reach", "which of these two is nearer" — should stay in the units
 * this module compares in rather than rooting the answer back out and squaring
 * it again. Deliberately raw arithmetic: it does not validate its inputs, so a
 * non-finite coordinate produces a non-finite result, and the functions below
 * drop those candidates before they ever reach it.
 */
export function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * The nearest candidate the seeker is allowed to damage, or null if there is
 * none.
 *
 * Hostility is `canDamage` from team.ts, imported rather than restated.
 * The rule there is one line today, and re-typing `attacker !== target` here
 * would quietly fork it the first time it stops being one line — co-op, a
 * charmed enemy, a neutral animal. There is one home for who may hit whom and
 * this is not it.
 *
 * Returns the caller's own object, not a copy or an index, so the caller can
 * hold on to it and compare it by identity next frame.
 */
export function nearestHostile<T extends Targetable>(
  seeker: Targetable,
  candidates: readonly T[],
): T | null {
  return nearestWithinLimit(seeker, candidates, Infinity);
}

/**
 * The nearest hostile across several candidate arrays, or null.
 *
 * For a caller whose candidates are permanently in separate lists. The wizard
 * bolt is the one this was written for: crows, skeletons and soldiers are
 * three arrays that are never one array, and a bolt steers at whichever of
 * them is nearest on every frame it is in flight.
 *
 * Composed from `nearestHostile` rather than being a second copy of its loop
 * with an outer `for` around it. That costs one extra `dist2` per group -- at
 * most one per array, not one per body -- and buys the guarantee that the two
 * functions can never disagree about hostility, finiteness or ties, because
 * there is only one place where any of that is decided.
 *
 * Ties resolve by group order first and then by position within the group,
 * which is the array order the caller already has. Same reason as in
 * `nearestHostile`: identical state has to produce an identical pick on every
 * peer and on every replay, so "either one" is not an available answer.
 *
 * Allocates nothing of its own. It is called per homing projectile per
 * frame, so the loop below holds two numbers and builds no list.
 */
export function nearestHostileAmong<T extends Targetable>(
  seeker: Targetable,
  groups: readonly (readonly T[])[],
): T | null {
  let best: T | null = null;
  let bestDist2 = Infinity;

  for (const candidates of groups) {
    const pick = nearestHostile(seeker, candidates);
    if (pick === null) continue;
    // Strictly closer, so the first group to offer a body at a given range
    // keeps it. A seeker with a broken position of its own makes every
    // distance NaN, loses every comparison, and picks nobody -- the same way
    // it already fails inside nearestHostile.
    const d2 = dist2(seeker, pick);
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = pick;
    }
  }

  return best;
}

/**
 * Nearest hostile within `range` world pixels, or null. For AI that only
 * engages what it can actually reach.
 *
 * The boundary is INCLUSIVE: a candidate at exactly `range` is in range. A
 * soldier's `reach` is the distance it stops closing at, so an exclusive
 * boundary would leave it standing at exactly its own reach with nothing to
 * swing at, jittering in and out of range on rounding alone.
 *
 * A negative range means nothing is reachable, and that needs a guard rather
 * than a comment: the comparison happens in squared space, and squaring turns
 * -10 into the same 100 as +10, so an unguarded -10 would read as ten pixels
 * of reach. NaN falls out of the same check. `Infinity` is honest and behaves
 * like `nearestHostile`.
 */
export function nearestHostileWithin<T extends Targetable>(
  seeker: Targetable,
  candidates: readonly T[],
  range: number,
): T | null {
  if (!(range >= 0)) return null;
  return nearestWithinLimit(seeker, candidates, range * range);
}

/**
 * The one loop that both of the above are.
 *
 * Parameterised by a squared cutoff rather than by a "check the range" flag:
 * `Infinity` is a truthful way to say "no cutoff", whereas a boolean here
 * would be two functions sharing a name and a body. The cutoff arrives already
 * squared so it is in the same units as everything it is compared against.
 */
function nearestWithinLimit<T extends Targetable>(
  seeker: Targetable,
  candidates: readonly T[],
  limit2: number,
): T | null {
  let best: T | null = null;
  // Squared distances the whole way down, never Math.hypot. This runs per
  // entity per frame, and the square root is monotonic: it changes what the
  // numbers are, not which one is smallest, so the ordering it buys is the
  // ordering we already had. The price is that callers have to compare in
  // squared units too, which is why dist2 is exported rather than hidden.
  let bestDist2 = Infinity;

  for (const candidate of candidates) {
    // A caller that keeps every fighter in one array will hand us the seeker
    // along with everyone else. Identity, not position: two bodies standing on
    // the same pixel are still two bodies, and only one of them is aiming.
    //
    // Today `canDamage` would reject it on the next line anyway, since nothing
    // is on a different team from itself. Leaning on that was the alternative
    // and it was rejected: it makes "never shoot yourself" an accident of how
    // hostility happens to be defined, and the first friendly-fire mode or
    // charm effect would turn a hero into his own nearest target.
    if (candidate === seeker) continue;
    if (!canDamage(seeker.team, candidate.team)) continue;
    // A body that is mid-teleport, freshly constructed, or the result of a
    // division that went wrong is not a target, it is a bug happening
    // elsewhere. Skipping it keeps this function total: it still returns the
    // nearest of the candidates that make sense instead of returning nothing
    // or, worse, returning the broken one.
    //
    // The comparison below would drop these on its own — NaN loses every
    // comparison it takes part in, and Infinity is never less than the
    // Infinity we start at — but only as a side effect of two choices made for
    // other reasons. Saying it explicitly is what survives someone reseeding
    // `bestDist2` or relaxing `<` to `<=`.
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;

    const d2 = dist2(seeker, candidate);
    if (d2 > limit2) continue;
    // Strictly closer, so an equal distance leaves the incumbent in place and
    // the earliest candidate in the array wins. Ties are not a curiosity here:
    // a symmetric map and grid-aligned spawns produce them constantly. The
    // simulation must produce identical results from identical state — a
    // replay, and every peer in a match, has to pick the same guard on the
    // same tick — so "either one" is not an available answer, and the array
    // order the caller already has is the only tiebreak that needs no extra
    // state and no sorting.
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = candidate;
    }
  }

  // A seeker with a broken position of its own makes every distance NaN and so
  // picks nobody. That is the safe direction to fail in: an AI that stands
  // still is a bug you can see, an AI that charges NaN is one you cannot.
  return best;
}
