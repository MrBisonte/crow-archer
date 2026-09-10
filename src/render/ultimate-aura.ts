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
 * That only holds if the GRID is memoized too. `stamps.get` returns a cached
 * canvas WITHOUT calling the painter, so a grid rebuilt per frame is 576 cells
 * built and thrown away sixty times a second with nothing on screen to show
 * for it -- the exact trap `_guardGrids` in `game.js` was written to close.
 * {@link auraGrid} is the cache, keyed on the ability and the frame, which is
 * everything that varies.
 *
 * THE 4px GRID. One cell is {@link AURA_CELL} canvas pixels and every mark is
 * a whole cell, so there is no anti-aliasing, no sub-pixel edge and no smooth
 * interpolation anywhere in an aura. The hero's own sprite is drawn at one
 * canvas pixel per art pixel; the aura is deliberately four times coarser,
 * because it has to be read at a glance across a field while the sprite is
 * read up close.
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
export const AURA_CELLS = 24;

/** Canvas pixels per cell. The grid the house style is drawn on. */
export const AURA_CELL = 4;

/** Steps in a cycle. Stepped, never interpolated: four hand-placed poses is
 *  what makes an animation read as pixel art rather than as a tween. */
export const AURA_FRAMES = 4;

/**
 * Where cell (0,0) sits relative to the hero's origin, in canvas pixels.
 *
 * `drawUltimateAura` translates to the hero's feet-ish origin, the same point
 * every hero's sprite is placed from. Chosen so column {@link CX} straddles
 * x = 0 and row {@link FLOOR} lands just under the tallest boot.
 */
const ORIGIN_X = 50;
const ORIGIN_Y = 54;

/** The hero's centre column. */
const CX = 12;

/**
 * The row ground shapes are centred on.
 *
 * Half a cell below the boots on purpose: a ring centred here has its back arc
 * behind his legs and its front arc clear of them, which is what says he is
 * standing IN it rather than wearing it.
 */
const FLOOR = 17.5;

/**
 * The ring a LONE traveller orbits on, clear of the boots at every angle.
 *
 * Lower and rounder than {@link FLOOR}, and the difference is the rule: a ring
 * with several things on it may pass behind him, because the ones in front go
 * on saying what it is. A ring with ONE thing on it may not -- looked at in
 * the game, THE BIG ONE's single spark simply went out for a quarter of its
 * lap, which is the beat that ability is entirely made of.
 */
const RING_ROW = 19;
const RING_RX = 9;
const RING_RY = 3.4;

/**
 * The cells the hero's own sprite covers, and so the cells no aura may use.
 *
 * The knight is the biggest body on the roster at 30x36 drawn from y = -22
 * (`KNIGHT_SPRITE`, `drawKnight`), which is x in [-15, 15] and y in [-23, 14]
 * once the one-pixel walk bob is allowed for. Divided by {@link AURA_CELL} and
 * offset by the origin above, that is these columns and rows.
 */
const BODY = { c0: 8, c1: 16, r0: 7, r1: 16 } as const;

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

/** A run of blocks down one column. */
function vbar(g: PixelGrid, c: number, r: number, len: number, colour: string): void {
  for (let i = 0; i < len; i++) blk(g, c, r + i, colour);
}

/**
 * A `w` by `h` chunk sitting on a ground-plane ellipse at angle `a`.
 *
 * Chunks rather than single cells because a mote is meant to be seen from
 * across a field: one cell is four pixels, and eight of those on a ring read
 * as dirt on the screen rather than as anything the ability is doing.
 */
function atRing(
  g: PixelGrid, cx: number, cy: number, rx: number, ry: number, a: number,
  w: number, h: number, colour: string,
): void {
  const x = Math.round(cx + Math.cos(a) * rx) - (w >> 1);
  const y = Math.round(cy + Math.sin(a) * ry) - (h >> 1);
  for (let r = 0; r < h; r++) bar(g, x, y + r, w, colour);
}

/** A staircase of blocks out along one ray. Half-cell steps, so a shallow
 *  angle comes out as a run rather than as a dotted line. */
