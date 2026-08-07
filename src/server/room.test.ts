import { beforeEach, describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import { MAX_PLAYERS, type RoomCode } from '../net/protocol';
import { Readiness, RoomStore, type RoomView } from './room';

/** Hands out codes from a fixed list, so collisions and exhaustion are testable. */
function codesFrom(...codes: RoomCode[]): () => RoomCode {
  let i = 0;
  return () => codes[Math.min(i++, codes.length - 1)]!;
}

/** Unwraps a result the test expects to have succeeded. */
function ok(r: ReturnType<RoomStore['create']>): RoomView {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

describe('RoomStore', () => {
  let store: RoomStore;

  beforeEach(() => {
    store = new RoomStore({ newCode: codesFrom('AAAA', 'BBBB', 'CCCC') });
  });

  describe('create', () => {
    it('seats the creator in slot 0 as host, in a coop lobby', () => {
      const view = ok(store.create(10, 'alex'));
      expect(view.code).toBe('AAAA');
      expect(view.host).toBe(0);
      expect(view.mode).toBe('coop');
      expect(view.slots).toHaveLength(1);
      expect(view.slots[0]).toEqual({
        id: 0, name: 'alex', character: 'archer', ready: false, team: Team.A,
      });
    });

    it('skips a code already in use', () => {
      // Same code twice, then a fresh one: the second room must not take 'AAAA'
      store = new RoomStore({ newCode: codesFrom('AAAA', 'AAAA', 'BBBB') });
      expect(ok(store.create(10, 'alex')).code).toBe('AAAA');
      expect(ok(store.create(11, 'sam')).code).toBe('BBBB');
    });

    it('reports SERVER_FULL when no free code turns up', () => {
      store = new RoomStore({ newCode: codesFrom('AAAA') });
      ok(store.create(10, 'alex'));
      const r = store.create(11, 'sam');
      expect(r).toEqual({ ok: false, error: 'SERVER_FULL' });
    });

    it('reports SERVER_FULL at the room cap', () => {
      store = new RoomStore({ newCode: codesFrom('AAAA', 'BBBB'), maxRooms: 1 });
      ok(store.create(10, 'alex'));
      expect(store.create(11, 'sam')).toEqual({ ok: false, error: 'SERVER_FULL' });
    });

    it('rejects a creator who is already seated', () => {
      ok(store.create(10, 'alex'));
      expect(store.create(10, 'alex')).toEqual({ ok: false, error: 'ALREADY_IN_ROOM' });
    });
  });

  describe('join', () => {
    beforeEach(() => { ok(store.create(10, 'alex')); });

    it('takes the lowest free slot', () => {
      const view = ok(store.join(11, 'AAAA', 'sam'));
      expect(view.slots.map((s) => s.id)).toEqual([0, 1]);
      expect(view.slots[1]!.name).toBe('sam');
      expect(view.host).toBe(0);
    });

    it('reports ROOM_NOT_FOUND for an unknown code', () => {
      expect(store.join(11, 'ZZZZ', 'sam')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    });

    it('reports ROOM_FULL once every slot is taken', () => {
      for (let i = 1; i < MAX_PLAYERS; i++) ok(store.join(10 + i, 'AAAA', `p${i}`));
      expect(store.join(99, 'AAAA', 'late')).toEqual({ ok: false, error: 'ROOM_FULL' });
    });

    it('reports ROOM_IN_MATCH once the match has begun', () => {
      store.beginMatch('AAAA');
      expect(store.join(11, 'AAAA', 'sam')).toEqual({ ok: false, error: 'ROOM_IN_MATCH' });
    });

    it('rejects a joiner who is already seated elsewhere', () => {
      expect(store.join(10, 'AAAA', 'alex')).toEqual({ ok: false, error: 'ALREADY_IN_ROOM' });
    });
  });

  describe('leave', () => {
    beforeEach(() => { ok(store.create(10, 'alex')); });

    it('says so when the connection holds no seat', () => {
      expect(store.leave(999)).toEqual({ kind: 'not-in-room' });
    });

    it('closes the room when the last player goes', () => {
      expect(store.leave(10)).toEqual({ kind: 'closed', code: 'AAAA' });
      expect(store.roomCount).toBe(0);
      expect(store.join(11, 'AAAA', 'sam')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    });

    it('passes the host to the lowest remaining slot', () => {
      ok(store.join(11, 'AAAA', 'sam'));
      ok(store.join(12, 'AAAA', 'kim'));
      const out = store.leave(10);
      expect(out.kind).toBe('updated');
      if (out.kind !== 'updated') return;
      expect(out.view.host).toBe(1);
      expect(out.view.slots.map((s) => s.id)).toEqual([1, 2]);
    });

    it('frees the slot for the next joiner', () => {
      ok(store.join(11, 'AAAA', 'sam'));
      store.leave(10);
      expect(ok(store.join(12, 'AAAA', 'kim')).slots.map((s) => s.id)).toEqual([0, 1]);
    });

    it('lets a departed connection join again', () => {
      store.leave(10);
      ok(store.create(10, 'alex'));
      expect(store.roomCount).toBe(1);
    });
  });

  describe('seat changes', () => {
    beforeEach(() => {
      ok(store.create(10, 'alex'));
      ok(store.join(11, 'AAAA', 'sam'));
    });

    it('sets a character', () => {
      const view = ok(store.setCharacter(11, 'wizard'));
      expect(view.slots[1]!.character).toBe('wizard');
    });

    it('sets readiness both ways', () => {
      expect(ok(store.setReady(11, Readiness.READY)).slots[1]!.ready).toBe(true);
      expect(ok(store.setReady(11, Readiness.NOT_READY)).slots[1]!.ready).toBe(false);
    });

    it('reports NOT_IN_ROOM for a stranger', () => {
      expect(store.setCharacter(999, 'wizard')).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
      expect(store.setReady(999, Readiness.READY)).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
      expect(store.setMode(999, 'deathmatch')).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
    });
  });

  describe('mode and teams', () => {
    beforeEach(() => {
      ok(store.create(10, 'alex'));
      for (let i = 1; i < MAX_PLAYERS; i++) ok(store.join(10 + i, 'AAAA', `p${i}`));
    });

    it('puts everyone on team A in coop', () => {
      expect(ok(store.viewOf('AAAA')).slots.map((s) => s.team))
        .toEqual([Team.A, Team.A, Team.A, Team.A]);
    });

    it('splits alternating slots into two teams for deathmatch', () => {
      expect(ok(store.setMode(10, 'deathmatch')).slots.map((s) => s.team))
        .toEqual([Team.A, Team.B, Team.A, Team.B]);
    });

    it('returns everyone to team A when the mode goes back to coop', () => {
      ok(store.setMode(10, 'deathmatch'));
      expect(ok(store.setMode(10, 'coop')).slots.map((s) => s.team))
        .toEqual([Team.A, Team.A, Team.A, Team.A]);
    });

    it('teams a late joiner by the mode in force', () => {
      ok(store.setMode(10, 'deathmatch'));
      store.leave(11);                       // frees slot 1, a team B seat
      expect(ok(store.join(21, 'AAAA', 'new')).slots[1]!.team).toBe(Team.B);
    });

    it('lets only the host set the mode', () => {
      expect(store.setMode(11, 'deathmatch')).toEqual({ ok: false, error: 'NOT_HOST' });
    });

    it('lets the new host set the mode after the old one leaves', () => {
      store.leave(10);
      expect(ok(store.setMode(11, 'deathmatch')).mode).toBe('deathmatch');
    });
  });

  describe('readiness gate', () => {
    beforeEach(() => {
      ok(store.create(10, 'alex'));
      ok(store.join(11, 'AAAA', 'sam'));
    });

    it('is not satisfied until every seat is ready', () => {
      expect(store.allReady('AAAA')).toBe(false);
      ok(store.setReady(10, Readiness.READY));
      expect(store.allReady('AAAA')).toBe(false);
      ok(store.setReady(11, Readiness.READY));
      expect(store.allReady('AAAA')).toBe(true);
    });

    it('is not satisfied by an empty or unknown room', () => {
      expect(store.allReady('ZZZZ')).toBe(false);
    });

    it('drops readiness when a player changes character', () => {
      ok(store.setReady(10, Readiness.READY));
      ok(store.setReady(11, Readiness.READY));
      ok(store.setCharacter(11, 'knight'));
      expect(store.allReady('AAAA')).toBe(false);
    });
  });

  describe('membership', () => {
    it('pairs each connection with the slot it holds', () => {
      ok(store.create(10, 'alex'));
      ok(store.join(11, 'AAAA', 'sam'));
      expect(store.seatsOf('AAAA')).toEqual([
        { conn: 10, slot: 0 },
        { conn: 11, slot: 1 },
      ]);
      expect(store.seatsOf('ZZZZ')).toEqual([]);
    });

    it('keeps slots with connections after a seat is vacated', () => {
      ok(store.create(10, 'alex'));
      ok(store.join(11, 'AAAA', 'sam'));
      ok(store.join(12, 'AAAA', 'kim'));
      store.leave(11);
      expect(store.seatsOf('AAAA')).toEqual([
        { conn: 10, slot: 0 },
        { conn: 12, slot: 2 },
      ]);
    });

    it('finds the room a connection sits in', () => {
      ok(store.create(10, 'alex'));
      expect(store.viewFor(10)?.code).toBe('AAAA');
      expect(store.viewFor(999)).toBeNull();
    });
  });
});
