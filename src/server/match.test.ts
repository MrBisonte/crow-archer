import { beforeEach, describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import type { RoomView } from '../net/protocol';
import { Match, TICKS_PER_SNAPSHOT } from './match';

const room: RoomView = {
  code: 'AAAA',
  mode: 'coop',
  host: 0,
  slots: [
    { id: 0, name: 'alex', character: 'archer', ready: true, team: Team.A },
    { id: 1, name: 'sam', character: 'wizard', ready: true, team: Team.A },
  ],
};

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

  beforeEach(() => { match = new Match(room); });

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
