/**
 * What an ultimate looks like on the field.
 *
 * WHY THIS FILE EXISTS. Every plain skill on the roster owns a painter —
 * `archer-fx`, `knight-fx`, `wizard-fx`, `ranger-fx`, `explosion` — roughly
 * four thousand lines of layered passes, baked stamps, tick pulses and grit.
 * The ten ultimates had a hundred and sixty-eight lines of inline `ctx` strokes
 * in `game.js` between them, and five of them drew nothing of their own at all:
 * HEADSHOT was a normal arrow with a damage multiplier, and THE BIG ONE was the
 * sapper's own dynamite sprite with a bigger radius. The once-a-minute ability
 * was the weakest-looking thing on screen, and the reason was simply that
 * nobody had drawn it.
 *
 * THE SHARED GRAMMAR. All ten open on {@link paintUltimateCast} — a gold ring
 * snapping out from the hero over a briefly dimmed field. No plain skill does
 * this, so it is learned once and then recognised everywhere, and it is the
 * same gold the ten icons wear on the pick screen: the ability on the field
 * looks like the card it was chosen from. `ULTIMATE_GOLD` is that ramp's one
 * home here, because the icons' own copy is baked into generated character
 * rows in `ultimate-icons.ts` and cannot be imported as named stops.
 *
 * THE HOUSE RULES, KEPT. Ground shapes are squashed by {@link GROUND_SQUASH},
 * the same figure `explosion.ts` gives its splash ring and for the same reason:
 * the world is drawn from above and everything in it from the side, so a true
 * circle on the floor reads as a decal. A reach that the simulation tests
 * against is drawn one pixel wide and left clear of everything else, the way
 * `paintWhirlwind` draws its. Anything expensive enough to be worth caching is
 * cached through `stamps`.
 *
 * WHAT IS NOT HERE. No ability decides anything in this file. Every figure a
 * painter draws is one the simulation has already resolved and hands over in
 * the pose — a reach, a travelled distance, a fuse fraction, the eighteen
 * impact points ARROW RAIN computed. A painter that derived its own would be
 * free to draw a promise the game does not keep.
 */
import { stamps } from './stamps';

/**
 * The ultimate ramp, lightest first.
 *
 * The same five stops the icons' bezel is drawn in. Gold is the ultimates'
 * alone: no plain skill on the roster paints in it, which is what lets a
 * player read "this is the big one" out of colour before they read the shape.
 */
export const ULTIMATE_GOLD = {
  lit: '#FFF3C8',
  bright: '#F0C64A',
  mid: '#C08F18',
  deep: '#7E5A0A',
  dark: '#4A3405',
} as const;

/**
 * How flat a circle drawn on the ground is.
 *
 * `explosion.ts` states the reasoning in full for its splash ring; this is the
 * same number for the same camera, and every ground shape in this file uses it
 * so that a danger ring, a landing ring and a splash all lie in one plane.
 */
export const GROUND_SQUASH = 0.42;

const TAU = Math.PI * 2;

/** Keeps an alpha usable after arithmetic that can overshoot either end. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A ground-plane ellipse, so no caller repeats the squash by hand. */
function groundEllipse(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * GROUND_SQUASH, 0, 0, TAU);
}

// ── The commit beat, shared by all ten ───────────────────────────────────────

/**
 * The instant an ultimate is spent.
 *
 * ```js
 * paintUltimateCast(ctx, {
 *   x: player.x, y: player.y + CONFIG.hudHeight,
 *   age: 1 - ultimateCast.timer / CONFIG.ultimateCastSecs,
 *   w: CONFIG.canvasW, h: CONFIG.canvasH,
 * });
 * ```
 */
export interface UltimateCastPose {
  /** The hero, in the frame the rest of the world is drawn in. */
  readonly x: number;
  /** As `x`. Remember `CONFIG.hudHeight`. */
  readonly y: number;
  /** 0 at the press, 1 as the beat ends. Outside that, nothing is drawn. */
  readonly age: number;
  /** Field width, for the dim. The dim covers the play area, not the HUD. */
  readonly w: number;
  /** Field height, as `w`. */
  readonly h: number;
}

/** How far the ring reaches, in pixels. Past any hero's own body by a margin,
 *  so it reads as the world answering rather than as an aura. */
const CAST_REACH = 108;

/** How dark the field goes behind the ring, and how much of the beat it holds
 *  for. Short: a dim that outstays the ring is a stutter, not a punctuation. */
const CAST_DIM = 0.34;
const CAST_DIM_OUT = 0.55;

