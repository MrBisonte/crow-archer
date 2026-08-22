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
  | { kind: 'swing'; swing: SwingSpec }
  | { kind: 'burst'; burst: BurstSpec };

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
  /**
   * Whether slowing to a stop sets it off. True for dynamite, a fuse running
   * down is the point of it. False for the satchel, which is meant to be
   * found sitting there, inert, until armed or struck.
   */
  explodesAtRest: boolean;
  /** Whether water puts it out. Only a thrown thing sinks. */
  drownsInWater: boolean;
  /**
   * Angle in radians relative to the aim the world applies, for a weapon that
   * fires more than one shot per use. Zero, the default, means straight down
   * the aim line. The weapon still does not know the absolute angle, only its
   * own offset from whatever the world decides that is.
   */
  angleOffset?: number;
}

export type ShotFlavour = 'arrow' | 'bolt' | 'dynamite' | 'satchel';

/**
 * What terrain does to a shot.
 *
 * Data rather than a branch on flavour, so a projectile that bounces is a
 * different value here and not another `if` in the world's step.
 *
 * `'stop'` ends on contact, gone, the way an arrow does. `'bounce'` reflects
 * at reduced speed, the way a thrown stick of dynamite, or a satchel, does.
 * Whether it also explodes once that bounce decays to a stop is a separate
 * question, `explodesAtRest` answers it, not this.
 */
export type TerrainResponse = 'stop' | 'bounce';

/**
 * An area effect centred on whoever cast it, not a projectile: nothing
 * travels, and nothing can dodge it by breaking line of sight to where it
 * started. Lightning Storm and Whirlwind are both this — one instant, one
 * channelled over `durationTicks` — and the difference between them is
 * entirely in the numbers, not in a second shape.
 */
export interface BurstSpec {
  radius: number;
  /** Damage on whichever tick actually lands, not a total for the whole effect. */
  damage: number;
  /** Ticks between damage ticks while channelling. Unused when instant. */
  tickIntervalTicks: number;
  /** Zero means instant, resolved once on cast. Above zero channels this long. */
  durationTicks: number;
  /** Whether it also clears ROCK/TREE/HUT tiles in radius, the way a blast does. */
  destroysTerrain: boolean;
}

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
  readonly kind: ShotFlavour | 'spear' | 'storm' | 'whirlwind';
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

/**
 * Blast radius of a stick of dynamite. Straight from the legacy CONFIG.
 *
 * Shared with the satchel: the world's `#explode` does not ask a shot's
 * flavour how wide it hits, so this is every explosive's blast radius, not
 * only dynamite's.
 */
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

/**
 * Sticks the ranger's crossbow fires per use.
 *
 * Bolts are independent shots, each resolving its own hit, not one shot
 * worth three hits.
 */
export const CROSSBOW_BOLT_COUNT = 3;

/**
 * Damage of a single bolt, and the discrepancy it comes from.
 *
 * "30% less than the archer's 2 damage" is 1.4. The worked total that came
 * with it, 0.7 + 0.7 + 0.7 = 2.1, is not that: it is 0.7 a bolt. The two
 * disagree, and 0.7 is what is built, because it was computed explicitly and
 * repeated, and a burst that lands every pellet for 2.1 against a single
 * arrow's 2 is a coherent weapon on its own terms. If 1.4 was intended
 * instead, this is the one constant to change.
 *
 * Health stops being a whole number once this lands, since 0.7 does not
 * divide it evenly. The simulation keeps the fraction; only the display
 * rounds it.
 */
export const CROSSBOW_BOLT_DAMAGE = 0.7;

/** Hit radius of one bolt. 30% smaller than the archer's arrow, matching how
 * the dynamite throw's own "30% slower" was rounded. */
export const CROSSBOW_BOLT_RADIUS = Math.round(ARROW_RADIUS * 0.7);

/**
 * Angle between adjacent bolts in a burst.
 *
 * Not specified, so chosen narrow: wide enough that three overlapping bolts
 * read as three rather than one arrow drawn thrice on top of itself, narrow
 * enough that landing all three on one target is the common case at close
 * range, not a coincidence.
 */
