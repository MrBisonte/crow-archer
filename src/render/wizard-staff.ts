/**
 * The wizard's staff and orb, drawn live rather than baked into his grid.
 *
 * It was baked, and the multiplayer renderer painted a live staff over the top
 * of it: two staffs, the baked one pointing wherever the art happened to leave
 * it while the real one tracked the aim. Single-player had the opposite half of
 * the same bug — one baked staff that never moved, and an orb glow pinned to
 * the fixed cell the orb used to occupy.
 *
 * So the staff is not a pose, it is a weapon, and it gets what the archer's bow
 * got: one painter, called by both renderers, taking the *local* aim angle. The
 * sprite is authored facing +x and mirrored by a negative scale, so by the time
 * this runs the canvas may already be flipped underneath it.
 */

/** How far above the sprite origin the staff hand sits. */
const HAND_Y = -6;

/** Where the hand grips, measured out along the aim from that anchor. */
const GRIP = 6;

/** Butt of the staff behind the grip, and the orb's reach in front of it. */
const BUTT = 7;
const REACH = 15;

const WOOD = '#5C3317';
const WOOD_LIT = '#7A4A22';
const ORB = '#8888FF';
const ORB_CORE = 'rgba(255,255,255,0.7)';

export interface StaffPose {
  /** Local aim angle, already mirrored for the heading. */
  readonly aim: number;
  /** Seconds, for the orb's pulse. */
  readonly t: number;
  /**
   * How far through the bolt cooldown, 0 to 1, or null when nothing is
   * charging. Single-player draws the ring; multiplayer has no cooldown to
   * report and passes null rather than a zero that would draw an empty ring.
   */
  readonly cooldown: number | null;
  /** The pose's own colour wash — hit flash, corpse grey, team shade. */
  readonly wash: (c: string) => string;
}

/**
 * Paints the staff along `p.aim`, orb first-class rather than a lit dot.
 *
 * The orb is deliberately the one part that keeps its own colour under the
 * wash: it is a light source, and a light washed grey on a downed body still
 * reads as lit while one washed white during a hit flash reads as the flash.
 */
export function paintWizardStaff(ctx: CanvasRenderingContext2D, p: StaffPose): void {
  const cos = Math.cos(p.aim);
  const sin = Math.sin(p.aim);
  const hx = cos * GRIP;
  const hy = HAND_Y + sin * GRIP;

  // The shaft, running from behind the hand to the orb rather than from the
  // body's origin: a staff that starts between the feet is a staff growing out
  // of the hem.
  ctx.strokeStyle = p.wash(WOOD);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx - cos * BUTT, hy - sin * BUTT);
  ctx.lineTo(hx + cos * REACH, hy + sin * REACH);
  ctx.stroke();
  // A lit edge down the near side, so the shaft is not one flat bar.
  ctx.strokeStyle = p.wash(WOOD_LIT);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - cos * BUTT, hy - sin * BUTT - 0.5);
  ctx.lineTo(hx + cos * (REACH - 4), hy + sin * (REACH - 4) - 0.5);
  ctx.stroke();

  const ox = hx + cos * REACH;
  const oy = hy + sin * REACH;
  const pulse = p.t * 4.5;

  if (p.cooldown !== null) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = ORB;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, 7, -Math.PI / 2, -Math.PI / 2 + p.cooldown * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.shadowColor = ORB;
  ctx.shadowBlur = 10 + 4 * Math.sin(pulse);
  ctx.fillStyle = `rgba(136,136,255,${(0.85 + 0.15 * Math.sin(pulse)).toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(ox, oy, 4 + 0.5 * Math.sin(pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ORB_CORE;
  ctx.beginPath();
  ctx.arc(ox - 1, oy - 1, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}
