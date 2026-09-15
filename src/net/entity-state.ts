/**
 * What the single `state` number on an entity means.
 *
 * A snapshot carries six numbers per entity, twenty times a second, to every
 * client. Drawing a player properly needs more than that: which way they face,
 * whether the shield is up, whether they are down, and how far through a swing
 * they are. Adding four fields to the entity would widen the message that
 * repeats most.
 *
 * So they are packed into the number that is already there. Packing is a real
 * cost, and it is paid here once, with tests, rather than as bit shifts spread
 * across the server and the renderer where the two could quietly disagree.
 */

/** Bits 0 and 1: what the body is doing. */
export const PlayerFlag = {
  DEAD: 1,
  SHIELDED: 2,
} as const;

/** Aim is quantised to a byte: 256 steps is 1.4 degrees, finer than anyone aims. */
const AIM_STEPS = 256;
const AIM_SHIFT = 2;

/** Swing progress gets 4 bits, so a swing is drawn in sixteenths. */
const SWING_STEPS = 16;
const SWING_SHIFT = 10;

/**
 * Rounds left of whichever secondary this character carries, in 3 bits.
 *
 * On the wire because it is the server's count, and a player who cannot see
 * how many they have cannot tell they have any: the weapon may as well not
 * exist. One field regardless of which secondary it is, since a fighter only
 * ever carries one: dynamite for most, the satchel for the ranger.
 */
export const SECONDARY_AMMO_MAX = 7;
const SECONDARY_AMMO_SHIFT = 14;

/**
 * What a body is doing with its THIRD ability, in two bits.
 *
 * An enum and not two flags, because these are phases of one ability and a
 * body can only be in one of them: a knight winding up a charge is not also
 * dashing it. Both phases change what the body may do — winding roots it,
 * surging carries it and makes it briefly untouchable — so a client that
 * cannot see them draws someone standing still who is not, and draws someone
 * crossing the map with no reason given.
 *
 * `WINDING` is the knight's charge held and the archer's draw held. `SURGING`
 * is the knight's dash running and the wizard's blink i-frames; one is a body
 * travelling fast and the other a body that has just arrived, and what they
 * share is the part a client has to draw — brief, committed, untouchable.
 */
export const AbilityPhase = {
  NONE: 0,
  WINDING: 1,
  SURGING: 2,
} as const;

export type AbilityPhase = (typeof AbilityPhase)[keyof typeof AbilityPhase];

const ABILITY_SHIFT = SECONDARY_AMMO_SHIFT + 3;
const ABILITY_MASK = 0b11;

/**
 * Whether the ranger has this body marked, in the one bit above the phase.
 *
 * A flag and not a phase: being marked is something done TO a body by someone
 * else, so it can be true at the same time as anything that body is doing.
 * On the wire for the reason `secondaryAmmo` is: a mark nobody can see is a
 * mark that costs the ranger a full meter and tells the fight nothing.
 */
const MARKED_BIT = 1 << (ABILITY_SHIFT + 2);

const TAU = Math.PI * 2;

export interface PlayerVisualState {
  dead: boolean;
  shielded: boolean;
  /** Absolute aim angle in radians. Any value; it is normalised on the way in. */
  aim: number;
  /** 0 when not swinging, otherwise how far through the swing, 0 to 1. */
  swing: number;
  /** Rounds of the secondary weapon left. Zero for anyone not carrying one. */
  secondaryAmmo: number;
  /** Which phase of the third ability this body is in. */
  ability: AbilityPhase;
  /** Whether a ranger currently has this body marked. */
  marked: boolean;
}

/** Packs a player's drawable state into the one number the snapshot carries. */
export function packPlayerState(v: PlayerVisualState): number {
  const flags = (v.dead ? PlayerFlag.DEAD : 0) | (v.shielded ? PlayerFlag.SHIELDED : 0);
  // Normalised into [0, TAU) first, because a negative angle would shift a
  // sign bit into the flags and turn a live player into a dead one.
  const turns = ((v.aim % TAU) + TAU) % TAU / TAU;
  const aim = Math.min(AIM_STEPS - 1, Math.floor(turns * AIM_STEPS));
  const swing = Math.min(SWING_STEPS - 1, Math.max(0, Math.floor(v.swing * SWING_STEPS)));
  const rounds = Math.min(SECONDARY_AMMO_MAX, Math.max(0, Math.floor(v.secondaryAmmo)));
  return (
    flags |
    (aim << AIM_SHIFT) |
    (swing << SWING_SHIFT) |
    (rounds << SECONDARY_AMMO_SHIFT) |
    (v.ability << ABILITY_SHIFT) |
    (v.marked ? MARKED_BIT : 0)
  );
}

