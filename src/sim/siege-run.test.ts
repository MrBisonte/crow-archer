import { describe, expect, it } from 'vitest';

import {
  GUARD_STATS,
  MAX_RANK,
  OPENING_RETINUE,
  RECRUITABLE_GUARD_KINDS,
  STARTING_RECRUITS,
  UNIQUE_GUARD_KINDS,
  guardDamage,
  guardHeal,
  invokeWard,
  isPriest,
  makeGuard,
  promote,
  rollGuardKind,
  type Guard,
} from './guards';
import { mulberry32, type Rng } from './rng';
import {
  completeWave,
  guardLost,
  heroDied,
  startSiege,
  waveRoster,
  type SiegeOutcome,
  type SiegeState,
} from './siege-run';
import { SIEGE_WAVE_COUNT, siegeWave } from './siege-waves';

/**
 * A seed whose first two recruits are both archers, so the opening retinue is
 * entirely promotable.
 *
 * Several rules below can only be seen on a retinue with no knight in it —
 * "exactly one guard is rank 0 after a wave" is trivially true if one of the
 * openers can never leave rank 0. Pinned as a seed rather than met with a stub
 * rng returning a constant, so every test here runs against the real weighted
 * roll; the kinds it draws are asserted where they matter, so a change to the
 * weights fails as a named expectation rather than as a mystery three tests
 * further down.
 */
const SEED_ALL_PROMOTABLE = 7;

/** A seed that opens with a knight at index 0, for the rule that it never climbs. */
const SEED_OPENS_WITH_KNIGHT = 4;

/** The guard at `index`, or a failure naming the index rather than a TypeError
 *  raised three assertions later by a property read on `undefined`. */
const guardAt = (state: SiegeState, index: number): Guard => {
  const guard = state.guards[index];
  if (guard === undefined) throw new Error(`expected a guard at index ${index}`);
  return guard;
};

/**
 * Runs `act` and fails if `state` changed in any way a holder of it could see.
 *
 * A deep snapshot rather than a reference comparison, because the mutation
 * worth catching is not the state object being replaced — it is `promote`
 * reaching through the state into a `Guard` and raising a rank the caller's
 * copy should never have gained.
 */
const leavingUntouched = <T>(state: SiegeState, act: () => T): T => {
  const before = structuredClone(state);
  const result = act();
  expect(state).toEqual(before);
  return result;
};

/** A run opened on `seed` and carried forward `waves` completed waves. */
const runThrough = (seed: number, waves: number): SiegeState => {
  const rng = mulberry32(seed);
  let state = startSiege(rng);
  for (let cleared = 0; cleared < waves; cleared++) state = completeWave(state, rng);
  return state;
};

/** A run held to the end of the ladder. */
const wonRun = (): SiegeState => runThrough(SEED_ALL_PROMOTABLE, SIEGE_WAVE_COUNT);

/** A run ended by the hero dying part-way up the ladder. */
const lostRun = (): SiegeState => heroDied(runThrough(SEED_ALL_PROMOTABLE, 2));

/** The two ways a run stops, and how to build one of each. */
const ENDED_RUNS: ReadonlyArray<[SiegeOutcome, () => SiegeState]> = [
  ['won', wonRun],
  ['lost', lostRun],
];

/** A guard of `kind` put through the ceremony `waves` times, built straight out
 *  of `guards.ts` so it is the ladder's own answer rather than a copy of it. */
const ladderReference = (kind: Guard['kind'], waves: number): Guard => {
  const guard = makeGuard(kind);
  for (let wave = 0; wave < waves; wave++) promote(guard);
  return guard;
};

/** Every priest in a retinue. The count is the assertion in most of these. */
const priestsIn = (state: SiegeState): Guard[] => state.guards.filter(isPriest);

/** The one priest, or a failure that says the retinue had none rather than a
 *  TypeError from a property read on `undefined` three lines later. */
const thePriest = (state: SiegeState): Guard => {
  const found = priestsIn(state);
  expect(found, `expected exactly one priest, found ${found.length}`).toHaveLength(1);
  return found[0]!;
};

