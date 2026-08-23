/**
 * The bastion map's tile art: a defended keep of pale dressed stone standing on
 * packed earth, under a ten-wave assault.
 *
 * Painters here take a PixelGrid and a seed and nothing else — no canvas, no
 * layout, no neighbour flags. tiles.ts wraps each of its painters around
 * `paintGrid` because it owns the blit and the offscreen layer; this file owns
 * neither, so every tile is a pure function of two numbers and a test can read
 * back every pixel without a browser, a DOM or a frame loop. Hanging these off
 * TILE_THEMES is tiles.ts's job; nothing here knows a theme table exists.
 *
 * The palette is bone limestone over warm ochre earth, with iron and rust for
 * the fittings. It has to read apart from the four existing themes at a glance,
 * and castle is the hard one because both maps are masonry. Castle's stone is a
 * cold neutral grey (#54545a walls over a #3a3a3c flagstone floor): dark, and
 * the floor is the same family as the walls, so the whole map sits inside one
 * narrow band of hue and value. Bastion inverts both halves of that. Its
 * masonry is pale and warm — the walls are the brightest thing on the map
 * rather than the middle of it — and the ground beneath them is brown earth
 * instead of more stone, so wall and floor separate by hue as well as by value.
 * Squint at the two and castle is grey with slightly lighter grey in it, while
 * bastion is white on brown. Against the other three the gap is wider still:
 * forest is green, maze a dark carved brown with no bright note anywhere, and
 * cavern a teal-black that shares no hue with any of this.
 *
 * Damage is the other half of the identity. This map is being stormed, so every
 * tile carries some evidence of it on some seeds — a scorch on the wall, a
 * spent stake in the earth, a chipped merlon. That is deliberately spread
 * across the seeds rather than painted on every tile: damage everywhere reads
 * as texture and stops meaning anything, and a field of identical damage is
 * exactly the visible repeat the seed exists to break up.
 */

import {
  pixelEllipse, pixelRect, pixelTriangleUp, setPixel, type PixelGrid,
} from './pixel-grid';

/** The 16x16 logical resolution every tile paints at. Matches tiles.ts. */
export const BASTION_TILE_GRID = 16;

/**
 * The map's colours, one name per job.
 *
 * Named rather than inlined because the wiring, the tests and the painters all
 * need to talk about the same colours, and a hex literal repeated across three
 * files is three chances to drift. Every entry is a distinct value on purpose:
 * two names holding one colour means one of them is doing no work, and the
 * tests assert that, because the usual way it happens is a copy-paste of a
 * neighbouring line that was then only half edited.
 *
 * The masonry runs bright-to-dark as stoneHi / stone / stoneShade / mortar, and
 * that spread is what makes a flat course read as stacked blocks rather than as
 * one pale field ruled into squares — the same trick the maze's wall plays,
 * pitched an order of value higher.
 */
const C = {
  // Ground: packed earth churned by ten waves of boots.
  earth: '#7a6142',
  earthDark: '#5f4a32',
  earthLit: '#8d7350',
  gravel: '#9a8763',
  clay: '#6a5334',
  shadow: '#4a3b28',
  // Masonry: pale dressed limestone, the thing that separates this map from castle.
  stone: '#d9cfb6',
  stoneHi: '#f0e8d2',
  stoneShade: '#b3a586',
  mortar: '#8f8265',
  // Fittings and damage.
  iron: '#4c4640',
  rust: '#8c3a24',
  soot: '#2e2a24',
  sootDark: '#221f1a',
  ember: '#c25a1e',
  char: '#3d3830',
  ashDrift: '#6a6258',
  // The scatter cover: dry, wind-bitten scrub rather than forest green.
  bark: '#54402a',
  barkLit: '#6e5638',
  leaf: '#6f7b3c',
  leafHi: '#8b9950',
  leafDark: '#55602c',
} as const;

/** Named so the wiring and the tests refer to one list of colours. */
export const BASTION_PALETTE: Readonly<Record<string, string>> = C;

/**
 * Fills the whole tile with one colour.
 *
 * Every painter opens with this, because these are tiles and not sprites:
 * anything transparent shows the layer canvas through it, and a map is not a
 * layer with anything behind it. Written through BASTION_TILE_GRID rather than
 * a literal 16 so the constant is load-bearing instead of decorative — if it
 * were only ever documentation, it could disagree with the art and nothing
 * would say so.
 */
function fillTile(grid: PixelGrid, colour: string): void {
  pixelRect(grid, 0, 0, BASTION_TILE_GRID, BASTION_TILE_GRID, colour);
}

