/**
 * The bastion retinue's pixel art: one grid builder per allied guard kind, each
 * of them wearing whatever rank it has climbed to.
 *
 * Here rather than in `src/legacy/game.js` for the reason soldier-grids.ts is:
 * art is data, and data that lives in the monolith cannot be looked at without
 * a browser. A test can build every guard, at every frame, at every rank, and
 * check they are told apart without a canvas, a DOM or a frame loop.
 *
 * Grid *data* is deliberately not cached here, same as the soldiers and the
 * heroes: building one is a few dozen pixel calls. The expensive half, painting
 * it into a canvas, is what pixel-sprite.ts's spriteCanvas caches, and the
 * caller keys that cache — on kind, frame *and* rank now, because a promotion
 * changes the picture.
 *
 * Everything is drawn facing +x. The caller mirrors the whole sprite when the
 * body is looking the other way, which is what keeps a shield on the side the
 * shield actually guards and the rank badge on the shoulder away from it.
 *
 * These are the player's side. sim/guards.ts decides who is recruited and who
 * is promoted; this file decides nothing and draws what it is told. In
 * particular it draws a rank on a knight, which `GUARD_STATS.knight.promotion`
 * being `'none'` says can never happen: the rule has one home, and a second
 * copy of it here would be a second thing to edit the day that row changes.
 *
 * SILHOUETTE FIRST, PALETTE SECOND — AND THAT IS A CORRECTION.
 *
 * The first pass leaned on colour: one violet livery on four pale bodies, with
 * a hood, a buckler, a lance and a staff to separate them. Playtest said the
 * guards, the knight and the priest all look the same. It was right, and the
 * reason is that all four were the same 16x24 body with a different few pixels
 * bolted on — at a tile size of 32 the differences were smaller than the thing
 * they were differences to. What separates the four now is the outline:
 *
 *   archer       a narrow body and a bow bent out past the leading edge
 *   foot_soldier a tall spear on one side, a shield filling the other
 *   knight       a horse, which is twice the width of anything else on the map
 *   priest       a wide robe with a red cross across the whole chest
 *
 * The knight is why `GUARD_SPRITES` exists. A mounted body does not fit a cell
 * sized for a man on foot, and squeezing it in would have given back exactly
 * the silhouette the playtest rejected.
 */

import type { GuardKind } from '../sim/guards';
import { MAX_RANK } from '../sim/guards';
import {
  makePixelGrid, setPixel, pixelRect, pixelEllipse, pixelCurve, pixelOutline, pixelTriangleUp,
  type AnimFrame, type PixelGrid,
} from './pixel-grid';

/**
 * The three-frame stride every ground body in this game walks on.
 *
 * An alias rather than a fourth copy of the union: pixel-grid.ts owns the set
 * of frames a baked cycle is called with, and anything enumerating them is
 * meant to read it from there. The name survives because "stride" is what a
 * walking body's frames are, and a reader of a guard builder should not have to
 * know that a crow's wingbeat buckets into the same three.
 */
export type StrideFrame = AnimFrame;

/**
 * The same 16x24 cell the cavern soldiers occupy, so a guard and an enemy meet
 * on the field at the same scale and neither looks like a different game.
 *
 * Its own constant rather than an import of SOLDIER_SPRITE: that they agree is
 * a fact about this map, not a dependency. Re-sizing the retinue should not
 * re-size the garrison it is fighting.
 *
 * Kept for the three kinds that still use it, and as the default. `GUARD_SPRITES`
 * below is what a caller sizing a canvas should read; this is what a builder
 * drawing a body on foot lays its coordinates out in.
 */
export const GUARD_SPRITE = { w: 16, h: 24 };

/**
 * The mounted cell: wider, because a horse is longer than a man, and taller,
 * because a rider sits above a barrel that is itself standing on legs.
 *
 * Twice the width of a body on foot and not one column less. The whole argument
 * for drawing the knight mounted is that "is that a horse" is answerable from
 * across the bastion, and a horse that fits inside a man's cell is a pony seen
 * from a distance at which it is a smudge.
 */
const MOUNTED_SPRITE = { w: 34, h: 28 };

/**
 * Per-kind sprite bounds. The mounted knight is wider than the rest.
 *
 * A table rather than a branch in the caller, for the reason GUARD_GRID_BUILDERS
 * is a table: a fifth kind is a row here and a row there, and the compiler
 * refuses it until both exist. `buildGuardGrid(kind, ...)` returns a grid of
 * exactly `GUARD_SPRITES[kind]` dimensions and the test drives that off the kind
 * list, so a builder whose size drifts from its row fails on its own terms.
 *
 * The caller reads `w` to centre the sprite and `h` to sit it on its feet — the
 * two are not the same offset for a 24-tall man and a 28-tall horse, which is
 * the whole reason a single constant could not stay.
 */
export const GUARD_SPRITES: Record<GuardKind, { readonly w: number; readonly h: number }> = {
  archer: GUARD_SPRITE,
  foot_soldier: GUARD_SPRITE,
  knight: MOUNTED_SPRITE,
  priest: GUARD_SPRITE,
};

/**
 * The slots every guard palette carries, named rather than left as a
 * `Record<string, string>`.
 *
 * The bare record was the first version and it cost a `!` on every single
 * colour read — `noUncheckedIndexedAccess` is on, an index signature yields
 * `string | undefined`, and forty non-null assertions is forty places where a
 * misspelled slot compiles and paints `undefined` into a cell. Named slots make
 * the typo a compile error instead of an invisible guard.
 *
 * Kinds may carry more than this. The knight has a horse to paint and the
 * priest has a cross, and `satisfies` below keeps those extra slots visible on
 * the kind that owns them without obliging the other three to declare a colour
 * they must never use.
 */
