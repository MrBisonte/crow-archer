/**
 * The ranger's two thrown tools, painted live: the satchel charge and the net.
 *
 * Both are world objects rather than parts of a body, so unlike
 * `paintArcherBow` and `paintWizardStaff` each one translates to its own
 * position instead of inheriting the caller's body transform. The caller
 * passes world coordinates already carrying whatever offset that surface uses
 * — in the legacy renderer that is `s.y + CONFIG.hudHeight`.
 *
 * Neither painter knows a single sim number. The satchel is handed its state
 * and its fuse, the net is handed the radius that actually catches things, and
 * every dimension below is a proportion of what arrived. That is deliberate:
 * `netRadiusMin`/`netRadiusMax` and `satchelArmFuse` are balance dials, and a
 * painter that hardcoded them would quietly disagree with the sim the first
 * time one moved.
 *
 * ## Why there are no gradients and no `shadowBlur` here
 *
 * A `createRadialGradient` per frame allocates, and a `shadowBlur` fill is a
 * full raster pass — the pair of them are what made dense particle frames
 * stall, which is the whole reason `src/render/stamps.ts` exists. Every glow
 * in this file is a cached canvas blitted with one `drawImage`, and the paint
 * calls allocate nothing at all: no closures, no template-literal keys, no
 * array literals. See `bakeNet` for why the painters are module-level
 * constants rather than the closures the rest of the codebase uses.
 */

import { stamps, type StampPainter } from './stamps';

/** Clamps to 0..1. Poses arrive from sim timers that can overshoot a frame. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * A stable 0..1 from an integer.
 *
 * The net's fray pattern is hashed rather than randomised so a stamp baked
 * today is identical to one baked next run. That keeps the cache meaningful
 * and lets `_design/fingerprint.mts` prove a refactor changed nothing.
 */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ── Shared palette ───────────────────────────────────────────────────────────

/** Satchel leather, and the net's rim weights: it is one kit, one hide. */
const LEATHER = '#5A4A2A';
const LEATHER_DARK = '#3E3218';
const LEATHER_FLAP = '#4A3C1E';
/** Brass, lit and dull. A dead satchel's buckle does not catch the light. */
const BRASS = '#B08A2E';
const BRASS_DULL = '#7A6030';
/** Team trim. Two of the net's twelve weights carry it; the satchel's does. */
const TRIM = '#FFCC00';
/** Char left on the fuse right under the ember. */
const CHAR = '#2A2218';

// ── Urgency tiers ────────────────────────────────────────────────────────────

/**
 * Seconds remaining at which the armed satchel changes tone.
 *
 * These are dynamite's existing thresholds, not new ones. Two explosives that
 * both count down and disagree about when "nearly" starts teach the player
 * nothing, so the satchel keeps dynamite's 1.0 s and 0.5 s steps and only
 * changes what it does with them.
 */
const TIER_HOT = 1.0;
const TIER_CRITICAL = 0.5;

/** 0 = calm, 1 = hot, 2 = critical. Indexes every tiered table below. */
function tierOf(secsLeft: number): number {
  if (secsLeft <= TIER_CRITICAL) return 2;
  if (secsLeft <= TIER_HOT) return 1;
  return 0;
}

/** The armed bag's body and lit face, warming as the fuse runs out. */
const ARMED_BODY = ['#5A4A2A', '#6B5526', '#8A6A28'] as const;
const ARMED_FACE = ['#7A6436', '#8E7130', '#B08A2E'] as const;
/** The ember and the countdown share one tier colour, so they read as one. */
const HEAT = ['#FFCC00', '#FFB400', '#FFFFFF'] as const;

// ── Ember stamp ──────────────────────────────────────────────────────────────

/**
 * The ember is baked at one size and scaled by `drawImage`.
 *
 * A pulsing radius would be a fresh cache key every few frames. Scaling a blur
 * is indistinguishable from re-blurring it at this size, so three stamps — one
 * per heat tier — cover every satchel on the field for the run.
 */
const EMBER_R = 3;
const EMBER_BLUR = 7;
const EMBER_SIZE = (EMBER_R + EMBER_BLUR * 2 + 2) * 2;
const EMBER_KEYS = ['ranger|ember|0', 'ranger|ember|1', 'ranger|ember|2'] as const;

