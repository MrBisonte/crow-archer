/**
 * The knight's Bloodlust stacks, as drops of blood floating over his helm.
 *
 * Bloodlust is the one buff on the roster that no key can start: it is built by
 * landing swings and it is lost by swinging at air. A passive the player did
 * not trigger has to say so on the body, or the knight's damage and swing rate
 * change under him with nothing on screen accounting for it — and the moment he
 * whiffs and drops back to zero he has to see the cost, immediately, without
 * reading a number.
 *
 * So it is a badge over the head rather than a tint on the armour. Plate is
 * already carrying the fire-sword recolour and the hit flash; a fourth thing
 * painted into the same pixels is a colour nobody can decompose at speed.
 * Above the crest is empty air, and a count of drops is read the way pips on a
 * die are read — by shape, not by arithmetic.
 *
 * A separate painter, not a branch inside the knight's, for the same reason the
 * bow and the staff left their grids: the two renderers each set up their own
 * body transform and both need this, and a passive drawn twice drifts.
 */

/**
 * The cap. Three stacks is +30% damage and +30% attack speed, and three is also
 * the largest count a player reads as a *shape* rather than by counting.
 */
export const MAX_BLOODLUST_STACKS = 3;

/**
 * How many stacks are up, as the closed set the art actually has slots for.
 *
 * A bare number would let a miscount off the simulation ask for a fourth drop
 * and get silence — nothing here would throw, the drop would simply not be
 * painted and the buff would under-report itself forever. Stating the domain as
 * a type makes the layout table below exhaustive at compile time instead.
 */
export type BloodlustStacks = 0 | 1 | 2 | 3;

/**
 * The one legal door from a raw counter into {@link BloodlustStacks}: floors,
 * and clamps both ends. Callers hold an integer that climbs on hits and resets
 * on a whiff; this is where that becomes something the art can lay out.
 */
export function bloodlustStacks(count: number): BloodlustStacks {
  if (!(count >= 1)) return 0; // Also catches NaN, which every comparison fails.
  if (count >= MAX_BLOODLUST_STACKS) return 3;
  return count >= 2 ? 2 : 1;
}

/** Everything the badge needs. Nothing about the knight's body or his aim. */
export interface BloodlustPose {
  /** Stacks up, 0 to {@link MAX_BLOODLUST_STACKS}. Zero paints nothing. */
  readonly stacks: BloodlustStacks;
  /** Wall clock in seconds. Drives the bob and, at a full stack, the throb. */
  readonly t: number;
  /** The body's own wash — hit flash, corpse grey — so the tell flashes with it. */
  readonly wash: (colour: string) => string;
}

/**
 * The topmost row the knight's sprite paints, in body-origin coordinates.
 *
 * `SPRITE_ORIGIN_ROW` (character-grids.ts) puts grid row 22 on the origin, and
 * the crest's plume runs up to grid row 2 with the outline pass adding row 1 —
 * so the tip of him lands 21 px above the point the world positions him by.
 */
const HELM_TOP = -21;

/**
 * Air between the crest and the lowest drop.
 *
 * It has to survive both bobs at once. `paintKnight` lifts the whole baked body
 * by up to 1.2 px on the stride, and this badge deliberately does not ride with
 * it — a floating tell that marched with the legs would read as part of the
 * helmet — while its own drift drops a drop by up to 1.15 px at three stacks.
 * Four leaves a pixel of daylight in that worst frame; three closed it, which
 * welds a drop to the plume for exactly the frame nobody is looking at it.
 */
const CLEARANCE = 4;

/** The round bottom of a flanking drop, and how big that bulb is. */
const BULB_R = 2.9;
const BULB_Y = HELM_TOP - CLEARANCE - BULB_R;

/**
 * How far the tip reaches above the bulb, in bulb radii.
 *
 * Shorter than a drop is drawn at any size where the taper has pixels to spend
 * on it. At 2.3 the point came out a wisp barely a pixel wide, and a bulb under
 * a wisp is a small flame — the one shape this must not be, with the fire-sword
 * powerup living on the same character.
 */
const TIP = 2;

/**
 * Half the gap between neighbouring drops, across.
 *
 * Set by the three-stack row, which is the tightest: the crown is wider than
 * its neighbours, and at 5.5 the outlines touched and the badge read as one
 * red mass with lumps rather than as three of anything.
 */
const SPREAD = 7.5;

/**
 * How much higher the third drop rides, and how much bigger it is.
 *
 * Three stacks is the payoff, so it is the state that gets its own silhouette:
 * the middle drop breaks the row into an arc and outgrows its neighbours. Two
 * stacks and three stacks differing only by a count is a difference nobody
 * reads mid-fight.
 */
const CROWN_LIFT = 2.4;
const CROWN_SCALE = 1.2;

/**
 * Blood, and deliberately crimson rather than the scarlet a blood drop wants.
 *
 * The knight already spends red: the fire-sword powerup repaints his plume
 * #CC3300 and his visor #FF5500, both orange-reds. Pulling this toward magenta
 * is the only hue separation available, and hue alone would not carry it at
 * sprite size — the rim, the gap over the crest and the drop shape are what
 * actually keep the two tells apart.
 */