describe('startSiege', () => {
  it('opens at wave 1, running, with OPENING_RETINUE unpromoted guards', () => {
    const state = startSiege(mulberry32(SEED_ALL_PROMOTABLE));

    expect(state.wave).toBe(1);
    expect(state.outcome).toBe('running');
    expect(state.guards).toHaveLength(OPENING_RETINUE);
    for (const guard of state.guards) {
      expect(guard.rank, guard.kind).toBe(0);
      expect(guard.hp, guard.kind).toBe(guard.maxHp);
      expect(guard.maxHp, guard.kind).toBe(GUARD_STATS[guard.kind].baseHp);
    }
  });

  it('rolls the opening retinue from the weighted table', () => {
    const state = startSiege(mulberry32(SEED_ALL_PROMOTABLE));
    expect(state.guards.map((guard) => guard.kind)).toEqual(['archer', 'archer', 'priest']);
  });

  /**
   * The priest turns up once, on top of the roll, and behind it.
   *
   * Three separate claims, and all three matter. Exactly one, because the kind
   * is unique. On top of the recruits rather than instead of one, because the
   * opening was balanced around two rolled bodies and a priest that displaced
   * one would quietly make wave 1 harder. Behind them, because `completeWave`
   * appends the recruit at the end and the loop reads the last entry to find
   * the body it has not placed yet.
   */
  it('seats exactly one of each unique kind, behind the recruits', () => {
    const state = startSiege(mulberry32(SEED_ALL_PROMOTABLE));
    const kinds = state.guards.map((guard) => guard.kind);

    expect(priestsIn(state)).toHaveLength(1);
    expect(kinds.slice(0, STARTING_RECRUITS).every((kind) =>
      (RECRUITABLE_GUARD_KINDS as readonly string[]).includes(kind))).toBe(true);
    expect(kinds.slice(STARTING_RECRUITS)).toEqual([...UNIQUE_GUARD_KINDS]);

    const priest = thePriest(state);
    expect(priest.rank).toBe(0);
    expect(isPriest(priest) && priest.ward).toBe('ready');
  });

  /**
   * Seating the priest must not have moved the recruit roll.
   *
   * It is added after the loop rather than through it, so the rng is consumed
   * exactly as it was before the kind existed and every seed in this suite
   * still opens the run it used to. A version that rolled and then substituted,
   * or that seated the priest first, would silently re-key every pinned seed in
   * the project — including the one game.test.ts uses to make its rank
   * assertions repeatable.
   */
  it('leaves the recruit roll on the same seeds it always drew', () => {
    for (const seed of [SEED_ALL_PROMOTABLE, SEED_OPENS_WITH_KNIGHT, 1, 20260824]) {
      const opened = startSiege(mulberry32(seed)).guards
        .filter((guard) => !isPriest(guard))
        .map((guard) => guard.kind);

      const rng = mulberry32(seed);
      const rolled = Array.from({ length: STARTING_RECRUITS }, () => makeGuard(rollGuardKind(rng)).kind);

      expect(opened, `seed ${seed}`).toEqual(rolled);
    }
  });

  // The reason the rng is a parameter: a bastion run has to replay.
  it('rebuilds the same retinue from the same seed, and another from another', () => {
    const kinds = (seed: number): string[] =>
      startSiege(mulberry32(seed)).guards.map((guard) => guard.kind);

    expect(kinds(SEED_ALL_PROMOTABLE)).toEqual(kinds(SEED_ALL_PROMOTABLE));
    expect(kinds(SEED_ALL_PROMOTABLE)).not.toEqual(kinds(SEED_OPENS_WITH_KNIGHT));
  });

  // startSiege is the one entry point with no state to leave untouched, so the
  // purity claim available for it is that two runs are two runs: promoting a
  // guard in one must not promote anybody in the other.
  it('hands out independent retinues rather than one shared set of bodies', () => {
    const first = startSiege(mulberry32(SEED_ALL_PROMOTABLE));
    const second = startSiege(mulberry32(SEED_ALL_PROMOTABLE));

    promote(guardAt(first, 0));

    expect(guardAt(first, 0).rank).toBe(1);
    expect(guardAt(second, 0).rank).toBe(0);
  });
});

describe('waveRoster', () => {
  it.each(Array.from({ length: SIEGE_WAVE_COUNT }, (_, cleared) => cleared))(
    'hands back the ladder row for the wave reached after %i completed waves',
    (cleared) => {
      const state = runThrough(SEED_ALL_PROMOTABLE, cleared);

      expect(state.wave).toBe(cleared + 1);
      expect(waveRoster(state)).toBe(siegeWave(state.wave));
      expect(waveRoster(state).wave).toBe(cleared + 1);
    },
  );

  it('still answers on a won run, naming the last wave it survived', () => {
    const state = wonRun();
    expect(state.wave).toBe(SIEGE_WAVE_COUNT);
    expect(waveRoster(state)).toBe(siegeWave(SIEGE_WAVE_COUNT));
  });

  it('leaves the state untouched', () => {
    const state = runThrough(SEED_ALL_PROMOTABLE, 3);
    leavingUntouched(state, () => waveRoster(state));
  });
});

