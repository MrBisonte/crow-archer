/**
 * What a ready ultimate looks like on the body: ten drawings, in pixel art.
 *
 * WHY THIS FILE EXISTS. The ten auras were smooth `ctx` strokes with
 * `shadowBlur` inline in `game.js`, matching the five that shipped first.
 * Sixteen-bit pixel art is this game's settled house style for everything it
 * draws, so the five legacy ones were the thing to change, not the standard to
 * match. All ten are redrawn here, together, because a hero's two ultimates
 * are seen one after the other and half a roster in each style is worse than
 * either style applied to all of it.
 *
 * WHY IT IS ALSO THE CHEAPER DRAWING. A stroked aura is re-stroked every
 * frame, and `shadowBlur` costs a raster pass each time. Pixel art on a fixed
 * number of stepped frames is a fixed number of pictures: ten abilities times
 * {@link AURA_FRAMES} frames is forty grids, each built once for the process
 * and painted once into a canvas `stamps` keeps. After the first second of a
 * run the aura costs one `drawImage`.
 *
 * That only holds if the GRID is memoized too, and this grain makes the trap
 * bigger rather than smaller. `stamps.get` returns a cached canvas WITHOUT
 * calling the painter, so a grid rebuilt per frame is up to three thousand
 * cells built and thrown away sixty times a second with nothing on screen to
 * show for it -- roughly fifteen times what the 4px grid wasted, and the exact
 * trap `_guardGrids` in `game.js` was written to close. {@link auraGrid} is
 * the cache, keyed on the ability and the frame, which is everything that
 * varies.
 *
 * THE 1px GRID. One cell is {@link AURA_CELL} canvas pixel -- the same grain
 * the hero's own sprite is drawn on -- and every mark is a whole cell, so
 * there is still no anti-aliasing, no sub-pixel edge and no smooth
 * interpolation anywhere in an aura. It was 4px, and the price of that
 * coarseness was shape: a ring drawn on it is 48 cells and reads as an
 * octagon. The same ring here is around 700 cells and is a circle. Rings,
 * arcs and THE BEAM's sweep are rasterised now rather than approximated,
 * which is what the finer grain was bought for.
 *
 * THE WEIGHT IS HELD; ONLY THE GRAIN CHANGED. Those two rings carry the same
 * INK -- 48 cells of 16 canvas pixels is 768, and 724 single pixels is 724 --
 * and that is the property worth keeping, because reading a tell across a dark
 * field at a glance is the entire job of one. So a mark that was one 4px cell
 * is {@link STROKE} cells wide here, not one. A hairline version of the same
 * drawing would be a different drawing, not a finer one.
 *
 * WHAT IS BEHIND HIM IS NOT DRAWN. The aura goes down BEFORE the sprite, so
 * anything inside the silhouette is painted and then covered -- which shipped
 * twice as a shaft with its middle missing and a chevron nobody could see.
 * {@link BODY} is that silhouette in cells and {@link blk} refuses to write
 * into it, so the failure cannot be reintroduced by drawing rather than by
 * forgetting. Shapes that straddle him -- the ground rings, the rising
 * chevrons -- are drawn whole and come out occluded, which is what standing in
 * a ring looks like.
 *
 * The colours are the abilities' own and are settled elsewhere: a hero's two
 * auras share his colour and never his shape, because the colour says who is
 * ready and the shape says with what.
 */
import { makePixelGrid, type PixelGrid } from './pixel-grid';
import { spriteCanvas } from './pixel-sprite';

const TAU = Math.PI * 2;

/** Cells across and down. Square, so one origin serves every aura. */
export const AURA_CELLS = 96;

/** Canvas pixels per cell. The grain the hero's own body is drawn on. */
export const AURA_CELL = 1;

/** Steps in a cycle. Stepped, never interpolated: four hand-placed poses is
 *  what makes an animation read as pixel art rather than as a tween. */
export const AURA_FRAMES = 4;

