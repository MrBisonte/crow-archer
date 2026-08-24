import { describe, expect, it } from 'vitest';

import {
  GUARD_KINDS,
  GUARD_STATS,
  MAX_RANK,
  RANK_MARK,
  STARTING_GUARDS,
  guardDamage,
  makeGuard,
  promote,
  rollGuardKind,
  type Guard,
  type GuardKind,
} from './guards';
import { mulberry32 } from './rng';

/** A guard put through the ceremony `waves` times, however many of those took. */
const veteran = (kind: GuardKind, waves: number): Guard => {
  const guard = makeGuard(kind);
  for (let wave = 0; wave < waves; wave++) promote(guard);
  return guard;
};

/** Enough draws that a 40/40/20 split is unmistakable, and still instant. */
const DRAWS = 10_000;

/** The seed every measured roll below is taken from, so failures repeat. */
const SEED = 20260823;

/**
 * How far a measured share may sit from its intended one, in percentage
 * points.
 *
 * At 10,000 draws the standard error is 0.40 points on a 20% share and 0.49 on
 * a 40% one, so 1.5 points is three standard errors out: wide enough that the
 * choice of seed is not load-bearing, narrow enough that any real mistake in
 * the table fails it outright — the subtlest one available, archer and knight
 * swapping weights, moves a share by 20 points.
 */
const TOLERANCE_POINTS = 1.5;

/** What each kind is meant to be worth, stated here rather than read back out
 *  of `GUARD_STATS`, so weights that are all wrong together still fail. */
const INTENDED_SHARES: ReadonlyArray<[GuardKind, number]> = [
  ['archer', 40],
  ['foot_soldier', 40],
  ['knight', 20],
];

/** The share of `DRAWS` recruits each kind won, in percent, from one seed. */
const sharesFrom = (seed: number): Record<GuardKind, number> => {
  const rng = mulberry32(seed);
  const counts: Record<GuardKind, number> = { archer: 0, foot_soldier: 0, knight: 0 };
  for (let draw = 0; draw < DRAWS; draw++) counts[rollGuardKind(rng)] += 1;

  const shares: Record<GuardKind, number> = { archer: 0, foot_soldier: 0, knight: 0 };
  for (const kind of GUARD_KINDS) shares[kind] = (counts[kind] / DRAWS) * 100;
  return shares;
};

describe('GUARD_STATS', () => {
  it.each(GUARD_KINDS)('has a usable row for %s', (kind) => {
    expect(GUARD_STATS[kind].baseHp).toBeGreaterThan(0);
    expect(GUARD_STATS[kind].baseDamage).toBeGreaterThan(0);
    expect(GUARD_STATS[kind].weight).toBeGreaterThan(0);
  });

  // The Record type makes the compiler demand a row per kind. This is the
  // other direction: a kind quietly dropped from GUARD_KINDS would leave the
  // roll unable to draw it while every check driven off that list still passed.
  it('has exactly as many rows as there are kinds', () => {
    expect(Object.keys(GUARD_STATS)).toHaveLength(GUARD_KINDS.length);
  });

  it('makes the knight the rare draw and leaves the other two even', () => {
    expect(GUARD_STATS.knight.weight).toBeLessThan(GUARD_STATS.archer.weight);
    expect(GUARD_STATS.archer.weight).toBe(GUARD_STATS.foot_soldier.weight);
  });

  // What the knight is paid for being rare, and the reason it does not climb.
  it('doubles the knight on both health and damage', () => {
    expect(GUARD_STATS.knight.baseHp).toBe(GUARD_STATS.archer.baseHp * 2);
    expect(GUARD_STATS.knight.baseDamage).toBe(GUARD_STATS.archer.baseDamage * 2);
  });

  it('gives the foot soldier the health and the archer the range', () => {
    expect(GUARD_STATS.foot_soldier.baseHp).toBeGreaterThan(GUARD_STATS.knight.baseHp);
    expect(GUARD_STATS.archer.ranged).toBe(true);
    expect(GUARD_STATS.foot_soldier.ranged).toBe(false);
    expect(GUARD_STATS.knight.ranged).toBe(false);
  });
});

