/**
 * The wizard's broom: what he swings once his Focus is gone.
 *
 * It is the wizard's half of the fallback melee the archer, the ranger and the
 * sapper already share — an out-of-ammo hero with nothing left to do but hit
 * something. The three-phase swing is deliberately the *same* swing as
 * `drawPitchfork`'s, on the same 0.28 / 0.62 phase thresholds, because a
 * fallback that reads differently in the hand reads as a different mechanic;
 * only the art and the cooldown differ. The progress arrives as a parameter
 * rather than being read off the pitchfork's own timer, since the broom runs on
 * a cooldown half again as long and the two swings must be able to overlap.
 *
 * One painter, called by both renderers, taking the *local* aim angle: the
 * sprite is authored facing +x and mirrored by a negative scale, so by the time
 * this runs the canvas may already be flipped underneath it. See
 * `src/render/archer-bow.ts` for the full version of that argument.
 */

/**
 * Where the broom hand sits, as an offset up from the sprite's origin.
 *
 * The origin is on the ground between the feet and the body runs from -22 to
 * +10 around it, so a weapon anchored at 0 hangs at ankle height — the archer's
 * bow shipped that way once. -7 is chest height, and every other length here is
 * measured from it.
 */
const HAND_Y = -7;

/** How far the grip sits from the body, along the aim. Matches the pitchfork. */
const GRIP = 8;

/** Butt of the handle behind the grip. */
const BUTT = 5;

/** Grip to the throat, where the bristles are bound on. */
const NECK = 16;

/** Throat to the longest bristle tip. */
const HEAD = 12;

/**
 * Half the bristle fan's width at the tips.
 *
 * The pitchfork's three tines span 10 across a rigid crossbar. Eight either
 * side makes the broom head visibly the wider, softer thing at 24px, which is
 * the whole read: a man who has run out of magic and picked up housekeeping.
 */
const SPREAD = 8;

/** Half the width of the bound throat the bristles emerge from. */
const THROAT = 2.2;

/** Phase boundaries, shared with the pitchfork so both weapons swing alike. */
const WIND_END = 0.28;
const STRIKE_END = 0.62;

/** Radians back over the shoulder at the top of the wind-up. */
const WIND_ARC = -0.9;

/** Radians travelled through the strike, from the wind-up's extreme. */
const STRIKE_ARC = 1.5;

/** Where the strike leaves the broom, and the arc the recovery unwinds. */
const RECOVER_ARC = 0.6;

/**
 * Radius of the strike's dust sweep, about the grip.
 *
 * The pitchfork sweeps *inside* its reach because three tines 10 across hide
 * almost none of the arc. The broom head is 16 across at the tips and swallows
 * the middle of an arc at that radius, leaving two white flecks either side of
 * the bristles rather than a sweep. Clearing the tips keeps it one unbroken
 * crescent, which is the only version that reads as moving air.
 */
const SWEEP_R = 31;

/**
 * The bristles, as fractions of `SPREAD` across and `HEAD` along.
 *
 * Hand-picked rather than generated: the ragged tips are what stop the head
 * reading as a solid wedge, and a fixed table keeps them ragged the same way on
 * every frame. A per-frame jitter would boil.
 */
const STRANDS: readonly { readonly across: number; readonly reach: number }[] = [
  { across: -1.0, reach: 0.8 },
  { across: -0.76, reach: 0.95 },
  { across: -0.52, reach: 0.86 },
  { across: -0.26, reach: 1.0 },
  { across: 0.0, reach: 0.91 },
  { across: 0.26, reach: 0.99 },
  { across: 0.52, reach: 0.84 },
  { across: 0.78, reach: 0.97 },
  { across: 1.0, reach: 0.82 },
];

/**
 * Dust, for the sweep left behind the strike.
 *
 * Not the arcane blue of `wizard-staff.ts` and not the gold trim: he is
 * swinging a broom *because* the magic ran out, so a glowing sweep would
 * contradict the state that put the weapon in his hand.
 */
const DUST_RGB = '216,201,168';

/** Whether the broom can be swung again, which the wood and straw report. */
export type BroomReadiness = 'ready' | 'recharging';

/** Which part of the swing the broom is in. Drives the colour, not the angle. */
type BroomPhase = 'idle' | 'windUp' | 'strike' | 'recover';

