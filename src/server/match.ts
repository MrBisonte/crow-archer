/**
 * One running match. Holds the players, collects their inputs, and produces a
 * snapshot on the ticks that are due to broadcast.
 *
 * Like the rest of the server, this is pure state: it has no timer of its own.
 * The entry point owns the interval and calls step() at 60 Hz, which keeps the
 * tick rate testable without waiting in real time.
 *
 * The simulation itself is not here yet. Extracting world state out of the
 * legacy monolith is the next slice; until then a snapshot carries the tick and
 * the input acks, which is enough to prove the loop and the wire format.
 */

import type { InputCommand } from '../sim/input';
import type { InputAck, PlayerId, RoomView, Snapshot } from '../net/protocol';

/** Server ticks per second. The client predicts against the same rate. */
export const TICK_HZ = 60;

/**
 * Ticks between snapshots. Three at 60 Hz is 20 Hz on the wire, the rate the
 * roadmap sized at under 1 KB per snapshot.
 */
export const TICKS_PER_SNAPSHOT = 3;

export class Match {
  readonly #room: RoomView;
  readonly #latestInput = new Map<PlayerId, InputCommand>();
  #tick = 0;
  #ticksSinceSnapshot = 0;

  constructor(room: RoomView) {
    this.#room = room;
  }

  get code() {
    return this.#room.code;
  }

  get tick() {
    return this.#tick;
  }

  /**
   * Records the newest input from one player. Returns false for a stale or
   * repeated sequence number, which is what a retransmit looks like: UDP-style
   * duplicate handling costs nothing here and will matter under real loss.
   */
  recordInput(player: PlayerId, cmd: InputCommand): boolean {
    const previous = this.#latestInput.get(player);
    if (previous && cmd.seq <= previous.seq) return false;
    this.#latestInput.set(player, cmd);
    return true;
  }

  /**
   * Advances one tick. Returns a snapshot on the ticks that are due to
   * broadcast, and null on the ticks in between.
   */
  step(): Snapshot | null {
    this.#tick++;
    this.#ticksSinceSnapshot++;
    if (this.#ticksSinceSnapshot < TICKS_PER_SNAPSHOT) return null;

    this.#ticksSinceSnapshot = 0;
    return { tick: this.#tick, entities: [], acks: this.#acks() };
  }

  /** Phase 2 has no end condition yet; the room plays until everyone leaves. */
  isFinished(): boolean {
    return false;
  }

  /** One ack per seat, so a client knows how far its prediction can be trimmed. */
  #acks(): InputAck[] {
    return this.#room.slots.map((slot) => ({
      id: slot.id,
      seq: this.#latestInput.get(slot.id)?.seq ?? 0,
    }));
  }
}
