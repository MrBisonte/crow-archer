import { beforeEach, describe, expect, it } from 'vitest';

import { EntityKind, PlayerState, type PlayerStart } from '../net/protocol';
import { Team } from './team';
import { Button, type InputCommand } from './input';
import { ARENA_W, PLAYER_MAX_HP } from './arena';
import {
  ARROW_DAMAGE,
  ARROW_LIFETIME_TICKS,
  ARROW_SPEED,
  ArenaWorld,
  FIRE_COOLDOWN_TICKS,
  RESPAWN_TICKS,
} from './arena-world';

const DT = 1 / 60;

/** Two players facing each other, close enough that a shot lands quickly. */
const starts: PlayerStart[] = [
  { id: 0, character: 'archer', team: Team.A, x: 200, y: 200 },
  { id: 1, character: 'archer', team: Team.B, x: 260, y: 200 },
];

/** Same two, but on one side, which is what co-op looks like. */
const allies: PlayerStart[] = [
  { id: 0, character: 'archer', team: Team.A, x: 200, y: 200 },
  { id: 1, character: 'archer', team: Team.A, x: 260, y: 200 },
];

const cmd = (buttons: number, aimAngle = 0, seq = 1): InputCommand => ({ seq, buttons, aimAngle });

/** Aiming right, straight at seat 1. */
const FIRE_RIGHT = cmd(Button.FIRE, 0);

const arrows = (w: ArenaWorld) => w.snapshot().filter((e) => e.kind === EntityKind.PROJECTILE);
const player = (w: ArenaWorld, id: number) => w.snapshot().find((e) => e.id === id)!;

/** Steps n ticks with the same command held by one seat. */
function hold(w: ArenaWorld, n: number, id: number, c: InputCommand | null): void {
  const inputs = new Map(c ? [[id, c]] : []);
  for (let i = 0; i < n; i++) w.step(DT, inputs);
}

