/**
 * The bastion's siege: ten waves, written out, and then it is over.
 *
 * Waves mode escalates off a rule and runs until you die, which is the right
 * shape for a score. A siege is the other shape: it has a last wave, so it can
 * be *won*, and that means the run has to be authored rather than generated.
 * soldiers.ts ramps its garrison from a band table because any composition it
 * produces is a fine composition; the bastion cannot do that, because its whole
 * promise is that everything in the game turns up before the gate holds or
 * falls, and a generated ramp only keeps that promise by accident.
 *
 * So the ladder is a literal table, one row per wave, and the promise is a test
 * next door that walks `ENEMY_KINDS` and `BOSS_KINDS` and fails if the ladder
 * has left anybody out. Adding a new enemy to the bestiary breaks that test
 * until the new enemy is given a wave, which is the point: "every critter comes"
 * stops being an intention and becomes something the build checks.
 *
 * The waves also teach in order. One kind at a time for three waves, so each is
 * met on its own and the answer to it can be learned; pairs for three more, so
 * two answers have to be held at once; then bosses, each arriving with the
 * rabble that has already been survived separately.
 *
 * Pure. No DOM, no rng, no game state, and nothing runs on import.
 */

import { type BossKind, type EnemyKind } from './bestiary';

/**
 * How many waves the siege runs to. Ten because the ladder is authored in full
 * and ten rows is what it takes to introduce nine kinds and five bosses without
 * a wave that is only there to be a number.
 *
 * A literal rather than `LADDER.length`, so it reads as the decision it is:
 * the ladder is written to the count, not the count discovered from the ladder.
 * A test pins them equal.
 */
export const SIEGE_WAVE_COUNT = 10;

/** How many of one kind a wave fields. */
export interface WaveEntry {
  readonly kind: EnemyKind;
  readonly count: number;
}

/** One rung of the ladder: who arrives, and what leads them. */
export interface SiegeWave {
  /**
   * Which wave this is, 1-based.
   *
   * Carried in the row rather than left implicit in its position, so anything
   * holding a wave — a banner, a log line, a test failure message — can name it
   * without also carrying the index it came from. Pinned equal to the position
   * by a test, since two places to say the same number is two places to get it
   * wrong.
   */
  readonly wave: number;
  /**
   * The rabble, at most one entry per kind.
   *
   * A list of kind/count pairs rather than a `Record<EnemyKind, number>`: a
   * Record would force every wave to mention every kind, and a wave of three
   * bats would be eight zeroes and a three. The compile-time completeness that
   * buys is not wanted here — a wave leaving a kind out is normal, the ladder
   * as a whole leaving one out is the bug, and that is a question about all ten
   * rows at once.
   */
  readonly enemies: readonly WaveEntry[];
  /** Bosses arriving with it. Empty for a wave that is only a wave. */
  readonly bosses: readonly BossKind[];
}

/**
 * The ladder.
 *
 * Pacing: the body count is 3 on wave 1 and climbs by one a wave to 12 on wave
 * 10, bosses on top. That ceiling is a map fact rather than taste — the arena
 * is 33x21 tiles with roughly a third of it solid, and a dozen bodies is
 * already enough that crossing it means going round somebody. Past about
 * fourteen the player stops choosing which threat to answer and starts being
 * surrounded regardless, which is a different, worse game; the difficulty in
 * the back half is meant to come from what has arrived, not how much of it.
 *
 * Ranged pressure is rationed on the same reasoning. Ice skeletons and soldier
 * archers are the only kinds that reach across the map, so they arrive late
 * (waves 5 and 6), never arrive alone, and stay thin in the final mix: a
 * handful of shooters makes cover matter, twice that makes standing anywhere a
 * mistake.
 *
 * Boss waves reuse rabble the player has already met on its own, so the new
 * thing on the field is the boss. Wave 10 fields every kind at once behind the
 * minotaur and the commander, which is the finale and also the reason the "all
 * kinds appear" test can never be satisfied by accident.
 *
 * Counts are the dial most likely to be retuned after playing it; nothing below
 * reads them, so retuning is editing numbers in this table and nothing else.
 */
