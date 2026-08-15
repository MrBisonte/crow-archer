import { beforeEach, describe, expect, it } from 'vitest';

import { EntityKind, type PlayerStart } from '../net/protocol';
import { unpackPlayerState, unpackShotState } from '../net/entity-state';
import { MAP_COLS, MAP_ROWS, TILE_SIZE, Terrain } from './arena-map';
import { PLAYER_MAX_HP } from './arena';
import { BattleWorld, RESPAWN_TICKS } from './battle-world';
import { CROW_INTERVAL_TICKS } from './crows';
import { Button, type InputCommand } from './input';
import { FIRE_DAMAGE_MULTIPLIER, FIRE_DURATION_TICKS, applyPickup } from './pickups';
import { pickSpawns } from './spawns';
import { Team } from './team';
import { TILE, TileMap } from './tilemap';
import {
  ARROW_DAMAGE,
  BOLT_DAMAGE,
  CROSSBOW_BOLT_COUNT,
  DYNAMITE_CHARGE_TICKS,
  SATCHEL_ARM_FUSE_TICKS,
  SATCHEL_CARRIED,
  SATCHEL_IDLE_TICKS,
  SPEAR_DAMAGE,
} from './weapons';

const DT = 1 / 60;

/** Open ground, so a test is about the fight and not about where a rock landed. */
const clearGround = () => new Terrain(new TileMap(MAP_ROWS, MAP_COLS));

const start = (
  id: number,
  character: PlayerStart['character'],
  team: PlayerStart['team'],
): PlayerStart => ({ id, character, team, x: 0, y: 0 });

interface Setup {
  characters?: PlayerStart['character'][];
  teams?: PlayerStart['team'][];
  mode?: 'coop' | 'deathmatch';
  terrain?: Terrain;
}

/**
 * A match set up the way the server sets one up: spawns are picked from the
 * terrain first and handed in through `starts`, because that is where the
 * decision lives now.
 */
function battle(setup: Setup = {}): BattleWorld {
  const characters = setup.characters ?? ['archer', 'archer'];
  const teams = setup.teams ?? [Team.A, Team.B];
  const terrain = setup.terrain ?? clearGround();
  const spawns = pickSpawns(terrain, characters.length);
  return new BattleWorld({
    seed: 4242,
    mode: setup.mode ?? 'deathmatch',
    noise: () => null,
    terrain,
    starts: characters.map((c, i) => ({
      ...start(i, c, teams[i] ?? Team.A),
      ...(spawns[i] ?? { x: 100, y: 100 }),
    })),
  });
}

const cmd = (buttons: number, aimAngle = 0, seq = 1): InputCommand => ({ seq, buttons, aimAngle });

/** Steps n ticks with one command held by one seat. */
function hold(w: BattleWorld, n: number, id: number, c: InputCommand | null): void {
  const inputs = new Map(c ? [[id, c]] : []);
  for (let i = 0; i < n; i++) w.step(DT, inputs);
}

const players = (w: BattleWorld) => w.snapshot().filter((e) => e.kind === EntityKind.PLAYER);
const player = (w: BattleWorld, id: number) => players(w).find((e) => e.id === id)!;
const shots = (w: BattleWorld) => w.snapshot().filter((e) => e.kind === EntityKind.PROJECTILE);
const crows = (w: BattleWorld) => w.snapshot().filter((e) => e.kind === EntityKind.CROW);
const drops = (w: BattleWorld) => w.snapshot().filter((e) => e.kind === EntityKind.PICKUP);
const blasts = (w: BattleWorld) => w.snapshot().filter((e) => e.kind === EntityKind.BLAST);

/**
 * Winds a throw up and lets it go, which is what a throw is now. `windUp` is in
 * ticks; a full charge is DYNAMITE_CHARGE_TICKS.
 */
function throwDynamite(w: BattleWorld, id: number, angle: number, windUp = 1): void {
  hold(w, windUp, id, cmd(Button.SPECIAL, angle));
  hold(w, 1, id, cmd(0, angle, 2));
}

/** Places two fighters a set distance apart, facing each other. */
function face(w: BattleWorld, gap: number): { shooter: number; target: number; angle: number } {
  const a = player(w, 0);
  // Move seat 1 next to seat 0 by walking it; the world owns positions, so the
  // test steers rather than reaching in.
  const b = player(w, 1);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return { shooter: 0, target: 1, angle: gap === 0 ? angle : angle };
}

