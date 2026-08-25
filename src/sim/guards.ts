/**
 * The hero's retinue on the bastion map: who turns up at the gate, and what
 * surviving a wave is worth to the ones who managed it.
 *
 * The bastion is the map where the hero is not alone. Two guards and one priest
 * stand with him at the start and one more recruit walks in after every wave he
 * holds, so the retinue is a running total the player is trying not to spend
 * rather than a squad he picks. That is the whole reason ranks exist: a guard
 * who has lived through four waves has to be visibly worth more than the one who
 * arrived this morning, or there is nothing to protect and the retinue is just
 * ablative armour.
 *
 * The roster is two lists, not one. Most kinds are recruited — they are what the
 * weighted roll draws from, once at the opening and once per wave held. The
 * priest is not: it is seated once when the siege opens and never rolled for,
 * and if it falls the run continues without it. That distinction is in the
 * types rather than in a comment, so a kind added later cannot be half in the
 * roll by accident; see `RecruitableGuardKind`.
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
 * the knight is the one you are pleased to draw.
 *
 * This is the type `rollGuardKind` returns, and that is the whole point of it
 * existing separately from `GuardKind`. "The priest is never recruited" is not
 * a weight of zero that a future edit could nudge off zero, and not a `!==`
 * check somewhere in the roll that a second caller could forget: the priest is
 * not a member of this union, so a roll that handed one back would not compile.
 */
export type RecruitableGuardKind = 'archer' | 'foot_soldier' | 'knight';

/**
 * The kinds that exist without ever being recruited: seated once when the siege
 * opens, and gone for good if they fall.
 *
 * One member today. It is a union rather than the bare `'priest'` literal so
 * that the two halves of the roster read as two halves of the same decision,
 * and so `startSiege` can seat "the unique kinds" by walking a list instead of
 * naming the priest.
 */
export type UniqueGuardKind = 'priest';

/**
 * Every kind that can stand on the bastion, however it got there.
 *
 * A fifth kind is added to one of the two unions above and nowhere else, which
 * is the forcing function: there is no way to declare a kind without first
 * saying whether the recruit roll can draw it. Adding it here directly would be
 * rejected — this alias has no members of its own.
 */
export type GuardKind = RecruitableGuardKind | UniqueGuardKind;

