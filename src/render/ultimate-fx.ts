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
