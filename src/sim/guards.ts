/**
 * The hero's retinue on the bastion map: who turns up at the gate, and what
 * surviving a wave is worth to the ones who managed it.
 *
 * The bastion is the map where the hero is not alone. Two guards stand with
 * him at the start and one more recruit walks in after every wave he holds, so
 * the retinue is a running total the player is trying not to spend rather than
 * a squad he picks. That is the whole reason ranks exist: a guard who has
 * lived through four waves has to be visibly worth more than the one who
 * arrived this morning, or there is nothing to protect and the retinue is just
 * ablative armour.
 *
 * Pure. Nothing here touches the DOM, calls Math.random, or knows what a frame
 * is — the recruit roll takes its randomness as an argument so that a bastion
 * run replays the same retinue from the same seed, the way maps already do.
 * Bodies, sprites and the walk to the wall live with the rest of the rendering;
 * what lives here is the part worth pinning down in a test.
 */

import type { Rng } from './rng';

/**
 * The three who answer the call.
 *
 * They are not three skins on one guard: the archer is the one who is useful
 * from behind the wall, the foot soldier is the one who can stand on it, and
 * the knight is the one you are pleased to draw. A fourth kind is a row in
 * `GUARD_STATS` and an entry in `GUARD_KINDS`, and the compiler refuses the
 * row until it is complete.
 */
export type GuardKind = 'archer' | 'foot_soldier' | 'knight';

/** What a kind is made of, before any promotion has touched it. */
export interface GuardStats {
  /** Hits it takes to put down as a fresh recruit. */
  readonly baseHp: number;
  /** Damage per hit as a fresh recruit. */
  readonly baseDamage: number;
  /**
   * Relative weight in the recruit roll.
   *
   * Weights rather than percentages so that adding a kind does not mean
   * re-tuning every other row to keep a total of 100; `rollGuardKind` sums
   * whatever is here.
   */
  readonly weight: number;
  /** Whether surviving a wave moves it up the ladder at all. */
  readonly promotable: boolean;
  /**
   * Whether it fights from range.
   *
   * Nothing in this module reads it. It is here so that the map placing the
   * retinue can tell who belongs on the wall from who belongs at the gate
   * without a second table keyed by the same three names.
   */
  readonly ranged: boolean;
}

/**
 * What each kind is made of. One row per kind, and the compiler will not build
 * a fourth kind without one.
 *
 * The rows trade off rather than dominate each other: the archer is frail and
 * shoots, the foot soldier is the one who survives, and the knight is the rare
 * draw that hits twice as hard as either.
 */
export const GUARD_STATS: Record<GuardKind, GuardStats> = {
  // The one you want on the wall and never in front of it.
  archer: { baseHp: 1, baseDamage: 1, weight: 40, promotable: true, ranged: true },
  // Three hits to put down, so this is the one who is still there at the end
  // of a wave and therefore the one most promotions actually land on.
  foot_soldier: { baseHp: 3, baseDamage: 1, weight: 40, promotable: true, ranged: false },
  // `promotable: false` is deliberate, not an omission. The knight is the rare
  // 20% roll and already comes in doubled on both health and damage, so it
  // starts where the others finish; letting it climb as well would make the
  // roll, not the play, decide how the siege goes. Recorded as a row rather
  // than a rule buried in `promote` precisely so that reversing the decision
  // after playing it is one word on this line.
  knight: { baseHp: 2, baseDamage: 2, weight: 20, promotable: false, ranged: false },
};

/**
 * The three of them, in the order the recruit roll walks them.
 *
 * Exported so callers and tests enumerate the kinds instead of retyping them.
 * `GUARD_STATS` being a `Record` is what guarantees every kind has a row; that
 * this list mentions every kind is guaranteed by a test, because an array
 * cannot state completeness in the type system.
 */
export const GUARD_KINDS = ['archer', 'foot_soldier', 'knight'] as const satisfies readonly GuardKind[];

/**
 * A table with exactly one entry per rank, the rank-0 recruit included.
 *
 * Both rank tables below are shaped by it, so a fourth rank cannot be added to
 * the ladder without also being given an insignia to wear. The length is the
 * rule, and the compiler enforces it rather than a comment asking nicely.
 */
type PerRank<T> = readonly [T, T, T, T];

/**
 * Three ranks and no more.
 *
 * The cap is low because the retinue is the long game: a guard that kept
 * climbing would make one lucky early recruit worth more than everything the
 * player does for the rest of the siege. Exported for the HUD and for callers
 * deciding whether a survivor is already at the top — `promote` itself does
 * not read it, it stops when the ladder runs out of rows, so the number and
 * the ladder cannot come to disagree about where the top is.
 */
export const MAX_RANK = 3;

/** What one step up the ladder is worth. Both fields are increments, not totals. */
interface RankStep {
  /** Added to max hp, and to current hp along with it, the moment it is reached. */
  readonly maxHp: number;
  /** Added to every hit the guard lands from this rank on. */
  readonly damage: number;
}

/**
 * The promotion ladder, indexed by the rank being reached. Row 0 is the
 * recruit, who has climbed nothing.
 *
 * Two steps of health and then one of damage, in that order on purpose: the
 * early promotions are what keep a guard alive long enough to reach the third,
 * and the third is the one that changes how quickly what is in front of the
 * gate comes down. So a senior foot soldier is 5 hp and 2 damage, and a senior
 * archer is 3 and 2 — the same output from very different survivability, which
 * is what makes losing the foot soldier the loss that hurts.
 *
 * A table rather than a chain of ifs because retuning this is a numbers edit,
 * and a numbers edit should not mean re-reading the logic that walks it.
 */
