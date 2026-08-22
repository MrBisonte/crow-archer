import { describe, expect, it } from 'vitest';

import { MAP_RULES, type MapKind } from '../sim/arena-map';
import { Button } from '../sim/input';
import { Team } from '../sim/team';
import {
  type ClientMessage,
  DEFAULT_WIN_CONDITION,
  EntityKind,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from './protocol';

const hello: ClientMessage = { type: 'HELLO', v: PROTOCOL_VERSION, name: 'crow' };

const input: ClientMessage = {
  type: 'INPUT',
  cmd: { seq: 42, buttons: Button.UP | Button.FIRE, aimAngle: 1.25 },
};

const welcome: ServerMessage = { type: 'WELCOME', v: PROTOCOL_VERSION };

const snapshot: ServerMessage = {
  type: 'SNAPSHOT',
  snap: {
    tick: 1200,
    entities: [
      { id: 0, kind: EntityKind.PLAYER, x: 120, y: 88, hp: 5, state: 3 },
      { id: 7, kind: EntityKind.CROW, x: 512, y: 240, hp: 1, state: 0 },
    ],
    acks: [
      { id: 0, seq: 41 },
      { id: 1, seq: 39 },
    ],
    scores: { a: 3, b: 5 },
  },
};

/** Sends a message the way the transport does, so tests see what a peer sees. */
const overWire = (msg: unknown): unknown => JSON.parse(JSON.stringify(msg));

describe('parseClientMessage', () => {
  it('accepts a valid HELLO', () => {
    expect(parseClientMessage(hello)).toEqual(hello);
  });

  it('accepts every lobby message', () => {
    const msgs: ClientMessage[] = [
      { type: 'CREATE_ROOM' },
      { type: 'JOIN_ROOM', code: 'QRTZ' },
      { type: 'LEAVE_ROOM' },
      { type: 'SET_CHARACTER', character: 'wizard' },
      { type: 'SET_READY', ready: true },
      { type: 'SET_MODE', mode: 'deathmatch' },
      { type: 'SET_MAP', mapKind: 'castle' },
      { type: 'PING', sent: 1000 },
    ];
    for (const m of msgs) expect(parseClientMessage(m)).toEqual(m);
  });

  // The validator's map list is written out by hand, and a map missing from it
  // does not fail loudly: SET_MAP is rejected at the room boundary, so the host
  // presses the key, the server drops the message, and the lobby just keeps
  // showing the old map. Reading the kinds off MAP_RULES is what makes a
  // forgotten one fail here instead of in a match nobody could start.
  it.each(Object.keys(MAP_RULES) as MapKind[])('accepts SET_MAP for %s', (mapKind) => {
    const msg: ClientMessage = { type: 'SET_MAP', mapKind };
    expect(parseClientMessage(overWire(msg))).toEqual(msg);
  });

  it('still refuses a map that does not exist', () => {
    expect(parseClientMessage({ type: 'SET_MAP', mapKind: 'volcano' })).toBeNull();
  });

  it('keeps a wrong HELLO version for the server to judge', () => {
    // A wrong version still parses, so the server can answer VERSION_MISMATCH
    // rather than drop the socket without a word. Only a non-integer is malformed.
    expect(parseClientMessage({ ...hello, v: PROTOCOL_VERSION + 1 }))
      .toEqual({ ...hello, v: PROTOCOL_VERSION + 1 });
    expect(parseClientMessage({ ...hello, v: 'three' })).toBeNull();
    expect(parseClientMessage({ ...hello, v: 1.5 })).toBeNull();
  });

  it('rejects a HELLO with no version', () => {
    expect(parseClientMessage({ type: 'HELLO', name: 'crow' })).toBeNull();
  });

  it('rejects an unknown type', () => {
    expect(parseClientMessage({ type: 'RESIGN' })).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage(undefined)).toBeNull();
    expect(parseClientMessage(7)).toBeNull();
    expect(parseClientMessage('HELLO')).toBeNull();
    expect(parseClientMessage([])).toBeNull();
    expect(parseClientMessage({})).toBeNull();
    expect(parseClientMessage({ name: 'crow' })).toBeNull();
    expect(parseClientMessage({ type: 42 })).toBeNull();
  });

  it('rejects a bad room code', () => {
    expect(parseClientMessage({ type: 'JOIN_ROOM', code: 'qrtz' })).toBeNull();
    expect(parseClientMessage({ type: 'JOIN_ROOM', code: 'QRT' })).toBeNull();
    expect(parseClientMessage({ type: 'JOIN_ROOM', code: 'QRTZZ' })).toBeNull();
    expect(parseClientMessage({ type: 'JOIN_ROOM', code: 'QR7Z' })).toBeNull();
  });

  it('rejects a name that is empty or too long', () => {
    expect(parseClientMessage({ ...hello, name: '' })).toBeNull();
    expect(parseClientMessage({ ...hello, name: 'x'.repeat(17) })).toBeNull();
  });

  it('rejects an unknown character, mode, and map', () => {
    expect(parseClientMessage({ type: 'SET_CHARACTER', character: 'bard' })).toBeNull();
    expect(parseClientMessage({ type: 'SET_MODE', mode: 'ctf' })).toBeNull();
    expect(parseClientMessage({ type: 'SET_MAP', mapKind: 'volcano' })).toBeNull();
  });

  it('rejects an INPUT with a bad command', () => {
    expect(parseClientMessage({ type: 'INPUT' })).toBeNull();
    expect(parseClientMessage({ type: 'INPUT', cmd: { seq: -1, buttons: 0, aimAngle: 0 } })).toBeNull();
    expect(parseClientMessage({ type: 'INPUT', cmd: { seq: 0, buttons: 0 } })).toBeNull();
    expect(parseClientMessage({ type: 'INPUT', cmd: { seq: 0, buttons: 1 << 20, aimAngle: 0 } })).toBeNull();
    expect(parseClientMessage({ type: 'INPUT', cmd: { seq: 0, buttons: 0, aimAngle: NaN } })).toBeNull();
  });

  it('drops fields the protocol does not define', () => {
    const parsed = parseClientMessage({ type: 'SET_READY', ready: true, admin: true });
    expect(parsed).toEqual({ type: 'SET_READY', ready: true });
  });
});