/**
 * Paints the cast tell, centred on the hero.
 *
 * Drawn UNDER the ability's own effect and over the field, which is the order
 * that makes it punctuation: the world recedes for a beat and the ability
 * arrives on top of it. The dim is a flat fill rather than a vignette because
 * a vignette reads as damage — the game already uses one for that.
 */
export function paintUltimateCast(ctx: CanvasRenderingContext2D, p: UltimateCastPose): void {
  if (!(p.age >= 0) || p.age >= 1) return;

  ctx.save();
  const dim = p.age < CAST_DIM_OUT ? 1 - p.age / CAST_DIM_OUT : 0;
  if (dim > 0) {
    ctx.globalAlpha = CAST_DIM * dim;
    ctx.fillStyle = '#06030E';
    ctx.fillRect(0, 0, p.w, p.h);
  }

  const fade = 1 - p.age;
  const r = 8 + p.age * CAST_REACH;
  // Three passes, widest and deepest first: the lit core reads as hot because
  // there is something darker either side of it, the same reason THE BEAM is
  // built in passes rather than as one bright stroke.
  for (const [width, colour, alpha] of [
    [3.2, ULTIMATE_GOLD.deep, 0.45],
    [1.8, ULTIMATE_GOLD.bright, 0.9],
    [0.8, ULTIMATE_GOLD.lit, 1],
  ] as const) {
    ctx.globalAlpha = clamp01(fade * alpha);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * (0.4 + fade);
    groundEllipse(ctx, p.x, p.y + 2, r);
    ctx.stroke();
  }

  // Motes riding the ring out. Derived from the index rather than rolled, so
  // the beat is the same picture every time it is spent.
  ctx.globalAlpha = fade;
  ctx.fillStyle = ULTIMATE_GOLD.lit;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.3;
    const rr = r * (0.86 + 0.2 * ((i * 7) % 5) / 5);
    ctx.fillRect(p.x + Math.cos(a) * rr - 1, p.y + 2 + Math.sin(a) * rr * GROUND_SQUASH - 1, 2, 2);
  }
  ctx.restore();
}

// ── The sapper ───────────────────────────────────────────────────────────────

/**
 * One of the sapper's ultimate charges, waiting on its fuse.
 *
 * ```js
 * paintUltimateCharge(ctx, {
 *   x: d.x, y: d.y + CONFIG.hudHeight,
 *   left: d.life / d.fuseTotal,
 *   reach: blastReachPx(d),          // the radius the blast will really use
 *   big: d.ult === 'theBigOne',
 *   t: loopT,
 * });
 * ```
 */
export interface UltimateChargePose {
  /** The charge, in the frame the rest of the world is drawn in. */
  readonly x: number;
  /** As `x`. Remember `CONFIG.hudHeight`. */
  readonly y: number;
  /** Fuse remaining, 1 at the throw and 0 at the blast. */
  readonly left: number;
  /**
   * The radius this charge will actually damage at, in pixels.
   *
   * Passed in rather than assumed, because the ring drawn here is a promise:
   * the inline version drew `CONFIG.dynamiteBlastRadius` for every charge while
   * THE BIG ONE detonated at three times that, so the one drawing that could
   * have let a player leave was lying to them about where to stand.
   */
  readonly reach: number;
  /** THE BIG ONE, rather than one link of CARPET BOMB. */
  readonly big: boolean;
  /** Free-running seconds, for the fuse's sparks. */
  readonly t: number;
}

/**
 * A charge on the ground with its danger ring and its burning fuse.
 *
 * The fuse is the skill in both of these abilities — THE BIG ONE's whole
 * bargain is that things can walk out of it — so the fuse is drawn as a fuse
 * that gets shorter, and the reach is drawn on the floor for as long as it is
 * burning. The plain dynamite has neither: it has a countdown numeral, which
 * says the same thing to a reader and nothing at all to a player watching the
 * field.
 */