const BLOOD = '#D6193C';

/** The rim: a red-black, not the sprite outline's green-black. */
const RIM = '#2A040E';

/** The wet highlight. A drop without one is a red pebble. */
const GLINT = '#FF9FB2';

/**
 * Where one drop sits and what it does. `phase` staggers the bob so the three
 * of them breathe independently — moving as a block reads as the HUD sliding,
 * not as something alive over his head.
 */
interface Slot {
  readonly x: number;
  readonly lift: number;
  readonly scale: number;
  readonly phase: number;
}

const FLANK_L: Slot = { x: -SPREAD, lift: 0, scale: 1, phase: 0 };
const FLANK_R: Slot = { x: SPREAD, lift: 0, scale: 1, phase: 2.1 };
const CENTRE: Slot = { x: 0, lift: 0, scale: 1, phase: 1.05 };
const CROWN: Slot = { x: 0, lift: CROWN_LIFT, scale: CROWN_SCALE, phase: 1.05 };

/**
 * Which drops each count paints, filled centre-out so every state is symmetric
 * about the body's midline.
 *
 * Symmetry is not decoration here: the caller has already applied
 * `scale(facing, 1)`, so anything off-centre would jump across his head when he
 * turns around. Keyed by the stack type so a fourth stack could not be added
 * without this table growing a row for it.
 */
const LAYOUT: Readonly<Record<BloodlustStacks, readonly Slot[]>> = {
  0: [],
  1: [CENTRE],
  2: [FLANK_L, FLANK_R],
  3: [FLANK_L, CROWN, FLANK_R],
};

/** Bob speed and travel, both climbing with the stack count. */
const BOB_HZ = 2.4;
const BOB_HZ_PER_STACK = 0.5;
const BOB_PX = 0.55;
const BOB_PX_PER_STACK = 0.2;

/** Glow radius, likewise. Three stacks is meant to be visible across a fight. */
const GLOW = 3;
const GLOW_PER_STACK = 1.6;

/** How hard the full stack throbs, and how fast. */
const THROB = 0.1;
const THROB_HZ = 7;

/**
 * Paints the stack badge above the knight's head. Nothing at zero stacks.
 *
 * Expects the caller's transform to be at the body's origin — the ground
 * between his feet — and possibly mirrored for facing, which this deliberately
 * does not care about. Leaves `shadowBlur` cleared but the fill, stroke and
 * line width dirty, exactly as the bow and staff painters do; every call site
 * is already inside its own save/restore pair.
 */
export function paintBloodlust(ctx: CanvasRenderingContext2D, p: BloodlustPose): void {
  const slots = LAYOUT[p.stacks];
  if (slots.length === 0) return;

  const hz = BOB_HZ + BOB_HZ_PER_STACK * p.stacks;
  const travel = BOB_PX + BOB_PX_PER_STACK * p.stacks;
  // The full stack throbs; a partial one only drifts. The throb is the reward
  // for holding three, so it must not be spent on the way up.
  const throb = p.stacks === MAX_BLOODLUST_STACKS ? 1 + THROB * Math.sin(p.t * THROB_HZ) : 1;

  ctx.shadowColor = p.wash(BLOOD);
  ctx.shadowBlur = (GLOW + GLOW_PER_STACK * p.stacks) * throb;
  ctx.lineWidth = 0.75;
  for (const slot of slots) {
    const bob = Math.sin(p.t * hz + slot.phase) * travel;
    paintDrop(ctx, slot.x, BULB_Y - slot.lift + bob, BULB_R * slot.scale * throb, p);
  }
  ctx.shadowBlur = 0;
}

/**
 * One drop: a round bottom under a drawn-out point, the shape of liquid that
 * has just let go of something. A circle would read as a health pip.
 */
function paintDrop(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: BloodlustPose,
): void {
  ctx.fillStyle = p.wash(BLOOD);
  ctx.strokeStyle = p.wash(RIM);
  ctx.beginPath();
  ctx.moveTo(x, y - r * TIP);
  // Out to the widest point on each side, then round the bottom. The control
  // points sit outside the bulb and low, which bellies the sides out instead of
  // letting them run straight down from the point: a straight taper is a
  // flame, and there is already a flame on this character.
  ctx.quadraticCurveTo(x + r * 1.05, y - r * 0.55, x + r, y);
  ctx.arc(x, y, r, 0, Math.PI);
  ctx.quadraticCurveTo(x - r * 1.05, y - r * 0.55, x, y - r * TIP);
  ctx.closePath();
  ctx.fill();
  // The rim is what holds the drop off a bright background — a fire tile, an
  // explosion, another knight's burning plume.
  ctx.stroke();

  // Highlight up and to the near side, where the pauldron highlights are, so
  // the badge is lit by the same imaginary lamp as the body under it. Kept
  // inside the bulb and small: a highlight that reaches the rim stops being a
  // wet spot and becomes a pale core, and the drop hollows out.
  ctx.fillStyle = p.wash(GLINT);
  ctx.beginPath();
  ctx.arc(x - r * 0.34, y - r * 0.2, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}
