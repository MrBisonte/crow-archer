/**
 * The FEATHERS upgrade tree: what a run's meta-currency can be spent on, and
 * what each level is worth.
 *
 * This is the arithmetic half of `FEATHERS` in `src/legacy/game.js`, which
 * still owns the wallet, the save file and the screen. Only the tree moved,
 * and it moved for the reason the file header of `game.js` states: the
 * monolith is being dismantled into `sim/` and `render/`. Costs and stat
 * deltas are pure functions of a level record here, so they can be checked
 * without a canvas, a frame loop or `localStorage`.
 *
 * ## Shape
 *
 * An upgrade id is a plain string tag, exactly the way `CharacterKind` is,
 * and everything an upgrade does hangs off that tag in one table. Adding an
 * axis is a row in `UPGRADES`; the display order, the zero state and the
 * save-file reader all derive from that table rather than repeating its keys,
 * so there is no second list to forget.
 *
 * ## Two kinds of upgrade
 *
 * A stat is bought repeatedly and moves a number: `base + per * level`. The
 * base belongs to the caller, not to this table, because the game's own bases
 * are not constants — arrow capacity starts from whichever pace preset is
 * running (`CONFIG.baseArrows`), so baking a base in here would silently pin
 * the tree to one difficulty.
 *
 * A perk is bought once and is either held or not. It is a separate effect
 * kind rather than a stat that happens to stop at one level, because what a
 * caller gets back is a different type: a question like "does this run start
 * shielded" has no per-level number to add to anything.
 */

import { CHARACTERS, type CharacterKind } from '../net/protocol';

/** An axis that moves a number, one step per level. */
export type StatId = 'arrows' | 'hp' | 'pfRange' | 'speed' | 'tools' | 'restore' | 'plume';

/**
 * Which heroes each axis actually reaches.
 *
 * Half of this tree is kit-specific wearing generic clothes. QUIVER DEPTH
 * raises `arrows.max`, which only the archer and the ranger ever spend; the
 * knight spends nothing at all, so FLETCHER CACHE refills a pool he never
 * empties. POWDER KEG is the sharpest: it says "tool capacity", it sets
 * `dynamites.max` and `satchels.max`, and the sapper -- the hero built around
 * throwing -- spends `bombs`, which it does not touch. TINE REACH is the
 * melee fallback's reach, and the knight is the one hero with no fallback,
 * because his sword is his primary and never runs out.
 *
 * Thirteen of the forty cells are dead, and until this table existed the shop
 * charged full price for every one of them.
 *
 * Written as data rather than left implicit for two reasons. The screen can
 * say so, which is the difference between a tree with depth and a tree with
 * traps. And the re-split -- moving these axes out of the shared tree and into
 * the character trees in `talents.ts` -- needs exactly this map to know what
 * goes where; deriving it by reading the game cost an afternoon once.
 *
 * `upgrades.reach.test.ts` holds it against what the game really does, so a
 * hero who gains a quiver does not leave this saying otherwise.
 */
export const AXIS_HEROES: Record<UpgradeId, readonly CharacterKind[]> = {
  // Every hero has hit points, a speed, a kill that pays and a run that can
  // start shielded.
  hp: CHARACTERS,
  speed: CHARACTERS,
  plume: CHARACTERS,
  ward: CHARACTERS,
  // The quiver. The archer and the ranger draw on the same three pools by
  // design; nobody else has one.
  arrows: ['archer', 'ranger'],
  restore: ['archer', 'ranger'],
  // What the hero throws -- the archer's dynamite and the ranger's satchels,
  // which share a pace-preset figure. The sapper's pouch is a separate pool
  // this axis has never set.
  tools: ['archer', 'ranger'],
  // The out-of-ammo swing: a pitchfork for the three quiver-and-pouch heroes,
  // a broom for the wizard. The knight has no call site.
  pfRange: ['archer', 'wizard', 'ranger', 'sapper'],
};

/** Whether buying this axis does anything at all for this hero. */
export function axisReaches(id: UpgradeId, char: CharacterKind): boolean {
  return AXIS_HEROES[id].includes(char);
}

/** An axis that is bought once and then simply held. */
export type PerkId = 'ward';

export type UpgradeId = StatId | PerkId;