/**
 * Bare earth with the two darkened seams every ground-family tile in this
 * codebase carries along its top and left edges.
 *
 * Shared by the three painters that stand something on the ground — the ground
 * itself, the tower and the tree — rather than pasted into each, because the
 * seams are what stop a field of tiles from reading as one undifferentiated
 * sheet, and a copy that loses them in one painter would show up as that one
 * tile type quietly dissolving into its neighbours. The grit belongs to the
 * ground painter alone and is not in here: a tower or a tree already gives the
 * eye something to land on, and the scatter under them just reads as noise.
 */
function paintEarthBase(grid: PixelGrid): void {
  fillTile(grid, C.earth);
  pixelRect(grid, 0, 0, BASTION_TILE_GRID, 1, C.earthDark);
  pixelRect(grid, 0, 0, 1, BASTION_TILE_GRID, C.earthDark);
}

/** Packed earth and gravel: the ground the fighting happens on. */
export function paintBastionGround(grid: PixelGrid, seed: number): void {
  paintEarthBase(grid);
  // Grit, damp patches and drag marks. Everything is keyed off the seed with a
  // different modulus so the marks land in different subsets of the map rather
  // than all on the same tiles, which is what makes a floor look churned
  // instead of stencilled.
  if (seed % 3 === 0) pixelRect(grid, (seed % 9) + 2, (seed % 7) + 3, 3, 1, C.clay);
  if (seed % 4 === 0) pixelRect(grid, (seed % 10) + 2, (seed % 8) + 6, 2, 2, C.earthLit);
  if (seed % 5 === 0) setPixel(grid, (seed % 13) + 1, (seed % 12) + 2, C.gravel);
  if (seed % 7 === 2) {
    const gx = (seed % 11) + 2, gy = (seed % 9) + 4;
    setPixel(grid, gx, gy, C.gravel);
    setPixel(grid, gx + 2, gy + 1, C.gravel);
    setPixel(grid, gx + 1, gy + 3, C.earthLit);
  }
  // A cart rut across the tile. The spots above are all marks *in* the ground;
  // a siege ground needs at least one line long enough to run off the edge and
  // join up with the neighbouring tile, or the floor reads as a grid of
  // separate patches rather than as one churned field.
  if (seed % 6 === 1) pixelRect(grid, 0, (seed % 8) + 5, BASTION_TILE_GRID, 1, C.earthDark);
  // A sharpened stake driven into the earth, left from an earlier wave. The one
  // thing on the ground tile that stands up out of it — the forest's EMPTY has
  // its grass tuft for the same reason, and this is what a siege ground grows
  // instead of grass.
  if (seed % 6 === 4) {
    const sx = (seed % 10) + 3;
    pixelRect(grid, sx, 8, 1, 6, C.bark);
    pixelTriangleUp(grid, sx, 8, 1, 3, C.barkLit);
    setPixel(grid, sx + 1, 13, C.shadow);
  }
  // Spall off the wall, so the ground and the masonry look like they belong to
  // one map rather than two.
  if (seed % 8 === 3) setPixel(grid, (seed % 12) + 2, (seed % 11) + 3, C.stoneShade);
}

/** A course of dressed masonry — the two-layer barrier in front of the towers. */
export function paintBastionStone(grid: PixelGrid, seed: number): void {
  // Edge to edge, unlike the tower below it. This is the barrier itself, and
  // art that reads as an object standing on the ground makes a defensive line
  // look like a row of ornaments — the same reason the maze's wall fills its
  // tile where the castle's pillar does not.
  fillTile(grid, C.stoneShade);
  // Two courses, the "two layers" the map's barrier is built from, in running
  // bond so a long stretch does not tile into obvious vertical stripes.
  for (let course = 0; course < 2; course++) {
    const top = course * 8;
    pixelRect(grid, 0, top, BASTION_TILE_GRID, 7, C.stone);
    // Each course catches the light on its own top edge and darkens on its own
    // underside; without both, two stacked courses read as one tall slab with a
    // line drawn through it.
    pixelRect(grid, 0, top, BASTION_TILE_GRID, 1, C.stoneHi);
    pixelRect(grid, 0, top + 6, BASTION_TILE_GRID, 1, C.stoneShade);
    pixelRect(grid, 0, top + 7, BASTION_TILE_GRID, 1, C.mortar);
    // Two head joints per course, staggered half a block between courses.
    const jog = course % 2 === 0 ? 5 : 11;
    pixelRect(grid, jog, top, 1, 7, C.mortar);
    pixelRect(grid, (jog + 8) % BASTION_TILE_GRID, top, 1, 7, C.mortar);
  }
  // What the assault has done to it: a chipped arris, a scorch where something
  // burning struck, rust weeping from an iron cramp, and fresh spall showing
  // the bright unweathered core. The `(seed % 2) * 8` puts the damage in one
  // course or the other rather than always the top one.
  if (seed % 3 === 0) pixelRect(grid, (seed % 9) + 3, (seed % 2) * 8 + 2, 3, 1, C.stoneShade);
  if (seed % 4 === 1) pixelRect(grid, (seed % 10) + 2, (seed % 2) * 8 + 3, 2, 2, C.soot);
  if (seed % 5 === 2) pixelRect(grid, (seed % 12) + 2, 7, 1, 2, C.rust);
  if (seed % 7 === 4) setPixel(grid, (seed % 13) + 1, (seed % 6) + 9, C.stoneHi);
}