describe('rollGuardKind', () => {
  const shares = sharesFrom(SEED);

  it.each(INTENDED_SHARES)('draws %s at about its intended share', (kind, intended) => {
    expect(
      Math.abs(shares[kind] - intended),
      `${kind} came out at ${shares[kind].toFixed(2)}%, intended ${intended}%`,
    ).toBeLessThanOrEqual(TOLERANCE_POINTS);
  });

  // Set equality catches both directions at once: a kind the roll can never
  // reach, and anything it hands back that is not a kind at all.
  it('reaches every kind and invents none', () => {
    const rng = mulberry32(SEED + 1);
    const seen = new Set<GuardKind>();
    for (let draw = 0; draw < 500; draw++) seen.add(rollGuardKind(rng));
    expect(seen).toEqual(new Set(GUARD_KINDS));
  });

  it('walks the kinds in order, so a roll of zero is the first of them', () => {
    expect(rollGuardKind(() => 0)).toBe('archer');
    expect(rollGuardKind(() => 0.999999)).toBe('knight');
  });

  // The weights are cumulative bands, and these are their edges. Pinned
  // because a rounding slip here is exactly the bug the share test is too
  // coarse to see.
  it('puts the boundaries between kinds where the weights say', () => {
    expect(rollGuardKind(() => 0.399)).toBe('archer');
    expect(rollGuardKind(() => 0.4)).toBe('foot_soldier');
    expect(rollGuardKind(() => 0.799)).toBe('foot_soldier');
    expect(rollGuardKind(() => 0.8)).toBe('knight');
  });

  // rng() is contracted to stay below 1. One that does not — a hand-rolled
  // stub, or a value that rounded up on its way in — must still hand back a
  // guard, rather than an undefined that only surfaces three waves later.
  it('still yields a kind if the rng hands back its ceiling', () => {
    expect(GUARD_KINDS).toContain(rollGuardKind(() => 1));
  });

  // The reason the rng is a parameter at all: a bastion run has to replay.
  it('rebuilds the same retinue from the same seed, and a different one from another', () => {
    const retinue = (seed: number): GuardKind[] => {
      const rng = mulberry32(seed);
      return Array.from({ length: 8 }, () => rollGuardKind(rng));
    };
    expect(retinue(7)).toEqual(retinue(7));
    expect(retinue(7)).not.toEqual(retinue(8));
  });
});

describe('makeGuard', () => {
  it.each(GUARD_KINDS)('brings %s in at rank 0 and unhurt', (kind) => {
    const guard = makeGuard(kind);
    expect(guard.kind).toBe(kind);
    expect(guard.rank).toBe(0);
    expect(guard.maxHp).toBe(GUARD_STATS[kind].baseHp);
    expect(guard.hp).toBe(guard.maxHp);
  });

  it('hands out separate guards rather than one shared body', () => {
    const first = makeGuard('foot_soldier');
    const second = makeGuard('foot_soldier');
    promote(first);
    expect(second.rank).toBe(0);
  });
});

