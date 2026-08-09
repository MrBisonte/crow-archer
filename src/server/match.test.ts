import { beforeEach, describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import { Button } from '../sim/input';
import { MovementWorld } from '../sim/movement-world';
import type { PlayerStart, RoomView } from '../net/protocol';
import { GRACE_TICKS, Match, TICKS_PER_SNAPSHOT } from './match';

const room: RoomView = {
  code: 'AAAA',
  mode: 'coop',
  host: 0,
  slots: [
    { id: 0, name: 'alex', character: 'archer', ready: true, team: Team.A },
    { id: 1, name: 'sam', character: 'wizard', ready: true, team: Team.A },
  ],
};

const starts: PlayerStart[] = [
  { id: 0, character: 'archer', team: Team.A, x: 200, y: 200 },
  { id: 1, character: 'wizard', team: Team.A, x: 400, y: 300 },
];

const newMatch = () => new Match(room, new MovementWorld(starts));

/** Steps until a snapshot comes back, failing rather than looping forever. */
function stepToSnapshot(match: Match) {
  for (let i = 0; i < TICKS_PER_SNAPSHOT; i++) {
    const snap = match.step();
    if (snap) return snap;
  }
  throw new Error(`no snapshot within ${TICKS_PER_SNAPSHOT} ticks`);
}

describe('Match', () => {
  let match: Match;

  beforeEach(() => { match = newMatch(); });

  describe('ticking', () => {
    it('starts at tick zero', () => {
      expect(match.tick).toBe(0);
    });

    it('snapshots on every third tick and stays quiet in between', () => {
      expect(match.step()).toBeNull();
      expect(match.step()).toBeNull();
      expect(match.step()).toMatchObject({ tick: 3 });
      expect(match.step()).toBeNull();
      expect(match.step()).toBeNull();
      expect(match.step()).toMatchObject({ tick: 6 });
    });

    it('counts every tick, not only the broadcast ones', () => {
      for (let i = 0; i < 10; i++) match.step();
      expect(match.tick).toBe(10);
    });
  });

  describe('the world reaches the wire', () => {
    it('puts the world entities in the snapshot', () => {
      expect(stepToSnapshot(match).entities).toEqual([
        { id: 0, kind: 0, x: 200, y: 200, hp: 10, state: 0 },
        { id: 1, kind: 0, x: 400, y: 300, hp: 10, state: 0 },
      ]);
    });

    it('moves a player the input asked to move', () => {
      match.recordInput(0, { seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      const snap = stepToSnapshot(match);
      expect(snap.entities[0]!.x).toBeGreaterThan(200);
      expect(snap.entities[1]!.x).toBe(400);          // the other seat sat still
    });

    it('keeps moving on a held command without a packet per tick', () => {
      match.recordInput(0, { seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      const first = stepToSnapshot(match).entities[0]!.x;
      const second = stepToSnapshot(match).entities[0]!.x;
      expect(second).toBeGreaterThan(first);
    });

    it('stops when a command with no buttons arrives', () => {
      match.recordInput(0, { seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      stepToSnapshot(match);
      match.recordInput(0, { seq: 2, buttons: 0, aimAngle: 0 });
      const stopped = stepToSnapshot(match).entities[0]!.x;
      expect(stepToSnapshot(match).entities[0]!.x).toBe(stopped);
    });
  });

  describe('players leaving', () => {
    it('is not finished while anyone is still connected', () => {
      match.dropSeat(0);
      expect(match.isFinished()).toBe(false);
    });

    it('is finished once the last seat drops, so the tick loop can stop', () => {
      match.dropSeat(0);
      match.dropSeat(1);
      expect(match.isFinished()).toBe(true);
    });

    it('ignores a seat dropping twice', () => {
      match.dropSeat(0);
      match.dropSeat(0);
      expect(match.isFinished()).toBe(false);   // seat 1 is still playing
    });

    it('stops replaying a held input from a seat that dropped', () => {
      match.recordInput(0, { seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      const moving = stepToSnapshot(match).entities[0]!.x;
      match.dropSeat(0);
      const afterDrop = stepToSnapshot(match).entities[0]!.x;
      expect(afterDrop).toBe(moving);           // body stands still, not sliding
    });

    it('leaves the body standing during the grace window', () => {
      match.dropSeat(0);
      for (let i = 0; i < GRACE_TICKS - 1; i++) match.step();
      expect(match.entities().some((e) => e.id === 0)).toBe(true);
    });

    it('removes the body once the grace window passes', () => {
      match.dropSeat(0);
      for (let i = 0; i <= GRACE_TICKS; i++) match.step();
      expect(match.entities().some((e) => e.id === 0)).toBe(false);
      expect(match.entities().some((e) => e.id === 1)).toBe(true);
    });
  });

  describe('inputs', () => {
    it('acks zero for a seat that has sent nothing', () => {
      expect(stepToSnapshot(match).acks).toEqual([
        { id: 0, seq: 0 },
        { id: 1, seq: 0 },
      ]);
    });

    it('acks the newest sequence per seat', () => {
      match.recordInput(0, { seq: 4, buttons: 0, aimAngle: 0 });
      match.recordInput(1, { seq: 9, buttons: 0, aimAngle: 0 });
      expect(stepToSnapshot(match).acks).toEqual([
        { id: 0, seq: 4 },
        { id: 1, seq: 9 },
      ]);
    });

    it('accepts a newer sequence', () => {
      expect(match.recordInput(0, { seq: 1, buttons: 0, aimAngle: 0 })).toBe(true);
      expect(match.recordInput(0, { seq: 2, buttons: 0, aimAngle: 0 })).toBe(true);
    });

    it('refuses a repeat, which is what a retransmit looks like', () => {
      match.recordInput(0, { seq: 5, buttons: 0, aimAngle: 0 });
      expect(match.recordInput(0, { seq: 5, buttons: 0, aimAngle: 0 })).toBe(false);
    });

    it('refuses an out-of-order arrival rather than rewinding the ack', () => {
      match.recordInput(0, { seq: 5, buttons: 0, aimAngle: 0 });
      expect(match.recordInput(0, { seq: 3, buttons: 0, aimAngle: 0 })).toBe(false);
      expect(stepToSnapshot(match).acks[0]).toEqual({ id: 0, seq: 5 });
    });

    it('keeps a late input on one seat from touching the other ack', () => {
      match.recordInput(0, { seq: 5, buttons: 0, aimAngle: 0 });
      match.recordInput(1, { seq: 2, buttons: 0, aimAngle: 0 });
      expect(stepToSnapshot(match).acks).toEqual([
        { id: 0, seq: 5 },
        { id: 1, seq: 2 },
      ]);
    });
  });
});