export interface GuardPalette {
  readonly livery: string;
  readonly liveryHi: string;
  readonly rank: string;
  readonly skin: string;
  readonly cloth: string;
  readonly clothHi: string;
  readonly shade: string;
  readonly metal: string;
  readonly metalHi: string;
  readonly boot: string;
  readonly edge: string;
  /**
   * The mount, on the one kind that has one.
   *
   * Optional here and required by MountPalette, which is the pair that lets
   * drawWarhorse refuse a palette with no horse in it while GUARD_PALETTES
   * stays one table. Making them required on every kind would have meant three
   * palettes carrying a horse colour they never paint.
   */
  readonly horse?: string;
  readonly horseHi?: string;
  readonly horseDark?: string;
  /** The priest's cross, on the one kind that wears one. */
  readonly cross?: string;
}

/**
 * What every guard wears whatever kind it is: the house livery, the gold a
 * promotion is painted in, and one skin tone.
 *
 * Spread into every palette rather than repeated in each, because "the retinue
 * shares a livery" is the whole visual argument below and a copy in each row is
 * one more place for it to stop being true.
 */
const SHARED_GUARD_COLOURS = {
  livery: '#6A4FB0',
  liveryHi: '#9B7CE2',
  rank: '#F5C63A',
  skin: '#E3B48C',
} as const;

/**
 * One palette per kind, and not one colour anywhere in SOLDIER_PALETTES.
 *
 * Two things make an allied guard read as friendly, and neither of them is the
 * silhouette. The first is value: the cavern's three enemies are all dark and
 * desaturated — bronze, cold steel-blue, forest green — and every guard is
 * pale, so on a busy screen the light bodies are yours and the dark ones
 * are not. That read survives at a distance where a bow and a spear are the
 * same handful of pixels.
 *
 * The second is that they share a livery. The garrison's palettes have nothing
 * in common with each other, which is deliberate there: three unrelated things
 * are closing on you. The retinue is one body, so the same violet and the same
 * promotion gold appear on every one of them. A player reads "mine" off the
 * common colour first and only then reads which of the three it is off the
 * hood, the shield or the lance.
 *
 * Violet was picked for it because it is the one hue the cavern does not use
 * for anything at all, so nothing in the retinue can be confused with the enemy
 * by colour alone. Gold was rejected for the livery for the opposite reason —
 * the shieldman's accent is `#C8A030` — and kept for the rank pips, where it is
 * the only gold on the field and never competes with a body colour.
 *
 * `satisfies` rather than an annotation, so the knight's horse slots and the
 * priest's cross stay on the type of the kind that owns them while the compiler
 * still refuses a kind that is missing a shared slot or a kind that is missing
 * altogether.
 */
export const GUARD_PALETTES = {
  // Linen and leather. No plate at all, because 1 hp should look like 1 hp.
  archer: {
    ...SHARED_GUARD_COLOURS,
    cloth: '#D5CDB6', clothHi: '#EFE8D2', shade: '#7A6F55',
    metal: '#B7BFC9', metalHi: '#E7EDF4',
    boot: '#6E5A42', edge: '#241B33',
  },
  // Mail under a livery surcoat: the one that is still standing at the end of
  // the wave, and the one most promotions therefore land on.
  foot_soldier: {
    ...SHARED_GUARD_COLOURS,
    cloth: '#C3CBD7', clothHi: '#E6ECF5', shade: '#5A6272',
    metal: '#AFB8C5', metalHi: '#F1F6FC',
    boot: '#4A4457', edge: '#1E1A2C',
  },
  // The brightest thing on the map, on purpose: the rare draw should be
  // recognisable across the bastion the moment it walks in.
  //
  // The horse is pale for the same reason the rider is. A dark warhorse is the
  // better-looking animal and it would have handed two thirds of the sprite's
  // area to the value the cavern's enemies are drawn in, which is the one rule
  // the whole retinue palette exists to keep. The enemy commander's mount is
  // near-black (`COMMANDER_PALETTE.horse`), so pale-versus-dark is also what
  // separates the two mounted bodies now that both are mounted.
  knight: {
    ...SHARED_GUARD_COLOURS,
    cloth: '#DBE5F1', clothHi: '#F8FBFF', shade: '#6C7789',
    metal: '#C5D1E1', metalHi: '#FDFEFF',
    boot: '#5A5870', edge: '#1C2233',
    horse: '#C0B6A6', horseHi: '#E2DACB', horseDark: '#8A8172',
  },
  // Undyed linen with a green cast, which is the one direction the other three
  // do not go: the archer's cloth is warm, the foot soldier's and the knight's
  // are cold blue. It keeps the priest inside the retinue's pale range while
  // making it the only body on the field with that cast.
  //
  // `cross` is the one colour in this file that is a symbol rather than a
  // material, and it lives in the palette anyway so the enemy-disjointness
  // check reaches it without being told to. It is deliberately hotter than the
  // spearman's `#B03028` accent: the two are the only reds in the game, that
  // one is a stripe down a shaft and this one is a plain cross on a chest, and
  // the value gap is what stops a glance confusing them.
  priest: {
    ...SHARED_GUARD_COLOURS,
    cloth: '#DCE3DA', clothHi: '#F4F8F2', shade: '#78827A',
    metal: '#C9CFD8', metalHi: '#F2F6FF',
    boot: '#5F4E63', edge: '#221A30',
    cross: '#D62828',
  },
} satisfies Record<GuardKind, GuardPalette>;

/** How far a limb swings on each frame of the stride. */
const swingOf = (frame: StrideFrame, amount: number): number =>
  frame === 'a' ? amount : frame === 'b' ? -amount : 0;

