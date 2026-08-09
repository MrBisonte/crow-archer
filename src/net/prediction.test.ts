import { beforeEach, describe, expect, it } from 'vitest';

import { Team } from '../sim/team';
import { Button } from '../sim/input';
import { PLAYER_SPEED } from '../sim/arena';
import { MovementWorld } from '../sim/movement-world';
import type { EntitySnapshot, PlayerStart, Snapshot } from './protocol';
import { Predictor } from './prediction';

const DT = 1 / 60;

const starts: PlayerStart[] = [
  { id: 0, character: 'archer', team: Team.A, x: 200, y: 200 },
  { id: 1, character: 'wizard', team: Team.B, x: 400, y: 300 },
];

/** A server snapshot placing our body somewhere, acking up to `ack`. */
function serverSays(x: number, y: number, ack: number, tick = 1): Snapshot {
  const entities: EntitySnapshot[] = [
    { id: 0, kind: 0, x, y, hp: 10, state: 0 },
    { id: 1, kind: 0, x: 400, y: 300, hp: 10, state: 0 },
  ];
  return { tick, entities, acks: [{ id: 0, seq: ack }, { id: 1, seq: 0 }] };
}

describe('Predictor', () => {
  let predictor: Predictor;

  beforeEach(() => {
    predictor = new Predictor({
      world: new MovementWorld(starts),
      self: 0,
      dt: DT,
    });
  });

  const me = () => predictor.self();

  it('starts where the match start put us', () => {
    expect(me()).toMatchObject({ x: 200, y: 200 });
  });

  describe('moving ahead of the server', () => {
    it('moves immediately, without waiting for a round trip', () => {
      predictor.predict({ seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      expect(me()!.x).toBeGreaterThan(200);
    });

    it('keeps moving further the longer it goes unacknowledged', () => {
      predictor.predict({ seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      const first = me()!.x;
      predictor.predict({ seq: 2, buttons: Button.RIGHT, aimAngle: 0 });
      expect(me()!.x).toBeGreaterThan(first);
    });
  });

  describe('reconciling', () => {
    it('keeps the prediction when the server agrees', () => {
      predictor.predict({ seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      const predicted = me()!.x;

      // Server applied the same input and reached the same place
      predictor.reconcile(serverSays(predicted, 200, 1));
      expect(me()!.x).toBe(predicted);
    });

    it('replays inputs the server has not seen yet', () => {
      // Three inputs sent; the server has only acknowledged the first
      predictor.predict({ seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      predictor.predict({ seq: 2, buttons: Button.RIGHT, aimAngle: 0 });
      predictor.predict({ seq: 3, buttons: Button.RIGHT, aimAngle: 0 });

      const afterOneStep = 200 + PLAYER_SPEED * DT;
      predictor.reconcile(serverSays(Math.round(afterOneStep), 200, 1));

      // Two unacknowledged inputs are replayed on top of the server position
      expect(me()!.x).toBeCloseTo(afterOneStep + 2 * PLAYER_SPEED * DT, 0);
    });

    it('snaps to the server when it disagrees, because it is authoritative', () => {
      predictor.predict({ seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      predictor.reconcile(serverSays(50, 50, 1));      // server says: no, over here
      expect(me()).toMatchObject({ x: 50, y: 50 });
    });

    it('drops acknowledged inputs so they are not replayed twice', () => {
      predictor.predict({ seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      predictor.reconcile(serverSays(210, 200, 1));
      expect(predictor.pending()).toBe(0);

      // A second snapshot with no new input must not move us again
      predictor.reconcile(serverSays(210, 200, 1, 2));
      expect(me()).toMatchObject({ x: 210, y: 200 });
    });

    it('ignores a snapshot older than one already applied', () => {
      predictor.reconcile(serverSays(300, 300, 0, 5));
      predictor.reconcile(serverSays(50, 50, 0, 4));    // arrived late
      expect(me()).toMatchObject({ x: 300, y: 300 });
    });

    it('ignores a snapshot with no entry for us', () => {
      predictor.predict({ seq: 1, buttons: Button.RIGHT, aimAngle: 0 });
      const predicted = me()!.x;
      predictor.reconcile({
        tick: 9,
        entities: [{ id: 1, kind: 0, x: 400, y: 300, hp: 10, state: 0 }],
        acks: [{ id: 1, seq: 0 }],
      });
      expect(me()!.x).toBe(predicted);
    });
  });

  describe('agreement with the server', () => {
    it('lands where the server lands, given the same inputs', () => {
      const server = new MovementWorld(starts);
      const script = [Button.RIGHT, Button.RIGHT, Button.DOWN, Button.DOWN | Button.LEFT];

      script.forEach((buttons, i) => {
        const cmd = { seq: i + 1, buttons, aimAngle: 0 };
        predictor.predict(cmd);
        server.step(DT, new Map([[0, cmd]]));
      });

      const truth = server.snapshot().find((e) => e.id === 0)!;
      expect(me()).toMatchObject({ x: truth.x, y: truth.y });
    });
  });
});
