/**
 * One running match. Holds the players, collects their inputs, and produces a
 * snapshot on the ticks that are due to broadcast.
 *
 * Like the rest of the server, this is pure state: it has no timer of its own.
 * The entry point owns the interval and calls step() at 60 Hz, which keeps the
 * tick rate testable without waiting in real time.
 *
 * The simulation arrives as a World, which Match is handed rather than reaches
 * into. That is what lets the netcode be exercised against a world small enough
 * to reason about, and what lets the real one replace it without touching this
 * file.
 */

import type { InputCommand } from '../sim/input';
import type { Kill, World } from '../sim/world';
import { Team } from '../sim/team';
import type {
  InputAck,
  MatchResult,
  PlayerId,
  RoomView,
  Snapshot,
  TeamScores,
  WinCondition,
} from '../net/protocol';

/** Server ticks per second. The client predicts against the same rate. */
export const TICK_HZ = 60;

/**
 * Ticks between snapshots. Two at 60 Hz is 30 Hz on the wire.
 *
 * The roadmap sized three, for 20 Hz. Two is better for the same reason a
 * higher frame rate is: consecutive snapshots are 33 ms apart instead of 50, so
 * the interpolation buffer that has to span two of them shrinks, and everyone
 * else is drawn closer to now. It also samples motion finer, which a 700 px/s
 * arrow shows as 23 px between snapshots rather than 35.
 *
 * The cost is half again the downstream bytes, about 30 KB/s per client at four
 * players, which is not a number worth protecting.
 */
export const TICKS_PER_SNAPSHOT = 2;

/** Seconds per tick, the fixed step every world is advanced by. */
export const FIXED_DT = 1 / TICK_HZ;

/**
 * How long a dropped player's body stands idle before it is removed. Long
 * enough that a brief network blip does not delete someone mid-match, short
 * enough that an abandoned body is not left standing in the arena.
 */
export const GRACE_TICKS = TICK_HZ * 10;

export class Match {
  readonly #room: RoomView;
  readonly #world: World;
  readonly #win: WinCondition;
  readonly #latestInput = new Map<PlayerId, InputCommand>();
  /** Seats still connected. A match with none left is over. */
  readonly #live = new Set<PlayerId>();
  /** Seats that dropped, and the tick their grace window began. */
  readonly #dropped = new Map<PlayerId, number>();
  #scores: TeamScores = { a: 0, b: 0 };
  /** The result once the match is over, and null while it is still being played. */
  #result: MatchResult | null = null;
  #tick = 0;
  #ticksSinceSnapshot = 0;

  constructor(room: RoomView, world: World) {
    this.#room = room;
    this.#world = world;
    this.#win = room.win;
    for (const slot of room.slots) this.#live.add(slot.id);
  }

  /** How the two sides stand. */
  get scores(): TeamScores {
    return { ...this.#scores };
  }

  /**
   * The outcome, or null while the match is still being played. The entry point
   * reads this after each step to know whether MATCH_END is owed.
   */
  get result(): MatchResult | null {
    return this.#result;
  }

  /**
   * Marks a seat as gone. Its body stands idle for the grace window and is then
   * removed, so a brief disconnect does not delete a player mid-match.
   */
  dropSeat(id: PlayerId): void {
    if (!this.#live.delete(id)) return;
    this.#latestInput.delete(id);      // stop replaying the input it held
    this.#dropped.set(id, this.#tick);
  }

  get code() {
    return this.#room.code;
  }

  get tick() {
    return this.#tick;
  }

  /** The world as it stands, without waiting for a broadcast tick. */
  entities() {
    return this.#world.snapshot();
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
   *
   * A seat with nothing pending is stepped with its last command still held.
   * Holding a key sends one command, not one per tick, so dropping to no input
   * between packets would stutter every player who is simply walking.
   */
  step(): Snapshot | null {
    const kills = this.#world.step(FIXED_DT, this.#latestInput);
    this.#tick++;
    this.#score(kills);
    this.#reapDropped();
    this.#judge();
    this.#ticksSinceSnapshot++;
    if (this.#ticksSinceSnapshot < TICKS_PER_SNAPSHOT) return null;

    this.#ticksSinceSnapshot = 0;
    return {
      tick: this.#tick,
      entities: this.#world.snapshot(),
      acks: this.#acks(),
      scores: this.scores,
    };
  }

  /** Credits each kill to the side that made it. */
  #score(kills: readonly Kill[]): void {
    for (const kill of kills) {
      if (kill.killerTeam === Team.A) this.#scores.a++;
      else this.#scores.b++;
    }
  }

  /**
   * Decides whether the match is over, and records the result if it is.
   *
   * Both conditions are checked against the same union, so exactly one of them
   * applies and neither can be forgotten: a match always has a way to end.
   */
  #judge(): void {
    if (this.#result) return;
    const { a, b } = this.#scores;
    switch (this.#win.kind) {
      case 'frags':
        if (a < this.#win.target && b < this.#win.target) return;
        break;
      case 'time':
        if (this.#tick < this.#win.minutes * 60 * TICK_HZ) return;
        break;
    }
    // A draw is only reachable on time. A frag target is crossed by one side.
    const winner = a === b ? null : a > b ? Team.A : Team.B;
    this.#result = { outcome: 'DEATHMATCH', winner, scoreA: a, scoreB: b };
  }

  /**
   * True once nobody is left to play. Without this a finished match would keep
   * ticking and broadcasting for the life of the process, one leaked interval
   * per room ever started.
   *
   * There is no richer outcome yet: a movement-only world has nothing to win.
   * MATCH_END arrives with something worth reporting, and with someone left to
   * report it to.
   */
  isFinished(): boolean {
    return this.#result !== null || this.#live.size === 0;
  }

  /** Removes bodies whose grace window has run out. */
  #reapDropped(): void {
    for (const [id, since] of this.#dropped) {
      if (this.#tick - since < GRACE_TICKS) continue;
      this.#world.remove(id);
      this.#dropped.delete(id);
    }
  }

  /** One ack per seat, so a client knows how far its prediction can be trimmed. */
  #acks(): InputAck[] {
    return this.#room.slots.map((slot) => ({
      id: slot.id,
      seq: this.#latestInput.get(slot.id)?.seq ?? 0,
    }));
  }
}
