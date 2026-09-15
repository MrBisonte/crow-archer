/**
 * What each character's THIRD key does.
 *
 * `Button.SNIPE` on the wire, Shift on a keyboard, and one key with five
 * different verbs behind it: the knight winds up a charge, the wizard blinks,
 * the archer draws, the ranger marks, the sapper fires a shock round.
 *
 * This file is to that key what `weapons.ts` is to the mouse. An ability is a
 * strategy the player holds; using one returns what it created and changes
 * nothing, so the whole of the opening move is testable without a world, a map
 * or a socket. No aim is passed in and no position -- an ability describes what
 * it makes, and the world aims it, for the reason `Weapon.use` gives.
 *
 * ## Why this is not a sixth branch in the world's step
 *
 * The single-player game routes this key through five functions in a row, each
 * of which returns immediately for the wrong hero (`pressShift` in `game.js`).
 * That reads as a list rather than a branch, which is the best a runtime can do
 * once the behaviour is already written into it. Here the behaviour attaches to
 * the character from the outside, so a sixth hero is a row in `ABILITY` and an
 * implementation beside the others, not an edit to anything that works.
 *
 * ## Held abilities are counted in TICKS
 *
 * `game.js` measures the knight's windup and the archer's draw against
 * `performance.now()`. A fixed-step server cannot: it has no wall clock, and a
 * hold measured against one is a figure that changes with frame rate. So
 * `use()` takes the number of ticks the button has been held, counted by the
 * world off the button bitfield across successive `InputCommand`s, and turns it
 * into a fraction here. The two runtimes therefore agree on the SECONDS a full
 * hold takes and disagree about what happens to a hold that spans a dropped
 * frame -- see `src/sim/hero-parity.test.ts`, which says so rather than
 * papering over it.
 *
 * ## Where the numbers come from
 *
 * Every figure either runtime also has is read from `./weapon-figures`, which
 * is its one home and which `CONFIG` reads too. Damage is not: single-player
 * has no player-versus-player damage at all and every damage figure in `CONFIG`
 * is boss damage against a sponge, so PvP damage is designed here against the
 * ten-point player, exactly as `weapons.ts` designs the weapons'.
 */

import type { CharacterKind } from '../net/protocol';
import { CHARACTER_STATS } from './arena';
import { ticks } from './tick';
import * as FIGURES from './weapon-figures';
import {
  ARROW_DAMAGE,
  ARROW_RADIUS,
  SAPPER_CHARGE_DAMAGE,
  WHIRLWIND_TICK_DAMAGE,
  type BurstSpec,
  type ShotSpec,
} from './weapons';

/** What using an ability produced. The world turns these into world state. */
export type AbilityEffect =
  | { kind: 'shot'; shot: ShotSpec }
  | { kind: 'travel'; travel: TravelSpec }
  | { kind: 'mark'; mark: MarkSpec };

/**
 * A body about to be carried along its own aim line.
 *
 * The wizard's blink and the knight's charge are both this, and the difference
 * between them is entirely in the numbers: the blink has a duration of zero and
 * so arrives at once, the dash spends `durationTicks` getting there and hurts
 * what it passes. That is the argument `BurstSpec` already makes for the storm
 * and the whirlwind, and it holds for the same reason -- a second shape would
 * be two places for "how does a body cross ground it did not walk" to live.
 */
export interface TravelSpec {
  /** Pixels along the aim line the body is carried, on open ground. */
  reach: number;
  /**
   * Below this the travel is refused outright rather than half-taken.
   *
   * A blink face-first into a wall would otherwise spend a six-second cooldown
   * on two pixels, which reads as the button being broken rather than as the
   * wall being solid.
   */
  minReach: number;
  /** Ticks spent crossing it. Zero arrives at once: a teleport, not a run. */
  durationTicks: number;
  /** Ticks the body cannot be hurt for, counted from the moment it sets off. */
  invulnerableTicks: number;
  /**
   * What the travel does to everything it reaches, or null for one that only
   * moves. An instant burst lands once where the body arrives; a channelled one
   * rides along with it.
   */
  pulse: BurstSpec | null;
}

/**
 * A target about to be marked: not damage, but a multiplier on everyone else's.
 *
 * The one ability on the roster that does nothing by itself. What it is worth
 * is entirely what its owner does with the eight seconds afterwards.
 */
export interface MarkSpec {
  /** How far a target may be and still be marked. */
  radius: number;
  /** Ticks the mark rides its target. */
  durationTicks: number;
  /** What a hit on a marked body is multiplied by, for everyone. */
  damageMultiplier: number;
}

