/**
 * The talent system's pure half: per-character trees, mastery, and the run
 * draft. The arithmetic sibling of `upgrades.ts`, built to the same rule —
 * everything here is a function of plain data, checkable without a canvas, a
 * frame loop or a save file. The wallet, the save format and the screens stay
 * with their owners in `game.js`.
 *
 * ## The three structures, as the owner decided them
 *
 * **The baseline** is the existing FEATHERS tree (`upgrades.ts`), which keeps
 * the generic axes — health, speed, plume, ward. It is not modelled here; the
 * kit-specific axes migrate out of it into the trees below in a later pass.
 *
 * **A character's tree** is tiers climbed with feathers and *gated by
 * mastery*: a purchase costs feathers from the one shared wallet, but a tier
 * only opens once that character's mastery rank reaches it. Mastery is earned
 * from run milestones only — bosses downed, stages cleared, sieges survived —
 * never from grinding kills, so a bad run pays nothing and a finished one
 * pays well.
 *
 * **The run layer** is drafting what you own. Owned talents form a pool;
 * a run offers a pick of three at the start and another at each boss, and
 * only drafted talents are active. Ownership grows *options*, not raw power.
 * The capstones sit apart from that: reaching the top rank earns the *rite*,
 * a mid-run choice offered once the first boss is down, picking one exclusive
 * capstone for the rest of that run.
 *
 * ## Shape rules carried over from upgrades.ts
 *
 * One table, `Record<CharacterKind, …>`, so the compiler names any hero
 * missing a tree — the design-patterns doc records how a positional
 * fall-through shipped a broken sapper once already. Costs are an array,
 * cheapest first, so the maximum level is the array's length and is never
 * written twice. Effects reuse `UpgradeEffect`: a linear stat over a
 * caller-owned base, or an unlock that is simply held.
 */

import type { CharacterKind } from '../net/protocol';
import type { Rng } from './rng';
import type { UpgradeEffect } from './upgrades';

/** The climbable tiers. The rite (capstones) sits above them, rank-earned. */
export type TalentTier = 1 | 2 | 3;

/** One purchasable talent in a character's tree. */
export interface TalentSpec {
  /** Unique within its tree; the save file and the draft both key on it. */
  readonly id: string;
  /** Shown on the tree screen and on draft cards. */
  readonly label: string;
  readonly desc: string;
  readonly tier: TalentTier;
  /** Feathers per level, cheapest first. Length is the maximum level. */
  readonly costs: readonly number[];
  readonly effect: UpgradeEffect;
}

/**
 * One of the exclusive picks the rite offers mid-run.
 *
 * No cost and no levels: a capstone is not bought, it is *earned* — reaching
 * `CAPSTONE_RANK` is the price, and the rite's choice is per run.
 */
export interface CapstoneSpec {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
}

/** A character's whole tree: the climbable talents and the rite's options. */
export interface CharTree {
  readonly talents: readonly TalentSpec[];
  /** Zero (tree not built yet) or at least two — a rite of one is a cutscene. */
  readonly capstones: readonly CapstoneSpec[];
}

/**
 * Every character's tree. The wizard pilots; the other four are explicit
 * empty rows rather than absent ones, so building their trees is filling a
 * row that already exists and forgetting one is a compile error, not a
 * fall-through.
 *
 * Pilot figures: FOCUS DEPTH is owner-specified — "if he scales it he could
 * fire up to 3/4 bolts with a full pool" — so it is +1 over the base pool of
 * 3, one level. The other rows are priced into the FEATHERS tree's existing
 * band (5–45) and their effects are wired to consumers in the pilot's later
 * commits; a row whose effect nothing reads yet must not ship past that.
 */
export const CHAR_TREES: Record<CharacterKind, CharTree> = {
  archer: { talents: [], capstones: [] },
  wizard: {
    talents: [
      {
        id: 'focusDepth', label: 'FOCUS DEPTH',
        desc: '+1 Focus: a full pool casts four bolts',
        tier: 1, costs: [26], effect: { kind: 'linear', per: 1 },
      },
      {
        id: 'blinkReach', label: 'LONG STEP',
        desc: '+20 px blink distance / level',
        tier: 1, costs: [12, 24], effect: { kind: 'linear', per: 20 },
      },
      {
        id: 'stormWidth', label: 'WIDER SKY',
        desc: '+50 px storm radius / level',
        tier: 2, costs: [20, 38], effect: { kind: 'linear', per: 50 },
      },
    ],
    capstones: [
      {
        id: 'overchannel', label: 'OVERCHANNEL',
        desc: 'Bolts cost no Focus for 4 s after a blink lands',
      },
      {
        id: 'stormcaller', label: 'STORMCALLER',
        desc: 'Lightning Storm recharges twice as fast',
      },
    ],
  },
  knight: { talents: [], capstones: [] },
  ranger: { talents: [], capstones: [] },
  sapper: { talents: [], capstones: [] },
};

/** What one character has: mastery points banked and talent levels bought. */
export interface CharTalentState {
  readonly mastery: number;
  readonly levels: Readonly<Record<string, number>>;
}

// ── Mastery ──────────────────────────────────────────────────────────────────

/** The run milestones that pay mastery. Nothing else does, by design. */
export type MasteryMilestone = 'boss_down' | 'stage_cleared' | 'siege_cleared' | 'run_won';

/**
 * Points per milestone. Chunky on purpose: mastery pays for *finishing
 * things* as a character, so a run abandoned at the first wave banks nothing
 * and a siege survived banks the most.
 */
