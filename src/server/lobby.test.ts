import { beforeEach, describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import {
  DEFAULT_WIN_CONDITION,
  PROTOCOL_VERSION,
  type ClientMessage,
  type RoomCode,
  type ServerMessage,
} from '../net/protocol';
import { Lobby, type Outbound } from './lobby';
import { RoomStore } from './room';

function codesFrom(...codes: RoomCode[]): () => RoomCode {
  let i = 0;
  return () => codes[Math.min(i++, codes.length - 1)]!;
}

/** Messages sent to one connection, in order. */
const to = (out: Outbound[], conn: number): ServerMessage[] =>
  out.filter((o) => o.to === conn).map((o) => o.message);

/** The single message expected for one connection. */
const only = (out: Outbound[], conn: number): ServerMessage => {
  const msgs = to(out, conn);
  expect(msgs).toHaveLength(1);
  return msgs[0]!;
};

const hello = (name: string): ClientMessage => ({ type: 'HELLO', v: PROTOCOL_VERSION, name });

describe('Lobby', () => {
  let lobby: Lobby;

  /** Greets a connection and asserts it was welcomed. */
  const greet = (conn: number, name: string) => {
    expect(only(lobby.receive(conn, hello(name)), conn))
      .toEqual({ type: 'WELCOME', v: PROTOCOL_VERSION });
  };

  beforeEach(() => {
    lobby = new Lobby({
      rooms: new RoomStore({ newCode: codesFrom('AAAA', 'BBBB') }),
      now: () => 1234,
      newSeed: () => 0xdeadbeef,
    });
  });

  describe('handshake', () => {
    it('welcomes a client on the current version', () => {
      greet(1, 'alex');
    });

    it('answers VERSION_MISMATCH rather than dropping an old client', () => {
      const out = lobby.receive(1, { type: 'HELLO', v: PROTOCOL_VERSION - 1, name: 'alex' });
      expect(only(out, 1)).toMatchObject({ type: 'ERROR', code: 'VERSION_MISMATCH' });
    });

    it('refuses lobby traffic before the handshake', () => {
      expect(only(lobby.receive(1, { type: 'CREATE_ROOM' }), 1))
        .toMatchObject({ type: 'ERROR', code: 'BAD_MESSAGE' });
    });

    it('refuses a second handshake', () => {
      greet(1, 'alex');
      expect(only(lobby.receive(1, hello('alex')), 1))
        .toMatchObject({ type: 'ERROR', code: 'BAD_MESSAGE' });
    });

    it('answers BAD_MESSAGE on anything unparseable', () => {
      for (const junk of [null, 42, [], {}, { type: 'KICK' }, { type: 'HELLO' }]) {
        expect(only(lobby.receive(1, junk), 1))
          .toMatchObject({ type: 'ERROR', code: 'BAD_MESSAGE' });
      }
    });
  });

  describe('rooms', () => {
    beforeEach(() => { greet(1, 'alex'); greet(2, 'sam'); });

    it('tells the creator its own slot', () => {
      const msg = only(lobby.receive(1, { type: 'CREATE_ROOM' }), 1);
      expect(msg).toEqual({
        type: 'ROOM_STATE',
        code: 'AAAA',
        mode: 'deathmatch',
        host: 0,
        you: 0,
        win: DEFAULT_WIN_CONDITION,
        slots: [{ id: 0, name: 'alex', character: 'archer', ready: false, team: Team.A }],
      });
    });

    it('tells every member on a join, each with its own slot', () => {
      lobby.receive(1, { type: 'CREATE_ROOM' });
      const out = lobby.receive(2, { type: 'JOIN_ROOM', code: 'AAAA' });

      const host = only(out, 1);
      const joiner = only(out, 2);
      expect(host).toMatchObject({ type: 'ROOM_STATE', you: 0, host: 0 });
      expect(joiner).toMatchObject({ type: 'ROOM_STATE', you: 1, host: 0 });
      // Same room, two views: only `you` differs
      expect({ ...host, you: null }).toEqual({ ...joiner, you: null });
    });

    it('passes a room error straight back to the sender alone', () => {
      const out = lobby.receive(1, { type: 'JOIN_ROOM', code: 'ZZZZ' });
      expect(only(out, 1)).toMatchObject({ type: 'ERROR', code: 'ROOM_NOT_FOUND' });
      expect(to(out, 2)).toEqual([]);
    });

    it('tells the remaining members when someone leaves', () => {
      lobby.receive(1, { type: 'CREATE_ROOM' });
      lobby.receive(2, { type: 'JOIN_ROOM', code: 'AAAA' });
      const out = lobby.receive(2, { type: 'LEAVE_ROOM' });
      expect(only(out, 1)).toMatchObject({ type: 'ROOM_STATE', you: 0, slots: [{ id: 0 }] });
      expect(to(out, 2)).toEqual([]);            // the leaver needs no room state
    });

    it('says nothing when the last member leaves', () => {
      lobby.receive(1, { type: 'CREATE_ROOM' });
      expect(lobby.receive(1, { type: 'LEAVE_ROOM' })).toEqual([]);
    });

    it('answers NOT_IN_ROOM when leaving without a seat', () => {
      expect(only(lobby.receive(1, { type: 'LEAVE_ROOM' }), 1))
        .toMatchObject({ type: 'ERROR', code: 'NOT_IN_ROOM' });
    });
  });

  describe('seat and mode changes', () => {
    beforeEach(() => {
      greet(1, 'alex'); greet(2, 'sam');
      lobby.receive(1, { type: 'CREATE_ROOM' });
      lobby.receive(2, { type: 'JOIN_ROOM', code: 'AAAA' });
    });

    it('shows a character pick to everyone', () => {
      const out = lobby.receive(2, { type: 'SET_CHARACTER', character: 'knight' });
      for (const conn of [1, 2]) {
        expect(only(out, conn)).toMatchObject({
          slots: [{ id: 0, character: 'archer' }, { id: 1, character: 'knight' }],
        });
      }
    });

    it('shows readiness to everyone', () => {
      const out = lobby.receive(2, { type: 'SET_READY', ready: true });
      expect(only(out, 1)).toMatchObject({ slots: [{ id: 0, ready: false }, { id: 1, ready: true }] });
    });

    it('lets the host switch to deathmatch and re-teams both seats', () => {
      const out = lobby.receive(1, { type: 'SET_MODE', mode: 'deathmatch' });
      expect(only(out, 1)).toMatchObject({
        mode: 'deathmatch',
        slots: [{ id: 0, team: Team.A }, { id: 1, team: Team.B }],
      });
      expect(to(out, 2)).toHaveLength(1);
    });

    it('refuses a mode change from a non-host, telling only them', () => {
      const out = lobby.receive(2, { type: 'SET_MODE', mode: 'deathmatch' });
      expect(only(out, 2)).toMatchObject({ type: 'ERROR', code: 'NOT_HOST' });
      expect(to(out, 1)).toEqual([]);
    });
  });

  describe('match start', () => {
    beforeEach(() => {
      greet(1, 'alex'); greet(2, 'sam');
      lobby.receive(1, { type: 'CREATE_ROOM' });
      lobby.receive(2, { type: 'JOIN_ROOM', code: 'AAAA' });
    });

    it('stays quiet while one seat is still not ready', () => {
      const out = lobby.receive(1, { type: 'SET_READY', ready: true });
      expect(out.map((o) => o.message.type)).toEqual(['ROOM_STATE', 'ROOM_STATE']);
    });

    it('starts the match once the last seat readies', () => {
      lobby.receive(1, { type: 'SET_READY', ready: true });
      const out = lobby.receive(2, { type: 'SET_READY', ready: true });

      for (const conn of [1, 2]) {
        const types = to(out, conn).map((m) => m.type);
        expect(types).toEqual(['ROOM_STATE', 'MATCH_START']);
      }
    });

    it('gives every seat the same seed, mode, and spawn list', () => {
      lobby.receive(1, { type: 'SET_READY', ready: true });
      const out = lobby.receive(2, { type: 'SET_READY', ready: true });

      const starts = out
        .map((o) => o.message)
        .filter((m) => m.type === 'MATCH_START');
      expect(starts).toHaveLength(2);
      expect(starts[0]).toEqual(starts[1]);          // one message, two recipients
      expect(starts[0]).toMatchObject({ seed: 0xdeadbeef, mode: 'deathmatch',
        starts: [
          { id: 0, character: 'archer', team: Team.A },
          { id: 1, character: 'archer', team: Team.B },
        ],
      });
    });

    it('spawns the two seats apart', () => {
      lobby.receive(1, { type: 'SET_READY', ready: true });
      const out = lobby.receive(2, { type: 'SET_READY', ready: true });
      const start = out.map((o) => o.message).find((m) => m.type === 'MATCH_START');

      const [a, b] = (start as Extract<ServerMessage, { type: 'MATCH_START' }>).starts;
      expect([a!.x, a!.y]).not.toEqual([b!.x, b!.y]);
    });

    it('carries the deathmatch teams into the spawn list', () => {
      lobby.receive(1, { type: 'SET_MODE', mode: 'deathmatch' });
      lobby.receive(1, { type: 'SET_READY', ready: true });
      const out = lobby.receive(2, { type: 'SET_READY', ready: true });
      const start = out.map((o) => o.message).find((m) => m.type === 'MATCH_START');

      expect(start).toMatchObject({
        mode: 'deathmatch',
        starts: [{ id: 0, team: Team.A }, { id: 1, team: Team.B }],
      });
    });

    it('turns a late joiner away once the match is running', () => {
      lobby.receive(1, { type: 'SET_READY', ready: true });
      lobby.receive(2, { type: 'SET_READY', ready: true });

      greet(3, 'kim');
      expect(only(lobby.receive(3, { type: 'JOIN_ROOM', code: 'AAAA' }), 3))
        .toMatchObject({ type: 'ERROR', code: 'ROOM_IN_MATCH' });
    });

    it('does not start on a solo unready seat readying then unreadying', () => {
      lobby.receive(1, { type: 'SET_READY', ready: true });
      const out = lobby.receive(1, { type: 'SET_READY', ready: false });
      expect(out.every((o) => o.message.type === 'ROOM_STATE')).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('frees the seat and tells the rest', () => {
      greet(1, 'alex'); greet(2, 'sam');
      lobby.receive(1, { type: 'CREATE_ROOM' });
      lobby.receive(2, { type: 'JOIN_ROOM', code: 'AAAA' });

      const out = lobby.close(2);
      expect(only(out, 1)).toMatchObject({ type: 'ROOM_STATE', slots: [{ id: 0 }] });
      expect(to(out, 2)).toEqual([]);
    });

    it('hands the host to the next seat', () => {
      greet(1, 'alex'); greet(2, 'sam');
      lobby.receive(1, { type: 'CREATE_ROOM' });
      lobby.receive(2, { type: 'JOIN_ROOM', code: 'AAAA' });

      expect(only(lobby.close(1), 2)).toMatchObject({ host: 1, you: 1 });
    });

    it('is quiet for a connection that held no seat', () => {
      greet(1, 'alex');
      expect(lobby.close(1)).toEqual([]);
    });

    it('lets the same id connect again afterwards', () => {
      greet(1, 'alex');
      lobby.receive(1, { type: 'CREATE_ROOM' });
      lobby.close(1);
      greet(1, 'alex');
      expect(only(lobby.receive(1, { type: 'CREATE_ROOM' }), 1))
        .toMatchObject({ type: 'ROOM_STATE' });
    });
  });

  describe('ping', () => {
    it('echoes the client clock and adds the server one', () => {
      greet(1, 'alex');
      expect(only(lobby.receive(1, { type: 'PING', sent: 999 }), 1))
        .toEqual({ type: 'PONG', sent: 999, serverTime: 1234 });
    });
  });

  describe('input', () => {
    it('is ignored while the room is still a lobby', () => {
      greet(1, 'alex');
      lobby.receive(1, { type: 'CREATE_ROOM' });
      const cmd = { seq: 1, buttons: 0, aimAngle: 0 };
      expect(lobby.receive(1, { type: 'INPUT', cmd })).toEqual([]);
    });
  });
});