/**
 * Which tier `bakeEmber` is about to paint.
 *
 * A module-level slot, not a closure argument: `StampCache.get` takes its
 * painter by value on *every* call, hit or miss, so `stamps.get(k, w, h, (g) =>
 * ...)` allocates a closure per satchel per frame — precisely the per-frame
 * garbage the cache was built to remove. Safe because `get` calls the painter
 * synchronously before returning.
 */
let bakeEmberTier = 0;

const bakeEmber: StampPainter = (g, w, h) => {
  const c = HEAT[bakeEmberTier] ?? HEAT[0];
  g.shadowColor = c;
  g.shadowBlur = EMBER_BLUR;
  g.fillStyle = c;
  g.beginPath();
  g.arc(w / 2, h / 2, EMBER_R, 0, Math.PI * 2);
  g.fill();
  // A white core inside the coloured halo, so even the calm tier reads as a
  // live coal rather than a yellow dot.
  g.shadowBlur = 0;
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(w / 2, h / 2, EMBER_R * 0.45, 0, Math.PI * 2);
  g.fill();
};

function emberStamp(tier: number): HTMLCanvasElement {
  bakeEmberTier = tier;
  return stamps.get(EMBER_KEYS[tier] ?? EMBER_KEYS[0], EMBER_SIZE, EMBER_SIZE, bakeEmber);
}

// ── Satchel ──────────────────────────────────────────────────────────────────

/**
 * Which of the satchel's two lives it is in.
 *
 * The states are the whole ability: a thrown satchel sits inert for up to
 * `satchelIdleLife`, and a *second* click on the same one arms it. Since the
 * click that arms it is the same click that would otherwise throw another,
 * mistaking one for the other costs the player a charge and a limb. The two
 * are therefore separated by silhouette before they are separated by colour —
 * inert is wider than it is tall, armed is taller than it is wide — so they
 * stay distinguishable through a hit flash, a dark map, or colour blindness.
 */
export type SatchelState = 'inert' | 'armed';

/** Everything a satchel needs to draw itself. */
export interface SatchelPose {
  /** World x. */
  readonly x: number;
  /** World y, with the surface's own offset already applied. */
  readonly y: number;
  /** Inert until a second click arms it. See `SatchelState`. */
  readonly state: SatchelState;
  /**
   * Tumble in radians — the sim's `s.angle`, which stops advancing once the
   * bag comes to rest. Only the bag turns: its ground shadow, its ember and
   * its countdown stay level, because a shadow that rolls is not a shadow and
   * an upside-down numeral is not a readout.
   */
  readonly angle: number;
  /**
   * Fuse remaining as a fraction, 0..1. Ignored while inert.
   *
   * Drives the cord's length and the ember's blink rate — the countdown is the
   * art, not a number stuck next to it.
   */
  readonly fuse: number;
  /**
   * The same countdown in seconds. Ignored while inert.
   *
   * Both units are carried because the painter needs both and neither can be
   * derived from the other here: the fraction sets the cord length, and only
   * the absolute seconds can pick a tier or print a digit. Deriving one would
   * mean hardcoding `satchelArmFuse`, which is a balance dial.
   */
  readonly fuseSecs: number;
  /**
   * Blast radius for the warning ring, or null to omit it.
   *
   * Null rather than zero, following `StaffPose.cooldown`: a surface with no
   * blast figure to report says so, instead of asking for a ring of nothing.
   */
  readonly blast: number | null;
  /** Seconds, monotonic — the game's `loopT`. Drives the ember and the ring. */
  readonly t: number;
}

/** Length of the fuse cord at a full fuse, in world px. */
const CORD = 13;
/** Dash pattern for the blast ring, hoisted: an array literal per frame is
 *  garbage, and `setLineDash` copies rather than retains, so one is enough. */
const RING_DASH: number[] = [5, 5];
/** Countdown face. Hoisted so the assignment is not a fresh string each frame. */
const COUNT_FONT = 'bold 10px monospace';
/** Digits, so the readout never calls `String()` or a template literal. */
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Paints one satchel at its own position.
 *
 * Wrapped in its own save/restore because it translates, rotates and sets a
 * line dash; the caller gets its context back exactly as it lent it.
 */