export function paintUltimateCharge(ctx: CanvasRenderingContext2D, p: UltimateChargePose): void {
  const left = clamp01(p.left);
  const burnt = 1 - left;

  ctx.save();
  // The reach, on the floor, brightening as the fuse burns down.
  //
  // A FILL rather than a wash: the first build tinted the whole disc violet,
  // which on the game's green field came out as flat grey and read as fog
  // sitting over the trees rather than as ground about to be hit. What works
  // is darkening — the shadow the thing above is casting — kept faint enough
  // that everything standing in it is still legible, with the promise carried
  // by the dashes rather than by the area.
  ctx.globalAlpha = 0.06 + 0.12 * burnt;
  ctx.fillStyle = '#1A0E05';
  groundEllipse(ctx, p.x, p.y + 6, p.reach);
  ctx.fill();
  ctx.globalAlpha = 0.45 + 0.5 * burnt;
  ctx.strokeStyle = ULTIMATE_GOLD.bright;
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = -p.t * 22;
  groundEllipse(ctx, p.x, p.y + 6, p.reach);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // The body. Banded and bolted, and NOT round: the sapper's own bomb is a
  // sphere and his dynamite is a stick, so an ultimate that were either would
  // be read as one of them however large it was drawn.
  const s = p.big ? 1 : 0.55;
  const w = Math.round(26 * s), h = Math.round(30 * s);
  const bx = p.x - w / 2, by = p.y - h * 0.75;
  ctx.fillStyle = '#2A2118';
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = '#4A3B28';
  ctx.fillRect(bx + 1, by + 1, w * 0.38, h - 2);
  ctx.fillStyle = '#6B573A';
  ctx.fillRect(bx + 2, by + 2, w * 0.16, h - 4);
  for (const band of [0.17, 0.7]) {
    ctx.fillStyle = ULTIMATE_GOLD.deep;
    ctx.fillRect(bx, by + h * band, w, Math.max(2, 3 * s));
    ctx.fillStyle = ULTIMATE_GOLD.mid;
    ctx.fillRect(bx, by + h * band, w, 1);
  }
  if (p.big) {
    ctx.fillStyle = '#1A130C';
    for (const [ox, oy] of [[3, 6], [21, 6], [3, 22], [21, 22]] as const) {
      ctx.fillRect(bx + ox, by + oy, 2, 2);
    }
  }

  // The fuse, actually shortening, with the spark at its live end.
  const len = (p.big ? 26 : 14) * left;
  const fx = bx + w * 0.75, fy = by;
  ctx.strokeStyle = '#8A7350';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(fx + len * 0.5, fy - len * 0.7, fx + len * 0.35, fy - len);
  ctx.stroke();
  const sx = fx + len * 0.35, sy = fy - len;
  ctx.fillStyle = ULTIMATE_GOLD.lit;
  ctx.fillRect(sx - 2, sy - 2, 4, 4);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = ULTIMATE_GOLD.bright;
  for (let i = 0; i < 5; i++) {
    const a = p.t * 9 + i * 1.3;
    ctx.fillRect(sx + Math.cos(a) * 5, sy + Math.sin(a) * 5 - i * 2, 2, 2);
  }
  ctx.restore();
}

/**
 * The cord CARPET BOMB runs out from the sapper's feet.
 *
 * One object rather than seven, which is the whole difference between an
 * ability and him throwing quickly: the charges are things the cord reaches,
 * and the spark running it is what says which goes next.
 *
 * ```js
 * paintDetCord(ctx, {
 *   x0: carpet.x0, y0: carpet.y0 + CONFIG.hudHeight,
 *   angle: carpet.angle, laid: carpet.laid, spark: carpet.spark,
 * });
 * ```
 */
export interface DetCordPose {
  /** Where the cord starts: the sapper's feet at the press. */
  readonly x0: number;
  /** As `x0`. Remember `CONFIG.hudHeight`. */
  readonly y0: number;
  /** The aim it was laid along, in radians. */
  readonly angle: number;
  /** How far it reaches, in pixels — the last charge's distance. */
  readonly laid: number;
  /** How far the spark has run, in pixels, or a negative number for none. */
  readonly spark: number;
}

