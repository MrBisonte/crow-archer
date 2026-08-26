/**
 * The wizard's two area effects: Lightning Storm, and the arrival end of Blink.
 *
 * Both shipped with the same fault, twice over: the ability happened, and the
 * screen reported it with a single primitive. The storm — a 450 px cast, near
 * half the arena wide — was a blue rectangle over the whole viewport, which
 * says "something occurred" and nothing about what, where, or how far. Blink
 * was one expanding ring at the destination, which reads as a spawn: nothing
 * on screen connected it to the place he left.
 *
 * So each effect is several elements, and every element carries exactly one
 * fact the player needs:
 *
 * | Fact | Storm | Blink |
 * |---|---|---|
 * | *what happened* | forked channels striking down | a body-shaped after-image |
 * | *where it hit* | a ground flash under each strike | the streak between the two points |
 * | *how far it reached* | a rim drawn at `radius` | a rim drawn at `radius` |
 * | *that it is over* | the afterglow draining | the flash decaying |
 *
 * The rims are the load-bearing ones and they are drawn at exactly the figure
 * the damage used, never at a flattering one. `spawnShockRing` in `game.js`
 * already carries that rule in its own comment; both painters here keep it.
 *
 * ## Cost
 *
 * Nothing here allocates once a cast is under way. Two glow stamps are painted
 * once for the life of the process and then scaled by `drawImage`; the bolts
 * are generated once per cast into buffers that were allocated when this module
 * loaded. A paint call reads those buffers and issues stroke and blit calls,
 * and does not build a gradient, an array, or a closure. See
 * {@link stormGeometry} for how "once per cast" is detected.
 *
 * Bolts are generated once per cast for a second reason, ahead of the first:
 * geometry re-rolled every frame is not lightning, it is television static.
 * A struck channel has to hold still for the frames it is alive.
 */

import { mulberry32 } from '../sim/rng';
import { stamps, type StampPainter } from './stamps';

const TAU = Math.PI * 2;

/**
 * How long a storm's visuals run, in seconds, and the window `age` spans.
 *
 * Longer than `CONFIG.stormFlashDuration` (0.35 s) on purpose: that number is
 * the screen flash and the boss's hit flash, and nine strikes cannot land in a
 * third of a second without arriving as one white frame. The caller wants
 * its own countdown for this — see the note on {@link StormPose.age}.
 */
export const STORM_FX_SECS = 0.75;

/**
 * How long the blink's visuals run, in seconds.
 *
 * Deliberately shorter than the wizard's 0.3 s of i-frames is long: the effect
 * should be gone by the time he is vulnerable again, so what is on screen is
 * never a promise of protection he no longer has.
 */
export const BLINK_FX_SECS = 0.28;

// ── Palette ───────────────────────────────────────────────────────────────────

/**
 * Lightning is a near-white channel inside a blue-violet bloom, and that is the
 * whole colour story: the core is barely tinted, everything around it carries
 * the hue. Two colours doing one job each.
 *
 * The wizard's gold (`#FFB400`) is absent by choice. `STORM_CAST` already
 * throws gold sparks through the same frames, and a gold *shape* next to those
 * sparks competes with the rim for the eye at the exact moment the rim is the
 * thing worth reading.
 */
const CORE = '#F6F4FF';
const EDGE = '#8888FF';
const HALO = '#6A5CFF';

/** The robe blue, for the after-image. It is him, so it is his colour. */
const ROBE = '#4A4AC8';

// ── Glow stamps ───────────────────────────────────────────────────────────────

/**
 * Side of the pre-rendered glow canvases.
 *
 * These are stretched by `drawImage` to as much as 900 px across, which is a
 * 7x magnification of a smooth radial falloff — and a smooth falloff is what
 * survives magnification best. Rendering them at the size they are used would
 * cost 810 000 px of cache each for a picture no player can tell apart.
 */
const GLOW_PX = 128;

/**
 * Both painters are module constants rather than arrow functions written at the
 * `stamps.get` call.
 *
 * `stamps.get` takes the painter whether or not the key hits, so an inline
 * arrow is a function object built on every frame of every cast to be handed
 * to a cache that will not call it. These capture nothing and are built once.
 */
