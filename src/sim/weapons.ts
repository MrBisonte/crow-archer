/**
 * What each character fights with.
 *
 * A weapon is a strategy: the player holds one, and swapping character swaps
 * the weapon rather than adding a branch to the world. Adding a fourth
 * character is a new implementation here and a line in the factory, not an edit
 * to anything that already works.
 *
 * Weapons are pure. Using one returns what it created and changes nothing, so
 * the whole of combat's opening move is testable without a world, a map or a
 * socket. The world decides what to do with what comes back.
 *
 * ## Where the numbers come from
 *
 * The single-player game has no player-versus-player damage at all: crows die
 * to one hit of anything, and every damage constant in CONFIG is boss damage.
 * So PvP damage is designed here rather than copied, using the legacy figures
 * as the game's own statement of what each weapon is worth.
 *
 * The legacy rhythm is "about five hits to kill": the archer's boss has 5 HP
 * and arrows do 1. A player has 10 HP, so an arrow does 2 and that rhythm
 * survives. The others are then set against the archer rather than against the
 * boss, because the boss is a stationary sponge and a player is not.
 */

import type { CharacterKind, GameMode } from '../net/protocol';
import { ticks } from './tick';

/** What using a weapon produced. The world turns these into world state. */
export type WeaponEffect =
  | { kind: 'shot'; shot: ShotSpec }
  | { kind: 'swing'; swing: SwingSpec };

/** A projectile about to exist. */
export interface ShotSpec {
  /** Which projectile behaviour this is. Drawing and terrain rules follow it. */
  flavour: ShotFlavour;
  speed: number;
  damage: number;
  /** Ticks before it is culled, whatever it has not hit. */
  lifeTicks: number;
  /** Radius used against bodies. */
  radius: number;
  /** Turn rate in radians per second. Zero for a projectile that flies straight. */
  homingRate: number;
  /** Whether hitting something solid ends it or turns it around. */
  onTerrain: TerrainResponse;
  /** Whether water puts it out. Only a thrown thing sinks. */
  drownsInWater: boolean;
}

export type ShotFlavour = 'arrow' | 'bolt' | 'dynamite';

/**
 * What terrain does to a shot.
 *
 * Data rather than a branch on flavour, so a projectile that bounces is a
 * different value here and not another `if` in the world's step.
 */
export type TerrainResponse = 'stop' | 'bounce';

/** A melee swing about to begin. */
export interface SwingSpec {
  /** How far the tip reaches at rest, before the thrust extends it. */
  reach: number;
  /** How much further the thrust pushes the tip at the peak of the swing. */
  thrust: number;
  /** Radius of the probe circles that decide a hit. */
  radius: number;
  durationTicks: number;
  /** Damage per strike. The swing lands twice, so a full swing is double this. */
  damage: number;
}

export interface Weapon {
  readonly kind: ShotFlavour | 'spear';
  /** Ticks between uses. */
  readonly cooldownTicks: number;
  /**
   * What comes of using it.
   *
   * No aim is passed in. A weapon describes what it makes; the world aims it,
   * because the world is what knows where the user is standing and which way
   * they are looking. That also keeps every weapon a pure constant function.
   */
  use(): WeaponEffect[];
}

// ---------------------------------------------------------------------------
// Shared numbers
// ---------------------------------------------------------------------------

/** A player has ten hit points, which is what every figure below is set against. */
export const ARROW_DAMAGE = 2;
export const BOLT_DAMAGE = 3;
export const SPEAR_DAMAGE = 2;
export const DYNAMITE_DAMAGE = 4;

/** Blast radius of a stick of dynamite. Straight from the legacy CONFIG. */
export const DYNAMITE_BLAST_RADIUS = 90;

/**
 * How near a shot has to pass to count as a hit.
 *
 * Larger than the projectile looks, and deliberately so. Everyone else is drawn
 * a tenth of a second in the past, which at a walking pace of 200 px/s is 20 px
 * behind where the server has them. A player aims at what is on screen, so a
 * hit window narrower than that offset means a perfectly aimed shot misses and
 * the game feels broken. Twelve plus the body's eight covers it.
 */
export const ARROW_RADIUS = 12;
export const BOLT_RADIUS = 12;

/**
 * How far the spear reaches at rest, and how much further the thrust pushes it.
 *
 * Exported because the renderer has to draw the same weapon the simulation is
 * swinging. A spear that looked shorter than it hit would be unreadable, and
 * two copies of the number is how that happens.
 */
export const SPEAR_REACH = 80;
export const SPEAR_THRUST = 22;

/** Fuse, in ticks. `dynamiteLifetime: 1.5` in the legacy CONFIG. */
export const DYNAMITE_FUSE_TICKS = ticks(1.5);

/**
 * Throw speed at no charge, and the multiplier a full charge adds.
 *
 * The legacy figures are 336 and three times that at full charge. Both are 30%
 * slower here: at full speed a stick crossed half the map before anyone could
 * react to it, and a grenade you cannot see coming is not a decision.
 */
export const DYNAMITE_SPEED = Math.round(336 * 0.7);
export const DYNAMITE_CHARGE_MULTIPLIER = 3;

/** How long a full charge takes to wind up. One second, as in the legacy game. */
export const DYNAMITE_CHARGE_TICKS = ticks(1);

/**
 * How much speed a stick keeps when it comes off a wall.
 *
 * The legacy figure is 0.65, and against a boss that never moved it did not
 * matter where the thing ended up. It matters here: at 0.65 a stick thrown into
 * a tree rebounded most of the way back and went off where it came from, so the
 * one tile it never cleared was the one it hit. A third of its speed still reads
 * as a ricochet and leaves it beside what stopped it.
 */