/**
 * The braced stance the stride opens and closes around, and how far it opens.
 *
 * A guard on the wall is holding a line rather than marching down a corridor,
 * so its feet never fully close: the narrow frame is still two feet apart. That
 * is a real difference from the garrison, which passes through legs-together
 * mid-stride, and it is also what lets every frame of this walk be checked for
 * two legs instead of only the two extremes.
 *
 * The swing is one column per foot and the stance is five wide, so the gap
 * between the boots runs 2 -> 4 -> 6 columns across the cycle. Tripling a gap
 * is a much louder motion than moving a foot two pixels, which is why the small
 * amplitude still reads at a tile size of 32.
 */
const STANCE_L = 5;
const STANCE_R = 10;
const STRIDE_SWING = 1;

/** The row the boots land on, and the row the two legs have to read as two. */
const BOOT_ROW = 22;

/**
 * The body the three guards on foot share: legs on the stride, a tunic, a belt
 * and a head. What each kind carries goes on top in its own builder, so the
 * walk cycle is written once rather than three times.
 *
 * The knight does not call this. A rider's legs are on a horse's flank, not on
 * the ground, and giving the mounted body a set of walking boots under the
 * barrel was the first thing tried and the first thing thrown away.
 */
function buildGuardBody(C: GuardPalette, frame: StrideFrame): PixelGrid {
  const g = makePixelGrid(GUARD_SPRITE.w, GUARD_SPRITE.h);
  const swing = swingOf(frame, STRIDE_SWING);

  // Both feet swing about a shared centre, not about their own tops.
  //
  // soldier-grids.ts records what the obvious version costs: one leg at
  // `6 + swing` and the other at `9 - swing` converge instead of splaying, meet
  // at full swing and merge into a single thick leg for one frame of the walk —
  // invisible in a still, unmissable in motion. Anchoring both to the same
  // centre and sending them opposite ways makes the two extremes mirror images
  // of each other, which is what a stride actually is.
  //
  // The stance carries that further. Mirroring alone still lets the feet touch
  // at the narrow extreme, which is legal for the garrison and would be a
  // one-frame fusion here; starting from five columns apart and swinging one
  // means the narrow frame is still two columns of daylight.
  const footL = STANCE_L - swing;
  const footR = STANCE_R + swing;
  pixelCurve(g, [6, 16], [(6 + footL) / 2, 19], [footL, BOOT_ROW], C.cloth, 10);
  pixelCurve(g, [9, 16], [(9 + footR) / 2, 19], [footR, BOOT_ROW], C.cloth, 10);
  // Two wide, and hung on the outside of each ankle rather than centred on it.
  // Centred boots eat a column of the gap from each side, which at the narrow
  // frame is the whole gap: the collapse comes back at the feet only, on the
  // one frame nobody checks. Pointing them outward also reads as braced.
  pixelRect(g, footL - 1, BOOT_ROW - 1, 2, 2, C.boot);
  pixelRect(g, footR, BOOT_ROW - 1, 2, 2, C.boot);

  pixelRect(g, 5, 9, 6, 8, C.cloth);
  pixelRect(g, 5, 9, 6, 2, C.clothHi);
  pixelRect(g, 5, 15, 6, 1, C.shade);

  pixelEllipse(g, 8, 5, 3, 3.2, C.skin);
  return g;
}

/**
 * Where a kind's pip ladder starts.
 *
 * An anchor per kind rather than one pair of module constants, because the
 * mounted knight has no torso where a man on foot has one: the shoulder the
 * badge belongs on is eight columns to the right and four rows up. The ladder's
 * *shape* — 2x1 pips, one blank row between, growing upward — is still written
 * once, which is the half that has to stay identical for the count to be
 * readable across kinds.
 */
interface RankAnchor {
  /** Left column of the 2x1 pips. */
  readonly x: number;
  /** Row of the lowest pip. The ladder grows upward from here. */
  readonly baseY: number;
}

/**
 * The trailing shoulder of a body on foot.
 *
 * Everything a kind is identified by is on the leading side — the bow, the
 * shield, the staff — and a badge that shared a side with those would be read
 * as part of the weapon. Growing upward from a fixed lowest pip gives the eye
 * an anchor: the bottom mark is in the same three cells at every rank, so the
 * count is the only thing that changed.
 */
const ON_FOOT_RANK: RankAnchor = { x: 4, baseY: 13 };

/**
 * The priest's trailing shoulder, one column further out because its robe is.
 *
 * The ladder has to sit on the body it is worn on, and this body is nine
 * columns wide where the others are six. Leaving it at column 4 would have put
 * a gold pip one column from the red cross with nothing between them, which is
 * the collision the cross's own geometry is laid out to avoid.
 */
const ROBED_RANK: RankAnchor = { x: 3, baseY: 13 };

/**
 * The rider's trailing shoulder, which is the same badge in the same relation
 * to the same body — it is the body that moved, not the convention.
 */
const MOUNTED_RANK: RankAnchor = { x: 13, baseY: 13 };

const RANK_PITCH = 2;

/**
 * The rank actually drawn, for a `rank` that may be anything a caller has.
 *
 * Clamped, not ignored, and not rejected. Ignoring an out-of-range rank draws a
 * veteran as a recruit, and a player who reads "recruit" off a guard that is
 * anything but will spend it accordingly — the failure is silent and lands in
 * the one place the retinue is meant to be legible. Throwing is worse: a
 * renderer that can take down the frame loop over a number it could have
 * clamped is a bad trade for art. Clamping high says "top of the ladder", which
 * is the truthful reading of a rank above the top of the ladder.
 *
 * Flooring for the same reason a fractional rank cannot mean half a pip: the
 * device is countable marks, so the count has to be an integer.
 */
const clampRank = (rank: number): number =>
  Math.max(0, Math.min(MAX_RANK, Math.floor(rank)));

