import { beforeEach, describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import {
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
        mode: 'coop',
        host: 0,
        you: 0,
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