const STRIKE_PAINTER: StampPainter = (g, w) => {
  const r = w / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(220,215,255,0.72)');
  grad.addColorStop(0.55, 'rgba(136,136,255,0.26)');
  grad.addColorStop(1, 'rgba(106,92,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
};

/**
 * The strike glow: white-hot at the middle, blue at the edge, gone at the rim.
 *
 * Used for the ground flash under every bolt and for the blink's arrival, at
 * different sizes and alphas. One shape serves both because both are the same
 * event — light arriving somewhere all at once.
 */
function strikeGlow(): HTMLCanvasElement {
  return stamps.get('wizfx|strike', GLOW_PX, GLOW_PX, STRIKE_PAINTER);
}

/**
 * The storm's afterglow, and the one stamp here that is *not* brightest at its
 * centre: it peaks at a bit over half the radius and fades toward both the
 * middle and the rim.
 *
 * The centre is where the wizard is standing. A disc-shaped bloom centred on
 * the caster washes out the one sprite the player is steering, for a third of
 * a second, immediately after he pressed a button — which is the worst possible
 * moment to lose him. Peaking off-centre fills the same area, states the same
 * "all of this was hit", and leaves him legible inside it.
 */
const AREA_PAINTER: StampPainter = (g, w) => {
  const r = w / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(96,86,220,0.16)');
  grad.addColorStop(0.45, 'rgba(118,104,255,0.28)');
  grad.addColorStop(0.75, 'rgba(136,136,255,0.30)');
  grad.addColorStop(1, 'rgba(106,92,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
};

function areaGlow(): HTMLCanvasElement {
  return stamps.get('wizfx|area', GLOW_PX, GLOW_PX, AREA_PAINTER);
}

/**
 * One glow, centred on `(x, y)` and `r` in radius. Skips the blit entirely once
 * the element has faded out, which is most of what keeps the tail of a cast
 * cheap: by the back half of a storm most of its bolts are contributing nothing
 * and are never drawn.
 */
function blitGlow(
  ctx: CanvasRenderingContext2D, stamp: HTMLCanvasElement,
  x: number, y: number, r: number, alpha: number,
): void {
  if (alpha <= 0.004) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(stamp, x - r, y - r, r * 2, r * 2);
}

// ── Storm geometry ────────────────────────────────────────────────────────────

/**
 * Bolts per cast.
 *
 * Seven was the first number tried and the picture said it was wrong: over a
 * 900 px disc it left one or two channels alive at the peak, which is a strike,
 * not a storm. Nine holds three at once through the middle of the cast without
 * the field turning into a wall of white.
 */
const BOLTS = 9;

/**
 * Steps taken around the circle between one bolt and the next.
 *
 * Coprime with {@link BOLTS}, so the sequence still visits every slice exactly
 * once — it just stops visiting them in order. Bolts fired in angular order
 * sweep round the disc like a radar hand, and a mechanism that regular reads as
 * a machine rather than as weather.
 */
const SLICE_STEP = 4;

/** Points down a trunk, counting both ends. Eight segments to zigzag through. */
const TRUNK_PTS = 9;

/** Branches per bolt, and the points in one — its root on the trunk, then two. */
const BRANCHES = 2;
const BRANCH_PTS = 3;

const FLOATS_PER_BOLT = TRUNK_PTS * 2 + BRANCHES * BRANCH_PTS * 2;
/** Offset of a bolt's branch block, in floats from the start of that bolt. */
const BRANCH_BASE = TRUNK_PTS * 2;

/** Per bolt: when it strikes, and how wide its ground flash is. */
const META_PER_BOLT = 2;

/**
 * The generated shape of one cast, and the cast it belongs to.
 *
 * `x`, `y` and `radius` are the identity: a paint call whose pose matches them
 * is the same cast still running and reuses the buffers untouched. They are
 * compared exactly, and exactly is right — these are the player's own float
 * coordinates at the instant he cast, so two casts sharing all three bits for
 * bit means he cast twice from a position he never left, which the 10 s
 * cooldown makes a curiosity rather than a case. The cost of being wrong is
 * two identical-looking storms.
 */
interface StormGeometry {
  x: number;
  y: number;
  radius: number;
  /** Trunk and branch points, as offsets from the storm's centre. */
  readonly pts: Float32Array;
  /** Strike time (in `age`) and ground-flash radius, per bolt. */
  readonly meta: Float32Array;
}

function emptyGeometry(): StormGeometry {
  return {
    // NaN never equals itself, so a fresh slot cannot match any pose.
    x: NaN, y: NaN, radius: NaN,
    pts: new Float32Array(BOLTS * FLOATS_PER_BOLT),
    meta: new Float32Array(BOLTS * META_PER_BOLT),
  };
}

/**
 * Two slots, allocated at module load and then written in place forever.
 *
 * Two, not one, and not a map. One storm is live at a time in a single-player
 * run — a 10 s cooldown against a 0.75 s effect — but a single slot turns any
 * overlap into a rebuild on *every* frame for *both* casts, which is the one
 * shape of this cache that performs worse than no cache at all. Two removes
 * that cliff. Three would only matter to a third simultaneous 450 px storm,
 * which nothing in the game can produce.
 */
const SLOTS: readonly [StormGeometry, StormGeometry] = [emptyGeometry(), emptyGeometry()];
let lastSlot = 0;

/**
 * The geometry for this cast, generating it only if this is the first frame of
 * it. Callers get the same object for every frame of one storm.
 */
function stormGeometry(x: number, y: number, radius: number): StormGeometry {
  if (SLOTS[0].x === x && SLOTS[0].y === y && SLOTS[0].radius === radius) return SLOTS[0];
  if (SLOTS[1].x === x && SLOTS[1].y === y && SLOTS[1].radius === radius) return SLOTS[1];
  lastSlot = lastSlot === 0 ? 1 : 0;
  const slot = lastSlot === 0 ? SLOTS[0] : SLOTS[1];
  buildStorm(slot, x, y, radius);
  return slot;
}

/**
 * A seed from where the cast landed.
 *
 * The alternative was a seed field on the pose, which makes the caller
 * responsible for a number it has no other use for — and a caller that forgets
 * it, or passes a constant, gets one storm shape for the whole game with
 * nothing failing. The position is already unique per cast and the caller
 * cannot get it wrong. Scaled before truncation so sub-pixel movement, which
 * is all the player ever does, still changes the shape.
 */
function castSeed(x: number, y: number): number {
  const ix = Math.trunc(x * 8192) | 0;
  const iy = Math.trunc(y * 8192) | 0;
  return (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1)) >>> 0;
}

/**
 * How the strike points are spread through the disc.
 *
 * Nothing lands on the caster: `NEAR` holds the closest strike a fifth of the
 * radius out, which at 450 px is 100 px of clearance around a sprite 30 px
 * tall. `FAR` stops far enough short of the rim that even the widest ground
 * flash — `FLASH_MIN + FLASH_SPAN` of the radius, doubled for its outer
 * pool — still falls inside it, so the rim stays the only thing on screen
 * claiming where the edge of the damage was.
 *
 * `SQUASH` flattens the field into an ellipse, because the arena is 1056 x 672
 * and a circular spread at this radius puts a third of its bolts above and
 * below the world. An ellipse inside the circle can only ever under-claim the
 * reach, which is the safe direction to be wrong in — the rim is the claim.
 */
const STRIKE_NEAR = 0.22;
const STRIKE_FAR = 0.84;
const FIELD_SQUASH = 0.68;

/**
 * Angular jitter, inside an even share of the circle per bolt.
 *
 * Each bolt owns a `TAU / 9` = 0.7 rad slice and may wander 0.21 rad inside it.
 * Free choice of angle clumps — nine uniform draws land two bolts on top of
 * each other more often than not — and two overlapping bolts read as one
 * badly-drawn bolt rather than as two strikes.
 */
const ANGLE_JITTER = 0.42;

/** How far above its strike point a channel starts, as a fraction of radius. */
const RISE_MIN = 0.52;
const RISE_SPAN = 0.34;

/** How far the top of a channel drifts sideways from its strike point. */
const LEAN = 0.45;

/**
 * Zigzag amplitude, as a fraction of the channel's height.
 *
 * The displacement alternates sides and is tapered to nothing at both ends by a
 * half-sine, so the channel is anchored at the cloud and at the ground and does
 * its wandering in between. A random walk instead of an alternation gives a
 * wobbling rope; lightning kinks.
 */
const JAG = 0.055;

/** Where a branch leaves the trunk, and how long it runs. */
const BRANCH_ANG_MIN = 0.45;
const BRANCH_ANG_SPAN = 0.5;
const BRANCH_LEN_MIN = 0.16;
const BRANCH_LEN_SPAN = 0.16;

/**
 * Ground-flash radius, as a fraction of the storm radius.
 *
 * Sized against the disc, not against the sprite that got hit: at 0.055 the
 * flashes came out as pin-pricks scattered over a 900 px circle, which reads as
 * dust rather than as something arriving.
 */
const FLASH_MIN = 0.075;
const FLASH_SPAN = 0.045;

/**
 * The window the strikes are spread over, in `age`.
 *
 * Ends well before the effect does: the last bolt still needs its channel and
 * its ground flash to finish inside the cast, and a strike that is cut off by
 * the timer reads as a dropped frame.
 */
const STRIKE_WINDOW = 0.58;

/**
 * Generates one cast into `slot`. Runs on the first frame of a storm and not
 * again; every number below is drawn from a stream seeded by where it landed.
 *
 * Indexed writes into the two buffers use computed offsets into fixed-size
 * arrays — every index below is provably in range from the loop bounds.
 */
function buildStorm(slot: StormGeometry, x: number, y: number, radius: number): void {
  slot.x = x;
  slot.y = y;
  slot.radius = radius;
  const rand = mulberry32(castSeed(x, y));
  const pts = slot.pts;
  const meta = slot.meta;

  for (let i = 0; i < BOLTS; i++) {
    const base = i * FLOATS_PER_BOLT;

    // Where it hits, as an offset from the caster.
    const slice = (i * SLICE_STEP) % BOLTS;
    const angle = ((slice + 0.5) / BOLTS) * TAU + (rand() - 0.5) * ANGLE_JITTER;
    const dist = radius * (STRIKE_NEAR + (STRIKE_FAR - STRIKE_NEAR) * rand());
    const sx = Math.cos(angle) * dist;
    const sy = Math.sin(angle) * dist * FIELD_SQUASH;

    // Where it comes from: up, and off to one side.
    const rise = radius * (RISE_MIN + RISE_SPAN * rand());
    const topX = sx + (rand() - 0.5) * rise * LEAN;
    const topY = sy - rise;

    // The trunk's own direction, and the across-it axis the kinks run along.
    const runX = sx - topX;
    const runY = sy - topY;
    const runLen = Math.hypot(runX, runY) || 1;
    const dirX = runX / runLen;
    const dirY = runY / runLen;
    const perpX = -dirY;
    const perpY = dirX;

    for (let k = 0; k < TRUNK_PTS; k++) {
      const t = k / (TRUNK_PTS - 1);
      // Zero at both ends: the strike point is exact and the top is where the
      // lean put it. Everything between is free to kink.
      const taper = Math.sin(t * Math.PI);
      const side = (k & 1) === 0 ? 1 : -1;
      const jag = side * taper * rise * JAG * (0.55 + 0.45 * rand());
      pts[base + k * 2] = topX + runX * t + perpX * jag;
      pts[base + k * 2 + 1] = topY + runY * t + perpY * jag;
    }

    for (let b = 0; b < BRANCHES; b++) {
      // Rooted away from both ends: a branch off the top point hangs in the
      // air, and one off the strike point looks like the ground splitting.
      const node = 2 + Math.floor(rand() * (TRUNK_PTS - 4));
      const rootX = pts[base + node * 2] ?? sx;
      const rootY = pts[base + node * 2 + 1] ?? sy;
      // One branch each side, so a bolt is a fork and not a comb.
      const turn = ((b & 1) === 0 ? 1 : -1) * (BRANCH_ANG_MIN + rand() * BRANCH_ANG_SPAN);
      const len = rise * (BRANCH_LEN_MIN + rand() * BRANCH_LEN_SPAN);
      const bo = base + BRANCH_BASE + b * BRANCH_PTS * 2;

      // Rotating the trunk's own direction keeps every branch pointing
      // downward-ish, which is what a fork does — it carries on toward the
      // ground, it does not climb back toward the cloud.
      const c1 = Math.cos(turn);
      const s1 = Math.sin(turn);
      const d1x = dirX * c1 - dirY * s1;
      const d1y = dirX * s1 + dirY * c1;
      const midX = rootX + d1x * len * 0.55;
      const midY = rootY + d1y * len * 0.55;

      // The second segment turns a little further the same way: a branch that
      // continues dead straight reads as a drawn tick mark.
      const turn2 = turn * 0.55;
      const c2 = Math.cos(turn2);
      const s2 = Math.sin(turn2);
      const d2x = d1x * c2 - d1y * s2;
      const d2y = d1x * s2 + d1y * c2;

      pts[bo] = rootX;
      pts[bo + 1] = rootY;
      pts[bo + 2] = midX;
      pts[bo + 3] = midY;
      pts[bo + 4] = midX + d2x * len * 0.45;
      pts[bo + 5] = midY + d2y * len * 0.45;
    }

    const mb = i * META_PER_BOLT;
    // Ordered by index but jittered inside its share, so the storm walks around
    // the disc instead of firing all nine at one instant.
    meta[mb] = STRIKE_WINDOW * ((i + rand() * 0.85) / BOLTS);
    meta[mb + 1] = radius * (FLASH_MIN + rand() * FLASH_SPAN);
  }
}

// ── Storm painting ────────────────────────────────────────────────────────────

/** How long one channel is on screen, in `age`. About 135 ms at 0.75 s. */
const BOLT_LIFE = 0.18;

/** How long the ground keeps burning where a bolt landed. */
const GLOW_LIFE = 0.40;

/** How long the discharge takes to reach the rim. */
const WAVE_END = 0.32;

/**
 * When the area wash peaks, and how bright it gets.
 *
 * The rise is a tenth of the cast and the drain is the other nine tenths, which
 * is not symmetry for its own sake: a room lit by a flash does not go dark at
 * the speed it went bright, and a wash that fades as fast as it arrived reads
 * as a light being switched rather than as one going out.
 */
const AREA_RISE = 0.10;
const AREA_PEAK = 0.55;

/**
 * Trunk points the core pass skips at the top of a channel. Two of eight
 * segments: enough to read as a fade-in, not so much that short bolts lose
 * their core entirely.
 */
const HEAD_PTS = 2;

/** Channel line widths, as fractions of the radius, with pixel floors. */
const CORE_W = 0.006;
const HALO_W = 0.024;

/**
 * Where a storm is, how big it is, and how far through it is.
 *
 * Every length is derived from {@link radius}; nothing here knows that today's
 * storm is 450 px across.
 */
export interface StormPose {
  /** Centre, in the coordinate space the context is already in. */
  readonly x: number;
  /** Centre. `game.js` draws the world offset by `CONFIG.hudHeight`. */
  readonly y: number;
  /** The blast radius the damage actually used — `CONFIG.stormBlastRadius`. */
  readonly radius: number;
  /**
   * 0 at the instant of the cast, 1 when the effect is spent. Anything outside
   * `[0, 1)` paints nothing, so the caller may hand over a dead timer without
   * guarding the call. Drive it from a countdown of {@link STORM_FX_SECS}:
   * `age = 1 - timer / STORM_FX_SECS`.
   */
  readonly age: number;
}

/**
 * Lays down the struck part of one bolt as a fresh path: the trunk from
 * {@link HEAD_PTS} down to the ground, then both branches as their own
 * subpaths. The caller strokes it — twice, for halo and core, without
 * rebuilding it.
 *
 * Trunk and branches share a path so that one stroke covers both — a branch
 * stroked separately from its trunk draws its own round cap over the join, and
 * at halo width that cap is a bead on the side of the channel.
 *
 * The `?? 0` fallbacks are on a fixed-size buffer indexed from loop bounds, so
 * they are unreachable; they are how this reads a `Float32Array` under
 * `noUncheckedIndexedAccess` without asserting.
 */
function traceChannel(
  ctx: CanvasRenderingContext2D, pts: Float32Array, base: number, ox: number, oy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(ox + (pts[base + HEAD_PTS * 2] ?? 0), oy + (pts[base + HEAD_PTS * 2 + 1] ?? 0));
  for (let k = HEAD_PTS + 1; k < TRUNK_PTS; k++) {
    ctx.lineTo(ox + (pts[base + k * 2] ?? 0), oy + (pts[base + k * 2 + 1] ?? 0));
  }
  for (let b = 0; b < BRANCHES; b++) {
    const bo = base + BRANCH_BASE + b * BRANCH_PTS * 2;
    ctx.moveTo(ox + (pts[bo] ?? 0), oy + (pts[bo + 1] ?? 0));
    for (let k = 1; k < BRANCH_PTS; k++) {
      ctx.lineTo(ox + (pts[bo + k * 2] ?? 0), oy + (pts[bo + k * 2 + 1] ?? 0));
    }
  }
}

/**
 * Lays down the top of one bolt — the {@link HEAD_PTS} segments above where
 * the channel proper begins. Drawn thin and dim, which is the whole point of
 * separating it: a bolt has to come from somewhere, and one struck at full
 * width to its topmost point ends in a bright round cap hanging in mid-air.
 * Stroked at the *channel's* width and given the halo alone it was worse — a
 * blunt violet club — so the head gets the thin width and the dim colour both.
 */
function traceHead(
  ctx: CanvasRenderingContext2D, pts: Float32Array, base: number, ox: number, oy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(ox + (pts[base] ?? 0), oy + (pts[base + 1] ?? 0));
  for (let k = 1; k <= HEAD_PTS; k++) {
    ctx.lineTo(ox + (pts[base + k * 2] ?? 0), oy + (pts[base + k * 2 + 1] ?? 0));
  }
}

/**
 * Paints one lightning storm: forked channels striking down inside the radius
 * at staggered times, a ground flash where each lands, a discharge running out
 * to the rim, the rim itself at the true blast radius, and an afterglow.
 *
 * Unlike the other painters in this directory this one saves and restores the
 * context, because it sets `globalCompositeOperation`. Additive is what makes
 * overlapping channels brighten instead of stacking into flat plates, and a
 * composite mode left dirty is not a wrong colour on one sprite, it is every
 * later draw in the frame coming out wrong.
 */
export function paintLightningStorm(ctx: CanvasRenderingContext2D, p: StormPose): void {
  if (!(p.age >= 0) || p.age >= 1 || !(p.radius > 0)) return;
  const geo = stormGeometry(p.x, p.y, p.radius);
  const pts = geo.pts;
  const meta = geo.meta;
  const r = p.radius;
  const age = p.age;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The area wash first, under everything, so the bolts sit on top of the light
  // rather than in it. Rises fast and drains slowly — a room lit by a flash
  // does not go dark at the same speed it went bright.
  const rise = age < AREA_RISE
    ? age / AREA_RISE
    : 1 - (age - AREA_RISE) / (1 - AREA_RISE);
  blitGlow(ctx, areaGlow(), p.x, p.y, r, AREA_PEAK * rise * rise);

  // Ground flashes for every bolt that has struck, oldest first so a fresh
  // strike lands over a dying one.
  const strike = strikeGlow();
  for (let i = 0; i < BOLTS; i++) {
    const t = (age - (meta[i * META_PER_BOLT] ?? 0)) / GLOW_LIFE;
    if (t < 0 || t >= 1) continue;
    const fr = meta[i * META_PER_BOLT + 1] ?? r * FLASH_MIN;
    const bx = p.x + (pts[i * FLOATS_PER_BOLT + (TRUNK_PTS - 1) * 2] ?? 0);
    const by = p.y + (pts[i * FLOATS_PER_BOLT + (TRUNK_PTS - 1) * 2 + 1] ?? 0);
    const fade = (1 - t) * (1 - t);
    // Two blits: a wide dim pool of light on the ground, and the hot centre it
    // came from. One blit at one size is a sticker; two is a light source.
    blitGlow(ctx, strike, bx, by, fr * 2.4, 0.5 * fade);
    // The hot core outlives its own strike by very little — it is the moment of
    // contact, not the burn — so it is cubed against the pool's square.
    blitGlow(ctx, strike, bx, by, fr * (0.55 + 0.45 * t), 0.95 * fade * (1 - t));
  }

  // Channels last of the bright work, over their own flashes.
  const coreW = Math.max(1, r * CORE_W);
  const haloW = Math.max(2.5, r * HALO_W);
  for (let i = 0; i < BOLTS; i++) {
    const local = (age - (meta[i * META_PER_BOLT] ?? 0)) / BOLT_LIFE;
    if (local < 0 || local >= 1) continue;
    const base = i * FLOATS_PER_BOLT;

    const bright = channelBrightness(local);
    // The head, thin and dim, so the bolt fades in out of the dark above.
    traceHead(ctx, pts, base, p.x, p.y);
    ctx.globalAlpha = 0.4 * bright;
    ctx.strokeStyle = HALO;
    ctx.lineWidth = coreW;
    ctx.stroke();
    // Then the channel: one path, stroked twice. Halo under core.
    traceChannel(ctx, pts, base, p.x, p.y);
    ctx.globalAlpha = 0.5 * bright;
    ctx.strokeStyle = HALO;
    ctx.lineWidth = haloW;
    ctx.stroke();
    ctx.globalAlpha = bright;
    ctx.strokeStyle = CORE;
    ctx.lineWidth = coreW;
    ctx.stroke();
  }

  // The discharge running out to the rim. It stops *at* the rim and dies there
  // rather than passing through it, which is the whole reason it exists: it
  // draws the eye to the edge of the damage on the way past.
  if (age < WAVE_END) {
    const wt = age / WAVE_END;
    ctx.globalAlpha = 0.55 * (1 - wt);
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = Math.max(1.5, r * 0.008);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * (0.15 + 0.85 * wt), 0, TAU);
    ctx.stroke();
  }

  // The rim, at exactly the radius the damage used, for the whole cast. It does
  // not grow into place: the player is being told where the edge was, and a
  // number that arrives late is a number he cannot act on.
  // Fades linearly rather than on a curve: this is the one element the player
  // may still be reading at the end of the cast, and an ease-out takes it off
  // screen while the last bolts are still landing.
  const rimFade = 1 - age;
  ctx.globalAlpha = 0.34 * rimFade;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = Math.max(3, r * 0.024);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.9 * rimFade;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = Math.max(1.5, r * 0.006);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.stroke();

  ctx.restore();
}

