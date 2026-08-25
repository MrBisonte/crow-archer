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

import { MAP_KINDS, type MapKind } from '../sim/arena-map';
import { Button, type InputCommand } from '../sim/input';
import { Team } from '../sim/team';

// Re-exported so every consumer of the wire protocol gets it from here, the
// same as GameMode and CharacterKind, rather than reaching into sim/ directly.
export type { MapKind };

/**
 * Protocol revision. Bump it on any change to a message shape, and on any
 * change to what a field in one means: a client that reads `state` as always
 * alive is as broken by a new meaning as by a new field.
 *
 * It is carried on the two handshake messages only: HELLO from the client and
 * WELCOME from the server. Both sides check it there and drop the connection on
 * a mismatch. After a successful handshake the two sides agree, so no later
 * message repeats it. This keeps the version out of SNAPSHOT, which is sent
 * 20 times a second.
 */
export const PROTOCOL_VERSION = 5;

/** Players in one room. Fixed at 4: 4-player co-op or 2v2 deathmatch. */
export const MAX_PLAYERS = 4;

/** Display name length cap. Identity is a name only, there are no accounts. */
export const MAX_NAME_LENGTH = 16;

/** Room codes are 4 uppercase letters, short enough to read aloud. */
export const ROOM_CODE_PATTERN = /^[A-Z]{4}$/;

/**
 * Path the socket lives on, so the same origin can also serve the page.
 *
 * It is here rather than in the server because three places must agree on it:
 * the server mounts it, the client derives its URL from it, and the dev proxy
 * forwards it from the Vite port to the server port.
 */
export const WS_PATH = '/ws';

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

export type CharacterKind = 'archer' | 'wizard' | 'knight' | 'ranger' | 'sapper';

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

/**
 * A room's state. Server and client share this one definition: the server
 * builds it, ROOM_STATE carries it, and the client renders it. The recipient's
 * own slot is not part of it, because a room does not have a point of view —
 * ROOM_STATE adds `you` per recipient.
 */
export interface RoomView {
  code: RoomCode;
  mode: GameMode;
  /** Which arena the match will use. Set by the host, shown to everyone. */
  mapKind: MapKind;
  host: PlayerId;
  slots: PlayerSlot[];
  /** What the match will play to. Set by the host, shown to everyone. */
  win: WinCondition;
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
  /**
   * A blast that has just gone off, carried for a few ticks so it can be drawn.
   *
   * A stick of dynamite that simply vanished from one snapshot to the next was
   * indistinguishable from one that fizzled: the whole weapon was invisible.
   * Explosions are the one cosmetic the wire carries, because the client cannot
   * infer where a shot that hit nobody went off.
   */
  BLAST: 5,
  /**
   * A tile a fiery shot just charred, carried the same way and for the same
   * reason as BLAST: the server mutates its grid and says nothing further, so
   * without this the client keeps drawing a tree that is no longer there.
   */
  BURN: 6,
} as const;

export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

/**
 * What `state` means on a PLAYER entity. A dead player stays in the snapshot so
 * clients can draw the body waiting to respawn rather than have it vanish.
 *
 * On a PROJECTILE, `state` carries the team that fired it, so an arrow is drawn
 * in its shooter's colour without the client having to remember whose it was.
 */
export const PlayerState = {
  ALIVE: 0,
  DEAD: 1,
} as const;

export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState];

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
  /**
   * The running score. Two integers on every snapshot rather than a message per
   * kill: a snapshot states what is true, so a client that missed one is
   * corrected by the next instead of staying wrong. Costs about 20 bytes.
   */
  scores: TeamScores;
}

