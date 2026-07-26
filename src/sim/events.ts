/**
 * Gameplay events the sim emits and the render/audio layer consumes. This is
 * the seam that lets the server run the sim with no particles and no audio: it
 * ignores these events, or forwards the network-relevant ones in snapshots,
 * while a client turns them into bursts and sounds locally.
 *
 * The union grows one variant per routed effect. Cosmetics are never gameplay:
 * an event carries the facts the cosmetic layer needs, nothing more.
 */
export type GameEvent =
  | { type: 'CROW_KILLED'; x: number; y: number; white: boolean; earned: number }
  | { type: 'EXPLOSION'; x: number; y: number; onWater: boolean };

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
