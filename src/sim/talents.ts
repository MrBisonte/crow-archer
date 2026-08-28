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

import { CHARACTERS, type CharacterKind } from '../net/protocol';
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
 * Every character's tree, one row per hero — the shape the compiler can
 * check, so forgetting a character is a build error rather than the silent
 * fall-through the design-patterns doc records shipping once already.
 *
 * Each hero's tree deepens that hero's own passive, which is what keeps the
 * archer and the ranger diverging rather than converging: they share a quiver,
 * and one is paid for standing still while the other is paid for never doing
 * it. See `docs/talents.md`.
 *
 * Pilot figures: FOCUS DEPTH is owner-specified — "if he scales it he could
 * fire up to 3/4 bolts with a full pool" — so it is +1 over the base pool of
 * 3, one level. The other rows are priced into the FEATHERS tree's existing
 * band (5–45) and their effects are wired to consumers in the pilot's later
 * commits; a row whose effect nothing reads yet must not ship past that.
 */
export const CHAR_TREES: Record<CharacterKind, CharTree> = {
  archer: {
    talents: [
      {
        id: 'setFeet', label: 'SET FEET',
        desc: '-0.25 s to reach a full brace / level',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: -0.25 },
      },
      {
        id: 'deepRoots', label: 'DEEP ROOTS',
        desc: 'Brace bleeds away slower once he moves',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: -1 },
      },
      {
        id: 'splitShaft', label: 'SPLIT SHAFT',
        desc: '+1 body a full power shot passes through / level',
        tier: 2, costs: [2, 3], effect: { kind: 'linear', per: 1 },
      },
    ],
    capstones: [
      {
        id: 'rooted', label: 'ROOTED',
        desc: 'A full brace holds through movement; only a hit knocks it down',
      },
      {
        id: 'splinter', label: 'SPLINTER',
        desc: 'Dynamite bursts into three smaller blasts',
      },
    ],
  },
  wizard: {
    talents: [
      {
        id: 'focusDepth', label: 'FOCUS DEPTH',
        desc: '+1 Focus: a full pool casts four bolts',
        tier: 1, costs: [1], effect: { kind: 'linear', per: 1 },
      },
      {
        id: 'blinkReach', label: 'LONG STEP',
        desc: '+20 px blink distance / level',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: 20 },
      },
      {
        id: 'stormWidth', label: 'WIDER SKY',
        desc: '+50 px storm radius / level',
        tier: 2, costs: [2, 3], effect: { kind: 'linear', per: 50 },
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
  knight: {
    talents: [
      {
        id: 'deeperCut', label: 'DEEPER CUT',
        desc: '+3% damage and swing speed per Bloodlust stack / level',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: 0.03 },
      },
      {
        id: 'fourthBlood', label: 'FOURTH BLOOD',
        desc: 'A fourth Bloodlust stack to fill',
        tier: 1, costs: [1], effect: { kind: 'linear', per: 1 },
      },
      {
        id: 'chargeThrough', label: 'CHARGE THROUGH',
        desc: 'The charge cuts on every side of him, not only ahead',
        tier: 2, costs: [2], effect: { kind: 'unlock' },
      },
    ],
    capstones: [
      {
        id: 'berserker', label: 'BERSERKER',
        desc: 'A miss drops one Bloodlust stack instead of all of them',
      },
      {
        id: 'juggernaut', label: 'JUGGERNAUT',
        desc: 'The dash cannot be stopped, and throws back what it hits',
      },
    ],
  },
  ranger: {
    talents: [
      {
        id: 'lightFoot', label: 'LIGHT FOOT',
        desc: '-75 px of ground to fill Momentum / level',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: -75 },
      },
      {
        id: 'longWind', label: 'LONG WIND',
        desc: '+1 s before a standing ranger loses Momentum / level',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: 1 },
      },
      {
        id: 'fullTilt', label: 'FULL TILT',
        desc: '+5% to the Momentum ceiling / level',
        tier: 2, costs: [2, 3, 4], effect: { kind: 'linear', per: 0.05 },
      },
    ],
    capstones: [
      {
        id: 'slipstream', label: 'SLIPSTREAM',
        desc: 'At full Momentum she runs through bodies unharmed, up to 3 s',
      },
      {
        id: 'shrapnel', label: 'SHRAPNEL',
        desc: 'The satchel throws bolts outward when it blows',
      },
    ],
  },
  sapper: {
    talents: [
      {
        id: 'longFuse', label: 'LONG FUSE',
        desc: '+18 px of reach for a bomb to light the next / level',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: 18 },
      },
      {
        id: 'moreLinks', label: 'MORE LINKS',
        desc: '+2 bombs one chain may run through / level',
        tier: 1, costs: [1, 2], effect: { kind: 'linear', per: 2 },
      },
      {
        id: 'stickyFan', label: 'STICKY FAN',
        desc: 'Barrage bombs stop where they land and keep their fuse',
        tier: 2, costs: [2], effect: { kind: 'unlock' },
      },
    ],
    capstones: [
      {
        id: 'demolitionist', label: 'DEMOLITIONIST',
        desc: 'Every bomb a chain lights blows wider than the one before',
      },
      {
        id: 'shockwave', label: 'SHOCKWAVE',
        desc: 'A combo blast throws back everything it does not kill',
      },
    ],
  },
};