export const DYNAMITE_BOUNCE = 0.35;

/**
 * Speed a thrown stick keeps each tick, the legacy `0.985` per frame.
 *
 * Without it a stick that bounced kept every bit of its speed and ping-ponged
 * across the map until the fuse ran out, so it never went off near the tree it
 * hit and nothing ever burned. Drag is what makes it settle where it landed.
 */
export const DYNAMITE_DRAG = 0.985;

/**
 * Below this speed a thrown stick has stopped, and goes off where it lies.
 *
 * Without it a stick that struck a tree bounced away and detonated back where
 * it came from, so the tree it hit was the one thing the blast never reached:
 * aiming at a thicket cleared nothing. A stick that comes to rest against what
 * stopped it blows that up, which is both what a player expects and the only
 * way ricochet and burning terrain can both be true.
 */
export const DYNAMITE_REST_SPEED = 50;

/** Sticks a player carries into a match. `resources.dynamites.max` at fast pace. */
export const DYNAMITE_CARRIED = 4;

// ---------------------------------------------------------------------------
// The three weapons
// ---------------------------------------------------------------------------

/**
 * The archer's bow. Fast, straight, and the weakest per hit.
 *
 * Legacy arrows have no cooldown at all, capped instead at five in flight. That
 * works against crows and would be a wall of arrows in a duel, so the cap
 * becomes a cooldown: five hits to kill at this rate is about a second and
 * three quarters of uninterrupted hits, which is the fastest kill in the game
 * and the reason the archer's damage is the lowest.
 */
export class Bow implements Weapon {
  readonly kind = 'arrow' as const;
  readonly cooldownTicks = ticks(0.35);

  use(): WeaponEffect[] {
    return [
      {
        kind: 'shot',
        shot: {
          flavour: 'arrow',
          speed: 500,          // arrowSpeed
          damage: ARROW_DAMAGE,
          lifeTicks: ticks(1.5), // arrowLifetime
          radius: ARROW_RADIUS,
          homingRate: 0,
          onTerrain: 'stop',
          drownsInWater: false,
        },
      },
    ];
  }
}

/**
 * The wizard's staff. Slow, hard-hitting, and it steers.
 *
 * The legacy cooldown is two full seconds, which is bearable against a boss
 * that cannot dodge and hopeless against a player who can. It comes down to
 * 1.2, and the bolt keeps its homing, so the wizard trades the archer's rate of
 * fire for shots that are hard to simply walk away from.
 */
export class Staff implements Weapon {
  readonly kind = 'bolt' as const;
  readonly cooldownTicks = ticks(1.2);

  use(): WeaponEffect[] {
    return [
      {
        kind: 'shot',
        shot: {
          flavour: 'bolt',
          speed: 468,            // wizBoltSpeed
          damage: BOLT_DAMAGE,
          lifeTicks: ticks(3.5), // wizBoltLifetime
          radius: BOLT_RADIUS,
          homingRate: 4.5,       // wizBoltTurnRate
          onTerrain: 'stop',
          drownsInWater: false,
        },
      },
    ];
  }
}

/**
 * The knight's spear. Nothing at range, decisive in reach.
 *
 * The swing lands twice, which is the double strike the legacy game intends and
 * fails to deliver: it never resets the phase-two flag, so only the first swing
 * of a run ever hits twice. Here both strikes land on every swing, which is
 * what makes closing the distance worth the walk.
 */
export class Spear implements Weapon {
  readonly kind = 'spear' as const;
  readonly cooldownTicks = ticks(1.0); // knightSpearCooldown

  use(): WeaponEffect[] {
    return [
      {
        kind: 'swing',
        swing: {
          reach: SPEAR_REACH,
          thrust: SPEAR_THRUST,
          radius: 22,              // the probe radius, hardcoded in legacy
          durationTicks: ticks(0.35), // knightSpearSwingDuration
          damage: SPEAR_DAMAGE,
        },
      },
    ];
  }
}

/**
 * Dynamite, which everyone can throw but not always.
 *
 * It is the archer's second weapon in the single-player game. In a duel it is
 * the strongest thing on the field, so the other two only carry it where
 * everyone is armed the same way: in player versus player. Handing a knight a
 * blast radius against crows would not be a fight.
 */
export class DynamitePouch {
  readonly kind = 'dynamite' as const;
  readonly cooldownTicks = ticks(0.8);

  use(): WeaponEffect[] {
    return [
      {
        kind: 'shot',
        shot: {
          flavour: 'dynamite',
          speed: DYNAMITE_SPEED,
          damage: DYNAMITE_DAMAGE,
          lifeTicks: DYNAMITE_FUSE_TICKS,
          radius: BOLT_RADIUS,
          homingRate: 0,
          // Off walls and trees, and out in water.
          onTerrain: 'bounce',
          drownsInWater: true,
        },
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** The weapon a character fights with. One line per character, and no branch. */
const PRIMARY: Record<CharacterKind, () => Weapon> = {
  archer: () => new Bow(),
  wizard: () => new Staff(),
  knight: () => new Spear(),
};

export function primaryWeapon(character: CharacterKind): Weapon {
  return PRIMARY[character]();
}

/**
 * May this character throw dynamite in this mode?
 *
 * The archer always carries it, because it is part of the archer. Everyone else
 * carries it only in player versus player, where the answer to a stick of
 * dynamite is another stick of dynamite.
 */
export function carriesDynamite(character: CharacterKind, mode: GameMode): boolean {
  return character === 'archer' || mode === 'deathmatch';
}
