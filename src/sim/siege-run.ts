/**
 * One run of the bastion, kept as bookkeeping: which wave is due, who is still
 * standing behind the gate, and whether the run is still a run.
 *
 * This module owns no bodies. There is no array of live crows here, no tower,
 * no hero — those live with the loop that draws them, because they change every
 * frame and nothing about them is worth pinning down in a test. What is worth
 * pinning down is the small set of facts the loop keeps getting wrong by hand:
 * that the wave number and the roster it implies never drift apart, that a
 * promotion lands on the guards who earned it and not on the recruit who walked
 * in afterwards, and that a run which has ended stays ended. So the loop keeps
 * a `SiegeState` beside its entities and tells this module when something
 * happened; this module answers with the next state.
 *
 * **The run is lost only when the hero dies.** Towers and guards are cover, not
 * objectives: a tower that falls costs the player the shelter it was giving and
 * nothing else, and a retinue wiped to the last guard is a hero fighting wave 8
 * alone, which is a story rather than a game over. This is a deliberate design
 * decision and not an omission. The alternative — losing when the last guard
 * falls — was rejected because it makes the retinue a second health bar, and
 * the whole reason `guards.ts` grants ranks is to make the retinue something the
 * player is trying not to spend. A resource you are punished for spending at
 * all is not a resource, it is a fail state with extra steps. The run is won
 * when wave `SIEGE_WAVE_COUNT` is cleared, and that is the only way it is won.
 *
 * Every function here is pure in both senses: it reads no ambient state, and it
 * returns a new state rather than editing the one handed in. That second sense
 * is the load-bearing one. The legacy loop holds its own reference to the state
 * across a wave, and a call that edited in place would leave the loop's copy
 * and the returned copy claiming to be the same run while disagreeing about it.
 * A state that has already been passed on is therefore treated as somebody
 * else's, permanently.
 *
 * Nothing runs on import, nothing calls `Math.random` — the recruit roll takes
 * its randomness as an argument, so a bastion run replays from a seed the way
 * maps already do.
 */

import {
  STARTING_GUARDS,
  makeGuard,
  promote,
  rollGuardKind,
  type Guard,
} from './guards';
import type { Rng } from './rng';
import { SIEGE_WAVE_COUNT, siegeWave, type SiegeWave } from './siege-waves';

/**
 * Where a run stands: still being played, held to the end, or over.
 *
 * Three named states rather than a pair of booleans (`over`, `victory`),
 * because two booleans have four combinations and one of them — over and not
 * over at once — is nonsense that the type would nonetheless permit and some
 * caller would eventually construct. A union of three has exactly the states
 * that exist, and a `switch` over it is exhaustive without a default arm that
 * quietly swallows a fourth outcome added later.
 *
 * `'running'` rather than `'playing'` or `'active'` because it is the run that
 * is running, which is also what makes the two terminal names read as answers
 * to the same question.
 */
export type SiegeOutcome = 'running' | 'won' | 'lost';

/**
 * Everything the siege knows about itself, and deliberately nothing else.
 *
 * Three fields, all `readonly`, because this object is shared: the loop holds
 * it, the HUD reads it, and a test compares it against the copy it took a
 * moment ago. `readonly` cannot stop a determined caller — it is erased at
 * runtime — but it makes the intent unmissable at the call site, which is where
 * the mistake would otherwise be made.
 *
 * There is no `enemiesRemaining` here, and that absence is the design. Counting
 * live bodies is the loop's job and would be stale the moment it was stored;
 * this module is told when a wave is finished rather than working it out. Nor
 * is there a `heroHp` — the hero's health belongs to the hero, and duplicating
 * it here would create two numbers that could disagree about whether he is
 * alive.
 */
