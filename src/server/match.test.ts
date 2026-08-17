import { beforeEach, describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import { Button } from '../sim/input';
import { MovementWorld } from '../sim/movement-world';
import type { EntitySnapshot, PlayerStart, RoomView, WinCondition } from '../net/protocol';
import type { Kill, World } from '../sim/world';
import { GRACE_TICKS, Match, TICKS_PER_SNAPSHOT, TICK_HZ } from './match';
import { DEFAULT_WIN_CONDITION } from '../net/protocol';

const room: RoomView = {
  code: 'AAAA',
  mode: 'coop',
  mapKind: 'forest',
  host: 0,
  win: DEFAULT_WIN_CONDITION,
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

/**
 * A world that reports whatever kills a test queues, and does nothing else.
 *
 * The scoring rules are about what Match does with a kill, not about arrows, so
 * this keeps arrow speeds and hit radii out of tests that are not about them.
 */
class KillingWorld implements World {
  #pending: Kill[] = [];

  /** Queues a kill for the next step to report. */
  kill(k: Kill): void {
    this.#pending.push(k);
  }

  step(): readonly Kill[] {
    const out = this.#pending;
    this.#pending = [];
    return out;
  }

  snapshot(): EntitySnapshot[] {
    return [];
  }

  restore(): void {}

  remove(): void {}
}

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

    it('snapshots on the tick that is due and stays quiet in between', () => {
      // Derived from the constant rather than spelled out, so changing the
      // broadcast rate does not mean editing the test that describes it.
      const quiet = () => {
        for (let i = 1; i < TICKS_PER_SNAPSHOT; i++) expect(match.step()).toBeNull();
      };
      quiet();
      expect(match.step()).toMatchObject({ tick: TICKS_PER_SNAPSHOT });
      quiet();
      expect(match.step()).toMatchObject({ tick: TICKS_PER_SNAPSHOT * 2 });
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

  describe('scoring and ending', () => {
    /** A room playing to a given win condition, with two opposed seats. */
    const duel = (win: WinCondition): { match: Match; world: KillingWorld } => {
      const room2: RoomView = {
        ...room,
        mode: 'deathmatch',
        win,
        slots: [
          { id: 0, name: 'alex', character: 'archer', ready: true, team: Team.A },
          { id: 1, name: 'sam', character: 'wizard', ready: true, team: Team.B },
        ],
      };
      const world = new KillingWorld();
      return { match: new Match(room2, world), world };
    };

    it('starts level', () => {
      expect(duel({ kind: 'frags', target: 10 }).match.scores).toEqual({ a: 0, b: 0 });
    });

    it('credits a kill to the side that made it', () => {
      const { match, world } = duel({ kind: 'frags', target: 10 });
      world.kill({ victim: 1, killer: 0, killerTeam: Team.A });
      match.step();
      expect(match.scores).toEqual({ a: 1, b: 0 });
    });

    it('credits the other side too, so a scoreboard is not one-sided', () => {
      const { match, world } = duel({ kind: 'frags', target: 10 });
      world.kill({ victim: 0, killer: 1, killerTeam: Team.B });
      match.step();
      expect(match.scores).toEqual({ a: 0, b: 1 });
    });

    it('puts the score on the snapshot, so a client cannot drift from it', () => {
      const { match, world } = duel({ kind: 'frags', target: 10 });
      world.kill({ victim: 1, killer: 0, killerTeam: Team.A });
      expect(stepToSnapshot(match).scores).toEqual({ a: 1, b: 0 });
    });

    it('is not over before the target is reached', () => {
      const { match, world } = duel({ kind: 'frags', target: 10 });
      for (let i = 0; i < 9; i++) {
        world.kill({ victim: 1, killer: 0, killerTeam: Team.A });
        match.step();
      }
      expect(match.result).toBeNull();
      expect(match.isFinished()).toBe(false);
    });

    it('ends when a side reaches the target, naming the winner', () => {
      const { match, world } = duel({ kind: 'frags', target: 10 });
      for (let i = 0; i < 10; i++) {
        world.kill({ victim: 1, killer: 0, killerTeam: Team.A });
        match.step();
      }
      expect(match.result).toEqual({ outcome: 'DEATHMATCH', winner: Team.A, scoreA: 10, scoreB: 0 });
      expect(match.isFinished()).toBe(true);
    });

    it('keeps the first result rather than judging again every tick', () => {
      const { match, world } = duel({ kind: 'frags', target: 10 });
      for (let i = 0; i < 10; i++) {
        world.kill({ victim: 1, killer: 0, killerTeam: Team.A });
        match.step();
      }
      const first = match.result;
      match.step();
      expect(match.result).toEqual(first);
    });

    describe('on a time limit', () => {
      const fiveMinutes: WinCondition = { kind: 'time', minutes: 5 };
      const ticks = 5 * 60 * TICK_HZ;

      it('runs to the last tick', () => {
        const { match } = duel(fiveMinutes);
        for (let i = 0; i < ticks - 1; i++) match.step();
        expect(match.result).toBeNull();
      });

      it('ends when the time is up', () => {
        const { match, world } = duel(fiveMinutes);
        world.kill({ victim: 1, killer: 0, killerTeam: Team.A });
        for (let i = 0; i < ticks; i++) match.step();
        expect(match.result).toMatchObject({ winner: Team.A, scoreA: 1, scoreB: 0 });
      });

      it('reports a draw as a draw, not as somebody winning', () => {
        const { match } = duel(fiveMinutes);
        for (let i = 0; i < ticks; i++) match.step();
        expect(match.result).toEqual({
          outcome: 'DEATHMATCH', winner: null, scoreA: 0, scoreB: 0,
        });
      });

      it('does not end early on frags, since that is the other condition', () => {
        const { match, world } = duel(fiveMinutes);
        for (let i = 0; i < 40; i++) {
          world.kill({ victim: 1, killer: 0, killerTeam: Team.A });
          match.step();
        }
        expect(match.result).toBeNull();
      });
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