/**
 * Fills and outlines one piece of the after-image.
 *
 * The fill is held well under the outline: an after-image is a hole in the
 * world where somebody was, and a solid one is a second wizard. The outline is
 * what the eye reads the shape from, so it keeps the light.
 */
function paintGhostPart(ctx: CanvasRenderingContext2D, age: number): void {
  const fade = Math.pow(1 - age, 1.2);
  ctx.globalAlpha = 0.4 * fade;
  ctx.fill();
  ctx.globalAlpha = 0.95 * fade;
  ctx.stroke();
}

/**
 * A channel's brightness across its own life, 1 down to 0.
 *
 * Not a fade. A real strike is several discharges down one channel inside a
 * tenth of a second, and the eye knows it: a smooth ramp reads as a glowing
 * stick being lowered into the ground. Two hard beats and a tail is the
 * cheapest thing that reads as electricity, and being a function of `local`
 * alone keeps it deterministic — the caller can scrub `age` and get the same
 * picture back.
 */
function channelBrightness(local: number): number {
  if (local < 0.17) return 1;
  if (local < 0.29) return 0.4;
  if (local < 0.5) return 0.9;
  return (1 - local) / 0.5;
}

// ── Blink ─────────────────────────────────────────────────────────────────────

/**
 * The after-image's body box, in pulse radii.
 *
 * The wizard is about 30 px tall and 11 px wide, drawn around an origin at his
 * middle, and the pulse he leaves behind is 56 px in radius — so the body is a
 * bit over half of it. Expressing the ghost in radii rather than in pixels is
 * what keeps the two in proportion if the pulse is ever retuned: the shape is
 * "a body inside this pulse", not "thirty pixels".
 */