/** Paints the cord and the spark on it. */
export function paintDetCord(ctx: CanvasRenderingContext2D, p: DetCordPose): void {
  if (!(p.laid > 0)) return;
  const nx = Math.cos(p.angle), ny = Math.sin(p.angle);
  const px = -ny, py = nx;

  ctx.save();
  ctx.strokeStyle = '#4A3B28';
  ctx.lineWidth = 2;
  ctx.beginPath();
  // Kinked off the aim line by a fixed wave: a cord laid dead straight reads
  // as a drawn line, and a randomly wandering one shimmers frame to frame.
  for (let d = 0; d <= p.laid; d += 8) {
    const off = Math.sin(d * 0.22) * 2;
    const x = p.x0 + nx * d + px * off, y = p.y0 + ny * d + py * off;
    if (d) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();

  if (p.spark >= 0 && p.spark <= p.laid) {
    const off = Math.sin(p.spark * 0.22) * 2;
    ctx.fillStyle = ULTIMATE_GOLD.lit;
    ctx.fillRect(p.x0 + nx * p.spark + px * off - 2, p.y0 + ny * p.spark + py * off - 2, 4, 4);
  }
  ctx.restore();
}

/**
 * The gold over an ultimate's blast, and the scorch it leaves.
 *
 * Layered OVER `paintExplosion` rather than replacing it. The pixel-art
 * fireball is good and it is what every other explosion in the game looks
 * like; what an ultimate needs is not a different fire but three things the
 * plain blast never gets — a white core that outruns it, the ability's gold in
 * the shell, and a mark on the ground afterwards.
 *
 * ```js
 * paintUltimateBlast(ctx, {
 *   x: b.x, y: b.y + CONFIG.hudHeight, radius: b.radius, age: b.t / BLAST_SECS,
 * });
 * ```
 */
export interface UltimateBlastPose {
  /** The blast's centre, in the frame the rest of the world is drawn in. */
  readonly x: number;
  /** As `x`. Remember `CONFIG.hudHeight`. */
  readonly y: number;
  /** The damage radius, in pixels — the same figure the fireball is drawn at. */
  readonly radius: number;
  /** 0 at the detonation, 1 as it ends. Outside that, nothing is drawn. */
  readonly age: number;
}

/** How long of the blast's life the white core lasts. Two frames at 60 Hz. */
const CORE_OUT = 0.12;

/** Paints the ultimate's three extra beats over a blast already drawn. */
export function paintUltimateBlast(ctx: CanvasRenderingContext2D, p: UltimateBlastPose): void {
  if (!(p.radius > 0) || !(p.age >= 0) || p.age >= 1) return;

  ctx.save();
  // The core. Brief and total: what says the thing that just went off was not
  // one of his four-second charges.
  if (p.age < CORE_OUT) {
    const k = p.age / CORE_OUT;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * (0.3 + k * 0.9), 0, TAU);
    ctx.fill();
  }

  // The shell, in the ability's gold, over the fire that is already there.
  const shell = p.radius * (0.45 + 0.7 * p.age);
  ctx.globalAlpha = clamp01(0.55 - p.age * 0.6);
  ctx.strokeStyle = ULTIMATE_GOLD.bright;
  ctx.lineWidth = 6 * (1 - p.age);
  ctx.beginPath();
  ctx.arc(p.x, p.y, shell, 0, TAU);
  ctx.stroke();

  // No smoke ring. There was one, and looked at in the game it was a grey
  // ellipse the width of the field laid over `paintExplosion`'s own smoke --
  // two smokes at different opacities, which reads as haze rather than as
  // either. The fireball already has it; what it does not have is the three
  // beats above and below.

  // The scorch, darkening in as the fire goes out. It is the only mark any
  // blast in this game leaves, which is what makes it read as the big one.
  ctx.globalAlpha = 0.5 * p.age;
  ctx.fillStyle = '#120C08';
  groundEllipse(ctx, p.x, p.y + 6, p.radius * 0.8);
  ctx.fill();
  ctx.restore();
}

// ── Shared pieces the other heroes' painters are built from ──────────────────

/**
 * A gold corridor: the line a shot took, held after the shot has gone.
 *
 * HEADSHOT and FULL AUTO both need one and they are the same drawing at two
 * weights, so it is one function taking the weight rather than two that drift.
 * Nothing else in the game leaves a line on the field, which is exactly why it
 * reads as the ultimate rather than as a faster arrow.
 */
