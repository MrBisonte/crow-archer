import { describe, expect, it } from 'vitest';

import {
  GUARD_KINDS,
  GUARD_STATS,
  MAX_RANK,
  OPENING_RETINUE,
  RANK_MARK,
  RECRUITABLE_GUARD_KINDS,
  RECRUIT_WEIGHTS,
  STARTING_RECRUITS,
  UNIQUE_GUARD_KINDS,
  WARD_HEAL,
  WARD_TRIGGER_HURT,
  onGuardGround,
  copyGuard,
  guardDamage,
  guardHeal,
  healGuard,
  invokeWard,
  isHurt,
  isPriest,
  makeGuard,
  missingHp,
  promote,
  rechargeWard,
  rollGuardKind,
  shouldWard,
  type Guard,
  type GuardKind,
  type PriestGuard,
  type RecruitableGuardKind,
} from './guards';
import { mulberry32 } from './rng';

/** A guard put through the ceremony `waves` times, however many of those took. */
const veteran = (kind: GuardKind, waves: number): Guard => {
  const guard = makeGuard(kind);
  for (let wave = 0; wave < waves; wave++) promote(guard);
  return guard;
};

/**
 * The priest, as a `PriestGuard` rather than a `Guard`.
 *
 * `makeGuard` is typed by its parameter, so a test that wants to read a ward
 * has to narrow. Doing it here once, with a failure that names what went wrong,
 * beats a bang at forty call sites — and it doubles as an assertion that
 * `makeGuard('priest')` really does build the priest shape.
 */
const newPriest = (): PriestGuard => {
  const guard = makeGuard('priest');
  if (!isPriest(guard)) throw new Error('makeGuard("priest") did not build a priest');
  return guard;
};