function ray(
  g: PixelGrid,
  cx: number, cy: number, a: number, from: number, to: number, squash: number,
  colour: string,
): void {
  const dx = Math.cos(a), dy = Math.sin(a) * squash;
  for (let r = from; r <= to; r += 0.5) blk(g, cx + dx * r, cy + dy * r, colour);
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

/** HEADSHOT's four tick pairs, as half-width and half-height per frame, and
 *  the row they close onto. The vertical closes faster than the horizontal, so
 *  the pairs are still clear of the helm at the step where the horizontal has
 *  narrowed to the width of it. */
const HEADSHOT_STEPS: Steps<readonly [number, number]> = [[7, 4], [6, 3], [5, 2], [4, 1]];
const HEADSHOT_ROW = 5;

/** EARTHSHATTER's cracks: a heading, where it starts and how far it runs.
 *  Five different lengths off five headings that are not mirror images, so the
 *  set reads as ground that has given way rather than as a bracket either side
 *  of him -- which is exactly what a symmetric star came out as. */
const QUAKE_CRACKS = [
  [0.45, 3, 6], [1.75, 2.5, 4], [2.75, 3.5, 5], [3.7, 3, 6], [5.7, 4, 4],
] as const;

/** Where ARROW RAIN's four shafts fall, and the stagger each one is on. */
const RAIN_COLS: Steps<number> = [5, 7, 17, 19];
const RAIN_STAGGER: Steps<number> = [0, 2, 1, 3];

/** How far out VORTEX's motes stand, per step. */
const VORTEX_STEPS: Steps<number> = [9, 7, 5, 3];

/** The four angles THE BEAM's one lance is swept through. */
const BEAM_ANGLES: Steps<number> = [-1.05, -0.35, 0.35, 1.05];

/** THE LEAP's four rungs: the row a chevron sits on and its half-width. They
 *  narrow as they climb, so three read as one thing leaving rather than as
 *  three marks stacked up the body. */
const LEAP_STEPS: Steps<readonly [number, number]> = [[17, 8], [12, 7], [6, 6], [1, 5]];

/** How far each of CARPET BOMB's seven sparks advances per frame. Seven
 *  different figures, which is what makes them chase rather than turn as one
 *  rigid wheel. */
const CARPET_STEPS = [0.5, 0.85, 0.35, 0.7, 0.95, 0.45, 0.75] as const;

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
  // HEADSHOT: four tick pairs closing on one point above him, a step a frame.
  // Everything narrowing to a point is the shot itself.
  headshot: {
    fps: 4,
    draw: (g, f) => {
      const [hx, hy] = step(HEADSHOT_STEPS, f);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const c = CX + sx * hx, r = HEADSHOT_ROW + sy * hy;
          // One pair: an arm each way, both pointing back at the point.
          blk(g, c, r, ARCHER);
          blk(g, c - sx, r, ARCHER);
          blk(g, c, r - sy, ARCHER);
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
      for (let a = 0; a < TAU; a += 0.13) atRing(g, CX, FLOOR, 8, 2.5, a, 1, 1, ARCHER_RING);
      for (let k = 0; k < 4; k++) {
        // Each shaft on its own stagger, so they arrive as rain rather than as
        // one volley dropping in step.
        const fall = (f + step(RAIN_STAGGER, k)) % AURA_FRAMES;
        vbar(g, step(RAIN_COLS, k), 3 + fall * 4, 3, ARCHER);
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
        const inward = (f + k) % AURA_FRAMES;
        const rx = step(VORTEX_STEPS, inward);
        // The one that has arrived flashes, and is a beat bigger for it: it is
        // the only frame in the cycle where the ability has done its thing.
        const here = inward === AURA_FRAMES - 1;
        atRing(g, CX, FLOOR, rx, rx * 0.34, k * (TAU / 8),
          2, here ? 2 : 1, here ? WHITE : WIZARD);
      }
    },
  },

  // THE BEAM: ONE lance leaving him, swept through four stepped angles. VORTEX
  // pulls inward and this cuts outward, which is the difference worth drawing
  // -- in his violet either way, because the colour is the hero.
  theBeam: {
    fps: 4,
    draw: (g, f) => {
      const a = step(BEAM_ANGLES, f);
      // A sheath either side of the core, laid across the lance rather than
      // along it: a bright line with nothing darker beside it reads as thin.
      const flat = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
      for (const side of [-2, -1, 1, 2]) {
        ray(g, CX + (flat ? 0 : side), 12 + (flat ? side : 0), a, 3, 11, 1, WIZARD);
      }
      ray(g, CX, 12, a, 3, 11, 1, WHITE);
    },
  },

  // EARTHSHATTER: cracks on the FLOOR, widening a step per frame. The only
  // aura on the ground, because his is the only ultimate that comes out of it.
  earthshatter: {
    fps: 4,
    draw: (g, f) => {
      // Four cracks on the diagonals and one running forward, from three
      // cells out. Neither figure is arbitrary and both were arrived at by
      // looking: a ground plane this squashed puts every shallow ray in the
      // same two rows, so rays near the horizontal merge into a slab and a
      // slab under his boots reads as a puddle rather than as a floor coming
      // apart. Diagonals separate, and an empty middle is what makes the rest
      // read as radiating from under him.
      for (const [a, from, span] of QUAKE_CRACKS)
        ray(g, CX, FLOOR, a, from, from + span + f, 0.42, QUAKE);
    },
  },

  // THE LEAP: chevrons rising OFF him, four steps upward. EARTHSHATTER opens
  // the ground and this leaves it, so the shapes carry the read and the colour
  // does too -- his own blue, because the orange belongs to the floor.
  theLeap: {
    fps: 4,
    draw: (g, f) => {
      for (const rung of [0, 2]) {
        const [row, half] = step(LEAP_STEPS, (f + rung) % AURA_FRAMES);
        for (const colour of [LEAP_SHADOW, LEAP]) {
          const drop = colour === LEAP_SHADOW ? 1 : 0;
          for (let i = 0; i <= half; i++) {
            const r = row + Math.floor(i * 0.7) + drop;
            blk(g, CX - i, r, colour);
            blk(g, CX + i, r, colour);
          }
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
      // places rather than as running opposite ways round a coil.
      atRing(g, CX, RING_ROW, RING_RX, RING_RY, TAU / 8 + f * (TAU / 4), 4, 2, RANGER);
      atRing(g, CX, RING_ROW, 5.5, 2, TAU * 3 / 8 - f * (TAU / 4), 4, 2, RANGER);
    },
  },

  // FULL AUTO: a fast stutter of short ticks behind him, at the cadence he is
  // about to fire. Much faster than the other nine, which is the half of this
  // ability a player has to feel before he presses anything.
  fullAuto: {
    fps: 16,
    draw: (g, f) => {
      bar(g, 0, 13, 8, RANGER_TRAIL);
      for (let c = 0; c < 8; c++) {
        if ((c + f) % 3 !== 0) continue;
        vbar(g, c, 11, 2, RANGER);
      }
    },
  },

  // CARPET BOMB: seven sparks chasing round a ring on their own offsets. The
  // thing that is ready is a line of lit charges, and a fuse is the one image
  // in his kit that means 'about to'.
  carpetBomb: {
    fps: 4,
    draw: (g, f) => {
      for (const [k, own] of CARPET_STEPS.entries()) {
        const a = k * (TAU / 7) + f * own;
        const lit = (k + f) % 3 === 0;
        atRing(g, CX, FLOOR, 8.5, 3.2, a, 2, 2, lit ? SAPPER_FLARE : SAPPER);
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
      // under it. Six links of one lap is a cord, where three was a dotted
      // line and seven would close the ring and stop being a lap at all.
      for (let i = 5; i >= 0; i--) {
        // Two cells wide throughout. Links a cell apiece collapse into each
        // other where the ellipse is steepest, so a cord drawn that way is a
        // cord at the sides and a smudge at the top.
        atRing(g, CX, RING_ROW, RING_RX, RING_RY, head - i * 0.42,
          2, i > 1 ? 1 : 2,
          i === 0 ? SAPPER_FLARE : i === 1 ? SAPPER : SAPPER_TAIL);
      }
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