export function paintGoldCorridor(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  fade: number, weight: number,
): void {
  if (fade <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [width, colour, alpha] of [
    [7, ULTIMATE_GOLD.deep, 0.30],
    [3, ULTIMATE_GOLD.bright, 0.75],
    [1, ULTIMATE_GOLD.lit, 1],
  ] as const) {
    ctx.globalAlpha = clamp01(fade * alpha);
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, width * weight);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/** The four-pointed flare a pierced body throws, cached per size. */
function pipStamp(size: number): HTMLCanvasElement {
  const s = Math.max(4, Math.round(size));
  return stamps.get(`ultPip|${s}`, s * 2, s * 2, (g, w, h) => {
    const c = w / 2;
    g.fillStyle = ULTIMATE_GOLD.lit;
    g.beginPath();
    g.moveTo(c, c - h / 2);
    g.lineTo(c + w / 6, c);
    g.lineTo(c, c + h / 2);
    g.lineTo(c - w / 6, c);
    g.closePath();
    g.fill();
  });
}

/**
 * One pip, where the corridor crossed a body.
 *
 * Memoized through `stamps` per the sprite rule: a corridor can cross a dozen
 * bodies and the flare is the same drawing at each of them.
 */
export function paintPiercePip(
  ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number,
): void {
  if (alpha <= 0 || !(size > 0)) return;
  const stamp = pipStamp(size);
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  ctx.drawImage(stamp, x - stamp.width / 2, y - stamp.height / 2);
  ctx.restore();
}

// ── The archer ───────────────────────────────────────────────────────────────

/**
 * ARROW RAIN's mark, and the arrows arriving over it.
 *
 * The old drawing was two ellipses and then nothing: eighteen arrows landed
 * and not one of them was drawn, so the loudest half of the ability happened
 * off-screen. The mark now FILLS as the wait runs out — a shadow the volley
 * casts ahead of itself — and every impact the simulation resolves puts a
 * shaft in the ground and a puff of dust round it.
 */
/**
 * One arrow of the volley: where it comes down, and how far through its own
 * arrival it is.
 *
 * Taken from the run rather than re-derived here: the golden-angle spiral is
 * the simulation's own, and a second copy of it in a painter would be one
 * balance pass away from drawing arrows where nothing was hit.
 */
export interface RainImpact {
  /** Where it lands, in the frame the world is drawn in. */
  readonly x: number;
  /** As `x`. Remember `CONFIG.hudHeight`. */
  readonly y: number;
  /** 0 as it is loosed, 1 once the shaft has faded out of the ground. */
  readonly age: number;
}

/** How far above the ground an arrow is drawn falling from. */
const RAIN_DROP_PX = 96;

/** How much of an impact's life is the fall, the rest being the shaft in the
 *  ground. Short: the arrow is fast and the mark it leaves is the point. */
const RAIN_FALL = 0.25;

/**
 * The mark, while the volley is still owed.
 *
 * Darkening rather than only closing: a ring alone says where, and the fill
 * says something is on its way. `wait` is 1 at the cast and 0 as the first
 * arrow is loosed.
 */
export function paintArrowRainMark(
  ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, wait: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.10 + 0.28 * (1 - clamp01(wait));
  ctx.fillStyle = '#0D0716';
  groundEllipse(ctx, x, y, radius);
  ctx.fill();
  ctx.globalAlpha = 0.45 + 0.45 * (1 - clamp01(wait));
  ctx.strokeStyle = ULTIMATE_GOLD.bright;
  ctx.lineWidth = 1.5;
  groundEllipse(ctx, x, y, radius);
  ctx.stroke();
  ctx.restore();
}

/**
 * The arrows themselves, falling and then standing in the ground.
 *
 * Separate from the mark because they outlive it: the last of eighteen is
 * still in the air when the ability is over, and the alternative was holding
 * the volley open past its own end so one drawing could do both.
 */
export function paintArrowRainImpacts(
  ctx: CanvasRenderingContext2D, landed: readonly RainImpact[],
): void {
  if (landed.length === 0) return;
  ctx.save();
  for (const hit of landed) {
    const age = clamp01(hit.age);
    if (age < RAIN_FALL) {
      // Still falling: a streak that lengthens as it accelerates down.
      const k = age / RAIN_FALL;
      const len = 10 + 26 * k;
      const top = hit.y - (1 - k) * RAIN_DROP_PX - len;
      ctx.globalAlpha = 0.5 + 0.5 * k;
      ctx.strokeStyle = ULTIMATE_GOLD.lit;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hit.x, top);
      ctx.lineTo(hit.x, top + len);
      ctx.stroke();
      continue;
    }
    // Landed: a shaft standing in the ground, and the dust it threw.
    const out = (age - RAIN_FALL) / (1 - RAIN_FALL);
    ctx.globalAlpha = 1 - out;
    ctx.strokeStyle = ULTIMATE_GOLD.mid;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(hit.x, hit.y - 11);
    ctx.lineTo(hit.x, hit.y);
    ctx.stroke();
    ctx.globalAlpha = (1 - out) * 0.5;
    ctx.strokeStyle = ULTIMATE_GOLD.deep;
    ctx.lineWidth = 1;
    groundEllipse(ctx, hit.x, hit.y, 5 + out * 10);
    ctx.stroke();
  }
  ctx.restore();
}

// ── The wizard ───────────────────────────────────────────────────────────────

/**
 * VORTEX as a disk in the floor, with ground drawn into it.
 *
 * The old drawing was a true circle with fourteen curled spokes, which reads
 * as a decal painted on the floor rather than a hole in it — the exact fault
 * `explosion.ts` squashes its splash ring to avoid. And what the ability DOES
 * is drag everything to one point, which nothing on screen showed happening,
 * so the pull is drawn on the ground itself.
 */
export interface VortexPose {
  /** The singularity, in the frame the rest of the world is drawn in. */
  readonly x: number;
  /** As `x`. Remember `CONFIG.hudHeight`. */
  readonly y: number;
  /** What it reaches, in pixels: the circle the pull and the collapse use. */
  readonly radius: number;
  /** 0 when it is placed, 1 at the collapse. */
  readonly done: number;
  /** Free-running seconds, for the spin. */
  readonly t: number;
}