export interface SiegeState {
  /**
   * The wave on the field, 1-based, matching `siegeWave`'s numbering so the two
   * cannot be off by one relative to each other.
   *
   * On a won run this stays at `SIEGE_WAVE_COUNT` rather than advancing to an
   * eleventh wave that does not exist, so `waveRoster` remains answerable for
   * every state this module can produce.
   */
  readonly wave: number;
  /** Whether the run is still being played, and if not, how it finished. */
  readonly outcome: SiegeOutcome;
  /**
   * The retinue, alive only.
   *
   * The dead are not kept as tombstones with a flag, because every caller — the
   * HUD drawing a row of figures, the map placing them, a promotion sweep —
   * wants the living ones, and a list that needed filtering at each of those
   * places is a list that will eventually be used unfiltered at one of them.
   * A run's casualties are a story for the log, not state the siege reasons
   * over.
   *
   * The `Guard` objects themselves have mutable health, by design in
   * `guards.ts`: wounds are running state and the loop owns them. So a new
   * state generally shares the same bodies as the one it came from, which is
   * correct — it is the same retinue. The one exception is `completeWave`; see
   * there for why, and for what it means for a caller holding references.
   */
  readonly guards: readonly Guard[];
}

/**
 * Opens a run: wave 1, `STARTING_GUARDS` recruits rolled from the weighted
 * table, nobody promoted.
 *
 * The starting retinue is rolled rather than fixed so that no two bastion runs
 * open identically — a guaranteed archer and foot soldier would make the first
 * three waves the same three waves forever. It is drawn from the same
 * `rollGuardKind` the later recruits use, rather than a separate opening table,
 * so the knight's rarity means one thing across the whole run and there is only
 * one set of weights to retune.
 *
 * `rng` is `Rng` from `rng.ts`, which is precisely `() => number` returning
 * `[0, 1)` — the alias rather than the literal type so that the contract on the
 * return value has one home, and any `() => number` still satisfies it.
 */
export function startSiege(rng: Rng): SiegeState {
  const guards: Guard[] = [];
  for (let recruited = 0; recruited < STARTING_GUARDS; recruited++) {
    guards.push(makeGuard(rollGuardKind(rng)));
  }
  return { wave: 1, outcome: 'running', guards };
}

/**
 * What `state.wave` should put on the field.
 *
 * A one-line delegation to `siegeWave`, and worth its keep precisely because it
 * is one line: it is the single place that knows a `SiegeState`'s wave number
 * is the same number the ladder is indexed by. Without it every caller reaches
 * into `state.wave` and does the lookup itself, and the day the state grows a
 * separate notion of wave — a between-waves lull, say — those call sites are
 * scattered rather than one.
 *
 * It does not defend against a terminal outcome, because there is nothing to
 * defend against: neither `'won'` nor `'lost'` moves the wave number, so every
 * state this module can produce names a wave the ladder has. A won run answers
 * with wave 10, which is what a victory screen listing what was survived wants.
 * A hand-built state with a wave off the ladder gets `siegeWave`'s `RangeError`
 * rather than a placeholder, which is the right end for a caller that has run
 * off a finite ladder.
 */
export function waveRoster(state: SiegeState): SiegeWave {
  return siegeWave(state.wave);
}

