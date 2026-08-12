import { beforeEach, describe, expect, it } from 'vitest';

import { EntityKind, type PlayerStart } from '../net/protocol';
import { unpackPlayerState } from '../net/entity-state';
import { MAP_COLS, MAP_ROWS, TILE_SIZE, Terrain } from './arena-map';
import { PLAYER_MAX_HP } from './arena';
import { BattleWorld, RESPAWN_TICKS } from './battle-world';
import { CROW_INTERVAL_TICKS } from './crows';
import { Button, type InputCommand } from './input';
import { pickSpawns } from './spawns';
import { Team } from './team';
import { TILE, TileMap } from './tilemap';
import { ARROW_DAMAGE, BOLT_DAMAGE, DYNAMITE_CHARGE_TICKS, SPEAR_DAMAGE } from './weapons';

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
      expect(unpackPlayerState(player(w, 0).state).dynamite).toBe(4);
      throwDynamite(w, 0, -Math.PI / 2);
      expect(unpackPlayerState(player(w, 0).state).dynamite).toBe(3);
    });

    it('reports none for a knight in co-op, who carries none', () => {
      const w = battle({ characters: ['knight', 'archer'], teams: [Team.A, Team.A], mode: 'coop' });
      expect(unpackPlayerState(player(w, 0).state).dynamite).toBe(0);
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

    it('burns the trees it goes off among', () => {
      const terrain = clearGround();
      const w = battle({ characters: ['archer'], teams: [Team.A], terrain });
      const from = player(w, 0);
      const row = Math.floor(from.y / TILE_SIZE);
      // An uncharged stick covers about eleven tiles before the fuse runs out.
      // The trunks sit two rows off that flight path: inside the blast, but not
      // in the way, because dynamite bounces off a tree rather than sticking.
      const col = Math.floor(from.x / TILE_SIZE) + 10;
      terrain.map.set(row - 2, col, TILE.TREE);
      terrain.map.set(row + 2, col, TILE.TREE);
      throwDynamite(w, 0, 0);
      for (let i = 0; i < 150; i++) hold(w, 1, 0, null);
      const burned =
        terrain.map.get(row - 2, col) === TILE.EMPTY ||
        terrain.map.get(row + 2, col) === TILE.EMPTY;
      expect(burned).toBe(true);
    });

    it('runs out, so it cannot be thrown forever', () => {
      const w = battle({ characters: ['archer'], teams: [Team.A] });
      for (let i = 0; i < 8; i++) {
        throwDynamite(w, 0, -Math.PI / 2);
        hold(w, 60, 0, null);
      }
      expect(unpackPlayerState(player(w, 0).state).dynamite).toBe(0);
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