const LADDER: readonly SiegeWave[] = [
  // 1-3: one kind each, so each is met alone. Bats first because a bat is a
  // crow with a bad temper and the least to learn.
  { wave: 1, enemies: [{ kind: 'bat', count: 3 }], bosses: [] },
  { wave: 2, enemies: [{ kind: 'crow', count: 4 }], bosses: [] },
  // Rats poison on contact, so a pack teaches that touching one costs more than
  // the bite. Five is a pack and still leaves room to back away from it.
  { wave: 3, enemies: [{ kind: 'rat', count: 5 }], bosses: [] },
  // 4-6: pairs. Each wave puts a known kind beside a new one, so there is
  // always exactly one thing to work out.
  { wave: 4, enemies: [
    { kind: 'skeleton', count: 4 }, { kind: 'fire_skeleton', count: 2 },
  ], bosses: [] },
  // First shooters, and only three of them, escorted by something that closes:
  // that pairing is the lesson, since standing off beats the spearman and gets
  // you shot, and charging in beats the bolts and gets you speared.
  { wave: 5, enemies: [
    { kind: 'ice_skeleton', count: 3 }, { kind: 'spearman', count: 4 },
  ], bosses: [] },
  // The garrison's own answer to a bow: shieldmen soak the front while archers
  // shoot from behind them, so this is where walking wide has to be learned.
  { wave: 6, enemies: [
    { kind: 'shieldman', count: 4 }, { kind: 'soldier_archer', count: 4 },
  ], bosses: [] },
  // 7-10: bosses. The crow king summons bats of his own, so his wave is birds
  // and rats rather than anything that shoots — his adds are the ranged threat.
  { wave: 7, enemies: [
    { kind: 'crow', count: 5 }, { kind: 'rat', count: 4 },
  ], bosses: ['crowking'] },
  { wave: 8, enemies: [
    { kind: 'skeleton', count: 4 }, { kind: 'fire_skeleton', count: 3 },
    { kind: 'ice_skeleton', count: 3 },
  ], bosses: ['dark_archer'] },
  { wave: 9, enemies: [
    { kind: 'spearman', count: 4 }, { kind: 'shieldman', count: 4 },
    { kind: 'soldier_archer', count: 3 },
  ], bosses: ['dark_knight'] },
  // Everything, and both of the bosses that are placed in the map rather than
  // walked in, so the last wave is already inside the walls when it starts.
  { wave: 10, enemies: [
    { kind: 'bat', count: 1 }, { kind: 'crow', count: 2 },
    { kind: 'rat', count: 1 }, { kind: 'skeleton', count: 2 },
    { kind: 'fire_skeleton', count: 1 }, { kind: 'ice_skeleton', count: 1 },
    { kind: 'spearman', count: 2 }, { kind: 'shieldman', count: 1 },
    { kind: 'soldier_archer', count: 1 },
  ], bosses: ['minotaur', 'commander'] },
];

/**
 * The wave with this number.
 *
 * The lookup is the validation: a number outside 1..SIEGE_WAVE_COUNT and a
 * number that is not a whole wave at all both miss the table, and both are the
 * same mistake — asking for a wave the siege does not have. Answering with a
 * placeholder would hide a caller that has run off the end of a finite ladder,
 * which is precisely the caller worth catching, so this throws.
 *
 * A RangeError rather than a bare Error because that is what it is, and because
 * a caller that wants to distinguish "bad wave number" from any other failure
 * can then do it by type instead of by matching on message text.
 */
export function siegeWave(wave: number): SiegeWave {
  const entry = Number.isInteger(wave) ? LADDER[wave - 1] : undefined;
  if (entry === undefined) {
    throw new RangeError(
      `siegeWave: ${wave} is not a siege wave; expected a whole number 1..${SIEGE_WAVE_COUNT}`,
    );
  }
  return entry;
}

/**
 * The whole ladder, in order, for callers that want to look at the run rather
 * than at one wave of it — a preview screen, or a test asking whether every
 * critter comes.
 *
 * A function rather than an exported const, to match `siegeWave` and to keep
 * the table itself private: everything leaves this module through a call, so
 * the ladder can later be built rather than written without any caller
 * noticing. `readonly` all the way down for the ordinary reason — this is the
 * one shared copy, and a caller that sorted it in place would be retuning
 * everybody else's siege.
 */
export function siegeLadder(): readonly SiegeWave[] {
  return LADDER;
}