/** How many chunks of ground are on their way in at any moment. */
const VORTEX_MOTES = 20;

/** Paints the disk, the infall and the core. */
export function paintVortex(ctx: CanvasRenderingContext2D, p: VortexPose): void {
  ctx.save();
  ctx.translate(p.x, p.y);

  // The reach, one pixel wide and left clear, the way paintWhirlwind draws
  // its: the boundary is the thing that states where the pull stops.
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = ULTIMATE_GOLD.bright;
  ctx.lineWidth = 1;
  groundEllipse(ctx, 0, 0, p.radius);
  ctx.stroke();

  // The disk, in the floor plane. Violet, which is his own colour and the
  // ultimates' ground both; the gold is spent on the rim and the infall.
  for (let ring = 5; ring >= 1; ring--) {
    ctx.globalAlpha = 0.08 + 0.06 * (5 - ring);
    ctx.fillStyle = ring > 3 ? '#331D4B' : '#4A2A6E';
    groundEllipse(ctx, 0, 0, p.radius * (ring / 5));
    ctx.fill();
  }

  // Ground on its way in: chunks on spiral paths, shrinking as they go.
  // Derived from the index and the clock rather than rolled, so it is the same
  // picture every cast and costs no state.
  for (let k = 0; k < VORTEX_MOTES; k++) {
    const seed = (k * 0.618) % 1;
    const life = (p.t * 0.85 + seed) % 1;
    const a = seed * TAU + life * 3.4 + p.t * 1.6;
    const rr = p.radius * (1 - life) * (0.55 + 0.5 * seed);
    const s = 1 + 3 * (1 - life);
    ctx.globalAlpha = 0.35 + 0.55 * life;
    ctx.fillStyle = life > 0.6 ? ULTIMATE_GOLD.lit
      : life > 0.3 ? ULTIMATE_GOLD.bright : ULTIMATE_GOLD.deep;
    ctx.fillRect(Math.cos(a) * rr - s / 2, Math.sin(a) * rr * GROUND_SQUASH - s / 2, s, s * 0.7);
  }

  // The core: a hole ringed in gold, opening as the collapse nears. It is the
  // only warning the detonation gets.
  const core = p.radius * (0.10 + 0.20 * clamp01(p.done));
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0D0716';
  ctx.beginPath();
  ctx.ellipse(0, 0, core, core * 0.7, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.5 + 0.5 * clamp01(p.done);
  ctx.strokeStyle = ULTIMATE_GOLD.bright;
  ctx.lineWidth = 1 + p.done * 1.6;
  ctx.stroke();
  ctx.restore();
}

/**
 * The scorch THE BEAM leaves behind its sweep.
 *
 * Drawn under the lance from the angles it has already covered, so what a
 * player reads is how much of the arc is spent. Nothing else in the wizard's
 * kit remembers where it has been, and a two-second sweep is the one ability
 * that needs it: without a trail there is no way to aim the second half.
 */
export function paintBeamScorch(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, angles: readonly number[], reach: number,
): void {
  if (angles.length === 0) return;
  ctx.save();
  ctx.strokeStyle = ULTIMATE_GOLD.dark;
  ctx.lineWidth = 16;
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    if (a === undefined) continue;
    // Oldest faintest: the burn cools behind him.
    ctx.globalAlpha = 0.30 * ((i + 1) / angles.length);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 40, y + Math.sin(a) * 40);
    ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
    ctx.stroke();
  }
  ctx.restore();
}

/** The braces at his feet: he is rooted, and nothing else said so. */
export function paintBeamRoots(
  ctx: CanvasRenderingContext2D, x: number, y: number, t: number,
): void {
  ctx.save();
  ctx.strokeStyle = ULTIMATE_GOLD.bright;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5 + 0.35 * Math.sin(t * 9);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * 4, y + 3);
    ctx.lineTo(x + side * 13, y + 9);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.35;
  groundEllipse(ctx, x, y + 5, 16);
  ctx.stroke();
  ctx.restore();
}

// ── The knight ───────────────────────────────────────────────────────────────

/**
 * The slabs and dust EARTHSHATTER throws, over the split itself.
 *
 * The crack's wedge is drawn by the caller, which already has the shape; this
 * is what comes OUT of it. Without them the ground opens and nothing happens,
 * which is the fault a filled outline always has whatever colour it is given.
 */
