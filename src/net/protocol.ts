/**
 * Wire protocol between browser clients and the Node server. This is the only
 * shared contract: client and server both import these types, so a mismatched
 * message fails at compile time instead of at runtime.
 *
 * The model is server-authoritative with client prediction. A client sends
 * numbered inputs and renders snapshots; the server runs the only simulation.
 * Messages carry gameplay facts, never cosmetics. Particles, audio, and screen
 * shake stay local and are driven by the sim event bus.
 *
 * Transport is separate. These types describe what is sent, not how. A
 * WebSocket carries them first, and a WebRTC DataChannel can carry the same
 * types later with no change here.
 */

import { Button, type InputCommand } from '../sim/input';
import { Team } from '../sim/team';

/**
 * Protocol revision. Bump it on any change to a message shape.
 *
 * It is carried on the two handshake messages only: HELLO from the client and
 * WELCOME from the server. Both sides check it there and drop the connection on
 * a mismatch. After a successful handshake the two sides agree, so no later
 * message repeats it. This keeps the version out of SNAPSHOT, which is sent
 * 20 times a second.
 */
export const PROTOCOL_VERSION = 3;

/** Players in one room. Fixed at 4: 4-player co-op or 2v2 deathmatch. */
export const MAX_PLAYERS = 4;

/** Display name length cap. Identity is a name only, there are no accounts. */
export const MAX_NAME_LENGTH = 16;

/** Room codes are 4 uppercase letters, short enough to read aloud. */
export const ROOM_CODE_PATTERN = /^[A-Z]{4}$/;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Slot index in the room, 0 to MAX_PLAYERS - 1. Assigned by the server. */
export type PlayerId = number;

/** A 4-letter uppercase room code, for example 'QRTZ'. */
export type RoomCode = string;

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export type CharacterKind = 'archer' | 'wizard' | 'knight';

/** 'coop' is 4-player PVE. 'deathmatch' is 2v2. The host picks. */
export type GameMode = 'coop' | 'deathmatch';

/**
 * The teams a human can hold. Team.ENEMY is server-side only, so a player slot
 * cannot carry it. In co-op every player is on Team.A, which turns off damage
 * between players through the existing canDamage rule.
 */
export type PlayerTeam = typeof Team.A | typeof Team.B;

/** One lobby seat. The server sends all MAX_PLAYERS filled seats in ROOM_STATE. */
export interface PlayerSlot {
  id: PlayerId;
  name: string;
  character: CharacterKind;
  ready: boolean;
  team: PlayerTeam;
}

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

/** What an EntitySnapshot describes. Numeric so it costs one digit on the wire. */
export const EntityKind = {
  PLAYER: 0,
  CROW: 1,
  BOSS: 2,
  PROJECTILE: 3,
  PICKUP: 4,
} as const;

export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

/**
 * One entity in one snapshot. Every field is a number, and there are six of
 * them, because this is the message that repeats: every entity, 20 times a
 * second, to every client.
 *
 * JSON encodes one entity in about 55 bytes, so the 1 KB snapshot budget holds
 * roughly 18 entities. Rounding x and y to whole pixels before sending keeps
 * that figure stable, since a float prints far wider than an integer.
 *
 * `state` is a small packed integer read according to `kind`, for example a
 * player's facing and action bits. Phase 2 fixes the layout per kind. Nothing
 * cosmetic belongs here.
 */
export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  hp: number;
  state: number;
}

/** The last input the server consumed from one player. Prediction replays past it. */
export interface InputAck {
  id: PlayerId;
  seq: number;
}

/**
 * One server tick broadcast to every client. Clients buffer these and render
 * about 100 ms behind, interpolating between the two that bracket the render
 * time. `acks` carries one entry per connected player, so a client can drop the
 * inputs the server has already applied and replay only the rest.
 */
export interface Snapshot {
  tick: number;
  entities: EntitySnapshot[];
  acks: InputAck[];
}

/** Where one player begins the match. Sent once, in MATCH_START. */
export interface PlayerStart {
  id: PlayerId;
  character: CharacterKind;
  team: PlayerTeam;
  x: number;
  y: number;
}

