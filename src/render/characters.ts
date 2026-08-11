/**
 * Player character art: archer, wizard, knight.
 *
 * The single-player game drew one body straight out of module globals — the
 * `player` object, the inventory, and a dozen cooldown timers were all in
 * scope, so the art reached for whatever it wanted. Multiplayer draws up to
 * four bodies in one frame and none of them is "the" player, so every value
 * the art reads arrives as a parameter and this module keeps no mutable state.
 *
 * What is drawn is the body and the weapon in its hands, nothing else. The
 * rings, bars and aim lines the legacy art carried were local-player HUD in a
 * costume: they say what *you* may do next, which means nothing painted on
 * somebody else. Those stay with the HUD.
 */

import {
  SPEAR_REACH as SIM_SPEAR_REACH,
  SPEAR_THRUST as SIM_SPEAR_THRUST,
} from '../sim/weapons';
import { TEAM_COLOURS } from './palette';
import type { CharacterKind } from '../net/protocol';

/** Everything needed to draw one character. All positions are world pixels. */
export interface CharacterVisual {
  x: number;
  y: number;
  character: CharacterKind;
  /** 1 faces right, -1 faces left. */
  facing: 1 | -1;
  /** Absolute world-space aim angle in radians. */
  aimAngle: number;
  /** Accumulates while moving; drives the walk animation. */
  walkPhase: number;
  /** 0 or 1. Tints the two sides apart. */
  team: 0 | 1;
  /** True while the shield is up. Draws the amber halo. */
  shielded: boolean;
  /** True while down and waiting to respawn. Draw a faded/collapsed body. */
  dead: boolean;
  /** 0 while not swinging, else 0..1 through a melee swing. Knight only. */
  swingProgress: number;
  /** Seconds of hit flash remaining, 0 when not flashing. */
  hitFlash: number;
}

/**
 * Draws one character. `loopT` is the wall clock in seconds, used for idle
 * shimmer. `hudHeight` is added to y, because the arena is drawn below the HUD.
 *
 * One save/restore pair wraps everything, which is what guarantees the caller
 * gets its context back untouched — alpha, shadow, line width and transform
 * included. Nothing inside may leave that pair unbalanced.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  v: CharacterVisual,
  loopT: number,
  hudHeight: number,
): void {
  const look = SILHOUETTES[v.character];
  ctx.save();
  ctx.translate(v.x, v.y + hudHeight);
  ctx.scale(v.facing, 1);
  // A downed body fades as a whole, shadow included, so it reads as scenery
  // rather than as a player who is about to act.
  if (v.dead) ctx.globalAlpha = DOWN_ALPHA;
  paintContactShadow(ctx, look);
  ctx.save();
  if (v.dead) collapse(ctx, look.shadowY);
  PAINTERS[v.character](ctx, poseOf(v, loopT));
  ctx.restore();
  // The halo goes on last so it reads as a shell around the body, not a ring
  // the body is standing in.
  if (v.shielded) paintShieldHalo(ctx, loopT, look);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Shared values
// ---------------------------------------------------------------------------

/**
 * Team trim colours, indexed by team. Far apart in hue and both bright, since
 * the only thing anyone has time to read across an arena is which side a
 * silhouette belongs to. They tint trim, never a whole body: three characters
 * that look alike would cost more than two teams that look apart.
 */
/** One home for the two side colours, shared with the entity art and the HUD. */
const TEAM_TRIM = TEAM_COLOURS;

/** How much white a body takes on during a hit-flash frame. */
const FLASH_WASH = 0.7;

/** How far a downed body washes toward corpse grey. */
const DOWN_WASH = 0.75;

/** Alpha of a downed body. Visible enough to find, dim enough to ignore. */
const DOWN_ALPHA = 0.42;

/** Radians a downed body tips over. Short of flat, so the shape stays legible. */
const DOWN_TILT = 1.2;

const WHITE = '#FFFFFF';

const CORPSE_GREY = '#5A5A64';

/**
 * The knight's spear as the simulation understands it: `SwingSpec.reach` and
 * `SwingSpec.thrust` for the spear in src/sim/weapons.ts. The art has to agree
 * with the numbers that decide hits, or the game lies about who was in range.
 */
