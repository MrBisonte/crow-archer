/**
 * The talent system's pure half, checked as data and arithmetic.
 *
 * Three structures share this model and the tests hold their seams honest:
 * the per-character trees (tiers bought with mastery, which also gates them),
 * mastery itself (earned from finishing things only), and the run layer (owned
 * talents are drafted into a loadout, and the capstone is chosen mid-run at
 * the rite). Everything here runs without a canvas, a frame loop or a save
 * file, the same way upgrades.test.ts holds the FEATHERS tree.
 *
 * Table shapes are compared against exact key sets, never lengths: a length
 * check catches a deletion and misses an addition, and a hero missing a tree
 * is precisely the silent fall-through the design-patterns doc records
 * shipping once already.
 */

import { describe, expect, it } from 'vitest';

import { CHARACTERS } from '../net/protocol';
import { mulberry32 } from './rng';
import {
  masteryAvailable,  clampCursor,  CAPSTONE_RANK,
  CHAR_TREES,
  MASTERY_AWARDS,
  RANK_THRESHOLDS,
  bossMastery,
  draftOffers,
  draftedValue,
  masteryAfter,
  ownedIds,
  purchaseTalent,
  rankOf,
  riteEligible,
  talentBankFrom,
  talentLevel,
  talentStateFrom,
  talentValue,
  tierOpenAt,
  type CharTalentState,
  type MasteryMilestone,
} from './talents';

/** A fresh character: no mastery, nothing bought. */
const fresh = (): CharTalentState => ({ mastery: 0, spent: 0, levels: {} });

/** A character who has earned `points` and spent none of them. */
const withPurse = (points: number): CharTalentState =>
  ({ mastery: points, spent: 0, levels: {} });

/** Mastery points that put a character at exactly `rank`. */
const pointsForRank = (rank: number): number =>
  rank === 0 ? 0 : RANK_THRESHOLDS[rank - 1]!;

