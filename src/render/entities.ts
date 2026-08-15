/**
 * Arena entity art: shots, pickups and crows.
 *
 * Ported from the single-player renderer so both modes read as one game. Every
 * function here is a pure draw: it takes a position, a clock, and nothing else.
 * Nothing is remembered between frames, because the multiplayer client paints
 * interpolated snapshots — the entity drawn last frame may be gone this frame,
 * and any per-entity render state kept here would outlive its entity.
 */

import { TEAM_COLOURS } from './palette';
import { glowDotStamp } from './stamps';

const TAU = Math.PI * 2;

/** Which projectile this is. Drives the art, not the physics. */
export type ShotFlavour = 'arrow' | 'bolt' | 'dynamite' | 'satchel';

export interface ShotVisual {
  x: number;
  y: number;
  /** Direction of travel in radians. */
  angle: number;
  flavour: ShotFlavour;
  /** 0 or 1. The firing side, so an incoming shot is readable. */
  team: 0 | 1;
  /**
   * 0..1, counting up to something about to go off. A burning fuse for
   * dynamite; an armed satchel's countdown to its own detonation, exactly
   * zero while it is still unarmed. Ignored by other flavours.
   */
  fuse: number;
}

export type PickupKind = 'ricochet' | 'fire' | 'shield';

export interface PickupVisual {
  x: number;
  y: number;
  kind: PickupKind;
}

export interface CrowVisual {
  x: number;
  y: number;
  /** Drives the wing flap. */
  wingPhase: number;
}

/**
 * Firing-side colours, the same two the arena already paints bodies with, so a
 * shot in the air belongs to a player you can see rather than to a palette.
 */
/** One home for the two side colours, shared with the character art and the HUD. */
const TEAM_TINT: Readonly<Record<0 | 1, string>> = { 0: TEAM_COLOURS[0], 1: TEAM_COLOURS[1] };

/** Matches the sim's blast radius. A ring you cannot trust is worse than none. */
const BLAST_RADIUS = 90;

/**
 * How long each countdown runs, in seconds. A ShotVisual carries only a
 * normalised fuse, so seconds cannot be derived from it alone — each has to
 * track its own weapon's fuse length in `src/sim/weapons.ts`, or the number
 * on screen counts down to the wrong moment.
 */
const DYNAMITE_FUSE_SECONDS = 1.5;
const SATCHEL_FUSE_SECONDS = 5;

/**
 * A stable phase offset made from world position. Without one, every pickup on
 * screen pulses on the same frame, which reads as chrome rather than as objects
 * sitting in the world. Position is the only per-entity value a snapshot gives
 * us, so it is what the offset is made from.
 */
function phaseAt(x: number, y: number): number {
  return (x * 0.11 + y * 0.07) % TAU;
}

/**
 * The arrowhead triangle, pointing along +x. Shared by the shot and by the two
 * arrow-shaped pickups, which differ only in where the base sits.
 */
function arrowHead(ctx: CanvasRenderingContext2D, baseX: number): void {
  ctx.beginPath();
  ctx.moveTo(baseX, -2); ctx.lineTo(baseX + 4, 0); ctx.lineTo(baseX, 2);
  ctx.closePath(); ctx.fill();
}

/** Draws at the shot's origin, with the context already translated there. */
type ShotPainter = (ctx: CanvasRenderingContext2D, v: ShotVisual, loopT: number) => void;

/** A new flavour is a new painter here, never another arm inside a draw loop. */
const SHOT_PAINTERS: Readonly<Record<ShotFlavour, ShotPainter>> = {
  arrow: paintArrow,
  bolt: paintBolt,
  dynamite: paintDynamite,
  satchel: paintSatchel,
};

/**
 * Draws one projectile. `hudHeight` is added to y because the arena starts
 * below the HUD, and snapshots carry arena coordinates.
 *
 * The painters set shadow, alpha, line dash, font and transform freely: all of
 * it is canvas drawing state, so the single restore here puts every one of them
 * back and the caller can draw next without clearing anything.
 */
export function drawShot(
  ctx: CanvasRenderingContext2D,
  v: ShotVisual,
  loopT: number,
  hudHeight: number,
): void {
  ctx.save();
  ctx.translate(v.x, v.y + hudHeight);
  ctx.shadowBlur = 0;
  SHOT_PAINTERS[v.flavour](ctx, v, loopT);
  ctx.restore();
}