describe('BattleWorld', () => {
  describe('standing up', () => {
    it('puts every seat on ground it can stand on', () => {
      const terrain = Terrain.fromSeed(99, () => null);
      const spawns = pickSpawns(terrain, 4);
      const w = new BattleWorld({
        seed: 99,
        mode: 'deathmatch',
        noise: () => null,
        terrain,
        starts: [0, 1, 2, 3].map((i) => ({
          ...start(i, 'archer', i % 2 === 0 ? Team.A : Team.B),
          ...spawns[i]!,
        })),
      });
      for (const p of players(w)) expect(w.terrain.walkable(p.x, p.y)).toBe(true);
    });

    it('starts everyone at full health', () => {
      for (const p of players(battle())) expect(p.hp).toBe(PLAYER_MAX_HP);
    });

    it('starts everyone behind a shield', () => {
      for (const p of players(battle())) {
        expect(unpackPlayerState(p.state).shielded).toBe(true);
      }
    });

    it.each([1, 2, 3, 4])('fields a match of %i players', (count) => {
      const w = battle({
        characters: Array(count).fill('archer'),
        teams: [0, 1, 2, 3].slice(0, count).map((i) => (i % 2 === 0 ? Team.A : Team.B)),
      });
      expect(players(w)).toHaveLength(count);
    });
  });

  describe('moving through terrain', () => {
    it('walks across open ground', () => {
      const w = battle();
      const before = player(w, 0).x;
      hold(w, 30, 0, cmd(Button.RIGHT));
      expect(player(w, 0).x).toBeGreaterThan(before);
    });

    it('is stopped by rock rather than walking through it', () => {
      const terrain = clearGround();
      const w = battle({ terrain });
      const from = player(w, 0);
      // Wall off the column just to the right of the body.
      const col = Math.floor(from.x / TILE_SIZE) + 1;
      for (let r = 0; r < MAP_ROWS; r++) terrain.map.set(r, col, TILE.ROCK);
      hold(w, 60, 0, cmd(Button.RIGHT));
      expect(player(w, 0).x).toBeLessThan((col + 1) * TILE_SIZE);
    });
  });

  describe('the archer', () => {
    it('puts an arrow in the air on the fire button', () => {
      const w = battle();
      hold(w, 1, 0, cmd(Button.FIRE));
      expect(shots(w)).toHaveLength(1);
    });

    it('holds fire between shots rather than firing every tick', () => {
      const w = battle();
      hold(w, 10, 0, cmd(Button.FIRE));
      expect(shots(w)).toHaveLength(1);
    });
  });

  describe('taking damage', () => {
    /** Fires from seat 0 straight at seat 1 until something lands. */
    const duel = (characters: PlayerStart['character'][] = ['archer', 'archer']) => {
      const w = battle({ characters });
      const { angle } = face(w, 0);
      return { w, angle };
    };

    it('spends the shield on the first hit rather than health', () => {
      const { w, angle } = duel();
      hold(w, 240, 0, cmd(Button.FIRE, angle));
      const hit = player(w, 1);
      expect(unpackPlayerState(hit.state).shielded).toBe(false);
    });

    it('takes health only once the shield is gone', () => {
      const { w, angle } = duel();
      const inputs = new Map([[0, cmd(Button.FIRE, angle)]]);
      // Stops at the first tick health moves. Running to a fixed count instead
      // would sail past the kill and the respawn, and read full health again.
      let shieldWentFirst = false;
      for (let i = 0; i < 600; i++) {
        w.step(DT, inputs);
        const hit = player(w, 1);
        if (hit.hp < PLAYER_MAX_HP) {
          shieldWentFirst = !unpackPlayerState(hit.state).shielded;
          break;
        }
      }
      expect(shieldWentFirst).toBe(true);
      expect(player(w, 1).hp).toBeLessThan(PLAYER_MAX_HP);
    });

    it('never lets an arrow through to a teammate', () => {
      const w = battle({ characters: ['archer', 'archer'], teams: [Team.A, Team.A] });
      const { angle } = face(w, 0);
      hold(w, 400, 0, cmd(Button.FIRE, angle));
      expect(player(w, 1).hp).toBe(PLAYER_MAX_HP);
      expect(unpackPlayerState(player(w, 1).state).shielded).toBe(true);
    });

    it('reports a kill with the team that made it', () => {
      const w = battle();
      const { angle } = face(w, 0);
      const inputs = new Map([[0, cmd(Button.FIRE, angle)]]);
      let killerTeam: number | null = null;
      for (let i = 0; i < 3000 && killerTeam === null; i++) {
        for (const k of w.step(DT, inputs)) killerTeam = k.killerTeam;
      }
      expect(killerTeam).toBe(Team.A);
    });
  });

  describe('coming back', () => {
    /** Kills seat 1 and stops on the tick it goes down. */
    const kill = (w: BattleWorld, angle: number): void => {
      const inputs = new Map([[0, cmd(Button.FIRE, angle)]]);
      for (let i = 0; i < 3000; i++) {
        w.step(DT, inputs);
        if (unpackPlayerState(player(w, 1).state).dead) return;
      }
      throw new Error('seat 1 never went down');
    };

    it('returns with health, and with the shield back up', () => {
      const w = battle();
      const { angle } = face(w, 0);
      kill(w, angle);
      hold(w, RESPAWN_TICKS + 2, 1, null);
      const back = player(w, 1);
      expect(back.hp).toBe(PLAYER_MAX_HP);
      expect(unpackPlayerState(back.state).shielded).toBe(true);
      expect(unpackPlayerState(back.state).dead).toBe(false);
    });

    it('stays down for the whole wait', () => {
      const w = battle();
      const { angle } = face(w, 0);
      kill(w, angle);
      hold(w, RESPAWN_TICKS - 4, 1, null);
      expect(unpackPlayerState(player(w, 1).state).dead).toBe(true);
    });
  });

  describe('the knight', () => {
    it('does not put anything in the air, because the spear is not thrown', () => {
      const w = battle({ characters: ['knight', 'archer'] });
      hold(w, 5, 0, cmd(Button.FIRE));
      expect(shots(w)).toHaveLength(0);
    });

    it('reports the swing on the wire so it can be drawn', () => {
      const w = battle({ characters: ['knight', 'archer'] });
      hold(w, 3, 0, cmd(Button.FIRE));
      expect(unpackPlayerState(player(w, 0).state).swing).toBeGreaterThan(0);
    });

    it('lands twice in one swing, which is what the double strike means', () => {
      // Seat 1 is dragged next to seat 0 by walking it into reach first.
      const w = battle({ characters: ['knight', 'archer'] });
      const a = player(w, 0);
      const b = player(w, 1);
      const towards = Math.atan2(a.y - b.y, a.x - b.x);
      const inputs = new Map([[1, cmd(Button.LEFT | Button.UP, towards)]]);
      for (let i = 0; i < 400; i++) w.step(DT, inputs);

      const near = player(w, 1);
      const now = player(w, 0);
      const gap = Math.hypot(near.x - now.x, near.y - now.y);
      if (gap > 90) return;                       // never got in range on this map

      const angle = Math.atan2(near.y - now.y, near.x - now.x);
      const before = player(w, 1);
      hold(w, 40, 0, cmd(Button.FIRE, angle));
      const after = player(w, 1);
      const spent = unpackPlayerState(before.state).shielded && !unpackPlayerState(after.state).shielded;
      expect(spent || after.hp < before.hp).toBe(true);
    });
  });

  describe('the wizard', () => {
    it('fires a bolt that steers towards an enemy', () => {
      const w = battle({ characters: ['wizard', 'archer'] });
      // Aim well away from the target; homing should still close the angle.
      hold(w, 1, 0, cmd(Button.FIRE, -Math.PI / 2));
      const first = shots(w)[0]!;
      hold(w, 20, 0, null);
      const later = shots(w)[0];
      if (!later) return;                          // it left the map, which is fine
      const target = player(w, 1);
      const startGap = Math.hypot(first.x - target.x, first.y - target.y);
      const endGap = Math.hypot(later.x - target.x, later.y - target.y);
      expect(endGap).toBeLessThan(startGap);
    });

    it('hits harder than an arrow, which is what the slower rate buys', () => {
      expect(BOLT_DAMAGE).toBeGreaterThan(ARROW_DAMAGE);
    });

    it('lands less per strike than a full spear swing', () => {
      expect(SPEAR_DAMAGE * 2).toBeGreaterThan(BOLT_DAMAGE);
    });
  });

  describe('dynamite', () => {
    it('is thrown by the archer in co-op, where it is the archer&apos;s own weapon', () => {
      const w = battle({ characters: ['archer', 'archer'], teams: [Team.A, Team.A], mode: 'coop' });
      throwDynamite(w, 0, 0);
      expect(shots(w)).toHaveLength(1);
    });

    it('is not carried by a knight in co-op, where it would be overpowered', () => {
      const w = battle({ characters: ['knight', 'archer'], teams: [Team.A, Team.A], mode: 'coop' });
      throwDynamite(w, 0, 0);
      expect(shots(w)).toHaveLength(0);
    });

    it('is carried by everyone in player versus player', () => {
      const w = battle({ characters: ['knight', 'archer'], mode: 'deathmatch' });
      throwDynamite(w, 0, 0);
      expect(shots(w)).toHaveLength(1);
    });

    it('goes off, and says so on the wire so it can be drawn', () => {
      const w = battle({ characters: ['archer', 'archer'] });
      throwDynamite(w, 0, 0);
      expect(blasts(w)).toHaveLength(0);        // the fuse has not run yet
      // Sampled every tick: a blast lasts a third of a second, and a fixed
      // number of steps can land after it has already faded.
      let sawBlast = false;
      for (let i = 0; i < 200 && !sawBlast; i++) {
        w.step(DT, new Map());
        if (blasts(w).length > 0) sawBlast = true;
      }
      expect(sawBlast).toBe(true);
    });

    it('hurts an enemy caught in the blast', () => {
      // Uncharged dynamite covers about 500 px before the fuse runs out, which
      // is well short of the width of the map. Walk the target into range
      // first, the way anyone throwing one would have to.
      const w = battle({ characters: ['archer', 'archer'] });
      const a = player(w, 0);
      const b = player(w, 1);
      const towards = Math.atan2(a.y - b.y, a.x - b.x);
      const closing = new Map([[1, cmd(Button.LEFT, towards)]]);
      for (let i = 0; i < 200; i++) w.step(DT, closing);

      const me = player(w, 0);
      const them = player(w, 1);
      const angle = Math.atan2(them.y - me.y, them.x - me.x);
      throwDynamite(w, 0, angle);
      let hurt = false;
      for (let i = 0; i < 400 && !hurt; i++) {
        w.step(DT, new Map());
        const target = player(w, 1);
        hurt = target.hp < PLAYER_MAX_HP || !unpackPlayerState(target.state).shielded;
      }
      expect(hurt).toBe(true);
    });

    it('never catches a teammate, since friendly fire is off', () => {
      const w = battle({ characters: ['archer', 'archer'], teams: [Team.A, Team.A] });
      const { angle } = face(w, 0);
      hold(w, 400, 0, cmd(Button.SPECIAL, angle));
      expect(player(w, 1).hp).toBe(PLAYER_MAX_HP);
      expect(unpackPlayerState(player(w, 1).state).shielded).toBe(true);
    });

    it('reports how many sticks are left, so the HUD can show them', () => {
      const w = battle();
      expect(unpackPlayerState(player(w, 0).state).secondaryAmmo).toBe(4);
      throwDynamite(w, 0, -Math.PI / 2);
      expect(unpackPlayerState(player(w, 0).state).secondaryAmmo).toBe(3);
    });

    it('reports none for a knight in co-op, who carries none', () => {
      const w = battle({ characters: ['knight', 'archer'], teams: [Team.A, Team.A], mode: 'coop' });
      expect(unpackPlayerState(player(w, 0).state).secondaryAmmo).toBe(0);
    });

    it('throws nothing while the button is still held, and lets go on release', () => {
      const w = battle();
      hold(w, 30, 0, cmd(Button.SPECIAL, 0));   // winding up
      expect(shots(w)).toHaveLength(0);
      hold(w, 1, 0, cmd(0, 0, 2));              // released
      expect(shots(w)).toHaveLength(1);
    });

    it('lets go for a player who simply stops sending anything', () => {
      const w = battle();
      hold(w, 10, 0, cmd(Button.SPECIAL, 0));
      hold(w, 1, 0, null);
      expect(shots(w)).toHaveLength(1);
    });

    it('goes further the longer it is wound up', () => {
      const travel = (windUp: number): number => {
        const w = battle({ characters: ['archer'], teams: [Team.A] });
        const from = player(w, 0).x;
        throwDynamite(w, 0, 0, windUp);
        hold(w, 20, 0, null);
        const shot = shots(w)[0];
        return shot ? shot.x - from : 0;
      };
      expect(travel(DYNAMITE_CHARGE_TICKS)).toBeGreaterThan(travel(1) * 2);
    });

    it('bounces off rock rather than stopping dead on it', () => {
      const terrain = clearGround();
      const w = battle({ characters: ['archer'], teams: [Team.A], terrain });
      const from = player(w, 0);
      const col = Math.floor(from.x / TILE_SIZE) + 3;
      for (let r = 0; r < MAP_ROWS; r++) terrain.map.set(r, col, TILE.ROCK);
      throwDynamite(w, 0, 0, DYNAMITE_CHARGE_TICKS);   // hard, so it comes back
      // Travel into the wall, then back off it: the x velocity has to reverse.
      let sawApproach = false;
      let cameBack = false;
      let furthest = from.x;
      for (let i = 0; i < 80; i++) {
        hold(w, 1, 0, null);
        const shot = shots(w)[0];
        if (!shot) break;
        if (shot.x > furthest) { furthest = shot.x; sawApproach = true; }
        if (sawApproach && shot.x < furthest - 8) cameBack = true;
      }
      expect(cameBack).toBe(true);
    });

    it('sinks in water, leaving no blast behind', () => {
      const terrain = clearGround();
      const w = battle({ characters: ['archer'], teams: [Team.A], terrain });
      const from = player(w, 0);
      const col = Math.floor(from.x / TILE_SIZE) + 3;
      for (let r = 0; r < MAP_ROWS; r++) terrain.map.set(r, col, TILE.WATER);
      throwDynamite(w, 0, 0);
      let sawBlast = false;
      for (let i = 0; i < 150; i++) {
        hold(w, 1, 0, null);
        if (blasts(w).length > 0) sawBlast = true;
      }
      expect(shots(w)).toHaveLength(0);         // gone
      expect(sawBlast).toBe(false);             // and it fizzled rather than went off
    });

    it('burns the trees it is thrown at', () => {
      const terrain = clearGround();
      const w = battle({ characters: ['archer'], teams: [Team.A], terrain });
      const from = player(w, 0);
      const row = Math.floor(from.y / TILE_SIZE);
      // Straight in the path. A stick loses speed as it goes and detonates where
      // it stops, so what it is thrown at is what it clears -- which is the
      // whole point, and was not true while a bounce sent it back where it came
      // from and it went off there instead.
      const col = Math.floor(from.x / TILE_SIZE) + 4;
      for (let r = row - 1; r <= row + 1; r++) terrain.map.set(r, col, TILE.TREE);
      throwDynamite(w, 0, 0);
      for (let i = 0; i < 200; i++) hold(w, 1, 0, null);
      const standing = [row - 1, row, row + 1].filter((r) => terrain.map.get(r, col) === TILE.TREE);
      expect(standing).toEqual([]);
    });

    it('runs out, so it cannot be thrown forever', () => {
      const w = battle({ characters: ['archer'], teams: [Team.A] });
      for (let i = 0; i < 8; i++) {
        throwDynamite(w, 0, -Math.PI / 2);
        hold(w, 60, 0, null);
      }
      expect(unpackPlayerState(player(w, 0).state).secondaryAmmo).toBe(0);
    });
  });

  describe('ranger crossbow', () => {
    it('fires three independent bolts per press, not one shot', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      hold(w, 1, 0, cmd(Button.FIRE, 0));
      expect(shots(w)).toHaveLength(CROSSBOW_BOLT_COUNT);
    });

    it('kills a stationary target over repeated bursts', () => {
      // Placed close by hand, so this is a test of whether the weapon can
      // kill at all, not of whatever distance the random spawns picked.
      const w = new BattleWorld({
        seed: 1,
        mode: 'deathmatch',
        noise: () => null,
        terrain: clearGround(),
        starts: [
          { id: 0, character: 'ranger', team: Team.A, x: 100, y: 100 },
          { id: 1, character: 'archer', team: Team.B, x: 140, y: 100 },
        ],
      });
      const angle = 0; // seat 1 sits directly to the right of seat 0
      let dead = false;
      for (let burst = 0; burst < 40 && !dead; burst++) {
        hold(w, 1, 0, cmd(Button.FIRE, angle));
        hold(w, 25, 0, cmd(0, angle)); // clears the crossbow's own cooldown
        dead = unpackPlayerState(player(w, 1).state).dead;
      }
      expect(dead).toBe(true);
    });

  });

  describe('ranger satchel', () => {
    /** One tick down, then released: the click a fresh SPECIAL press is. */
    function click(w: BattleWorld, id: number, angle: number): void {
      hold(w, 1, id, cmd(Button.SPECIAL, angle));
      hold(w, 1, id, cmd(0, angle, 99));
    }

    it('is thrown by one click, unarmed, showing no countdown yet', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      const { angle } = face(w, 0);
      click(w, 0, angle);
      expect(shots(w)).toHaveLength(1);
      expect(unpackShotState(shots(w)[0]!.state).fuse).toBe(0);
    });

    it('does nothing while held: only a fresh click throws or arms it', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      const { angle } = face(w, 0);
      hold(w, 40, 0, cmd(Button.SPECIAL, angle)); // held, never released
      expect(shots(w)).toHaveLength(1); // exactly one throw, not one per tick
    });

    it('starts counting down only once armed by a second click', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      const { angle } = face(w, 0);
      click(w, 0, angle); // throw
      hold(w, 30, 0, cmd(0, angle)); // sits inert; nothing arms it on its own
      expect(unpackShotState(shots(w)[0]!.state).fuse).toBe(0);
      click(w, 0, angle); // arm
      // The wire fuse is quantised to 16 steps, so the first ~19 ticks after
      // arming still read as 0: not a sign it failed to arm, just too fine a
      // grain for the wire to show yet. Past one full step removes the doubt.
      hold(w, 60, 0, cmd(0, angle));
      expect(unpackShotState(shots(w)[0]!.state).fuse).toBeGreaterThan(0);
    });

    it('explodes on its own once the armed countdown runs out', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      const { angle } = face(w, 0);
      click(w, 0, angle);
      click(w, 0, angle);
      let sawBlast = false;
      for (let i = 0; i < SATCHEL_ARM_FUSE_TICKS + 5 && !sawBlast; i++) {
        w.step(DT, new Map());
        if (blasts(w).length > 0) sawBlast = true;
      }
      expect(sawBlast).toBe(true);
    });

    it('never explodes on its own while unarmed', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      const { angle } = face(w, 0);
      click(w, 0, angle); // thrown, never armed
      for (let i = 0; i < SATCHEL_IDLE_TICKS + 60; i++) w.step(DT, new Map());
      expect(blasts(w)).toHaveLength(0); // outlived its idle timer, and just went quiet
      expect(shots(w)).toHaveLength(0);
    });

    it('goes off instantly if its owner shoots it, armed or not', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      const { angle } = face(w, 0);
      click(w, 0, angle); // thrown, unarmed
      hold(w, 1, 0, cmd(Button.FIRE, angle)); // the ranger's own bolt, same line
      let sawBlast = false;
      for (let i = 0; i < 30 && !sawBlast; i++) {
        w.step(DT, new Map());
        if (blasts(w).length > 0) sawBlast = true;
      }
      expect(sawBlast).toBe(true);
    });

    it('runs out, so it cannot be thrown forever', () => {
      const w = battle({ characters: ['ranger', 'archer'] });
      const { angle } = face(w, 0);
      for (let i = 0; i < SATCHEL_CARRIED + 2; i++) {
        click(w, 0, angle); // throw
        click(w, 0, angle); // arm
        hold(w, SATCHEL_ARM_FUSE_TICKS + 5, 0, cmd(0, angle)); // let it go off
      }
      expect(unpackPlayerState(player(w, 0).state).secondaryAmmo).toBe(0);
    });
  });

  describe('fire', () => {
    it('hits half again as hard while it burns', () => {
      // Fed straight into the damage rule rather than staged through a crow and
      // a pickup: what is under test is what fire is worth, not how it is found.
      expect(Math.round(ARROW_DAMAGE * FIRE_DAMAGE_MULTIPLIER)).toBe(3);
      expect(Math.round(SPEAR_DAMAGE * FIRE_DAMAGE_MULTIPLIER)).toBe(3);
      expect(Math.round(BOLT_DAMAGE * FIRE_DAMAGE_MULTIPLIER)).toBe(5);
    });

    it('burns for three seconds, which is a window and not a state', () => {
      expect(FIRE_DURATION_TICKS).toBe(180);
    });

    it('marks a shot fired while alight, so it can be drawn as one', () => {
      const w = battle();
      const taker = { shielded: false, fireTicks: 0 };
      applyPickup('fire', taker);
      expect(taker.fireTicks).toBe(FIRE_DURATION_TICKS);
    });

    it('leaves a cold shot unmarked on the wire', () => {
      const w = battle();
      hold(w, 1, 0, cmd(Button.FIRE));
      expect(unpackShotState(shots(w)[0]!.state).fiery).toBe(false);
    });

    it('leaves a tree standing when the shot that hit it was not alight', () => {
      // The positive case — a fiery shot chars the tile it hits — is
      // Terrain.burnTile's own unit tests in arena-map.test.ts, which do not
      // need a fighter to actually be on fire to check what burning does.
      // What only a real BattleWorld can prove is the other half: an ordinary
      // shot must not trip the same rule, since fireTicks otherwise has
      // nothing to gate.
      const terrain = clearGround();
      const w = battle({ characters: ['archer'], teams: [Team.A], terrain });
      const from = player(w, 0);
      const row = Math.floor(from.y / TILE_SIZE);
      const col = Math.floor(from.x / TILE_SIZE) + 3;
      terrain.map.set(row, col, TILE.TREE);
      hold(w, 1, 0, cmd(Button.FIRE, 0));
      for (let i = 0; i < 30; i++) hold(w, 1, 0, null);
      expect(terrain.map.get(row, col)).toBe(TILE.TREE);
      expect(w.snapshot().some((e) => e.kind === EntityKind.BURN)).toBe(false);
    });
  });

  describe('crows', () => {
    it('has none at the start, since one is an event and not the opposition', () => {
      expect(crows(battle())).toHaveLength(0);
    });

    it('sends one across after a while', () => {
      const w = battle();
      hold(w, CROW_INTERVAL_TICKS + 2, 0, null);
      expect(crows(w)).toHaveLength(1);
    });

    it('never floods the map with them', () => {
      const w = battle();
      hold(w, CROW_INTERVAL_TICKS * 6, 0, null);
      expect(crows(w).length).toBeLessThanOrEqual(2);
    });
  });

  describe('the snapshot', () => {
    it('carries the aim, so a body can be drawn facing where it looks', () => {
      const w = battle();
      hold(w, 2, 0, cmd(0, 1.5));
      expect(unpackPlayerState(player(w, 0).state).aim).toBeCloseTo(1.5, 1);
    });

    it('rounds positions to whole pixels, so prediction has nothing to reconcile', () => {
      const w = battle();
      hold(w, 7, 0, cmd(Button.RIGHT));
      const p = player(w, 0);
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    });

    it('describes shots as well as bodies', () => {
      const w = battle();
      hold(w, 1, 0, cmd(Button.FIRE));
      const kinds = new Set(w.snapshot().map((e) => e.kind));
      expect(kinds.has(EntityKind.PLAYER)).toBe(true);
      expect(kinds.has(EntityKind.PROJECTILE)).toBe(true);
    });

    it('gives shots ids that can never collide with a seat', () => {
      const w = battle();
      hold(w, 1, 0, cmd(Button.FIRE));
      for (const s of shots(w)) expect(s.id).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('leaving', () => {
    it('takes the body out of the world', () => {
      const w = battle();
      w.remove(1);
      expect(players(w).some((p) => p.id === 1)).toBe(false);
    });
  });
});
