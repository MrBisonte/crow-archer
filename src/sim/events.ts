/**
 * Gameplay events the sim emits and the render/audio layer consumes. This is
 * the seam that lets the server run the sim with no particles and no audio: it
 * ignores these events, or forwards the network-relevant ones in snapshots,
 * while a client turns them into bursts and sounds locally.
 *
 * Each variant states a gameplay fact, not a visual. It carries what the
 * cosmetic layer needs to place the effect, never particle counts or colors:
 * those belong to the handler, which is render-side.
 */

import type { MapKind } from './arena-map';
import type { SoldierKind } from './soldiers';

/** What landed a hit on the boss. The handler picks the sound and shake. */
export type HitSource =
  | 'arrow'
  | 'javelin'
  | 'pitchfork'
  | 'spear'
  | 'whirlwind'
  | 'storm'
  | 'dynamite'
  | 'satchel';

/** Which attack a player started. */
export type WeaponKind =
  | 'arrow'
  | 'net'
  | 'bolt'
  | 'crossbow'
  | 'pitchfork'
  | 'spear'
  | 'javelin'
  | 'charge'
  // The sapper's two. Both predate this union's last edit and were emitted
  // without being listed, which type-checked only because game.js was not
  // checked: WEAPON_FX carries a row for each, so the sound played anyway.
  | 'barrage'
  | 'sapperShot';

export type PickupKind = 'ricochet' | 'fire' | 'shield';

/** The maze's two keys, in the order the level hands them out. */
export type MazeKeyKind = 'silver' | 'golden';