/**
 * Called when every enemy of the current wave is dead.
 *
 * Promotes each surviving promotable guard by one rank, then adds one new
 * recruit rolled from the weighted table, then advances the wave — or wins the
 * run if that was the last one.
 *
 * The order is the rule. Promotion runs before recruitment so the fresh recruit
 * is rank 0: it did not fight the wave that was just held, and a retinue where
 * arriving is worth as much as surviving has nothing left to protect. Written
 * as two consecutive statements rather than one pass with a "was this one here
 * already" test, because the two-statement version cannot get the answer wrong.
 *
 * Which guards climb is not decided here. `promote` already knows that the
 * knight does not, and that the ladder runs out at `MAX_RANK`; asking it and
 * accepting its answer means the knight's row in `GUARD_STATS` stays the single
 * place that decision is written down. Its boolean return says whether a
 * promotion landed, which a caller announcing "the foot soldier is promoted!"
 * needs but the retinue does not — the guard it hands back is already correct
 * either way, so nothing is read from it here.
 *
 * Survivors are copied before being promoted, which is the one place this
 * module does not share bodies with the state it came from. `promote` edits in
 * place by design, and editing the caller's guards would make a state taken
 * before the wave silently claim ranks earned after it — exactly the drift
 * purity is here to prevent. The cost is real and worth stating: a caller
 * holding `Guard` references across a `completeWave` is holding the old bodies
 * afterwards, and must re-read `state.guards`. That is a narrower trap than
 * two states disagreeing about the same run, and it is one a caller can see.
 *
 * Winning promotes the survivors but recruits nobody. The last wave was fought
 * and surviving it is worth what surviving any wave is worth, so the victory
 * screen shows the retinue that actually held the gate; a recruit walking in
 * after the siege is over has nothing to join.
 *
 * A run that has already ended is returned untouched. See `heroDied`.
 */
export function completeWave(state: SiegeState, rng: Rng): SiegeState {
  if (state.outcome !== 'running') return state;

  const survivors = state.guards.map((guard) => {
    const veteran = { ...guard };
    promote(veteran);
    return veteran;
  });

  if (state.wave >= SIEGE_WAVE_COUNT) {
    return { wave: state.wave, outcome: 'won', guards: survivors };
  }

  return {
    wave: state.wave + 1,
    outcome: 'running',
    guards: [...survivors, makeGuard(rollGuardKind(rng))],
  };
}

/**
 * The hero died. The only way a run is lost.
 *
 * Takes no cause and no wave number: there is exactly one way to lose, so there
 * is nothing to distinguish, and a parameter offering to say why would be an
 * invitation to add a second losing condition somewhere other than here.
 *
 * Calling it on a run that has already finished returns that run unchanged,
 * including a won one. That is not defensive coding for its own sake — the
 * legacy loop resolves a frame's collisions after it has resolved the wave, so
 * the hero taking a fatal hit on the same frame the last enemy of wave 10 fell
 * is an ordinary sequence, not a bug. Whichever call arrives first is the one
 * that decides, and clearing the final wave is what ends the run in that frame.
 * Once ended, ended.
 */
export function heroDied(state: SiegeState): SiegeState {
  if (state.outcome !== 'running') return state;
  return { ...state, outcome: 'lost' };
}

/**
 * A guard was killed. It leaves the retinue and does not come back.
 *
 * Indexed rather than taking the `Guard` itself, because the legacy loop works
 * from array positions and looking a body up by identity would mean either
 * giving guards ids they otherwise do not need, or an identity comparison that
 * quietly stops matching the moment `completeWave` hands back copies.
 *
 * An index that is not in the retinue leaves the state alone rather than
 * throwing. The caller is a game loop working from positions that may already
 * have shifted — two guards dying in the same frame means the second index was
 * computed against a longer list — and the honest reading of "remove the guard
 * at 4" when there is no guard at 4 is that there is nothing left to remove.
 * Throwing would turn a stale index into a crashed run, which is a far worse
 * outcome than a no-op for a caller that is, at worst, one frame behind.
 *
 * The check is the lookup itself rather than a pair of bounds comparisons, so
 * a negative index, one past the end, and a fractional one are all caught by
 * the same question — is there a guard there — instead of by three rules that
 * could come to disagree. `noUncheckedIndexedAccess` is what makes the compiler
 * insist the question is asked.
 *
 * A finished run keeps its retinue as it stood, for the same reason it keeps
 * its outcome: it is a record now, not a run.
 */
export function guardLost(state: SiegeState, index: number): SiegeState {
  if (state.outcome !== 'running') return state;
  if (state.guards[index] === undefined) return state;
  return { ...state, guards: state.guards.filter((_, at) => at !== index) };
}