/** `base + per * level`. The base is the caller's, see the module note. */
export interface LinearEffect {
  readonly kind: 'linear';
  readonly per: number;
}

/** Held from the first level on. Carries no number: holding it is the effect. */
export interface UnlockEffect {
  readonly kind: 'unlock';
}

export type UpgradeEffect = LinearEffect | UnlockEffect;

interface SpecBase {
  /** Shown on the upgrades screen. */
  readonly label: string;
  readonly desc: string;
  /**
   * What each successive level costs, cheapest first. One entry per level, so
   * the maximum level is the length of this and is never written down twice.
   */
  readonly costs: readonly number[];
}

export interface StatSpec extends SpecBase {
  readonly effect: LinearEffect;
}

export interface PerkSpec extends SpecBase {
  readonly effect: UnlockEffect;
}

export type UpgradeSpec = StatSpec | PerkSpec;

/**
 * Every upgrade, in the order the screen lists them.
 *
 * The type is an intersection rather than one `Record<UpgradeId, UpgradeSpec>`
 * so the two id unions above stay honest: a row under a `StatId` refuses to
 * compile with an `unlock` effect, and a row under a `PerkId` refuses a
 * `linear` one. That is what lets `statValue` and `perkHeld` each accept only
 * the ids they can actually answer for.
 *
 * The first four rows and their costs are the tree as it originally shipped,
 * carried over unchanged: that is a balance which has been played, and this
 * change adds axes rather than repricing them. The new rows are priced into
 * the same band.
 */
export const UPGRADES: Record<StatId, StatSpec> & Record<PerkId, PerkSpec> = {
  arrows: {
    label: 'QUIVER DEPTH', desc: '+2 arrow capacity / level',
    costs: [5, 12, 25], effect: { kind: 'linear', per: 2 },
  },
  hp: {
    label: 'VITALITY', desc: '+1 max HP / level',
    costs: [8, 20, 40], effect: { kind: 'linear', per: 1 },
  },
  pfRange: {
    label: 'TINE REACH', desc: '+8 px pitchfork range / level',
    costs: [6, 15, 30], effect: { kind: 'linear', per: 8 },
  },
  speed: {
    label: 'SWIFTNESS', desc: '+20 move speed / level',
    costs: [7, 18, 35], effect: { kind: 'linear', per: 20 },
  },
  // Capacity for whatever the chosen hero throws, rather than for dynamite by
  // name: the archer's sticks and the ranger's satchels both come off the same
  // pace-preset figure, so one axis raises the tool the hero actually carries.
  // Dearer per point than arrows, because a stick is worth several of them.
  tools: {
    label: 'POWDER KEG', desc: '+1 tool capacity / level',
    costs: [9, 22, 45], effect: { kind: 'linear', per: 1 },
  },
  // How much a quiver pickup gives back, which is the other half of the ammo
  // economy: capacity decides how much can be held, this decides how often the
  // run has to break off and go stand on something.
  restore: {
    label: 'FLETCHER CACHE', desc: '+2 arrows per pickup / level',
    costs: [6, 16, 34], effect: { kind: 'linear', per: 2 },
  },
  // The only axis that buys more of the currency instead of a fight stat, so
  // it is the one upgrade that pays for the others. Two levels, not three:
  // compounding a third would make the order the tree is bought in matter
  // more than what gets bought.
  plume: {
    label: 'PLUME BOUNTY', desc: '+25% feathers per kill / level',
    costs: [10, 26], effect: { kind: 'linear', per: 0.25 },
  },
  // One free hit at the start of every run, forever, through the same shield
  // the game already grants from a pickup and from the knight's block. The
  // dearest thing on the board and deliberately so: bought once, never spent.
  ward: {
    label: 'WARD FEATHER', desc: 'Every run starts shielded',
    costs: [45], effect: { kind: 'unlock' },
  },
};

/**
 * Screen order, derived from the table rather than written out again: an
 * upgrade that exists cannot go missing from the list that draws it.
 */
export const UPGRADE_ORDER = Object.keys(UPGRADES) as readonly UpgradeId[];

/** How many levels of an upgrade there are to buy. */
export function maxLevel(id: UpgradeId): number {
  return UPGRADES[id].costs.length;
}

/** How many levels of each upgrade have been bought. */
export type UpgradeLevels = Record<UpgradeId, number>;