/**
 * When an ability fires, and what release means.
 *
 * A discriminated pair rather than a wind-up of zero ticks, because the world
 * has to behave differently and not merely arithmetically differently: an
 * ability that fires on the press consumes a fresh press and ignores the
 * release entirely, while a held one has to be started, counted, and converted
 * on the way up -- including the case where the button is never released
 * because its owner stopped sending input at all.
 */
export type AbilityTrigger =
  | { readonly on: 'press' }
  | {
      readonly on: 'release';
      readonly windUpTicks: number;
      readonly windUp: WindUpCost;
    };

/**
 * What holding the key costs, for the two abilities that are held.
 *
 * Both root: neither the archer nor the knight may move while the meter fills,
 * and that is the price of every figure the hold buys. They differ in what
 * being rooted is worth. `damagePlayer` in `game.js` refuses a hit outright
 * while the knight winds up -- "his whole defence for those seconds: he cannot
 * move or attack, so he eats nothing" -- and says in the next breath that the
 * DASH afterwards is exposed. The archer gets no such protection: he stands
 * there and takes it, which is why his draw is a gamble and the knight's is a
 * commitment.
 */
export type WindUpCost = 'rooted' | 'rooted-and-untouchable';

export type AbilityKind = 'draw' | 'blink' | 'charge' | 'mark' | 'shock';

export interface Ability {
  readonly kind: AbilityKind;
  /** Ticks between uses. */
  readonly cooldownTicks: number;
  readonly trigger: AbilityTrigger;
  /**
   * What comes of using it, after `heldTicks` of the button being down.
   *
   * Ticks, never seconds off a clock: see the file header. An ability whose
   * trigger is `press` is handed 0 and ignores it.
   */
  use(heldTicks: number): AbilityEffect[];
}

// ---------------------------------------------------------------------------
// Damage, designed here
// ---------------------------------------------------------------------------

/**
 * What a full draw is worth, as a multiple of a plain arrow.
 *
 * The same multiple single-player gives it against a boss, chosen again rather
 * than shared: `archerPowerBossMult` answers "what is this worth to a 20-point
 * sponge" and this answers "what is this worth against a 9-point archer", and
 * a figure that answers two questions is one tune away from answering neither.
 * Six damage on a five-second cooldown, off a second of standing still, and a
 * tap is worth exactly one ordinary arrow.
 */
export const POWER_SHOT_DAMAGE_MULT = 3;

/**
 * What arriving from a blink costs whoever was chasing.
 *
 * Less than the wizard's own bolt, on purpose: the pulse is not how he kills
 * anybody, it is the reason closing on him is not free. He is the softest body
 * in the game and this is his only answer to being stood on.
 */
export const BLINK_PULSE_DAMAGE = 2;

/**
 * What one tick of the dash is worth before the hold curve scales it.
 *
 * The whirlwind's own tick damage, because a knight sweeping ground at speed
 * and a knight sweeping ground on the spot are the same swing. And as the
 * whirlwind's comment says, the cadence a caught body actually takes damage at
 * is `IFRAME_TICKS`, not the tick interval: a dash that runs someone down lands
 * perhaps twice, not seven times.
 */
export const CHARGE_TICK_DAMAGE = WHIRLWIND_TICK_DAMAGE;

/**
 * What the shock round does on a direct hit: three times an ordinary charge.
 *
 * "A clean multiple of a normal hit" is single-player's own description of it,
 * and three is the multiple it uses. On a ten-second cooldown, against a body
 * with nine to twelve points, that is a shot worth crossing a map to line up
 * and worth nothing at all if it misses.
 */
export const SHOCK_DAMAGE_MULT = 3;
export const SHOCK_DAMAGE = SAPPER_CHARGE_DAMAGE * SHOCK_DAMAGE_MULT;

/**
 * What a hit on a marked body is multiplied by.
 *
 * **This is a product call nobody has made.** Single-player's 2.5 is a BOSS
 * multiplier, and it exists because "an ordinary body has one hit point and
 * dies to any bolt: a crit on a crow is a number nobody can see". A player is
 * neither: at 2.5 the ranger's burst goes from 2.1 to 5.25, which kills a
 * nine-point archer in two bursts and does it for the eight seconds the mark
 * lasts. Built at the single-player figure because that is the only number
 * anyone has stated, and kept here as one constant so changing it is one edit.
 */
export const MARK_DAMAGE_MULTIPLIER = 2.5;