export type GameEvent =
  // Combat results
  | { type: 'CROW_KILLED'; x: number; y: number; white: boolean; earned: number }
  | { type: 'SKELETON_KILLED'; x: number; y: number; kind: 'normal' | 'fire' | 'ice' }
  // Its own event rather than a widened SKELETON_KILLED: the two share a
  // shape but not a meaning, and that event's `kind` is read to pick undead
  // colours a soldier has no version of.
  | { type: 'SOLDIER_KILLED'; x: number; y: number; kind: SoldierKind }
  // Not ICE_BOLT_FIRED reused. That one happens to play a generic sound
  // today, but it states that an ice bolt was fired, and a soldier's arrow is
  // not one; an event that lies is worse than an event that duplicates.
  | { type: 'SOLDIER_SHOT'; x: number; y: number }
  | { type: 'FIRE_SKELETON_BLAST'; x: number; y: number }
  | { type: 'ICE_BOLT_FIRED'; x: number; y: number }
  | { type: 'PLAYER_FROZEN'; x: number; y: number }
  | { type: 'MELEE_HIT'; x: number; y: number; kind: 'pitchfork' | 'spear'; fire: boolean }
  | { type: 'BOSS_HIT'; source: HitSource }
  | { type: 'ARROW_MISS' }
  | { type: 'JAVELIN_BOUNCE'; x: number; y: number }
  // `big` is the sapper's shift-detonated combo, which reaches a wider
  // radius than a normal blast and whose burst is scaled to match.
  | { type: 'EXPLOSION'; x: number; y: number; onWater: boolean; big: boolean }
  | { type: 'SPLASH'; x: number; y: number }
  // Player actions
  | { type: 'WEAPON_FIRED'; kind: WeaponKind }
  | { type: 'ACTION_BLOCKED' }
  | { type: 'WHIRLWIND_START'; x: number; y: number }
  | { type: 'WHIRLWIND_TICK'; x: number; y: number }
  | { type: 'WHIRLWIND_END'; x: number; y: number }
  | { type: 'KNIGHT_CHARGE'; x: number; y: number; power: number }
  // The dash met something it could not push through and ended early.
  | { type: 'KNIGHT_CHARGE_STOPPED'; x: number; y: number }
  // The escape hatch fired: the player had nowhere to move and was lifted out.
  | { type: 'PLAYER_UNSTUCK'; x: number; y: number; toX: number; toY: number }
  | { type: 'WIZARD_BLINK'; x: number; y: number; toX: number; toY: number }
  | { type: 'KNIGHT_WHIRL_SWING'; x: number; y: number; radius: number }
  | { type: 'ARCHER_POWER_SHOT'; x: number; y: number; power: number }
  | { type: 'RANGER_NET_OPEN'; x: number; y: number; radius: number; caught: number }
  | { type: 'STORM_CAST'; x: number; y: number }
  | { type: 'SATCHEL_ARMED'; x: number; y: number }
  // Player state
  | { type: 'PLAYER_HIT' }
  | { type: 'SHIELD_BLOCKED'; x: number; y: number }
  | { type: 'PICKUP_TAKEN'; x: number; y: number; kind: PickupKind }
  | { type: 'GAME_OVER' }
  // Crows and boss
  | { type: 'CROWS_AGGRO' }
  | { type: 'BOSS_CONTACT' }
  | { type: 'BOSS_BATS'; x: number; y: number }
  | { type: 'BOSS_VOLLEY'; x: number; y: number }
  | { type: 'BOSS_CHARGE' }
  | { type: 'BOSS_SCREECH' }
  | { type: 'BOSS_DEATH_START' }
  | { type: 'BOSS_DEATH_BURST'; x: number; y: number; phase: 'a' | 'b' | 'c' }
  | { type: 'BOSS_ENTRANCE_FLASH' }
  | { type: 'BOSS_ENTRANCE_FIRE'; x: number; y: number }
  | { type: 'BOSS_SHIELD_BLOCKED'; x: number; y: number }
  | { type: 'BOSS_BURNING'; x: number; y: number }
  // The maze's warden. He has no HP, so none of these are damage events: they
  // are the three beats of a charge, sighting you, committing, and hitting a
  // wall hard enough to open it.
  | { type: 'MINOTAUR_ROAR'; x: number; y: number }
  | { type: 'MINOTAUR_CHARGE'; x: number; y: number }
  | { type: 'MINOTAUR_SMASH'; x: number; y: number }
  // Rat venom. POISONED is the bite landing, TICK is one second of it working.
  // Two events rather than one with a flag: they sound and look different, and
  // the render layer should not have to branch to find that out.
  | { type: 'PLAYER_POISONED'; x: number; y: number }
  | { type: 'PLAYER_POISON_TICK'; x: number; y: number }
  // The maze's objective chain. A rat gives up the silver key, the chest gives
  // up the golden one, the door is the way out. KEY_TAKEN is separate from
  // PICKUP_TAKEN because a key restores no ammo and grants no power: the two
  // are the same gesture and different facts.
  | { type: 'KEY_DROPPED'; x: number; y: number; kind: MazeKeyKind }
  | { type: 'KEY_TAKEN'; x: number; y: number; kind: MazeKeyKind }
  | { type: 'CHEST_OPENED'; x: number; y: number }
  | { type: 'DOOR_OPENED'; x: number; y: number }
  // Striking a torch in the dark. The only thing in the maze that gives sight
  // back, so it is the one beat that is relief rather than threat.
  | { type: 'TORCH_LIT'; x: number; y: number }
  // The bastion. A siege is the only mode with anyone on the player's side, so
  // these are the first events about a friendly body rather than a hostile one.
  // GUARD_SWING and GUARD_SHOT are separate for the same reason MELEE_HIT and
  // ICE_BOLT_FIRED are: one is a blade at arm's length, the other is an arrow
  // leaving, and the render layer should not have to read a flag to find out.
  | { type: 'GUARD_SWING'; x: number; y: number }
  | { type: 'GUARD_SHOT'; x: number; y: number }
  | { type: 'GUARD_DOWN'; x: number; y: number }
  | { type: 'TOWER_FELL'; x: number; y: number }
  // Carries the wave that was just survived, not the one about to start: the
  // banner reads "wave 3 held", and the run has already advanced past it.
  | { type: 'SIEGE_WAVE_CLEARED'; wave: number }
  // World
  // Emitted before the tile grid is replaced, so a render layer can swap theme
  // and let the reset repaint once rather than twice.
  | { type: 'MAP_GENERATED'; kind: MapKind };

export type GameEventType = GameEvent['type'];
export type EventHandler = (e: GameEvent) => void;

/** Synchronous fan-out. emit dispatches to every handler in registration order. */
export class EventBus {
  private handlers: EventHandler[] = [];

  /** Subscribe. Returns an unsubscribe function. */
  on(fn: EventHandler): () => void {
    this.handlers.push(fn);
    return () => {
      const i = this.handlers.indexOf(fn);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  emit(e: GameEvent): void {
    for (const fn of this.handlers) fn(e);
  }

  clear(): void {
    this.handlers.length = 0;
  }
}
