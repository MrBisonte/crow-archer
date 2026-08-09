import { beforeEach, describe, expect, it } from 'vitest';

import { EntityKind, type PlayerStart } from '../net/protocol';
import { Button, type InputCommand } from './input';
import { Team } from './team';
import { ARENA_H, ARENA_W, PLAYER_RADIUS, PLAYER_SPEED } from './arena';
import { MovementWorld } from './movement-world';
import type { StepInputs } from './world';

const DT = 1 / 60;

const starts: PlayerStart[] = [
  { id: 0, character: 'archer', team: Team.A, x: 200, y: 200 },
  { id: 1, character: 'wizard', team: Team.B, x: 400, y: 300 },
];

/** One command for one seat, the shape step() takes. */
const only = (id: number, buttons: number): StepInputs =>
  new Map<number, InputCommand>([[id, { seq: 1, buttons, aimAngle: 0 }]]);

describe('MovementWorld', () => {
  let world: MovementWorld;

  beforeEach(() => { world = new MovementWorld(starts); });

  /** The snapshot entry for one seat. */
  const at = (id: number) => world.snapshot().find((e) => e.id === id)!;

  describe('snapshot', () => {
    it('places each player where the match start said', () => {
      expect(at(0)).toMatchObject({ x: 200, y: 200, kind: EntityKind.PLAYER });
      expect(at(1)).toMatchObject({ x: 400, y: 300, kind: EntityKind.PLAYER });
    });

    it('has one entry per seat', () => {
      expect(world.snapshot()).toHaveLength(2);
    });

    it('reports whole pixels, since a float prints far wider on the wire', () => {
      world.step(DT, only(0, Button.RIGHT));
      const { x, y } = at(0);
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    });
  });

  describe('movement', () => {
    it('stands still with no input', () => {
      world.step(DT, new Map());
      expect(at(0)).toMatchObject({ x: 200, y: 200 });
    });

    it('moves up, which is negative y', () => {
      world.step(DT, only(0, Button.UP));
      expect(at(0).y).toBe(Math.round(200 - PLAYER_SPEED * DT));
      expect(at(0).x).toBe(200);
    });

    it('moves right', () => {
      world.step(DT, only(0, Button.RIGHT));
      expect(at(0).x).toBe(Math.round(200 + PLAYER_SPEED * DT));
    });

    it('cancels opposing buttons rather than drifting', () => {
      world.step(DT, only(0, Button.LEFT | Button.RIGHT));
      expect(at(0)).toMatchObject({ x: 200, y: 200 });
    });

    it('does not let a diagonal outrun a straight line', () => {
      const diagonal = new MovementWorld(starts);
      const straight = new MovementWorld(starts);
      for (let i = 0; i < 30; i++) {
        diagonal.step(DT, only(0, Button.RIGHT | Button.DOWN));
        straight.step(DT, only(0, Button.RIGHT));
      }
      const d = diagonal.snapshot()[0]!;
      const s = straight.snapshot()[0]!;
      const travelled = Math.hypot(d.x - 200, d.y - 200);
      expect(travelled).toBeCloseTo(s.x - 200, 0);
    });

    it('ignores an input for a seat that is not playing', () => {
      world.step(DT, only(99, Button.RIGHT));
      expect(at(0)).toMatchObject({ x: 200, y: 200 });
      expect(at(1)).toMatchObject({ x: 400, y: 300 });
    });

    it('moves only the seat that sent the input', () => {
      world.step(DT, only(1, Button.RIGHT));
      expect(at(0).x).toBe(200);
      expect(at(1).x).toBeGreaterThan(400);
    });

    it('moves both seats when both send input', () => {
      world.step(DT, new Map([
        [0, { seq: 1, buttons: Button.RIGHT, aimAngle: 0 }],
        [1, { seq: 1, buttons: Button.LEFT, aimAngle: 0 }],
      ]));
      expect(at(0).x).toBeGreaterThan(200);
      expect(at(1).x).toBeLessThan(400);
    });
  });

  describe('arena bounds', () => {
    /** Holds one direction long enough to reach any wall. */
    const shove = (w: MovementWorld, buttons: number) => {
      for (let i = 0; i < 60 * 20; i++) w.step(DT, only(0, buttons));
    };

    it('stops at the left and top walls', () => {
      shove(world, Button.LEFT | Button.UP);
      expect(at(0)).toMatchObject({ x: PLAYER_RADIUS, y: PLAYER_RADIUS });
    });

    it('stops at the right and bottom walls', () => {
      shove(world, Button.RIGHT | Button.DOWN);
      expect(at(0)).toMatchObject({
        x: ARENA_W - PLAYER_RADIUS,
        y: ARENA_H - PLAYER_RADIUS,
      });
    });
  });

  describe('determinism', () => {
    it('gives the same result for the same inputs, so clients can predict', () => {
      const a = new MovementWorld(starts);
      const b = new MovementWorld(starts);
      const script = [Button.RIGHT, Button.DOWN, Button.RIGHT | Button.UP, 0, Button.LEFT];
      for (const buttons of script) {
        for (let i = 0; i < 10; i++) {
          a.step(DT, only(0, buttons));
          b.step(DT, only(0, buttons));
        }
      }
      expect(a.snapshot()).toEqual(b.snapshot());
    });
  });
});