const SPEAR_REACH = SIM_SPEAR_REACH;
const SPEAR_THRUST = SIM_SPEAR_THRUST;

/** Shaft length. The leaf tip covers the rest of the reach. */
const SPEAR_SHAFT = SPEAR_REACH * 0.92;

/**
 * Per-character geometry the shared parts need. Bodies differ in size, so a
 * halo sized for the archer would sit inside the knight's breastplate, and one
 * contact shadow would be too small under one of them.
 */
interface Silhouette {
  shadowY: number;
  shadowRX: number;
  shadowRY: number;
  haloY: number;
  haloR: number;
}

const SILHOUETTES: Record<CharacterKind, Silhouette> = {
  archer: { shadowY: 9, shadowRX: 9, shadowRY: 2.5, haloY: -1, haloR: 16 },
  wizard: { shadowY: 11, shadowRX: 9, shadowRY: 2.5, haloY: 0, haloR: 16 },
  knight: { shadowY: 14, shadowRX: 13, shadowRY: 4, haloY: -6, haloR: 23 },
};

/**
 * What a painter is given. Built once per body so that no part recomputes it,
 * and so the parts stay pure functions of a pose rather than of a network
 * snapshot they would each have to interpret.
 */
interface Pose {
  /**
   * Aim angle in the mirrored local frame. Every sprite is authored facing
   * right and mirrored by a negative scale, so the art must not use the world
   * angle: at facing -1 the canvas has already flipped underneath it.
   */
  readonly aim: number;
  readonly walk: number;
  /** Wall clock in seconds. Idle shimmer only — nothing gameplay reads this. */
  readonly t: number;
  /** This side's trim colour. */
  readonly trim: string;
  /** 0..1 wash toward white, from the hit flash. */
  readonly white: number;
  /** 0..1 wash toward corpse grey, from being down. */
  readonly grey: number;
  /** 0..1 through a melee swing. A pose, not a weapon state: the body leans. */
  readonly swing: number;
}

function poseOf(v: CharacterVisual, loopT: number): Pose {
  // Blink at 10 Hz rather than holding the flash: a solid white body for a
  // fifth of a second reads as a graphical fault, a blinking one reads as pain.
  const flashing = v.hitFlash > 0 && Math.floor(v.hitFlash * 20) % 2 === 0;
  return {
    aim: v.facing === 1 ? v.aimAngle : Math.PI - v.aimAngle,
    walk: v.walkPhase,
    t: loopT,
    trim: TEAM_TRIM[v.team],
    white: flashing ? FLASH_WASH : 0,
    grey: v.dead ? DOWN_WASH : 0,
    swing: Math.max(0, Math.min(v.swingProgress, 1)),
  };
}

/**
 * Mixes a `#rrggbb` colour toward another. Values outside 0..1 are the
 * caller's problem; both washes here are clamped at construction.
 */