const RANK_LADDER: PerRank<RankStep> = [
  { maxHp: 0, damage: 0 },
  { maxHp: 1, damage: 0 },
  { maxHp: 1, damage: 0 },
  { maxHp: 0, damage: 1 },
];

/**
 * Rank insignia, indexed by rank: nothing for a recruit, then a star per
 * promotion.
 *
 * Stars rather than a printed number because the HUD draws the retinue as a
 * row of small figures with no room for a legend, and because a row of stars
 * is comparable at a glance in a way that digits are not. Three characters is
 * as wide as this can ever get, which is one of the things the cap buys.
 */
export const RANK_MARK: PerRank<string> = ['', '*', '**', '***'];

/**
 * One guard on the field.
 *
 * `kind` is fixed at recruitment — a foot soldier does not become a knight,
 * promotion only makes it more of what it is. `rank`, `hp` and `maxHp` are
 * mutable because they are the guard's running state, and health in particular
 * cannot be recomputed from rank: a guard that came out of the last wave on
 * one hit is not the same guard as a fresh one of the same rank. Damage has no
 * such running value, so it is not stored here at all; ask `guardDamage`.
 */
export interface Guard {
  /** Which of the three. Fixed for the guard's life. */
  readonly kind: GuardKind;
  /** 0 for a fresh recruit, up to `MAX_RANK`. Only `promote` moves it. */
  rank: number;
  /** Health right now. Wounds carry between waves; promotions heal a little. */
  hp: number;
  /** Health when unhurt, which the ladder raises. */
  maxHp: number;
}

/**
 * A fresh recruit of the given kind: rank 0, at full health.
 *
 * The only way to make one, so no caller has to remember that a new guard
 * starts unhurt or that rank counts from zero.
 */
export function makeGuard(kind: GuardKind): Guard {
  const stats = GUARD_STATS[kind];
  return { kind, rank: 0, hp: stats.baseHp, maxHp: stats.baseHp };
}

/**
 * Which kind walks in as the next recruit. Weighted by `weight`; `rng` returns
 * [0, 1).
 *
 * The pool is summed here on every roll rather than kept as a constant, so the
 * weights stay the only place the shares are written down and no stored total
 * can fall out of step with them. Three additions once a wave is not a cost
 * worth trading that guarantee for, and it keeps the module free of anything
 * that runs at import.
 *
 * The loop takes the kind it is currently examining before testing the ticket,
 * which means an rng that returns its ceiling — out of contract, or a rounding
 * artefact on the last row — ends the walk holding the last kind. The caller
 * gets a guard rather than an `undefined` that only surfaces three waves later.
 */
export function rollGuardKind(rng: Rng): GuardKind {
  let pool = 0;
  for (const kind of GUARD_KINDS) pool += GUARD_STATS[kind].weight;

  let ticket = rng() * pool;
  let drawn: GuardKind = GUARD_KINDS[0];
  for (const kind of GUARD_KINDS) {
    drawn = kind;
    ticket -= GUARD_STATS[kind].weight;
    if (ticket < 0) break;
  }
  return drawn;
}

/**
 * Promotes a guard in place for surviving a wave, if its kind can be promoted
 * and it is not already at the top. Returns whether a promotion happened, so
 * the caller can announce the ones that did without re-deriving the rule.
 *
 * The cap is a missing ladder row rather than a comparison against `MAX_RANK`:
 * asking the ladder for the next rank and finding nothing there is the same
 * question, and it cannot be the answer to a different one after somebody
 * edits the table.
 *
 * Current health rises with max health, so a promotion is felt in the wave it
 * is earned rather than the next time something heals. It is a step, not a
 * full heal — a guard that finished the wave on its last hit comes out of the
 * ceremony on two.
 */
export function promote(guard: Guard): boolean {
  if (!GUARD_STATS[guard.kind].promotable) return false;

  const step = RANK_LADDER[guard.rank + 1];
  if (step === undefined) return false;

  guard.rank += 1;
  guard.maxHp += step.maxHp;
  guard.hp += step.maxHp;
  return true;
}

/**
 * Damage the guard deals right now, seniority included.
 *
 * Derived from rank on every call instead of stored on the guard, because
 * unlike health there is no running value to keep: a guard's damage is always
 * exactly what its kind and rank say it is, and a stored copy would be one
 * more thing `promote` could forget to update. Summing the steps climbed also
 * means the ladder is read the same way here as it is written above.
 */
export function guardDamage(guard: Guard): number {
  const base = GUARD_STATS[guard.kind].baseDamage;
  return RANK_LADDER.slice(1, guard.rank + 1).reduce((total, step) => total + step.damage, base);
}

/**
 * How many guards the hero starts a siege with.
 *
 * Two, because one companion reads as an escort that the player will not risk,
 * and because the first recruit after wave 1 is then a visible half again as
 * many rather than a rounding error. It is also the number the first wave is
 * balanced against: the bastion is meant to be held on the opening wave
 * without spending anybody.
 */
export const STARTING_GUARDS = 2;
