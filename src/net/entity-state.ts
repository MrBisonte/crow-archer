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
 * Sticks of dynamite left, in 3 bits.
 *
 * On the wire because it is the server's count, and a player who cannot see how
 * many they have cannot tell they have any: the weapon may as well not exist.
 */
const DYNAMITE_MAX = 7;
const DYNAMITE_SHIFT = 14;

const TAU = Math.PI * 2;

export interface PlayerVisualState {
  dead: boolean;
  shielded: boolean;
  /** Absolute aim angle in radians. Any value; it is normalised on the way in. */
  aim: number;
  /** 0 when not swinging, otherwise how far through the swing, 0 to 1. */
  swing: number;
  /** Sticks of dynamite left. Zero for anyone not carrying any. */
  dynamite: number;
}

/** Packs a player's drawable state into the one number the snapshot carries. */
export function packPlayerState(v: PlayerVisualState): number {
  const flags = (v.dead ? PlayerFlag.DEAD : 0) | (v.shielded ? PlayerFlag.SHIELDED : 0);
  // Normalised into [0, TAU) first, because a negative angle would shift a
  // sign bit into the flags and turn a live player into a dead one.
  const turns = ((v.aim % TAU) + TAU) % TAU / TAU;
  const aim = Math.min(AIM_STEPS - 1, Math.floor(turns * AIM_STEPS));
  const swing = Math.min(SWING_STEPS - 1, Math.max(0, Math.floor(v.swing * SWING_STEPS)));
  const sticks = Math.min(DYNAMITE_MAX, Math.max(0, Math.floor(v.dynamite)));
  return flags | (aim << AIM_SHIFT) | (swing << SWING_SHIFT) | (sticks << DYNAMITE_SHIFT);
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
    dynamite: (state >> DYNAMITE_SHIFT) & DYNAMITE_MAX,
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
} as const;

export type ShotFlavourCode = (typeof ShotFlavourCode)[keyof typeof ShotFlavourCode];

export interface ShotWireState {
  team: 0 | 1;
  flavour: ShotFlavourCode;
  /** Direction of travel, so the client can point it the right way. */
  aim: number;
  /** 0 to 1 for a burning fuse, 0 for anything without one. */
  fuse: number;
}

const FLAVOUR_SHIFT = 1;
const FUSE_STEPS = 16;
const FUSE_SHIFT = 3;
const SHOT_AIM_SHIFT = 7;

export function packShotState(v: ShotWireState): number {
  const turns = ((v.aim % TAU) + TAU) % TAU / TAU;
  const aim = Math.min(AIM_STEPS - 1, Math.floor(turns * AIM_STEPS));
  const fuse = Math.min(FUSE_STEPS - 1, Math.max(0, Math.floor(v.fuse * FUSE_STEPS)));
  return v.team | (v.flavour << FLAVOUR_SHIFT) | (fuse << FUSE_SHIFT) | (aim << SHOT_AIM_SHIFT);
}

export function unpackShotState(state: number): ShotWireState {
  return {
    team: (state & 1) as 0 | 1,
    flavour: ((state >> FLAVOUR_SHIFT) & 0b11) as ShotFlavourCode,
    fuse: ((state >> FUSE_SHIFT) & (FUSE_STEPS - 1)) / FUSE_STEPS,
    aim: (((state >> SHOT_AIM_SHIFT) & (AIM_STEPS - 1)) / AIM_STEPS) * TAU,
  };
}
