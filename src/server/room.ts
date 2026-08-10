/**
 * Lobby rooms, held in memory. This is pure state: no sockets, no timers, no
 * randomness of its own. The server owns the transport and calls in here with
 * an opaque connection id, so the whole lobby is testable without a network.
 *
 * Every operation returns either the new room view or an ErrorCode from the
 * wire protocol, which the server sends straight back as an ERROR message.
 * Nothing throws.
 */

import { Team } from '../sim/team';
import {
  DEFAULT_WIN_CONDITION,
  MAX_PLAYERS,
  type CharacterKind,
  type ErrorCode,
  type GameMode,
  type PlayerId,
  type PlayerSlot,
  type PlayerTeam,
  type RoomCode,
  type RoomView,
  type WinCondition,
} from '../net/protocol';

export type { RoomView };

/**
 * Identifies one client connection. The server maps its own sockets onto these
 * and never hands a socket to this module.
 */
export type ConnectionId = number;

/** Whether a seat has declared itself ready. */
export const Readiness = {
  READY: 'ready',
  NOT_READY: 'not-ready',
} as const;

export type Readiness = (typeof Readiness)[keyof typeof Readiness];

/** A room is either gathering players or running a match. */
export const RoomPhase = {
  LOBBY: 'lobby',
  IN_MATCH: 'in-match',
} as const;

export type RoomPhase = (typeof RoomPhase)[keyof typeof RoomPhase];

/** Success carries the room to broadcast; failure carries the code to send back. */
export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };

/**
 * The three ways leaving can end. Modelled as a union rather than a nullable
 * view, because "you held no seat" and "the room is gone" need different
 * handling from the server: only the last one has anybody left to notify.
 */
export type LeaveOutcome =
  | { kind: 'not-in-room' }
  | { kind: 'closed'; code: RoomCode }
  | { kind: 'updated'; view: RoomView };

export interface RoomStoreOptions {
  /**
   * Supplies candidate room codes. Injected so the caller owns the randomness
   * and tests can force a collision or exhaust the space.
   */
  newCode: () => RoomCode;
  /** Rooms held at once. Reaching it answers SERVER_FULL. */
  maxRooms?: number;
}

/** Tries before a fresh code is declared unobtainable. */
const CODE_ATTEMPTS = 16;

/** A player who has taken a seat. `conn` never leaves this module. */
interface Seat {
  conn: ConnectionId;
  name: string;
  character: CharacterKind;
  readiness: Readiness;
}

interface Room {
  code: RoomCode;
  mode: GameMode;
  phase: RoomPhase;
  host: PlayerId;
  win: WinCondition;
  /** Indexed by slot. A hole is a free seat, which the next joiner takes. */
  seats: (Seat | undefined)[];
}

const err = <T>(error: ErrorCode): RoomResult<T> => ({ ok: false, error });

const okay = <T>(value: T): RoomResult<T> => ({ ok: true, value });

/**
 * Co-op puts everyone on one team, which turns off damage between players
 * through the existing canDamage rule. Deathmatch alternates slots, so the
 * fixed four seats fall out as 2v2.
 */
function teamFor(slot: PlayerId, mode: GameMode): PlayerTeam {
  if (mode === 'coop') return Team.A;
  return slot % 2 === 0 ? Team.A : Team.B;
}

function viewOfRoom(room: Room): RoomView {
  const slots: PlayerSlot[] = [];
  room.seats.forEach((seat, id) => {
    if (!seat) return;
    slots.push({
      id,
      name: seat.name,
      character: seat.character,
      ready: seat.readiness === Readiness.READY,
      team: teamFor(id, room.mode),
    });
  });
  return { code: room.code, mode: room.mode, host: room.host, slots, win: room.win };
}

export class RoomStore {
  readonly #rooms = new Map<RoomCode, Room>();
  /** Reverse index, so every lookup by connection is a map hit, not a scan. */
  readonly #byConnection = new Map<ConnectionId, RoomCode>();
  readonly #newCode: () => RoomCode;
  readonly #maxRooms: number;

  constructor(options: RoomStoreOptions) {
    this.#newCode = options.newCode;
    this.#maxRooms = options.maxRooms ?? Infinity;
  }

  get roomCount(): number {
    return this.#rooms.size;
  }