describe('completeWave', () => {
  it('advances the wave and grows the retinue by exactly one, all the way to 10', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    let state = startSiege(rng);

    for (let wave = 1; wave < SIEGE_WAVE_COUNT; wave++) {
      expect(state.wave).toBe(wave);
      const before = state.guards.length;

      state = completeWave(state, rng);

      expect(state.wave, `after clearing wave ${wave}`).toBe(wave + 1);
      expect(state.outcome, `after clearing wave ${wave}`).toBe('running');
      expect(state.guards, `after clearing wave ${wave}`).toHaveLength(before + 1);
    }

    expect(state.guards).toHaveLength(OPENING_RETINUE + SIEGE_WAVE_COUNT - 1);
  });

  it('wins on the last wave without advancing past it or recruiting again', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    let state = startSiege(rng);
    for (let cleared = 0; cleared < SIEGE_WAVE_COUNT - 1; cleared++) {
      state = completeWave(state, rng);
    }
    expect(state.wave).toBe(SIEGE_WAVE_COUNT);
    const before = state.guards.length;

    const won = completeWave(state, rng);

    expect(won.outcome).toBe('won');
    expect(won.wave).toBe(SIEGE_WAVE_COUNT);
    expect(won.guards).toHaveLength(before);
  });

  it('leaves the state untouched, ranks included', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    const state = startSiege(rng);

    const after = leavingUntouched(state, () => completeWave(state, rng));

    // The snapshot inside the helper is the assertion; these pin the two halves
    // it would be easiest to break — the caller's guards must not have climbed,
    // and the returned ones must have.
    expect(guardAt(state, 0).rank).toBe(0);
    expect(guardAt(after, 0).rank).toBe(1);
    expect(state.guards).toHaveLength(OPENING_RETINUE);
  });

  // Promotion before recruitment: the fresh recruit did not fight the wave that
  // was just held, so it is the only rank 0 left standing.
  it('promotes the survivors before the new recruit joins', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    const opened = startSiege(rng);
    for (const guard of opened.guards) {
      // Every opener climbs something, priest included — otherwise "exactly one
      // guard is rank 0 afterwards" would be true for the wrong reason.
      expect(GUARD_STATS[guard.kind].promotion, guard.kind).not.toBe('none');
    }

    const after = completeWave(opened, rng);

    expect(after.guards.filter((guard) => guard.rank === 0)).toHaveLength(1);
    expect(guardAt(after, after.guards.length - 1).rank).toBe(0);
    expect(guardAt(after, 0).rank).toBe(1);
    expect(guardAt(after, 1).rank).toBe(1);
  });

  it('carries a survivor to MAX_RANK in three waves and no further', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    let state = startSiege(rng);
    expect(guardAt(state, 0).kind).toBe('archer');

    for (let cleared = 0; cleared < 3; cleared++) state = completeWave(state, rng);
    const veteran = guardAt(state, 0);

    expect(veteran.rank).toBe(MAX_RANK);
    expect(MAX_RANK).toBe(3);
    // The ladder's own answer for the same kind and the same three waves.
    const reference = ladderReference('archer', 3);
    expect(veteran.maxHp).toBe(reference.maxHp);
    expect(veteran.hp).toBe(reference.hp);
    expect(guardDamage(veteran)).toBe(guardDamage(reference));
    // And the numbers those come out as, so a ladder retuned in both places at
    // once still fails here.
    expect(veteran.maxHp).toBe(3);
    expect(guardDamage(veteran)).toBe(2);

    state = completeWave(state, rng);
    expect(guardAt(state, 0).rank).toBe(MAX_RANK);
  });

  it('never gives a knight a rank, however many waves it lives through', () => {
    const rng = mulberry32(SEED_OPENS_WITH_KNIGHT);
    let state = startSiege(rng);
    expect(guardAt(state, 0).kind).toBe('knight');

    for (let cleared = 0; cleared < SIEGE_WAVE_COUNT; cleared++) {
      state = completeWave(state, rng);
      expect(guardAt(state, 0).rank, `after clearing ${cleared + 1} waves`).toBe(0);
    }

    const knight = guardAt(state, 0);
    expect(knight.hp).toBe(GUARD_STATS.knight.baseHp);
    expect(knight.maxHp).toBe(GUARD_STATS.knight.baseHp);
    expect(guardDamage(knight)).toBe(GUARD_STATS.knight.baseDamage);
  });

  /**
   * The most important rule about the priest, walked the whole ladder.
   *
   * Ten waves is ten recruits, and every one of them comes from
   * `rollGuardKind`, which cannot return a priest. The claim is checked after
   * every single wave rather than only at the end, so a run that grew a second
   * priest on wave 4 and lost one on wave 7 fails here instead of passing a
   * final count.
   */
  it('never adds a second priest, across all ten waves', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    let state = startSiege(rng);
    expect(priestsIn(state)).toHaveLength(1);

    for (let cleared = 0; cleared < SIEGE_WAVE_COUNT; cleared++) {
      state = completeWave(state, rng);
      expect(priestsIn(state), `after clearing ${cleared + 1} waves`).toHaveLength(1);
    }

    expect(state.outcome).toBe('won');
    expect(priestsIn(state)).toHaveLength(1);
  });

  /**
   * And the same claim from the other side: a priest that dies stays dead.
   *
   * This is the half a weighted table could never guarantee. Even a priest with
   * a weight of zero would be one careless edit from walking back in on the
   * next wave; a priest that is not in the roll at all has nowhere to come
   * from, and the run simply goes on one guard lighter and a body short of a
   * healer for the remaining nine waves.
   */
  it('does not replace a priest that has been lost, for the rest of the run', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    let state = startSiege(rng);
    const at = state.guards.findIndex(isPriest);
    expect(at, 'the opening retinue had no priest to lose').toBeGreaterThanOrEqual(0);

    state = guardLost(state, at);
    expect(priestsIn(state)).toHaveLength(0);

    for (let cleared = 0; cleared < SIEGE_WAVE_COUNT; cleared++) {
      state = completeWave(state, rng);
      expect(priestsIn(state), `after clearing ${cleared + 1} waves`).toHaveLength(0);
    }

    // The run is not over, and it is not diminished in any other way: the
    // recruits still arrived, one per wave, on top of the retinue that was left.
    expect(state.outcome).toBe('won');
    expect(state.guards).toHaveLength(OPENING_RETINUE - 1 + SIEGE_WAVE_COUNT - 1);
  });

  it('climbs the priest its own ladder, three waves and no further', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    let state = startSiege(rng);

    for (let cleared = 0; cleared < 3; cleared++) state = completeWave(state, rng);
    const senior = thePriest(state);

    expect(senior.rank).toBe(MAX_RANK);
    const reference = ladderReference('priest', 3);
    expect(senior.maxHp).toBe(reference.maxHp);
    expect(guardHeal(senior)).toBe(guardHeal(reference));
    // And the numbers those come out as, so a ladder retuned in both places at
    // once still fails here.
    expect(senior.maxHp).toBe(4);
    expect(guardHeal(senior)).toBe(2);
    // What it must never have collected on the way up.
    expect(guardDamage(senior)).toBe(0);

    state = completeWave(state, rng);
    expect(thePriest(state).rank).toBe(MAX_RANK);
  });

  /**
   * The ward is once per wave, and this is the "per wave" half.
   *
   * `completeWave` is the only thing in the codebase that hands the charge
   * back, which is what makes the ability worth exactly one use per wave
   * whether that wave took twenty seconds or two minutes. Spending it and
   * clearing a wave puts it back; nothing else does.
   */
  it('hands the priest its ward back when a wave is cleared', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    const opened = startSiege(rng);
    const priest = thePriest(opened);
    if (!isPriest(priest)) throw new Error('the opening retinue had no priest');

    invokeWard(priest, []);
    expect(priest.ward).toBe('spent');

    const after = thePriest(completeWave(opened, rng));

    expect(isPriest(after) && after.ward).toBe('ready');
    // The caller's own copy is untouched, like every other field: completeWave
    // recharges the guard it hands back, not the one it was given.
    expect(priest.ward).toBe('spent');
  });

  it('does not hand the ward back for anything short of a cleared wave', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    const opened = startSiege(rng);
    const priest = thePriest(opened);
    if (!isPriest(priest)) throw new Error('the opening retinue had no priest');
    invokeWard(priest, []);

    // A guard lost, and the hero dying, are the other two things that happen to
    // a run. Neither is a wave being held.
    for (const state of [guardLost(opened, 0), heroDied(opened)]) {
      const stillThere = state.guards.find(isPriest);
      expect(stillThere && isPriest(stillThere) && stillThere.ward).toBe('spent');
    }
  });
});