/**
 * How long the ranger waits between marks.
 *
 * **Also a product call nobody has made, and not a figure either runtime had.**
 * Single-player gates the mark on a full Momentum meter, which it spends --
 * multiplayer has no Momentum, so without something here the mark would be a
 * free press with no cost at all. Twelve seconds against an eight-second mark
 * means a ranger usually has one and never two back to back.
 */
export const MARK_COOLDOWN_TICKS = ticks(12);

// ---------------------------------------------------------------------------
// The abilities
// ---------------------------------------------------------------------------

/** How far into a wind-up this hold is, 0 to 1. A tap is 0; over-holding caps. */
const wound = (heldTicks: number, windUpTicks: number): number =>
  windUpTicks <= 0 ? 1 : Math.min(1, Math.max(0, heldTicks / windUpTicks));

const lerp = (lo: number, hi: number, t: number): number => lo + t * (hi - lo);

/**
 * The archer's power shot. He is rooted while he draws, and what the root buys
 * is an arrow that flies twice as fast, hits three times as hard and does not
 * stop at the first body.
 *
 * A tap is still a shot: the bottom of every one of those ranges is an ordinary
 * arrow. So the question the key asks is how long to stand still, never whether
 * to press it.
 */
export class PowerDraw implements Ability {
  readonly kind = 'draw' as const;
  readonly cooldownTicks = ticks(FIGURES.ARCHER_POWER_COOLDOWN_SECS);
  readonly trigger = {
    on: 'release',
    windUpTicks: ticks(FIGURES.ARCHER_DRAW_MAX_SECS),
    // Rooted and nothing more. Standing still in the open for a second is the
    // whole price, and it is paid whether or not the shot lands.
    windUp: 'rooted',
  } as const;

  use(heldTicks: number): AbilityEffect[] {
    const drawn = wound(heldTicks, this.trigger.windUpTicks);
    return [
      {
        kind: 'shot',
        shot: {
          flavour: 'arrow',
          speed: FIGURES.ARROW_SPEED * lerp(1, FIGURES.ARCHER_POWER_SPEED_MULT, drawn),
          damage: ARROW_DAMAGE * lerp(1, POWER_SHOT_DAMAGE_MULT, drawn),
          lifeTicks: ticks(FIGURES.ARROW_LIFE_SECS),
          radius: ARROW_RADIUS,
          homingRate: 0,
          onTerrain: 'stop',
          explodesAtRest: false,
          drownsInWater: false,
          // Whole bodies, so a half-drawn shot pierces one or two and never
          // one and a half. Single-player rounds this the same way.
          pierce: 1 + Math.round(drawn * (FIGURES.ARCHER_POWER_PIERCE - 1)),
        },
      },
    ];
  }
}

/**
 * The wizard's Arcane Blink: the answer to the one question the rest of his kit
 * has none for, which is that something is on him right now.
 *
 * Instant, so the travel takes no ticks at all, and it arrives with a pulse and
 * a moment of immunity. The world walks the aim line and keeps the last point
 * the body fits in -- a blink closes on cover rather than passing through it,
 * and `minReach` is what stops a blink into a wall costing the whole cooldown.
 */
export class Blink implements Ability {
  readonly kind = 'blink' as const;
  readonly cooldownTicks = ticks(FIGURES.BLINK_COOLDOWN_SECS);
  readonly trigger = { on: 'press' } as const;

  use(): AbilityEffect[] {
    return [
      {
        kind: 'travel',
        travel: {
          reach: FIGURES.BLINK_REACH,
          minReach: FIGURES.BLINK_MIN_REACH,
          durationTicks: 0,
          invulnerableTicks: ticks(FIGURES.BLINK_IFRAME_SECS),
          pulse: {
            radius: FIGURES.BLINK_PULSE_RADIUS,
            damage: BLINK_PULSE_DAMAGE,
            tickIntervalTicks: 0,
            durationTicks: 0,
            // An escape, not an excavator. The storm is what the wizard opens
            // ground with.
            destroysTerrain: false,
          },
        },
      },
    ];
  }
}

/**
 * The knight's charge: held in place to wind up, released to run.
 *
 * The slowest body on the roster, and this is the only thing that lets him
 * choose the distance a fight happens at. He is rooted and untouchable for the
 * wind-up and EXPOSED for the dash, which is the bargain the single-player game
 * strikes too. The angle is committed the instant the key comes up -- he cannot
 * steer, which is the whole of what the hold is deciding.
 *
 * `reach` is derived rather than stated: his own walking speed, for as long as
 * the dash runs, times what the dash adds to it. Written out as a distance it
 * would be a fourth figure that quietly disagrees with the three it comes from
 * the first time any of them moves -- and the multiplayer knight walks at 150
 * where the single-player one does not, so the same three figures correctly
 * give the two runtimes different distances.
 */