/** A guard of `kind` wounded to exactly `hp`, for the healing tests. */
const wounded = (kind: GuardKind, hp: number): Guard => {
  const guard = makeGuard(kind);
  guard.hp = hp;
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
 *  of `RECRUIT_WEIGHTS`, so weights that are all wrong together still fail. */
const INTENDED_SHARES: ReadonlyArray<[RecruitableGuardKind, number]> = [
  ['archer', 40],
  ['foot_soldier', 40],
  ['knight', 20],
];

/** The share of `DRAWS` recruits each kind won, in percent, from one seed. */
const sharesFrom = (seed: number): Record<RecruitableGuardKind, number> => {
  const rng = mulberry32(seed);
  const counts: Record<RecruitableGuardKind, number> = { archer: 0, foot_soldier: 0, knight: 0 };
  for (let draw = 0; draw < DRAWS; draw++) counts[rollGuardKind(rng)] += 1;

  const shares: Record<RecruitableGuardKind, number> = { archer: 0, foot_soldier: 0, knight: 0 };
  for (const kind of RECRUITABLE_GUARD_KINDS) shares[kind] = (counts[kind] / DRAWS) * 100;
  return shares;
};

describe('GUARD_STATS', () => {
  it.each(GUARD_KINDS)('has a usable body for %s', (kind) => {
    expect(GUARD_STATS[kind].baseHp).toBeGreaterThan(0);
  });

  // Split from the row check above rather than weakened into it. Every kind
  // needs a body; only the fighting kinds need an attack, and asserting
  // `baseDamage > 0` across the whole roster would have to be relaxed to admit
  // the priest — which is the shape of test edit that quietly stops noticing
  // an archer that came out at zero damage.
  it.each(RECRUITABLE_GUARD_KINDS)('gives %s an attack and a weight', (kind) => {
    expect(GUARD_STATS[kind].baseDamage).toBeGreaterThan(0);
    expect(RECRUIT_WEIGHTS[kind]).toBeGreaterThan(0);
  });

  // The Record type makes the compiler demand a row per kind. This is the
  // other direction: a kind quietly dropped from GUARD_KINDS would leave the
  // roll unable to draw it while every check driven off that list still passed.
  it('has exactly as many rows as there are kinds', () => {
    expect(Object.keys(GUARD_STATS)).toHaveLength(GUARD_KINDS.length);
  });

  // The roster is two lists and this is the seam between them: every kind is in
  // exactly one group, and the group lists together account for all of them.
  // A kind added to `GuardKind` without being put in a group would compile —
  // `GuardKind` is an alias, not a table — and this is what would fail.
  it('sorts every kind into exactly one of the two groups', () => {
    expect([...GUARD_KINDS].sort())
      .toEqual([...RECRUITABLE_GUARD_KINDS, ...UNIQUE_GUARD_KINDS].sort());
    expect(GUARD_KINDS).toHaveLength(RECRUITABLE_GUARD_KINDS.length + UNIQUE_GUARD_KINDS.length);
    const overlap = RECRUITABLE_GUARD_KINDS.filter((kind) =>
      (UNIQUE_GUARD_KINDS as readonly string[]).includes(kind));
    expect(overlap, 'a kind is both recruited and unique').toEqual([]);
  });

  // The weights table is keyed by the recruitable kinds, so this is the
  // runtime half of the same claim the type makes: no row for anybody else.
  it('weighs the recruitable kinds and nobody else', () => {
    expect(Object.keys(RECRUIT_WEIGHTS).sort()).toEqual([...RECRUITABLE_GUARD_KINDS].sort());
    expect(Object.keys(RECRUIT_WEIGHTS)).not.toContain('priest');
  });

  it('makes the knight the rare draw and leaves the other two even', () => {
    expect(RECRUIT_WEIGHTS.knight).toBeLessThan(RECRUIT_WEIGHTS.archer);
    expect(RECRUIT_WEIGHTS.archer).toBe(RECRUIT_WEIGHTS.foot_soldier);
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

  /**
   * The priest's row, which is the whole of "it never attacks" as far as this
   * module is concerned. Everything downstream — `guardDamage`, the loop's
   * refusal to give it a swing — is built on this zero.
   */
  it('gives the priest healing instead of an attack, and a fragile body', () => {
    expect(GUARD_STATS.priest.baseDamage).toBe(0);
    expect(GUARD_STATS.priest.baseHeal).toBeGreaterThan(0);
    expect(GUARD_STATS.priest.ranged).toBe(false);
    // Fragile: below the foot soldier it stands behind, and not above the
    // knight, which is the most any support unit on this map is allowed.
    expect(GUARD_STATS.priest.baseHp).toBeLessThan(GUARD_STATS.foot_soldier.baseHp);
    expect(GUARD_STATS.priest.baseHp).toBeLessThanOrEqual(GUARD_STATS.knight.baseHp);
  });

  it('leaves the healing to the priest and the fighting to everybody else', () => {
    for (const kind of RECRUITABLE_GUARD_KINDS) expect(GUARD_STATS[kind].baseHeal, kind).toBe(0);
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
  it('reaches every recruitable kind and invents none', () => {
    const rng = mulberry32(SEED + 1);
    const seen = new Set<RecruitableGuardKind>();
    for (let draw = 0; draw < 500; draw++) seen.add(rollGuardKind(rng));
    expect(seen).toEqual(new Set(RECRUITABLE_GUARD_KINDS));
  });

  /**
   * The rule the priest is built around, measured rather than argued.
   *
   * The type already makes this unrepresentable — `rollGuardKind` returns
   * `RecruitableGuardKind`, which has no priest in it, so a roll that produced
   * one would not compile. This is the runtime half, and it is worth having
   * anyway: types are erased, `RECRUIT_WEIGHTS` is a plain object that a
   * `Object.assign` somewhere could grow a fourth key on, and the walk in
   * `rollGuardKind` has a documented fall-through that hands back the last kind
   * it examined. Ten thousand draws across four seeds is enough that a
   * one-in-a-thousand leak would be seen roughly forty times.
   *
   * Asserted over every unique kind rather than against the literal 'priest',
   * so a second never-recruited kind is covered by this test the day it is
   * added rather than by a copy of it.
   */
  it('never draws a unique kind, over 10,000 seeded draws per seed', () => {
    const unique = new Set<string>(UNIQUE_GUARD_KINDS);
    for (const seed of [SEED, SEED + 1, 1, 20260824]) {
      const rng = mulberry32(seed);
      const leaked: string[] = [];
      for (let draw = 0; draw < DRAWS; draw++) {
        const kind: string = rollGuardKind(rng);
        if (unique.has(kind)) leaked.push(kind);
      }
      expect(leaked, `seed ${seed} recruited ${leaked.length} of ${[...unique].join(', ')}`)
        .toEqual([]);
    }
  });

  // The other end of the same rule: an rng out of contract must not fall
  // through into a kind that is not in the roll at all. The walk keeps the last
  // kind it examined, and the last kind it examines is a recruitable one.
  it('hands back a recruitable kind even for an rng that misbehaves', () => {
    for (const value of [0, 0.5, 1, 1.5, -0.2, Number.EPSILON]) {
      expect(RECRUITABLE_GUARD_KINDS, `rng() = ${value}`).toContain(rollGuardKind(() => value));
    }
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
    expect(RECRUITABLE_GUARD_KINDS).toContain(rollGuardKind(() => 1));
  });

  // The reason the rng is a parameter at all: a bastion run has to replay.
  it('rebuilds the same retinue from the same seed, and a different one from another', () => {
    const retinue = (seed: number): RecruitableGuardKind[] => {
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

  it('brings the priest in with its ward in hand, and nobody else with one', () => {
    expect(newPriest().ward).toBe('ready');
    for (const kind of RECRUITABLE_GUARD_KINDS) {
      expect(isPriest(makeGuard(kind)), kind).toBe(false);
    }
  });
});

describe('copyGuard', () => {
  it.each(GUARD_KINDS)('copies every field of a %s, sharing nothing', (kind) => {
    const original = makeGuard(kind);
    original.hp = 1;
    promote(original);

    const copy = copyGuard(original);

    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    copy.hp = 99;
    expect(original.hp).not.toBe(99);
  });

  // The reason `copyGuard` exists rather than a spread at the call site: a
  // hand-written copy is correct until a kind grows a field, and the ward is
  // that field. A copy that dropped it would hand every wave's priest a fresh
  // charge, which is the same bug as never spending one.
  it('carries the priest\'s spent ward across the copy', () => {
    const priest = newPriest();
    invokeWard(priest, []);

    const copy = copyGuard(priest);

    expect(isPriest(copy) && copy.ward).toBe('spent');
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

/**
 * The priest's ladder, which is the answer to "does it promote?".
 *
 * It does, on a track of its own. The fighting ladder's last step is +1 damage
 * and the priest has none to add to, so a shared ladder would hand it a third
 * rank that changed nothing at all — a badge that lies about what the guard
 * wearing it can do, which is worse than no badge. The ministry track keeps the
 * two health steps identical to the fighting one, because on the one unit that
 * cannot be replaced those are the steps that matter, and pays the third in
 * healing.
 */
describe('the ministry ladder', () => {
  it('climbs the priest to MAX_RANK like anybody else', () => {
    const priest = veteran('priest', 50);
    expect(priest.rank).toBe(MAX_RANK);
  });

  it('measures a senior priest at 4 hp, 0 damage and a heal of 2', () => {
    const priest = veteran('priest', MAX_RANK);
    expect(priest.maxHp).toBe(4);
    expect(priest.hp).toBe(4);
    expect(guardDamage(priest)).toBe(0);
    expect(guardHeal(priest)).toBe(2);
  });

  // The badge has to mean something at every rung, not only at the top.
  it('pays in health twice before it pays in healing', () => {
    const priest = newPriest();
    expect(guardHeal(priest)).toBe(GUARD_STATS.priest.baseHeal);

    promote(priest);
    expect(priest.maxHp).toBe(3);
    expect(guardHeal(priest)).toBe(1);

    promote(priest);
    expect(priest.maxHp).toBe(4);
    expect(guardHeal(priest)).toBe(1);

    promote(priest);
    expect(priest.maxHp).toBe(4);
    expect(guardHeal(priest)).toBe(2);
  });

  // The step it must never take. A priest that climbed the fighting ladder
  // would arrive at rank 3 with a point of damage and become the thing the
  // whole kind is defined by not being.
  it('never gives the priest a point of damage, at any rank', () => {
    const priest = newPriest();
    expect(guardDamage(priest)).toBe(0);
    while (promote(priest)) expect(guardDamage(priest), `rank ${priest.rank}`).toBe(0);
    expect(priest.rank).toBe(MAX_RANK);
    expect(guardDamage(priest)).toBe(0);
  });

  // And the mirror of it: nobody who fights collects healing by climbing.
  it('never gives a fighting kind a heal, at any rank', () => {
    for (const kind of RECRUITABLE_GUARD_KINDS) {
      const guard = makeGuard(kind);
      expect(guardHeal(guard), kind).toBe(0);
      while (promote(guard)) expect(guardHeal(guard), `${kind} rank ${guard.rank}`).toBe(0);
    }
  });

  it('wears the same insignia as everybody else, one star a rank', () => {
    const priest = newPriest();
    const worn: (string | undefined)[] = [RANK_MARK[priest.rank]];
    while (promote(priest)) worn.push(RANK_MARK[priest.rank]);
    expect(worn).toEqual(['', '*', '**', '***']);
  });
});

describe('healing', () => {
  it('restores exactly what it is given, and no more than is missing', () => {
    const guard = wounded('foot_soldier', 1);
    expect(healGuard(guard, 1)).toBe(1);
    expect(guard.hp).toBe(2);
  });

  it.each(GUARD_KINDS)('never takes %s above its maximum', (kind) => {
    const guard = makeGuard(kind);
    guard.hp = guard.maxHp - 1 > 0 ? guard.maxHp - 1 : guard.maxHp;

    for (const amount of [1, 3, 99]) healGuard(guard, amount);

    expect(guard.hp).toBe(guard.maxHp);
  });

  it('restores nothing to a guard that is already whole, and says so', () => {
    const guard = makeGuard('foot_soldier');
    expect(healGuard(guard, 3)).toBe(0);
    expect(guard.hp).toBe(guard.maxHp);
  });

  // A heal that can subtract is a damage path no damage bookkeeping would see.
  it('refuses to wound with a negative amount', () => {
    const guard = wounded('foot_soldier', 2);
    expect(healGuard(guard, -5)).toBe(0);
    expect(guard.hp).toBe(2);
  });

  it('reports how much actually landed when the guard is nearly whole', () => {
    const guard = wounded('foot_soldier', 2); // 1 missing of 3
    expect(healGuard(guard, 3)).toBe(1);
    expect(guard.hp).toBe(3);
  });

  it('reads a guard\'s need off its maximum, not off its kind', () => {
    const guard = wounded('foot_soldier', 1);
    expect(missingHp(guard)).toBe(2);
    expect(isHurt(guard)).toBe(true);

    healGuard(guard, 2);
    expect(missingHp(guard)).toBe(0);
    expect(isHurt(guard)).toBe(false);
  });

  /**
   * Rank moves both numbers, so "hurt" means the same thing after a promotion
   * as before it.
   *
   * A whole guard comes out of the ceremony whole — `promote` raises current hp
   * with max hp — so the priest does not spend the wave after every promotion
   * topping up allies that are not actually hurt. A hurt one comes out missing
   * exactly what it was missing, because the step was added to both sides.
   */
  it('leaves a promotion\'s arithmetic alone: whole stays whole, hurt stays hurt', () => {
    const whole = makeGuard('foot_soldier');
    promote(whole);
    expect(whole.maxHp).toBe(4);
    expect(isHurt(whole), 'a promotion invented a wound').toBe(false);

    const hurt = wounded('foot_soldier', 1); // two short of three
    expect(missingHp(hurt)).toBe(2);
    promote(hurt);
    expect(hurt.maxHp).toBe(4);
    expect(missingHp(hurt), 'a promotion changed how hurt a guard is').toBe(2);
  });

  // The single-target heal, at the strength the priest's rank says. This is the
  // pairing the loop makes: `healGuard(target, guardHeal(priest))`.
  it('mends 1 from a fresh priest and 2 from a senior one', () => {
    const fresh = newPriest();
    const target = wounded('foot_soldier', 1);
    expect(healGuard(target, guardHeal(fresh))).toBe(1);
    expect(target.hp).toBe(2);

    const senior = veteran('priest', MAX_RANK);
    const other = wounded('foot_soldier', 1);
    expect(healGuard(other, guardHeal(senior))).toBe(2);
    expect(other.hp).toBe(3);
  });
});

describe('the ward', () => {
  /**
   * A retinue with room to take a whole ward.
   *
   * Rank 2 foot soldiers, so `maxHp` is 5 and a +3 lands as a +3 rather than as
   * a clamp to the top — a congregation of fresh recruits would pass the same
   * assertion whether the sweep healed 3 or 30.
   */
  const congregation = (): Guard[] => {
    const hurt = (hp: number): Guard => {
      const guard = veteran('foot_soldier', 2);
      guard.hp = hp;
      return guard;
    };
    return [hurt(1), hurt(2), hurt(5)];
  };

  it('restores WARD_HEAL to everyone it reaches', () => {
    const priest = newPriest();
    const allies = congregation();

    invokeWard(priest, allies);

    expect(WARD_HEAL).toBe(3);
    expect(allies.map((guard) => guard.hp)).toEqual([1 + WARD_HEAL, 2 + WARD_HEAL, 5]);
  });

  it('never takes anybody above their maximum, however hurt the rest are', () => {
    const priest = newPriest();
    const allies = [wounded('knight', 1), wounded('foot_soldier', 1)];

    invokeWard(priest, allies);

    for (const guard of allies) expect(guard.hp, guard.kind).toBe(guard.maxHp);
  });

  // The decision recorded in `congregation`: the priest blesses itself. It is
  // the one guard the run cannot replace, and an ability that skipped it would
  // make "keep the healer alive" the only play the map has.
  it('heals the priest along with everyone else, without being passed itself', () => {
    const priest = newPriest();
    priest.hp = 1;

    invokeWard(priest, [wounded('foot_soldier', 1)]);

    expect(priest.hp).toBe(priest.maxHp);
  });

  it('does not heal the priest twice when it is passed in as well', () => {
    // Senior, so maxHp is 4 and there is room for a double heal to show up.
    const priest = newPriest();
    while (promote(priest)) { /* to the top of the ministry ladder */ }
    priest.hp = 1;

    const restored = invokeWard(priest, [priest]);

    expect(priest.hp).toBe(4);
    expect(restored).toBe(3);
  });

  it('reports the health it actually restored across everybody', () => {
    const priest = newPriest();
    const allies = [wounded('foot_soldier', 1), makeGuard('foot_soldier')];

    // 2 into the hurt foot soldier, 0 into the whole one, 0 into the whole priest.
    expect(invokeWard(priest, allies)).toBe(2);
  });

  it('fires once and is empty afterwards', () => {
    const priest = newPriest();
    const allies = congregation();

    expect(shouldWard(priest, allies)).toBe(true);
    invokeWard(priest, allies);
    expect(priest.ward).toBe('spent');
    expect(shouldWard(priest, allies)).toBe(false);

    const hpAfterFirst = allies.map((guard) => guard.hp);
    // A caller that asks again gets no second sweep out of the rule.
    expect(shouldWard(priest, congregation())).toBe(false);
    expect(allies.map((guard) => guard.hp)).toEqual(hpAfterFirst);
  });

  it('spends the charge even on a sweep that healed nobody', () => {
    const priest = newPriest();

    expect(invokeWard(priest, [makeGuard('foot_soldier')])).toBe(0);
    expect(priest.ward).toBe('spent');
  });

  it('holds the charge for one hurt ally and spends it on two', () => {
    expect(WARD_TRIGGER_HURT).toBe(2);
    expect(shouldWard(newPriest(), [wounded('foot_soldier', 1)])).toBe(false);
    expect(shouldWard(newPriest(), [wounded('foot_soldier', 1), wounded('knight', 1)])).toBe(true);
  });

  // The priest counts towards its own trigger, because it is healed by its own
  // ward. A priest bleeding beside one hurt ally is two hurt allies.
  it('counts itself among the hurt', () => {
    const priest = newPriest();
    priest.hp = 1;

    expect(shouldWard(priest, [wounded('foot_soldier', 1)])).toBe(true);
    expect(shouldWard(newPriest(), [wounded('foot_soldier', 1)])).toBe(false);
  });

  it('is handed back by rechargeWard and by nothing else', () => {
    const priest = newPriest();
    invokeWard(priest, []);
    expect(priest.ward).toBe('spent');

    // Promotion is the other thing that happens to a survivor between waves,
    // and it must not be what restores the charge.
    promote(priest);
    expect(priest.ward).toBe('spent');

    rechargeWard(priest);
    expect(priest.ward).toBe('ready');
  });

  it('is a no-op on a kind with no ward to hand back', () => {
    for (const kind of RECRUITABLE_GUARD_KINDS) {
      const guard = makeGuard(kind);
      expect(() => rechargeWard(guard), kind).not.toThrow();
      expect(isPriest(guard), kind).toBe(false);
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

describe('the opening retinue', () => {
  // Two, so the first recruit after wave 1 is a visible half again as many.
  it('sends the hero in with company rather than an escort of one', () => {
    expect(STARTING_RECRUITS).toBe(2);
  });

  // The rename is the point of this one. `STARTING_GUARDS` used to be both the
  // number rolled and the number standing, and the priest split those two
  // meanings apart; a constant that still answered "how many guards" with the
  // number of recruits would be wrong in the direction nobody checks.
  it('counts the unique kinds on top of the recruits', () => {
    expect(OPENING_RETINUE).toBe(STARTING_RECRUITS + UNIQUE_GUARD_KINDS.length);
    expect(OPENING_RETINUE).toBeGreaterThan(STARTING_RECRUITS);
    expect(OPENING_RETINUE).toBe(3);
  });
});

describe('onGuardGround', () => {
  const LEASH = 170;
  const post = { x: 0, y: 0 };

  /**
   * The measured bastion geometry that broke the old region: at 55x33 the
   * nearest gate is this far from where the hero spawns, against a leash of
   * 170. Two discs centred on the ends stop overlapping past 340, leaving a
   * guard that walks toward the hero off-duty in the middle of its own walk.
   */
  const GATE_TO_HERO = 386.7;

  it('answers for its own post', () => {
    expect(onGuardGround(post, { x: 400, y: 0 }, 0, 0, LEASH)).toBe(true);
  });

  it('answers for the hero, however far off the post they stand', () => {
    const hero = { x: 2000, y: 0 };
    expect(onGuardGround(post, hero, hero.x, hero.y, LEASH)).toBe(true);
  });

  it('stays connected across the gap that broke it', () => {
    const hero = { x: GATE_TO_HERO, y: 0 };
    // Every step of the walk from post to hero, not just the ends.
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const x = hero.x * t;
      expect(onGuardGround(post, hero, x, 0, LEASH), `off duty at t=${t.toFixed(2)}`).toBe(true);
    }
  });

  it('stays connected at any separation, so no grid size can break it again', () => {
    for (const gap of [0, 170, 340, 386.7, 1000, 4096]) {
      const hero = { x: gap, y: 0 };
      expect(onGuardGround(post, hero, gap / 2, 0, LEASH), `midpoint at gap ${gap}`).toBe(true);
    }
  });

  it('is no wider sideways than the leash, so a guard still will not wander off', () => {
    const hero = { x: 400, y: 0 };
    expect(onGuardGround(post, hero, 200, LEASH - 1, LEASH)).toBe(true);
    expect(onGuardGround(post, hero, 200, LEASH + 1, LEASH)).toBe(false);
  });

  it('does not answer for ground beyond either end', () => {
    const hero = { x: 400, y: 0 };
    expect(onGuardGround(post, hero, -LEASH - 1, 0, LEASH)).toBe(false);
    expect(onGuardGround(post, hero, 400 + LEASH + 1, 0, LEASH)).toBe(false);
  });

  it('is a plain disc when the hero stands on the post', () => {
    expect(onGuardGround(post, post, LEASH - 1, 0, LEASH)).toBe(true);
    expect(onGuardGround(post, post, LEASH + 1, 0, LEASH)).toBe(false);
  });
});