/**
 * How wide one mark is.
 *
 * The 4px grid's thinnest mark was one cell, which was four canvas pixels
 * wide. Three is what holds most of that ink at this grain while letting a
 * curve be a curve, and holding the ink is the point: the canvas is scaled
 * DOWN to fit a small viewport and never up, and a scanline overlay darkens
 * one row in four, so a one-pixel tell is one pixel at best.
 */
const STROKE = 3;

/** The same mark where something else is already carrying the read: a trail,
 *  a sheath, a crack past its first run.
 *
 *  Also the FLOOR. {@link dot} refuses anything thinner, because a one-cell
 *  mark does not survive the trip to the screen and four of them shipped in
 *  the first cut of these drawings. */
const THIN = 2;

/**
 * Where cell (0,0) sits relative to the hero's origin, in canvas pixels.
 *
 * `drawUltimateAura` translates to the hero's feet-ish origin, the same point
 * every hero's sprite is placed from. Chosen so column {@link CX} sits on
 * x = 0 and row {@link FLOOR} lands just under the tallest boot.
 */
const ORIGIN_X = 50;
const ORIGIN_Y = 54;

/** The hero's centre column. */
const CX = 50;

/**
 * The row ground shapes are centred on.
 *
 * Four pixels below the boots on purpose: a ring centred here has its back arc
 * behind his legs and its front arc clear of them, which is what says he is
 * standing IN it rather than wearing it.
 */
const FLOOR = 72;

/**
 * The ring a LONE traveller orbits on, clear of the boots at every angle.
 *
 * Lower and rounder than {@link FLOOR}, and the difference is the rule: a ring
 * with several things on it may pass behind him, because the ones in front go
 * on saying what it is. A ring with ONE thing on it may not -- looked at in
 * the game, THE BIG ONE's single spark simply went out for a quarter of its
 * lap, which is the beat that ability is entirely made of.
 *
 * "At every angle" has to include the BURN behind the head, which is the part
 * the 4px grid got away with and this one does not: the bright half of the
 * tail reaches a fifth of a lap further round than the spark does, and at the
 * old row it crossed the boots there and cut the head off its own trail.
 */
const RING_ROW = 80;
const RING_RX = 36;
const RING_RY = 11;

/**
 * The cells the hero's own sprite covers, and so the cells no aura may use.
 *
 * The knight is the biggest body on the roster at 30x36 drawn from y = -22
 * (`KNIGHT_SPRITE`, `drawKnight`), which is x in [-15, 15] and y in [-23, 14]
 * once the one-pixel walk bob is allowed for. At one canvas pixel per cell
 * that is those figures plus the origin above, with no rounding left to do --
 * the 4px grid had to take the enclosing cell and gave away three pixels a
 * side doing it.
 */
const BODY = { c0: 35, c1: 65, r0: 31, r1: 68 } as const;

/** Four steps, one per frame. */
type Steps<T> = readonly [T, T, T, T];

/** The step for a frame. `auraFrame` has already taken it modulo four, so the
 *  fallback is unreachable; it is here because the compiler cannot see that
 *  and a throw mid-frame would be a worse answer than the first pose. */
function step<T>(s: Steps<T>, f: number): T {
  return s[f] ?? s[0];
}

/**
 * One block, unless the hero is standing on it.
 *
 * The single write every painter below goes through, so the occlusion rule is
 * stated once instead of being remembered ten times.
 */
function blk(g: PixelGrid, c: number, r: number, colour: string): void {
  const ci = Math.round(c), ri = Math.round(r);
  if (ci >= BODY.c0 && ci <= BODY.c1 && ri >= BODY.r0 && ri <= BODY.r1) return;
  const row = g[ri];
  if (row && ci >= 0 && ci < row.length) row[ci] = colour;
}

/** A run of blocks along one row. */
function bar(g: PixelGrid, c: number, r: number, len: number, colour: string): void {
  for (let i = 0; i < len; i++) blk(g, c + i, r, colour);
}

