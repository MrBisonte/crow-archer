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
 * particular it draws a rank on a knight, which `GUARD_STATS.knight.promotable`
 * says can never happen: the rule has one home, and a second copy of it here
 * would be a second thing to edit the day that row changes.
 */

import type { GuardKind } from '../sim/guards';
import { MAX_RANK } from '../sim/guards';
import {
  makePixelGrid, pixelRect, pixelEllipse, pixelCurve, pixelOutline, pixelTriangleUp,
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
 */
export const GUARD_SPRITE = { w: 16, h: 24 };

/**
 * What every guard wears whatever kind it is: the house livery, the gold a
 * promotion is painted in, and one skin tone.
 *
 * Spread into all three palettes rather than repeated in each, because "the
 * retinue shares a livery" is the whole visual argument below and a copy in
 * each row is three places for it to stop being true.
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
 * desaturated — bronze, cold steel-blue, forest green — and all three guards
 * are pale, so on a busy screen the light bodies are yours and the dark ones
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
 */
export const GUARD_PALETTES: Record<GuardKind, Record<string, string>> = {
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
  knight: {
    ...SHARED_GUARD_COLOURS,
    cloth: '#DBE5F1', clothHi: '#F8FBFF', shade: '#6C7789',
    metal: '#C5D1E1', metalHi: '#FDFEFF',
    boot: '#5A5870', edge: '#1C2233',
  },
};

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
 * The body all three guards share: legs on the stride, a tunic, a belt and a
 * head. What each kind carries goes on top in its own builder, so the walk
 * cycle is written once rather than three times.
 */
function buildGuardBody(C: Record<string, string>, frame: StrideFrame): PixelGrid {
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
  pixelCurve(g, [6, 16], [(6 + footL) / 2, 19], [footL, BOOT_ROW], C['cloth']!, 10);
  pixelCurve(g, [9, 16], [(9 + footR) / 2, 19], [footR, BOOT_ROW], C['cloth']!, 10);
  // Two wide, and hung on the outside of each ankle rather than centred on it.
  // Centred boots eat a column of the gap from each side, which at the narrow
  // frame is the whole gap: the collapse comes back at the feet only, on the
  // one frame nobody checks. Pointing them outward also reads as braced.
  pixelRect(g, footL - 1, BOOT_ROW - 1, 2, 2, C['boot']!);
  pixelRect(g, footR, BOOT_ROW - 1, 2, 2, C['boot']!);

  pixelRect(g, 5, 9, 6, 8, C['cloth']!);
  pixelRect(g, 5, 9, 6, 2, C['clothHi']!);
  pixelRect(g, 5, 15, 6, 1, C['shade']!);

  pixelEllipse(g, 8, 5, 3, 3.2, C['skin']!);
  return g;
}

/**
 * Where the rank pips sit and how they stack.
 *
 * The trailing shoulder, because everything a kind is identified by is on the
 * leading side — the bow, the buckler, the lance — and a badge that shared a
 * side with those would be read as part of the weapon. Growing upward from a
 * fixed lowest pip gives the eye an anchor: the bottom mark is in the same
 * three cells at every rank, so the count is the only thing that changed.
 */
const RANK_X = 4;
const RANK_BASE_Y = 13;
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
function drawRankPips(g: PixelGrid, C: Record<string, string>, rank: number): void {
  const pips = clampRank(rank);
  for (let i = 0; i < pips; i++)
    pixelRect(g, RANK_X, RANK_BASE_Y - i * RANK_PITCH, 2, 1, C['rank']!);
}

/** Archer: a hood, a livery collar, and the bow drawn down the leading side. */
export function buildArcherGuardGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.archer;
  const g = buildGuardBody(C, frame);
  pixelEllipse(g, 8, 4, 3.6, 3.4, C['cloth']!);
  pixelEllipse(g, 8.5, 5, 2.4, 2.2, C['skin']!);
  // The collar is the only livery on this one: a hood in violet would read as a
  // dark head at distance and undo the pale-body rule the palette is built on.
  pixelRect(g, 5, 8, 6, 1, C['livery']!);
  // Stave and string, bent away from the body so the draw is visible in
  // silhouette rather than only in colour.
  pixelCurve(g, [12, 7], [15, 12], [12, 17], C['boot']!, 12);
  pixelRect(g, 12, 8, 1, 9, C['metalHi']!);
  pixelRect(g, 9, 11, 3, 1, C['skin']!);
  drawRankPips(g, C, rank);
  return pixelOutline(g, C['edge']!);
}