describe('the tree table', () => {
  it('carries a row for every character the protocol knows', () => {
    expect(new Set(Object.keys(CHAR_TREES))).toEqual(new Set(CHARACTERS));
  });

  it('gives every talent a unique id, a label, a desc and a real price', () => {
    for (const [char, tree] of Object.entries(CHAR_TREES)) {
      const ids = tree.talents.map((t) => t.id);
      expect(new Set(ids).size, `${char} repeats a talent id`).toBe(ids.length);
      for (const t of tree.talents) {
        expect(t.label.length, `${char}.${t.id}`).toBeGreaterThan(0);
        expect(t.desc.length, `${char}.${t.id}`).toBeGreaterThan(0);
        expect(t.costs.length, `${char}.${t.id}`).toBeGreaterThan(0);
        for (const c of t.costs) expect(c, `${char}.${t.id}`).toBeGreaterThan(0);
        expect([1, 2, 3], `${char}.${t.id} tier`).toContain(t.tier);
      }
    }
  });

  it('offers no rite of one: capstones come in twos or not at all', () => {
    // A rite with a single option is not a choice, it is a cutscene.
    for (const [char, tree] of Object.entries(CHAR_TREES)) {
      if (tree.capstones.length > 0) {
        expect(tree.capstones.length, char).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('pilots with the wizard: Focus depth at tier 1, one more bolt per pool', () => {
    // The owner's words set this figure: "if he scales it he could fire up to
    // 3/4 bolts with a full pool" — base 3, so the talent is +1.
    const depth = CHAR_TREES.wizard.talents.find((t) => t.id === 'focusDepth');
    expect(depth).toBeDefined();
    expect(depth?.tier).toBe(1);
    expect(depth?.effect).toEqual({ kind: 'linear', per: 1 });
    expect(talentValue(CHAR_TREES.wizard, { mastery: 0, spent: 0, levels: { focusDepth: 1 } }, 'focusDepth', 3)).toBe(4);
  });

  it('gives the wizard a rite worth holding', () => {
    expect(CHAR_TREES.wizard.capstones.length).toBeGreaterThanOrEqual(2);
  });
});

describe('mastery', () => {
  it('pays for exactly the milestones the design names', () => {
    expect(new Set(Object.keys(MASTERY_AWARDS))).toEqual(
      new Set<MasteryMilestone>(['boss_down', 'stage_cleared', 'siege_cleared', 'run_won']),
    );
    for (const points of Object.values(MASTERY_AWARDS)) {
      expect(points).toBeGreaterThan(0);
    }
  });

  it('sums a run of milestones', () => {
    const run: MasteryMilestone[] = ['boss_down', 'stage_cleared', 'boss_down'];
    expect(masteryAfter(0, run)).toBe(
      MASTERY_AWARDS.boss_down * 2 + MASTERY_AWARDS.stage_cleared,
    );
  });

  it('climbs ranks at the thresholds and nowhere else', () => {
    expect(rankOf(0)).toBe(0);
    for (const [i, at] of RANK_THRESHOLDS.entries()) {
      expect(rankOf(at - 1), `just under threshold ${i}`).toBe(i);
      expect(rankOf(at), `at threshold ${i}`).toBe(i + 1);
    }
    // Monotonic: more points never cost a rank.
    expect(rankOf(10_000)).toBe(RANK_THRESHOLDS.length);
  });

  it('opens tier 1 to a brand-new character', () => {
    // A hero with no mastery must still have something to buy, or the pool
    // the run draft draws from can never start existing.
    expect(tierOpenAt(0, 1)).toBe(true);
    expect(tierOpenAt(0, 2)).toBe(false);
    expect(tierOpenAt(0, 3)).toBe(false);
  });

  it('opens each later tier one rank up, and the rite last of all', () => {
    expect(tierOpenAt(pointsForRank(1), 2)).toBe(true);
    expect(tierOpenAt(pointsForRank(1), 3)).toBe(false);
    expect(tierOpenAt(pointsForRank(2), 3)).toBe(true);
    expect(riteEligible(pointsForRank(CAPSTONE_RANK) - 1)).toBe(false);
    expect(riteEligible(pointsForRank(CAPSTONE_RANK))).toBe(true);
  });
});

describe('buying a talent', () => {
  const tree = CHAR_TREES.wizard;

  it('refuses a tier the mastery rank has not opened', () => {
    const t2 = tree.talents.find((t) => t.tier === 2);
    expect(t2, 'the pilot tree needs a tier-2 talent to test the gate').toBeDefined();
    const result = purchaseTalent(tree, fresh(), t2!.id);
    expect(result.kind).toBe('tierLocked');
    if (result.kind === 'tierLocked') {
      expect(result.rankNeeded).toBeGreaterThan(0);
      expect(result.rankHeld).toBe(0);
    }
  });

  it('refuses what the purse cannot cover, and says how short', () => {
    const t1 = tree.talents.find((t) => t.tier === 1)!;
    const cost = t1.costs[0]!;
    const result = purchaseTalent(tree, withPurse(cost - 1), t1.id);
    expect(result.kind).toBe('tooPoor');
    if (result.kind === 'tooPoor') expect(result.short).toBe(1);
  });

  it('buys a level, spends the mastery, and stays pure', () => {
    const t1 = tree.talents.find((t) => t.tier === 1)!;
    const before = withPurse(50);
    const result = purchaseTalent(tree, before, t1.id);
    expect(result.kind).toBe('bought');
    if (result.kind === 'bought') {
      expect(result.spent).toBe(t1.costs[0]);
      expect(talentLevel(result.state, t1.id)).toBe(1);
      expect(result.state.spent, 'the debt did not grow by the price').toBe(t1.costs[0]);
      expect(result.state.mastery, 'buying cost the player earned rank').toBe(50);
    }
    // The state handed in was not written to.
    expect(talentLevel(before, t1.id)).toBe(0);
    expect(before.spent).toBe(0);
  });

  it('never lets a purchase close a tier the player already opened', () => {
    // The whole reason `mastery` and `spent` are two figures. Spend a rank-III
    // character down to nothing and every tier they reached stays reachable.
    const rich = { mastery: pointsForRank(CAPSTONE_RANK), spent: 0, levels: {} };
    const t1 = tree.talents.find((t) => t.tier === 1)!;
    const r = purchaseTalent(tree, rich, t1.id);
    expect(r.kind).toBe('bought');
    if (r.kind !== 'bought') return;
    const broke = { ...r.state, spent: r.state.mastery };
    expect(masteryAvailable(broke), 'the purse should be empty').toBe(0);
    expect(rankOf(broke.mastery), 'spending cost them their rank').toBe(CAPSTONE_RANK);
    expect(tierOpenAt(broke.mastery, 2), 'a tier closed when the purse emptied').toBe(true);
  });

  it('stops at the top of the cost ladder', () => {
    const t1 = tree.talents.find((t) => t.tier === 1)!;
    let state = withPurse(10_000);
    for (let i = 0; i < t1.costs.length; i++) {
      const r = purchaseTalent(tree, state, t1.id);
      expect(r.kind).toBe('bought');
      if (r.kind === 'bought') state = r.state;
    }
    expect(purchaseTalent(tree, state, t1.id).kind).toBe('maxed');
  });

  it('throws on an id the tree does not hold, rather than inventing a row', () => {
    expect(() => purchaseTalent(tree, fresh(), 'notATalent')).toThrow();
  });
});

describe('reading the save file', () => {
  const tree = CHAR_TREES.wizard;

  it('reads a well-formed slice back exactly', () => {
    const state = talentStateFrom(tree, { mastery: 7, levels: { blinkReach: 2 } });
    expect(state.mastery).toBe(7);
    expect(talentLevel(state, 'blinkReach')).toBe(2);
  });

  it('drops unknown ids and clamps levels into the ladder', () => {
    const state = talentStateFrom(tree, {
      mastery: 3.9,
      levels: { blinkReach: 99, focusDepth: -2, notATalent: 5, stormWidth: 'two' },
    });
    // blinkReach's ladder is its costs array; 99 is clamped to its top.
    const blink = tree.talents.find((t) => t.id === 'blinkReach')!;
    expect(talentLevel(state, 'blinkReach')).toBe(blink.costs.length);
    expect(talentLevel(state, 'focusDepth')).toBe(0);
    expect(state.levels).not.toHaveProperty('notATalent');
    expect(state.levels).not.toHaveProperty('stormWidth');
    expect(state.mastery).toBe(3);
  });

  it('treats junk — or nothing — as a fresh character', () => {
    for (const raw of [null, undefined, 42, 'save', { mastery: 'ten', levels: 7 }]) {
      const state = talentStateFrom(tree, raw);
      expect(state.mastery).toBe(0);
      expect(Object.keys(state.levels)).toEqual([]);
    }
  });

  it('banks a row for every character, fresh where the file has none', () => {
    const bank = talentBankFrom({ wizard: { mastery: 5, levels: { focusDepth: 1 } } });
    expect(new Set(Object.keys(bank))).toEqual(new Set(CHARACTERS));
    expect(bank.wizard.mastery).toBe(5);
    expect(bank.archer.mastery).toBe(0);
  });
});

describe('the run layer arithmetic', () => {
  const tree = CHAR_TREES.wizard;
  const owned: CharTalentState = { mastery: 0, spent: 0, levels: { blinkReach: 1, focusDepth: 1 } };

  it('lists exactly the talents held at level one or higher as the pool', () => {
    expect(new Set(ownedIds(tree, owned))).toEqual(new Set(['blinkReach', 'focusDepth']));
    expect(ownedIds(tree, { mastery: 9, spent: 0, levels: {} })).toEqual([]);
  });

  it('pays a talent only if this run drafted it', () => {
    expect(draftedValue(tree, owned, ['blinkReach'], 'blinkReach', 160)).toBe(180);
    // Owned but undrafted is the base — ownership grows options, not power.
    expect(draftedValue(tree, owned, [], 'blinkReach', 160)).toBe(160);
    // Drafted but unowned (level 0) is also the base.
    expect(draftedValue(tree, owned, ['stormWidth'], 'stormWidth', 450)).toBe(450);
  });
});

describe('the run draft', () => {
  const rng = () => mulberry32(7);

  it('offers only what is owned, without repeats', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const offers = draftOffers(pool, rng(), 3);
    expect(offers.length).toBe(3);
    expect(new Set(offers).size).toBe(3);
    for (const id of offers) expect(pool).toContain(id);
  });

  it('offers the whole pool when it is smaller than the ask', () => {
    expect(new Set(draftOffers(['a', 'b'], rng(), 3))).toEqual(new Set(['a', 'b']));
    expect(draftOffers([], rng(), 3)).toEqual([]);
  });

  it('never re-offers what this run already drafted', () => {
    // A second draft at the boss that offers the talent already taken at the
    // start is a dead pick wearing a choice's clothes.
    const pool = ['a', 'b', 'c', 'd'];
    const offers = draftOffers(pool, rng(), 3, ['b', 'd']);
    expect(offers.every((id) => id === 'a' || id === 'c')).toBe(true);
  });

  it('deals the same offers for the same seed', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(draftOffers(pool, mulberry32(41), 3)).toEqual(draftOffers(pool, mulberry32(41), 3));
  });
});

describe('clampCursor', () => {
  it('keeps a cursor inside the list it is pointing at', () => {
    expect(clampCursor(3, 0)).toBe(0);
    expect(clampCursor(3, 2)).toBe(2);
  });

  it('pulls a cursor carried from a longer list back onto the last row', () => {
    // The real case: the shop cursor outlives a character switch, and the
    // trees are authored one per hero. A cursor of 4 on a tree of three rows
    // indexes past the end and the screen buys undefined.
    expect(clampCursor(3, 4)).toBe(2);
    expect(clampCursor(1, 9)).toBe(0);
  });

  it('answers zero for an empty list rather than minus one', () => {
    // A hero with no tree yet is a real state - `capstones` is documented as
    // allowed to be empty - and -1 would index from the end of the array.
    expect(clampCursor(0, 0)).toBe(0);
    expect(clampCursor(0, 7)).toBe(0);
  });

  it('refuses a negative or fractional cursor', () => {
    expect(clampCursor(3, -1)).toBe(0);
    expect(clampCursor(3, 1.9)).toBe(1);
  });
});

/**
 * A rank nobody can reach is a rank that does not exist.
 *
 * Mastery is banked all over a run, but it can only be SPENT or SEALED when a
 * ceremony opens, and a ceremony opens on a boss death and nowhere else:
 * `queueBossChoosers` in game.js is called from two boss-death handlers, it
 * returns early mid-siege, the minotaur cannot die, and the maze door, the
 * siege win and the win screen queue nothing. So the question a threshold has
 * to answer is not "is this reachable" but "is this reachable AT A BOSS".
 *
 * The thresholds were [4, 10, 18] against a campaign that banks 15, and the
 * most a player can hold at any boss death in a first run is 8. Rank II and
 * rank III were both unreachable in run 1 — a tier-III talent could not be
 * bought and the rite could not be sealed until the second boss of a second
 * run. Nothing failed, because nothing was looking.
 *
 * This mirrors the award order in `game.js` rather than driving it. If that
 * order changes — a boss that stops paying, a stage hand-off that starts —
 * this table has to change with it, and the comment on each row says which
 * call site it stands for.
 */
/**
 * One shape, five heroes.
 *
 * The ranks are one-per-boss, so every player meets the same ladder at the
 * same three moments whoever they picked. A tier that exists for one hero and
 * not another turns a rank-up into a lottery: the wizard finds something to
 * buy and the sapper finds an empty screen.
 *
 * Talent tiers only, for now. The capstone count is deliberately NOT asserted
 * equal yet — the wizard has three and the other four have two, and the third
 * for each of them is a new rule in game.js rather than a row in a table. When
 * they land, add the count here and this comment goes away.
 */
describe('treesShareOneShape', () => {
  const PER_TIER: Readonly<Record<number, number>> = { 1: 2, 2: 2, 3: 1 };

  for (const char of CHARACTERS) {
    it(`${char} has two tier-I talents, two tier-II and one tier-III`, () => {
      const tree = CHAR_TREES[char];
      for (const [tier, want] of Object.entries(PER_TIER)) {
        const got = tree.talents.filter((t) => t.tier === Number(tier));
        expect(got.length, `${char} tier ${tier}: ${got.map((t) => t.label).join(', ') || 'none'}`)
          .toBe(want);
      }
      // Nothing outside the three tiers, so a fourth cannot appear unnoticed.
      expect(tree.talents.length).toBe(5);
    });

    it(`${char} offers a rite worth holding`, () => {
      expect(CHAR_TREES[char].capstones.length).toBeGreaterThanOrEqual(2);
    });

    // A tier is what a rank BUYS, and a rank arrives at the same boss for
    // everyone. Two heroes reaching rank I and being offered 7 points of
    // talent and 14 points of talent are not on the same ladder, whatever
    // the tier counts say -- the ranger's tree ran 64% dearer than the
    // knight's on a shape test that passed.
    it(`${char} prices a tier the same as every other hero does`, () => {
      const WANT: Readonly<Record<number, number>> = { 2: 5, 3: 3 };
      for (const talent of CHAR_TREES[char].talents) {
        const want = WANT[talent.tier];
        if (want === undefined) continue;          // tier I is not levelled yet
        const paid = talent.costs.reduce((a, b) => a + b, 0);
        expect(paid, `${char}.${talent.label} costs ${talent.costs.join('+')}`)
          .toBe(want);
      }
    });

    // A tier nobody can afford at the rank that opens it is a tier that opens
    // one boss later than it says it does.
    it(`${char} can afford something the moment a tier opens`, () => {
      for (const tier of [2, 3]) {
        const opens = RANK_THRESHOLDS[tier - 2]!;
        const first = CHAR_TREES[char].talents
          .filter((t) => t.tier === tier)
          .map((t) => t.costs[0]!);
        expect(Math.min(...first), `${char} tier ${tier} opens at ${opens} earned`)
          .toBeLessThanOrEqual(opens);
      }
    });
  }
});

describe('masteryThroughACampaign', () => {
  /** What the run banks, in the order game.js banks it. */
  const CAMPAIGN: ReadonlyArray<{
    at: string; pays: number; ceremony: boolean;
  }> = [
    // killBoss: awardBoss('crowking'), then the branch's stage_cleared, then
    // queueBossChoosers.
    { at: 'crow king', pays: bossMastery('crowking') + MASTERY_AWARDS.stage_cleared, ceremony: true },
    { at: 'dark archer', pays: bossMastery('dark_archer') + MASTERY_AWARDS.stage_cleared, ceremony: true },
    { at: 'dark knight', pays: bossMastery('dark_knight') + MASTERY_AWARDS.stage_cleared, ceremony: true },
    // The golden door hands off to the bastion. It pays, and opens nothing.
    { at: 'maze door', pays: MASTERY_AWARDS.stage_cleared, ceremony: false },
    // The minotaur cannot die, so the maze has no boss death in it at all.
    { at: 'siege cleared', pays: MASTERY_AWARDS.siege_cleared, ceremony: false },
    { at: 'run won', pays: MASTERY_AWARDS.run_won, ceremony: false },
  ];

  /** Running total after each milestone. */
  function banked(): { at: string; total: number; ceremony: boolean }[] {
    let total = 0;
    return CAMPAIGN.map(({ at, pays, ceremony }) => {
      total += pays;
      return { at, total, ceremony };
    });
  }

  it('pays 15 for a full winning campaign', () => {
    expect(banked().at(-1)!.total).toBe(15);
  });

  it('opens every rank at a boss death, where a ceremony can use it', () => {
    const atACeremony = banked().filter((m) => m.ceremony);
    // The ceiling: what the player holds at the LAST moment a ceremony can
    // open in a first run. Every threshold has to sit at or under it.
    const ceiling = atACeremony.at(-1)!.total;

    for (const [i, at] of RANK_THRESHOLDS.entries()) {
      expect(at, `rank ${i + 1} is above the last ceremony of a first run`)
        .toBeLessThanOrEqual(ceiling);
      expect(
        atACeremony.some((m) => m.total === at),
        `rank ${i + 1} (${at}) is crossed between ceremonies, not at one`,
      ).toBe(true);
    }
  });

  it('seals the rite in a first run, at the last boss before the bastion', () => {
    const sealable = banked().filter((m) => m.ceremony && riteEligible(m.total));
    expect(sealable.length, 'no ceremony in a first run can seal the rite').toBeGreaterThan(0);
    expect(sealable[0]!.at).toBe('dark knight');
  });

  // One boss, one tier, in order. This is what makes the ladder legible
  // without a screen explaining it: the next rank is always the next boss.
  it('opens exactly one rank per boss', () => {
    const ceremonies = banked().filter((m) => m.ceremony);
    expect(ceremonies.length).toBe(RANK_THRESHOLDS.length);
    for (const [i, m] of ceremonies.entries()) {
      expect(rankOf(m.total), `after the ${m.at}`).toBe(i + 1);
    }
  });
});