/** What one character has: mastery points banked and talent levels bought. */
export interface CharTalentState {
  /**
   * Mastery ever earned. Never falls, because this is what opens tiers.
   *
   * Two figures rather than one balance: a single counter cannot both open a
   * tier and pay for what is inside it. Spending it would shut a tier the
   * player had already reached, so a talent would cost them the rank they
   * bought it with.
   */
  readonly mastery: number;
  /** Mastery already spent on talents. `mastery - spent` is what is buyable. */
  readonly spent: number;
  readonly levels: Readonly<Record<string, number>>;
}

/** What this character can still spend. Never negative, whatever a save holds. */
export function masteryAvailable(state: CharTalentState): number {
  return Math.max(0, state.mastery - state.spent);
}

// ── Mastery ──────────────────────────────────────────────────────────────────

/** The run milestones that pay mastery. Nothing else does, by design. */
export type MasteryMilestone = 'boss_down' | 'stage_cleared' | 'siege_cleared' | 'run_won';

/**
 * What each boss is worth in mastery, decided by the boss.
 *
 * Loot, in other words: the crow king pays one, so a first kill buys exactly
 * one tier-I talent and the player makes one choice rather than five. What the
 * later ones pay is a dial per row, which is the point of a table — raising
 * the minotaur is an edit here and nothing else.
 *
 * Keyed by boss kind, the same shape `BOSS_ON_HIT` and `BOSS_HP_KEY` in
 * `game.js` already use, so a sixth boss is a row in each rather than a new
 * kind of lookup.
 */
export const BOSS_MASTERY: Record<string, number> = {
  crowking: 1,
  dark_archer: 2,
  dark_knight: 2,
  minotaur: 3,
  commander: 3,
};

/**
 * What downing `kind` pays. An unknown boss pays the floor rather than
 * throwing: a boss that pays nothing is a boss nobody notices killing, and a
 * crash in the death sequence is worse than a cheap kill.
 */
export function bossMastery(kind: string): number {
  return BOSS_MASTERY[kind] ?? 1;
}

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
 * Whether an unlock talent is held at all. The sibling of `talentValue` for
 * the effects that carry no number — holding one IS the effect, exactly as
 * `perkHeld` reads the FEATHERS tree's perks.
 */
export function talentHeld(tree: CharTree, state: CharTalentState, id: string): boolean {
  const spec = tree.talents.find((t) => t.id === id);
  if (!spec) throw new Error(`no talent '${id}' in this tree`);
  if (spec.effect.kind !== 'unlock') throw new Error(`talent '${id}' is not an unlock`);
  return talentLevel(state, id) > 0;
}

/**
 * A cursor kept inside a list of `count` items.
 *
 * The shop screen's cursor outlives the character it was set on, and the
 * trees are authored one per hero and need not be the same length. An
 * unclamped cursor carried from a long tree onto a short one indexes past the
 * end, and the screen buys `undefined`. Here rather than in the screen for
 * this file's usual reason: it is arithmetic, and arithmetic is checkable
 * without a canvas.
 */