/**
 * The insignia: one gold pip per rank, 2x1, stacked with a blank row between.
 *
 * Counting discrete marks is a categorical read — one, two, three — where any
 * device that scales a single shape is a magnitude read, and a magnitude read
 * needs a second sprite beside it to compare against. On a bastion where two
 * guards are rarely adjacent, that comparison is not available, so the mark has
 * to be countable on its own.
 *
 * The blank row is the whole device. Three 1px pips stacked touching are a 3px
 * bar and nothing is countable; separated they survive the scale to a 32px tile
 * intact. That is also why there are three at most and why they are 2 wide: at
 * one column a pip is a speck, at four rows of pitch the ladder runs off the
 * torso.
 *
 * Chevrons were the other candidate and are what a real uniform would use. They
 * lose here: a chevron needs at least 3x2 to read as a V rather than as a dash,
 * three of them need 9 rows on a torso that has 8, and stacked at this size
 * they blur into exactly the striped block the blank rows exist to avoid.
 *
 * Painted last, over whatever the kind put there, so the badge cannot be half
 * hidden behind a pauldron or a sword hand at one rank and not another.
 */
function drawRankPips(g: PixelGrid, gold: string, rank: number, at: RankAnchor): void {
  const pips = clampRank(rank);
  for (let i = 0; i < pips; i++)
    pixelRect(g, at.x, at.baseY - i * RANK_PITCH, 2, 1, gold);
}

/** Archer: a hood, a livery collar, and the bow drawn down the leading side. */
export function buildArcherGuardGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.archer;
  const g = buildGuardBody(C, frame);
  pixelEllipse(g, 8, 4, 3.6, 3.4, C.cloth);
  pixelEllipse(g, 8.5, 5, 2.4, 2.2, C.skin);
  // The collar is the only livery on this one: a hood in violet would read as a
  // dark head at distance and undo the pale-body rule the palette is built on.
  pixelRect(g, 5, 8, 6, 1, C.livery);
  // Stave and string, bent away from the body so the draw is visible in
  // silhouette rather than only in colour.
  //
  // Left exactly as it was through the silhouette pass. It is the one kind the
  // playtest did not name, and the reason is visible in the numbers: it is the
  // only guard whose leading side is a thin bent line rather than a slab, which
  // is precisely the contrast the foot soldier's new shield is measured
  // against. Widening it to match the others would have cost that contrast.
  pixelCurve(g, [12, 7], [15, 12], [12, 17], C.boot, 12);
  pixelRect(g, 12, 8, 1, 9, C.metalHi);
  pixelRect(g, 9, 11, 3, 1, C.skin);
  drawRankPips(g, C.rank, rank, ON_FOOT_RANK);
  return pixelOutline(g, C.edge);
}

/**
 * Foot soldier: kettle helm, livery surcoat, a spear stood upright on the
 * trailing side and a shield filling the leading one.
 *
 * Both, and both large, which is the correction. The first pass gave this kind
 * a small buckler and argued the size down from the rules: the cavern's
 * shieldman carries a slab edge to edge because sim/soldiers.ts gives it a
 * 60-degree block and that picture is where the player reads the rule off, and
 * this guard has no such rule, so a large shield would promise one. That
 * argument is sound about *mechanics* and it lost this kind its silhouette. A
 * 3x4 buckler and a shouldered sword are, at a tile size of 32, a body with
 * two smudges on it — the same body the archer and the priest are.
 *
 * So the shield is a shield now, and what stops it promising a block is that it
 * is a different shape from the shieldman's: a rounded heater, not a rectangle
 * from edge to edge, and carried by a body that is pale and violet rather than
 * steel and blue.
 *
 * The spear stands upright rather than levelled, and the two reasons are
 * different from each other. It has to clear the shield, and a levelled shaft
 * on the leading side would run straight through it. And a levelled spear is
 * the enemy spearman's silhouette exactly — `buildSpearmanGrid` puts a shaft
 * across the chest and out past the leading hand — so a guard drawn that way
 * would be legible right up until it stood next to the thing it is fighting.
 *
 * The shaft stops at row 19, three rows above the boot row, for the reason the
 * priest's staff does: a shaft planted on the ground beside the feet is a third
 * vertical run at the row that decides whether the legs fused, and one the eye
 * reads as a third leg at speed.
 */
export function buildFootSoldierGuardGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.foot_soldier;
  const g = buildGuardBody(C, frame);
  pixelEllipse(g, 8, 4, 3.4, 2.8, C.metal);
  pixelEllipse(g, 8, 3, 3, 2, C.metalHi);
  // Brim wider than the head: the one line that separates this silhouette from
  // the garrison's flat-topped helm at a glance.
  pixelRect(g, 4, 6, 9, 1, C.metal);
  pixelRect(g, 6, 9, 4, 6, C.livery);
  pixelRect(g, 6, 9, 4, 1, C.liveryHi);
  // Spear: shaft, then the head over its top cell, then the hand low on the
  // grip. Column 2 rather than 3, so the badge at column 4 keeps a clear column
  // of its own between the two — gold against wood with no gap is one blur at
  // distance, and the badge is the half that loses.
  //
  // The head's base sits on the shaft's own top row for the reason the enemy
  // spearman's does one row down from its shaft: a head based clear of the
  // shaft leaves a row of daylight, and at this size a detached tip reads as a
  // speck of debris rather than as a spear.
  pixelRect(g, 2, 4, 1, 16, C.boot);
  pixelTriangleUp(g, 2, 4, 1, 4, C.metalHi);
  pixelRect(g, 3, 15, 2, 1, C.skin);
  // Shield: a rounded heater, rim, livery field and boss. Rect plus ellipse
  // rather than one ellipse, because an ellipse tall enough to cover rows 7-18
  // is pointed at the top too, and a shield that tapers at both ends is a leaf.
  pixelRect(g, 10, 7, 5, 9, C.metal);
  pixelEllipse(g, 12, 15, 2.6, 3.2, C.metal);
  pixelRect(g, 10, 7, 5, 1, C.metalHi);
  pixelRect(g, 11, 9, 3, 6, C.livery);
  pixelEllipse(g, 12, 12, 1.3, 1.5, C.metalHi);
  drawRankPips(g, C.rank, rank, ON_FOOT_RANK);
  return pixelOutline(g, C.edge);
}