/** What a kind is made of, before any promotion has touched it. */
export interface GuardStats {
  /** Hits it takes to put down as a fresh recruit. */
  readonly baseHp: number;
  /**
   * Damage per hit as a fresh recruit. Zero for a kind that does not fight at
   * all, which is not the same as a kind that fights badly: `guardDamage` reads
   * this, so a zero here is the single fact that makes a priest harmless, and
   * the loop's refusal to give it a swing is a second lock on the same door.
   */
  readonly baseDamage: number;
  /**
   * Health restored by one use of its heal, as a fresh recruit. Zero for
   * everybody who does not heal.
   *
   * Beside `baseDamage` rather than in a table of its own, because the two are
   * the same kind of fact — what one action of this kind's is worth — and a
   * separate table keyed by the same names is the thing this module keeps
   * refusing to grow.
   */
  readonly baseHeal: number;
  /** Which ladder surviving a wave walks it up, if any. */
  readonly promotion: PromotionTrack;
  /**
   * Whether it fights from range.
   *
   * Nothing in this module reads it. It is here so that the map placing the
   * retinue can tell who belongs on the wall from who belongs at the gate
   * without a second table keyed by the same names. A kind that does not fight
   * is `false`: the question is where its attack comes from, and it has none.
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
  archer: { baseHp: 1, baseDamage: 1, baseHeal: 0, promotion: 'combat', ranged: true },
  // Three hits to put down, so this is the one who is still there at the end
  // of a wave and therefore the one most promotions actually land on.
  foot_soldier: { baseHp: 3, baseDamage: 1, baseHeal: 0, promotion: 'combat', ranged: false },
  // `promotion: 'none'` is deliberate, not an omission. The knight is the rare
  // 20% roll and already comes in doubled on both health and damage, so it
  // starts where the others finish; letting it climb as well would make the
  // roll, not the play, decide how the siege goes. Recorded as a row rather
  // than a rule buried in `promote` precisely so that reversing the decision
  // after playing it is one word on this line.
  knight: { baseHp: 2, baseDamage: 2, baseHeal: 0, promotion: 'none', ranged: false },
  // The healer, and the only member of the retinue that is not rolled for.
  //
  // `baseDamage: 0` is the stat, not an oversight: the priest has no attack at
  // any rank, and `guardDamage` reading this row is what makes an enemy that
  // walks onto it take nothing.
  //
  // 2 hp is the fragility the brief asks for, and 1 was the other candidate.
  // It loses because the priest is unique. An archer at 1 hp is replaced by
  // next wave's recruit; a priest at 1 hp dies to the first crow that clips it
  // and the run has lost the ability for good, usually before wave 3 — a
  // feature that is normally absent by the time the ladder gets hard is a
  // lottery, not a design. At 2 it still dies to two contact hits and still has
  // to be kept behind the line, but it survives one mistake. It is deliberately
  // not the foot soldier's 3: nothing about this body should suggest it can
  // hold a rank.
  priest: { baseHp: 2, baseDamage: 0, baseHeal: 1, promotion: 'ministry', ranged: false },
};

/**
 * Relative weight in the recruit roll, for the kinds that have one.
 *
 * Its own table rather than a field on `GuardStats`, and that is the load-
 * bearing part of the priest's design. As a field it would have to be `0` on
 * the priest's row — a number in a weighted table that must never be drawn,
 * one careless edit away from being drawn, and impossible to tell apart from a
 * kind that was temporarily disabled. Keyed by `RecruitableGuardKind`, the
 * priest cannot have an entry at all: the compiler rejects the row.
 *
 * Weights rather than percentages so that adding a kind does not mean
 * re-tuning every other row to keep a total of 100; `rollGuardKind` sums
 * whatever is here.
 */
export const RECRUIT_WEIGHTS: Record<RecruitableGuardKind, number> = {
  archer: 40,
  foot_soldier: 40,
  knight: 20,
};

/** The kinds the roll can draw, in the order it walks them. */
export const RECRUITABLE_GUARD_KINDS = ['archer', 'foot_soldier', 'knight'] as const satisfies readonly RecruitableGuardKind[];

/**
 * The kinds seated at the opening, in the order they take the field.
 *
 * `startSiege` walks this rather than naming the priest, so a second unique
 * kind is seated by being added here and requires no change to the run.
 */
export const UNIQUE_GUARD_KINDS = ['priest'] as const satisfies readonly UniqueGuardKind[];

/**
 * Every kind, recruited or not.
 *
 * Built from the two lists rather than written out a third time: a kind added
 * to either one appears here without an edit, so the list that everything
 * enumerating the roster is driven off cannot fall behind. `GUARD_STATS` being
 * a `Record` is what guarantees every kind has a row; that these lists mention
 * every kind is guaranteed by a test, because an array cannot state
 * completeness in the type system.
 */
export const GUARD_KINDS = [...RECRUITABLE_GUARD_KINDS, ...UNIQUE_GUARD_KINDS] as const satisfies readonly GuardKind[];

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

/** What one step up a ladder is worth. Every field is an increment, not a total. */
interface RankStep {
  /** Added to max hp, and to current hp along with it, the moment it is reached. */
  readonly maxHp: number;
  /** Added to every hit the guard lands from this rank on. */
  readonly damage: number;
  /** Added to every heal the guard casts from this rank on. */
  readonly heal: number;
}

/**
 * Which ladder a kind climbs, or that it does not climb one.
 *
 * A named track rather than the `promotable: boolean` this replaced, because a
 * boolean could only answer "does it climb", and the answer for the priest is
 * "yes, but not up that". The last step of the fighting ladder is +1 damage,
 * and a priest has none: awarding it would be a rank that grants nothing — a
 * badge that lies about what the guard wearing it can do. Three ranks that pay
 * in health, health and then *healing* is the same promise kept in the currency
 * the unit actually spends.
 *
 * Adding a fourth track is adding a row to `RANK_LADDERS`, which the compiler
 * demands, so a track cannot exist without a ladder to walk.
 */
export type PromotionTrack = 'none' | 'combat' | 'ministry';

/**
 * The promotion ladders, indexed by the rank being reached. Row 0 is the
 * recruit, who has climbed nothing. A `null` ladder is a kind that does not
 * climb at all, which is a different statement from a ladder of empty steps —
 * that one would promote a knight to rank 3 and hand it nothing.
 *
 * `combat` pays two steps of health and then one of damage, in that order on
 * purpose: the early promotions are what keep a guard alive long enough to
 * reach the third, and the third is the one that changes how quickly what is in
 * front of the gate comes down. So a senior foot soldier is 5 hp and 2 damage,
 * and a senior archer is 3 and 2 — the same output from very different
 * survivability, which is what makes losing the foot soldier the loss that
 * hurts.
 *
 * `ministry` keeps the two health steps, deliberately identical to the fighting
 * ladder's: the retinue's seniority should read the same way whoever is wearing
 * it, and on the one unit that cannot be replaced those two steps are the ones
 * that matter most. Only the last step differs, +1 to the single-target heal
 * where a soldier gets +1 damage, so a priest that has held the gate three
 * times mends 2 a cast instead of 1. The area heal is not raised by rank: it is
 * once per wave, and what makes it worth having is the sweep rather than the
 * number, so scaling it too would make one long-lived priest the whole defence.
 *
 * Tables rather than a chain of ifs because retuning this is a numbers edit,
 * and a numbers edit should not mean re-reading the logic that walks it.
 */
const RANK_LADDERS: Record<PromotionTrack, PerRank<RankStep> | null> = {
  none: null,
  combat: [
    { maxHp: 0, damage: 0, heal: 0 },
    { maxHp: 1, damage: 0, heal: 0 },
    { maxHp: 1, damage: 0, heal: 0 },
    { maxHp: 0, damage: 1, heal: 0 },
  ],
  ministry: [
    { maxHp: 0, damage: 0, heal: 0 },
    { maxHp: 1, damage: 0, heal: 0 },
    { maxHp: 1, damage: 0, heal: 0 },
    { maxHp: 0, damage: 0, heal: 1 },
  ],
};

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
 * Whether the priest's once-per-wave area heal is available.
 *
 * Two named states rather than a `wardUsed: boolean`, for the reason the run's
 * outcome is a union: `'ready'` and `'spent'` say what they mean at the call
 * site, where `false` would have to be read against a field name to work out
 * which way round it goes.
 *
 * It is not a cooldown and deliberately not stored as seconds remaining. A
 * cooldown recharges by the clock, which would make the ability worth more on a
 * wave that takes a long time to clear; this one recharges when a wave is
 * cleared and never otherwise, so it is worth exactly one use per wave whether
 * that wave took twenty seconds or two minutes. See `rechargeWard`.
 */
export type WardCharge = 'ready' | 'spent';

/** What every guard carries, whatever it is. */
interface GuardBody {
  /** 0 for a fresh recruit, up to `MAX_RANK`. Only `promote` moves it. */
  rank: number;
  /** Health right now. Wounds carry between waves; promotions heal a little. */
  hp: number;
  /** Health when unhurt, which the ladder raises. */
  maxHp: number;
}

/** One of the fighting kinds on the field. It has no ward to spend. */
export interface CombatGuard extends GuardBody {
  /** Which of the recruited kinds. Fixed for the guard's life. */
  readonly kind: RecruitableGuardKind;
}

/** The priest, which is the only body carrying a ward. */
export interface PriestGuard extends GuardBody {
  readonly kind: 'priest';
  /**
   * The area heal's one charge.
   *
   * On the guard rather than on `SiegeState`, because it is running state of
   * exactly the kind health already is — the loop owns it, it changes between
   * waves and it cannot be recomputed from anything else. Putting it on the run
   * would leave a charge belonging to a priest that may not exist any more, and
   * two things to keep in step instead of one.
   */
  ward: WardCharge;
}

/**
 * One guard on the field.
 *
 * `kind` is fixed at recruitment — a foot soldier does not become a knight,
 * promotion only makes it more of what it is. `rank`, `hp` and `maxHp` are
 * mutable because they are the guard's running state, and health in particular
 * cannot be recomputed from rank: a guard that came out of the last wave on
 * one hit is not the same guard as a fresh one of the same rank. Damage has no
 * such running value, so it is not stored here at all; ask `guardDamage`.
 *
 * A union rather than one record with an optional `ward`, so that reading a
 * ward off an archer does not typecheck and `isPriest` is the only way through.
 * The alternative — one shape, a field that is meaningless on three kinds out
 * of four — is the shape every "is this field set" bug is made of.
 */
export type Guard = CombatGuard | PriestGuard;

/**
 * A fresh recruit of the given kind: rank 0, at full health, ward ready if it
 * has one.
 *
 * The only way to make one, so no caller has to remember that a new guard
 * starts unhurt, that rank counts from zero, or that a priest arrives with its
 * area heal in hand.
 */
export function makeGuard(kind: GuardKind): Guard {
  const stats = GUARD_STATS[kind];
  const body = { rank: 0, hp: stats.baseHp, maxHp: stats.baseHp };
  if (kind === 'priest') return { kind, ...body, ward: 'ready' };
  return { kind, ...body };
}

/**
 * A separate guard with the same state, whatever kind it is.
 *
 * One home for "copy a guard", because the fields worth copying now depend on
 * the kind: a hand-written `{ ...guard }` at a call site is correct today and
 * silently drops the ward the day a second field joins it. `completeWave` is
 * the caller that needs it, and its comment explains why it copies at all.
 */
export function copyGuard(guard: Guard): Guard {
  return { ...guard };
}

/**
 * Which kind walks in as the next recruit. Weighted by `RECRUIT_WEIGHTS`; `rng`
 * returns [0, 1).
 *
 * The return type is `RecruitableGuardKind`, not `GuardKind`, and that is the
 * enforcement of "the priest is never recruited". It is not checked here at
 * all: there is no row to draw, no weight to be nudged off zero, and a caller
 * that tried to treat the result as a possible priest would be told by the
 * compiler that it cannot be one.
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
export function rollGuardKind(rng: Rng): RecruitableGuardKind {
  let pool = 0;
  for (const kind of RECRUITABLE_GUARD_KINDS) pool += RECRUIT_WEIGHTS[kind];

  let ticket = rng() * pool;
  let drawn: RecruitableGuardKind = RECRUITABLE_GUARD_KINDS[0];
  for (const kind of RECRUITABLE_GUARD_KINDS) {
    drawn = kind;
    ticket -= RECRUIT_WEIGHTS[kind];
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
  const ladder = RANK_LADDERS[GUARD_STATS[guard.kind].promotion];
  if (ladder === null) return false;

  const step = ladder[guard.rank + 1];
  if (step === undefined) return false;

  guard.rank += 1;
  guard.maxHp += step.maxHp;
  guard.hp += step.maxHp;
  return true;
}

/**
 * What the guard has climbed to on one axis of its own ladder, in total.
 *
 * Takes the field rather than the caller, which is what keeps `guardDamage` and
 * `guardHeal` from being the same eight lines twice: they differ in which
 * column of the ladder they sum and in nothing else, so the column is the
 * parameter. A kind whose track is `'none'` has climbed nothing on every axis.
 */
function climbed(guard: Guard, field: keyof RankStep): number {
  const ladder = RANK_LADDERS[GUARD_STATS[guard.kind].promotion];
  if (ladder === null) return 0;
  return ladder.slice(1, guard.rank + 1).reduce((total, step) => total + step[field], 0);
}

/**
 * Damage the guard deals right now, seniority included. Zero for a priest at
 * every rank, because its row is zero and its ladder pays in healing.
 *
 * Derived from rank on every call instead of stored on the guard, because
 * unlike health there is no running value to keep: a guard's damage is always
 * exactly what its kind and rank say it is, and a stored copy would be one
 * more thing `promote` could forget to update. Summing the steps climbed also
 * means the ladder is read the same way here as it is written above.
 */
export function guardDamage(guard: Guard): number {
  return GUARD_STATS[guard.kind].baseDamage + climbed(guard, 'damage');
}

/**
 * Health one of the guard's single-target heals restores right now, seniority
 * included. Zero for everybody who does not heal, by the same route damage is
 * zero for the priest — the row says so and the ladder adds nothing to it.
 *
 * Deliberately the mirror of `guardDamage` rather than a priest-only function:
 * the caller asks a guard what its action is worth, and the kinds that answer
 * zero are answering honestly rather than being excluded from the question.
 */
export function guardHeal(guard: Guard): number {
  return GUARD_STATS[guard.kind].baseHeal + climbed(guard, 'heal');
}

/**
 * How much health the area heal restores to each ally it reaches.
 *
 * Three, which is a whole foot soldier and one and a half archers, because the
 * moment it exists for is a retinue that is coming apart — a sweep worth less
 * than a body would be a cooldown heal with extra steps. It does not scale with
 * rank; see `RANK_LADDERS`.
 */
export const WARD_HEAL = 3;

/**
 * How many hurt allies it takes before the priest spends its one charge.
 *
 * Two, because one hurt ally is what the single-target heal is for and burning
 * a once-per-wave ability on it would leave the priest empty-handed for the
 * moment the wave actually breaks. Two is also the earliest point at which the
 * sweep beats the cooldown heal outright: at one target the two are worth 3 and
 * 1, at two targets they are worth 6 and 1, and at that ratio holding on for a
 * third is greed rather than judgement — a priest saving for a perfect moment
 * dies with the charge unspent, which is the failure mode that made "wait for
 * three" the wrong rule.
 *
 * The count is taken over the allies the sweep would actually reach, not over
 * the whole retinue; see `shouldWard`.
 */
export const WARD_TRIGGER_HURT = 2;

/** How far below its maximum the guard is, never negative. */
export function missingHp(guard: Guard): number {
  return Math.max(0, guard.maxHp - guard.hp);
}

/** Whether the guard has anything worth healing. */
export function isHurt(guard: Guard): boolean {
  return missingHp(guard) > 0;
}

/**
 * Restores up to `amount` health, never past the guard's maximum. Returns how
 * much was actually restored, which is 0 for a guard that was already whole.
 *
 * The clamp lives here rather than at the call sites, so "a heal never
 * overheals" is one rule rather than one per caller — and the return value is
 * what lets a caller tell a heal that landed from one that was wasted without
 * reading hp before and after.
 *
 * A negative `amount` restores nothing rather than wounding. A heal that can
 * subtract is a second damage path that no damage bookkeeping would ever see.
 */
export function healGuard(guard: Guard, amount: number): number {
  const restored = Math.min(Math.max(0, amount), missingHp(guard));
  guard.hp += restored;
  return restored;
}

/** Whether this guard is the priest, and the only way to reach a `ward`. */
export function isPriest(guard: Guard): guard is PriestGuard {
  return guard.kind === 'priest';
}

/**
 * The allies one ward would cover, with the priest always among them.
 *
 * The priest heals itself as well as everyone around it, and this is where that
 * decision is enforced rather than left to whether a caller remembered to
 * include it in the list it passed. The reasoning: the priest is the one guard
 * the run cannot replace, so an ability that skips it turns "protect the
 * healer" into the only strategy the map has. Being in its own blessing costs
 * the sweep nothing when the priest is whole, because `healGuard` restores
 * nothing to a guard at full health.
 */
function congregation(priest: PriestGuard, inRadius: readonly Guard[]): readonly Guard[] {
  return inRadius.includes(priest) ? inRadius : [priest, ...inRadius];
}

/**
 * Whether the priest should spend its one charge on the allies it can reach.
 *
 * `inRadius` is who the sweep would land on — the caller owns distance, this
 * module owns the rule. Counting hurt allies over the reachable set rather than
 * over the whole retinue is the difference between an ability that fires when
 * the fight in front of the priest is going badly and one that fires because
 * two guards are bleeding on the far side of the bastion where it cannot help
 * them.
 */
export function shouldWard(priest: PriestGuard, inRadius: readonly Guard[]): boolean {
  if (priest.ward !== 'ready') return false;
  return congregation(priest, inRadius).filter(isHurt).length >= WARD_TRIGGER_HURT;
}

/**
 * Spends the charge and heals everyone the sweep reaches by `WARD_HEAL`.
 * Returns the health actually restored across all of them.
 *
 * The charge is spent first and unconditionally, so a ward that reached nobody
 * worth healing is still a ward that was used. That is deliberate: making the
 * spend conditional on the healing landing would mean a caller could invoke it
 * every frame at no cost until it happened to be worth something, which is not
 * an ability with one use per wave.
 */
export function invokeWard(priest: PriestGuard, inRadius: readonly Guard[]): number {
  priest.ward = 'spent';
  let restored = 0;
  for (const guard of congregation(priest, inRadius)) restored += healGuard(guard, WARD_HEAL);
  return restored;
}

/**
 * Hands the ward back, if this guard has one. A no-op for everybody else, so
 * the caller sweeping a retinue does not have to ask what each body is.
 *
 * Called when a wave is cleared and at no other time — that is what makes the
 * ability once *per wave* rather than once per some number of seconds.
 */
export function rechargeWard(guard: Guard): void {
  if (isPriest(guard)) guard.ward = 'ready';
}

/**
 * How many guards are rolled from the weighted table when a siege opens.
 *
 * Two, because one companion reads as an escort that the player will not risk,
 * and because the first recruit after wave 1 is then a visible half again as
 * many rather than a rounding error. It is also the number the first wave is
 * balanced against: the bastion is meant to be held on the opening wave
 * without spending anybody.
 *
 * Renamed from `STARTING_GUARDS`, which stopped being true the moment the
 * priest was seated on top of the roll: the hero now starts with three guards
 * and two of them are recruits. The old name would have gone on reading like
 * the size of the opening retinue, which is `OPENING_RETINUE` below.
 */
export const STARTING_RECRUITS = 2;

/**
 * How many guards stand on the field when a siege opens: the rolled recruits
 * plus one of each unique kind.
 *
 * Derived rather than written as `3`, so seating a second unique kind is one
 * entry in `UNIQUE_GUARD_KINDS` and not also an arithmetic edit here and in
 * every test that counts the opening retinue.
 */
export const OPENING_RETINUE = STARTING_RECRUITS + UNIQUE_GUARD_KINDS.length;
