/**
 * The blast a bomb leaves: a pixel-art fireball, pre-rendered once per size.
 *
 * What was there before was `burst()` — a scatter of sparks flying out of the
 * detonation point. Sparks are what a blast *throws*; they are not the blast.
 * A player who has just spent his last charge sees the same puff whether he
 * caught four skeletons or nothing, and the sapper's shift-detonated combo,
 * which reaches a third further, looks exactly like a normal bomb with a few
 * more sparks in it. The reach is the whole reward, so the reach has to be the
 * thing on screen.
 *
 * So this paints the *body* of the blast — white core, expanding shell, hard
 * rim, smoke that outlives both — and leaves the sparks to `burst()`, which
 * already does them well. Two painters, one event, neither redoing the other.
 *
 * ## Why it is baked
 *
 * The obvious way to draw a fireball is `createRadialGradient` per blast per
 * frame. That allocates a gradient object and re-rasterises a smooth ramp every
 * frame, for something the sapper can put four of on screen inside half a
 * second — and it draws a *glow*, which is the one thing an explosion in this
 * game must not look like. Every other sprite here is hard-edged, so a soft
 * ball of light reads as a lens flare sitting on top of the art rather than as
 * an event happening inside it.
 *
 * Both problems have the same answer, and the codebase already had it:
 * `stamps.get(key, w, h, painter)` returns a cached canvas *without calling the
 * painter* on a hit (see `docs/design-patterns.md`). The blast is cut into
 * {@link FRAMES} still frames, painted once per size bucket, and every frame of
 * every live blast after that is one `drawImage`. Nothing in the paint path
 * allocates: no gradient, no array, no object, and — because the stamps are
 * memoised into a fixed-length slot table below — not even the key string.
 *
 * The bucketing is the other half of that. Keyed on the raw radius, a float
 * that arrives from a config multiply, every blast would miss the cache, paint
 * a fresh canvas and keep it forever: a leak wearing a cache's clothes. The
 * ladder is three sizes; the blit scales the chosen one to the real radius, so
 * the size on screen is exact while the number of canvases is fixed.
 */

import { stamps, type StampPainter } from './stamps';

/**
 * How long one blast is on screen, in seconds.
 *
 * The caller owns the timer; this is the number it divides by, kept here so the
 * frame table and the clock driving it cannot disagree. Half a second is about
 * as long as a blast can hold still before it stops reading as an impact and
 * starts reading as a fire — the lingering smoke on the field is `burst()`'s
 * slow grey particles, which outlast this and are meant to.
 */
export const BLAST_SECS = 0.5;

/** Everything the blast needs. Nothing about who threw it or what it hit. */
export interface BlastPose {
  /** World position of the detonation. */
  readonly x: number;
  readonly y: number;
  /**
   * The blast's real damage radius in world px — not an art size.
   *
   * The fire's edge is painted *at* this radius, so the picture and the hitbox
   * are the same circle: the sapper's combo at 1.33x is visibly a third wider
   * because it genuinely is. Only smoke drifts past it.
   */
  readonly radius: number;
  /** 0..1 through the blast's visible life. Outside that range paints nothing. */
  readonly age: number;
  /** Water answers a bomb with a plume, not a fireball. */
  readonly onWater: boolean;
}

/**
 * How many still frames the life is cut into.
 *
 * Eight is the sprite-sheet count for a blast: enough that the core collapsing
 * and the shell expanding are separate events, few enough that every rung and
 * both kinds together — 48 canvases, the most this file can ever hold — come to
 * 0.97 Mpx, about 3.7 MB. At {@link BLAST_SECS} each frame holds for not quite
 * four game frames, which is the stepped read pixel art wants anyway: a smoothly
 * interpolated fireball looks like a video playing on a sprite.
 */
const FRAMES = 8;

/**
 * World pixels per stamp pixel.
 *
 * The art is authored at half the world's resolution and blitted back up with
 * smoothing off, so a blast is built out of hard 2x2 blocks. One-to-one would
 * be finer than the heroes' own pixels once scaled and would read as a smooth
 * vector ring; four-to-one loses the shell's banding entirely.
 */
const CHUNK = 2;