/**
 * The plain arrow. The head keeps the legacy gold so the silhouette still reads
 * as an arrow at any size; the shaft and fletching take the team tint, which is
 * the part long enough to recognise while it is flying at you.
 */
function paintArrow(ctx: CanvasRenderingContext2D, v: ShotVisual, _loopT: number): void {
  const tint = TEAM_TINT[v.team];
  ctx.rotate(v.angle);
  ctx.shadowColor = tint; ctx.shadowBlur = 4;
  ctx.fillStyle = tint; ctx.fillRect(-10, -0.5, 21, 1);
  ctx.fillStyle = '#F0C830'; arrowHead(ctx, 11);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = tint; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(-7, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-10, 2); ctx.lineTo(-7, 0); ctx.stroke();
}

/**
 * The wizard bolt: a tinted orb trailing a short tail. The pulse rides on the
 * radius and the alpha rather than on the colour, so the team hue stays flat
 * and readable while the bolt still looks alive.
 */
function paintBolt(ctx: CanvasRenderingContext2D, v: ShotVisual, loopT: number): void {
  const tint = TEAM_TINT[v.team];
  const pulse = loopT * 8 + phaseAt(v.x, v.y);
  ctx.rotate(v.angle);
  // Tail first: the orb is drawn over its own tail, not framed by it.
  ctx.strokeStyle = 'rgba(100,100,220,0.45)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(0, 0); ctx.stroke();
  ctx.shadowColor = tint; ctx.shadowBlur = 10 + 3 * Math.sin(pulse);
  ctx.globalAlpha = 0.9 + 0.1 * Math.sin(pulse);
  ctx.fillStyle = tint;
  ctx.beginPath(); ctx.arc(0, 0, 4 + 0.4 * Math.sin(pulse), 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  // Off-centre white speck. It is what gives a flat disc a lit side.
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.arc(-1, -1, 1.3, 0, TAU); ctx.fill();
}

/**
 * The stick of TNT. It stays red for both teams: the blast hurts whoever is
 * standing in it, so tinting it as one side's would be a lie about the danger.
 *
 * `angle` is ignored — a thrown stick tumbles, so the spin comes from the clock
 * and a position phase instead of from a stored angle nobody would send.
 */
function paintDynamite(ctx: CanvasRenderingContext2D, v: ShotVisual, loopT: number): void {
  const phase = phaseAt(v.x, v.y);
  ctx.translate(0, 1.5 * Math.sin(loopT * 4 + phase));
  paintBlastRing(ctx);
  ctx.save();
  ctx.rotate(loopT * 1.2 + phase);
  paintTntBody(ctx);
  // Capped below 1 so the charred cord never reaches the spark: a wick that
  // finishes burning before the blast reads as a dud.
  paintWick(ctx, Math.min(0.8, v.fuse), loopT * 18);
  ctx.restore();
  // Outside the spin, because a tumbling number is unreadable.
  paintFuseCountdown(ctx, v.fuse, DYNAMITE_FUSE_SECONDS);
}

/** Faint and dashed: the ring has to be judgeable without hiding the fight. */
function paintBlastRing(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 0.15; ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(0, 0, BLAST_RADIUS, 0, TAU); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

/** Red cylinder, dark underside, white label. Shading is what stops it reading
 *  as a flat rectangle at this size. */
function paintTntBody(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(0, 7, 13, 2.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#FF1F1F'; ctx.fillRect(-12, -4, 24, 8);
  ctx.fillStyle = '#8A1010'; ctx.fillRect(-12, 0, 24, 4);
  ctx.fillStyle = '#5A0808'; ctx.fillRect(-12, -4, 1, 8); ctx.fillRect(11, -4, 1, 8);
  ctx.fillStyle = '#F0F0F0'; ctx.fillRect(-7, -3, 14, 6);
  ctx.fillStyle = '#0A0A0A'; ctx.font = 'bold 6px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('TNT', 0, 0.5);
}

/**
 * Cord and spark. The charred fraction is painted over the gold from the base
 * up, so how much time is left is legible from across the arena, before anyone
 * is close enough to read the number.
 */
function paintWick(ctx: CanvasRenderingContext2D, burnt: number, sparkPhase: number): void {
  ctx.strokeStyle = '#A07828'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(11, -4); ctx.quadraticCurveTo(14, -7, 17, -10); ctx.stroke();
  if (burnt > 0) {
    ctx.strokeStyle = '#3A2A1A';
    ctx.beginPath(); ctx.moveTo(11, -4);
    ctx.quadraticCurveTo(11 + burnt * 3, -4 - burnt * 3, 11 + burnt * 6, -4 - burnt * 6);
    ctx.stroke();
  }
  ctx.shadowColor = '#FFB400'; ctx.shadowBlur = 6 + 4 * Math.sin(sparkPhase);
  ctx.fillStyle = 'rgba(255,180,0,0.4)';
  ctx.beginPath(); ctx.arc(17, -10, 3 + Math.sin(sparkPhase), 0, TAU); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(17, -10, 1.5 + 0.5 * Math.sin(sparkPhase), 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
}

interface CountdownLook {
  colour: string;
  blur: number;
}

/**
 * How alarmed the number looks. White while the stick is merely lying there,
 * amber as it closes in, bright red for the last half second — red is the loud
 * end of the ramp, so it belongs on the frame where you need to already be
 * running. (The legacy tiers ran the other way and ended on white.)
 */
function countdownLook(secondsLeft: number): CountdownLook {
  if (secondsLeft <= 0.5) return { colour: '#FF1F1F', blur: 16 };
  if (secondsLeft <= 1.0) return { colour: '#FFB400', blur: 6 };
  return { colour: '#FFFFFF', blur: 4 };
}

/**
 * Whole seconds, floored at 1: a visible "0" would claim it already went off.
 * `totalSeconds` is the full fuse this particular countdown counts down from,
 * since dynamite's and the satchel's differ.
 */
function paintFuseCountdown(ctx: CanvasRenderingContext2D, fuse: number, totalSeconds: number): void {
  const left = Math.max(0, 1 - fuse) * totalSeconds;
  const look = countdownLook(left);
  ctx.shadowColor = look.colour; ctx.shadowBlur = look.blur;
  ctx.fillStyle = look.colour; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(String(Math.max(1, Math.ceil(left))), 0, -12);
  ctx.shadowBlur = 0;
}

/**
 * The satchel charge: an inert bag until armed, then the same kind of
 * countdown as dynamite, because from that moment it is the same kind of
 * threat.
 *
 * Unarmed (`fuse === 0`) it is deliberately dull: no blast ring, no
 * countdown, nothing to suggest it is about to do anything, because it is
 * not, yet. The moment it is armed the bag itself takes on the glow, so
 * "live" is readable from the bag alone before anyone is close enough to
 * read the number over it.
 */
function paintSatchel(ctx: CanvasRenderingContext2D, v: ShotVisual, loopT: number): void {
  const phase = phaseAt(v.x, v.y);
  const armed = v.fuse > 0;
  ctx.translate(0, 0.8 * Math.sin(loopT * 2.5 + phase));
  if (armed) paintBlastRing(ctx);
  paintSatchelBag(ctx, armed, loopT * 3 + phase);
  if (armed) paintFuseCountdown(ctx, v.fuse, SATCHEL_FUSE_SECONDS);
}

/** Canvas bag with a buckled flap. Dull tan at rest; a warmer, glowing tan
 *  once armed, which is the one colour change that says "live" unaided. */
function paintSatchelBag(ctx: CanvasRenderingContext2D, armed: boolean, pulsePhase: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, 7, 10, 2.2, 0, 0, TAU); ctx.fill();
  if (armed) {
    ctx.shadowColor = '#FFB400';
    ctx.shadowBlur = 6 + 3 * Math.sin(pulsePhase);
  }
  ctx.fillStyle = armed ? '#C08A3E' : '#7A6A50';
  ctx.beginPath(); ctx.ellipse(0, 2, 9, 6, 0, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#5A4A34';
  ctx.beginPath(); ctx.ellipse(0, -2, 6, 3, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#3A2E1E'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(-3, 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(3, 5); ctx.stroke();
  ctx.fillStyle = '#D8B860';
  ctx.beginPath(); ctx.arc(0, -1, 1.3, 0, TAU); ctx.fill();
}

/** Draws at the pickup's spot, context already translated there. */
type PickupPainter = (ctx: CanvasRenderingContext2D, loopT: number, phase: number) => void;

/** A new pickup kind is a new painter here, not another branch in a draw loop. */
const PICKUP_PAINTERS: Readonly<Record<PickupKind, PickupPainter>> = {
  ricochet: paintRicochetPickup,
  fire: paintFirePickup,
  shield: paintShieldPickup,
};

/**
 * Draws one pickup. Same HUD offset and same restore contract as `drawShot`.
 */
export function drawPickup(
  ctx: CanvasRenderingContext2D,
  v: PickupVisual,
  loopT: number,
  hudHeight: number,
): void {
  ctx.save();
  ctx.translate(v.x, v.y + hudHeight);
  ctx.shadowBlur = 0;
  PICKUP_PAINTERS[v.kind](ctx, loopT, phaseAt(v.x, v.y));
  ctx.restore();
}

/**
 * Ground shadow and pulsing halo, shared by all three kinds. The pedestal is
 * the shape that says "this is loot and it is on the floor"; only its colour
 * and size say which loot, so the shape has one home.
 */
function paintPedestal(
  ctx: CanvasRenderingContext2D,
  colour: string,
  radius: number,
  alpha: number,
  blur: number,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 8, 8, 1.8, 0, 0, TAU); ctx.fill();
  ctx.shadowColor = colour; ctx.shadowBlur = blur;
  ctx.globalAlpha = alpha; ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}

/** The float. Loot hovers so it does not get read as scenery. */
function pickupBob(loopT: number, phase: number): number {
  return -2 + Math.sin(loopT * 3 + phase) * 2;
}

/** Cyan arrow with three pips — the pips are the cue that says "it bounces". */
function paintRicochetPickup(ctx: CanvasRenderingContext2D, loopT: number, phase: number): void {
  const blink = loopT * 4 + phase;
  paintPedestal(ctx, '#39E0FF', 10 + Math.sin(blink), 0.25 + 0.15 * Math.sin(blink), 12);
  ctx.translate(0, pickupBob(loopT, phase));
  ctx.shadowColor = '#39E0FF'; ctx.shadowBlur = 6 + 4 * Math.sin(blink);
  // The shaft fades in and out while the head stays solid, so the glyph never
  // disappears entirely at the bottom of the blink.
  ctx.globalAlpha = 0.5 + 0.5 * Math.sin(blink) ** 2;
  ctx.fillStyle = '#39E0FF'; ctx.fillRect(-7, -0.5, 14, 1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#7AF0FF'; arrowHead(ctx, 7);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FFFFFF';
  for (let pip = -1; pip <= 1; pip++) ctx.fillRect(pip * 2, -3, 1, 1);
}

/** Orange arrow burning at the nock. */
function paintFirePickup(ctx: CanvasRenderingContext2D, loopT: number, phase: number): void {
  const flame = loopT * 10 + phase;
  paintPedestal(ctx, '#FF7A1F', 11 + Math.sin(flame * 0.4), 0.30 + 0.15 * Math.sin(flame * 0.4), 14);
  ctx.translate(0, pickupBob(loopT, phase));
  paintFlame(ctx, flame);
  ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 6;
  ctx.fillStyle = '#FF7A1F'; ctx.fillRect(-7, -0.5, 14, 1);
  ctx.fillStyle = '#FFB400'; arrowHead(ctx, 7);
  ctx.shadowBlur = 0;
}

/**
 * Three layers at one spot: orange body, amber inside, white heart. The stack
 * is what makes a blob read as fire rather than as a coloured dot — one layer
 * alone never does, however brightly it is drawn.
 */
function paintFlame(ctx: CanvasRenderingContext2D, phase: number): void {
  ctx.shadowColor = '#FF7A1F'; ctx.shadowBlur = 12 + 4 * Math.sin(phase);
  ctx.fillStyle = '#FF7A1F';
  ctx.beginPath();
  // Clamped: the sine takes the radius negative otherwise, which throws.
  ctx.ellipse(-9, 0, Math.max(0.5, 3 + Math.sin(phase)), 4 + 0.5 * Math.sin(phase * 1.3), 0, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#FFB400';
  ctx.beginPath(); ctx.ellipse(-9, 0, 2, 3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(-9, 0, 0.8 + 0.4 * Math.sin(phase * 2), 0, TAU); ctx.fill();
}

/** Gold diamond. Not arrow-shaped, because it changes what you survive, not
 *  what you shoot. */
function paintShieldPickup(ctx: CanvasRenderingContext2D, loopT: number, phase: number): void {
  const blink = loopT * 4 + phase;
  const glow = 8 + 5 * Math.sin(blink);
  paintPedestal(ctx, '#FFB400', 13 + Math.sin(blink), 0.20 + 0.12 * Math.sin(blink), glow);
  ctx.translate(0, pickupBob(loopT, phase));
  ctx.shadowColor = '#FFB400'; ctx.shadowBlur = glow;
  ctx.fillStyle = '#FFB400';
  ctx.beginPath();
  ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  // Highlight up and left of centre, mid-stripe across: together they give the
  // flat diamond a facet, which is what separates it from the halo behind it.
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(-1.5, -2, 2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#FF7A1F';
  ctx.beginPath();
  ctx.moveTo(0, -3); ctx.lineTo(4, 0); ctx.lineTo(0, 3); ctx.lineTo(-4, 0);
  ctx.closePath(); ctx.fill();
}

/**
 * The plain crow. The white and aggro variants were boss-fight state, and the
 * arena has no boss, so they are not ported.
 */
const CROW = {
  body: '#0A0A0A',
  edge: '#1F1F1F',
  beak: '#FFB400',
  eye: '#FFB400',
  glint: '#FF1F1F',
} as const;

/**
 * Draws one crow, facing -x because crows cross the arena leftwards.
 *
 * The only glow on the bird is its eye, and that comes from a pre-baked stamp,
 * so a whole flock draws without a single live shadowBlur pass.
 */
export function drawCrow(
  ctx: CanvasRenderingContext2D,
  v: CrowVisual,
  loopT: number,
  hudHeight: number,
): void {
  ctx.save();
  ctx.translate(v.x, v.y + hudHeight);
  ctx.shadowBlur = 0;
  // The wing phase doubles as the body phase: a bird whose bob is unrelated to
  // its flapping looks like two animations played over one sprite.
  const bobY = 0.8 * Math.sin(loopT * 3 + v.wingPhase);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 6, 7, 1.8, 0, 0, TAU); ctx.fill();
  paintCrowBody(ctx, bobY);
  // Far wing half a cycle behind the near one, so the two ellipses read as one
  // bird flapping instead of as a body bouncing between two fins.
  paintCrowWing(ctx, -3, bobY, v.wingPhase + Math.PI);
  paintCrowWing(ctx, 3, bobY, v.wingPhase);
  paintCrowHead(ctx, bobY);
  ctx.restore();
}

/** Body and the tail wedge that trails behind it. */
function paintCrowBody(ctx: CanvasRenderingContext2D, bobY: number): void {
  ctx.fillStyle = CROW.body;
  ctx.beginPath(); ctx.ellipse(0, bobY, 8, 5, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = CROW.edge; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, bobY, 8, 5, 0, 0, TAU); ctx.stroke();
  ctx.fillStyle = CROW.body;
  ctx.beginPath();
  ctx.moveTo(6, bobY + 1); ctx.lineTo(11, bobY - 2); ctx.lineTo(11, bobY + 4);
  ctx.closePath(); ctx.fill();
}

/** One wing: it lifts and tilts on the same phase, which is what a flap is. */
function paintCrowWing(
  ctx: CanvasRenderingContext2D,
  x: number,
  bobY: number,
  phase: number,
): void {
  const y = bobY - 2 + Math.sin(phase) * 3;
  const tilt = -0.4 + 0.5 * Math.sin(phase);
  ctx.fillStyle = CROW.body;
  ctx.beginPath(); ctx.ellipse(x, y, 8, 3, tilt, 0, TAU); ctx.fill();
  ctx.strokeStyle = CROW.edge; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(x, y, 8, 3, tilt, 0, TAU); ctx.stroke();
}

/** Beak and eye. The lit eye is the only thing that tells you it is facing you. */
function paintCrowHead(ctx: CanvasRenderingContext2D, bobY: number): void {
  ctx.fillStyle = CROW.beak;
  ctx.beginPath();
  ctx.moveTo(-9, bobY - 0.5); ctx.lineTo(-13, bobY); ctx.lineTo(-9, bobY + 1.5);
  ctx.closePath(); ctx.fill();
  const eye = glowDotStamp(CROW.eye, 1.2, 3);
  ctx.drawImage(eye, -6 - eye.width / 2, bobY - 1.5 - eye.height / 2);
  ctx.fillStyle = CROW.glint;
  ctx.fillRect(-6, bobY - 1.5, 1, 1);
}