describe('ArenaWorld', () => {
  let world: ArenaWorld;

  beforeEach(() => { world = new ArenaWorld(starts); });

  describe('firing', () => {
    /**
     * A shooter with nobody to hit. The firing rules are about what leaves the
     * bow, and a target would quietly absorb the arrows being counted.
     */
    let shooter: ArenaWorld;
    beforeEach(() => { shooter = new ArenaWorld([starts[0]!]); });

    it('starts with nothing in the air', () => {
      expect(arrows(shooter)).toHaveLength(0);
    });

    it('puts an arrow in the air on the fire button', () => {
      hold(shooter, 1, 0, FIRE_RIGHT);
      expect(arrows(shooter)).toHaveLength(1);
    });

    it('spawns it clear of the shooter, not inside them', () => {
      hold(shooter, 1, 0, FIRE_RIGHT);
      expect(arrows(shooter)[0]!.x).toBeGreaterThan(200);
    });

    it('sends it where the aim points, not where the feet point', () => {
      hold(shooter, 3, 0, cmd(Button.FIRE, Math.PI / 2));
      const shot = arrows(shooter)[0]!;
      expect(shot.y).toBeGreaterThan(200);
      expect(shot.x).toBeCloseTo(200, 0);
    });

    it('holding the button fires once, not once a tick', () => {
      hold(shooter, FIRE_COOLDOWN_TICKS - 1, 0, FIRE_RIGHT);
      expect(arrows(shooter)).toHaveLength(1);
    });

    it('fires again once the cooldown has run out', () => {
      hold(shooter, FIRE_COOLDOWN_TICKS + 1, 0, FIRE_RIGHT);
      expect(arrows(shooter)).toHaveLength(2);
    });

    it('travels at the speed it says it does', () => {
      hold(shooter, 1, 0, cmd(Button.FIRE, Math.PI / 2));    // upward, clear run
      const first = arrows(shooter)[0]!.y;
      hold(shooter, 1, 0, null);
      // Snapshot positions are whole pixels, so a per-tick step is within one.
      expect(Math.abs(arrows(shooter)[0]!.y - first - ARROW_SPEED * DT)).toBeLessThanOrEqual(1);
    });
  });

  describe('hitting', () => {
    it('wounds an opponent it reaches', () => {
      hold(world, 10, 0, FIRE_RIGHT);
      expect(player(world, 1).hp).toBe(PLAYER_MAX_HP - ARROW_DAMAGE);
    });

    it('is spent on the body it hit', () => {
      hold(world, 10, 0, FIRE_RIGHT);
      expect(arrows(world)).toHaveLength(0);
    });

    it('passes through a teammate, since friendly fire is off in every mode', () => {
      const coop = new ArenaWorld(allies);
      hold(coop, 10, 0, FIRE_RIGHT);
      expect(player(coop, 1).hp).toBe(PLAYER_MAX_HP);
    });

    it('never hits the player who fired it', () => {
      hold(world, 10, 0, FIRE_RIGHT);
      expect(player(world, 0).hp).toBe(PLAYER_MAX_HP);
    });

    it('kills after enough hits, rather than going negative', () => {
      const shots = Math.ceil(PLAYER_MAX_HP / ARROW_DAMAGE);
      hold(world, shots * (FIRE_COOLDOWN_TICKS + 1), 0, FIRE_RIGHT);
      expect(player(world, 1).hp).toBe(0);
      expect(player(world, 1).state).toBe(PlayerState.DEAD);
    });
  });

  describe('culling', () => {
    it('drops an arrow that leaves the arena', () => {
      const edge: PlayerStart[] = [{ id: 0, character: 'archer', team: Team.A, x: ARENA_W - 200, y: 200 }];
      const w = new ArenaWorld(edge);
      hold(w, 1, 0, FIRE_RIGHT);
      expect(arrows(w)).toHaveLength(1);
      // 200 px at ARROW_SPEED is well under the lifetime, so the wall is what
      // stops it and not the timer.
      hold(w, 25, 0, null);
      expect(arrows(w)).toHaveLength(0);
      expect(25 * ARROW_SPEED * DT).toBeLessThan(ARROW_LIFETIME_TICKS * ARROW_SPEED * DT);
    });

    it('drops an arrow that has flown long enough, so the air cannot fill up', () => {
      const lone = new ArenaWorld([starts[0]!]);
      hold(lone, 1, 0, cmd(Button.FIRE, -Math.PI / 2));   // upward, hits nothing
      hold(lone, ARROW_LIFETIME_TICKS, 0, null);
      expect(arrows(lone)).toHaveLength(0);
    });
  });

  describe('dying and coming back', () => {
    /**
     * Steps until seat 1 dies and stops on that exact tick, so the tests after
     * it are counting from the death rather than from some point past it.
     */
    const kill = () => {
      const inputs = new Map([[0, FIRE_RIGHT]]);
      for (let i = 0; i < 2000; i++) {
        world.step(DT, inputs);
        if (player(world, 1).state === PlayerState.DEAD) return world;
      }
      throw new Error('seat 1 never died');
    };

    it('leaves the body in the snapshot rather than vanishing it', () => {
      expect(player(kill(), 1)).toBeDefined();
    });

    it('stops a dead player moving', () => {
      const w = kill();
      const where = player(w, 1).x;
      hold(w, 30, 1, cmd(Button.RIGHT));
      expect(player(w, 1).x).toBe(where);
    });

    it('stops a dead player firing', () => {
      const w = kill();
      const inAir = arrows(w).length;
      hold(w, 30, 1, cmd(Button.FIRE, Math.PI));
      expect(arrows(w).length).toBe(inAir);
    });

    it('brings them back at full health once the wait is over', () => {
      const w = kill();
      hold(w, RESPAWN_TICKS + 1, 1, null);
      expect(player(w, 1)).toMatchObject({ hp: PLAYER_MAX_HP, state: PlayerState.ALIVE });
    });

    it('brings them back where they started, not where they fell', () => {
      const w = kill();
      hold(w, RESPAWN_TICKS + 1, 1, null);
      expect(player(w, 1)).toMatchObject({ x: 260, y: 200 });
    });

    it('is still dead a tick before the wait is up', () => {
      const w = kill();
      hold(w, RESPAWN_TICKS - 2, 1, null);
      expect(player(w, 1).state).toBe(PlayerState.DEAD);
    });
  });

  describe('leaving', () => {
    it('takes the body out of the world', () => {
      world.remove(1);
      expect(world.snapshot().some((e) => e.id === 1)).toBe(false);
    });

    it('leaves arrows already in the air, which belong to the world now', () => {
      hold(world, 1, 0, FIRE_RIGHT);
      world.remove(0);
      expect(arrows(world)).toHaveLength(1);
    });
  });
});