/**
 * A defence tower. Painted for TILE.HUT on this map.
 *
 * Fills all 16 rows: nothing is left transparent. A crenellated top is the
 * obvious place to want transparency, and it is not needed here, because the
 * gaps between the merlons show the earth this tile has already painted behind
 * them. Leaving those gaps empty instead would punch holes in the map wherever
 * a tower stands, and the tile is opaque terrain, not a sprite standing on it.
 *
 * One tile is one whole tower, apex to base. The painter is given no neighbour
 * information — unlike the hut painters in tiles.ts, which switch roof, door and
 * window on `hutAbove`/`hutLeft` to assemble a 2x2 building out of four tiles —
 * so a cluster here reads as a rank of towers along the wall rather than as one
 * building with three quarters of it missing. A neighbour-aware version is a
 * bigger signature and a different job; this one cannot get that wrong.
 */
export function paintBastionTower(grid: PixelGrid, seed: number): void {
  paintEarthBase(grid);
  // Contact shadow, in a flat hex rather than the translucent black tiles.ts
  // uses. Everything here has to survive a check that every cell is a real hex
  // colour, and an rgba() shadow is the one thing in the existing tile art that
  // would not; on ground this uniform a baked-in shade costs nothing anyway.
  pixelEllipse(grid, 8, 15, 6, 1.4, C.shadow);

  // Drum, inset two columns each side so earth shows down both flanks. That
  // inset is the whole difference in silhouette between this tile and the stone
  // course: barrier fills its tile, tower stands in one.
  pixelRect(grid, 3, 5, 10, 11, C.stone);
  pixelRect(grid, 3, 5, 2, 11, C.stoneHi);
  pixelRect(grid, 11, 5, 2, 11, C.stoneShade);
  // Parapet, overhanging the drum by a column each side, with the corbel
  // shadow under it. A tower whose top is flush with its shaft reads as a pipe.
  pixelRect(grid, 2, 3, 12, 2, C.stone);
  pixelRect(grid, 2, 3, 12, 1, C.stoneHi);
  pixelRect(grid, 3, 5, 10, 1, C.stoneShade);
  // Three merlons over the parapet; the crenels between them are the earth
  // base showing through. Two wide at columns 2, 7 and 12, which is the only
  // spacing that comes out symmetric about the tile's centre and flush with
  // both ends of a 12-column parapet — three-wide merlons need 11 columns and
  // leave a stray column of parapet at one end, which reads as a tower built
  // slightly crooked rather than as a wider merlon.
  for (let m = 0; m < 3; m++) {
    pixelRect(grid, 2 + m * 5, 1, 2, 2, C.stone);
    pixelRect(grid, 2 + m * 5, 1, 2, 1, C.stoneHi);
  }
  // Bed and head joints on the drum, staggered, so it is masonry and not
  // render. The head joints avoid the middle columns on purpose: an arrow slit
  // goes there and would swallow any joint drawn behind it, leaving a course
  // that looks like one unbroken block.
  pixelRect(grid, 3, 9, 10, 1, C.mortar);
  pixelRect(grid, 3, 13, 10, 1, C.mortar);
  pixelRect(grid, 10, 6, 1, 3, C.mortar);
  pixelRect(grid, 5, 10, 1, 3, C.mortar);
  pixelRect(grid, 10, 14, 1, 2, C.mortar);
  // Door at the base and an arrow slit above it, painted last so they cut
  // through the joint lines rather than being cut by them.
  pixelRect(grid, 6, 12, 4, 4, C.iron);
  pixelRect(grid, 6, 12, 4, 1, C.stoneShade);
  pixelRect(grid, 7, 7, 2, 4, C.iron);
  setPixel(grid, 7, 6, C.stoneShade);
  setPixel(grid, 8, 6, C.stoneShade);

  // Per-tower variation. A rank of towers along one wall is the most repetitive
  // thing this map draws, so this is the tile that most needs its seed.
  if (seed % 3 === 0) {
    // Banner hung from the parapet down the shaded face, with a forked tail.
    // Deliberately not on the middle columns beside the slit: rust and iron are
    // the two dark things on a pale tower, and butted against each other they
    // merge into one dark blot that reads as damage rather than as a banner.
    pixelRect(grid, 10, 6, 2, 5, C.rust);
    setPixel(grid, 10, 11, C.rust);
  }
  if (seed % 4 === 1) pixelRect(grid, (seed % 5) + 5, (seed % 2) + 10, 2, 2, C.soot);
  // A merlon knocked off its top course: the stone goes, the earth behind shows.
  if (seed % 5 === 2) {
    const mx = 2 + (seed % 3) * 5;
    pixelRect(grid, mx, 1, 2, 1, C.earth);
    pixelRect(grid, mx, 2, 2, 1, C.stoneShade);
  }
  // A brazier lit on the roof line.
  if (seed % 7 === 3) {
    setPixel(grid, 12, 0, C.char);
    setPixel(grid, 13, 0, C.ember);
  }
}