/**
 * A square of side `d` centred on (c, r): the brush every curve is drawn with.
 *
 * A square and not a circle because the mark has to stay an axis-aligned block
 * at this grain -- a round brush would want its own edge shading, which is the
 * anti-aliasing this whole file exists without.
 */
function dot(g: PixelGrid, c: number, r: number, d: number, colour: string): void {
  // A one-cell mark is not a finer version of a mark, it is a mark that is
  // gone. The canvas is scaled DOWN to fit a small viewport and never up, so
  // a fractional factor deletes whole pixel rows, and the scanline overlay
  // darkens one row in four on top of that: a hairline comes out as dashes or
  // as nothing at all, in places that differ per viewport. Refused here
  // rather than reviewed, the way `blk` refuses to paint into the body.
  if (d < THIN) throw new Error('aura mark ' + d + ' cells wide; THIN (' + THIN + ') is the floor');
  const c0 = Math.round(c) - (d >> 1), r0 = Math.round(r) - (d >> 1);
  for (let i = 0; i < d; i++) bar(g, c0, r0 + i, d, colour);
}

/** A straight run between two points, `thick` cells wide. */
function seg(
  g: PixelGrid, x0: number, y0: number, x1: number, y1: number,
  thick: number, colour: string,
): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++)
    dot(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, thick, colour);
}

/**
 * An elliptical arc, rasterised.
 *
 * Sampled once per pixel of the longer radius, which is fine enough that
 * consecutive brush marks overlap at every eccentricity used here, so the
 * result is a continuous curve rather than a dotted one. This is the thing the
 * 4px grid could not do: eight chunks on a circle is an octagon, and an
 * octagon is what every ring in the first cut of these drawings was.
 */
function arc(
  g: PixelGrid, cx: number, cy: number, rx: number, ry: number,
  a0: number, a1: number, thick: number, colour: string,
): void {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry)));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    dot(g, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, thick, colour);
  }
}

// ── The ten drawings ─────────────────────────────────────────────────────────

/** The archer's yellow, both slots. */
const ARCHER = '#EAFF6A';
/** ARROW RAIN's mark on the floor, dull against the shafts landing in it. */
const ARCHER_RING = '#8A9840';
/** The wizard's violet, both slots. */
const WIZARD = '#A08CFF';
/** The mote that has arrived, and THE BEAM's core. */
const WHITE = '#FFFFFF';
/** The track a VORTEX mote comes in on, dull against the mote itself. */
const WIZARD_TRACK = '#4A3E80';
/** EARTHSHATTER's heat. The knight's other slot is deliberately not this. */
const QUAKE = '#FF7A1F';
/** THE LEAP's blue, and the shadow under it: the orange belongs to the
 *  ground, and THE LEAP is the one ultimate that leaves it. */
const LEAP = '#3A5CC8';
const LEAP_SHADOW = '#1C2C60';
/** The ranger's yellow, both slots, and FULL AUTO's dim trail. */
const RANGER = '#FFCC00';
const RANGER_TRAIL = '#7A6200';
/** The sapper's orange, both slots, with the flare a lit spark wears and the
 *  dim burn THE BIG ONE drags behind its head. */
const SAPPER = '#FF7A1A';
const SAPPER_FLARE = '#FFE9A0';
const SAPPER_TAIL = '#8A4210';

/** HEADSHOT's four corners, as half-width and half-height per frame, and the
 *  row they close onto. The vertical closes faster than the horizontal, so the
 *  corners are still clear of the helm at the step where the horizontal has
 *  narrowed to the width of it. */
const HEADSHOT_STEPS: Steps<readonly [number, number]> = [[30, 17], [25, 13], [20, 9], [16, 5]];
const HEADSHOT_ROW = 22;
/** How far each arm of a corner runs back toward the point. */
const HEADSHOT_ARM = 10;

/** EARTHSHATTER's cracks: a heading, where it starts and how far it runs.
 *  Five different lengths off five headings that are not mirror images, so the
 *  set reads as ground that has given way rather than as a bracket either side
 *  of him -- which is exactly what a symmetric star came out as. */