function mixHex(from: string, to: string, amount: number): string {
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    const a = parseInt(from.slice(i, i + 2), 16);
    const b = parseInt(to.slice(i, i + 2), 16);
    out += Math.round(a + (b - a) * amount)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

/**
 * The colour a body part is painted this frame.
 *
 * Being hit and being down are states of the whole body, so they are one
 * operation applied to every part rather than a second and third palette per
 * character — three characters times three palettes is nine places for a
 * colour to go stale. The untouched case returns the literal, so the common
 * frame parses nothing.
 */
function shade(p: Pose, hex: string): string {
  if (p.white === 0 && p.grey === 0) return hex;
  return mixHex(mixHex(hex, CORPSE_GREY, p.grey), WHITE, p.white);
}

/** One painter per character. A fourth character is a new entry, not a branch. */
const PAINTERS: Record<CharacterKind, (ctx: CanvasRenderingContext2D, p: Pose) => void> = {
  archer: paintArcher,
  wizard: paintWizard,
  knight: paintKnight,
};

// ---------------------------------------------------------------------------
// Shared parts
// ---------------------------------------------------------------------------

/** Without a contact shadow a sprite floats above the ground it stands on. */
function paintContactShadow(ctx: CanvasRenderingContext2D, look: Silhouette): void {
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.ellipse(0, look.shadowY, look.shadowRX, look.shadowRY, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Lays a downed body over, pivoting at the feet so it falls rather than sinks.
 * A body that simply vanished would take the one fact a team-mate wants with
 * it: where the fight was lost.
 */
function collapse(ctx: CanvasRenderingContext2D, feetY: number): void {
  ctx.translate(0, feetY);
  ctx.rotate(DOWN_TILT);
  ctx.translate(0, -feetY);
}

/**
 * Amber halo, same pulse for all three. The legacy game gave it to the archer
 * and wizard only, which made a shielded knight indistinguishable from one
 * about to die — a gap, so the knight gets one too.
 */
function paintShieldHalo(ctx: CanvasRenderingContext2D, loopT: number, look: Silhouette): void {
  const ph = loopT * 4;
  ctx.shadowColor = '#FFB400';
  ctx.shadowBlur = 14 + 5 * Math.sin(ph);
  ctx.strokeStyle = `rgba(255,180,0,${(0.6 + 0.3 * Math.sin(ph)).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, look.haloY, look.haloR + Math.sin(ph * 1.3), 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------------------
// Archer
// ---------------------------------------------------------------------------

function paintArcher(ctx: CanvasRenderingContext2D, p: Pose): void {
  // Cloak first, so the body covers its front edge.
  const sway = 0.15 * Math.sin(p.t * 2.2);
  const hem = 1.5 * Math.sin(p.walk + sway);
  ctx.beginPath();
  ctx.moveTo(-5, -3);
  ctx.bezierCurveTo(-9, 0, -9, 4, -7, 7 + hem);
  ctx.lineTo(7, 7 - hem);
  ctx.bezierCurveTo(9, 4, 9, 0, 5, -3);
  ctx.closePath();
  ctx.fillStyle = shade(p, '#0E1410');
  ctx.fill();
  // The cloak edge carries the team colour: it traces the whole silhouette, so
  // it is the one mark that reads from any angle.
  ctx.shadowColor = p.trim;
  ctx.shadowBlur = 3;
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Tunic and belt
  ctx.fillStyle = shade(p, '#3A5F88');
  ctx.fillRect(-5, -3, 10, 11);
  ctx.fillStyle = shade(p, '#0E1410');
  ctx.fillRect(-5, 3, 10, 1);
  paintArcherHead(ctx, p);
  paintBow(ctx, p);
}

function paintArcherHead(ctx: CanvasRenderingContext2D, p: Pose): void {
  ctx.fillStyle = shade(p, '#D9B98A');
  ctx.beginPath();
  ctx.arc(0, -8, 5, 0, Math.PI * 2);
  ctx.fill();
  // Flat hat: crown then brim
  ctx.fillStyle = shade(p, '#0E1410');
  ctx.fillRect(-5, -13, 10, 3);
  ctx.fillRect(-6, -10, 12, 1);
  ctx.fillStyle = p.trim;
  ctx.fillRect(-5, -13.5, 10, 1);
}

/** Bow arm, half-circle bow and string, all swung to the aim direction. */
function paintBow(ctx: CanvasRenderingContext2D, p: Pose): void {
  const gx = Math.cos(p.aim) * 8;
  const gy = Math.sin(p.aim) * 8;
  ctx.strokeStyle = shade(p, '#D9B98A');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(gx, gy);
  ctx.stroke();
  ctx.strokeStyle = shade(p, '#8A6028');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(gx, gy, 7, p.aim - Math.PI / 2, p.aim + Math.PI / 2);
  ctx.stroke();
  // String, drawn back to the nock. Legacy painted it phosphor green, which is
  // team 0's colour, so a trim-coloured string is the same picture for team 0.
  const top = { x: gx + Math.cos(p.aim - Math.PI / 2) * 7, y: gy + Math.sin(p.aim - Math.PI / 2) * 7 };
  const bot = { x: gx + Math.cos(p.aim + Math.PI / 2) * 7, y: gy + Math.sin(p.aim + Math.PI / 2) * 7 };
  const nock = { x: gx - Math.cos(p.aim) * 3, y: gy - Math.sin(p.aim) * 3 };
  ctx.shadowColor = p.trim;
  ctx.shadowBlur = 4;
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(nock.x, nock.y);
  ctx.lineTo(bot.x, bot.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

function paintWizard(ctx: CanvasRenderingContext2D, p: Pose): void {
  paintRobe(ctx, p);
  ctx.fillStyle = shade(p, '#D9B98A');
  ctx.beginPath();
  ctx.arc(0, -7, 5, 0, Math.PI * 2);
  ctx.fill();
  paintWizardHat(ctx, p);
  paintStaff(ctx, p);
}

function paintRobe(ctx: CanvasRenderingContext2D, p: Pose): void {
  // The hem swings against the stride, which is the whole gait: the wizard has
  // no legs to animate.
  const sway = 1.4 * Math.sin(p.walk * 0.7);
  ctx.beginPath();
  ctx.moveTo(-8, 13 + sway);
  ctx.lineTo(-6, -1);
  ctx.lineTo(6, -1);
  ctx.lineTo(8, 13 - sway);
  ctx.closePath();
  ctx.fillStyle = shade(p, '#14143A');
  ctx.fill();
  ctx.shadowColor = '#8888FF';
  ctx.shadowBlur = 3;
  ctx.strokeStyle = shade(p, '#4444AA');
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Centre stripe, team hem, amber emblem
  ctx.fillStyle = shade(p, '#22225A');
  ctx.fillRect(-4, 0, 8, 8);
  ctx.fillStyle = p.trim;
  ctx.fillRect(-4, 8, 8, 1.5);
  ctx.shadowColor = '#FFB400';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#FFB400';
  ctx.beginPath();
  ctx.arc(0, 3, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/** The hat wobbles on the wall clock, so a standing wizard is never a still image. */
function paintWizardHat(ctx: CanvasRenderingContext2D, p: Pose): void {
  const wobble = 1.6 * Math.sin(p.t * 1.9);
  ctx.fillStyle = shade(p, '#14143A');
  ctx.beginPath();
  ctx.moveTo(-7, -10);
  ctx.lineTo(0, -25 + wobble);
  ctx.lineTo(7, -10);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = '#8888FF';
  ctx.shadowBlur = 2;
  ctx.strokeStyle = shade(p, '#4444AA');
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Hat band in the team colour: the tallest part of the tallest character.
  ctx.fillStyle = p.trim;
  ctx.fillRect(-9, -12, 18, 2.5);
  ctx.fillStyle = '#FFB400';
  ctx.shadowColor = '#FFB400';
  ctx.shadowBlur = 5;
  ctx.fillRect(-0.5, -20 + wobble, 1, 1);
  ctx.shadowBlur = 0;
}

/** Staff arm out to the aim, with the orb pulsing on the end of it. */
function paintStaff(ctx: CanvasRenderingContext2D, p: Pose): void {
  const sx = Math.cos(p.aim) * 15;
  const sy = Math.sin(p.aim) * 15;
  ctx.strokeStyle = shade(p, '#5C3317');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(sx, sy);
  ctx.stroke();
  const op = p.t * 4.5;
  ctx.shadowColor = '#8888FF';
  ctx.shadowBlur = 10 + 4 * Math.sin(op);
  ctx.fillStyle = `rgba(136,136,255,${(0.85 + 0.15 * Math.sin(op)).toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(sx, sy, 4 + 0.5 * Math.sin(op), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(sx - 1, sy - 1, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------------------
// Knight
// ---------------------------------------------------------------------------

function paintKnight(ctx: CanvasRenderingContext2D, p: Pose): void {
  // Everything above the greaves bobs with the stride; the spear does not,
  // because a braced weapon that bounced would read as a stumble.
  const bob = Math.sin(p.walk) * 1.2;
  ctx.fillStyle = shade(p, '#1E2030');
  ctx.fillRect(-9, 7 + bob, 8, 10);
  ctx.fillRect(1, 7 + bob, 8, 10);
  ctx.fillStyle = shade(p, '#2A2C3E');
  ctx.fillRect(-8, 7 + bob, 3, 4);
  ctx.fillRect(2, 7 + bob, 3, 4);
  ctx.fillStyle = shade(p, '#242436');
  ctx.fillRect(-11, -13 + bob, 22, 20);
  ctx.fillStyle = shade(p, '#34364E');
  ctx.fillRect(-9, -12 + bob, 8, 7);
  ctx.fillStyle = shade(p, '#181826');
  ctx.fillRect(-15, -13 + bob, 6, 8);
  ctx.fillRect(9, -13 + bob, 6, 8);
  // Pauldron trim, the shoulder-height team mark
  ctx.fillStyle = p.trim;
  ctx.fillRect(-15, -13 + bob, 6, 1.5);
  ctx.fillRect(9, -13 + bob, 6, 1.5);
  ctx.fillStyle = shade(p, '#888888');
  ctx.beginPath();
  ctx.arc(-12, -10 + bob, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(12, -10 + bob, 1.2, 0, Math.PI * 2);
  ctx.fill();
  paintGreatHelm(ctx, p, bob);
  paintSpear(ctx, p);
}

function paintGreatHelm(ctx: CanvasRenderingContext2D, p: Pose, bob: number): void {
  ctx.fillStyle = shade(p, '#1E2030');
  ctx.fillRect(-8, -26 + bob, 16, 14);
  ctx.beginPath();
  ctx.arc(0, -26 + bob, 8, Math.PI, 0);
  ctx.fill();
  // Visor slits stay the knight's own green whatever the team, because they
  // are the one part that says the armour has somebody inside it.
  ctx.fillStyle = shade(p, '#39FF14');
  ctx.shadowColor = '#39FF14';
  ctx.shadowBlur = 5;
  ctx.fillRect(-6, -22 + bob, 12, 2);
  ctx.fillRect(-4, -18 + bob, 8, 2);
  ctx.shadowBlur = 0;
  // Plume: the highest point of the sprite and the clearest team read.
  ctx.fillStyle = p.trim;
  ctx.beginPath();
  ctx.moveTo(-3, -26 + bob);
  ctx.lineTo(0, -34 + bob);
  ctx.lineTo(3, -26 + bob);
  ctx.closePath();
  ctx.fill();
}

/**
 * Spear, thrust along the aim. The reach the tip appears to gain is the same
 * curve the simulation uses to decide the hit, so what looks like a near miss
 * was one.
 */
function paintSpear(ctx: CanvasRenderingContext2D, p: Pose): void {
  const push = Math.sin(p.swing * Math.PI) * SPEAR_THRUST;
  ctx.save();
  ctx.translate(Math.cos(p.aim) * push, Math.sin(p.aim) * push);
  ctx.rotate(p.aim);
  ctx.strokeStyle = shade(p, '#5A3A10');
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(SPEAR_SHAFT, 0);
  ctx.stroke();
  ctx.strokeStyle = shade(p, '#3A2008');
  ctx.lineWidth = 1.5;
  for (const x of [-4, 4, 12]) {
    ctx.beginPath();
    ctx.moveTo(x, -3);
    ctx.lineTo(x, 3);
    ctx.stroke();
  }
  paintSpearTip(ctx, p);
  ctx.fillStyle = shade(p, '#B0B0B8');
  ctx.beginPath();
  ctx.moveTo(-10, -3);
  ctx.lineTo(-16, 0);
  ctx.lineTo(-10, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Leaf spearhead. It flares white over the window where the strike lands. */
function paintSpearTip(ctx: CanvasRenderingContext2D, p: Pose): void {
  const striking = p.swing >= 0.2 && p.swing < 0.72;
  ctx.fillStyle = striking ? WHITE : shade(p, '#D0D0D8');
  if (striking) {
    ctx.shadowColor = WHITE;
    ctx.shadowBlur = 8;
  }
  ctx.beginPath();
  ctx.moveTo(SPEAR_SHAFT - 2, -5);
  ctx.lineTo(SPEAR_SHAFT + 16, 0);
  ctx.lineTo(SPEAR_SHAFT - 2, 5);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}
