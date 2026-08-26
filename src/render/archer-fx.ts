/**
 * The archer's two abilities, drawn as effects around him.
 *
 * Both are *held* actions and both ask the same question: when do you let go.
 * The dynamite buys distance with hold time, the power shot buys pierce, speed
 * and triple boss damage with a second of standing still. Neither of those
 * purchases is visible on the body today — the archer holds a pose and a 28 px
 * bar fills over his head — so the player is timing a number he cannot see.
 * What these paint is that number, in the place the ability actually happens:
 * out along the aim for the throw, and on the string for the shot.
 *
 * Separate from `archer-bow.ts` on purpose, and the split is not stylistic. The
 * bow is anchored to the *body*: it is painted inside the mirrored body
 * transform, in a local frame no bigger than the sprite. These are anchored to
 * the *world* — a fully wound throw carries 834 px, four fifths of the map —
 * so they take world coordinates and the world aim, and they are called outside
 * that transform. Putting an 834 px lane inside a `scale(facing, 1)` is how a
 * preview ends up pointing at the wrong half of the screen.
 *
 * Nothing here decides how committed the action is. `frac` and `draw` come from
 * the simulation and every size, length, brightness and threshold below is a
 * function of them, so the picture cannot drift from what the release will
 * actually spend.
 *
 * Cost. These paint every frame for up to a full second while held, so the
 * usual one-shot-effect budget does not apply: there is no `shadowBlur` at
 * runtime (it is a full raster pass per call and it is what made dense frames
 * stall — see `docs/design-patterns.md`), no gradient, and no per-frame
 * allocation. The two glows are cached stamps keyed on a bucketed radius, and
 * every fade is `globalAlpha` — a number — rather than a freshly built
 * `rgba()` string.
 */

import { glowDotStamp } from './stamps';

// ── Palette ──────────────────────────────────────────────────────────────────
// The archer's own, plus the colours the live dynamite already uses. A charge
// preview painted in new colours would be a second explosive vocabulary for one
// explosive: `drawDynamites` paints the stick #FF1F1F over #8A1010 with an
// #A07828 wick and an #FFB400 spark, and so does this.

/** Team trim. Reserved here for the one moment it means something: full draw. */
const TRIM = '#39FF14';
/** The power shot's own yellow-green, matching its `burst` and its impact. */
const POWER = '#EAFF6A';
const WHITE = '#FFFFFF';
/** Lit powder. The throw's reach read and the fuse spark. */
const POWDER = '#FFB400';
/** Cooling ember, for the far, least certain end of the throw. */
const EMBER = '#C6501B';
const STICK = '#FF1F1F';
const STICK_SHADE = '#8A1010';
const WICK = '#A07828';

// ── Dynamite: the throw ──────────────────────────────────────────────────────

/**
 * The simulation's flight model, mirrored so the preview can solve it.
 *
 * `updateDynamites` steps `x += v * dt` and then damps `v *= 0.985`, once per
 * fixed 60 Hz step, and the stick detonates when its fuse expires. So the
 * distance a throw carries is not `speed * time`: it is a geometric sum, and
 * the difference is large — a full throw travels 834 px where `speed * time`
 * would predict 1512.
 */
const SIM_HZ = 60;
const SIM_DAMPING = 0.985;

/**
 * How far a stick thrown at `launchSpeed` travels before its fuse runs out, in
 * world pixels.
 *
 * Pure, and exported so the range read has one home. The caller passes exactly
 * the speed `throwDynamite` would launch at — `CONFIG.dynamiteSpeed * (1 +
 * frac * 2)` — and `CONFIG.dynamiteLifetime`, which keeps the sim's numbers the
 * source of truth and leaves only the geometry here. Copying the sum into the
 * draw call instead is how the preview and the throw come to disagree.
 *
 * Open ground only: the model has no walls in it, and a stick that hits rock
 * bounces at -0.65. That is why the preview below is a fading lane and a soft
 * ring rather than a crosshair — it promises reach, not a landing pixel.
 */
export function throwReachPx(launchSpeed: number, fuseSecs: number): number {
  const steps = Math.max(0, Math.round(fuseSecs * SIM_HZ));
  return ((launchSpeed / SIM_HZ) * (1 - Math.pow(SIM_DAMPING, steps))) / (1 - SIM_DAMPING);
}