/** A tree with nothing bought. Derived, so a new row starts at zero for free. */
export const NO_UPGRADES: UpgradeLevels = Object.freeze(
  Object.fromEntries(UPGRADE_ORDER.map((id) => [id, 0])),
) as UpgradeLevels;

/** A wallet, and what it has already been spent on. */
export interface Progress {
  readonly feathers: number;
  readonly levels: UpgradeLevels;
}

/** Nothing earned and nothing bought: the save file that does not exist yet. */
export const NEW_PROGRESS: Progress = { feathers: 0, levels: NO_UPGRADES };

/**
 * What came of trying to buy the next level of something.
 *
 * Three outcomes rather than a boolean, because "already maxed" and "cannot
 * afford it" are different answers and the screen says different things about
 * them. `short` is how many more feathers were needed, which is the number a
 * player actually wants.
 */
export type Purchase =
  | { readonly kind: 'bought'; readonly progress: Progress; readonly spent: number }
  | { readonly kind: 'maxed' }
  | { readonly kind: 'tooPoor'; readonly cost: number; readonly short: number };

/** Levels held, clamped into range whatever the record claims. */
export function levelOf(levels: UpgradeLevels, id: UpgradeId): number {
  const raw = levels[id] ?? 0;
  return Math.min(Math.max(Math.trunc(raw), 0), maxLevel(id));
}

export function isMaxed(levels: UpgradeLevels, id: UpgradeId): boolean {
  return levelOf(levels, id) >= maxLevel(id);
}

/** What the next level costs, or null when there is no next level. */
export function nextCost(levels: UpgradeLevels, id: UpgradeId): number | null {
  const level = levelOf(levels, id);
  return level >= maxLevel(id) ? null : UPGRADES[id].costs[level]!;
}

/**
 * A stat at its current level, applied to the caller's base.
 *
 * Takes only a `StatId`: asking this about a perk is a compile error rather
 * than a plausible-looking number.
 */
export function statValue(levels: UpgradeLevels, id: StatId, base: number): number {
  return base + UPGRADES[id].effect.per * levelOf(levels, id);
}

/** Whether a perk has been bought. Takes only a `PerkId`, for the same reason. */
export function perkHeld(levels: UpgradeLevels, id: PerkId): boolean {
  return levelOf(levels, id) > 0;
}

/**
 * Feathers actually awarded for a kill worth `base` of them.
 *
 * Rounded, not floored: at one level of PLUME BOUNTY a plain crow is worth
 * 1.25, and flooring that would pay nothing at all for the upgrade on the
 * commonest kill in the game.
 */
export function featherYield(levels: UpgradeLevels, base: number): number {
  return Math.round(statValue(levels, 'plume', 1) * base);
}

/**
 * Buys the next level of one upgrade, if it can be bought. Pure: the progress
 * passed in is left alone and a new one comes back.
 */
export function purchase(progress: Progress, id: UpgradeId): Purchase {
  const cost = nextCost(progress.levels, id);
  if (cost === null) return { kind: 'maxed' };
  if (progress.feathers < cost) {
    return { kind: 'tooPoor', cost, short: cost - progress.feathers };
  }
  return {
    kind: 'bought',
    spent: cost,
    progress: {
      feathers: progress.feathers - cost,
      levels: { ...progress.levels, [id]: levelOf(progress.levels, id) + 1 },
    },
  };
}

/**
 * Reads whatever was in the save file into a level record that is safe to do
 * arithmetic with.
 *
 * A save file is not trustworthy input: it survives across versions, and it is
 * one devtools console away from holding anything at all. Unknown ids are
 * dropped, missing ones start at zero, and a level outside the range the table
 * allows is clamped rather than believed — otherwise a save written before an
 * axis was shortened hands the game a cost lookup that does not exist.
 */
export function levelsFrom(raw: unknown): UpgradeLevels {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const levels = { ...NO_UPGRADES } as Record<UpgradeId, number>;
  for (const id of UPGRADE_ORDER) {
    const value = source[id];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    levels[id] = Math.min(Math.max(Math.trunc(value), 0), maxLevel(id));
  }
  return levels;
}

/** The same reading, for the wallet itself. */
export function feathersFrom(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(Math.trunc(raw), 0) : 0;
}