/**
 * How far past the damage radius the stamp box reaches, as a multiple of it.
 *
 * The cloud drifts a quarter past the fire as it dies and its outline wanders
 * another fifth on top of that, so the box has to hold about half as much again
 * as the circle the damage uses. Any less and the smoke is guillotined into a
 * square — and the clipping shows on the four edge midpoints first, which is
 * exactly where nobody looks for it.
 */
const REACH = 1.55;

/**
 * The size ladder, in world px, covering every blast the game emits: the dark
 * archer's bomb at 55, a dynamite at 90, the sapper's combo at ~120.
 *
 * Three rungs, and the blit covers the gaps. A radius between rungs takes the
 * nearest by ratio and is scaled to fit, so a blast landing halfway up the
 * widest gap draws blocks a quarter off square — invisible in a 500ms event,
 * and the alternative is a canvas per distinct float.
 */
const LADDER = [56, 88, 120] as const;

/** Fire and water, the two kinds of blast, as slot-table strides. */
const KINDS = 2;

/**
 * Stamps by (kind, bucket, frame), memoised as references.
 *
 * `stamps` is still the owner — this is not a second cache, it is the lookup
 * into it. Going through `stamps.get` every frame would mean building its key
 * string every frame, which is an allocation in the one path that promised not
 * to have any. The table is fixed-length and never evicted, exactly like the
 * cache behind it.
 */
const stampSlots: (HTMLCanvasElement | undefined)[] = new Array<undefined>(
  KINDS * LADDER.length * FRAMES,
);

// ── The fireball ──────────────────────────────────────────────────────────────

/** White-hot centre, then the sapper's own fire palette cooling outward. */
const CORE = '#FFFFFF';
const YELLOW = '#FFB400';
const ORANGE = '#FF7A1A';
const EMBER = '#C6501B';

/**
 * The rim: a dark red hard edge, one step darker than anything else in the
 * shell.
 *
 * It is what makes the fireball an object rather than a light. A shell that
 * fades out at its edge is a glow however hard the bands inside it are, and the
 * eye reads the outermost *opaque* ring as the size of the thing — so the rim
 * is also what makes 90px and 120px tell apart at a glance.
 */
const RIM = '#8A1010';

/**
 * Inner to outer, hottest first. The shell walks this ramp and so does time.
 *
 * {@link RIM} is deliberately not on it. It was, and the shell cooled onto it
 * from both directions at once — by mid-life two thirds of the fireball was the
 * rim colour and the blast read as a dark red doughnut with a hot centre rather
 * than as fire. The rim is an edge, one hard step wide, and nothing else.
 */
const HEAT: readonly string[] = [CORE, YELLOW, ORANGE, EMBER];

/** One band of the ramp, clamped at both ends rather than falling off it. */
function heat(i: number): string {
  return HEAT[Math.min(HEAT.length - 1, Math.max(0, i))] ?? EMBER;
}

/**
 * Smoke, and deliberately pale.
 *
 * Grass in this game is `#1a2a1a` and stone is barely lighter, so the soot
 * greys a smoke ring wants would land as a hole in the ground. Smoke reads by
 * being *lighter* than the field it hangs over; the dark tone is spent only on
 * the shaded inside of a puff, where it is next to the pale one and reads as
 * depth instead of as a gap.
 */
const SMOKE_LIGHT = '#6E6E6E';
const SMOKE_MID = '#4A4A4A';
const SMOKE_DARK = '#2C2C2C';

/** Where the shell starts, and how far it grows, in damage radii. */
const FIRE_MIN = 0.34;
const FIRE_GROW = 0.7;

/**
 * How sharply the shell decelerates.
 *
 * A blast front is fastest in its first instants and has almost stopped by the
 * end. Linear growth is a circle being inflated; this is one being released.
 */
const EASE_POWER = 2.4;

/**
 * The white core's radius, and the fraction of the life it survives.
 *
 * Kept well inside the shell even on the first frame. At 0.4 the opening frame
 * came out as a white disc with a red edge — a ball, not a detonation — because
 * the core left the bands no room to be seen at the one moment they are
 * brightest.
 */
const CORE_R = 0.3;
const CORE_LIFE = 0.4;

/**
 * When the shell starts to hollow out, and over how much of the life.
 *
 * Fire is a surface, not a filled disc: the burning front runs outward and
 * leaves nothing behind it. Keeping the middle filled the whole way is what
 * makes a fireball look like a balloon.
 */
