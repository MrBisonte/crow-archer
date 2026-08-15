/**
 * What a crow leaves behind, and what picking it up does.
 *
 * Each kind is a strategy applied to whoever walked over it, so adding a
 * powerup is a new entry rather than a branch inside the world's step. The
 * world knows a body touched a pickup; it does not know what any of them mean.
 */

import { ticks } from './tick';

/**
 * The kinds that drop.
 *
 * The single-player game has a third, `ricochet`, whose whole point is arrows
 * that bounce off terrain. That is a projectile behaviour rather than a stat,
 * and it is not built here yet, so it is not dropped: an inert pickup that
 * teaches players it does nothing is worse than one fewer kind.
 */
export type PickupKind = 'shield' | 'fire';

/** The kinds a drop rolls between, in the order the roll walks them. */
export const DROPPED_KINDS: readonly PickupKind[] = ['shield', 'fire'];

/**
 * How long a fire powerup lasts, and what it does while it burns.
 *
 * Three seconds at half again the damage. Short enough that it is a window to
 * use rather than a state to sit in, which is what eight seconds at double had
 * become: long enough to win a fight on its own.
 */
export const FIRE_DURATION_TICKS = ticks(3);
export const FIRE_DAMAGE_MULTIPLIER = 1.5;

/** How close a body must be to sweep a pickup up. `pickupRadius: 20` in legacy. */
export const PICKUP_RADIUS = 20;

/** The part of a fighter a pickup is allowed to touch. */
export interface Empowerable {
  shielded: boolean;
  fireTicks: number;
}

/** Applying a kind. One entry per kind, and no branch anywhere else. */
const EFFECTS: Record<PickupKind, (target: Empowerable) => void> = {
  // Straight from the legacy rule: the shield is a boolean, and taking a second
  // one while still holding the first simply leaves it up.
  shield: (target) => {
    target.shielded = true;
  },
  // Refreshes rather than stacks, so two in quick succession cannot bank
  // sixteen seconds of double damage.
  fire: (target) => {
    target.fireTicks = FIRE_DURATION_TICKS;
  },
};

export function applyPickup(kind: PickupKind, target: Empowerable): void {
  EFFECTS[kind](target);
}