/**
 * The mount's palette: the three horse colours plus the livery its caparison is
 * cut from and the dark the hooves take.
 *
 * A structural type rather than `GuardPalette`, because drawWarhorse must not
 * be callable with a palette that has no horse in it. Today exactly one kind
 * satisfies it, and that is the point: the compiler is what stops the priest
 * being handed to it by a copy-paste.
 */
interface MountPalette {
  readonly horse: string;
  readonly horseHi: string;
  readonly horseDark: string;
  readonly livery: string;
  readonly liveryHi: string;
  readonly boot: string;
}

/**
 * Where the four legs stand, and how far the gait opens them.
 *
 * Pair centres six columns apart, each pair opening opposite ways, swinging one
 * column per leg. The gap inside a pair therefore runs 2 -> 4 -> 6 columns
 * across the cycle and the two pairs are never closer than three columns to
 * each other, which is the arithmetic the four-run check depends on.
 *
 * Two shapes that look right written down and are not, both recorded in
 * buildCommanderGrid and both re-derived here at this sprite's size. Centres
 * two columns apart give a separation of |2 + 2*swing|, which is two columns at
 * one extreme: pixelOutline paints a two-column gap solid, and the pair reads
 * as one wide hoof on exactly one frame of the gait. A shared centre fixes the
 * gap and makes the two extremes identical, because negating the swing maps a
 * symmetric pair onto itself — a four-legged horse with a two-frame walk and a
 * duplicate in it.
 *
 * Six is this sprite's version of the commander's one-column-apart answer. It
 * is larger here because these legs are anchored to a *stance* rather than to a
 * hip, the same trick buildGuardBody uses: a horse braced on a wall never
 * passes through legs-together, so all three frames can be checked for four
 * legs instead of only the two extremes. The commander's test checks two.
 */
const HIND_L = 5;
const HIND_R = 11;
const FORE_L = 18;
const FORE_R = 24;
const HORSE_SWING = 1;

/** The rows the legs occupy, and the row four hooves have to read as four. */
const HORSE_LEG_TOP = 19;
const HOOF_ROW = 25;

/**
 * Horse and rider as one grid, drawn facing +x.
 *
 * One sprite rather than two stacked draws for the reason buildCommanderGrid
 * gives: the two never move independently. This knight is mounted for the whole
 * siege, and a rider who could come off the horse would need a second
 * silhouette that nothing ever shows.
 *
 * Not shared with buildCommanderGrid, and that is a judgment call rather than
 * an oversight. The two horses agree on the *lesson* — pairs anchored to a
 * stance, opening opposite ways — and on nothing else: different grid, different
 * proportions, opposite value, one wearing a caparison in this file's livery.
 * Extracting the shape would mean a third module owning a parameterised horse
 * with a palette, a size and four leg centres passed in, which is most of the
 * function's body as arguments. The rule of three says wait for a third mount;
 * what is shared today is a comment, and the comment is in both places.
 */
function drawWarhorse(g: PixelGrid, C: MountPalette, frame: StrideFrame): void {
  const swing = swingOf(frame, HORSE_SWING);

  // Legs first, so the barrel covers where they meet the body.
  for (const x of [HIND_L - swing, HIND_R + swing, FORE_L - swing, FORE_R + swing]) {
    pixelRect(g, x, HORSE_LEG_TOP, 2, 8, C.horseDark);
    pixelRect(g, x, HOOF_ROW, 2, 2, C.boot);
  }

  // Tail before the barrel, so its root is buried rather than stuck on.
  pixelCurve(g, [5, 13], [1, 15], [1, 21], C.horseDark, 8);

  // Barrel, its lit top, and the chest the fore legs hang from.
  pixelEllipse(g, 15, 16, 12, 4.6, C.horse);
  pixelEllipse(g, 15, 14, 10.5, 2.8, C.horseHi);
  pixelEllipse(g, 23, 16, 4.5, 4.8, C.horse);

  // Neck as two stacked blocks rather than as a curve. pixelCurve lays down a
  // single cell per step, and a one-cell neck is entirely eaten by its own
  // outline: the horse ends up with its head floating clear of its shoulders.
  pixelRect(g, 24, 12, 5, 6, C.horse);
  pixelRect(g, 26, 8, 4, 5, C.horse);
  pixelRect(g, 25, 8, 2, 5, C.horseDark);

  // Head, muzzle, ear. The muzzle is dark so the head has a front at a size
  // where an eye would be one cell and read as damage.
  //
  // Centred on column 28 rather than 29, which puts the muzzle's last column at
  // 30 and leaves 31 for the outline. A nose flush with the edge of the grid
  // gets no outline on the side it most needs one, and the horse ends up
  // looking sawn off at the front — the one silhouette this sprite exists for.
  pixelEllipse(g, 28, 6, 2.8, 2.4, C.horse);
  pixelRect(g, 28, 5, 3, 2, C.horseDark);
  pixelTriangleUp(g, 27, 4, 1, 2, C.horseDark);

  // Caparison, so the horse reads as the retinue's rather than as a horse. It
  // stops at row 20, on the barrel: hung any lower it is one band of cloth
  // across the tops of all four legs, which is the fusion the priest's robe was
  // shortened to avoid, in the one place it would be four legs instead of two.
  pixelRect(g, 8, 17, 12, 4, C.livery);
  pixelRect(g, 8, 17, 12, 1, C.liveryHi);
}