/** Where one player begins the match. Sent once, in MATCH_START. */
export interface PlayerStart {
  id: PlayerId;
  character: CharacterKind;
  team: PlayerTeam;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Win conditions
// ---------------------------------------------------------------------------

/**
 * What ends a deathmatch. One or the other, never both and never neither, so it
 * is a union rather than two nullable settings that could contradict each other.
 */
export type WinCondition =
  | { kind: 'frags'; target: number }
  | { kind: 'time'; minutes: number };

/** Frag targets offered, lowest first. The host cycles through these. */
export const FRAG_TARGETS = [10, 15, 20, 25, 30] as const;

/** Time limits in minutes, lowest first. */
export const TIME_LIMITS = [5, 6, 7, 8, 9, 10] as const;

/** What a new room plays to until the host says otherwise. */
export const DEFAULT_WIN_CONDITION: WinCondition = { kind: 'frags', target: FRAG_TARGETS[0] };

/**
 * Builds a win condition, refusing a value that is not on offer.
 *
 * The bounds are the rule, so they are enforced here rather than trusted at
 * every call site: a frag target of 3 or a 90 minute round has to be
 * unrepresentable, not merely discouraged.
 */
export function winCondition(kind: 'frags' | 'time', value: number): WinCondition | null {
  if (kind === 'frags') {
    return FRAG_TARGETS.includes(value as (typeof FRAG_TARGETS)[number])
      ? { kind: 'frags', target: value }
      : null;
  }
  return TIME_LIMITS.includes(value as (typeof TIME_LIMITS)[number])
    ? { kind: 'time', minutes: value }
    : null;
}

/** The next value on offer, wrapping. Used by the lobby to cycle a setting. */
export function nextWinCondition(current: WinCondition, kind: 'frags' | 'time'): WinCondition {
  if (kind === 'frags') {
    const at = current.kind === 'frags' ? FRAG_TARGETS.indexOf(current.target as 10) : -1;
    return { kind: 'frags', target: FRAG_TARGETS[(at + 1) % FRAG_TARGETS.length]! };
  }
  const at = current.kind === 'time' ? TIME_LIMITS.indexOf(current.minutes as 5) : -1;
  return { kind: 'time', minutes: TIME_LIMITS[(at + 1) % TIME_LIMITS.length]! };
}

/** How the two sides stand. Carried on every snapshot so it cannot drift. */
export interface TeamScores {
  a: number;
  b: number;
}

/**
 * How a match ended. Co-op reports the wave reached; deathmatch reports frags.
 *
 * `winner` is null for a draw, which a time limit can produce and a frag target
 * cannot. Leaving it out would mean a tie had to be encoded as one side winning.
 */
export type MatchResult =
  | { outcome: 'COOP_CLEARED'; wave: number }
  | { outcome: 'COOP_WIPED'; wave: number }
  | { outcome: 'DEATHMATCH'; winner: PlayerTeam | null; scoreA: number; scoreB: number };

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
  // Host only. Same rejection as SET_MODE.
  | { type: 'SET_MAP'; mapKind: MapKind }
  // Host only. Cycles the frag target or the time limit, one or the other.
  | { type: 'SET_WIN_CONDITION'; win: WinCondition }
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
  | ({ type: 'ROOM_STATE'; you: PlayerId } & RoomView)
  | { type: 'ERROR'; code: ErrorCode; message: string }
  /**
   * Match begins. `seed` is the uint32 every client feeds to mapgen, which is
   * why the terrain never crosses the network: 4 bytes stand in for the grid.
   */
  | {
      type: 'MATCH_START';
      seed: number;
      mode: GameMode;
      mapKind: MapKind;
      starts: PlayerStart[];
      win: WinCondition;
    }
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

/**
 * Every playable character. Exported because it is the one written-down copy
 * of the roster: `CharacterKind` and `isCharacter` both check against it, and
 * so do the tests that make sure a new hero reached every lookup table.
 */
export const CHARACTERS: readonly CharacterKind[] = ['archer', 'wizard', 'knight', 'ranger', 'sapper'];
const MODES: readonly GameMode[] = ['coop', 'deathmatch'];

// The wire accepts exactly the kinds the game defines, validated against the
// one list in arena-map.ts. This used to be a second literal array here, kept
// honest by its own exhaustiveness guard; the guard moved with the list. A
// validator that omits a kind still fails silently -- the host picks the map,
// the server refuses SET_MAP, and the lobby keeps the old one -- which is
// precisely why neither the list nor the guard should be duplicated.
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

const isMapKind = (v: unknown): v is MapKind => isOneOf(MAP_KINDS, v);

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

const isTeamScores = (v: unknown): v is TeamScores =>
  isRec(v) && isCount(v['a']) && isCount(v['b']);

const isSnapshot = (v: unknown): v is Snapshot =>
  isRec(v) &&
  isCount(v['tick']) &&
  isArrayOf(v['entities'], isEntitySnapshot) &&
  isArrayOf(v['acks'], isInputAck) &&
  isTeamScores(v['scores']);

/**
 * Accepts only a value that is on offer, so a peer cannot ask for a two frag
 * match or an hour-long round by sending one.
 */
const isWinCondition = (v: unknown): v is WinCondition => {
  if (!isRec(v)) return false;
  if (v['kind'] === 'frags') return winCondition('frags', v['target'] as number) !== null;
  if (v['kind'] === 'time') return winCondition('time', v['minutes'] as number) !== null;
  return false;
};

const isMatchResult = (v: unknown): v is MatchResult => {
  if (!isRec(v)) return false;
  switch (v['outcome']) {
    case 'COOP_CLEARED':
    case 'COOP_WIPED':
      return isCount(v['wave']);
    case 'DEATHMATCH':
      // null is a draw, which a time limit can produce.
      return (
        (v['winner'] === null || isPlayerTeam(v['winner'])) &&
        isCount(v['scoreA']) &&
        isCount(v['scoreB'])
      );
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
  SET_MAP: (m) => {
    const mapKind = m['mapKind'];
    return isMapKind(mapKind) ? { type: 'SET_MAP', mapKind } : null;
  },
  SET_WIN_CONDITION: (m) => {
    const win = m['win'];
    return isWinCondition(win) ? { type: 'SET_WIN_CONDITION', win } : null;
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
    const mapKind = m['mapKind'];
    const host = m['host'];
    const slots = m['slots'];
    const you = m['you'];
    const win = m['win'];
    if (!isRoomCode(code) || !isMode(mode) || !isMapKind(mapKind)) return null;
    if (!isPlayerId(host) || !isPlayerId(you)) return null;
    if (!isArrayOf(slots, isPlayerSlot) || slots.length > MAX_PLAYERS) return null;
    if (!isWinCondition(win)) return null;
    return { type: 'ROOM_STATE', code, mode, mapKind, host, slots, you, win };
  },
  ERROR: (m) => {
    const code = m['code'];
    const message = m['message'];
    return isErrorCode(code) && isStr(message) ? { type: 'ERROR', code, message } : null;
  },
  MATCH_START: (m) => {
    const seed = m['seed'];
    const mode = m['mode'];
    const mapKind = m['mapKind'];
    const starts = m['starts'];
    const win = m['win'];
    if (!isUint32(seed) || !isMode(mode) || !isMapKind(mapKind)) return null;
    if (!isArrayOf(starts, isPlayerStart) || starts.length > MAX_PLAYERS) return null;
    if (!isWinCondition(win)) return null;
    return { type: 'MATCH_START', seed, mode, mapKind, starts, win };
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