const GHOST_HEM_Y = 0.24;
const GHOST_HEM_X = 0.135;
const GHOST_SHOULDER_Y = -0.10;
const GHOST_SHOULDER_X = 0.105;
const GHOST_HOOD_BASE_Y = -0.09;
const GHOST_HOOD_X = 0.078;
const GHOST_HOOD_Y = -0.22;
/**
 * How much width the hood keeps at its peak.
 *
 * Not zero. A hood run to a point is a needle at this size — eight pixels of
 * cowl tapering to nothing reads as an aerial sticking out of his head. Blunted
 * it reads as cloth.
 */
const GHOST_HOOD_TIP = 0.45;

/** How much of its width the after-image keeps once it has fully collapsed. */
const GHOST_PINCH = 0.16;

/**
 * Half-width of the streak at its middle, and how long it stays.
 *
 * It goes early. Held to the end of the effect, the last of it is a short
 * bright dash lying across the pulse ring with nothing left to explain it —
 * the eye reads a stray line, not a trail, because by then there is no travel
 * on screen for it to belong to.
 */
const TRAIL_W = 0.13;
const TRAIL_END = 0.4;

/**
 * The arrival flash: how long each half lasts, and how big it is in radii.
 *
 * The outer half is drawn at exactly 1.0 radii and no further. It is a soft
 * glow and it would have cost nothing to spill it a little past the rim, which
 * is exactly why it does not: everything in this painter that has an edge puts
 * that edge on the damage radius, and a bloom leaking past it is the one thing
 * on screen quietly saying the pulse reached further than it did.
 */
