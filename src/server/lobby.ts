/**
 * Turns one client frame into the messages that answer it. This is the whole
 * server, minus the socket: it takes an opaque connection id and an untrusted
 * value, and returns what to send and to whom. Nothing here opens a port, reads
 * a clock, or throws.
 *
 * Keeping it pure is what makes a four-player lobby testable in milliseconds.
 * The ws entry point is a shell that forwards frames in and writes Outbounds
 * out.
 */

import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type PlayerStart,
  type RoomCode,
  type ServerMessage,
} from '../net/protocol';
import {
  Readiness,
  RoomStore,
  type ConnectionId,
  type RoomResult,
  type RoomView,
} from './room';

/** One message bound for one connection. */
export interface Outbound {
  to: ConnectionId;
  message: ServerMessage;
}

export interface LobbyOptions {
  rooms: RoomStore;
  /** Server clock in milliseconds, injected so PONG is testable. */
  now: () => number;
  /**
   * Map seed for the next match, injected for the same reason as the room code
   * generator: the store stays pure and a test can force a known map.
   */
  newSeed: () => number;
}

/**
 * Where each seat starts. Spread around the arena so nobody spawns on top of
 * anyone else. Phase 2 will take these from level data instead; four fixed
 * points are enough while the sim still lives in the legacy monolith.
 */
const SPAWN_POINTS = [
  { x: 160, y: 160 },
  { x: 160, y: 544 },
  { x: 480, y: 160 },
  { x: 480, y: 544 },
] as const;

/** What the server knows about a connection once it has said hello. */
interface Session {
  name: string;
}

/** Human-readable text for each code. The client may show its own instead. */
const ERROR_TEXT: Record<ErrorCode, string> = {
  VERSION_MISMATCH: 'This client is out of date.',
  BAD_MESSAGE: 'That message made no sense here.',
  BAD_NAME: 'Pick a name of 1 to 16 characters.',
  ROOM_NOT_FOUND: 'No room has that code.',
  ROOM_FULL: 'That room already has four players.',
  ROOM_IN_MATCH: 'That room is already playing.',
  NOT_IN_ROOM: 'You are not in a room.',
  NOT_HOST: 'Only the host can do that.',
  SERVER_FULL: 'The server has no room to spare.',
  ALREADY_IN_ROOM: 'You are already in a room.',
};

export class Lobby {
  readonly #rooms: RoomStore;
  readonly #now: () => number;
  readonly #newSeed: () => number;
  readonly #sessions = new Map<ConnectionId, Session>();

  constructor(options: LobbyOptions) {
    this.#rooms = options.rooms;
    this.#now = options.now;
    this.#newSeed = options.newSeed;
  }

