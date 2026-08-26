/**
 * The knight's two skills as pictures: Whirlwind's blade vortex and Charge's
 * dash sweep.
 *
 * Both were drawn inline in `drawKnight()` out of the module's own `ctx`, and
 * both paid for it the same way. Whirlwind stroked nine arcs a frame with
 * `shadowBlur = 10` on every one — nine full blur rasters, sixty times a
 * second, for the whole three seconds — and the dash allocated a line-dash
 * array per frame. Neither could be looked at without a browser, because
 * neither took the context it painted into.
 *
 * So they leave, the way the bow, the staff and the Bloodlust badge left: a
 * painter per effect, taking the context and a pose. Everything that repeats
 * is baked into a cached canvas once and blitted after that, which is what
 * turns a per-frame blur pass into a `drawImage`.
 *
 * ## World coordinates, not the body's mirrored frame
 *
 * These two take `x`/`y` and set up their own transform, which is a departure
 * from the other painters in this directory — they expect the caller to have
 * already translated. The reason is `scale(facing, 1)`. `drawKnight()` paints
 * inside a frame mirrored by which way the knight is looking, and:
 *
 * - a vortex drawn in it reverses its spin the moment he turns around, and
 * - a wedge drawn in it needs its angle bent through `mirrorAngle()` first,
 *   which is one more place the drawn reach can drift from the hit test.
 *
 * Taking world coordinates removes both. **Call these outside the body's
 * `scale(facing, 1)`**, with `x`/`y` in the same frame everything else is
 * drawn in — that is `player.x`, `player.y + CONFIG.hudHeight`. The boss
 * whirlwinds too (`WHIRLWIND_START` is emitted at `boss.x`/`boss.y`), and it
 * has no facing at all; a painter that needed one could not serve it.
 *
 * Unlike the other painters here, these save and restore the context
 * themselves, because they set up a transform and a caller cannot be expected
 * to unwind one it did not build.
 *
 * ## Reach is the sim's to state
 *
 * Nothing below hardcodes a radius or an arc. `damageEnemiesInRadius` and
 * `inKnightArc` decide what gets hit; every distance here is a fraction of the
 * `radius`/`arc` the pose carries, and the cached canvases are baked at a
 * canonical size and *scaled* to it rather than bucketed to it — so quantising
 * for the cache can never round the drawn edge off the real one.
 */

import { stamps, glowDotStamp, type StampPainter } from './stamps';
import type { KnightKind } from './character-grids';

const TAU = Math.PI * 2;

/** Clamps to the range `globalAlpha` accepts. Out of range it is *ignored*,
 * which silently leaves the previous frame's alpha in place. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fractional part, for the sawtooth lives the dust motes run on. */
function frac1(v: number): number {
  return v - Math.floor(v);
}

/**
 * Golden-ratio stagger for the per-mote seeds.
 *
 * Motes seeded by `i / count` come out in a marching row; stepping by the
 * golden ratio and taking the fractional part spreads any count of them
 * evenly with no two ever landing on the same phase.
 */
const SEED_STEP = 0.6180339887;

// ── The commitment read ─────────────────────────────────────────────────────

/**
 * One step of the yellow -> orange -> red ramp a held charge climbs, and how
 * heavily that step is drawn.
 *
 * `weight` exists so the wedge stamp can be baked *per band* rather than per
 * frame: line width and glow are properties of the canvas, so they cannot vary
 * continuously once it is cached — but the colour is already banded into three
 * and the band is already the cache key, so the weight rides along for free and
 * a fully-held charge draws visibly heavier than a tapped one.
 */
interface CommitBand {
  /** The tint, matching `knightChargeColor` in game.js exactly. */
  readonly colour: string;
  /** The same colour as `r,g,b`, for the `rgba()` stops the bake needs. */
  readonly rgb: string;
  /** 0 at the cold end, 1 at the hot one. Drives weight, never reach. */
  readonly weight: number;
}

const COMMIT_BANDS = [
  { colour: '#FFCC00', rgb: '255,204,0', weight: 0 },
  { colour: '#FF8800', rgb: '255,136,0', weight: 0.5 },
  { colour: '#FF3020', rgb: '255,48,32', weight: 1 },
] as const satisfies readonly CommitBand[];

function commitBand(frac: number): CommitBand {
  return frac >= 0.85 ? COMMIT_BANDS[2] : frac > 0.5 ? COMMIT_BANDS[1] : COMMIT_BANDS[0];
}

/**
 * What colour a charge held for `frac` of the maximum reads as.
 *
 * Thresholds and hex values are `knightChargeColor`'s, unchanged: the windup
 * telegraph, the dash and the HUD have to agree, and the player has already
 * learned that red means committed.
 *
 * Exported because it is now written in two places — here and in
 * `src/legacy/game.js` — and one of those has to go. This is the survivor:
 * whoever wires this module in should delete `knightChargeColor` and point
 * `drawKnightChargeReach`/`drawKnightChargeTravel` at this instead, so the
 * telegraph and the dash it promises cannot be tuned apart.
 */
export function chargeCommitColour(frac: number): string {
  return commitBand(frac).colour;
}

// ── Whirlwind ───────────────────────────────────────────────────────────────