/** Everything the throw preview needs. Nothing about the archer's body. */
export interface ChargeThrowPose {
  /** World x of the archer — `player.x`. */
  readonly x: number;
  /** World y *in canvas space* — `player.y + CONFIG.hudHeight`. */
  readonly y: number;
  /** World aim angle, unmirrored: `player.aimAngle`. */
  readonly aim: number;
  /** 0..1, how long the throw has been held. The sim's own charge fraction. */
  readonly frac: number;
  /** Where the stick will stop, in world px. See {@link throwReachPx}. */
  readonly reach: number;
  /** Blast radius of the stick — `CONFIG.dynamiteBlastRadius`. */
  readonly blastRadius: number;
  /** Wall clock in seconds, for the spark's flicker. Reads no commitment. */
  readonly t: number;
}

/**
 * Where the lane starts, measured out along the aim.
 *
 * Clear of the body and clear of the bow: the stave reaches 11 px out along the
 * aim and 10.4 px across it, so a lane starting any closer runs out from under
 * the weapon and reads as part of it.
 */
const LANE_START = 26;

/**
 * Where the lane's near band hands over to its far one, as a fraction of the
 * lane — {@link LANE_START} to the reach — and the alpha each carries.
 *
 * Two bands rather than a gradient, and the reason is the frame budget: a
 * `createLinearGradient` is an allocation and its coordinates are baked, so a
 * lane whose length changes every frame cannot cache one. Two flat alphas
 * across a dashed line read as the same falloff and cost two strokes.
 */
const LANE_NEAR_END = 0.62;
const LANE_NEAR_ALPHA = 0.4;
// The far band already cools from powder to ember, which is most of the
// falloff; at 0.24 the colour and the alpha both dimmed it and the lane died
// before it reached its own ring.
const LANE_FAR_ALPHA = 0.32;

/** Dash patterns for the lane and the detonation ring, and the solid state to
 * come back to. Module-level, including the empty one: passing a fresh `[]`
 * looks free and is an array allocation every frame of every held throw. */
const LANE_DASH = [3, 6];
const RING_DASH = [5, 5];
const NO_DASH: number[] = [];

/** Where a fully wound throw stops being "more" and starts being the maximum.
 * `frac` is clamped to 1 by the caller, so this is a state, not a spike. */
const FULL_FRAC = 0.995;

/**
 * Which of the throw's two states the hold is in.
 *
 * A named state rather than a bare `full` boolean passed down, because four
 * separate things change at the threshold — the ring's colour, its second
 * pass, the centre cross and the stick's hot rim — across two painters. A
 * boolean parameter would say "true" at each of those call sites and nothing
 * about which of the two it means.
 */
type Wind = 'winding' | 'maxed';

/** The one door from the sim's clamped hold fraction into {@link Wind}. */
function windOf(frac: number): Wind {
  return frac >= FULL_FRAC ? 'maxed' : 'winding';
}

/**
 * The stick rides at the hip, cocked back along the throw as the wind-up
 * deepens.
 *
 * Behind the origin rather than in front of it because the bow owns everything
 * forward of the chest, and low because the bow hand sits at -7: a stick at
 * hip height is under the stave for every aim instead of inside it for a
 * quarter of them.
 */
const HIP_Y = -3;
const COCK_NEAR = 3;
const COCK_FAR = 7;
const STICK_L = 10;
const STICK_H = 5;

/**
 * Fuse length at zero hold, in stick-local px, and the direction it trails.
 *
 * The direction is back and away from the throw, so the spark burns in open air
 * behind him whichever way he is facing rather than over his own chest.
 */
const FUSE_L = 13;
const FUSE_DX = -0.6;
const FUSE_DY = -0.8;

/**
 * Paints the dynamite wind-up: the reach it has bought, and the fuse it cost.
 *
 * Expects an untransformed context — world coordinates, no body mirror. Leaves
 * the context exactly as it found it; unlike the bow and the staff this one
 * touches `globalAlpha` and the line dash, and a leaked dash pattern is a bug
 * that surfaces three draw calls later in someone else's function.
 */