/** A wind-bent tree, sparse scatter cover on the battlefield. */
export function paintBastionTree(grid: PixelGrid, seed: number): void {
  paintEarthBase(grid);
  pixelEllipse(grid, 8, 14, 5, 1.4, C.shadow);
  // Everything leans the same way, downwind, and only the amount varies. Trees
  // that leaned in seed-chosen directions read as a wood that grew crookedly;
  // one direction across the whole map reads as weather, which is the point of
  // putting anything living on a siege ground at all.
  const lean = seed % 2;
  pixelRect(grid, 4, 14, 3, 1, C.bark);
  pixelRect(grid, 8, 14, 3, 1, C.bark);
  pixelRect(grid, 6, 12, 2, 3, C.bark);
  pixelRect(grid, 7, 9, 2, 3, C.bark);
  pixelRect(grid, 8 + lean, 6, 2, 3, C.bark);
  pixelRect(grid, 6, 12, 1, 3, C.barkLit);
  pixelRect(grid, 7, 9, 1, 3, C.barkLit);
  // Canopy streaming off the lean rather than sitting on top of it: three lobes
  // of decreasing size trailing downwind. Two even circles centred on the trunk
  // read as a lollipop, and a lollipop cannot look wind-bent no matter how far
  // the trunk leans under it.
  pixelEllipse(grid, 10 + lean, 5, 4, 2.4, C.leaf);
  pixelEllipse(grid, 13 + lean, 6, 2.2, 1.6, C.leafDark);
  pixelEllipse(grid, 9 + lean, 4, 2, 1.4, C.leafHi);
  // Dry olive, not forest green: this is scrub that has stood through a siege.
  if (seed % 3 === 1) setPixel(grid, 12 + lean, 4, C.leafHi);
  if (seed % 4 === 2) pixelRect(grid, (seed % 8) + 3, 12, 2, 1, C.leafDark);
  // A branch taken off by something in flight, and the scar it left.
  if (seed % 5 === 3) {
    pixelRect(grid, 4, 8, 2, 1, C.bark);
    setPixel(grid, 6, 8, C.char);
  }
}

/** Scorched ground where something burned. */
export function paintBastionAsh(grid: PixelGrid, seed: number): void {
  fillTile(grid, C.soot);
  pixelRect(grid, 0, 0, BASTION_TILE_GRID, 1, C.sootDark);
  pixelRect(grid, 0, 0, 1, BASTION_TILE_GRID, C.sootDark);
  // Two greys of debris and one pale drift, because a scorch painted in a
  // single dark tone is a hole in the map rather than a surface.
  if (seed % 3 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 2, C.char);
  if (seed % 4 === 2) pixelRect(grid, (seed % 9) + 4, (seed % 7) + 6, 3, 1, C.ashDrift);
  if (seed % 5 === 0) setPixel(grid, (seed % 12) + 3, (seed % 10) + 4, C.ember);
  // The burnt stump of a stake, the ground tile's stake after the fire went
  // through it. Ash is where something used to be, and a tile that only says
  // "dark" does not say what.
  if (seed % 4 === 1) {
    const sx = (seed % 9) + 4;
    pixelRect(grid, sx, 9, 2, 4, C.char);
    pixelRect(grid, sx, 9, 2, 1, C.ashDrift);
    setPixel(grid, sx, 12, C.ember);
  }
  // Rust bleeding out of whatever ironwork burned with it.
  if (seed % 7 === 5) pixelRect(grid, (seed % 10) + 3, (seed % 6) + 8, 2, 1, C.rust);
}