const HOLLOW_AT = 0.28;
const HOLLOW_SPAN = 0.85;

/**
 * How thick the dark rim is, in stamp pixels — a hard edge, not a fraction.
 *
 * Fixed in pixels so a small blast gets the same *edge* as a big one rather
 * than a proportionally thinner one; at two it disappeared next to the ember
 * band it is supposed to be a step down from.
 */
const RIM_PX = 3;

/** When the ring starts breaking into embers rather than fading as a ring. */
const FIRE_BREAK = 0.8;

/**
 * Facets around the fire's edge, and how far each one is pushed in or out.
 *
 * Two counts, and 24 is not a multiple of 7, so the fine facets ride on a
 * coarse swell that never lines up with them twice. One layer of equal wedges
 * on its own came out as gear teeth — regular enough that the eye reads a
 * machined edge rather than a torn one.
 */
const FIRE_SECTORS = 24;
const FIRE_COARSE = 7;
const FIRE_RAGGED = 0.15;

/**
 * How far the smoke bulges in and out of round.
 *
 * Smoke does not facet. The fire's stepped sectors are right for a shell
 * tearing itself apart and wrong for a cloud: a ring of equal wedges reads as a
 * cog, which is what the first render of this came out as. {@link bulge} rolls
 * a few sines together instead, so the outline wanders.
 */
const SMOKE_RAGGED = 0.2;

/**
 * How far inside the shell's hollow the smoke reaches, as a fraction of it.
 *
 * Under one, always, so the smoke has already covered the hole before the fire
 * opens it. Anchored to the hollow rather than to a fixed radius because a
 * fixed one left a ring of bare ground between the two for the frames where
 * they crossed — a black dot punched in the middle of the blast.
 */
const SMOKE_UNDER = 0.5;

/** How far past the fire's edge the cloud drifts as it dies. */
const SMOKE_DRIFT = 0.24;

/** When smoke appears, how fast it thickens, and when it starts clearing. */
const SMOKE_IN = 0.1;
const SMOKE_RAMP = 0.22;

/**
 * When the cloud starts clearing.
 *
 * Late, and later than the fire's own break-up: the whole point of the smoke is
 * that it is the last thing standing. Clearing it at the same time as the fire
 * makes the blast evaporate rather than burn out.
 */
const SMOKE_OUT = 0.8;

/** How solid smoke ever gets. Opaque smoke is a wall; this hangs. */
const SMOKE_ALPHA = 0.82;

/** How much of the smoke cloud is filled, the rest punched out as gaps. */
const SMOKE_FILL = 0.86;

/**
 * The grain both the gaps and the shading are cut on, in damage radii.
 *
 * A square lattice, not a polar one. Cut on sectors and rings, a hole near the
 * centre is a speck and one at the rim is a long tab, and the whole cloud lines
 * up into spokes; on a lattice every puff is the same size wherever it lands.
 * Coarse enough to clump — per-pixel noise at this size is television static.
 */
const PUFF_CELL = 0.1;

// ── The plume ─────────────────────────────────────────────────────────────────

/** Water, from the burst the EXPLOSION handler already used on wet tiles. */
const DEEP = '#2A66B0';
const WATER_MID = '#5A92D8';
const CREST = '#A0C8F0';
const FOAM = '#FFFFFF';

/** The spreading ring: where it starts, how far it runs, how thick it is. */
const RING_MIN = 0.2;
const RING_GROW = 0.8;
const RING_THICK = 0.22;

/**
 * How flat the ring is.
 *
 * The world is drawn from above but everything in it is drawn from the side, so
 * a splash ring painted as a true circle reads as a target decal on the floor.
 * Squashing it is what puts the water back in the same imaginary camera as the
 * heroes standing next to it.
 */
const RING_SQUASH = 0.42;

/** How high the column throws, how wide it is at the waterline, and how long it is up. */
const COLUMN_H = 1.3;
const COLUMN_W = 0.2;
const COLUMN_LIFE = 0.74;