export const CROSSBOW_SPREAD_RADIANS = Math.PI / 60; // 3 degrees

/**
 * How near the ranger's own bolt must pass to detonate their own satchel.
 *
 * Reuses the shared shot-hit radius rather than inventing a second number for
 * the same kind of question: how close counts as a hit.
 */
export const SATCHEL_TRIGGER_RADIUS = BOLT_RADIUS;

/**
 * Damage of a satchel's blast: 70% of dynamite's, rounded, the same cut the
 * ranger's crossbow bolt already takes against the archer's arrow. The blast
 * radius stays shared with dynamite's own `DYNAMITE_BLAST_RADIUS`; only the
 * damage is softer.
 */
export const SATCHEL_DAMAGE = Math.round(DYNAMITE_DAMAGE * 0.7);

/** Fixed throw speed. The satchel has no charge-and-hold: one click is one
 * throw, always at this speed. Reuses dynamite's own already-slowed figure
 * rather than inventing a second thrown-explosive speed. */
export const SATCHEL_THROW_SPEED = DYNAMITE_SPEED;

/** How long an armed satchel counts down before it goes off on its own. */
export const SATCHEL_ARM_FUSE_TICKS = ticks(3);

/**
 * How long a thrown, unarmed satchel sits before it quietly expires.
 *
 * Long enough that within any real match it reads as "stays until armed or
 * shot", not "times out". It is a backstop against an abandoned satchel
 * living forever, not a mechanic a player is meant to see.
 */
export const SATCHEL_IDLE_TICKS = ticks(60);

/** Satchels a player carries into a match. Matches dynamite's own count;
 * nothing in the request asked for a different number. */
export const SATCHEL_CARRIED = DYNAMITE_CARRIED;

/**
 * Direct damage of the sapper's powder charge, and why it is not dynamite's.
 *
 * The charge is thrown on the primary, over and over, where dynamite is a
 * tool spent four times a match. A stick's 4 damage on a repeatable attack
 * would kill in three hits without ever needing to be aimed at anyone, so
 * this comes down to the archer's arrow figure: 2, the same five-hits-to-kill
 * rhythm every other primary is set against. What the sapper keeps over the
 * archer is that a charge does not have to hit anybody — the blast radius is
 * `DYNAMITE_BLAST_RADIUS`, shared with every other explosive, because
 * `#explode` never asks what set it off.
 */
export const SAPPER_CHARGE_DAMAGE = ARROW_DAMAGE;

/**
 * How often a sapper can throw.
 *
 * Slower than every other primary except the wizard's staff, which stays the
 * slowest thing in the game at 1.2. An attack that damages an area and cannot
 * really miss has to be answered somewhere, and rate of fire is where: a
 * sapper throwing on the archer's 0.35 rhythm would simply be a better archer
 * with splash. It sits just under the staff rather than past it because the
 * staff also hits harder per shot and steers itself onto a target.
 */
export const SAPPER_CHARGE_COOLDOWN_TICKS = ticks(1.1);

// ---------------------------------------------------------------------------
// The weapons
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
          explodesAtRest: false,
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
          explodesAtRest: false,
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
 * The ranger's crossbow. Three weak bolts instead of the archer's one strong
 * arrow, fired on the same rhythm.
 *
 * Ammo, cooldown, speed and lifetime are the archer's own bow figures,
 * unchanged: the request was for the same mechanics in everything but the
 * burst, the size, and the damage.
 */
export class Crossbow implements Weapon {
  readonly kind = 'arrow' as const;
  readonly cooldownTicks = ticks(0.35);

  use(): WeaponEffect[] {
    const half = (CROSSBOW_BOLT_COUNT - 1) / 2;
    return Array.from({ length: CROSSBOW_BOLT_COUNT }, (_, i) => ({
      kind: 'shot' as const,
      shot: {
        flavour: 'arrow' as const,
        speed: 500,
        damage: CROSSBOW_BOLT_DAMAGE,
        lifeTicks: ticks(1.5),
        radius: CROSSBOW_BOLT_RADIUS,
        homingRate: 0,
        onTerrain: 'stop' as const,
        explodesAtRest: false,
        drownsInWater: false,
        angleOffset: (i - half) * CROSSBOW_SPREAD_RADIANS,
      },
    }));
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
          explodesAtRest: true,
          drownsInWater: true,
        },
      },
    ];
  }
}