const QUAKE_CRACKS = [
  [0.45, 12, 24], [1.75, 10, 16], [2.75, 14, 20], [3.7, 12, 24], [5.7, 16, 16],
] as const;
/** How flat the ground plane is, how far a crack runs before it kinks, how far
 *  off its heading the kink takes it, and how much further it runs per frame. */
const QUAKE_SQUASH = 0.42;
const QUAKE_STEP = 9;
const QUAKE_KINK = 3;
const QUAKE_GROW = 4;

/** ARROW RAIN's ring on the floor, where its four shafts fall, the stagger
 *  each one is on, and the fall itself: where a shaft starts, how far it drops
 *  a step, and how long it is before the head. */
const RAIN_RX = 32;
const RAIN_RY = 10;
const RAIN_COLS: Steps<number> = [22, 30, 70, 78];
const RAIN_STAGGER: Steps<number> = [0, 2, 1, 3];
const RAIN_TOP = 8;
const RAIN_DROP = 17;
const RAIN_LEN = 16;

/** How far out VORTEX's motes stand, per step, and the row they orbit.
 *  Below the boots rather than on {@link FLOOR}: the innermost ring is the
 *  step where a mote ARRIVES, which is the one beat the ability has, and
 *  centred any higher the arrival happens behind his legs. */
const VORTEX_STEPS: Steps<number> = [34, 27, 20, 13];
const VORTEX_ROW = 75;
const VORTEX_SQUASH = 0.46;

/** The four angles THE BEAM's one lance is swept through, where it leaves him
 *  and how far it reaches. */
const BEAM_ANGLES: Steps<number> = [-1.05, -0.35, 0.35, 1.05];
const BEAM_ROW = 50;
const BEAM_FROM = 14;
const BEAM_TO = 44;

/** THE LEAP's four rungs: the row a chevron's vertex sits on and how far its
 *  arms reach. Two of the four are up at any moment and they narrow as they
 *  climb, so the pair reads as one thing leaving rather than as marks stacked
 *  up the body.
 *
 *  One rung apart, not two. Two evenly-spaced chevrons on a four-step ladder
 *  put the SAME pair of rows on screen at frames 0 and 2 and again at 1 and 3:
 *  a two-frame flicker paying for four cache entries, which is what it was and
 *  what looking at the four frames side by side is for. */
const LEAP_STEPS: Steps<readonly [number, number]> = [[70, 32], [50, 28], [26, 24], [6, 20]];
/** How far an arm falls per pixel it runs out, and how far under the chevron
 *  its shadow sits. */
const LEAP_SLOPE = 0.5;
const LEAP_DROP = 3;

/** HARPOON's two coils: the row they are centred on, the radii they run on
 *  and how much of a lap one bar covers. Round his BODY and not his feet,
 *  which is the one thing separating it from the three ground rings on the
 *  roster -- drawn at the feet it was two yellow marks in the grass, and a
 *  coil is the shape of the ability. Each bar covers more than half a lap,
 *  which is not the "two short bars" this started as and is the figure looking
 *  at it settled on: a bar shorter than the arc his own body hides spends
 *  whole frames behind him, and the frame where both did read as one smile
 *  drawn in the grass. Past half a lap each one always comes out the far
 *  side, and two of those counter-rotating is a line wound round itself. */
const HARPOON_ROW = 60;
const HARPOON_OUTER = 34;
const HARPOON_OUTER_RY = 22;
const HARPOON_INNER = 20;
const HARPOON_INNER_RY = 13;
const HARPOON_SPAN = 3.4;

/** FULL AUTO's stutter: the row the trail runs on, how far behind him it
 *  reaches, and the tick that rides it. */
const AUTO_ROW = 54;
const AUTO_SPAN = 32;
const AUTO_GAP = 4;
const AUTO_TICK_H = 10;

/** How far each of CARPET BOMB's seven sparks advances per frame. Seven
 *  different figures, which is what makes them chase rather than turn as one
 *  rigid wheel. */