export interface EarthshatterDebrisPose {
  /** Where the crack started, in the frame the world is drawn in. */
  readonly x0: number;
  /** As `x0`. Remember `CONFIG.hudHeight`. */
  readonly y0: number;
  /** The heading it committed to at the press, in radians. */
  readonly angle: number;
  /** How far the head has run, in pixels. */
  readonly travelled: number;
  /**
   * Half-width this far along, in pixels.
   *
   * The simulation's own widening rule, handed over rather than repeated: the
   * lips drawn here have to sit on the edges the caller fills, and two copies
   * of one linear rule is one tuning pass away from a slab in mid-air.
   */
  readonly widthAt: (d: number) => number;
  /** Free-running seconds, for the dust. */
  readonly t: number;
}

/** How far apart the slabs sit along the run, in pixels. */
const SLAB_STEP = 34;

/** Paints slabs along both lips, dust across them, and the breaking head. */
export function paintEarthshatterDebris(
  ctx: CanvasRenderingContext2D, p: EarthshatterDebrisPose,
): void {
  if (!(p.travelled > 0)) return;
  const nx = Math.cos(p.angle), ny = Math.sin(p.angle);
  const px = -ny, py = nx;
  /** The lip offset the caller's own edge walk uses, so the two line up. */
  const lip = (d: number, side: number): number =>
    side * p.widthAt(d) * (0.55 + 0.45 * Math.sin(d * 0.23 + side));
  const at = (d: number, off: number): readonly [number, number] =>
    [p.x0 + nx * d + px * off, p.y0 + ny * d + py * off];

  ctx.save();
  // Heat in the mouth, hottest at the head: the ground is breaking THERE, and
  // the far end of a long crack has had a second to cool.
  for (let d = 0; d < p.travelled; d += 14) {
    const near = d / Math.max(1, p.travelled);
    ctx.globalAlpha = 0.15 + 0.55 * near * near;
    ctx.fillStyle = near > 0.75 ? '#FFE9A0' : near > 0.4 ? '#FF7A1F' : '#7E2A05';
    const w = p.widthAt(d);
    const [hx, hy] = at(d, 0);
    ctx.fillRect(hx - 6, hy - w * 0.35, 12, w * 0.7);
  }

  // Slabs tipped up along both lips, each with a lit top edge. The lit edge is
  // what makes them read as pieces of floor rather than more holes beside it.
  ctx.globalAlpha = 1;
  for (let d = 16; d < p.travelled; d += SLAB_STEP) {
    for (const side of [-1, 1]) {
      const w = p.widthAt(d);
      const h = 5 + w * 0.55;
      const base = lip(d, side);
      const out = base + side * h;
      const [ax, ay] = at(d - 9, base);
      const [bx, by] = at(d + 9, base);
      const [cx, cy] = at(d + 7, out);
      const [dx, dy] = at(d - 7, out);
      ctx.fillStyle = '#241A2E';
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ULTIMATE_GOLD.mid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dx, dy); ctx.lineTo(cx, cy);
      ctx.stroke();
    }
  }

  // Dust off the lips, thrown across the run and thinning as it goes.
  ctx.fillStyle = '#5A4A70';
  for (let i = 0; i < 26; i++) {
    const seed = (i * 0.618) % 1;
    const d = seed * p.travelled;
    const life = (p.t * 1.4 + seed) % 1;
    const side = i % 2 ? 1 : -1;
    ctx.globalAlpha = (1 - life) * 0.5;
    const s = 2 + life * 3;
    const [gx, gy] = at(d, lip(d, side) + side * life * 20);
    ctx.fillRect(gx, gy, s, s);
  }

  // The head, where it is opening right now.
  ctx.globalAlpha = 1;
  ctx.fillStyle = ULTIMATE_GOLD.lit;
  const [hx, hy] = at(p.travelled, 0);
  ctx.beginPath();
  ctx.arc(hx, hy, p.widthAt(p.travelled) * 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * The arc THE LEAP will follow, dotted, to the ground it lands on.
 *
 * A jump that crosses walls is only a skill if it can be aimed, and nothing
 * showed where it was going: the old drawing was a shadow that shrank, which
 * says he is in the air and not where he comes down.
 */
export function paintLeapArc(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  lift: number, radius: number, t: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = ULTIMATE_GOLD.bright;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.lineDashOffset = -t * 26;
  ctx.beginPath();
  for (let k = 0; k <= 1.001; k += 0.04) {
    const px = x0 + (x1 - x0) * k;
    const py = y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * lift;
    if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // The ground he is coming down on, at the reach the landing will damage.
  ctx.globalAlpha = 0.5;
  groundEllipse(ctx, x1, y1 + 6, radius);
  ctx.stroke();
  ctx.restore();
}

/**
 * The landing: a fracture star driven into the floor, and slabs kicked up.
 *
 * THE LEAP's landing IS the ability and it drew one shock ring. The star
 * outlasts the ring it arrives with, which is what says the slowest body on
 * the roster just came down from over a wall.
 */
export function paintLeapLanding(
  ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, age: number,
): void {
  if (!(age >= 0) || age >= 1) return;
  const k = clamp01(age);
  ctx.save();
  // The star. Fades slowest, so it is still there once the ring has gone.
  ctx.globalAlpha = Math.max(0, 1 - k * 0.7);
  ctx.strokeStyle = '#0D0716';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 9; i++) {
    const a = i * (TAU / 9) + 0.4;
    const len = radius * (0.5 + 0.5 * ((i * 5) % 4) / 4) * Math.min(1, k * 3);
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x + Math.cos(a) * len, y + 6 + Math.sin(a) * len * GROUND_SQUASH);
    ctx.stroke();
  }
  // Slabs round the boot.
  ctx.globalAlpha = Math.max(0, 1 - k * 1.6);
  for (let i = 0; i < 7; i++) {
    const a = i * (TAU / 7) + 0.9;
    const rr = radius * (0.35 + k * 0.55);
    const s = 5 - k * 3;
    const sx = x + Math.cos(a) * rr - s / 2;
    const sy = y + 6 + Math.sin(a) * rr * GROUND_SQUASH - s;
    ctx.fillStyle = '#241A2E';
    ctx.fillRect(sx, sy, s, s);
    ctx.fillStyle = ULTIMATE_GOLD.mid;
    ctx.fillRect(sx, sy, s, 1);
  }
  // The reach, in the ability's gold, opening out to exactly what was hit.
  ctx.globalAlpha = 1 - k;
  for (const [width, colour] of [
    [4, ULTIMATE_GOLD.deep], [2, ULTIMATE_GOLD.bright], [1, ULTIMATE_GOLD.lit],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * (1 - k * 0.5);
    groundEllipse(ctx, x, y + 6, radius * (0.3 + 0.75 * k));
    ctx.stroke();
  }
  ctx.restore();
}

// ── The ranger ───────────────────────────────────────────────────────────────

/**
 * The chain between the ranger and her harpoon.
 *
 * Nothing else in the game draws a line back to the hero, which is why it
 * reads as the ultimate: the old drawing was an ordinary arrow, and then she
 * was somewhere else — the ability's whole idea, that the shot brings HER,
 * happened without a picture.
 */
export function paintHarpoonChain(
  ctx: CanvasRenderingContext2D,
  hx: number, hy: number, headX: number, headY: number,
): void {
  const span = Math.hypot(headX - hx, headY - hy);
  if (span < 2) return;
  const n = Math.max(2, Math.round(span / 7));

  ctx.save();
  ctx.strokeStyle = '#8A7BA8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    // Paid out loose behind the head. It is only ever drawn in flight -- the
    // instant it bites, the arrow is spent and she is already moving -- so
    // there is no taut case to carry a flag for.
    const sag = Math.sin(k * Math.PI) * 12;
    if (i) ctx.lineTo(hx + (headX - hx) * k, hy + (headY - hy) * k + sag);
    else ctx.moveTo(hx, hy);
  }
  ctx.stroke();
  // Links, so it is a chain and not a wire.
  ctx.fillStyle = ULTIMATE_GOLD.mid;
  for (let i = 0; i <= n; i += 2) {
    const k = i / n;
    const sag = Math.sin(k * Math.PI) * 12;
    ctx.fillRect(hx + (headX - hx) * k - 1, hy + (headY - hy) * k + sag - 1, 3, 3);
  }
  ctx.restore();
}

/**
 * The corridor burning off the ranger's heels through FULL AUTO.
 *
 * The rule the ability lives by is "only while she keeps running", and it was
 * nowhere on screen: the bolts simply stopped coming. This is that rule drawn
 * — bright while she moves, out the instant she does not — so nobody has to be
 * told what the ability wants from them.
 */
export function paintFullAutoTrail(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, angle: number, heat: number,
): void {
  const h = clamp01(heat);
  if (h <= 0) return;
  const bx = -Math.cos(angle), by = -Math.sin(angle);
  ctx.save();
  for (let i = 0; i < 14; i++) {
    const back = 8 + i * 9;
    ctx.globalAlpha = h * 0.42 * (1 - i / 14);
    ctx.fillStyle = i < 5 ? ULTIMATE_GOLD.bright : ULTIMATE_GOLD.deep;
    ctx.fillRect(x + bx * back - 4, y + by * back + 1, 8, 4);
  }
  ctx.restore();
}