/** How a match ended. Co-op reports the wave reached; deathmatch reports frags. */
export type MatchResult =
  | { outcome: 'COOP_CLEARED'; wave: number }
  | { outcome: 'COOP_WIPED'; wave: number }
  | { outcome: 'DEATHMATCH'; winner: PlayerTeam; scoreA: number; scoreB: number };

/** Why the server rejected something. The client maps these to its own text. */
export type ErrorCode =
  | 'VERSION_MISMATCH'
  | 'BAD_MESSAGE'
  | 'BAD_NAME'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_MATCH'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  // No free room code turned up, or the server is at its room cap
  | 'SERVER_FULL'
  // Create or join arrived from a connection that already holds a seat
  | 'ALREADY_IN_ROOM';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Client to server. Every message is a plain JSON object tagged by `type`.
 * The server treats all of it as untrusted and runs it through
 * parseClientMessage before touching room state.
 */
export type ClientMessage =
  /**
   * Handshake, first message on the socket.
   *
   * `v` is any number, not the current literal, so a client on the wrong
   * version still parses and the server can answer VERSION_MISMATCH instead of
   * dropping it silently. WELCOME stays strict in the other direction: the
   * server owes a mismatched client an explanation, a mismatched server owes
   * the client nothing it can act on.
   */
  | { type: 'HELLO'; v: number; name: string }
  // Lobby
  | { type: 'CREATE_ROOM' }
  | { type: 'JOIN_ROOM'; code: RoomCode }
  | { type: 'LEAVE_ROOM' }
  | { type: 'SET_CHARACTER'; character: CharacterKind }
  | { type: 'SET_READY'; ready: boolean }
  // Host only. The server rejects this from any other player with NOT_HOST.
  | { type: 'SET_MODE'; mode: GameMode }
  // Match. One INPUT per sim tick, 60 times a second.
  | { type: 'INPUT'; cmd: InputCommand }
  // Round-trip probe. `sent` is the client clock reading, echoed back untouched.
  | { type: 'PING'; sent: number };

/**
 * Server to client. A client runs every message through parseServerMessage, so
 * a server on a newer protocol cannot drive it into an unknown state.
 */
export type ServerMessage =
  /**
   * Handshake reply. It carries no identity: a player has no id until they hold
   * a seat, and a seat belongs to a room. ROOM_STATE.you supplies it from then
   * on. Reconnect, which is what a durable session id would serve, is phase 4.
   */
  | { type: 'WELCOME'; v: typeof PROTOCOL_VERSION }
  /**
   * Full lobby state. Sent on every change, never as a delta.
   *
   * `you` is the recipient's own slot, so this message is built per recipient
   * rather than broadcast verbatim. Without it a client cannot pick itself out
   * of `slots`, since nothing else on the wire ties a seat to a connection.
   * Lobby changes are rare, so the extra copies cost nothing.
   */
  | {
      type: 'ROOM_STATE';
      code: RoomCode;
      mode: GameMode;
      host: PlayerId;
      slots: PlayerSlot[];
      you: PlayerId;
    }
  | { type: 'ERROR'; code: ErrorCode; message: string }
  /**
   * Match begins. `seed` is the uint32 every client feeds to mapgen, which is
   * why the terrain never crosses the network: 4 bytes stand in for the grid.
   */
  | { type: 'MATCH_START'; seed: number; mode: GameMode; starts: PlayerStart[] }
  // Broadcast at 20 Hz while the match runs.
  | { type: 'SNAPSHOT'; snap: Snapshot }
  | { type: 'MATCH_END'; result: MatchResult }
  // `sent` is the client value from PING. `serverTime` is the server clock.
  | { type: 'PONG'; sent: number; serverTime: number };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A decoded JSON object, before any field is checked. */
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isInt = (v: unknown): v is number => Number.isInteger(v);

const isStr = (v: unknown): v is string => typeof v === 'string';

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const isUint32 = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 0xffffffff;

/** Non-negative counter: tick, seq, score, wave. */
const isCount = (v: unknown): v is number => isInt(v) && v >= 0;

const isOneOf = <T extends string>(allowed: readonly T[], v: unknown): v is T =>
  isStr(v) && (allowed as readonly string[]).includes(v);