/**
 * One spinning frame of Whirlwind.
 *
 * Three separate clocks, because the effect has three separate rhythms and
 * deriving any of them from another would mean this file holding a copy of a
 * `CONFIG` number. Each is one expression at the call site:
 *
 * ```js
 * paintWhirlwind(ctx, {
 *   x: player.x, y: player.y + CONFIG.hudHeight,
 *   radius: CONFIG.knightWhirlwindRadius,
 *   age:  1 - knightWhirlwindTimer / CONFIG.knightWhirlwindDuration,
 *   tick: 1 - knightWhirlwindTick  / CONFIG.knightWhirlwindTickRate,
 *   t: loopT,
 *   kind: inv.knightFireSwordTimer > 0 ? 'fireSword' : 'normal',
 * });
 * ```
 */
export interface WhirlwindPose {
  /** Centre, in the frame the rest of the world is drawn in. */
  readonly x: number;
  /** As `x`. Remember `CONFIG.hudHeight`. */
  readonly y: number;
  /** The circle `damageEnemiesInRadius` is actually using, in pixels. */
  readonly radius: number;
  /** 0 at the cast, 1 as it ends. Drives nothing but the fade in and out. */
  readonly age: number;
  /**
   * 0 the instant damage lands, climbing to 1 just before the next tick.
   *
   * This is the whole point of the effect: the spin bites every
   * `knightWhirlwindTickRate` seconds, and until now nothing on screen said
   * when. Feed it the sim's own countdown and the pulse cannot drift from the
   * damage — including on the boss, whose whirlwind ticks to a different clock.
   */
  readonly tick: number;
  /** Wall clock in seconds (`loopT`). Spin and dust run on real time, so a
   * retuned duration changes how long he spins, not how fast. */
  readonly t: number;
  /** Which knight is spinning. The fire sword recolours the whole body, and a
   * steel-blue vortex on an orange knight reads as someone else's effect. */
  readonly kind: KnightKind;
}

/** The three tones one blade trail is drawn in. */
interface BladePalette {
  /** The leading edge, where the steel is catching the light. */
  readonly edge: string;
  /** The trail dragged behind it. */
  readonly body: string;
  /** What it throws onto the floor around it. */
  readonly glow: string;
  /** Cache key, precomputed: building it per frame is a string allocation per
   * frame, which is the one thing a 180-frame effect must not do. */
  readonly key: string;
}

/**
 * Steel takes the plate's own highlight over the crest blue, so the vortex
 * looks like his armour moving fast rather than a spell cast near him. Fire
 * keeps the shades the inline version already used, because the fire sword's
 * orange is what the rest of that powerup is painted in.
 */
const BLADE: Readonly<Record<KnightKind, BladePalette>> = {
  normal: { edge: '#EAF1FF', body: '#C4CEE2', glow: '#3A5CC8', key: 'knight-vortex|steel' },
  fireSword: { edge: '#FFE0AC', body: '#FF7A1F', glow: '#FF5500', key: 'knight-vortex|fire' },
};

/** Where one trail rides and how much arc it drags. */
interface BladeTrail {
  /** Radius, as a fraction of the pose's own reach. */
  readonly rFrac: number;
  /** Which way its leading edge points at spin zero, radians. */
  readonly lead: number;
  /** How far behind that its tail reaches, radians. */
  readonly sweep: number;
}

/**
 * Three trails, a third of a turn apart so the vortex never shows a bare side.
 *
 * They ride *inside* the reach, not on it. The circle at `radius` is drawn
 * separately and left clean, because that circle is a promise — it is the one
 * `damageEnemiesInRadius` uses — and a 3.6px-wide trail centred on it would
 * put lit pixels a couple of pixels past a reach the sim does not have.
 *
 * Inner trails get a longer angular tail on purpose. Arc length is `r * theta`,
 * so equal angles make the inner ones look stubby; these three come out within
 * a few pixels of the same *length*, which is what the eye compares.
 */
const TRAILS: readonly BladeTrail[] = [
  { rFrac: 0.92, lead: 0, sweep: 1.75 },
  { rFrac: 0.68, lead: TAU / 3, sweep: 2.35 },
  { rFrac: 0.44, lead: (TAU * 2) / 3, sweep: 3.3 },
];

/**
 * How far a tail falls inward over its length, as a fraction of its radius.
 *
 * The first render of this drew each trail as a true arc, and three arcs at
 * three fixed radii is three concentric rings: it read as a dial, not as a
 * weapon. Letting each tail drop inward behind its leading edge makes them
 * spiral and cross, which is the difference between "circles" and "vortex".
 * The trails still start on their own radius, so the spacing that keeps the
 * outermost clear of the reach circle is unaffected.
 */
const TRAIL_SPIRAL = 0.22;

/**
 * Lays one span of a trail into the current path, from `f0` to `f1` of the way
 * back along its tail. Bake-time only — a whole trail is one baked shape.
 */