describe('promote', () => {
  it('moves a survivor up one rank, and says so', () => {
    const guard = makeGuard('foot_soldier');
    expect(promote(guard)).toBe(true);
    expect(guard.rank).toBe(1);
  });

  it('never takes a guard past MAX_RANK, however many waves it lives through', () => {
    const guard = makeGuard('archer');
    for (let wave = 0; wave < 50; wave++) promote(guard);
    expect(guard.rank).toBe(MAX_RANK);
  });

  it('reports false once there is nothing left to give', () => {
    const guard = veteran('foot_soldier', MAX_RANK);
    expect(guard.rank).toBe(MAX_RANK);
    expect(promote(guard)).toBe(false);
    expect(guard.rank).toBe(MAX_RANK);
  });

  // The decision recorded in the knight's row: it starts where the others
  // finish, so it is refused on the first wave it survives, not after a rank
  // or two of climbing.
  it('refuses a knight from the very first wave it survives', () => {
    const guard = makeGuard('knight');
    expect(promote(guard)).toBe(false);
    expect(guard.rank).toBe(0);
    expect(guard.maxHp).toBe(GUARD_STATS.knight.baseHp);
    expect(guardDamage(guard)).toBe(GUARD_STATS.knight.baseDamage);
  });

  it('leaves a knight at rank 0 no matter how long the siege runs', () => {
    const guard = veteran('knight', 10);
    expect(guard.rank).toBe(0);
    expect(guard.hp).toBe(GUARD_STATS.knight.baseHp);
  });

  it('heals by the step it grants, so the promotion is felt in the wave it is earned', () => {
    const guard = makeGuard('foot_soldier');
    guard.hp = 1; // came out of the wave on its last hit
    expect(promote(guard)).toBe(true);
    expect(guard.maxHp).toBe(4);
    expect(guard.hp).toBe(2); // a step up, not a free full heal
  });

  it('does not heal on the rank that pays in damage instead', () => {
    const guard = veteran('archer', 2);
    const before = guard.hp;
    expect(promote(guard)).toBe(true);
    expect(guard.rank).toBe(MAX_RANK);
    expect(guard.hp).toBe(before);
  });
});

describe('the ladder', () => {
  it('measures a senior foot soldier at 5 hp and 2 damage', () => {
    const guard = veteran('foot_soldier', MAX_RANK);
    expect(guard.rank).toBe(MAX_RANK);
    expect(guard.maxHp).toBe(5);
    expect(guard.hp).toBe(5);
    expect(guardDamage(guard)).toBe(2);
  });

  it('measures a senior archer at 3 hp and 2 damage', () => {
    const guard = veteran('archer', MAX_RANK);
    expect(guard.rank).toBe(MAX_RANK);
    expect(guard.maxHp).toBe(3);
    expect(guard.hp).toBe(3);
    expect(guardDamage(guard)).toBe(2);
  });

  // Health twice and then damage, in that order: the early promotions are what
  // keep a guard alive long enough to reach the one that hits harder.
  it('pays in health twice before it pays in damage', () => {
    const guard = makeGuard('foot_soldier');
    const base = guardDamage(guard);
    promote(guard);
    expect(guardDamage(guard)).toBe(base);
    promote(guard);
    expect(guardDamage(guard)).toBe(base);
    promote(guard);
    expect(guardDamage(guard)).toBe(base + 1);
  });

  it('leaves a fresh recruit dealing exactly what its row says', () => {
    for (const kind of GUARD_KINDS) {
      expect(guardDamage(makeGuard(kind)), kind).toBe(GUARD_STATS[kind].baseDamage);
    }
  });
});

describe('RANK_MARK', () => {
  it('has one insignia per rank, the recruit included', () => {
    expect(RANK_MARK).toHaveLength(MAX_RANK + 1);
  });

  it('gives a recruit nothing to wear', () => {
    expect(RANK_MARK[0]).toBe('');
  });

  it('adds a star per rank, so seniority compares at a glance', () => {
    RANK_MARK.forEach((mark, rank) => {
      expect(mark, `rank ${rank}`).toBe('*'.repeat(rank));
    });
  });

  // Walks the marks a real guard collects rather than the table's own indices,
  // so a rank reachable by promotion with no insignia to show shows up here as
  // an undefined in the list.
  it('has a mark on hand for every rank a guard can actually reach', () => {
    const guard = makeGuard('foot_soldier');
    const worn: (string | undefined)[] = [RANK_MARK[guard.rank]];
    while (promote(guard)) worn.push(RANK_MARK[guard.rank]);
    expect(worn).toEqual(['', '*', '**', '***']);
  });
});

describe('STARTING_GUARDS', () => {
  // Two, so the first recruit after wave 1 is a visible half again as many.
  it('sends the hero in with company rather than an escort of one', () => {
    expect(STARTING_GUARDS).toBe(2);
  });
});