/** One readiness state's worth of colour. */
interface BroomPalette {
  /** Pale ash handle. Never the robe's #14143A or the trim's #FFB400. */
  readonly wood: string;
  readonly woodLit: string;
  /**
   * Straw: warm enough to separate from the pale handle, brown enough not to
   * be mistaken for the robe's #FFB400 trim two rows above it.
   */
  readonly straw: string;
  readonly strawDark: string;
  readonly strawLit: string;
  /** Leather cord binding the head on. */
  readonly cord: string;
}

/**
 * Keyed by the union, so a new readiness state fails to compile rather than
 * silently falling through to the ready palette.
 *
 * `recharging` is a desaturated, darkened copy rather than a flat grey: the
 * broom's cooldown is half again the pitchfork's, so the player spends real
 * time looking at this version and it still has to read as a broom.
 */
const PALETTE: Record<BroomReadiness, BroomPalette> = {
  ready: {
    wood: '#C2B08A',
    woodLit: '#E6DCC0',
    straw: '#B5813C',
    strawDark: '#835B26',
    strawLit: '#DCBB7C',
    cord: '#6B4A2A',
  },
  recharging: {
    wood: '#6E6552',
    woodLit: '#8A806A',
    straw: '#6E5430',
    strawDark: '#4E3C22',
    strawLit: '#8A7048',
    cord: '#3E2C1A',
  },
};

export interface BroomPose {
  /** Local aim angle, already mirrored for the heading. */
  readonly aim: number;
  /**
   * 0..1 through the swing, or negative when the broom is only being carried.
   * Negative rather than null because the caller derives it by counting a timer
   * down, and a shouldered broom is the same drawing as a swing at rest.
   */
  readonly swing: number;
  /** Whether the cooldown has expired. Dims the whole weapon while it has not. */
  readonly readiness: BroomReadiness;
  /** The pose's own colour wash — hit flash, corpse grey, team shade. */
  readonly wash: (c: string) => string;
}

/** How far the broom has rotated off the aim, and which phase says so. */
interface SwingState {
  readonly phase: BroomPhase;
  /** Radians added to the aim. Negative is wound back over the shoulder. */
  readonly offset: number;
}

/**
 * Splits swing progress into the pitchfork's three phases.
 *
 * Pure, and separate from the painting, because the phase boundaries are the
 * part that has to agree with another weapon: they are checkable here without a
 * canvas.
 */
function swingState(swing: number): SwingState {
  if (swing < 0) return { phase: 'idle', offset: 0 };
  if (swing < WIND_END) {
    return { phase: 'windUp', offset: (swing / WIND_END) * WIND_ARC };
  }
  if (swing < STRIKE_END) {
    const t = (swing - WIND_END) / (STRIKE_END - WIND_END);
    return { phase: 'strike', offset: WIND_ARC + t * STRIKE_ARC };
  }
  // Clamped: a caller overshooting 1 would otherwise drive the offset negative
  // and lift the broom back over the shoulder instead of settling on the aim.
  const t = Math.min(1, (swing - STRIKE_END) / (1 - STRIKE_END));
  return { phase: 'recover', offset: RECOVER_ARC * (1 - t) };
}

/**
 * The dust the strike throws off, as a crescent riding just clear of the tips.
 *
 * Drawn in the hand's frame but *not* the broom's, and before it: the arc is
 * centred on the grip, and the head's flare has to land over it on the frames
 * where the two do meet.
 */