describe('parseServerMessage', () => {
  it('accepts a valid WELCOME', () => {
    expect(parseServerMessage(welcome)).toEqual(welcome);
  });

  it('accepts ROOM_STATE, MATCH_START, MATCH_END, and PONG', () => {
    const msgs: ServerMessage[] = [
      {
        type: 'ROOM_STATE',
        code: 'QRTZ',
        mode: 'coop',
        mapKind: 'forest',
        host: 0,
        slots: [{ id: 0, name: 'crow', character: 'archer', ready: false, team: Team.A }],
        you: 0,
        win: DEFAULT_WIN_CONDITION,
      },
      {
        type: 'MATCH_START',
        seed: 0xdeadbeef,
        mode: 'coop',
        mapKind: 'castle',
        starts: [{ id: 0, character: 'archer', team: Team.A, x: 64, y: 64 }],
        win: DEFAULT_WIN_CONDITION,
      },
      { type: 'MATCH_END', result: { outcome: 'COOP_CLEARED', wave: 12 } },
      { type: 'MATCH_END', result: { outcome: 'DEATHMATCH', winner: Team.B, scoreA: 8, scoreB: 15 } },
      { type: 'PONG', sent: 1000, serverTime: 1042 },
      { type: 'ERROR', code: 'ROOM_FULL', message: 'That room has four players.' },
    ];
    for (const m of msgs) expect(parseServerMessage(m)).toEqual(m);
  });

  it('rejects a WELCOME on the wrong version', () => {
    expect(parseServerMessage({ ...welcome, v: PROTOCOL_VERSION + 1 })).toBeNull();
  });

  it('rejects an unknown type', () => {
    expect(parseServerMessage({ type: 'KICK' })).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseServerMessage(null)).toBeNull();
    expect(parseServerMessage(undefined)).toBeNull();
    expect(parseServerMessage(1.5)).toBeNull();
    expect(parseServerMessage([])).toBeNull();
    expect(parseServerMessage({})).toBeNull();
    expect(parseServerMessage({ id: 0 })).toBeNull();
  });

  it('rejects a player id outside the room', () => {
    const room = {
      type: 'ROOM_STATE',
      code: 'QRTZ',
      mode: 'coop',
      host: 0,
      slots: [{ id: 0, name: 'crow', character: 'archer', ready: false, team: Team.A }],
      you: 0,
    };
    expect(parseServerMessage({ ...room, host: 4 })).toBeNull();
    expect(parseServerMessage({ ...room, host: -1 })).toBeNull();
    expect(parseServerMessage({ ...room, you: 4 })).toBeNull();
    expect(parseServerMessage({ ...room, you: -1 })).toBeNull();
  });

  it('rejects a slot on the enemy team', () => {
    const msg = {
      type: 'ROOM_STATE',
      code: 'QRTZ',
      mode: 'coop',
      host: 0,
      slots: [{ id: 0, name: 'crow', character: 'archer', ready: false, team: Team.ENEMY }],
      you: 0,
    };
    expect(parseServerMessage(msg)).toBeNull();
  });

  it('rejects a seed outside uint32', () => {
    const base = { type: 'MATCH_START', mode: 'coop', starts: [] };
    expect(parseServerMessage({ ...base, seed: -1 })).toBeNull();
    expect(parseServerMessage({ ...base, seed: 2 ** 32 })).toBeNull();
    expect(parseServerMessage({ ...base, seed: 1.5 })).toBeNull();
  });

  it('rejects a SNAPSHOT with a malformed entity', () => {
    expect(parseServerMessage({ type: 'SNAPSHOT', snap: { tick: 1, entities: [], acks: [], scores: { a: 0, b: 0 } } })).not.toBeNull();
    expect(
      parseServerMessage({
        type: 'SNAPSHOT',
        snap: { tick: 1, entities: [{ id: 0, kind: 99, x: 0, y: 0, hp: 1, state: 0 }], acks: [], scores: { a: 0, b: 0 } },
      }),
    ).toBeNull();
    expect(
      parseServerMessage({
        type: 'SNAPSHOT',
        snap: { tick: 1, entities: [{ id: 0, kind: EntityKind.CROW, x: 0, y: 0 }], acks: [], scores: { a: 0, b: 0 } },
      }),
    ).toBeNull();
    expect(parseServerMessage({ type: 'SNAPSHOT', snap: { tick: 1, entities: [] } })).toBeNull();
  });
});

describe('JSON round trip', () => {
  it('preserves an INPUT message', () => {
    expect(parseClientMessage(overWire(input))).toEqual(input);
  });

  it('preserves a SNAPSHOT message', () => {
    expect(parseServerMessage(overWire(snapshot))).toEqual(snapshot);
  });

  it('preserves the button bits and the aim angle', () => {
    const parsed = parseClientMessage(overWire(input));
    expect(parsed?.type).toBe('INPUT');
    if (parsed?.type !== 'INPUT') throw new Error('expected an INPUT message');
    expect(parsed.cmd.buttons & Button.UP).toBe(Button.UP);
    expect(parsed.cmd.buttons & Button.FIRE).toBe(Button.FIRE);
    expect(parsed.cmd.buttons & Button.SNIPE).toBe(0);
    expect(parsed.cmd.aimAngle).toBe(1.25);
    expect(parsed.cmd.seq).toBe(42);
  });
});