/**
 * Knight: mounted, in plate, with the lance carried upright and a livery pennon
 * on it.
 *
 * Mounted is the whole point. The first pass drew this kind on foot with a
 * couched lance and argued that the lance was enough, because it is the shape
 * the enemy commander's charge is read from and therefore already means "this
 * one hits twice as hard". The playtest asked for the horse by name, and it was
 * right twice over: on foot the knight was the same 16x24 body as the other
 * three, and borrowing the charge silhouette to say so meant borrowing it from
 * something that is trying to kill you.
 *
 * So the lance stands up. A couched lance is now the enemy commander's alone —
 * two mounted bodies on one map need something other than a mount to tell them
 * apart, and a horizontal shaft versus a vertical one with a flag on it is a
 * difference that survives at any distance the sprites are visible at. Value
 * carries the rest: this horse is pale dun, his is near-black.
 */
export function buildKnightGuardGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.knight;
  const g = makePixelGrid(MOUNTED_SPRITE.w, MOUNTED_SPRITE.h);
  drawWarhorse(g, C, frame);

  // Rider's leg down the flank, before the torso, so the torso overlaps it.
  pixelRect(g, 14, 13, 3, 5, C.metal);
  pixelRect(g, 14, 17, 3, 2, C.boot);

  // Lance: shaft, tip on its top row, pennon, and the hand that holds it.
  // Column 8 keeps the whole thing clear of the helm, which starts at column
  // 13 — a pennon that overlapped the helm would have to be drawn under it,
  // and a flag behind a head is not a flag.
  pixelRect(g, 8, 2, 1, 11, C.boot);
  pixelTriangleUp(g, 8, 2, 1, 3, C.metalHi);
  pixelRect(g, 9, 3, 4, 3, C.livery);
  pixelRect(g, 9, 3, 4, 1, C.liveryHi);

  // Breastplate, pauldrons wider than the torso, helm, crest and visor slit.
  pixelRect(g, 13, 7, 7, 7, C.metal);
  pixelRect(g, 13, 7, 7, 2, C.metalHi);
  pixelRect(g, 11, 8, 2, 3, C.metal);
  pixelRect(g, 20, 8, 2, 3, C.metal);
  pixelEllipse(g, 16, 4, 3.2, 3.4, C.metal);
  pixelRect(g, 13, 3, 7, 1, C.metalHi);
  // Visor slit in `shade` rather than the seam colour: structure painted in the
  // outline's colour is indistinguishable from a seam once pixelOutline has
  // run, and the leg check downstream masks that colour out.
  pixelRect(g, 14, 5, 5, 1, C.shade);

  // The hand on the lance, bridging shaft to breastplate, and the rein arm
  // reaching down the neck on the leading side.
  pixelRect(g, 8, 11, 5, 1, C.skin);
  pixelRect(g, 19, 11, 3, 2, C.metal);
  pixelCurve(g, [21, 12], [24, 11], [27, 9], C.boot, 7);

  drawRankPips(g, C.rank, rank, MOUNTED_RANK);
  return pixelOutline(g, C.edge);
}

/**
 * Priest: a flat-crowned cowl, a shoulder cape, a robe wider than anybody
 * else's body, and a plain red cross across the whole chest.
 *
 * THE CROSS IS THE POINT AND IT IS DELIBERATELY OVERSIZED.
 *
 * The player asked for it in order to know who to protect, which makes
 * legibility the requirement rather than taste: it is 22 cells on a body of
 * about 150, a full seven rows tall and six wide, and it is the only red in the
 * retinue. A tasteful two-pixel cross on the shoulder would be the same failure
 * the buckler was — correct in the reference and invisible in the game.
 *
 * It replaces the stole. The first pass wore the livery as two vertical violet
 * bands down the chest, which was this kind's only chest device; two violet
 * bands and a red cross on a six-column torso is three stripes and a smear, so
 * the bands went and the livery moved to the hem, where it still says
 * "retinue" without competing. The robe was widened from six columns to nine at
 * the same time and for the same reason: a cross wide enough to read needs a
 * chest wide enough to carry it, and the wider robe is a second silhouette cue
 * for free — this is now the broadest body on foot in the game.
 *
 * THE ROBE STOPS AT THE BELT, AND THAT IS NOT A STYLE CHOICE.
 *
 * A floor-length cassock is the obvious way to draw this and it is exactly the
 * fusion bug recorded in buildGuardBody: a hem is a single band of cloth across
 * the boot row, so the two legs the stance is at pains to keep apart come back
 * as one run on every frame — worse than the original bug, which only merged
 * them at full swing. The priest therefore wears a hip-length robe over the
 * same legs everybody else walks on, and the leg check reads two runs here for
 * the same reason it does on the other three.
 *
 * The staff stops four rows above the boot row for the same family of reason: a
 * shaft planted on the ground beside the feet is a third vertical run at the
 * row that decides whether the legs fused, and one that the eye also reads as a
 * third leg at speed. Held clear of the ground it reads as carried.
 */