export class Charge implements Ability {
  readonly kind = 'charge' as const;
  readonly cooldownTicks = ticks(FIGURES.KNIGHT_CHARGE_COOLDOWN_SECS);
  readonly trigger = {
    on: 'release',
    windUpTicks: ticks(FIGURES.KNIGHT_CHARGE_MAX_HOLD_SECS),
    windUp: 'rooted-and-untouchable',
  } as const;

  use(heldTicks: number): AbilityEffect[] {
    const held = wound(heldTicks, this.trigger.windUpTicks);
    const durationTicks = ticks(FIGURES.KNIGHT_DASH_SECS);
    const bite = lerp(
      FIGURES.KNIGHT_CHARGE_MIN_DAMAGE_MULT,
      FIGURES.KNIGHT_CHARGE_MAX_DAMAGE_MULT,
      held,
    );
    return [
      {
        kind: 'travel',
        travel: {
          reach:
            CHARACTER_STATS.knight.speed *
            FIGURES.KNIGHT_DASH_SPEED_MULT *
            FIGURES.KNIGHT_DASH_SECS,
          // A knight already nose-first into a wall gets the refusal rather
          // than a cooldown spent standing still. A body width, as the chained
          // charge uses.
          minReach: FIGURES.BLINK_MIN_REACH,
          durationTicks,
          // None. The wind-up is where the knight is untouchable, and
          // `damagePlayer` in `game.js` says so in as many words: the dash
          // afterwards is exposed. A dash that were also immune would make the
          // whole four and a half seconds free.
          invulnerableTicks: 0,
          pulse: {
            radius: FIGURES.KNIGHT_CHARGE_RADIUS,
            damage: CHARGE_TICK_DAMAGE * bite,
            tickIntervalTicks: ticks(FIGURES.KNIGHT_CHARGE_TICK_SECS),
            durationTicks,
            destroysTerrain: true,
          },
        },
      },
    ];
  }
}

/**
 * The ranger's mark. The only ability on the roster that does no damage at all.
 *
 * It settles on the nearest enemy within reach and multiplies what everybody
 * does to them for the next eight seconds, which is the ranger's answer to the
 * one number she is worst at: least damage per bolt of anyone on the field.
 */
export class Mark implements Ability {
  readonly kind = 'mark' as const;
  readonly cooldownTicks = MARK_COOLDOWN_TICKS;
  readonly trigger = { on: 'press' } as const;

  use(): AbilityEffect[] {
    return [
      {
        kind: 'mark',
        mark: {
          radius: FIGURES.RANGER_MARK_RADIUS,
          durationTicks: ticks(FIGURES.RANGER_MARK_SECS),
          damageMultiplier: MARK_DAMAGE_MULTIPLIER,
        },
      },
    ];
  }
}

/**
 * The sapper's shock round: the fastest thing either runtime fires, straight,
 * and spent on the first thing it touches.
 *
 * It does NOT pierce, whatever `CONFIG`'s comment said for a year. Its real
 * second job is the combo: landed on one of the sapper's own live charges
 * instead of on a body, it sets that charge off early and wider, which is the
 * payoff for threading a shot past whatever stands between him and it. The
 * world owns that half, because only the world knows what else is in the air.
 */
export class ShockRound implements Ability {
  readonly kind = 'shock' as const;
  readonly cooldownTicks = ticks(FIGURES.SAPPER_SHOT_COOLDOWN_SECS);
  readonly trigger = { on: 'press' } as const;

  use(): AbilityEffect[] {
    return [
      {
        kind: 'shot',
        shot: {
          flavour: 'shock',
          speed: FIGURES.SAPPER_SHOT_SPEED,
          damage: SHOCK_DAMAGE,
          lifeTicks: ticks(FIGURES.SAPPER_SHOT_LIFE_SECS),
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * The ability a character's third key holds. One row per character, no branch.
 *
 * Exhaustive rather than `Partial`, unlike `OWN_SECONDARY` in `weapons.ts`:
 * every hero in the single-player game already has one, so a missing row would
 * be a hero who lost an ability in the port rather than one waiting for a
 * design. A sixth hero that genuinely has none says so with its own class.
 */
const ABILITY: Record<CharacterKind, () => Ability> = {
  archer: () => new PowerDraw(),
  wizard: () => new Blink(),
  knight: () => new Charge(),
  ranger: () => new Mark(),
  sapper: () => new ShockRound(),
};

export function abilityFor(character: CharacterKind): Ability {
  return ABILITY[character]();
}