const CARPET_STEPS = [0.5, 0.85, 0.35, 0.7, 0.95, 0.45, 0.75] as const;
const CARPET_RX = 34;
const CARPET_RY = 13;

/** How much of THE BIG ONE's lap the burn behind its head covers, and where
 *  along that the three bands of it change. */
const BIG_TAIL = 2.2;
const BIG_MID = 1.0;
const BIG_HEAD = 0.35;

/**
 * A run of floor that has given way.
 *
 * A heading with a kink every {@link QUAKE_STEP} pixels, the kink taken along
 * the ground plane's own perpendicular so it stays on the floor. A straight
 * ray is what the 4px grid could draw; at this grain a crack can bend, which
 * is the difference between a floor coming apart and a star drawn on it.
 */
function crack(g: PixelGrid, a: number, from: number, to: number): void {
  const dx = Math.cos(a), dy = Math.sin(a) * QUAKE_SQUASH;
  const nx = -Math.sin(a), ny = Math.cos(a) * QUAKE_SQUASH;
  let px = CX + dx * from, py = FLOOR + dy * from;
  for (let k = 0; from + k * QUAKE_STEP < to; k++) {
    const r = Math.min(from + (k + 1) * QUAKE_STEP, to);
    // A fixed zigzag rather than a random one: the crack that grows a step
    // longer next frame has to be the same crack, not a redrawn one.
    const off = k % 2 === 0 ? QUAKE_KINK : -QUAKE_KINK;
    const qx = CX + dx * r + nx * off, qy = FLOOR + dy * r + ny * off;
    // Widest where it started, which is where a floor actually opens.
    seg(g, px, py, qx, qy, k === 0 ? STROKE : THIN, QUAKE);
    px = qx; py = qy;
  }
}

/** What one aura is: the pictures, and how fast it steps through them. */
interface AuraArt {
  /** Frames per second. Four is a one-second cycle. */
  readonly fps: number;
  /** Paints frame `f` into a fresh grid. Called once per (ability, frame). */
  readonly draw: (g: PixelGrid, f: number) => void;
}

/**
 * The ten, keyed on the ability id `ULTIMATE` carries.
 *
 * Keyed on the ability and not the hero, which is the grain the tell has to
 * have: a hero owns two ultimates, one is equipped, and a player shown the
 * other one's aura has been told something and the thing he was told is wrong.
 * `ultimate-tables.test.ts` holds this key set to the ability table's.
 */