export function paintDynamiteCharge(ctx: CanvasRenderingContext2D, p: ChargeThrowPose): void {
  const cos = Math.cos(p.aim), sin = Math.sin(p.aim);
  const wind = windOf(p.frac);
  ctx.save();
  paintThrowReach(ctx, p, cos, sin, wind);
  paintHeldStick(ctx, p, cos, sin, wind);
  ctx.restore();
}

/**
 * The reach, out in the world: a lane along the aim and the blast it ends in.
 *
 * This is the whole ability. The throw is not aimed differently at a fifth of a
 * second and at a full one, it is aimed *further*, and until now nothing on
 * screen said so.
 */
function paintThrowReach(
  ctx: CanvasRenderingContext2D, p: ChargeThrowPose,
  cos: number, sin: number, wind: Wind,
): void {
  const full = wind === 'maxed';
  const near = LANE_START + (p.reach - LANE_START) * LANE_NEAR_END;
  ctx.setLineDash(LANE_DASH);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = POWDER;
  ctx.globalAlpha = LANE_NEAR_ALPHA;
  strokeSegment(ctx, p.x, p.y, cos, sin, LANE_START, near);
  // The far band cools to ember: the end of a throw is the part a wall is most
  // likely to have eaten, and it is painted as the least certain.
  ctx.strokeStyle = EMBER;
  ctx.globalAlpha = LANE_FAR_ALPHA;
  strokeSegment(ctx, p.x, p.y, cos, sin, near, p.reach);

  // Where it goes off, at the radius it goes off in — the same faint dashed
  // ring a live stick already wears, so the preview and the thing it previews
  // are one shape. It slides outward through the hold, which is the reach read
  // a second time in the units that decide whether the throw is worth it.
  const bx = p.x + cos * p.reach, by = p.y + sin * p.reach;
  ctx.setLineDash(RING_DASH);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = full ? POWDER : EMBER;
  // Weightier than the 0.15 a live stick's ring carries, and the difference is
  // not taste: that ring has a lit, bobbing, ticking bomb at its centre to
  // anchor it, and this one is 800 px from anything. At the live stick's alpha
  // it rendered as a smudge nobody would find — which the contact sheet said
  // immediately and the numbers did not say at all.
  ctx.globalAlpha = 0.26 + 0.2 * p.frac;
  ctx.beginPath();
  ctx.arc(bx, by, p.blastRadius, 0, Math.PI * 2);
  ctx.stroke();
  if (full) {
    // Maximum reach gets a second pass on the same circle rather than a new
    // shape. A held throw is read at a glance and out of the corner of an eye;
    // the ring going solid is legible there in a way a new glyph is not.
    ctx.setLineDash(NO_DASH);
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(bx, by, p.blastRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  // A cross at the centre, so the ring has a point rather than an area — at
  // this distance the ring alone says "somewhere in there".
  ctx.setLineDash(NO_DASH);
  ctx.globalAlpha = 0.5 + 0.3 * p.frac;
  ctx.fillStyle = full ? POWDER : EMBER;
  ctx.fillRect(bx - 5, by - 0.75, 10, 1.5);
  ctx.fillRect(bx - 0.75, by - 5, 1.5, 10);
}

/**
 * The stick in his hand and the fuse burning down it — the same commitment the
 * lane shows, on the body, for the player whose eyes are on the enemy.
 */
function paintHeldStick(
  ctx: CanvasRenderingContext2D, p: ChargeThrowPose,
  cos: number, sin: number, wind: Wind,
): void {
  const full = wind === 'maxed';
  ctx.globalAlpha = 1;
  const cock = COCK_NEAR + (COCK_FAR - COCK_NEAR) * p.frac;
  ctx.save();
  ctx.translate(p.x - cos * cock, p.y + HIP_Y - sin * cock);
  ctx.rotate(p.aim);

  // The stick. Two bands, the same red over dark red the thrown one wears.
  ctx.fillStyle = STICK;
  ctx.fillRect(-STICK_L / 2, -STICK_H / 2, STICK_L, STICK_H);
  ctx.fillStyle = STICK_SHADE;
  ctx.fillRect(-STICK_L / 2, 0.5, STICK_L, STICK_H / 2);
  if (full) {
    // A hot rim along the top at maximum reach. The spark reaching the stick is
    // the body's own "that is as far as it goes", and on the sheet it was
    // carrying that alone — one lit pixel line makes the stick itself say it,
    // for the player whose eyes are on the ring 800 px away.
    ctx.fillStyle = POWDER;
    ctx.fillRect(-STICK_L / 2, -STICK_H / 2, STICK_L, 1);
  }

  // The fuse burns from its tip back toward his hand, and what is left of it is
  // exactly `1 - frac`. This is a picture of the hold, not of the 1.5 s timer
  // the thrown stick gets: the fuse is the one shape everyone already reads as
  // "time you have left to decide", and spending it down to nothing is what
  // maximum range costs. Nothing bad happens at zero — the throw is simply as
  // long as it goes.
  const left = FUSE_L * (1 - p.frac);
  const tipX = -STICK_L / 2 + FUSE_DX * left, tipY = -STICK_H / 2 + FUSE_DY * left;
  if (left > 0.5) {
    ctx.strokeStyle = WICK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-STICK_L / 2, -STICK_H / 2);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }
  ctx.restore();

  // The spark, in world space so it is not squeezed by the stick's rotation.
  // Flicker is alpha only: pushing it through the radius would multiply the
  // stamp keys by however many flicker steps the sine happens to land on.
  const sx = p.x - cos * cock + (cos * tipX - sin * tipY);
  const sy = p.y + HIP_Y - sin * cock + (sin * tipX + cos * tipY);
  const sparkR = 1.6 + 1.3 * p.frac;
  const spark = glowDotStamp(POWDER, sparkR, 4 + 5 * p.frac);
  ctx.globalAlpha = 0.72 + 0.28 * Math.sin(p.t * 26);
  ctx.drawImage(spark, sx - spark.width / 2, sy - spark.height / 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = WHITE;
  ctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5);
}

/** One dashed run along the aim, from `a` to `b` px out. Kept out of line
 * because the lane draws two of them and a copied four-line stroke is how the
 * two bands come to sit at different offsets. */
function strokeSegment(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, cos: number, sin: number, a: number, b: number,
): void {
  if (b <= a) return;
  ctx.beginPath();
  ctx.moveTo(x + cos * a, y + sin * a);
  ctx.lineTo(x + cos * b, y + sin * b);
  ctx.stroke();
}

// ── Power shot: the draw and the loose ───────────────────────────────────────

/**
 * The nock's position, mirrored from `archer-bow.ts`.
 *
 * That file owns the bow and does not export its geometry, and this one may not
 * edit it, so the three numbers live here too — deliberately named for what
 * they mirror. They agree because the bow is painted in a horizontally mirrored
 * frame with a mirrored aim, and mirroring both cancels: a point at
 * `cos(local) * d` in that frame lands at `cos(world) * d` here. If the bow's
 * `HAND_Y`, `GRIP` or `PULL` ever move, these move with them.
 */
const BOW_HAND_Y = -7;
const BOW_GRIP = 11;
const BOW_PULL = 10.4;

/** Everything the draw and the loose need. */
export interface PowerDrawPose {
  /** World x of the archer — `player.x`. */
  readonly x: number;
  /** World y *in canvas space* — `player.y + CONFIG.hudHeight`. */
  readonly y: number;
  /** World aim angle, unmirrored: `player.aimAngle`. */
  readonly aim: number;
  /** 0..1, how far the string is back. `archerDrawFrac()`, and 0 when idle. */
  readonly draw: number;
  /** 0..1, decaying over `ARCHER_LOOSE_SECS`. The bow's own recoil term. */
  readonly recoil: number;
  /**
   * How far the bow was drawn on the shot currently recoiling, 0..1.
   *
   * Separate from `recoil` because `archerLoose` is set by every shot the
   * archer takes, including plain ones, and the snap belongs to the power shot
   * alone. Zero here means "an ordinary arrow left" and paints nothing, so a
   * tapped bow does not borrow a fully drawn shot's exit.
   */
  readonly power: number;
  /** Wall clock in seconds, for the locked-at-full shimmer. Reads no commitment. */
  readonly t: number;
}

/**
 * Below this the draw is a tap and the tension read is skipped.
 *
 * Not a nicety: at 0.04 the rays are at their longest and the nock has barely
 * moved, so six 13 px lines cross a stave that is still almost straight and
 * read as twigs caught in the bow. The picture showed it; the numbers said the
 * alpha was only 0.24 and would not be noticed.
 */
const DRAW_FLOOR = 0.1;

/** Full draw: pierce 3, speed x2, boss damage x3, all bought. `archerDrawFrac`
 * clamps to exactly 1, so this is a floor and not a window. */
const FULL_DRAW = 0.999;

/** How many tension lines converge on the nock. Six reads as a ring closing;
 * four reads as a compass rose and eight as a blur at this radius. */
const TENSION_RAYS = 6;

/** Where a ray starts and ends, at zero draw and at full. Both collapse inward,
 * which is the gathering: the force is arriving at the nock, not leaving it. */
const RAY_OUT_SLACK = 13;
const RAY_OUT_TAUT = 7;
const RAY_IN_SLACK = 8;
const RAY_IN_TAUT = 4;

/**
 * Paints the power shot: force gathering on the nock while it is held, and a
 * directional snap along the aim once it is gone.
 *
 * Expects an untransformed context — world coordinates, no body mirror — and
 * is drawn *over* the body so the gathering sits on the string rather than
 * behind the tunic. Leaves the context exactly as it found it.
 */
export function paintPowerDraw(ctx: CanvasRenderingContext2D, p: PowerDrawPose): void {
  const cos = Math.cos(p.aim), sin = Math.sin(p.aim);
  ctx.save();
  // Never both in one frame: `releaseArcherDraw` clears the draw and sets the
  // recoil in the same call. Two independent gates rather than an else, so a
  // future overlap paints both instead of silently dropping one.
  if (p.draw > DRAW_FLOOR) paintGathering(ctx, p, cos, sin);
  if (p.recoil > 0 && p.power > 0) paintLoose(ctx, p, cos, sin);
  ctx.restore();
}

/**
 * Force gathering on the nock through the second he stands still: six lines
 * closing on it, the nock brightening under them, and — at full — a hard,
 * unmissable lock.
 */
function paintGathering(
  ctx: CanvasRenderingContext2D, p: PowerDrawPose, cos: number, sin: number,
): void {
  // The nock, exactly where the bow painter puts it: out at the grip, back by
  // the pull. Landing anywhere else would put the glow beside the string.
  const reach = BOW_GRIP - p.draw * BOW_PULL;
  const nx = p.x + cos * reach, ny = p.y + BOW_HAND_Y + sin * reach;

  // One path and one stroke for all six rays — six strokes is five more state
  // changes than a held effect needs, sixty times a second.
  const outR = RAY_OUT_SLACK + (RAY_OUT_TAUT - RAY_OUT_SLACK) * p.draw;
  const inR = RAY_IN_SLACK + (RAY_IN_TAUT - RAY_IN_SLACK) * p.draw;
  ctx.strokeStyle = POWER;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.22 + 0.5 * p.draw;
  ctx.beginPath();
  for (let k = 0; k < TENSION_RAYS; k++) {
    // Anchored to the aim, so the rose turns with the bow instead of sliding
    // around a nock that is itself turning.
    const a = p.aim + (k * Math.PI * 2) / TENSION_RAYS;
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.moveTo(nx + ca * outR, ny + sa * outR);
    ctx.lineTo(nx + ca * inR, ny + sa * inR);
  }
  ctx.stroke();

  // The nock itself, brightening as it takes the load. A cached stamp: the
  // radius buckets to 0.25 px inside `glowDotStamp`, so a whole second of
  // continuous draw reuses a dozen canvases instead of blurring a new one
  // every frame.
  //
  // Deliberately small. At 1.4 + 3 * draw it grew into a sun that swallowed the
  // nock, the string and half the stave — and the stave's bend through the draw
  // is the thing `archer-bow.ts` exists to show. A tell that hides the weapon it
  // is a tell for has stopped being a tell.
  const glow = glowDotStamp(POWER, 1.2 + 2 * p.draw, 3 + 6 * p.draw);
  ctx.globalAlpha = 0.55 + 0.45 * p.draw;
  ctx.drawImage(glow, nx - glow.width / 2, ny - glow.height / 2);

  if (p.draw < FULL_DRAW) return;
  paintLock(ctx, p, nx, ny);
}

/**
 * The full-draw lock, and it is meant to pop.
 *
 * Its own painter because it is a different statement from everything above it:
 * the rays, the glow and the bend all *ramp*, and a ramp cannot tell the player
 * the exact moment the pierce, the speed and the triple boss damage are paid
 * for. This appears whole, in the team's own green, and stays for as long as he
 * holds.
 */
function paintLock(
  ctx: CanvasRenderingContext2D, p: PowerDrawPose, nx: number, ny: number,
): void {
  const throb = 0.5 * Math.sin(p.t * 9);
  ctx.strokeStyle = TRIM;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(nx, ny, 7.6 + throb, 0, Math.PI * 2);
  // Four brackets outside the ring, on the aim's own axes, so "locked" has a
  // shape and not just a colour.
  for (let k = 0; k < 4; k++) {
    const a = p.aim + (k * Math.PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.moveTo(nx + ca * 9.6, ny + sa * 9.6);
    ctx.lineTo(nx + ca * 12, ny + sa * 12);
  }
  ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(nx, ny, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

/** The release: a hard directional snap along the aim, over the handful of
 * frames `archerLoose` takes to decay. */
function paintLoose(
  ctx: CanvasRenderingContext2D, p: PowerDrawPose, cos: number, sin: number,
): void {
  // Across the aim, for the flanks and the shock ticks.
  const px = -sin, py = cos;
  // Matched to the `ARCHER_POWER_SHOT` handler rather than invented: that
  // scales its shake 1 -> 4 and its burst 6 -> 16 particles linearly in
  // `e.power`, so the exit ramps from a quarter to full on the same line. A
  // snap on its own curve would contradict the shake it lands with.
  const amp = p.recoil * (0.25 + 0.75 * p.power);
  const gx = p.x + cos * BOW_GRIP, gy = p.y + BOW_HAND_Y + sin * BOW_GRIP;

  // A lance along the aim: one long line down the shot's own path and two short
  // flanks splaying off it. Directional, because the one thing the release has
  // to say is *which way* all that held force went.
  ctx.strokeStyle = POWER;
  ctx.lineWidth = 1;
  ctx.globalAlpha = amp * 0.75;
  ctx.beginPath();
  ctx.moveTo(gx + cos * 4 + px * 2, gy + sin * 4 + py * 2);
  ctx.lineTo(gx + cos * (6 + 22 * amp) + px * 5, gy + sin * (6 + 22 * amp) + py * 5);
  ctx.moveTo(gx + cos * 4 - px * 2, gy + sin * 4 - py * 2);
  ctx.lineTo(gx + cos * (6 + 22 * amp) - px * 5, gy + sin * (6 + 22 * amp) - py * 5);
  ctx.stroke();

  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1 + 1.6 * amp;
  ctx.globalAlpha = amp;
  ctx.beginPath();
  ctx.moveTo(gx + cos * 3, gy + sin * 3);
  ctx.lineTo(gx + cos * (6 + 34 * amp), gy + sin * (6 + 34 * amp));
  ctx.stroke();

  // A shock plane leaving the bow: two ticks *across* the aim, sliding forward
  // as the recoil decays.
  //
  // It was an arc opening forward first, and an arc of that radius centred on
  // that grip is a bow — the archer appeared to hold a second, larger one for
  // two frames. One unbroken bar replaced it and was worse: a bar through the
  // lance is a cross, and on a diagonal shot it read as an X over him. The gap
  // down the middle is what makes it a plane spreading rather than a shape
  // sitting on the shot.
  const out = 12 + 20 * (1 - p.recoil) * (0.4 + 0.6 * p.power);
  const inner = 3.5, half = 4 + 5 * amp;
  ctx.strokeStyle = POWER;
  ctx.lineWidth = 0.8 + amp;
  ctx.globalAlpha = amp * 0.55;
  ctx.beginPath();
  ctx.moveTo(gx + cos * out + px * inner, gy + sin * out + py * inner);
  ctx.lineTo(gx + cos * out + px * half, gy + sin * out + py * half);
  ctx.moveTo(gx + cos * out - px * inner, gy + sin * out - py * inner);
  ctx.lineTo(gx + cos * out - px * half, gy + sin * out - py * half);
  ctx.stroke();
}