/**
 * The ranger's satchel charge. Thrown inert, armed on command, and set off
 * early by the ranger's own bolt.
 *
 * One click is one throw, always at the same speed: there is no charge to
 * hold, unlike dynamite. What happens after the throw, arming a countdown or
 * detonating on a hit, is state the world tracks per shot, not something a
 * weapon this simple describes.
 */
export class Satchel implements Weapon {
  readonly kind = 'satchel' as const;
  readonly cooldownTicks = ticks(0.8);

  use(): WeaponEffect[] {
    return [
      {
        kind: 'shot',
        shot: {
          flavour: 'satchel',
          speed: SATCHEL_THROW_SPEED,
          damage: SATCHEL_DAMAGE,
          lifeTicks: SATCHEL_IDLE_TICKS,
          radius: SATCHEL_TRIGGER_RADIUS,
          homingRate: 0,
          // Bounces like dynamite; explodesAtRest:false is what keeps it from
          // going off just because it slowed to a stop.
          onTerrain: 'bounce',
          explodesAtRest: false,
          drownsInWater: true,
        },
      },
    ];
  }
}

/**
 * The sapper's powder charge. Everyone else's opening move travels to
 * someone; this one travels to a place and waits.
 *
 * Every figure but the damage is dynamite's own, and deliberately: the flight,
 * the bounce off walls, the fuse and the blast are all behaviour the world
 * already runs for `flavour: 'dynamite'`, so a sapper is a different rhythm
 * over proven mechanics rather than a second explosive to keep in step with
 * the first. What is not dynamite's is the hold: `DynamitePouch` is thrown by
 * a charged press that wounds up to three times the speed, and this is not —
 * one press is one throw, always the same arc, because a primary attack that
 * had to be held would be a secondary.
 */
export class PowderCharge implements Weapon {
  readonly kind = 'dynamite' as const;
  readonly cooldownTicks = SAPPER_CHARGE_COOLDOWN_TICKS;

  use(): WeaponEffect[] {
    return [
      {
        kind: 'shot',
        shot: {
          flavour: 'dynamite',
          speed: DYNAMITE_SPEED,
          damage: SAPPER_CHARGE_DAMAGE,
          lifeTicks: DYNAMITE_FUSE_TICKS,
          radius: BOLT_RADIUS,
          homingRate: 0,
          // Off walls and trees, out in water, and off wherever it stops:
          // this is what makes it a charge and not a slow arrow.
          onTerrain: 'bounce',
          explodesAtRest: true,
          drownsInWater: true,
        },
      },
    ];
  }
}

/**
 * The wizard's real secondary, replacing the dynamite stand-in.
 *
 * Legacy's storm is a 450px radius, five times dynamite's blast, and hits
 * everyone in it once for boss-tier damage. At that radius in this arena it
 * would catch nearly the whole map, so the one figure this does not carry
 * over is the radius: down to 180, big enough to threaten a contested area,
 * small enough that catching it requires actually closing on someone.
 * Damage matches dynamite's, since a single-target throw and a
 * whole-area-at-once hit dealing the same number is already the AoE's real
 * advantage — it does not also need to hit harder.
 */
export const STORM_BLAST_RADIUS = 180;
export const STORM_DAMAGE = DYNAMITE_DAMAGE;
export const STORM_COOLDOWN_TICKS = ticks(6);

/**
 * The knight's real secondary, replacing the dynamite stand-in.
 *
 * Legacy channels for 3 seconds, hitting everything in a 72px ring roughly
 * five times a second. A player has a third of a second of immunity after
 * any hit (IFRAME_TICKS), so a tick rate faster than that is not five hits,
 * it is one hit that keeps re-arriving exactly when immunity expires — the
 * legacy rate is kept as the closest approximation, and the real cadence a
 * caught target takes damage at is the iframe's, not this number's. Radius
 * trims slightly, to 70, for the same reason storm's does.
 */