const FLASH_HALO_END = 0.45;
const FLASH_HALO_R = 1.0;
const FLASH_CORE_END = 0.3;
const FLASH_CORE_R = 0.3;
const FLASH_CORE_GROW = 0.35;

/**
 * Arcs thrown off the arrival, and where along the radius they run.
 *
 * Five, and kinked, and at uneven angles — all three for one reason. Six
 * straight spokes of equal length around a circle is a gunsight: the first
 * version of this drew exactly that and the picture read as a targeting
 * reticle sitting on the arena, which is a UI element, not a discharge.
 */
const SPIKES = 5;
const SPIKE_IN = 0.3;
const SPIKE_END = 0.45;

/**
 * How far an arc's middle wanders off its own spoke, in radii, and how far its
 * angle is nudged off the even share. Both fall out of `sin` on the index: the
 * shape has to be the same every blink so it does not shimmer, and a table of
 * five hand-picked numbers would be five numbers to explain.
 */
const SPIKE_WOBBLE = 0.14;
const SPIKE_SKEW = 0.22;

/**
 * A blink, as both of its ends. `fromX`/`fromY` is where he was standing;
 * `toX`/`toY` is where the pulse went off.
 */
export interface BlinkPose {
  /** Where he left, in the coordinate space the context is already in. */
  readonly fromX: number;
  readonly fromY: number;
  /** Where he arrived. */
  readonly toX: number;
  readonly toY: number;
  /** The pulse radius the damage used — `CONFIG.wizBlinkPulseRadius`. */
  readonly radius: number;
  /**
   * 0 at the instant of the hop, 1 when the effect is spent. Outside `[0, 1)`
   * paints nothing. Drive it from a countdown of {@link BLINK_FX_SECS}:
   * `age = 1 - timer / BLINK_FX_SECS`.
   */
  readonly age: number;
}