  /** Opens a room with the caller in slot 0 as host. */
  create(conn: ConnectionId, name: string): RoomResult<RoomView> {
    if (this.#byConnection.has(conn)) return err('ALREADY_IN_ROOM');
    if (this.#rooms.size >= this.#maxRooms) return err('SERVER_FULL');
    const code = this.#freeCode();
    if (code === null) return err('SERVER_FULL');

    const room: Room = {
      code,
      mode: 'coop',
      phase: RoomPhase.LOBBY,
      host: 0,
      win: DEFAULT_WIN_CONDITION,
      seats: new Array<Seat | undefined>(MAX_PLAYERS).fill(undefined),
    };
    this.#rooms.set(code, room);
    this.#seat(room, 0, conn, name);
    return okay(viewOfRoom(room));
  }

  /** Puts the caller in the lowest free seat of an existing lobby. */
  join(conn: ConnectionId, code: RoomCode, name: string): RoomResult<RoomView> {
    if (this.#byConnection.has(conn)) return err('ALREADY_IN_ROOM');
    const room = this.#rooms.get(code);
    if (!room) return err('ROOM_NOT_FOUND');
    if (room.phase === RoomPhase.IN_MATCH) return err('ROOM_IN_MATCH');
    const slot = room.seats.findIndex((s) => s === undefined);
    if (slot === -1) return err('ROOM_FULL');

    this.#seat(room, slot, conn, name);
    return okay(viewOfRoom(room));
  }

  /** Gives up the caller's seat, closing the room if it was the last one. */
  leave(conn: ConnectionId): LeaveOutcome {
    const found = this.#locate(conn);
    if (!found) return { kind: 'not-in-room' };
    const { room, slot } = found;

    room.seats[slot] = undefined;
    this.#byConnection.delete(conn);

    const remaining = room.seats.findIndex((s) => s !== undefined);
    if (remaining === -1) {
      this.#rooms.delete(room.code);
      return { kind: 'closed', code: room.code };
    }
    // The host's seat is gone, so the lowest remaining seat inherits it
    if (room.host === slot) room.host = remaining;
    return { kind: 'updated', view: viewOfRoom(room) };
  }

  setCharacter(conn: ConnectionId, character: CharacterKind): RoomResult<RoomView> {
    return this.#updateSeat(conn, (seat) => {
      seat.character = character;
      // A pick after readying would otherwise start the match on a stale choice
      seat.readiness = Readiness.NOT_READY;
    });
  }

  setReady(conn: ConnectionId, readiness: Readiness): RoomResult<RoomView> {
    return this.#updateSeat(conn, (seat) => { seat.readiness = readiness; });
  }

  /** Host only. Changing mode re-teams every seat through teamFor. */
  setMode(conn: ConnectionId, mode: GameMode): RoomResult<RoomView> {
    const found = this.#locate(conn);
    if (!found) return err('NOT_IN_ROOM');
    const { room, slot } = found;
    if (room.host !== slot) return err('NOT_HOST');

    room.mode = mode;
    return okay(viewOfRoom(room));
  }

  /** Host only. What the next match plays to. */
  setWinCondition(conn: ConnectionId, win: WinCondition): RoomResult<RoomView> {
    const found = this.#locate(conn);
    if (!found) return err('NOT_IN_ROOM');
    const { room, slot } = found;
    if (room.host !== slot) return err('NOT_HOST');

    room.win = win;
    return okay(viewOfRoom(room));
  }

  /** Marks the room as playing, so late joiners get ROOM_IN_MATCH. */
  beginMatch(code: RoomCode): void {
    const room = this.#rooms.get(code);
    if (room) room.phase = RoomPhase.IN_MATCH;
  }

  /**
   * Puts a room back in its lobby once the match is over.
   *
   * Readiness is cleared with it, or every seat would still be ready and the
   * next match would begin the instant this one ended. Returns the view to
   * broadcast, or null if the room has since gone.
   */
  endMatch(code: RoomCode): RoomView | null {
    const room = this.#rooms.get(code);
    if (!room) return null;
    room.phase = RoomPhase.LOBBY;
    for (const seat of room.seats) if (seat) seat.readiness = Readiness.NOT_READY;
    return viewOfRoom(room);
  }

  /** True only for an occupied lobby whose every seat has readied. */
  allReady(code: RoomCode): boolean {
    const occupied = this.#rooms.get(code)?.seats.filter((s) => s !== undefined) ?? [];
    return occupied.length > 0 && occupied.every((s) => s!.readiness === Readiness.READY);
  }

  /**
   * Who to send a room's state to, paired with the slot each one holds. The
   * slot travels with the connection because ROOM_STATE carries the recipient's
   * own id, so the server builds one message per seat rather than broadcasting.
   */
  seatsOf(code: RoomCode): { conn: ConnectionId; slot: PlayerId }[] {
    const room = this.#rooms.get(code);
    if (!room) return [];
    const seated: { conn: ConnectionId; slot: PlayerId }[] = [];
    room.seats.forEach((seat, slot) => {
      if (seat) seated.push({ conn: seat.conn, slot });
    });
    return seated;
  }

  /** The room a connection sits in, or null when it holds no seat. */
  viewFor(conn: ConnectionId): RoomView | null {
    const found = this.#locate(conn);
    return found ? viewOfRoom(found.room) : null;
  }

  /** A room by code. Fails with ROOM_NOT_FOUND so callers read like the rest. */
  viewOf(code: RoomCode): RoomResult<RoomView> {
    const room = this.#rooms.get(code);
    return room ? okay(viewOfRoom(room)) : err('ROOM_NOT_FOUND');
  }

  #seat(room: Room, slot: PlayerId, conn: ConnectionId, name: string): void {
    room.seats[slot] = { conn, name, character: 'archer', readiness: Readiness.NOT_READY };
    this.#byConnection.set(conn, room.code);
  }

  #locate(conn: ConnectionId): { room: Room; slot: PlayerId } | null {
    const code = this.#byConnection.get(conn);
    if (code === undefined) return null;
    const room = this.#rooms.get(code);
    if (!room) return null;
    const slot = room.seats.findIndex((s) => s?.conn === conn);
    return slot === -1 ? null : { room, slot };
  }

  /** Shared shape for the per-seat setters: find, mutate, return the new view. */
  #updateSeat(conn: ConnectionId, change: (seat: Seat) => void): RoomResult<RoomView> {
    const found = this.#locate(conn);
    if (!found) return err('NOT_IN_ROOM');
    const seat = found.room.seats[found.slot];
    if (!seat) return err('NOT_IN_ROOM');

    change(seat);
    return okay(viewOfRoom(found.room));
  }

  /** A code no live room holds, or null once the attempts run out. */
  #freeCode(): RoomCode | null {
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      const code = this.#newCode();
      if (!this.#rooms.has(code)) return code;
    }
    return null;
  }
}