  /**
   * Handles one frame. `raw` is whatever came off the socket, already JSON
   * decoded but not trusted.
   */
  receive(conn: ConnectionId, raw: unknown): Outbound[] {
    const msg = parseClientMessage(raw);
    if (!msg) return [this.#error(conn, 'BAD_MESSAGE')];

    const session = this.#sessions.get(conn);
    if (msg.type === 'HELLO') {
      // A second hello would rename a seated player, so it is refused outright
      return session ? [this.#error(conn, 'BAD_MESSAGE')] : this.#greet(conn, msg);
    }
    if (!session) return [this.#error(conn, 'BAD_MESSAGE')];
    return this.#dispatch(conn, session, msg);
  }

  /** Handles a closed socket. Drops the seat and tells whoever is left. */
  close(conn: ConnectionId): Outbound[] {
    this.#sessions.delete(conn);
    const outcome = this.#rooms.leave(conn);
    return outcome.kind === 'updated' ? this.#roomState(outcome.view) : [];
  }

  #greet(conn: ConnectionId, msg: Extract<ClientMessage, { type: 'HELLO' }>): Outbound[] {
    if (msg.v !== PROTOCOL_VERSION) return [this.#error(conn, 'VERSION_MISMATCH')];
    this.#sessions.set(conn, { name: msg.name });
    return [{ to: conn, message: { type: 'WELCOME', v: PROTOCOL_VERSION } }];
  }

  #dispatch(
    conn: ConnectionId,
    session: Session,
    msg: Exclude<ClientMessage, { type: 'HELLO' }>,
  ): Outbound[] {
    switch (msg.type) {
      case 'CREATE_ROOM':
        return this.#answer(conn, this.#rooms.create(conn, session.name));
      case 'JOIN_ROOM':
        return this.#answer(conn, this.#rooms.join(conn, msg.code, session.name));
      case 'LEAVE_ROOM':
        return this.#leave(conn);
      case 'SET_CHARACTER':
        return this.#answer(conn, this.#rooms.setCharacter(conn, msg.character));
      case 'SET_READY':
        return this.#ready(conn, msg.ready ? Readiness.READY : Readiness.NOT_READY);
      case 'SET_MODE':
        return this.#answer(conn, this.#rooms.setMode(conn, msg.mode));
      case 'PING':
        return [{ to: conn, message: { type: 'PONG', sent: msg.sent, serverTime: this.#now() } }];
      case 'INPUT':
        // Matches arrive in phase 2. A lobby has nothing to do with an input.
        return [];
    }
  }

  /**
   * Sets readiness, then starts the match if that was the last seat to ready.
   * MATCH_START is appended to the same batch: the server watches for it to
   * know a Match object is now owed, so the intent rides on the message rather
   * than a second return channel.
   */
  #ready(conn: ConnectionId, readiness: Readiness): Outbound[] {
    const result = this.#rooms.setReady(conn, readiness);
    if (!result.ok) return [this.#error(conn, result.error)];

    const view = result.value;
    const out = this.#roomState(view);
    if (!this.#rooms.allReady(view.code)) return out;

    this.#rooms.beginMatch(view.code);
    const starts: PlayerStart[] = view.slots.map((slot) => ({
      id: slot.id,
      character: slot.character,
      team: slot.team,
      ...SPAWN_POINTS[slot.id % SPAWN_POINTS.length]!,
    }));
    const start: ServerMessage = {
      type: 'MATCH_START',
      seed: this.#newSeed(),
      mode: view.mode,
      starts,
    };
    for (const { conn: seat } of this.#rooms.seatsOf(view.code)) {
      out.push({ to: seat, message: start });
    }
    return out;
  }

  #leave(conn: ConnectionId): Outbound[] {
    const outcome = this.#rooms.leave(conn);
    switch (outcome.kind) {
      case 'not-in-room':
        return [this.#error(conn, 'NOT_IN_ROOM')];
      case 'closed':
        return [];
      case 'updated':
        return this.#roomState(outcome.view);
    }
  }

  /** Room state to every seat on success, the error to the sender on failure. */
  #answer(conn: ConnectionId, result: RoomResult<RoomView>): Outbound[] {
    return result.ok ? this.#roomState(result.value) : [this.#error(conn, result.error)];
  }

  /**
   * One message per seat, each carrying that seat's own id. Built here rather
   * than broadcast because a client cannot otherwise find itself in `slots`.
   */
  #roomState(view: RoomView): Outbound[] {
    return this.#rooms.seatsOf(view.code).map(({ conn, slot }) => ({
      to: conn,
      message: { ...view, type: 'ROOM_STATE' as const, you: slot },
    }));
  }

  #error(conn: ConnectionId, code: ErrorCode): Outbound {
    return { to: conn, message: { type: 'ERROR', code, message: ERROR_TEXT[code] } };
  }
}

/** Four uppercase letters, the shape ROOM_CODE_PATTERN accepts. */
export function randomRoomCode(random: () => number = Math.random): RoomCode {
  const A = 'A'.charCodeAt(0);
  let code = '';
  for (let i = 0; i < 4; i++) code += String.fromCharCode(A + Math.floor(random() * 26));
  return code;
}