function paintSweep(ctx: CanvasRenderingContext2D, angle: number, strikeT: number): void {
  const alpha = (1 - strikeT) * 0.7;
  const grad = ctx.createLinearGradient(0, 0, Math.cos(angle) * SWEEP_R, Math.sin(angle) * SWEEP_R);
  grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(2)})`);
  grad.addColorStop(1, `rgba(${DUST_RGB},0)`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, SWEEP_R, angle - 0.5, angle + 0.5);
  ctx.stroke();
}

/**
 * Handle and butt, in the broom's own frame with +x running down the shaft.
 *
 * Pale on purpose, and not the brown the bow and staff use. Rendered in the
 * bow's #7A5322 the handle and the straw are one brown mass and the broom stops
 * reading as a handle with a head on it — pale ash is what splits the two, and
 * what tells it apart from the archer's pitchfork across the arena.
 */
function paintHandle(ctx: CanvasRenderingContext2D, pal: BroomPalette, wash: (c: string) => string): void {
  ctx.strokeStyle = wash(pal.wood);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-BUTT, 0);
  ctx.lineTo(NECK, 0);
  ctx.stroke();

  // A lit edge along the top, so the shaft is not one flat bar. A whole pixel
  // over a two-pixel shaft, matching the staff: the pitchfork's half-pixel
  // version is a hairline on a handle that is already the brightest thing here.
  ctx.strokeStyle = wash(pal.woodLit);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-BUTT + 1, -0.5);
  ctx.lineTo(NECK - 2, -0.5);
  ctx.stroke();

  // Knob at the butt: the one silhouette cue that says which end is the handle
  // when the head is pointing away from the camera.
  ctx.fillStyle = wash(pal.woodLit);
  ctx.beginPath();
  ctx.arc(-BUTT, 0, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The bristle head: a solid wedge with the strands laid over it.
 *
 * The wedge alone reads as a paddle and the strands alone read as a fork, so it
 * is both — mass for the silhouette, strands for the texture, and the strands
 * run past the wedge's edge to leave the tips ragged.
 */
function paintHead(
  ctx: CanvasRenderingContext2D,
  pal: BroomPalette,
  wash: (c: string) => string,
  phase: BroomPhase,
): void {
  // The head flares on impact. Straw is soft: it should splay when it lands,
  // and that widening is what sells a hit from a weapon with no edge.
  const flare = phase === 'strike' ? 1.18 : 1;
  const spread = SPREAD * flare;

  ctx.fillStyle = wash(phase === 'strike' ? pal.strawLit : pal.straw);
  ctx.beginPath();
  ctx.moveTo(NECK, -THROAT);
  ctx.lineTo(NECK + HEAD * 0.9, -spread);
  ctx.lineTo(NECK + HEAD * 0.9, spread);
  ctx.lineTo(NECK, THROAT);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 1;
  STRANDS.forEach((s, i) => {
    // Alternating light and dark is what separates nine strands from one wedge
    // at this size; a single straw colour is a paddle again.
    ctx.strokeStyle = wash(i % 2 === 0 ? pal.strawDark : pal.strawLit);
    ctx.beginPath();
    ctx.moveTo(NECK, s.across * THROAT);
    ctx.lineTo(NECK + HEAD * s.reach, s.across * spread);
    ctx.stroke();
  });

  // Two cords at the throat. They cover the seam where the strands converge,
  // which otherwise reads as the head being skewered on the handle.
  ctx.strokeStyle = wash(pal.cord);
  ctx.lineWidth = 1;
  for (const x of [NECK - 1, NECK + 1.5]) {
    ctx.beginPath();
    ctx.moveTo(x, -THROAT - 0.4);
    ctx.lineTo(x, THROAT + 0.4);
    ctx.stroke();
  }
}

/**
 * Paints the broom along `p.aim`, swung through `p.swing`.
 *
 * Expects the caller's transform to already be at the body and mirrored for
 * facing, exactly as `paintArcherBow` and `paintWizardStaff` do. Leaves the
 * context's stroke state dirty; every caller is already inside its own
 * save/restore pair.
 */
export function paintWizardBroom(ctx: CanvasRenderingContext2D, p: BroomPose): void {
  const { phase, offset } = swingState(p.swing);
  const pal = PALETTE[p.readiness];

  // The hand rides the aim; the broom rotates about the hand. Swinging the hand
  // as well would drag the grip out of the wizard's sleeve.
  const handX = Math.cos(p.aim) * GRIP;
  const handY = HAND_Y + Math.sin(p.aim) * GRIP;

  ctx.save();
  ctx.translate(handX, handY);

  if (phase === 'strike') {
    const strikeT = (p.swing - WIND_END) / (STRIKE_END - WIND_END);
    // The sweep keeps its own colour under the wash, the way the staff's orb
    // does: it is airborne dust, not part of the body being flashed or greyed.
    paintSweep(ctx, p.aim + offset, strikeT);
  }

  ctx.rotate(p.aim + offset);
  paintHandle(ctx, pal, p.wash);
  paintHead(ctx, pal, p.wash, phase);
  ctx.restore();
}