export function buildPriestGuardGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.priest;
  const g = buildGuardBody(C, frame);
  // Cowl: flat-crowned rather than the archer's round hood, so the two are not
  // the same head at distance.
  pixelRect(g, 6, 1, 5, 3, C.cloth);
  pixelEllipse(g, 8, 5, 3.5, 3.2, C.cloth);
  pixelEllipse(g, 8.7, 5.5, 2.2, 2, C.skin);
  // Robe and shoulder cape, both wider than the shared tunic underneath. They
  // sit one column to the trailing side of centre, which is what buys the staff
  // a clear column at 12 and its orb an outline inside the grid: a robe centred
  // on the body pushes the staff to column 14, and an orb centred on 14 is two
  // rows of flat edge against the right bound however small it is drawn.
  pixelRect(g, 3, 9, 9, 7, C.cloth);
  pixelRect(g, 2, 8, 10, 2, C.clothHi);
  // Livery at the hem, which is the whole of this kind's violet now.
  pixelRect(g, 3, 15, 9, 1, C.livery);
  // The cross: upright first, then the arms across it. Columns 8-9 and 6-11,
  // centred on each other, and starting at column 6 so that column 5 stays
  // clear between the arms and the rank ladder at 3-4 — a gold pip and a red
  // arm with no gap between them are one smear at the distance this is read at.
  pixelRect(g, 8, 10, 2, 7, C.cross);
  pixelRect(g, 6, 12, 6, 2, C.cross);
  // Staff: shaft, then a pale orb at the head. An orb rather than a ring —
  // a ring at this size needs a hole one pixel across, and one pixel of
  // background inside a two-pixel rim is not a hole, it is a smudge.
  pixelRect(g, 13, 5, 1, 14, C.boot);
  pixelEllipse(g, 13, 3, 1.9, 2.1, C.metal);
  pixelEllipse(g, 13, 2.6, 0.9, 1, C.metalHi);
  // The hand that holds it, bridging robe and shaft so the staff is carried
  // rather than floating alongside. On row 15, below the cross's arms: a hand
  // laid across them would take a bite out of the one thing this sprite exists
  // to show.
  pixelRect(g, 11, 15, 3, 1, C.skin);
  drawRankPips(g, C.rank, rank, ROBED_RANK);
  return pixelOutline(g, C.edge);
}

/**
 * One row per kind, so a fifth guard is a builder and a row, not a branch.
 *
 * A `Record` keyed by GuardKind, so the compiler refuses a new kind in
 * sim/guards.ts until it has a picture — the same guarantee GUARD_STATS gives
 * its numbers, and it holds for a kind that is never recruited exactly as it
 * does for one that is: `GuardKind` is the whole roster, not the roll.
 */

// ── MOUNT VARIANTS, UNDER REVIEW ─────────────────────────────────────────────
//
// Three candidate mounts plus the one that shipped, so they can be looked at
// side by side ON THE MAP rather than in a preview: a sprite that reads at 10x
// in a review image is not the same claim as one that reads at 32px in a fight.
//
// This is scaffolding with a end date. When a direction is chosen the other
// three go, `KNIGHT_VARIANTS` goes with them, and `buildKnightGuardGrid` keeps
// only the winner's body. Nothing outside this file should learn these names.
//
// What went wrong in the original, recorded because it is the trap: the neck
// was drawn as a column and the head set near the top of it, which is a camel.
// A horse's profile is ONE stroke — rising from the withers, turning over at
// the poll, coming back down the face to a muzzle — with a jaw notch to say
// where the head begins.

export type KnightVariant = 'current' | 'destrier' | 'courser' | 'barded';

const HOOF_Y = 25;

/** Four hooves in two pairs, each pair opening about a shared centre. */
function mountLegs(g: PixelGrid, C: GuardPalette & MountPalette, swing: number, fore: number, hind: number, top: number): void {
  for (const x of [fore - 1 - swing, fore + 1 + swing, hind - 1 - swing, hind + 1 + swing]) {
    pixelRect(g, x, top, 2, HOOF_Y - top, C.horse);
    pixelRect(g, x, top, 1, HOOF_Y - top, C.horseDark);
    pixelRect(g, x, HOOF_Y, 2, 2, C.horseDark);
  }
}

/**
 * Neck and head as one continuous tapering arch, ending in a squared muzzle.
 *
 * `plated` swaps the coat for armour, which is the whole of the barded variant
 * above the shoulder — a chanfron and crinet rather than a different animal.
 */
function mountForehand(g: PixelGrid, C: GuardPalette & MountPalette, wx: number, wy: number, plated: boolean): void {
  const body = plated ? C.metal : C.horse;
  const hi = plated ? C.metalHi : C.horseHi;
  const spine: readonly (readonly [number, number, number])[] = [
    [wx, wy, 6], [wx + 1, wy - 1, 6], [wx + 2, wy - 2, 5], [wx + 3, wy - 3, 5],
    [wx + 4, wy - 4, 4], [wx + 5, wy - 5, 4], [wx + 6, wy - 5, 4],
    [wx + 7, wy - 4, 3], [wx + 8, wy - 3, 3], [wx + 9, wy - 2, 2],
  ];
  for (const [x, top, depth] of spine) {
    pixelRect(g, x, top, 1, depth, body);
    setPixel(g, x, top, hi);
  }
  pixelRect(g, wx + 8, wy - 1, 2, 2, body);
  setPixel(g, wx + 9, wy, C.horseDark);
  // The jaw notch. Without it the arch reads as one bent tube.
  setPixel(g, wx + 6, wy - 1, C.horseDark);
  setPixel(g, wx + 7, wy, C.horseDark);
  // The eye takes the boot slate, not the seam colour: pixelOutline owns edge,
  // and structure painted in it is invisible to bodyRuns — which is the whole
  // reason this file has a test asserting the seam appears in exactly one call.
  if (!plated) setPixel(g, wx + 6, wy - 4, C.boot);
  pixelRect(g, wx + 5, wy - 7, 1, 2, body);
  for (let i = 0; i < 6; i++) setPixel(g, wx + i, wy - i - 1, plated ? hi : C.horseDark);
}

/**
 * The rider, shared by all three candidates, with the lance UPRIGHT.
 *
 * Couched, the shaft runs at exactly the height the head occupies and the two
 * merge into one bright bar at sprite scale. Upright it is a vertical instead,
 * it still says lancer, and it leaves the forehand alone.
 */