const isArrayOf = <T>(v: unknown, item: (x: unknown) => x is T): v is T[] =>
  Array.isArray(v) && v.every(item);

const CHARACTERS: readonly CharacterKind[] = ['archer', 'wizard', 'knight'];
const MODES: readonly GameMode[] = ['coop', 'deathmatch'];
const ERROR_CODES: readonly ErrorCode[] = [
  'VERSION_MISMATCH',
  'BAD_MESSAGE',
  'BAD_NAME',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_IN_MATCH',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'SERVER_FULL',
  'ALREADY_IN_ROOM',
];

const ENTITY_KINDS: readonly EntityKind[] = Object.values(EntityKind);

/** Every button bit set. A command claiming a bit outside this mask is malformed. */
const BUTTON_MASK = Object.values(Button).reduce<number>((mask, bit) => mask | bit, 0);

const isPlayerId = (v: unknown): v is PlayerId => isInt(v) && v >= 0 && v < MAX_PLAYERS;

const isRoomCode = (v: unknown): v is RoomCode => isStr(v) && ROOM_CODE_PATTERN.test(v);

const isName = (v: unknown): v is string =>
  isStr(v) && v.length > 0 && v.length <= MAX_NAME_LENGTH;

const isCharacter = (v: unknown): v is CharacterKind => isOneOf(CHARACTERS, v);

const isMode = (v: unknown): v is GameMode => isOneOf(MODES, v);

const isErrorCode = (v: unknown): v is ErrorCode => isOneOf(ERROR_CODES, v);

const isEntityKind = (v: unknown): v is EntityKind =>
  ENTITY_KINDS.some((k) => k === v);

const isPlayerTeam = (v: unknown): v is PlayerTeam => v === Team.A || v === Team.B;

const isInputCommand = (v: unknown): v is InputCommand =>
  isRec(v) &&
  isCount(v['seq']) &&
  isInt(v['buttons']) &&
  (v['buttons'] & ~BUTTON_MASK) === 0 &&
  isNum(v['aimAngle']);

const isPlayerSlot = (v: unknown): v is PlayerSlot =>
  isRec(v) &&
  isPlayerId(v['id']) &&
  isName(v['name']) &&
  isCharacter(v['character']) &&
  isBool(v['ready']) &&
  isPlayerTeam(v['team']);

const isPlayerStart = (v: unknown): v is PlayerStart =>
  isRec(v) &&
  isPlayerId(v['id']) &&
  isCharacter(v['character']) &&
  isPlayerTeam(v['team']) &&
  isNum(v['x']) &&
  isNum(v['y']);

const isEntitySnapshot = (v: unknown): v is EntitySnapshot =>
  isRec(v) &&
  isInt(v['id']) &&
  isEntityKind(v['kind']) &&
  isNum(v['x']) &&
  isNum(v['y']) &&
  isNum(v['hp']) &&
  isInt(v['state']);

const isInputAck = (v: unknown): v is InputAck =>
  isRec(v) && isPlayerId(v['id']) && isCount(v['seq']);

const isSnapshot = (v: unknown): v is Snapshot =>
  isRec(v) &&
  isCount(v['tick']) &&
  isArrayOf(v['entities'], isEntitySnapshot) &&
  isArrayOf(v['acks'], isInputAck);

const isMatchResult = (v: unknown): v is MatchResult => {
  if (!isRec(v)) return false;
  switch (v['outcome']) {
    case 'COOP_CLEARED':
    case 'COOP_WIPED':
      return isCount(v['wave']);
    case 'DEATHMATCH':
      return isPlayerTeam(v['winner']) && isCount(v['scoreA']) && isCount(v['scoreB']);
    default:
      return false;
  }
};

/**
 * One reader per message type. Each returns the typed message or null, and
 * rebuilds the object from checked fields rather than casting the input, so no
 * unchecked extra field survives into game code.
 *
 * The tables are keyed by the union's own tags. Adding a message variant adds a
 * table entry; forgetting one is a compile error, not a silent gap.
 */
type Reader<M, K> = (m: Rec) => Extract<M, { type: K }> | null;

type ClientReaders = { [K in ClientMessage['type']]: Reader<ClientMessage, K> };

type ServerReaders = { [K in ServerMessage['type']]: Reader<ServerMessage, K> };