describe('heroDied', () => {
  it.each(Array.from({ length: SIEGE_WAVE_COUNT }, (_, cleared) => cleared))(
    'loses the run after %i completed waves, whatever wave that leaves it on',
    (cleared) => {
      const state = runThrough(SEED_ALL_PROMOTABLE, cleared);
      expect(state.outcome).toBe('running');

      const lost = heroDied(state);

      expect(lost.outcome).toBe('lost');
      expect(lost.wave).toBe(state.wave);
      expect(lost.guards).toHaveLength(state.guards.length);
    },
  );

  it('leaves the state untouched', () => {
    const state = runThrough(SEED_ALL_PROMOTABLE, 4);

    const lost = leavingUntouched(state, () => heroDied(state));

    expect(state.outcome).toBe('running');
    expect(lost.outcome).toBe('lost');
  });
});

describe('guardLost', () => {
  it('drops the guard at the index and keeps the rest in order', () => {
    const state = runThrough(SEED_ALL_PROMOTABLE, 2);
    const survivors = state.guards.filter((_, at) => at !== 1);

    const after = guardLost(state, 1);

    expect(after.guards).toEqual(survivors);
    expect(after.guards).toHaveLength(state.guards.length - 1);
    expect(after.wave).toBe(state.wave);
    expect(after.outcome).toBe('running');
  });

  it('does not bring a lost guard back on the next wave', () => {
    const rng = mulberry32(SEED_ALL_PROMOTABLE);
    const opened = startSiege(rng);
    const bereaved = guardLost(opened, 0);

    const after = completeWave(bereaved, rng);

    expect(after.guards).toHaveLength(OPENING_RETINUE - 1 + 1);
  });

  it.each([-1, -5, OPENING_RETINUE, OPENING_RETINUE + 5, 1.5])(
    'leaves the retinue alone for index %s, which names no guard',
    (index) => {
      const state = startSiege(mulberry32(SEED_ALL_PROMOTABLE));

      expect(() => guardLost(state, index)).not.toThrow();
      expect(guardLost(state, index)).toEqual(state);
    },
  );

  it('leaves the state untouched', () => {
    const state = runThrough(SEED_ALL_PROMOTABLE, 3);
    const retinue = state.guards.length;

    const after = leavingUntouched(state, () => guardLost(state, 0));

    expect(state.guards).toHaveLength(retinue);
    expect(after.guards).toHaveLength(retinue - 1);
  });
});