/**
 * Paints a blink: the after-image he left, the streak between the two points,
 * the arrival flash, and the pulse rim at the true damage radius.
 *
 * The rim is drawn at exactly {@link BlinkPose.radius} and does not grow into
 * it, for the reason `spawnShockRing` gives at its own definition — what is on
 * screen is a report of what was already hit, so a caller using this should
 * drop the shock ring rather than draw both.
 *
 * Saves and restores the context, for the same reason the storm does.
 */
export function paintBlinkArrival(ctx: CanvasRenderingContext2D, p: BlinkPose): void {
  if (!(p.age >= 0) || p.age >= 1 || !(p.radius > 0)) return;
  const r = p.radius;
  const age = p.age;
  const dx = p.toX - p.fromX;
  const dy = p.toY - p.fromY;
  const len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 1;
  const uy = len > 0 ? dy / len : 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The streak, drawn from a tail that slides forward along the hop until it
  // catches the arrival and disappears. A streak that stays pinned to both ends
  // and only fades is a stretched sprite; one that retracts is a body being
  // pulled through.
  if (age < TRAIL_END && len > 0) {
    const tt = age / TRAIL_END;
    const tailX = p.fromX + dx * tt;
    const tailY = p.fromY + dy * tt;
    const midX = (tailX + p.toX) / 2;
    const midY = (tailY + p.toY) / 2;
    // Widest in the middle and pointed at both ends: the shape of something
    // seen only in passing.
    const w = r * TRAIL_W * (1 - tt);
    ctx.globalAlpha = 0.55 * (1 - tt);
    ctx.fillStyle = EDGE;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(midX - uy * w, midY + ux * w);
    ctx.lineTo(p.toX, p.toY);
    ctx.lineTo(midX + uy * w, midY - ux * w);
    ctx.closePath();
    ctx.fill();
    // A bright thread down the centre of it, so the path has an edge to read
    // even when the body of the streak has gone translucent.
    ctx.globalAlpha = 0.85 * (1 - tt);
    ctx.strokeStyle = CORE;
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(p.toX, p.toY);
    ctx.stroke();
  }

  // The after-image: him, still standing where he was, narrowing as the space
  // closes over the gap. A robe and a hood rather than a blob — at thirty
  // pixels tall the silhouette is the only thing carrying "a person was here",
  // and a lozenge that size is a pill.
  const pinch = GHOST_PINCH + (1 - GHOST_PINCH) * (1 - age);
  ctx.fillStyle = ROBE;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = Math.max(1, r * 0.03);
  const hemX = r * GHOST_HEM_X * pinch;
  const shX = r * GHOST_SHOULDER_X * pinch;
  const hoodX = r * GHOST_HOOD_X * pinch;
  const hemY = p.fromY + r * GHOST_HEM_Y;
  const shY = p.fromY + r * GHOST_SHOULDER_Y;
  const hoodBaseY = p.fromY + r * GHOST_HOOD_BASE_Y;

  // The robe: a flare from the shoulders down to the hem.
  ctx.beginPath();
  ctx.moveTo(p.fromX - hemX, hemY);
  ctx.lineTo(p.fromX - shX, shY);
  ctx.lineTo(p.fromX + shX, shY);
  ctx.lineTo(p.fromX + hemX, hemY);
  ctx.closePath();
  paintGhostPart(ctx, age);

  // The hood, as its own shape overlapping the shoulders rather than as more
  // points on the robe's outline. One outline through both gives a cone — which
  // is what the first version of this drew, and it read as a traffic bollard.
  // The seam across the shoulders is the whole tell: it is where a head stops
  // being a continuation of a body.
  const hoodTipY = p.fromY + r * GHOST_HOOD_Y;
  ctx.beginPath();
  ctx.moveTo(p.fromX - hoodX, hoodBaseY);
  ctx.lineTo(p.fromX - hoodX * GHOST_HOOD_TIP, hoodTipY);
  ctx.lineTo(p.fromX + hoodX * GHOST_HOOD_TIP, hoodTipY);
  ctx.lineTo(p.fromX + hoodX, hoodBaseY);
  ctx.closePath();
  paintGhostPart(ctx, age);

  // The arrival. Hard and short: the pulse is instantaneous, and a soft one
  // would read as a charge-up for something that has already resolved.
  const strike = strikeGlow();
  const flash = Math.max(0, 1 - age / FLASH_HALO_END);
  blitGlow(ctx, strike, p.toX, p.toY, r * FLASH_HALO_R, 0.45 * flash * flash);
  // The core spreads as it dies rather than shrinking: light expanding away
  // from where it was is what an impact looks like, and light contracting to a
  // point is what a charge-up looks like — this has already resolved.
  blitGlow(
    ctx, strike, p.toX, p.toY,
    r * (FLASH_CORE_R + FLASH_CORE_GROW * age),
    Math.max(0, 1 - age / FLASH_CORE_END),
  );

  // Arcs out to the rim, tying the flash at the centre to the edge it reached.
  // Every one of them ends exactly on the rim; nothing here overstates it.
  if (age < SPIKE_END) {
    const st = age / SPIKE_END;
    // Rolled off the hop's own direction rather than the world axes, so the
    // burst is oriented by the move that caused it.
    const base = Math.atan2(uy, ux);
    ctx.globalAlpha = 0.85 * (1 - st);
    ctx.strokeStyle = CORE;
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath();
    for (let k = 0; k < SPIKES; k++) {
      const a = base + (k / SPIKES) * TAU + Math.sin(k * 2.4) * SPIKE_SKEW;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Retracts outward as it dies, so the burst is last seen at the rim.
      const inner = r * (SPIKE_IN + (1 - SPIKE_IN) * st);
      const mid = (inner + r) / 2;
      const off = r * SPIKE_WOBBLE * Math.sin(k * 1.7);
      ctx.moveTo(p.toX + cos * inner, p.toY + sin * inner);
      ctx.lineTo(p.toX + cos * mid - sin * off, p.toY + sin * mid + cos * off);
      ctx.lineTo(p.toX + cos * r, p.toY + sin * r);
    }
    ctx.stroke();
  }

  // The rim, at exactly the pulse radius, for the whole effect.
  const rimFade = Math.pow(1 - age, 1.3);
  ctx.globalAlpha = 0.3 * rimFade;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = Math.max(3, r * 0.11);
  ctx.beginPath();
  ctx.arc(p.toX, p.toY, r, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.95 * rimFade;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = Math.max(1.5, r * 0.045);
  ctx.beginPath();
  ctx.arc(p.toX, p.toY, r, 0, TAU);
  ctx.stroke();

  ctx.restore();
}