/** Reads back what packPlayerState wrote. */
export function unpackPlayerState(state: number): PlayerVisualState {
  const aim = (state >> AIM_SHIFT) & (AIM_STEPS - 1);
  const swing = (state >> SWING_SHIFT) & (SWING_STEPS - 1);
  return {
    dead: (state & PlayerFlag.DEAD) !== 0,
    shielded: (state & PlayerFlag.SHIELDED) !== 0,
    aim: (aim / AIM_STEPS) * TAU,
    swing: swing / SWING_STEPS,
    secondaryAmmo: (state >> SECONDARY_AMMO_SHIFT) & SECONDARY_AMMO_MAX,
    ability: ((state >> ABILITY_SHIFT) & ABILITY_MASK) as AbilityPhase,
    marked: (state & MARKED_BIT) !== 0,
  };
}

/**
 * What a projectile's `state` carries: the team that fired it, and which kind
 * it is, so an incoming shot reads as both dangerous and theirs.
 */
export const ShotFlavourCode = {
  ARROW: 0,
  BOLT: 1,
  DYNAMITE: 2,
  SATCHEL: 3,
  /**
   * The sapper's third-key round: fast, straight, spent on the first thing it
   * touches, and the one thing that sets off his own live charge early.
   */
  SHOCK: 4,
} as const;

export type ShotFlavourCode = (typeof ShotFlavourCode)[keyof typeof ShotFlavourCode];

export interface ShotWireState {
  team: 0 | 1;
  flavour: ShotFlavourCode;
  /** Direction of travel, so the client can point it the right way. */
  aim: number;
  /**
   * 0 to 1 counting up to something about to go off, 0 for anything without
   * one. A burning fuse for dynamite; an armed satchel's countdown to its
   * own detonation. Zero also means an unarmed satchel, so a thrown one shows
   * no countdown until the second click starts it.
   */
  fuse: number;
  /**
   * Whether it was fired while alight. Drawn differently and it hits harder, so
   * an opponent can see a fire arrow coming and treat it as one.
   */
  fiery: boolean;
}

/**
 * The flavour field, and why it is three bits rather than the two it was.
 *
 * Four flavours fitted a 2-bit field exactly, which is another way of saying a
 * fifth one silently aliased onto the first: `4 & 0b11` is 0, so the sapper's
 * piercing shot would have unpacked as an arrow with nothing to say it had.
 * Widening moves every field above it along by one, which is why the shifts
 * below are derived from the widths rather than written out — a field that
 * grows again should not need four numbers edited in step.
 */
const FLAVOUR_SHIFT = 1;
const FLAVOUR_BITS = 3;
const FLAVOUR_MASK = (1 << FLAVOUR_BITS) - 1;
const FUSE_STEPS = 16;
const FUSE_SHIFT = FLAVOUR_SHIFT + FLAVOUR_BITS;
const SHOT_AIM_SHIFT = FUSE_SHIFT + 4;
const SHOT_FIERY_BIT = 1 << (SHOT_AIM_SHIFT + 8);

export function packShotState(v: ShotWireState): number {
  const turns = ((v.aim % TAU) + TAU) % TAU / TAU;
  const aim = Math.min(AIM_STEPS - 1, Math.floor(turns * AIM_STEPS));
  const fuse = Math.min(FUSE_STEPS - 1, Math.max(0, Math.floor(v.fuse * FUSE_STEPS)));
  return (
    v.team |
    (v.flavour << FLAVOUR_SHIFT) |
    (fuse << FUSE_SHIFT) |
    (aim << SHOT_AIM_SHIFT) |
    (v.fiery ? SHOT_FIERY_BIT : 0)
  );
}

export function unpackShotState(state: number): ShotWireState {
  return {
    team: (state & 1) as 0 | 1,
    flavour: ((state >> FLAVOUR_SHIFT) & FLAVOUR_MASK) as ShotFlavourCode,
    fuse: ((state >> FUSE_SHIFT) & (FUSE_STEPS - 1)) / FUSE_STEPS,
    aim: (((state >> SHOT_AIM_SHIFT) & (AIM_STEPS - 1)) / AIM_STEPS) * TAU,
    fiery: (state & SHOT_FIERY_BIT) !== 0,
  };
}
