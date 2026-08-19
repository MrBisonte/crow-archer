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
export type WeaponKind = 'arrow' | 'bolt' | 'crossbow' | 'pitchfork' | 'spear' | 'javelin';

export type PickupKind = 'ricochet' | 'fire' | 'shield';

export type GameEvent =
  // Combat results
  | { type: 'CROW_KILLED'; x: number; y: number; white: boolean; earned: number }
  | { type: 'SKELETON_KILLED'; x: number; y: number; kind: 'normal' | 'fire' | 'ice' }
  | { type: 'FIRE_SKELETON_BLAST'; x: number; y: number }
  | { type: 'ICE_BOLT_FIRED'; x: number; y: number }
  | { type: 'PLAYER_FROZEN'; x: number; y: number }
  | { type: 'MELEE_HIT'; x: number; y: number; kind: 'pitchfork' | 'spear'; fire: boolean }
  | { type: 'BOSS_HIT'; source: HitSource }
  | { type: 'ARROW_MISS' }
  | { type: 'JAVELIN_BOUNCE'; x: number; y: number }
  | { type: 'EXPLOSION'; x: number; y: number; onWater: boolean }
  | { type: 'SPLASH'; x: number; y: number }
  // Player actions
  | { type: 'WEAPON_FIRED'; kind: WeaponKind }
  | { type: 'ACTION_BLOCKED' }
  | { type: 'WHIRLWIND_START'; x: number; y: number }
  | { type: 'WHIRLWIND_TICK'; x: number; y: number }
  | { type: 'WHIRLWIND_END'; x: number; y: number }
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
  | { type: 'BOSS_BURNING'; x: number; y: number };

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
