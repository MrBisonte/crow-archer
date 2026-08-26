/**
 * The archer's bow, drawn live rather than baked into his body grid.
 *
 * It is live because it moves for three different reasons and a baked sprite
 * can only answer one of them: it swings to wherever the mouse is aiming, the
 * string pulls back through a whole second of a held power shot, and it snaps
 * forward when a shot goes. Baking that would be one grid per aim angle per
 * draw step, which is not a sprite sheet, it is a video.
 *
 * One home for both renderers. The legacy single-player art and the
 * multiplayer painter each set up the same mirrored transform — translate to
 * the body, `scale(facing, 1)`, and an aim angle already flipped into that
 * local frame — so both hand this function the same three numbers and get the
 * same bow. Two copies of a bow that has to agree with `archerDrawFrac` is how
 * the two renderers drift.
 */

/** How far the grip sits from the body's centre, along the aim. */
const GRIP = 9;

/** Half the stave's length, across the aim. */
const LIMB = 8;

/** How far back the nock travels at a full draw. */
const PULL = 8;

/**
 * How far the limb tips bend back at a full draw.
 *
 * The tips have to move or the draw reads as a string being stretched off a
 * rigid frame. A real bow spends the draw bending, and at this size two and a
 * half pixels of tip travel is the difference between "pulling a string" and
 * "loading a weapon".
 */
const BEND = 2.5;

/** Colours. The string takes the trim so a side is readable off the weapon. */
const STAVE = '#8A6028';
const STAVE_LIT = '#A07828';
const SHAFT = '#D9B98A';
const HEAD = '#C8CEDA';

export interface BowPose {
  /** Aim angle in the mirrored local frame, not the world angle. */
  readonly aim: number;
  /** 0..1, how far the string is drawn. The power shot's `archerDrawFrac`. */
  readonly draw: number;
  /**
   * 0..1, decaying, set the instant a shot leaves. Drives the snap forward.
   * Separate from `draw` because a release is not a draw running backwards:
   * the string overshoots past rest and settles, which is what sells a loose.
   */
  readonly recoil: number;
  /** This side's trim colour, used for the string. */
  readonly trim: string;
  /** Applied to the stave and shaft so a hit flash or a downed body washes it. */
  readonly wash: (colour: string) => string;
}

/**
 * Paints the bow, string, and — while it is drawn — the nocked arrow.
 *
 * Expects the caller's transform to already be at the body's centre and
 * mirrored for facing. Leaves the context's stroke state dirty; every caller
 * here is already inside its own save/restore pair.
 */
export function paintArcherBow(ctx: CanvasRenderingContext2D, p: BowPose): void {
  const cos = Math.cos(p.aim), sin = Math.sin(p.aim);
  // Across the aim, for the limbs and the string's two ends.
  const px = -sin, py = cos;

  const gx = cos * GRIP, gy = sin * GRIP;
  const bend = p.draw * BEND;
  const tipAx = gx + px * LIMB - cos * bend, tipAy = gy + py * LIMB - sin * bend;
  const tipBx = gx - px * LIMB - cos * bend, tipBy = gy - py * LIMB - sin * bend;

  // The nock: back through the draw, then forward past rest on the release and
  // settling from there.
  const pull = p.draw * PULL - p.recoil * 3;
  const nx = gx - cos * pull, ny = gy - sin * pull;

  // Bow arm, from the shoulder out to the grip.
  ctx.strokeStyle = p.wash(SHAFT);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(gx, gy);
  ctx.stroke();

  // The stave, as one curve through both tips bulging along the aim. It
  // straightens as the draw deepens, which is the bow storing the shot.
  const bellyX = gx + cos * (4 - p.draw * 2.5);
  const bellyY = gy + sin * (4 - p.draw * 2.5);
  ctx.strokeStyle = p.wash(p.draw > 0.05 ? STAVE_LIT : STAVE);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tipAx, tipAy);
  ctx.quadraticCurveTo(bellyX, bellyY, tipBx, tipBy);
  ctx.stroke();

  // The nocked arrow, only while there is a draw to hold it. It runs from the
  // nock forward past the grip, so a deep draw shows more shaft behind the bow
  // — the shot getting longer is the thing the player is waiting on.
  if (p.draw > 0.02) {
    const tipX = nx + cos * (pull + 11), tipY = ny + sin * (pull + 11);
    ctx.strokeStyle = p.wash(SHAFT);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = p.wash(HEAD);
    ctx.beginPath();
    ctx.moveTo(tipX + cos * 2, tipY + sin * 2);
    ctx.lineTo(tipX + px * 1.6, tipY + py * 1.6);
    ctx.lineTo(tipX - px * 1.6, tipY - py * 1.6);
    ctx.closePath();
    ctx.fill();
  }

  // String last, over the stave, and glowing so the draw is legible against a
  // dark map. Trim-coloured: the one part of the weapon that says whose it is.
  ctx.shadowColor = p.trim;
  ctx.shadowBlur = p.draw > 0.05 ? 4 + p.draw * 4 : 4;
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tipAx, tipAy);
  ctx.lineTo(nx, ny);
  ctx.lineTo(tipBx, tipBy);
  ctx.stroke();
  ctx.shadowBlur = 0;
}