/**
 * Foot soldier: kettle helm, livery surcoat, a round buckler on the leading
 * side and the sword up behind the trailing shoulder.
 *
 * The buckler is small on purpose. The cavern's shieldman carries a slab from
 * edge to edge because sim/soldiers.ts gives it a 60-degree block and that
 * picture is where a player reads the rule off; this guard has no such rule, so
 * a shield that large would promise one. What it has is 3 hp, and the brimmed
 * helm and the wide surcoat are what that is drawn as.
 */
export function buildFootSoldierGuardGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.foot_soldier;
  const g = buildGuardBody(C, frame);
  pixelEllipse(g, 8, 4, 3.4, 2.8, C['metal']!);
  pixelEllipse(g, 8, 3, 3, 2, C['metalHi']!);
  // Brim wider than the head: the one line that separates this silhouette from
  // the garrison's flat-topped helm at a glance.
  pixelRect(g, 4, 6, 9, 1, C['metal']!);
  pixelRect(g, 6, 9, 4, 6, C['livery']!);
  pixelRect(g, 6, 9, 4, 1, C['liveryHi']!);
  // Sword shouldered, clear of the badge column: blade, guard, grip, hand.
  pixelRect(g, 2, 3, 1, 9, C['metalHi']!);
  pixelRect(g, 1, 12, 3, 1, C['metal']!);
  pixelRect(g, 2, 13, 1, 2, C['boot']!);
  pixelRect(g, 3, 14, 2, 1, C['skin']!);
  // Buckler: rim, face, boss.
  pixelEllipse(g, 12, 13, 3, 4, C['metal']!);
  pixelEllipse(g, 12, 13, 2, 3, C['livery']!);
  pixelEllipse(g, 12, 13, 0.9, 1, C['metalHi']!);
  drawRankPips(g, C, rank);
  return pixelOutline(g, C['edge']!);
}

/**
 * Knight: closed helm with a livery plume, plate across the shoulders and the
 * lance couched under the leading arm.
 *
 * The lance sits level and runs off the leading edge of the cell, which is the
 * same shape the enemy commander's charge is drawn with — deliberately, because
 * it is the shape "this one hits twice as hard" is already read from on this
 * map. Everything else about the two is opposite: he is mounted, dark and
 * crimson, this one is on foot, pale and violet.
 */
export function buildKnightGuardGrid(frame: StrideFrame, rank: number): PixelGrid {
  const C = GUARD_PALETTES.knight;
  const g = buildGuardBody(C, frame);
  pixelEllipse(g, 8, 4, 3.2, 3.4, C['metal']!);
  pixelRect(g, 5, 3, 6, 1, C['metalHi']!);
  // Visor slit in `shade` rather than the seam colour: structure painted in the
  // outline's colour is indistinguishable from a seam once pixelOutline has
  // run, and the leg check downstream masks that colour out.
  pixelRect(g, 6, 5, 5, 1, C['shade']!);
  pixelRect(g, 7, 0, 2, 3, C['livery']!);
  pixelRect(g, 7, 0, 2, 1, C['liveryHi']!);
  // Pauldrons wider than the torso, which is the whole read of "heavier plate".
  pixelRect(g, 4, 9, 8, 4, C['metal']!);
  pixelRect(g, 4, 9, 8, 1, C['metalHi']!);
  // Shaft level and out past the leading edge of the cell, head at the tip.
  // The head's base sits on the shaft's own row, not below it: a triangle based
  // one row down leaves the point floating a row clear of the shaft, and at
  // this size a detached tip reads as a speck of debris rather than as a spear.
  pixelRect(g, 5, 12, 11, 1, C['livery']!);
  pixelTriangleUp(g, 15, 12, 2, 3, C['metalHi']!);
  drawRankPips(g, C, rank);
  return pixelOutline(g, C['edge']!);
}

/**
 * One row per kind, so a fourth guard is a builder and a row, not a branch.
 *
 * A `Record` keyed by GuardKind, so the compiler refuses the fourth kind in
 * sim/guards.ts until it has a picture — the same guarantee GUARD_STATS gives
 * its numbers.
 */
export const GUARD_GRID_BUILDERS: Record<GuardKind, (frame: StrideFrame, rank: number) => PixelGrid> = {
  archer: buildArcherGuardGrid,
  foot_soldier: buildFootSoldierGuardGrid,
  knight: buildKnightGuardGrid,
};

/**
 * The grid for one guard: its kind, where it is in its stride, and what it has
 * earned.
 *
 * The entry point callers use, so nobody outside this file has to know that the
 * builders are a table. Kept as a function over the table rather than as the
 * table alone because the caller has a `Guard` in hand, and `kind` is the field
 * on it — not an index it should be looking anything up by.
 */
export function buildGuardGrid(kind: GuardKind, frame: StrideFrame, rank: number): PixelGrid {
  return GUARD_GRID_BUILDERS[kind](frame, rank);
}