export const WHIRLWIND_BLAST_RADIUS = 70;
export const WHIRLWIND_TICK_DAMAGE = 1;
export const WHIRLWIND_TICK_INTERVAL_TICKS = ticks(0.22);
export const WHIRLWIND_DURATION_TICKS = ticks(3);
export const WHIRLWIND_COOLDOWN_TICKS = ticks(6);

/**
 * The wizard's Lightning Storm. Instant: there is no wind-up and nothing
 * travels, so line of sight to where it lands is not something an opponent
 * can break by moving.
 */
export class LightningStorm implements Weapon {
  readonly kind = 'storm' as const;
  readonly cooldownTicks = STORM_COOLDOWN_TICKS;

  use(): WeaponEffect[] {
    return [
      {
        kind: 'burst',
        burst: {
          radius: STORM_BLAST_RADIUS,
          damage: STORM_DAMAGE,
          tickIntervalTicks: 0,
          durationTicks: 0,
          destroysTerrain: true,
        },
      },
    ];
  }
}

/**
 * The knight's Whirlwind. Channelled: the caster is committed to standing in
 * it for the full duration, the same way legacy's is, rather than a single
 * cast-and-walk-away hit.
 */
export class Whirlwind implements Weapon {
  readonly kind = 'whirlwind' as const;
  readonly cooldownTicks = WHIRLWIND_COOLDOWN_TICKS;

  use(): WeaponEffect[] {
    return [
      {
        kind: 'burst',
        burst: {
          radius: WHIRLWIND_BLAST_RADIUS,
          damage: WHIRLWIND_TICK_DAMAGE,
          tickIntervalTicks: WHIRLWIND_TICK_INTERVAL_TICKS,
          durationTicks: WHIRLWIND_DURATION_TICKS,
          destroysTerrain: true,
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
  ranger: () => new Crossbow(),
  sapper: () => new PowderCharge(),
};

export function primaryWeapon(character: CharacterKind): Weapon {
  return PRIMARY[character]();
}

/**
 * A character's second weapon, exhaustively. Carries the instance along with
 * the tag, so a caller that has matched `kind` never has to cast to reach it.
 */
export type Secondary =
  | { kind: 'none' }
  | { kind: 'dynamite'; weapon: DynamitePouch }
  | { kind: 'satchel'; weapon: Satchel }
  | { kind: 'storm'; weapon: LightningStorm }
  | { kind: 'whirlwind'; weapon: Whirlwind };

/**
 * A character's own second weapon, in every mode. Every character has one
 * now: wizard and knight's real specials replaced the dynamite stand-in each
 * carried while Lightning Storm and Whirlwind were still single-player-only.
 *
 * Still `Partial`, on purpose: the day a fifth hero lands without its own
 * secondary built yet, `secondaryWeapon` below falls back to dynamite for it
 * exactly the way wizard and knight's did, rather than needing an edit here.
 */
const OWN_SECONDARY: Partial<Record<CharacterKind, () => Secondary>> = {
  archer: () => ({ kind: 'dynamite', weapon: new DynamitePouch() }),
  ranger: () => ({ kind: 'satchel', weapon: new Satchel() }),
  wizard: () => ({ kind: 'storm', weapon: new LightningStorm() }),
  knight: () => ({ kind: 'whirlwind', weapon: new Whirlwind() }),
  // The one character that answers 'none' on purpose rather than for want of
  // a weapon built yet. Handing a sapper dynamite as a second weapon would be
  // the primary again on another button, and the fallback below would do
  // exactly that if this row were left out.
  sapper: () => ({ kind: 'none' }),
};

/**
 * What a character throws as their second weapon, if anything.
 *
 * The mode-gated dynamite fallback below is unreachable today, since all
 * four current characters are in OWN_SECONDARY — it exists for whichever
 * character is next, the same way it carried wizard and knight before their
 * real specials existed. Co-op gets `none` from it rather than dynamite,
 * because co-op has no PVE content yet to spend a placeholder weapon on.
 */
export function secondaryWeapon(character: CharacterKind, mode: GameMode): Secondary {
  const own = OWN_SECONDARY[character];
  if (own) return own();
  return mode === 'deathmatch' ? { kind: 'dynamite', weapon: new DynamitePouch() } : { kind: 'none' };
}