/**
 * The column's profile: how much wider than {@link COLUMN_W} it is at the
 * waterline, how much it narrows going up, and how far the crown flares back
 * out at the top.
 *
 * Without the flare and the taper it is a rectangle with a white cap — a
 * chimney. What makes a column of water a column of water is that it is thrown
 * from a wide base, thins as it slows, and opens out again where it comes apart.
 */
const COLUMN_FOOT = 1.55;
const COLUMN_TAPER = 1;
const COLUMN_CROWN = 0.55;

/** Droplets thrown off the crown, and how big each block is in damage radii. */
const DROPS = 16;
const DROP_R = 0.045;

/** Gravity on those droplets, in damage radii per unit life squared. */
const DROP_FALL = 3.4;

/** When the plume starts fading out. Water settles; it does not burn away. */
const WATER_OUT = 0.66;

// ── Painting ──────────────────────────────────────────────────────────────────

/**
 * Paints one frame of a blast, centred on `p.x`/`p.y`.
 *
 * Takes the caller's transform as it finds it — world space, unrotated — and
 * leaves it as it found it. Costs one `drawImage` and nothing else on the heap;
 * the first blast of a given size pays for its eight frames once.
 */
export function paintExplosion(ctx: CanvasRenderingContext2D, p: BlastPose): void {
  // Both bounds are guards, not clamps. A blast past its life is over, and
  // stretching its last frame across an overrun would hide the caller's bug by
  // parking a dead fireball on the field.
  if (!(p.radius > 0) || !(p.age >= 0) || p.age >= 1) return;

  const frame = Math.min(FRAMES - 1, Math.floor(p.age * FRAMES));
  const stamp = blastStamp(p.onWater, bucketOf(p.radius), frame);
  const size = p.radius * REACH * 2;

  // One stamp per size means two bombs going off side by side are the same
  // picture twice, which the eye catches immediately. Mirroring is free and,
  // unlike a rotation, exact on a pixel grid: four orientations from one canvas.
  // Derived from the position rather than passed in, so it is stable for the
  // blast's whole life without the caller having to carry a seed. A plume only
  // mirrors across, because a plume that fell upward would be a new bug.
  const flip = (Math.round(p.x) ^ Math.round(p.y)) & (p.onWater ? 1 : 3);

  ctx.save();
  // The stamp is half the world's resolution, so smoothing here would blur
  // every hard edge the art is made of back into the glow it exists to avoid.
  // Restored by the `restore` below along with the transform.
  ctx.imageSmoothingEnabled = false;
  ctx.translate(p.x, p.y);
  ctx.scale((flip & 1) === 0 ? 1 : -1, (flip & 2) === 0 ? 1 : -1);
  ctx.drawImage(stamp, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** The ladder rung nearest a radius by ratio, so error is even either way. */
function bucketOf(radius: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < LADDER.length; i++) {
    const rung = LADDER[i] ?? LADDER[0];
    const err = radius > rung ? radius / rung : rung / radius;
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

/** The cached canvas for one kind, rung and frame, painting it on first ask. */
function blastStamp(water: boolean, bucket: number, frame: number): HTMLCanvasElement {
  const slot = ((water ? 1 : 0) * LADDER.length + bucket) * FRAMES + frame;
  const hit = stampSlots[slot];
  if (hit) return hit;

  const worldR = LADDER[bucket] ?? LADDER[0];
  const half = Math.round((worldR * REACH) / CHUNK);
  // The frame's time is sampled at the middle of the slice it stands for, not
  // its start: sampling at the start means frame 0 is the instant before
  // anything has happened, and the blast opens on an empty canvas.
  const t = (frame + 0.5) / FRAMES;
  const made = stamps.get(
    `blast|${water ? 'water' : 'fire'}|${worldR}|${frame}`,
    half * 2,
    half * 2,
    framePainter(water, t, half / REACH),
  );
  stampSlots[slot] = made;
  return made;
}

/**
 * A frame's colour at one point, in damage radii from the centre.
 *
 * The whole frame is described as a function of position rather than drawn as
 * shapes because every edge in it is meant to be ragged. Ragged shapes are a
 * path with sixty points; a ragged *field* is one comparison per pixel, decided
 * once at bake time and never again.
 */
type CellColour = (u: number, v: number) => string | null;

/** Rasterises a cell function into a stamp, one fill per run of equal colour. */
function framePainter(water: boolean, t: number, unit: number): StampPainter {
  const cell = water ? plumeCell(t) : fireCell(t, unit);
  return (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 0; y < h; y++) {
      let colour: string | null = null;
      let start = 0;
      // One past the row deliberately: the sentinel closes the last run without
      // repeating the fill after the loop.
      for (let x = 0; x <= w; x++) {
        const here = x === w ? null : cell((x + 0.5 - cx) / unit, (y + 0.5 - cy) / unit);
        if (here === colour) continue;
        if (colour !== null) {
          g.fillStyle = colour;
          g.fillRect(start, y, x - start, 1);
        }
        colour = here;
        start = x;
      }
    }
  };
}

/**
 * The fireball at one instant: core, shell, rim, smoke, in that order outward.
 *
 * Everything that depends only on time is computed here, once per baked frame,
 * so the per-pixel function below is arithmetic and two hashes.
 */
function fireCell(t: number, unit: number): CellColour {
  const fire = FIRE_MIN + FIRE_GROW * (1 - Math.pow(1 - t, EASE_POWER));
  const hollow = fire * clamp01((t - HOLLOW_AT) / HOLLOW_SPAN);
  const core = CORE_R * clamp01(1 - t / CORE_LIFE);
  const rim = RIM_PX / unit;
  const smoke = fire * (1 + SMOKE_DRIFT * t);
  const behind = smokeLayer(t, hollow, smoke);
  // A young fireball is nearly round — it has not had time to be anything else
  // — and tears itself apart as it slows. So the raggedness rides the age.
  const ragged = FIRE_RAGGED * (0.35 + 0.65 * t);
  // How far the whole shell has walked down the ramp. Time cools it from the
  // inside as well as the outside, so the yellow runs out before the fire does
  // and the last of it is embers.
  const cooled = Math.floor(t * 2);
  const broken = clamp01((t - FIRE_BREAK) / (1 - FIRE_BREAK));
  const reach = smoke * (1 + SMOKE_RAGGED);

  return (u, v) => {
    const d = Math.hypot(u, v);
    if (d > reach) return null; // Rejects most of the box before any hashing.

    const a = Math.atan2(v, u);
    // The core is faceted like everything else. A perfectly round white disc is
    // the one shape in here the eye reads as a light bulb.
    if (d <= core * facets(a, 13, ragged * 0.7)) return CORE;

    const edge = fire * facets(a, 0, ragged);
    // Past FIRE_BREAK the ring stops being a ring: the same grain that cuts
    // holes in the smoke eats it into separate embers, so the fire dies by
    // coming apart rather than by dimming. Anything it eats falls through to
    // the smoke behind it, which is what is actually there.
    const alight = !(broken > 0 && grain(u, v, 3.7) < broken);
    if (alight && d < edge && d >= hollow * facets(a, 21, ragged * 0.5)) {
      if (d > edge - rim) return RIM;
      const across = edge > hollow ? (d - hollow) / (edge - hollow) : 0;
      // From yellow, never from white: the shell starts one step down the ramp
      // because white is the core's, and the core is a separate thing that dies
      // on its own clock. Letting the shell reach white too gave the blast a
      // growing white centre for as long as the ramp allowed — the exact
      // opposite of a core that collapses.
      return heat(1 + Math.floor(across * 3) + cooled);
    }
    return behind(u, v, d, a);
  };
}

/** The three greys of smoke at one instant. */
interface SmokeTones {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

/**
 * The cloud, which is behind the fire and outlives it.
 *
 * Its own layer rather than a tail on {@link fireCell} because it answers to
 * different clocks: it appears after the fire, thickens while the fire is
 * brightest, and is still there once there is nothing left to burn.
 */
function smokeLayer(
  t: number, hollow: number, outer: number,
): (u: number, v: number, d: number, a: number) => string | null {
  const tone = smokeTones(t);
  if (tone === null) return () => null;
  const inner = hollow * SMOKE_UNDER;
  return (u, v, d, a) => {
    if (d < inner || d > outer * bulge(a, SMOKE_RAGGED)) return null;
    // Thinner inside the shell's hollow than outside it. Filled at the same
    // rate, the middle came out as a solid grey disc inside a ring of fire — an
    // eye, not a blast. What is in there is the far wall of the cloud seen
    // through the near one, and that is mostly gaps.
    const g = grain(u, v, 5.9);
    if (g > (d < hollow ? SMOKE_FILL * 0.66 : SMOKE_FILL)) return null;
    // Tone off the same hash as the holes, so the pale tone clusters at the
    // edges of a puff and the dark one sits in its middle. Two independent
    // hashes give evenly speckled grey, which is noise rather than volume.
    return g < 0.1 ? tone.dark : g < 0.35 ? tone.mid : tone.light;
  };
}

/** The three tones at one instant, or null while there is no smoke. */
function smokeTones(t: number): SmokeTones | null {
  const rise = clamp01((t - SMOKE_IN) / SMOKE_RAMP);
  const clearing = 1 - clamp01((t - SMOKE_OUT) / (1 - SMOKE_OUT));
  const a = SMOKE_ALPHA * rise * clearing;
  if (a < 0.06) return null;
  return { dark: rgba(SMOKE_DARK, a), mid: rgba(SMOKE_MID, a), light: rgba(SMOKE_LIGHT, a) };
}

/**
 * The plume at one instant: a spreading ring, a column thrown up out of it, and
 * the droplets the column sheds off its crown.
 *
 * Water gets a different shape rather than a blue fireball because it is a
 * different event — nothing burns, something is displaced and falls back — and
 * because the tell matters: a bomb that lands in the river did not hit anyone.
 */
function plumeCell(t: number): CellColour {
  const tone = waterTones(1 - clamp01((t - WATER_OUT) / (1 - WATER_OUT)));
  if (tone === null) return () => null;
  // Up and back down within COLUMN_LIFE, so the last quarter of the life is the
  // ring spreading alone — water settling after the column has fallen back in.
  const rise = Math.sin(Math.PI * clamp01(t / COLUMN_LIFE));
  const high = COLUMN_H * rise;
  const column = columnLayer(high, COLUMN_W * (0.55 + 0.45 * rise), tone);
  const ring = ringLayer(t, tone);
  const drops = dropletLayer(t, high, tone);
  // Column first: it is nearest the camera, standing in front of its own ring.
  // Droplets last: they are thrown clear of both and only show where neither is.
  return (u, v) => column(u, v) ?? ring(u, v) ?? drops(u, v);
}

/** The column of water thrown up out of the impact, crown and all. */
function columnLayer(high: number, wide: number, tone: WaterTones): CellColour {
  if (high <= 0.05) return () => null;
  return (u, v) => {
    if (v > 0.08 || v <= -high) return null;
    const up = -v / high;
    const crown = up < 0.66 ? 0 : (up - 0.66) / 0.34;
    // Jitter keyed on the height rather than an angle: the column's edge is
    // ragged up its length, not around a centre. Mapped onto a full turn so it
    // reads as the same stepped facets `lump` cuts everywhere else.
    const w = wide * (COLUMN_FOOT - COLUMN_TAPER * up + COLUMN_CROWN * crown * crown)
      * lump(Math.PI * (2 * up - 1), 9, 11, 0.26);
    if (Math.abs(u) >= w) return null;
    // The crown comes apart as it rises. Left solid it was a white slab sitting
    // across the top of the column — a nail head, not water letting go of
    // itself — so the same grain that breaks the fire's ring eats it.
    if (crown > 0 && grain(u, v, 8.3) < crown * 0.8) return null;
    if (up > 0.76) return tone.foam;
    return u < -w * 0.25 ? tone.crest : u > w * 0.45 ? tone.deep : tone.mid;
  };
}

/** The wave spreading out from the impact, flattened into the world's camera. */
function ringLayer(t: number, tone: WaterTones): CellColour {
  const ring = RING_MIN + RING_GROW * (1 - Math.pow(1 - t, 2));
  const thick = RING_THICK * (1 - 0.45 * t);
  return (u, v) => {
    const e = Math.hypot(u, v / RING_SQUASH);
    const outer = ring * lump(Math.atan2(v, u), 13, 5, 0.18);
    if (e >= outer || e <= outer - thick) return null;
    const across = (outer - e) / thick;
    // Lit from above: the far lip of the ring catches the light, the near one is
    // the shaded inside of a wall of water. One step up the same ramp, so the
    // two halves are the same water and not two colours of it.
    const lit = v < 0;
    if (across < 0.3) return lit ? tone.mid : tone.deep;
    if (across < 0.7) return lit ? tone.crest : tone.mid;
    return tone.crest;
  };
}

/**
 * The droplets the crown sheds, on ballistic arcs from wherever the crown is.
 *
 * Their positions are recomputed per pixel rather than laid out once into an
 * array, because this runs at bake time only and an allocation-free inner loop
 * is worth more here than the handful of multiplies it costs.
 */
function dropletLayer(t: number, high: number, tone: WaterTones): CellColour {
  return (u, v) => {
    for (let i = 0; i < DROPS; i++) {
      const ang = Math.PI * (0.15 + 0.7 * hash01(i * 3.1));
      const flight = t * (0.9 + 1.5 * hash01(i * 7.7 + 2));
      const dx = Math.cos(ang) * flight * (i % 2 === 0 ? 1 : -1);
      // Launched from the crown as it stands *this* frame, not from a fixed
      // height. Fixed, the first frames threw droplets out of thin air well
      // above a column that had not risen yet.
      const dy = -high * 0.85 - Math.sin(ang) * flight + DROP_FALL * flight * flight * 0.5;
      if (dy > 0.1) continue; // Landed, and a landed droplet is the ring's job.
      if (Math.abs(u - dx) < DROP_R && Math.abs(v - dy) < DROP_R) {
        return i % 3 === 0 ? tone.foam : tone.crest;
      }
    }
    return null;
  };
}

/** Deep water, the body of a wave, its lit crest, and the foam off the top. */
interface WaterTones {
  readonly deep: string;
  readonly mid: string;
  readonly crest: string;
  readonly foam: string;
}

/** The four tones at one instant, or null once the plume has settled. */
function waterTones(fade: number): WaterTones | null {
  if (fade < 0.06) return null;
  return {
    deep: rgba(DEEP, fade),
    mid: rgba(WATER_MID, fade),
    crest: rgba(CREST, fade),
    foam: rgba(FOAM, fade),
  };
}

// ── Shared arithmetic ─────────────────────────────────────────────────────────

/**
 * How far one facet is pushed in or out, as a multiplier on a radius.
 *
 * Stepped per sector, not smoothed between them: the step *is* the art. A
 * smooth wobble gives a soft amoeba, and a blast edge that curves gently is a
 * balloon. The hash is keyed on the sector alone, so a facet keeps its identity
 * across all eight frames — the same lump grows outward rather than the whole
 * edge reshuffling every frame, which is boiling, not expanding.
 */
function lump(a: number, sectors: number, salt: number, amp: number): number {
  const i = Math.floor(((a + Math.PI) / (Math.PI * 2)) * sectors);
  return 1 + amp * (hash01(i + salt * 0.618) - 0.5) * 2;
}

/** The fire's edge: fine facets riding a coarse swell. See {@link FIRE_SECTORS}. */
function facets(a: number, salt: number, amp: number): number {
  return lump(a, FIRE_SECTORS, salt, amp) * lump(a, FIRE_COARSE, salt + 5, amp * 0.7);
}

/**
 * A wandering multiplier on a radius: the smooth answer to {@link lump}.
 *
 * Three sines whose periods do not divide each other, so the outline never
 * repeats around the turn. Fixed phases rather than a hash, because a cloud
 * wants a shape, not a scatter — and because the same three lobes on every
 * blast is invisible once the stamp is mirrored four ways.
 */
function bulge(a: number, amp: number): number {
  return 1 + amp * (0.55 * Math.sin(3 * a + 1.7) + 0.3 * Math.sin(5 * a + 4.2)
    + 0.2 * Math.sin(8 * a + 0.9));
}

/** The coarse square grain that punches holes in smoke and breaks the ring. */
function grain(u: number, v: number, salt: number): number {
  const x = Math.floor(u / PUFF_CELL);
  const y = Math.floor(v / PUFF_CELL);
  return hash01(x * 37.1 + y * 91.7 + salt * 13.3);
}

/** Deterministic 0..1 from one number. Bake-time only; nothing depends on its quality. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** `#RRGGBB` plus an alpha, as the `rgba()` string a fill wants. */
function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}