const clientReaders: ClientReaders = {
  HELLO: (m) => {
    const v = m['v'];
    const name = m['name'];
    if (!isInt(v) || !isName(name)) return null;
    return { type: 'HELLO', v, name };
  },
  CREATE_ROOM: () => ({ type: 'CREATE_ROOM' }),
  JOIN_ROOM: (m) => {
    const code = m['code'];
    return isRoomCode(code) ? { type: 'JOIN_ROOM', code } : null;
  },
  LEAVE_ROOM: () => ({ type: 'LEAVE_ROOM' }),
  SET_CHARACTER: (m) => {
    const character = m['character'];
    return isCharacter(character) ? { type: 'SET_CHARACTER', character } : null;
  },
  SET_READY: (m) => {
    const ready = m['ready'];
    return isBool(ready) ? { type: 'SET_READY', ready } : null;
  },
  SET_MODE: (m) => {
    const mode = m['mode'];
    return isMode(mode) ? { type: 'SET_MODE', mode } : null;
  },
  INPUT: (m) => {
    const cmd = m['cmd'];
    if (!isInputCommand(cmd)) return null;
    return { type: 'INPUT', cmd: { seq: cmd.seq, buttons: cmd.buttons, aimAngle: cmd.aimAngle } };
  },
  PING: (m) => {
    const sent = m['sent'];
    return isNum(sent) ? { type: 'PING', sent } : null;
  },
};

const serverReaders: ServerReaders = {
  WELCOME: (m) =>
    m['v'] === PROTOCOL_VERSION ? { type: 'WELCOME', v: PROTOCOL_VERSION } : null,
  ROOM_STATE: (m) => {
    const code = m['code'];
    const mode = m['mode'];
    const host = m['host'];
    const slots = m['slots'];
    const you = m['you'];
    if (!isRoomCode(code) || !isMode(mode) || !isPlayerId(host) || !isPlayerId(you)) return null;
    if (!isArrayOf(slots, isPlayerSlot) || slots.length > MAX_PLAYERS) return null;
    return { type: 'ROOM_STATE', code, mode, host, slots, you };
  },
  ERROR: (m) => {
    const code = m['code'];
    const message = m['message'];
    return isErrorCode(code) && isStr(message) ? { type: 'ERROR', code, message } : null;
  },
  MATCH_START: (m) => {
    const seed = m['seed'];
    const mode = m['mode'];
    const starts = m['starts'];
    if (!isUint32(seed) || !isMode(mode)) return null;
    if (!isArrayOf(starts, isPlayerStart) || starts.length > MAX_PLAYERS) return null;
    return { type: 'MATCH_START', seed, mode, starts };
  },
  SNAPSHOT: (m) => {
    const snap = m['snap'];
    return isSnapshot(snap) ? { type: 'SNAPSHOT', snap } : null;
  },
  MATCH_END: (m) => {
    const result = m['result'];
    return isMatchResult(result) ? { type: 'MATCH_END', result } : null;
  },
  PONG: (m) => {
    const sent = m['sent'];
    const serverTime = m['serverTime'];
    return isNum(sent) && isNum(serverTime) ? { type: 'PONG', sent, serverTime } : null;
  },
};

/** Dispatches an untrusted value to the reader named by its `type` tag. */
function parse<M>(
  table: Record<string, ((m: Rec) => M | null) | undefined>,
  raw: unknown,
): M | null {
  if (!isRec(raw)) return null;
  const tag = raw['type'];
  if (!isStr(tag)) return null;
  const read = table[tag];
  return read === undefined ? null : read(raw);
}

/**
 * Decodes an untrusted value into a ClientMessage. Returns null when the value
 * is not an object, carries no known `type`, fails the version check, or has a
 * field of the wrong shape. The server treats null as a protocol error and
 * replies with ERROR BAD_MESSAGE.
 */
export const parseClientMessage = (raw: unknown): ClientMessage | null =>
  parse<ClientMessage>(clientReaders, raw);

/** Decodes an untrusted value into a ServerMessage. Null on any failure, as above. */
export const parseServerMessage = (raw: unknown): ServerMessage | null =>
  parse<ServerMessage>(serverReaders, raw);