const AURA_ART: Readonly<Record<string, AuraArt>> = {
  // HEADSHOT: four corners closing on one point above him, a step a frame.
  // Everything narrowing to a point is the shot itself.
  headshot: {
    fps: 4,
    draw: (g, f) => {
      const [hx, hy] = step(HEADSHOT_STEPS, f);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const c = CX + sx * hx, r = HEADSHOT_ROW + sy * hy;
          // One corner: an arm along each axis, both running back at the point.
          seg(g, c, r, c - sx * HEADSHOT_ARM, r, STROKE, ARCHER);
          seg(g, c, r, c, r - sy * HEADSHOT_ARM, STROKE, ARCHER);
        }
      }
    },
  },

  // ARROW RAIN: shafts falling INTO a marked ring on the floor. It opens where
  // HEADSHOT closes -- the whole difference between a shot that picks one
  // target and a shot that fills a floor, in the same yellow.
  arrowRain: {
    fps: 4,
    draw: (g, f) => {
      arc(g, CX, FLOOR, RAIN_RX, RAIN_RY, 0, TAU, THIN, ARCHER_RING);
      for (let k = 0; k < 4; k++) {
        // Each shaft on its own stagger, so they arrive as rain rather than as
        // one volley dropping in step.
        const fall = (f + step(RAIN_STAGGER, k)) % AURA_FRAMES;
        const c = step(RAIN_COLS, k), top = RAIN_TOP + fall * RAIN_DROP;
        seg(g, c, top, c, top + RAIN_LEN, STROKE, ARCHER);
        // And a head, because at this grain an arrow can be an arrow.
        for (let i = 0; i < 4; i++) bar(g, c - 3 + i, top + RAIN_LEN + i, 7 - i * 2, ARCHER);
      }
    },
  },

  // VORTEX: motes stepping inward toward him and arriving one after another.
  // Everything on screen going to one point is what the ability does to the
  // field, at body scale before a crow has been dragged anywhere.
  vortex: {
    fps: 4,
    draw: (g, f) => {
      for (let k = 0; k < 8; k++) {
        const a = k * (TAU / 8);
        const at = (d: number): readonly [number, number] =>
          [CX + Math.cos(a) * d, VORTEX_ROW + Math.sin(a) * d * VORTEX_SQUASH];
        // The track the mote comes in on, dim and drawn whole. Eight lines
        // reaching one point is what says INWARD; eight dots without them say
        // ring, which is what this was and what CARPET BOMB already is.
        const [ox, oy] = at(VORTEX_STEPS[0]), [ix, iy] = at(VORTEX_STEPS[3]);
        seg(g, ox, oy, ix, iy, THIN, WIZARD_TRACK);
        const inward = (f + k) % AURA_FRAMES;
        // The one that has arrived flashes, and is a beat bigger for it: it is
        // the only frame in the cycle where the ability has done its thing.
        const here = inward === AURA_FRAMES - 1;
        const [hx, hy] = at(step(VORTEX_STEPS, inward));
        dot(g, hx, hy, here ? 9 : 6, here ? WHITE : WIZARD);
      }
    },
  },

  // THE BEAM: ONE lance leaving him, swept through four stepped angles. VORTEX
  // pulls inward and this cuts outward, which is the difference worth drawing
  // -- in his violet either way, because the colour is the hero.
  theBeam: {
    fps: 4,
    draw: (g, f) => {
      // The sweep it is travelling through, dim. A real arc at last, and an
      // arc is what says one lance being swept rather than four unrelated
      // angles taking turns.
      arc(g, CX, BEAM_ROW, BEAM_TO, BEAM_TO, BEAM_ANGLES[0], BEAM_ANGLES[3], THIN, WIZARD);
      const a = step(BEAM_ANGLES, f);
      const x0 = CX + Math.cos(a) * BEAM_FROM, y0 = BEAM_ROW + Math.sin(a) * BEAM_FROM;
      const x1 = CX + Math.cos(a) * BEAM_TO, y1 = BEAM_ROW + Math.sin(a) * BEAM_TO;
      // A sheath AROUND the core rather than beside it: a bright line with
      // nothing darker around it reads as thin.
      seg(g, x0, y0, x1, y1, STROKE * 2 + 1, WIZARD);
      seg(g, x0, y0, x1, y1, STROKE, WHITE);
      dot(g, x1, y1, STROKE * 2 + 1, WHITE);
    },
  },

  // EARTHSHATTER: cracks on the FLOOR, running a step further every frame.
  // The only aura on the ground, because his is the only ultimate that comes
  // out of it.
  earthshatter: {
    fps: 4,
    draw: (g, f) => {
      // Every crack starts clear of his boots and runs further each frame.
      // The gap in the middle is the part that was arrived at by looking: a
      // ground plane this squashed puts every shallow ray in the same two
      // rows, so rays that all reach a common centre merge there, and a solid
      // patch under his boots reads as a puddle rather than as a floor coming
      // apart.
      for (const [a, from, span] of QUAKE_CRACKS)
        crack(g, a, from, from + span + f * QUAKE_GROW);
    },
  },

  // THE LEAP: chevrons rising OFF him, four steps upward. EARTHSHATTER opens
  // the ground and this leaves it, so the shapes carry the read and the colour
  // does too -- his own blue, because the orange belongs to the floor.
  theLeap: {
    fps: 4,
    draw: (g, f) => {
      for (const rung of [0, 3]) {
        const [row, reach] = step(LEAP_STEPS, (f + rung) % AURA_FRAMES);
        for (const colour of [LEAP_SHADOW, LEAP]) {
          const drop = colour === LEAP_SHADOW ? LEAP_DROP : 0;
          // Two arms off one vertex, and at this grain they are real lines
          // rather than a staircase rounded to the nearest four pixels.
          for (const side of [-1, 1])
            seg(g, CX, row + drop, CX + side * reach,
              row + drop + reach * LEAP_SLOPE, STROKE, colour);
        }
      }
    },
  },

  // HARPOON: two short bars orbiting in opposite directions -- a line coiled
  // and loaded. What the line does is come back with something on the end of
  // it, so it closes on itself where FULL AUTO never does.
  harpoon: {
    fps: 4,
    draw: (g, f) => {
      // Two rings, not one: bars that shared a path would read as swapping
      // places rather than as running opposite ways round a coil. Curved to
      // their ring now, which is what makes them read as wound rather than as
      // two straight bars that happen to be moving.
      const a = TAU / 8 + f * (TAU / 4);
      arc(g, CX, HARPOON_ROW, HARPOON_OUTER, HARPOON_OUTER_RY, a, a + HARPOON_SPAN, STROKE, RANGER);
      // The inner bar runs the other way AND starts a quarter-lap off the
      // outer one's phase, so the two are never behind him together. Started
      // opposite it instead, they were: one frame in four had both arcs on the
      // far side and the tell all but went out.
      const b = -TAU / 8 - f * (TAU / 4);
      arc(g, CX, HARPOON_ROW, HARPOON_INNER, HARPOON_INNER_RY, b, b - HARPOON_SPAN, STROKE, RANGER);
    },
  },

  // FULL AUTO: a fast stutter of short ticks behind him, at the cadence he is
  // about to fire. Much faster than the other nine, which is the half of this
  // ability a player has to feel before he presses anything.
  fullAuto: {
    fps: 16,
    draw: (g, f) => {
      seg(g, 0, AUTO_ROW, AUTO_SPAN, AUTO_ROW, THIN, RANGER_TRAIL);
      for (let k = 0; k * AUTO_GAP < AUTO_SPAN; k++) {
        if ((k + f) % 3 !== 0) continue;
        const c = k * AUTO_GAP + 2;
        seg(g, c, AUTO_ROW - AUTO_TICK_H, c, AUTO_ROW, STROKE, RANGER);
      }
    },
  },

  // CARPET BOMB: seven sparks chasing round a ring on their own offsets. The
  // thing that is ready is a line of lit charges, and a fuse is the one image
  // in his kit that means 'about to'.
  carpetBomb: {
    fps: 4,
    draw: (g, f) => {
      // The line the charges are laid along. Seven dots on an ellipse read as
      // seven dots; on a drawn fuse they read as a fuse, which is the image
      // the ability is made of -- and a ring this thin is the thing the 4px
      // grid had no way to draw at all.
      arc(g, CX, FLOOR, CARPET_RX, CARPET_RY, 0, TAU, THIN, SAPPER_TAIL);
      for (const [k, own] of CARPET_STEPS.entries()) {
        const a = k * (TAU / 7) + f * own;
        const lit = (k + f) % 3 === 0;
        const c = CX + Math.cos(a) * CARPET_RX, r = FLOOR + Math.sin(a) * CARPET_RY;
        dot(g, c, r, lit ? 7 : 5, lit ? SAPPER_FLARE : SAPPER);
        if (!lit) continue;
        // A lit charge throws a cross, which is a spark and not just a bigger
        // dot. THIN and not STROKE: the dot under it carries the read.
        seg(g, c - 5, r, c + 5, r, THIN, SAPPER_FLARE);
        seg(g, c, r - 5, c, r + 5, THIN, SAPPER_FLARE);
      }
    },
  },

  // THE BIG ONE: one spark on one slow lap, dragging a dim tail. CARPET BOMB's
  // seven chase each other because it is a line of charges; this is a single
  // charge, and the lap time is the fuse.
  theBigOne: {
    fps: 2,
    draw: (g, f) => {
      // Started an eighth of a turn round, so the head sits on a diagonal at
      // every one of the four steps. On the axes it would spend a quarter of
      // its lap directly behind his legs, and the one spark going out is the
      // whole ability -- CARPET BOMB has six others to carry the read and
      // this has none.
      const head = TAU / 8 + f * (TAU / AURA_FRAMES);
      // Oldest first, so the head lands on top of its own burn rather than
      // under it. One arc in three bands, where the 4px grid had to spend six
      // discrete links to say the same thing and came out as a dotted line.
      const a = (back: number): number => head - back;
      arc(g, CX, RING_ROW, RING_RX, RING_RY, a(BIG_TAIL), a(BIG_MID), THIN, SAPPER_TAIL);
      arc(g, CX, RING_ROW, RING_RX, RING_RY, a(BIG_MID), a(BIG_HEAD), STROKE, SAPPER);
      arc(g, CX, RING_ROW, RING_RX, RING_RY, a(BIG_HEAD), head, STROKE + 1, SAPPER_FLARE);
      dot(g, CX + Math.cos(head) * RING_RX, RING_ROW + Math.sin(head) * RING_RY,
        STROKE * 2 + 1, SAPPER_FLARE);
    },
  },
};