export const MASTERY_AWARDS: Record<MasteryMilestone, number> = {
  boss_down: 2,
  stage_cleared: 1,
  siege_cleared: 3,
  run_won: 3,
};

/**
 * Points at which each rank is reached: rank N at `RANK_THRESHOLDS[N - 1]`.
 * Rank 0 is free — a brand-new character must have something to buy, or the
 * pool the run draft draws from can never start existing.
 */
export const RANK_THRESHOLDS: readonly number[] = [4, 10, 18];

/** The rank the rite demands. The top of the ladder, deliberately. */
export const CAPSTONE_RANK = RANK_THRESHOLDS.length;

/** Mastery after a run's milestones land on what was already banked. */
export function masteryAfter(banked: number, milestones: readonly MasteryMilestone[]): number {
  return milestones.reduce((sum, m) => sum + MASTERY_AWARDS[m], banked);
}

/** Rank held at a point total: how many thresholds it has crossed. */
export function rankOf(points: number): number {
  let rank = 0;
  for (const at of RANK_THRESHOLDS) {
    if (points >= at) rank += 1;
  }
  return rank;
}

/** Whether a tier is open at a point total. Tier N wants rank N − 1. */
export function tierOpenAt(points: number, tier: TalentTier): boolean {
  return rankOf(points) >= tier - 1;
}

/** Whether the rite may be offered at all for this character. */
export function riteEligible(points: number): boolean {
  return rankOf(points) >= CAPSTONE_RANK;
}

// ── Buying ───────────────────────────────────────────────────────────────────

/**
 * What came of trying to buy a talent. The same three outcomes the FEATHERS
 * tree reports, plus the one this system adds: a tier the character's mastery
 * has not opened, carrying both ranks so the screen can say which milestone
 * is missing rather than only "no".
 */
export type TalentPurchase =
  | { readonly kind: 'bought'; readonly state: CharTalentState; readonly spent: number }
  | { readonly kind: 'maxed' }
  | { readonly kind: 'tooPoor'; readonly cost: number; readonly short: number }
  | { readonly kind: 'tierLocked'; readonly rankNeeded: number; readonly rankHeld: number };

/** Levels held in a talent, clamped into the range its ladder allows. */
export function talentLevel(state: CharTalentState, id: string): number {
  const raw = state.levels[id] ?? 0;
  return Math.max(0, Math.trunc(raw));
}

/**
 * A talent's stat at its current level, over the caller's base — the same
 * split `statValue` uses: bases belong to the game, arithmetic lives here.
 */
export function talentValue(tree: CharTree, state: CharTalentState, id: string, base: number): number {
  const spec = tree.talents.find((t) => t.id === id);
  if (!spec) throw new Error(`no talent '${id}' in this tree`);
  if (spec.effect.kind !== 'linear') throw new Error(`talent '${id}' is not a stat`);
  const level = Math.min(talentLevel(state, id), spec.costs.length);
  return base + spec.effect.per * level;
}

/**
 * Buys the next level of a talent, if mastery has opened its tier and the
 * wallet covers it. Pure: the state handed in is left alone and a new one
 * comes back; the caller owns the wallet and subtracts `spent` itself, the
 * way FEATHERS owns its own `_feathers`.
 *
 * Throws on an unknown id rather than answering politely: the ids reaching
 * this are the tree's own, so a miss is a programmer error and a quiet
 * `tooPoor` for it would be a bug wearing a price tag.
 */
export function purchaseTalent(
  tree: CharTree, state: CharTalentState, feathers: number, id: string,
): TalentPurchase {
  const spec = tree.talents.find((t) => t.id === id);
  if (!spec) throw new Error(`no talent '${id}' in this tree`);

  if (!tierOpenAt(state.mastery, spec.tier)) {
    return { kind: 'tierLocked', rankNeeded: spec.tier - 1, rankHeld: rankOf(state.mastery) };
  }
  const level = talentLevel(state, id);
  if (level >= spec.costs.length) return { kind: 'maxed' };
  const cost = spec.costs[level]!;
  if (feathers < cost) return { kind: 'tooPoor', cost, short: cost - feathers };

  return {
    kind: 'bought',
    spent: cost,
    state: { mastery: state.mastery, levels: { ...state.levels, [id]: level + 1 } },
  };
}

// ── The run draft ────────────────────────────────────────────────────────────

/**
 * Deals a draft: up to `count` distinct owned talents, minus whatever this
 * run has already taken — a second draft that re-offers the talent taken at
 * the start is a dead pick wearing a choice's clothes. A pool smaller than
 * the ask is offered whole, and an empty one offers nothing, which is the
 * caller's cue to skip the chooser rather than show an empty screen.
 *
 * Takes the rng rather than rolling its own, so a seeded run deals a seeded
 * draft — the same rule the siege tests already lean on.
 */
export function draftOffers(
  owned: readonly string[], rng: Rng, count: number,
  alreadyDrafted: readonly string[] = [],
): string[] {
  const pool = owned.filter((id) => !alreadyDrafted.includes(id));
  // Partial Fisher–Yates: draw without replacement, order decided by the rng.
  const deck = [...pool];
  const dealt: string[] = [];
  while (dealt.length < count && deck.length > 0) {
    const i = Math.floor(rng() * deck.length);
    dealt.push(deck[i]!);
    deck.splice(i, 1);
  }
  return dealt;
}