export function paintSatchel(ctx: CanvasRenderingContext2D, p: SatchelPose): void {
  const armed = p.state === 'armed';
  const fuse = armed ? clamp01(p.fuse) : 1;
  const tier = armed ? tierOf(p.fuseSecs) : 0;

  // The one clock everything urgent runs on. It starts near a heartbeat and
  // ends near a buzz, which is the countdown a player feels before reading it.
  const rate = 7 + 27 * (1 - fuse);
  const pulse = armed ? 0.5 + 0.5 * Math.sin(p.t * rate) : 0;

  ctx.save();
  ctx.translate(p.x, p.y);

  if (armed && p.blast !== null) {
    // The reach, dashed and faint. It crawls and brightens with the pulse, so
    // the ring is part of the countdown rather than a static decal.
    //
    // Its own save/restore, not a `setLineDash([])` afterwards: clearing a
    // dash costs an empty array literal every frame, and a dash left set would
    // otherwise turn the strap, the fuse cord and the char into dotted lines.
    ctx.save();
    ctx.globalAlpha = 0.1 + 0.12 * pulse;
    ctx.strokeStyle = tier === 2 ? HEAT[2] : TRIM;
    ctx.lineWidth = 1;
    ctx.setLineDash(RING_DASH);
    ctx.lineDashOffset = -p.t * (8 + 40 * (1 - fuse));
    ctx.beginPath();
    ctx.arc(0, 0, p.blast, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Ground shadow, level and unrotated. Wide and flat under a bag lying on its
  // side; tight under one standing up. The shadow alone tells the two apart.
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  if (armed) ctx.ellipse(0, 8, 9, 2.6, 0, 0, Math.PI * 2);
  else ctx.ellipse(0, 6, 12, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(p.angle);
  if (armed) paintArmedBag(ctx, fuse, tier, pulse);
  else paintInertBag(ctx);
  ctx.rotate(-p.angle);

  if (armed) {
    // Level again for the readout: the tumble is the bag's, not the player's.
    const heat = HEAT[tier] ?? HEAT[0];
    const n = Math.max(1, Math.min(9, Math.ceil(p.fuseSecs)));
    ctx.font = COUNT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Drawn twice rather than blurred: a `shadowBlur` on text is a raster pass
    // per satchel per frame, and a hard dark backing is crisper at this size.
    ctx.fillStyle = CHAR;
    ctx.fillText(DIGITS[n] ?? '', 1, -24 + 1);
    ctx.fillStyle = heat;
    ctx.fillText(DIGITS[n] ?? '', 0, -24);
  }

  ctx.restore();
}

/**
 * The thrown-but-unarmed bag: slumped, closed, and going nowhere.
 *
 * It has to look *put down*. It is wider than it is tall, its top sags between
 * its shoulders, its flap is shut over the front, its buckle is dull brass
 * with no light on it, and a loop of strap lies slack on the ground beside it.
 * Nothing here pulses, glows, or moves. That is the point: this thing can sit
 * for a full minute and the player should feel entitled to ignore it.
 */
function paintInertBag(ctx: CanvasRenderingContext2D): void {
  // Slack strap first, so the bag lies on top of its own strap. It runs out
  // from under the buckle band and loops on the ground — dropped, not carried.
  ctx.strokeStyle = LEATHER_DARK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-7, -3);
  ctx.quadraticCurveTo(-17, 0, -13.5, 5);
  ctx.quadraticCurveTo(-9.5, 8.5, -4.5, 5.5);
  ctx.stroke();

  // Body, wide and low, sagging between its ends.
  ctx.fillStyle = LEATHER_DARK;
  ctx.beginPath();
  ctx.moveTo(-11.5, 1);
  ctx.quadraticCurveTo(-11.5, -3.5, -7, -4);
  ctx.quadraticCurveTo(-2, -1.5, 3, -3.2);
  ctx.quadraticCurveTo(8, -4.2, 11.5, -1);
  ctx.quadraticCurveTo(12, 3.5, 10, 7);
  ctx.quadraticCurveTo(5, 9, 0, 9);
  ctx.quadraticCurveTo(-6, 9, -11.5, 5);
  ctx.closePath();
  ctx.fill();

  // The upper face, the only part catching light, biased to the upper-left the
  // way the staff's lit edge is. Inset, so the dark body reads as a rim all the
  // way round rather than as a shadow on one side.
  ctx.fillStyle = LEATHER;
  ctx.beginPath();
  ctx.moveTo(-10, 0.5);
  ctx.quadraticCurveTo(-10, -2.8, -6.5, -3.2);
  ctx.quadraticCurveTo(-2, -1, 2.5, -2.4);
  ctx.quadraticCurveTo(6, -3, 8, -1.5);
  ctx.quadraticCurveTo(4, 2.5, -3, 3);
  ctx.quadraticCurveTo(-8, 3, -10, 0.5);
  ctx.closePath();
  ctx.fill();

  // Flap, shut over the far end and much darker than the body. The value step
  // is the point: at this size a flap only two shades off the hide is a smudge,
  // and the bag stops reading as a bag at all.
  ctx.fillStyle = '#2A2210';
  ctx.beginPath();
  ctx.moveTo(2.2, -2.8);
  ctx.quadraticCurveTo(7, -4.2, 11.3, -1);
  ctx.quadraticCurveTo(11.8, 3.5, 9.8, 6.9);
  ctx.quadraticCurveTo(6, 8.6, 2.8, 8);
  ctx.closePath();
  ctx.fill();
  // A lit line down the fold, which is what makes the flap sit above the body
  // rather than being a hole cut in it.
  ctx.strokeStyle = LEATHER_FLAP;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(2.4, -2.6);
  ctx.lineTo(2.9, 7.9);
  ctx.stroke();

  // Buckle band across the flap, and the buckle itself: dull, unlit brass.
  // Brass with no light on it is just metal, which is the whole read here.
  ctx.fillStyle = '#241D0E';
  ctx.beginPath();
  ctx.moveTo(5.4, -3.7);
  ctx.lineTo(8.8, -3.1);
  ctx.lineTo(8.1, 8.2);
  ctx.lineTo(4.9, 8.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BRASS_DULL;
  ctx.fillRect(5.1, 1.2, 3.6, 3);
  ctx.fillStyle = '#241D0E';
  ctx.fillRect(6.3, 2, 1.2, 1.4);
}

/**
 * The armed bag: standing, cinched, and burning down.
 *
 * Every difference from the inert bag points the same way. It is taller than
 * it is wide instead of the reverse, so the silhouette alone separates them.
 * Its flap is open and its brass is lit. A fuse cord stands out of the neck
 * and gets *shorter* every frame — the countdown is a physical length, so it
 * is legible at a glance and from across the map — and the ember on its tip
 * blinks faster as the length runs out.
 */
function paintArmedBag(
  ctx: CanvasRenderingContext2D,
  fuse: number,
  tier: number,
  pulse: number,
): void {
  const body = ARMED_BODY[tier] ?? ARMED_BODY[0];
  const face = ARMED_FACE[tier] ?? ARMED_FACE[0];
  const heat = HEAT[tier] ?? HEAT[0];

  // The flap, thrown back off the mouth and hanging down the far side. Drawn
  // first so the body overlaps it. This is the single clearest "this one has
  // been opened and worked on" cue, and it also breaks the symmetry that
  // otherwise makes an upright pouch read as a pot.
  // It hugs the wall rather than arcing away from it: a flap with daylight
  // between it and the bag stops being a flap and becomes a mug handle.
  ctx.fillStyle = LEATHER_FLAP;
  ctx.beginPath();
  ctx.moveTo(-8.5, -7.4);
  ctx.lineTo(-12.4, -8.6);
  ctx.quadraticCurveTo(-13.5, -5.4, -12.6, -2);
  ctx.lineTo(-8.8, -1.2);
  ctx.quadraticCurveTo(-9.4, -4.6, -8.5, -7.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LEATHER_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12.4, -8.6);
  ctx.quadraticCurveTo(-13.5, -5.4, -12.6, -2);
  ctx.stroke();

  // Body: a tapered sack on a flat bottom, not a round one. Straight sides and
  // square corners are what keep it the same object as the bag lying inert two
  // metres away — a player has to recognise it before reading the fuse.
  ctx.fillStyle = LEATHER_DARK;
  ctx.beginPath();
  ctx.moveTo(-9, -7);
  ctx.lineTo(9, -7);
  ctx.lineTo(7.8, 5);
  ctx.quadraticCurveTo(7.8, 8.8, 4, 8.8);
  ctx.lineTo(-4, 8.8);
  ctx.quadraticCurveTo(-7.8, 8.8, -7.8, 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-7.6, -5.4);
  ctx.lineTo(7.6, -5.4);
  ctx.lineTo(6.5, 5);
  ctx.quadraticCurveTo(6.5, 7.4, 3.4, 7.4);
  ctx.lineTo(-3.4, 7.4);
  ctx.quadraticCurveTo(-6.5, 7.4, -6.5, 5);
  ctx.closePath();
  ctx.fill();

  // Lit face down the left, which is where the map's light comes from.
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.moveTo(-7.6, -5.4);
  ctx.lineTo(-3.8, -5.4);
  ctx.lineTo(-4.8, 7.4);
  ctx.lineTo(-6.5, 7.4);
  ctx.quadraticCurveTo(-6.5, 5, -6.5, 5);
  ctx.closePath();
  ctx.fill();

  // The open mouth, and the brass eyelets the cinch cord runs through. Lit
  // brass, because this bag is open and being worked.
  ctx.fillStyle = '#241D0E';
  ctx.beginPath();
  ctx.moveTo(-9, -7);
  ctx.lineTo(9, -7);
  ctx.lineTo(7.7, -4.4);
  ctx.lineTo(-7.7, -4.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BRASS;
  ctx.fillRect(-6.2, -6.6, 2, 1.7);
  ctx.fillRect(-1, -6.6, 2, 1.7);
  ctx.fillRect(4.2, -6.6, 2, 1.7);

  // The same buckle band the inert bag carries, so the two are one object.
  // Here the trim is lit rather than dull.
  ctx.fillStyle = '#241D0E';
  ctx.beginPath();
  ctx.moveTo(1.3, -5.2);
  ctx.lineTo(4.7, -5.2);
  ctx.lineTo(4.2, 7.3);
  ctx.lineTo(1, 7.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BRASS;
  ctx.fillRect(1.1, 1.2, 3.7, 3.1);
  ctx.fillStyle = TRIM;
  ctx.fillRect(2.1, 2, 1.7, 1.5);

  // Fuse cord, curling up out of the neck. Its length *is* the fuse.
  const len = CORD * fuse;
  if (len > 0.6) {
    const tipX = 3.2 * fuse;
    const tipY = -6 - len;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#C8B48A';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.quadraticCurveTo(-2.2, -6 - len * 0.55, tipX, tipY);
    ctx.stroke();
    // Char at the burn point, so the cord is being consumed rather than
    // retracting. Two pixels, but it is the difference.
    ctx.strokeStyle = CHAR;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tipX * 0.8, tipY + 2.4);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    paintEmber(ctx, tipX, tipY, tier, pulse);
  } else {
    // Cord gone. The ember is in the mouth now, and that is the last warning.
    paintEmber(ctx, 0, -6, tier, pulse);
  }

  // Heat spilling out of the mouth once it is critical: the charge inside is
  // going, not just the cord on top of it.
  if (tier === 2) {
    ctx.globalAlpha = 0.35 + 0.45 * pulse;
    ctx.strokeStyle = heat;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-7.4, -4.6);
    ctx.lineTo(7.4, -4.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Blits the cached ember, sized by the pulse. One `drawImage`, no blur pass. */
function paintEmber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tier: number,
  pulse: number,
): void {
  const s = emberStamp(tier);
  const scale = (1.5 + 1.5 * pulse) / EMBER_R;
  const d = EMBER_SIZE * scale;
  ctx.drawImage(s, x - d / 2, y - d / 2, d, d);
}

// ── Net ──────────────────────────────────────────────────────────────────────

/** Everything a net lying on the ground needs to draw itself. */
export interface NetPose {
  /** World x of the net's centre. */
  readonly x: number;
  /** World y, with the surface's own offset already applied. */
  readonly y: number;
  /**
   * The radius that actually caught things — `n.radius`, straight from the
   * sim. It is drawn at this radius and not a decorative multiple of it: the
   * net's only job is to say what is held, and art that overstates the reach
   * is art that lies about the mechanic.
   */
  readonly radius: number;
  /**
   * How far through its hold, 0 at the moment it lands and 1 at release.
   *
   * The mesh frays as this rises, so the player watches the hold end instead
   * of being surprised by it.
   */
  readonly age: number;
}

/**
 * Strand spacing in world px. Constant, so a wide net has more cells rather
 * than bigger ones — the mesh is the same mesh, there is just more of it.
 *
 * Wide on purpose. At 7 px the lattice closed into a pale doily that covered
 * everything under it, which is the opposite of what this effect is for: the
 * net's whole job is to say *what is held*, so the things it holds have to
 * stay visible through it.
 */
const NET_MESH = 13;
/** How far the middle of the mesh dips. A net lying flat is a painted circle. */
const NET_SAG = 4.5;
/** Room for the rim weights sitting proud of the hem. */
const NET_PAD = 5;

/**
 * How many wear stages are baked.
 *
 * Three, cross-faded: whole, worn, failing. The strands each stage drops are a
 * strict subset of the last, so a cross-fade dissolves individual strands
 * rather than washing out the whole mesh — which is what makes it read as
 * fraying instead of fading.
 */
const WEAR_STAGES = 3;

/**
 * Radius bucketing.
 *
 * `netRadiusMin`..`netRadiusMax` is 34..70, a continuous range off a
 * continuous draw, so one stamp per exact radius is an unbounded cache — a
 * leak with a nice name. Buckets are 6 px and the blit is scaled to the true
 * radius, which is at most a 9% stretch of a hemp texture and invisible, while
 * the drawn circle still matches the circle that caught things. `BUCKET_MIN`
 * and `BUCKET_MAX` bracket the config range with headroom and clamp anything
 * outside it, so a future balance change costs blur, never memory.
 */
const BUCKET_STEP = 6;
const BUCKET_MIN = 5;
const BUCKET_MAX = 13;

/** Rope, lit over shadowed. The lit tone is `#E8E0C0`, the same hemp the
 *  in-flight net and the held markers already use — one net, one colour. */
const ROPE_LIT = '#E8E0C0';
/** A knot catches more light than the strand it ties, or it is not a knot. */
const KNOT = '#FFF6DE';
const ROPE_MID = '#B9AC80';
const ROPE_DARK = '#8A7E58';

/** How many arcs the hem is laid down in, so it can break up with the mesh. */
const HEM_SEGS = 28;
/** How many weights hang on the hem, and how often one carries team trim. */
const WEIGHTS = 12;
const TRIM_EVERY = 6;

/**
 * Stamp keys, built once at module load.
 *
 * A template literal per net per frame is a string allocation per net per
 * frame. There are `(BUCKET_MAX + 1) * WEAR_STAGES` of them and they never
 * change, so they are a table.
 */
const NET_KEYS: readonly string[] = ((): readonly string[] => {
  const out: string[] = [];
  for (let b = 0; b <= BUCKET_MAX; b++)
    for (let s = 0; s < WEAR_STAGES; s++) out.push(`ranger|net|${b * BUCKET_STEP}|${s}`);
  return out;
})();

/** See `bakeEmberTier`: module-level bake parameters, not closure arguments. */
let bakeRadius = 0;
let bakeStage = 0;

/**
 * How far the mesh dips at a point.
 *
 * Zero at the hem and `NET_SAG` at the centre, which leaves the outline a true
 * circle at the true radius while the interior drops into a bowl. That bowl is
 * the whole difference between a mesh lying over the ground and a ring painted
 * on it.
 */
function sagAt(x: number, y: number, r: number): number {
  const d = Math.min(1, Math.hypot(x, y) / r);
  return NET_SAG * (1 - d * d);
}

/**
 * Whether a hem segment or a rim weight is still there at this wear stage.
 *
 * The rim gets its own rule rather than sharing `survives`. That one weights by
 * distance from the centre, and everything on the hem sits at `dNorm === 1`
 * where the distance term contributes nothing — so no rim piece could ever
 * clear the last stage's threshold, and a net that had shed every weight while
 * keeping a perfectly intact bright ring read as a painted circle with litter
 * inside it.
 */
function rimHolds(seed: number, stage: number): boolean {
  return stage === 0 || hash01(seed) > stage * 0.24;
}

/**
 * Whether one strand segment is still there at this wear stage.
 *
 * Weighted toward the hem, so the holes open at the edge and spread inward.
 * That direction is chosen, not incidental: a net that opens at the rim is a
 * net whose grip is slipping, and the player gets to see the release coming
 * from the shape rather than from a timer.
 */
function survives(seed: number, dNorm: number, stage: number): boolean {
  if (stage === 0) return true;
  const strength = hash01(seed) * 0.55 + (1 - dNorm) * 0.45;
  return strength > (stage === 1 ? 0.3 : 0.46);
}

/**
 * Bakes one net at one radius bucket and one wear stage.
 *
 * Allocation here is free — this runs once per key for the life of the page,
 * never in a paint call — so it buys as much detail as it likes: two strand
 * families in different tones so the lattice reads as woven rather than as
 * crosshatch, a knot at every surviving crossing, a hem, and weights.
 */
const bakeNet: StampPainter = (g, w, h) => {
  const r = bakeRadius;
  const stage = bakeStage;
  const cx = w / 2;
  const cy = h / 2;
  const step = NET_MESH / 2;
  const kMax = Math.ceil((r * Math.SQRT2) / NET_MESH);

  g.lineCap = 'round';

  // Two diagonal families. The first is laid down dark and the second light on
  // top of it: an even crosshatch reads as graph paper, and one family lying
  // over the other is what the eye takes for a weave.
  for (let fam = 0; fam < 2; fam++) {
    const dx = Math.SQRT1_2;
    const dy = fam === 0 ? Math.SQRT1_2 : -Math.SQRT1_2;
    const nx = -dy;
    const ny = dx;
    g.lineWidth = fam === 0 ? 1.4 : 1.1;
    for (let k = -kMax; k <= kMax; k++) {
      const o = k * NET_MESH;
      const half = Math.sqrt(Math.max(0, r * r - o * o));
      if (half < step) continue;
      const bx = nx * o;
      const by = ny * o;
      for (let s = -half; s < half; s += step) {
        const s1 = Math.min(half, s + step);
        const ax = bx + dx * s;
        const ay = by + dy * s;
        const ex = bx + dx * s1;
        const ey = by + dy * s1;
        const dNorm = Math.min(1, Math.hypot((ax + ex) / 2, (ay + ey) / 2) / r);
        if (!survives(k * 977 + Math.round(s) * 31 + fam * 7919, dNorm, stage)) continue;
        // Strands down in the dip take the shaded tone. Geometry alone cannot
        // show a bowl from directly above; the value step is what does it.
        g.strokeStyle = fam === 0 ? ROPE_DARK : dNorm < 0.5 ? ROPE_MID : ROPE_LIT;
        g.beginPath();
        g.moveTo(cx + ax, cy + ay + sagAt(ax, ay, r));
        g.lineTo(cx + ex, cy + ey + sagAt(ex, ey, r));
        g.stroke();
      }
    }
  }

  // Knots. At this size the knot is what says "net" rather than "hatching" —
  // it is the one detail the two-tone weave cannot carry on its own.
  //
  // Family A is every point with `y - x = SQRT2 * i * NET_MESH` and family B
  // every point with `y + x = SQRT2 * j * NET_MESH`, so line i meets line j at
  // `x = (j - i) * span`, `y = (i + j) * span` for `span = SQRT2 * NET_MESH /
  // 2`. Those land on a checkerboard by themselves — `(j - i)` and `(i + j)`
  // always share a parity — so there is no parity test to apply. Applying one
  // anyway dropped half the real crossings, and an extra factor of two put the
  // survivors in the middle of the cells instead of on the strands.
  g.fillStyle = KNOT;
  const span = (NET_MESH * Math.SQRT2) / 2;
  for (let i = -kMax; i <= kMax; i++)
    for (let j = -kMax; j <= kMax; j++) {
      const kx = (j - i) * span;
      const ky = (i + j) * span;
      const d = Math.hypot(kx, ky);
      if (d > r - 1) continue;
      if (!survives(i * 5051 + j * 199, d / r, stage)) continue;
      g.beginPath();
      g.arc(cx + kx, cy + ky + sagAt(kx, ky, r), 1.3, 0, Math.PI * 2);
      g.fill();
    }

  // Hem. `sagAt` is zero at the rim, so this traces a true circle at the true
  // radius: the drawn edge is the catching edge.
  //
  // Laid down as arcs rather than as one circle so it can break up along with
  // the mesh it belongs to. The arcs overlap by a hair, so an unworn hem has no
  // seams in it.
  for (let i = 0; i < HEM_SEGS; i++) {
    if (!rimHolds(i * 7717 + 3, stage)) continue;
    const a0 = (i / HEM_SEGS) * Math.PI * 2;
    const a1 = ((i + 1) / HEM_SEGS) * Math.PI * 2 + 0.02;
    g.strokeStyle = ROPE_DARK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.stroke();
    g.strokeStyle = ROPE_LIT;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(cx, cy, r - 0.4, a0, a1);
    g.stroke();
  }

  // Weights, so the hem reads as something thrown and heavy rather than drawn.
  // They go with the mesh as it frays, which keeps the rim from outliving it.
  for (let i = 0; i < WEIGHTS; i++) {
    if (!rimHolds(i * 31337 + 11, stage)) continue;
    const a = (i / WEIGHTS) * Math.PI * 2;
    const wx = cx + Math.cos(a) * r;
    const wy = cy + Math.sin(a) * r;
    g.fillStyle = LEATHER_DARK;
    g.beginPath();
    g.arc(wx, wy, 2.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = i % TRIM_EVERY === 0 ? TRIM : LEATHER;
    g.beginPath();
    g.arc(wx - 0.4, wy - 0.4, 1.5, 0, Math.PI * 2);
    g.fill();
  }
};

function netStamp(bucket: number, stage: number): HTMLCanvasElement {
  bakeRadius = bucket * BUCKET_STEP;
  bakeStage = stage;
  const size = 2 * (bakeRadius + NET_PAD);
  // The index is always in range: `bucket` is clamped to `BUCKET_MIN..
  // BUCKET_MAX` and `stage` to `0..WEAR_STAGES-1` by the only caller. The
  // fallback is the graceful branch, not a real case.
  const key = NET_KEYS[bucket * WEAR_STAGES + stage] ?? NET_KEYS[0] ?? 'ranger|net|fallback';
  return stamps.get(key, size, size, bakeNet);
}

/**
 * Paints one net lying over the ground.
 *
 * Two `drawImage` calls: the next wear stage as the base, and the current one
 * fading over it. Because each stage's strands are a subset of the last, that
 * dissolves the strands that are about to go while everything still holding
 * stays fully opaque — fraying, not fading.
 */
export function paintNet(ctx: CanvasRenderingContext2D, p: NetPose): void {
  const age = clamp01(p.age);

  const stageF = age * (WEAR_STAGES - 1);
  const lo = Math.min(WEAR_STAGES - 1, Math.floor(stageF));
  const hi = Math.min(WEAR_STAGES - 1, lo + 1);
  const blend = stageF - lo;

  const bucket = Math.max(BUCKET_MIN, Math.min(BUCKET_MAX, Math.round(p.radius / BUCKET_STEP)));
  const bakeR = bucket * BUCKET_STEP;

  // It lands slightly wide and snaps down onto the ground over the first
  // fraction of the hold, which is a net settling rather than one appearing.
  const settle = 1 + 0.1 * (1 - Math.min(1, age * 8));
  const scale = ((p.radius + NET_PAD) / (bakeR + NET_PAD)) * settle;
  const d = 2 * (bakeR + NET_PAD) * scale;
  const left = p.x - d / 2;
  const top = p.y - d / 2;

  // A last dip in the closing moments, under the fraying rather than instead
  // of it: the shape says the hold is ending, this only agrees with it.
  const fade = age > 0.85 ? 1 - 0.18 * ((age - 0.85) / 0.15) : 1;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.drawImage(netStamp(bucket, hi), left, top, d, d);
  if (hi !== lo && blend < 0.995) {
    ctx.globalAlpha = fade * (1 - blend);
    ctx.drawImage(netStamp(bucket, lo), left, top, d, d);
  }
  ctx.restore();
}