/** The abilities that have a drawing here. Exported for the tests that hold
 *  this set to the ability table's. */
export const AURA_IDS: readonly string[] = Object.keys(AURA_ART);

/**
 * Which frame an aura is showing at time `t`, in seconds.
 *
 * Floored rather than interpolated, and per-ability rather than shared,
 * because the cadence is part of what each one says: THE BIG ONE's lap is its
 * fuse and FULL AUTO's stutter is its rate of fire.
 */
export function auraFrame(id: string, t: number): number {
  const art = AURA_ART[id];
  if (art === undefined) return 0;
  return ((Math.floor(t * art.fps) % AURA_FRAMES) + AURA_FRAMES) % AURA_FRAMES;
}

/**
 * One aura frame's grid, built once and kept.
 *
 * Memoized for the reason `_guardGrids` in `game.js` and `_iconGrids` in
 * `ultimate-icon-paint.ts` are: the painted canvas is already cached by
 * `stamps`, and on a cache hit -- every frame after the first -- `stamps.get`
 * hands it back WITHOUT calling the painter. An unmemoized grid is therefore
 * built and thrown away every frame the aura is up, which for a ready ultimate
 * is every frame until the player spends it.
 *
 * Bounded and tiny: ten abilities by {@link AURA_FRAMES} frames.
 *
 * Exported for the tests, which read every frame of all ten without a canvas.
 */
export function auraGrid(id: string, frame: number): PixelGrid | undefined {
  const art = AURA_ART[id];
  if (art === undefined) return undefined;
  const key = `${id}|${frame}`;
  const hit = _auraGrids.get(key);
  if (hit !== undefined) return hit;
  const g = makePixelGrid(AURA_CELLS, AURA_CELLS);
  art.draw(g, frame);
  _auraGrids.set(key, g);
  return g;
}

const _auraGrids = new Map<string, PixelGrid>();

/**
 * Paints `id`'s ready aura around the origin of the frame the caller is in.
 *
 * An unknown id draws nothing rather than throwing, the same answer
 * `paintUltimateIcon` gives: the tests bind this set to the ability table, so
 * reaching here with a stranger means something upstream is already wrong and
 * a crash mid-frame would only bury it.
 */
export function paintUltimateAura(
  ctx: CanvasRenderingContext2D, id: string, t: number,
): void {
  const frame = auraFrame(id, t);
  const grid = auraGrid(id, frame);
  if (grid === undefined) return;
  ctx.drawImage(
    spriteCanvas(`aura|${id}|${frame}`, grid, AURA_CELLS, AURA_CELLS, AURA_CELL),
    -ORIGIN_X, -ORIGIN_Y,
  );
}