function mountRider(g: PixelGrid, C: GuardPalette, seatX: number, seatY: number, lean: number, rank: number): void {
  pixelRect(g, seatX - 5, seatY, 11, 3, C.livery);
  pixelRect(g, seatX - 5, seatY, 11, 1, C.liveryHi);
  pixelRect(g, seatX - 2, seatY + 2, 2, 5, C.boot);
  pixelRect(g, seatX - 3 + lean, seatY - 7, 7, 8, C.cloth);
  pixelRect(g, seatX - 3 + lean, seatY - 7, 7, 2, C.clothHi);
  pixelRect(g, seatX - 3 + lean, seatY - 1, 7, 1, C.shade);
  pixelRect(g, seatX + 3 + lean, seatY - 6, 2, 3, C.metal);
  pixelEllipse(g, seatX + lean, seatY - 10, 3.2, 2.8, C.metal);
  pixelRect(g, seatX - 3 + lean, seatY - 11, 7, 1, C.metalHi);
  pixelRect(g, seatX + 1 + lean, seatY - 10, 3, 1, C.shade);
  pixelRect(g, seatX - 1 + lean, seatY - 14, 2, 3, C.livery);
  pixelRect(g, seatX - 1 + lean, seatY - 14, 1, 3, C.liveryHi);
  const shaft = seatX + 4 + lean;
  pixelRect(g, shaft, 1, 1, seatY - 3, C.rank);
  pixelRect(g, shaft - 1, 0, 3, 2, C.metalHi);
  pixelRect(g, shaft + 1, 3, 3, 3, C.livery);
  pixelRect(g, shaft + 1, 3, 3, 1, C.liveryHi);
  for (let r = 0; r < rank; r++) pixelRect(g, seatX - 6 + lean, seatY - 6 + r * 2, 2, 1, C.rank);
}

/** A heavy warhorse: deep barrel, short cannon bones, crested neck. */
function buildDestrierGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.knight;
  const g = makePixelGrid(MOUNTED_SPRITE.w, MOUNTED_SPRITE.h);
  const s = swingOf(frame, 2);
  mountLegs(g, C, s, 22, 9, 19);
  pixelEllipse(g, 15, 16, 10, 4.2, C.horse);
  pixelRect(g, 6, 13, 19, 4, C.horse);
  pixelRect(g, 7, 13, 17, 1, C.horseHi);
  pixelEllipse(g, 8, 15, 4.5, 4, C.horse);
  mountForehand(g, C, 24, 14, false);
  pixelCurve(g, [5, 13], [2, 17], [2, 22], C.horseDark, 4);
  mountRider(g, C, 15, 12, 0, rank);
  return pixelOutline(g, C.edge);
}

/** A lighter horse: longer in the leg, head carried lower and further forward. */
function buildCourserGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.knight;
  const g = makePixelGrid(MOUNTED_SPRITE.w, MOUNTED_SPRITE.h);
  const s = swingOf(frame, 3);
  mountLegs(g, C, s, 23, 8, 18);
  pixelEllipse(g, 15, 16, 10, 3.4, C.horse);
  pixelRect(g, 6, 14, 20, 3, C.horse);
  pixelRect(g, 7, 14, 18, 1, C.horseHi);
  pixelEllipse(g, 7, 15, 4, 3.4, C.horse);
  mountForehand(g, C, 24, 15, false);
  pixelCurve(g, [4, 14], [1, 16], [0, 20], C.horseDark, 3);
  mountRider(g, C, 15, 13, 1, rank);
  return pixelOutline(g, C.edge);
}

/** The horse armoured: chanfron, crinet, and a caparison in the retinue's violet. */
function buildBardedGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.knight;
  const g = makePixelGrid(MOUNTED_SPRITE.w, MOUNTED_SPRITE.h);
  const s = swingOf(frame, 2);
  mountLegs(g, C, s, 22, 9, 20);
  pixelEllipse(g, 15, 16, 10, 4.2, C.horse);
  pixelRect(g, 6, 13, 19, 4, C.horse);
  pixelRect(g, 6, 15, 13, 6, C.livery);
  pixelRect(g, 6, 15, 13, 1, C.liveryHi);
  for (let x = 7; x < 19; x += 3) pixelRect(g, x, 20, 1, 2, C.livery);
  pixelRect(g, 21, 14, 4, 4, C.metal);
  pixelRect(g, 21, 14, 4, 1, C.metalHi);
  mountForehand(g, C, 24, 14, true);
  pixelRect(g, 29, 6, 1, 3, C.rank);
  pixelCurve(g, [5, 13], [2, 17], [2, 22], C.horseDark, 4);
  mountRider(g, C, 15, 12, 0, rank);
  return pixelOutline(g, C.edge);
}

/**
 * The candidates, by name. `current` is the sprite in the build, kept only so
 * the comparison happens against the real thing rather than against a memory.
 */
export const KNIGHT_VARIANTS: Record<KnightVariant, (frame: StrideFrame, rank: number) => PixelGrid> = {
  current: buildKnightGuardGrid,
  destrier: buildDestrierGrid,
  courser: buildCourserGrid,
  barded: buildBardedGrid,
};

export const KNIGHT_VARIANT_NAMES = ['current', 'destrier', 'courser', 'barded'] as const satisfies readonly KnightVariant[];

export const GUARD_GRID_BUILDERS: Record<GuardKind, (frame: StrideFrame, rank: number) => PixelGrid> = {
  archer: buildArcherGuardGrid,
  foot_soldier: buildFootSoldierGuardGrid,
  knight: buildKnightGuardGrid,
  priest: buildPriestGuardGrid,
};

/**
 * The grid for one guard: its kind, where it is in its stride, and what it has
 * earned.
 *
 * The entry point callers use, so nobody outside this file has to know that the
 * builders are a table. Kept as a function over the table rather than as the
 * table alone because the caller has a `Guard` in hand, and `kind` is the field
 * on it — not an index it should be looking anything up by.
 *
 * The grid it returns is `GUARD_SPRITES[kind]` and not necessarily
 * `GUARD_SPRITE`. A caller that sizes its canvas from the old constant will
 * clip the knight's horse in half and never throw.
 */
export function buildGuardGrid(kind: GuardKind, frame: StrideFrame, rank: number): PixelGrid {
  return GUARD_GRID_BUILDERS[kind](frame, rank);
}