function trailPath(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  trail: BladeTrail,
  f0: number,
  f1: number,
  steps: number,
): void {
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const f = f0 + (f1 - f0) * (i / steps);
    const a = trail.lead - trail.sweep * f;
    const rr = r * (1 - TRAIL_SPIRAL * f);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

/**
 * Radius the vortex canvas is baked at.
 *
 * Chosen a little above the 72 px Whirlwind actually reaches so the usual case
 * scales *down*, which is the direction that stays crisp. The chained charge's
 * 60 px whirl shares the same canvas.
 */
const VORTEX_UNIT_R = 80;

/** Room round the bake for the glow, and for the leading edge's flick. */
const VORTEX_PAD = 14;
const VORTEX_SIZE = (VORTEX_UNIT_R + VORTEX_PAD) * 2;

/** Steps in one trail's taper. Enough that the alpha ramp does not band. */
const TAPER_STEPS = 14;

/** Width of a trail at its leading edge, at the bake's radius. */
const TRAIL_W = 4.2;

/** How much of a tail keeps the hot edge tone before dropping to the body. */
const EDGE_SHARE = 0.16;

/**
 * Bakes the three trails. Runs once per knight kind, ever.
 *
 * The glow is laid down as *one* blurred stroke under each whole trail rather
 * than riding the taper. `shadowBlur` costs a full raster pass per draw call,
 * and taking it on all 42 taper steps would turn a one-off into a visible
 * hitch on the first cast of a session — for a soft halo that cannot resolve
 * the taper underneath it anyway.
 */
function bakeVortex(g: CanvasRenderingContext2D, w: number, h: number, pal: BladePalette): void {
  const cx = w / 2;
  const cy = h / 2;
  g.lineCap = 'butt';

  for (const trail of TRAILS) {
    const r = VORTEX_UNIT_R * trail.rFrac;

    g.shadowColor = pal.glow;
    g.shadowBlur = 13;
    g.strokeStyle = pal.glow;
    g.lineWidth = 6;
    g.globalAlpha = 0.5;
    trailPath(g, cx, cy, r, trail, 0, 1, 24);
    g.stroke();
    g.shadowBlur = 0;

    for (let s = 0; s < TAPER_STEPS; s++) {
      // 0 at the leading edge, 1 at the end of the tail.
      const back = s / TAPER_STEPS;
      const to = (s + 1) / TAPER_STEPS;
      g.globalAlpha = (1 - back) ** 1.6;
      g.lineWidth = TRAIL_W * (1 - back * 0.86);
      g.strokeStyle = back < EDGE_SHARE ? pal.edge : pal.body;
      // A quarter-step of overlap: butt caps on spans that merely abut leave a
      // hairline of background between them at these widths.
      trailPath(g, cx, cy, r, trail, back, to + 0.25 / TAPER_STEPS, 3);
      g.stroke();
    }

    // The tip: a short bright bar across the leading end, raked forward.
    //
    // Kept to roughly twice the trail's width on purpose. It started three
    // times longer than that and the picture came back with three refresh
    // icons spinning in it — a barb that overhangs a tapering tail is an
    // arrowhead, and an arrowhead is the one shape a UI has already claimed.
    // At this length it is steel catching the light instead.
    g.globalAlpha = 1;
    g.strokeStyle = pal.edge;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(cx + Math.cos(trail.lead - 0.03) * r * 0.93, cy + Math.sin(trail.lead - 0.03) * r * 0.93);
    g.lineTo(cx + Math.cos(trail.lead + 0.02) * r * 1.05, cy + Math.sin(trail.lead + 0.02) * r * 1.05);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * One painter per kind, built at module load.
 *
 * `stamps.get` evaluates its painter argument on every call, hit or miss, so a
 * closure built at the call site would be an allocation on every one of the
 * 180 frames a whirlwind lasts. These two are made once.
 */
const VORTEX_PAINTER: Readonly<Record<KnightKind, StampPainter>> = {
  normal: (g, w, h) => bakeVortex(g, w, h, BLADE.normal),
  fireSword: (g, w, h) => bakeVortex(g, w, h, BLADE.fireSword),
};

/** Turns per second. Matches the `loopT * 9` rad/s the inline version span at,
 * which is a speed that had already been looked at. */
const SPIN_HZ = 1.45;

/** The second pass runs slower and dimmer. Two blits of one canvas at
 * different rates is depth for the price of a `drawImage`; a second canvas
 * would have been another 35k pixels of cache for the same read. */
const GHOST_RATE = 0.58;
const GHOST_ALPHA = 0.36;

/** How fast it arrives and how slowly it leaves, as fractions of `age`. The
 * tail matches the 0.4 s fade the inline version had; the head is new, and
 * short, because a skill should land rather than dissolve into place. */
const RAMP_IN = 0.045;
const RAMP_OUT = 0.13;

/** Base alpha of the reach circle, and how far a bite lifts it. */
const REACH_ALPHA = 0.28;
const REACH_BITE = 0.4;

/** How much of a tick period the bite ring is visible for. Under 1 so the ring
 * has always cleared before the next bite starts: two live at once and the
 * rhythm stops being countable, which is the only reason it is drawn. */
const TICK_VISIBLE = 0.72;

/** Where the bite ring leaves from, as a fraction of reach, and how bright. */
const TICK_R0 = 0.22;
const TICK_ALPHA = 0.95;

/** How hard a bite flashes the vortex itself. */
const BITE_LIFT = 0.22;

/** Dust flung off the spin. Eight is the point where a ninth stopped being
 * visible against the trails. */
const GRIT_COUNT = 8;
const GRIT_HZ = 1.9;
const GRIT_R0 = 0.3;
const GRIT_R1 = 1.04;
const GRIT_ALPHA = 0.95;

/** Motes lag the blades rather than orbiting with them: they have been let go
 * of, and grit that kept pace would read as attached to the weapon. */
const GRIT_DRAG = 0.42;

/** How a mote's size runs over its life. It leaves big and thins out. */
const GRIT_S0 = 0.45;
const GRIT_S1 = 1.05;

/** The mote. Stone off the floor, cool enough not to be mistaken for a spark. */
const GRIT_COLOUR = '#C8D0DE';
const GRIT_R = 2;
const GRIT_BLUR = 4;

/**
 * The one mote both skills fling, held in a slot rather than re-fetched.
 *
 * `glowDotStamp` builds its cache key with a template literal, so calling it
 * per frame allocates a string per frame even though it never misses. Once is
 * enough: nothing about this dot varies.
 */
let gritCanvas: HTMLCanvasElement | null = null;
function gritStamp(): HTMLCanvasElement {
  if (gritCanvas === null) gritCanvas = glowDotStamp(GRIT_COLOUR, GRIT_R, GRIT_BLUR);
  return gritCanvas;
}

/** Fade in and out, off `age`. Zero outside the spin, and zero on NaN. */
function whirlEnvelope(age: number): number {
  if (!(age >= 0) || age >= 1) return 0;
  return Math.min(1, age / RAMP_IN, (1 - age) / RAMP_OUT);
}

/** The bite, as a spike: 1 the instant damage lands, near nothing by a third
 * of the way to the next one. Cubed rather than linear so it snaps. */
function biteFlash(tick: number): number {
  if (!(tick >= 0) || tick >= 1) return 0;
  const k = 1 - tick;
  return k * k * k;
}

/**
 * Paints one frame of the blade vortex, centred on `p.x`/`p.y`.
 *
 * Saves and restores the context. Call it *outside* the knight's
 * `scale(facing, 1)`: mirrored, the vortex reverses direction whenever he
 * turns around.
 */
export function paintWhirlwind(ctx: CanvasRenderingContext2D, p: WhirlwindPose): void {
  const alpha = whirlEnvelope(p.age);
  if (alpha <= 0) return;

  const pal = BLADE[p.kind];
  const bite = biteFlash(p.tick);

  ctx.save();
  ctx.translate(p.x, p.y);

  // The reach. Exactly the circle the sim tests against, one pixel wide and
  // left clear of the trails so it stays the thing that states where the
  // damage stops. It breathes on the bite instead of on a free-running sine,
  // so even the boundary is telling you about the rhythm.
  ctx.globalAlpha = clamp01(alpha * (REACH_ALPHA + REACH_BITE * bite));
  ctx.strokeStyle = pal.body;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, p.radius, 0, TAU);
  ctx.stroke();

  // The vortex: the same baked canvas twice, at two spin rates.
  const stamp = stamps.get(pal.key, VORTEX_SIZE, VORTEX_SIZE, VORTEX_PAINTER[p.kind]);
  const size = (p.radius / VORTEX_UNIT_R) * VORTEX_SIZE;
  const spin = p.t * SPIN_HZ * TAU;
  blitSpun(ctx, stamp, spin * GHOST_RATE, size, alpha * GHOST_ALPHA);
  blitSpun(ctx, stamp, spin, size, alpha * (1 - BITE_LIFT + BITE_LIFT * bite));

  // The bite. It leaves the middle on the tick and reaches the reach circle in
  // one tick period, so the 0.22 s rhythm is something you watch rather than
  // something you infer from health bars.
  if (p.tick >= 0 && p.tick < TICK_VISIBLE) {
    const k = p.tick / TICK_VISIBLE;
    const fade = (1 - k) * (1 - k);
    ctx.globalAlpha = clamp01(alpha * fade * TICK_ALPHA);
    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = 0.8 + 2.6 * fade;
    ctx.beginPath();
    ctx.arc(0, 0, p.radius * (TICK_R0 + (1 - TICK_R0) * k), 0, TAU);
    ctx.stroke();
  }

  // Dust, thrown outward and thinning as it goes.
  const grit = gritStamp();
  const gritScale = p.radius / VORTEX_UNIT_R;
  for (let i = 0; i < GRIT_COUNT; i++) {
    const seed = frac1(i * SEED_STEP);
    const life = frac1(p.t * GRIT_HZ + seed);
    const a = spin * GRIT_DRAG + seed * TAU;
    const rr = p.radius * (GRIT_R0 + (GRIT_R1 - GRIT_R0) * life);
    const s = (GRIT_S1 - (GRIT_S1 - GRIT_S0) * life) * gritScale;
    const dw = grit.width * s;
    const dh = grit.height * s;
    ctx.globalAlpha = clamp01(alpha * (1 - life) * GRIT_ALPHA);
    ctx.drawImage(grit, Math.cos(a) * rr - dw / 2, Math.sin(a) * rr - dh / 2, dw, dh);
  }

  ctx.restore();
}

// ── Charge dash ─────────────────────────────────────────────────────────────

/**
 * One frame of the dash Charge releases into.
 *
 * The windup telegraph is a separate drawing and stays where it is; this is
 * the payoff, and it deliberately reuses the telegraph's vocabulary — the same
 * wedge at the same reach, the same converging streaks, the same
 * yellow-orange-red hold colour — so that what was promised is recognisably
 * what arrives. The difference is that the telegraph is dashed and this is
 * solid: one is a prediction and the other is committed.
 *
 * ```js
 * paintChargeDash(ctx, {
 *   x: player.x, y: player.y + CONFIG.hudHeight,
 *   angle: knightDash.angle,            // world, committed at release
 *   radius: CONFIG.knightChargeRadius,
 *   arc: CONFIG.knightChargeArcRadians, // total sweep, not the half
 *   frac: knightDash.frac,
 *   progress: 1 - knightDash.timer / CONFIG.knightChargeDashDuration,
 *   tick: 1 - knightChargeTick / CONFIG.knightChargeTickRate,
 * });
 * ```
 */
export interface ChargeDashPose {
  /** The knight, in the frame the rest of the world is drawn in. */
  readonly x: number;
  /** As `x`. Remember `CONFIG.hudHeight`. */
  readonly y: number;
  /** World heading, straight from `knightDash.angle`. Not mirrored: this
   * painter runs outside the body's `scale(facing, 1)`. */
  readonly angle: number;
  /** Reach, in pixels. `inKnightArc` tests against this exact number. */
  readonly radius: number;
  /** *Total* sweep in radians, as `CONFIG.knightChargeArcRadians` states it —
   * the half is taken here, so a caller cannot halve it twice. */
  readonly arc: number;
  /** How committed it is: `knightDash.frac`, the hold at the moment of
   * release. Drives colour, weight and glow, and never reach — a wedge that
   * grew with the hold would promise a range the dash does not have. */
  readonly frac: number;
  /** 0 at the release, 1 as the dash ends. Drives only the fade out. */
  readonly progress: number;
  /**
   * 0 the instant the arc lands its hits, 1 just before the next tick.
   *
   * One blade crossing per damage tick. The inline version crossed three times
   * over the dash while the sim ticked seven and a half times, so the swings a
   * player watched had nothing to do with the swings that killed things.
   */
  readonly tick: number;
}

/** Radius the wedge is baked at. Above the 90 px it reaches, so the usual case
 * scales down. */
const WEDGE_UNIT_R = 96;

/** Room for the rim's glow, and the apex end of the canvas. */
const WEDGE_PAD = 14;

/** Converging streaks inside the wedge — the telegraph's own read. */
const WEDGE_STREAKS = 5;

/**
 * Steps the half-angle is quantised to for the cache key.
 *
 * A cache keyed on a raw float is a cache that misses every frame and grows
 * without bound. 1/256 rad rounds by at most 0.002 rad, which at the charge's
 * 90 px reach is 0.18 px of lateral error — under a pixel, so the drawn edge
 * is still the real edge. The radius needs no such treatment: the stamp is
 * scaled to it exactly.
 */
const HALF_STEPS = 256;

function quantiseHalf(half: number): number {
  return Math.round(half * HALF_STEPS) / HALF_STEPS;
}

/**
 * Bakes the wedge for one commitment band: an interior wash, the streaks, the
 * two straight edges, and the rim.
 *
 * The radial gradient is the reason this is a stamp at all. A wedge that fades
 * from nothing at the apex to a lit rim is the natural drawing, and building
 * that gradient at 60 fps is the classic trap; built once per band it costs
 * three gradients for the lifetime of the process.
 */
function bakeWedge(
  g: CanvasRenderingContext2D,
  _w: number,
  h: number,
  band: CommitBand,
  half: number,
): void {
  const ax = WEDGE_PAD;
  const ay = h / 2;

  const wash = g.createRadialGradient(ax, ay, 0, ax, ay, WEDGE_UNIT_R);
  wash.addColorStop(0, `rgba(${band.rgb},0)`);
  wash.addColorStop(0.55, `rgba(${band.rgb},${0.02 + 0.02 * band.weight})`);
  wash.addColorStop(0.9, `rgba(${band.rgb},${0.09 + 0.09 * band.weight})`);
  // Back to nothing at the very edge, so the rim stroke below is the only hard
  // boundary and the fill cannot bleed a pixel past the reach.
  wash.addColorStop(1, `rgba(${band.rgb},0)`);
  g.fillStyle = wash;
  g.beginPath();
  g.moveTo(ax, ay);
  g.arc(ax, ay, WEDGE_UNIT_R, -half, half);
  g.closePath();
  g.fill();

  // Streaks running out to the rim, alternating where they start so they read
  // as a spray rather than as a comb.
  //
  // They start well out from the apex, and so do the edges below. The first
  // render had both running all the way in, and every line in the drawing
  // converging on the knight's chest made a searchlight coming out of him —
  // plus the fill was solid enough to hide the enemies it was about to kill.
  g.strokeStyle = band.colour;
  g.globalAlpha = 0.13 + 0.1 * band.weight;
  g.lineWidth = 1.1;
  for (let i = 0; i < WEDGE_STREAKS; i++) {
    const a = -half + ((i + 0.5) / WEDGE_STREAKS) * half * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const inner = WEDGE_UNIT_R * (i % 2 === 0 ? 0.5 : 0.66);
    g.beginPath();
    g.moveTo(ax + ca * inner, ay + sa * inner);
    g.lineTo(ax + ca * WEDGE_UNIT_R * 0.95, ay + sa * WEDGE_UNIT_R * 0.95);
    g.stroke();
  }

  // The two straight edges, so the wedge has a shape when the rim is off the
  // side of the screen.
  g.globalAlpha = 0.26 + 0.16 * band.weight;
  g.lineWidth = 1.2;
  for (const sign of [-1, 1]) {
    const ca = Math.cos(half * sign);
    const sa = Math.sin(half * sign);
    g.beginPath();
    g.moveTo(ax + ca * WEDGE_UNIT_R * 0.24, ay + sa * WEDGE_UNIT_R * 0.24);
    g.lineTo(ax + ca * WEDGE_UNIT_R, ay + sa * WEDGE_UNIT_R);
    g.stroke();
  }

  // The rim: the leading edge, and the one line that states what is about to
  // die. It is the brightest thing baked here, because everything else in the
  // wedge is context and this is the boundary. Inset by half its width so its
  // *outer* pixel lands on the reach rather than a pixel and a half beyond it.
  const rimW = 2 + 1.6 * band.weight;
  g.globalAlpha = 1;
  g.shadowColor = band.colour;
  g.shadowBlur = 4 + 5 * band.weight;
  g.lineWidth = rimW;
  g.beginPath();
  g.arc(ax, ay, WEDGE_UNIT_R - rimW / 2, -half, half);
  g.stroke();
  g.shadowBlur = 0;
}

/**
 * The wedge canvas for a band and a half-angle, in front of {@link stamps}.
 *
 * A one-entry front cache, and the reason it exists is allocation rather than
 * lookup cost: the key template and the painter closure below both allocate,
 * and past this guard neither runs at all on the frames that matter. A dash
 * holds one band and one arc for its whole life, so it misses once.
 *
 * Two knights dashing at different holds in the same frame would miss twice a
 * frame and pay the two allocations back — degraded, never wrong, because
 * {@link stamps} still owns the canvases and is keyed on the same pair.
 */
let wedgeBand: CommitBand | null = null;
let wedgeHalf = -1;
let wedgeCanvas: HTMLCanvasElement | null = null;

function wedgeStamp(band: CommitBand, half: number): HTMLCanvasElement {
  if (wedgeCanvas !== null && wedgeBand === band && wedgeHalf === half) return wedgeCanvas;
  const w = WEDGE_UNIT_R + WEDGE_PAD * 2;
  const h = Math.ceil(2 * WEDGE_UNIT_R * Math.sin(half)) + WEDGE_PAD * 2;
  wedgeCanvas = stamps.get(`knight-wedge|${band.colour}|${half}`, w, h, (g, gw, gh) =>
    bakeWedge(g, gw, gh, band, half),
  );
  wedgeBand = band;
  wedgeHalf = half;
  return wedgeCanvas;
}

/** Plate, from the knight's own palette: the smear is his armour moving, so it
 * is painted in what his armour is painted in. */
const PLATE_HI = '#C4CEE2';
const PLATE = '#3A4258';
const PLATE_GONE = 'rgba(32,36,46,0)';

/** How far behind him the smear reaches, how far it overhangs in front, and
 * how tall it is. Body-sized, all of it — the smear is the knight travelling,
 * not the weapon reaching, so unlike the wedge it does not scale with reach. */
const SMEAR_BACK = 62;
const SMEAR_FRONT = 6;
const SMEAR_HALF_H = 16;
const SMEAR_PAD = 8;
const SMEAR_W = SMEAR_BACK + SMEAR_FRONT + SMEAR_PAD * 2;
const SMEAR_H = SMEAR_HALF_H * 2 + SMEAR_PAD * 2;

/** Where the knight sits inside that canvas, along its length. */
const SMEAR_ANCHOR_X = SMEAR_BACK + SMEAR_PAD;

/** One streak of the smear: across the heading, how thick, how solid, and how
 * far back it runs. Uneven on purpose — five identical bars are a barcode. */
interface SmearStreak {
  readonly y: number;
  readonly h: number;
  readonly a: number;
  readonly len: number;
}

const SMEAR_STREAKS: readonly SmearStreak[] = [
  { y: -11, h: 2.2, a: 0.45, len: 0.62 },
  { y: -6, h: 3.4, a: 0.8, len: 0.94 },
  { y: -1, h: 4.4, a: 1.0, len: 0.82 },
  { y: 4, h: 3.0, a: 0.78, len: 1.0 },
  { y: 9, h: 2.0, a: 0.42, len: 0.7 },
];

/**
 * Bakes the motion smear once, in steel.
 *
 * One linear gradient does all five streaks; `globalAlpha` multiplies it, so
 * the per-streak solidity costs nothing beyond a state write.
 */
const SMEAR_PAINTER: StampPainter = (g, _w, h) => {
  const ax = SMEAR_ANCHOR_X;
  const ay = h / 2;
  const grad = g.createLinearGradient(ax, 0, ax - SMEAR_BACK, 0);
  grad.addColorStop(0, PLATE_HI);
  grad.addColorStop(0.32, PLATE);
  grad.addColorStop(1, PLATE_GONE);
  g.fillStyle = grad;
  for (const s of SMEAR_STREAKS) {
    g.globalAlpha = s.a;
    g.fillRect(ax - SMEAR_BACK * s.len, ay + s.y - s.h / 2, SMEAR_BACK * s.len + SMEAR_FRONT, s.h);
  }
  g.globalAlpha = 1;
};

const SMEAR_KEY = 'knight-smear';

function smearStamp(): HTMLCanvasElement {
  return stamps.get(SMEAR_KEY, SMEAR_W, SMEAR_H, SMEAR_PAINTER);
}

/** No fade in — he is already at full speed when the key comes up — and a
 * short one out, so the wedge does not simply vanish off the last enemy. */
const DASH_RAMP_OUT = 0.18;

/** How solid the smear behind him gets. */
const SMEAR_ALPHA = 0.72;

/**
 * How much of the arc the slash smears over, as a fraction of the whole.
 *
 * The blade crosses the wedge once per 0.2 s damage tick, which is 5 Hz — far
 * too fast for an eye to resolve an instant. Drawing the instant is what the
 * inline version did, and a straight radial bar at that speed is a laser: the
 * first render of this came back with a lightsaber in it. What an eye actually
 * gets at 5 Hz is the smear, so the smear is what is drawn.
 */
const SLASH_SPAN = 0.6;

/** How deep the crescent bites in from the rim at its thickest, as a fraction
 * of reach. It tapers to nothing at the tail, which is what points it. */
const SLASH_DEPTH = 0.24;

/** Segments per side of the crescent. Nine is where the outer edge stopped
 * looking faceted at 90 px. */
const SLASH_STEPS = 9;

/** The lit edge on the near side of the slash. Without it the crescent is a
 * flat band of whatever the commitment band is. */
const BLADE_CORE = '#FFF3C4';

/** Grit kicked off the boots. Fewer than the whirlwind's: this lasts 1.5 s and
 * has a smear behind it already. */
const DASH_GRIT_COUNT = 7;
const DASH_GRIT_HZ = 5.5;
const DASH_GRIT_NEAR = 5;
const DASH_GRIT_REACH = 34;
const DASH_GRIT_SPREAD = 9;
const DASH_GRIT_ALPHA = 0.85;
const DASH_GRIT_S0 = 0.4;
const DASH_GRIT_S1 = 1.0;

/**
 * How far below the origin the grit is thrown from.
 *
 * The sprite's origin is the ground between his feet and the body runs up from
 * there, so grit at 0 comes off his shins. `drawKnight` puts the ground shadow
 * at y 14; this sits just inside it, which is where boots meet floor.
 */
const DASH_GRIT_FOOT_Y = 10;

/** Fade off `progress`. Zero outside the dash, and zero on NaN. */
function dashEnvelope(progress: number): number {
  if (!(progress >= 0) || progress > 1) return 0;
  return Math.min(1, (1 - progress) / DASH_RAMP_OUT);
}

/**
 * Paints one frame of the dash: smear, grit, wedge, blade.
 *
 * Saves and restores the context. Call it *outside* the knight's
 * `scale(facing, 1)` — `p.angle` is a world angle and needs no `mirrorAngle`.
 */
export function paintChargeDash(ctx: CanvasRenderingContext2D, p: ChargeDashPose): void {
  const alpha = dashEnvelope(p.progress);
  if (alpha <= 0) return;

  const band = commitBand(p.frac);
  const half = p.arc / 2;
  const reach = p.radius / WEDGE_UNIT_R;

  ctx.save();
  ctx.translate(p.x, p.y);

  // Smear first, because behind is under. Scale 1: this is the body's size,
  // not the weapon's.
  const smear = smearStamp();
  blitHeading(ctx, smear, p.angle, 1, SMEAR_ANCHOR_X, smear.height / 2, alpha * SMEAR_ALPHA);

  // Grit, in screen space rather than heading space so it can sit at boot
  // height whichever way he is running.
  paintDashGrit(ctx, p, alpha);

  // The wedge. Alpha still climbs continuously with the hold, so the three
  // baked weights read as a ramp rather than as three states — and it stays
  // under the blade, which is the part a player is actually tracking.
  const wedge = wedgeStamp(band, quantiseHalf(half));
  blitHeading(
    ctx,
    wedge,
    p.angle,
    reach,
    WEDGE_PAD,
    wedge.height / 2,
    clamp01(alpha * (0.42 + 0.35 * p.frac)),
  );

  // The blade crossing it. From here on the frame is heading space: +x is the
  // direction he is running.
  ctx.rotate(p.angle);
  paintDashBlade(ctx, p, band, half, alpha);

  ctx.restore();
}

/**
 * The slash: one crescent crossing the wedge per damage tick, thickest at the
 * blade and tapering back down the arc it has already crossed.
 *
 * Its tail is clamped to the wedge's own edge, so nothing about the swing ever
 * appears outside the shape `inKnightArc` tests. Expects the context to be
 * translated to the knight and rotated onto his heading, and uses the pose's
 * true half-angle rather than the cache's quantised one: this is the part a
 * player tracks, and being exact here costs nothing.
 */
function paintDashBlade(
  ctx: CanvasRenderingContext2D,
  p: ChargeDashPose,
  band: CommitBand,
  half: number,
  alpha: number,
): void {
  const sweep = p.tick >= 0 && p.tick <= 1 ? p.tick : 0;
  // Where the steel is right now, and where this tick's crossing began.
  const lead = -half + sweep * half * 2;
  const tail = Math.max(-half, lead - half * 2 * SLASH_SPAN);
  if (tail >= lead) return;

  ctx.globalAlpha = clamp01(alpha * (0.48 + 0.27 * p.frac));
  ctx.fillStyle = band.colour;
  ctx.beginPath();
  // Out along the rim from the blade back to the tail...
  for (let i = 0; i <= SLASH_STEPS; i++) {
    const t = i / SLASH_STEPS;
    const ang = lead + (tail - lead) * t;
    const x = Math.cos(ang) * p.radius;
    const y = Math.sin(ang) * p.radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  // ...and back along the inner edge, which closes on the rim at the tail so
  // the crescent comes to a point rather than ending in a blunt cut.
  for (let i = SLASH_STEPS; i >= 0; i--) {
    const t = i / SLASH_STEPS;
    const ang = lead + (tail - lead) * t;
    const rr = p.radius * (1 - SLASH_DEPTH * (1 - t) ** 1.4);
    ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();

  // The steel itself: the near edge of the crescent, at the one angle the
  // blade actually occupies this instant.
  const ca = Math.cos(lead);
  const sa = Math.sin(lead);
  ctx.globalAlpha = clamp01(alpha * 0.85);
  ctx.strokeStyle = BLADE_CORE;
  ctx.lineWidth = 1.2 + 0.8 * p.frac;
  ctx.beginPath();
  ctx.moveTo(ca * p.radius * (1 - SLASH_DEPTH), sa * p.radius * (1 - SLASH_DEPTH));
  ctx.lineTo(ca * p.radius, sa * p.radius);
  ctx.stroke();
}

/**
 * Dust off the boots, trailing behind the heading.
 *
 * Deliberately drawn before the rotation and rotated by hand, because the drop
 * to boot height is a *screen*-space offset: grit is thrown off the floor, and
 * in a frame rotated onto the heading a downward offset would swing round with
 * him and end up above his head half the time.
 */
function paintDashGrit(ctx: CanvasRenderingContext2D, p: ChargeDashPose, alpha: number): void {
  const grit = gritStamp();
  const ca = Math.cos(p.angle);
  const sa = Math.sin(p.angle);
  for (let i = 0; i < DASH_GRIT_COUNT; i++) {
    const seed = frac1(i * SEED_STEP);
    const life = frac1(p.progress * DASH_GRIT_HZ + seed);
    const back = DASH_GRIT_NEAR + life * DASH_GRIT_REACH;
    const side = (seed * 2 - 1) * DASH_GRIT_SPREAD * (0.35 + life);
    const s = DASH_GRIT_S1 - (DASH_GRIT_S1 - DASH_GRIT_S0) * life;
    const dw = grit.width * s;
    const dh = grit.height * s;
    const gx = -ca * back - sa * side;
    const gy = -sa * back + ca * side + DASH_GRIT_FOOT_Y;
    ctx.globalAlpha = clamp01(alpha * (1 - life) * DASH_GRIT_ALPHA);
    ctx.drawImage(grit, gx - dw / 2, gy - dh / 2, dw, dh);
  }
}

// ── Blitting ────────────────────────────────────────────────────────────────

/**
 * Draws a square stamp centred on the current origin, spun by `angle`.
 *
 * `size` is the drawn width; `drawImage` does the scaling, so the canvas is
 * baked once at {@link VORTEX_UNIT_R} and the drawn reach still lands exactly
 * where the pose says.
 */
function blitSpun(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  angle: number,
  size: number,
  alpha: number,
): void {
  const a = clamp01(alpha);
  if (a <= 0) return;
  ctx.save();
  ctx.rotate(angle);
  ctx.globalAlpha = a;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/**
 * Draws a stamp authored in heading space — +x forward, with the cell at
 * (`anchorX`, `anchorY`) sitting on the current origin — rotated onto `angle`
 * and scaled by `scale`.
 */
function blitHeading(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  angle: number,
  scale: number,
  anchorX: number,
  anchorY: number,
  alpha: number,
): void {
  const a = clamp01(alpha);
  if (a <= 0) return;
  ctx.save();
  ctx.rotate(angle);
  ctx.globalAlpha = a;
  ctx.drawImage(
    img,
    -anchorX * scale,
    -anchorY * scale,
    img.width * scale,
    img.height * scale,
  );
  ctx.restore();
}
