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
  // Standing water. The generator makes none, so these exist for the case a
  // run somehow produces a pool anyway: a siege ground's water should read as
  // a churned puddle in this map's own earth, not as a window onto the forest.
  puddle: '#3c3020',
  puddleLit: '#5a4832',
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
 * A defence tower, assembled from the four tiles of its 2x2 footprint.
 *
 * Each call paints ONE quadrant of one 64px tower. `hutAbove` and `hutLeft` say
 * which: a tile with a hut to its left is the eastern column, a tile with a hut
 * above it is the southern row. The tile system already computes both for the
 * castle's huts, which assemble the same way — this is that mechanism used for
 * the thing it was built for.
 *
 * The whole tower is laid out in one 32x32 coordinate space and each quadrant
 * draws the parts of it that fall inside its own 16x16 window, by subtracting
 * its origin. `setPixel` bounds-checks, so everything outside simply clips and
 * no part has to be split by hand at the seam — which is what makes the door
 * able to straddle the two southern tiles at all.
 *
 * One tile used to be one whole tower, and the comment here used to explain why
 * that was right: a neighbour-aware version was "a bigger signature and a
 * different job". It was, and this is that job. The reason it became worth
 * doing is that a 32px tower is the same size as the hero and smaller than most
 * of what walks at it, which reads as a bollard rather than as the thing the
 * map is named for.
 *
 * Nothing is left transparent, in any quadrant. The crenellation gaps show the
 * earth the tile has already painted behind them; leaving them empty would
 * punch holes in the map, because this is opaque terrain and not a sprite.
 *
 * Per-tile variation is deliberately kept LOCAL to a quadrant. Each of the four
 * tiles gets its own seed from the tile layer, so anything that spanned the
 * seam would be decided twice and disagree with itself; a banner hung on the
 * eastern face is one quadrant's business and cannot contradict its neighbour.
 */