export function clampCursor(count: number, index: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
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
 * Whether anything in this tree can be bought right now.
 *
 * The question a boss asks before it opens the tree: paying mastery is only
 * worth stopping the run for if there is something to spend it on. A tree
 * fully bought, or a purse that covers nothing in an open tier, answers no
 * and the run carries on.
 */
export function anyAffordable(tree: CharTree, state: CharTalentState): boolean {
  return tree.talents.some((spec) => purchaseTalent(tree, state, spec.id).kind === 'bought');
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
  tree: CharTree, state: CharTalentState, id: string,
): TalentPurchase {
  const spec = tree.talents.find((t) => t.id === id);
  if (!spec) throw new Error(`no talent '${id}' in this tree`);

  // Tiers read mastery EARNED, never what is left. A player who spent down to
  // nothing keeps every tier their kills opened.
  if (!tierOpenAt(state.mastery, spec.tier)) {
    return { kind: 'tierLocked', rankNeeded: spec.tier - 1, rankHeld: rankOf(state.mastery) };
  }
  const level = talentLevel(state, id);
  if (level >= spec.costs.length) return { kind: 'maxed' };
  const cost = spec.costs[level]!;
  const purse = masteryAvailable(state);
  if (purse < cost) return { kind: 'tooPoor', cost, short: cost - purse };

  return {
    kind: 'bought',
    spent: cost,
    state: {
      mastery: state.mastery,
      spent: state.spent + cost,
      levels: { ...state.levels, [id]: level + 1 },
    },
  };
}

// ── The save file ────────────────────────────────────────────────────────────

/**
 * Reads one character's slice of the save file into a state that is safe to
 * do arithmetic with — the same distrust `levelsFrom` gives the FEATHERS
 * save, for the same reason: a save survives versions and is one devtools
 * console away from holding anything. Unknown talent ids are dropped, levels
 * are clamped into the ladder the tree actually has, and mastery is a
 * non-negative integer or it is zero.
 */
export function talentStateFrom(tree: CharTree, raw: unknown): CharTalentState {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawLevels = (typeof source.levels === 'object' && source.levels !== null
    ? source.levels : {}) as Record<string, unknown>;
  const levels: Record<string, number> = {};
  for (const spec of tree.talents) {
    const value = rawLevels[spec.id];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const level = Math.min(Math.max(Math.trunc(value), 0), spec.costs.length);
    if (level > 0) levels[spec.id] = level;
  }
  const mastery = typeof source.mastery === 'number' && Number.isFinite(source.mastery)
    ? Math.max(Math.trunc(source.mastery), 0) : 0;
  // Never more than was earned. A save claiming otherwise would report a
  // negative purse, and every price would read as affordable.
  const rawSpent = typeof source.spent === 'number' && Number.isFinite(source.spent)
    ? Math.max(Math.trunc(source.spent), 0) : 0;
  return { mastery, spent: Math.min(rawSpent, mastery), levels };
}

/**
 * The whole save: one state per character the protocol knows, each read
 * against its own tree. A row the file lacks — or holds junk in — comes back
 * fresh rather than crashing the load, so an old save meets a new character
 * the way it met every character on its first ever run.
 */
export function talentBankFrom(raw: unknown): Record<CharacterKind, CharTalentState> {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bank = {} as Record<CharacterKind, CharTalentState>;
  for (const char of CHARACTERS) {
    bank[char] = talentStateFrom(CHAR_TREES[char], source[char]);
  }
  return bank;
}

// ── The run draft ────────────────────────────────────────────────────────────

/** The ids this character owns at level one or higher: the draft's pool. */
export function ownedIds(tree: CharTree, state: CharTalentState): string[] {
  return tree.talents.filter((t) => talentLevel(state, t.id) > 0).map((t) => t.id);
}

/**
 * A talent's stat over the caller's base, counting only if this run drafted
 * it — the run layer's one rule, applied where the arithmetic lives so every
 * consumer gets the same answer. An undrafted talent is the base, exactly as
 * if it were unowned: ownership grows options, not passive power.
 */
export function draftedValue(
  tree: CharTree, state: CharTalentState, drafted: readonly string[],
  id: string, base: number,
): number {
  if (!drafted.includes(id)) return base;
  return talentValue(tree, state, id, base);
}

/**
 * The same run-layer rule for an unlock: owned counts for nothing until this
 * run drafted it.
 */
export function draftedHeld(
  tree: CharTree, state: CharTalentState, drafted: readonly string[], id: string,
): boolean {
  if (!drafted.includes(id)) return false;
  return talentHeld(tree, state, id);
}

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