describe('a run that has ended', () => {
  it.each(ENDED_RUNS)('is %s, and completeWave does not restart it', (outcome, build) => {
    const ended = build();
    expect(ended.outcome).toBe(outcome);

    const after = leavingUntouched(ended, () =>
      completeWave(ended, mulberry32(SEED_ALL_PROMOTABLE)),
    );

    expect(after.outcome).toBe(outcome);
    expect(after.wave).toBe(ended.wave);
    expect(after.guards).toEqual(ended.guards);
  });

  it.each(ENDED_RUNS)('is %s, and heroDied does not change that', (outcome, build) => {
    const ended = build();

    const after = leavingUntouched(ended, () => heroDied(ended));

    expect(after.outcome).toBe(outcome);
    expect(after.guards).toEqual(ended.guards);
  });

  it.each(ENDED_RUNS)('is %s, and guardLost does not change that', (outcome, build) => {
    const ended = build();

    const after = leavingUntouched(ended, () => guardLost(ended, 0));

    expect(after.outcome).toBe(outcome);
    expect(after.guards).toEqual(ended.guards);
  });

  // A frame can resolve the last enemy of wave 10 and a fatal hit on the hero
  // in either order. Whichever call lands first is the one that decides.
  it('keeps the win when the hero dies on the same frame the last wave falls', () => {
    const rng: Rng = mulberry32(SEED_ALL_PROMOTABLE);
    let state = startSiege(rng);
    for (let cleared = 0; cleared < SIEGE_WAVE_COUNT; cleared++) {
      state = completeWave(state, rng);
    }

    expect(state.outcome).toBe('won');
    expect(heroDied(state).outcome).toBe('won');
  });
});