export function paintBastionTower(
  grid: PixelGrid,
  seed: number,
  hutAbove = false,
  hutLeft = false,
): void {
  paintEarthBase(grid);

  // This tile's origin inside the tower's own 32x32 space.
  const ox = hutLeft ? BASTION_TILE_GRID : 0;
  const oy = hutAbove ? BASTION_TILE_GRID : 0;
  const rect = (x: number, y: number, w: number, h: number, c: string): void =>
    pixelRect(grid, x - ox, y - oy, w, h, c);
  const dot = (x: number, y: number, c: string): void => setPixel(grid, x - ox, y - oy, c);

  // Contact shadow, in a flat hex rather than a translucent black: every cell
  // here has to be a real hex colour, and on ground this uniform a baked-in
  // shade costs nothing.
  pixelEllipse(grid, 16 - ox, 30 - oy, 10, 2.2, C.shadow);

  // Drum, inset four columns each side so earth shows down both flanks. That
  // inset is the difference in silhouette between a tower and the stone course:
  // barrier fills its tile, tower stands in one.
  rect(7, 7, 18, 23, C.stone);
  rect(7, 7, 3, 23, C.stoneHi);
  rect(22, 7, 3, 23, C.stoneShade);

  // Parapet, overhanging the drum by two columns each side, with the corbel
  // shadow under it. A tower whose top is flush with its shaft reads as a pipe.
  rect(5, 4, 22, 3, C.stone);
  rect(5, 4, 22, 1, C.stoneHi);
  rect(7, 7, 18, 1, C.stoneShade);

  // Four merlons, four wide, over a 22-wide parapet: 4*4 + 3*2 = 22 exactly,
  // so the rank is symmetric about the centre and flush with both ends. The
  // crenels between them are the earth base showing through.
  for (let m = 0; m < 4; m++) {
    rect(5 + m * 6, 1, 4, 3, C.stone);
    rect(5 + m * 6, 1, 4, 1, C.stoneHi);
  }

  // Bed and head joints, staggered, so it is masonry and not render. The head
  // joints avoid the columns the slits and the door occupy, which would
  // otherwise swallow them and leave a course looking like one unbroken block.
  for (const y of [12, 18, 24]) rect(7, y, 18, 1, C.mortar);
  rect(10, 8, 1, 4, C.mortar);
  rect(16, 13, 1, 5, C.mortar);
  rect(21, 19, 1, 5, C.mortar);
  rect(9, 19, 1, 5, C.mortar);
  rect(19, 25, 1, 5, C.mortar);

  // Door across the seam of the two southern tiles, and two arrow slits above
  // it. Painted after the joints so they cut through the courses rather than
  // being cut by them.
  rect(13, 23, 6, 7, C.iron);
  rect(13, 23, 6, 1, C.stoneShade);
  rect(11, 13, 2, 6, C.iron);
  rect(19, 13, 2, 6, C.iron);
  rect(11, 12, 2, 1, C.stoneShade);
  rect(19, 12, 2, 1, C.stoneShade);

  // Per-quadrant dressing. A rank of towers along one wall is the most
  // repetitive thing this map draws, so each tile still spends its seed --
  // only on marks that belong to it alone.
  if (!hutAbove && hutLeft && seed % 3 === 0) {
    // A banner down the shaded eastern face, with a forked tail. Kept off the
    // slit columns: rust and iron are the two dark things on a pale tower, and
    // butted together they merge into a blot that reads as damage.
    rect(22, 8, 2, 6, C.rust);
    dot(22, 14, C.rust);
  }
  if (!hutAbove && seed % 5 === 2) {
    // A merlon knocked off the top course: the stone goes, the earth shows.
    const mx = 5 + (seed % 2) * 6 + ox;
    rect(mx, 1, 4, 2, C.earth);
    rect(mx, 3, 4, 1, C.stoneShade);
  }
  if (hutAbove && seed % 4 === 1) {
    rect((seed % 4) + 8 + ox, (seed % 3) + 20, 2, 2, C.soot);
  }
  if (!hutAbove && !hutLeft && seed % 7 === 3) {
    // A brazier lit on the roof line.
    dot(14, 0, C.char);
    dot(15, 0, C.ember);
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

/**
 * A sapling: ash growing back into cover.
 *
 * Needed because the bastion is `destructibleTerrain: true`, so `Regrowth`
 * turns its burnt ground back into trees by way of this stage. A missing
 * painter here fails quietly rather than loudly — `StaticTileLayer` skips a
 * tile it has no painter for — so the tile would be a hole in the ground that
 * blocks a body while showing nothing. `tiles.test.ts` is what caught its
 * absence, which is the whole reason that test lists grown tiles separately
 * from generated ones.
 *
 * Drawn as the tree's own shape at a third the height and with one lobe rather
 * than three, and leaning the same way, so it reads as the same species caught
 * early rather than as a different plant.
 */
export function paintBastionSapling(grid: PixelGrid, seed: number): void {
  paintEarthBase(grid);
  pixelEllipse(grid, 8, 14, 3, 1, C.shadow);
  const lean = seed % 2;
  pixelRect(grid, 7, 11, 2, 4, C.bark);
  pixelRect(grid, 7, 11, 1, 4, C.barkLit);
  pixelEllipse(grid, 8 + lean, 9, 2.6, 2, C.leaf);
  pixelEllipse(grid, 7 + lean, 8, 1.4, 1.2, C.leafHi);
  if (seed % 3 === 0) pixelEllipse(grid, 10 + lean, 10, 1, 1, C.leafDark);
}

/**
 * Standing water, which `BastionTerrain` never generates.
 *
 * It exists because `TILE_THEMES` is checked for every tile a map can hold and
 * not for every tile it happens to produce, and that is the right way round: a
 * theme that answers only for today's generator breaks the moment the
 * generator changes, and it breaks silently. Painting it in this map's earth
 * rather than borrowing another theme's blue means that if a pool ever does
 * appear here it looks like a mistake in the right palette instead of a hole
 * cut through to the forest.
 */
export function paintBastionWater(grid: PixelGrid, seed: number): void {
  fillTile(grid, C.puddle);
  pixelRect(grid, 0, 0, BASTION_TILE_GRID, 1, C.shadow);
  pixelRect(grid, 0, 0, 1, BASTION_TILE_GRID, C.shadow);
  pixelEllipse(grid, 8, 8, 5, 3.5, C.puddleLit);
  if (seed % 2 === 0) pixelRect(grid, (seed % 7) + 3, (seed % 5) + 5, 3, 1, C.puddle);
  if (seed % 3 === 0) pixelRect(grid, (seed % 6) + 5, (seed % 7) + 4, 2, 1, C.clay);
}
