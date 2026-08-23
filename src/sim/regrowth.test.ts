import { describe, expect, it } from 'vitest';

import { DEFAULT_REGROWTH, Regrowth, regrowthDelay, type RegrowthRules } from './regrowth';
import { TILE, TileMap, tilePassable } from './tilemap';

/** No stagger, so a delay is exactly the number the rules give and a test can
 * step to the frame the tile is due on rather than sampling around it. */
const EXACT: RegrowthRules = { sprout: 10, mature: 20, stagger: 0 };

const grid = (): TileMap => new TileMap(8, 8);

/** Burns a tile the way a lightning storm does, which is the only input this has. */
const char = (map: TileMap, r = 2, c = 3): void => { map.set(r, c, TILE.ASH); };

describe('Regrowth', () => {
  it('turns ash into a sapling, then the sapling into a tree', () => {
    const map = grid();
    const regrowth = new Regrowth(map, 'forest', EXACT);
    char(map);

    regrowth.tick(9);
    expect(map.get(2, 3), 'sprouted early').toBe(TILE.ASH);

    regrowth.tick(1);
    expect(map.get(2, 3)).toBe(TILE.SAPLING);

    regrowth.tick(19);
    expect(map.get(2, 3), 'matured early').toBe(TILE.SAPLING);

    regrowth.tick(1);
    expect(map.get(2, 3)).toBe(TILE.TREE);
  });

  // The reason the middle stage exists at all. Ash straight back to tree would
  // close a line the player was shooting down with no warning and no way past.
  it('leaves the middle stage walkable, and the finished tree not', () => {
    const map = grid();
    const regrowth = new Regrowth(map, 'forest', EXACT);
    char(map);

    regrowth.tick(10);
    expect(tilePassable(map.get(2, 3))).toBe(true);

    regrowth.tick(20);
    expect(tilePassable(map.get(2, 3))).toBe(false);
  });

  it('stops once the tree is back, rather than cycling', () => {
    const map = grid();
    const regrowth = new Regrowth(map, 'forest', EXACT);
    char(map);
    regrowth.tick(30);
    expect(map.get(2, 3)).toBe(TILE.TREE);

    regrowth.tick(1000);
    expect(map.get(2, 3)).toBe(TILE.TREE);
    expect(regrowth.pendingCount).toBe(0);
  });

  it('only ever grows back what burned, never rock or a hut', () => {
    const map = grid();
    const regrowth = new Regrowth(map, 'forest', EXACT);
    map.set(1, 1, TILE.ROCK);
    map.set(1, 1, TILE.EMPTY); // a blast clearing it
    map.set(2, 2, TILE.HUT);
    map.set(2, 2, TILE.EMPTY);
    expect(regrowth.pendingCount).toBe(0);

    regrowth.tick(1000);
    expect(map.get(1, 1)).toBe(TILE.EMPTY);
    expect(map.get(2, 2)).toBe(TILE.EMPTY);
  });

  describe('the map decides whether anything grows at all', () => {
    // Not a second rule bolted on beside destructibleTerrain: the same one.
    // A maze is its walls, so it refuses to be broken — and a mechanic that
    // grew a tree in a corridor would be breaking that rule from the far side.
    it('is inert on a map MAP_RULES marks indestructible', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'maze', EXACT);
      expect(regrowth.active).toBe(false);

      char(map);
      expect(regrowth.pendingCount).toBe(0);
      regrowth.tick(1000);
      expect(map.get(2, 3)).toBe(TILE.ASH);
    });

    it.each(['forest', 'castle', 'cavern'] as const)('grows on %s, which is destructible', (kind) => {
      const map = grid();
      const regrowth = new Regrowth(map, kind, EXACT);
      expect(regrowth.active).toBe(true);
      char(map);
      regrowth.tick(30);
      expect(map.get(2, 3)).toBe(TILE.TREE);
    });
  });

  describe('bodies standing on it', () => {
    it('waits rather than sealing something inside a tree', () => {
      const map = grid();
      let standing = true;
      const regrowth = new Regrowth(map, 'forest', EXACT, () => standing);
      char(map);

      regrowth.tick(30);
      expect(map.get(2, 3), 'matured under a body').toBe(TILE.SAPLING);

      standing = false;
      regrowth.tick(0.5);
      expect(map.get(2, 3)).toBe(TILE.TREE);
    });

    // Held at zero rather than rescheduled: otherwise standing on a tile every
    // few seconds keeps it ash forever, and cover never comes back on the one
    // part of the map anyone is fighting over.
    it('does not restart the delay each time it is blocked', () => {
      const map = grid();
      let standing = true;
      const regrowth = new Regrowth(map, 'forest', EXACT, () => standing);
      char(map);

      regrowth.tick(30);
      for (let i = 0; i < 50; i++) regrowth.tick(1);
      standing = false;

      regrowth.tick(0.1);
      expect(map.get(2, 3)).toBe(TILE.TREE);
    });

    it('asks about the tile that is actually growing', () => {
      const map = grid();
      const asked: [number, number][] = [];
      const regrowth = new Regrowth(map, 'forest', EXACT, (r, c) => {
        asked.push([r, c]);
        return false;
      });
      char(map, 5, 6);
      regrowth.tick(30);
      expect(asked).toContainEqual([5, 6]);
    });
  });

  describe('a tile taken back mid-regrowth', () => {
    it('drops it, so nothing grows on ground something else has claimed', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'forest', EXACT);
      char(map);
      regrowth.tick(10);
      expect(map.get(2, 3)).toBe(TILE.SAPLING);

      map.set(2, 3, TILE.EMPTY); // a blast taking the sapling with it
      expect(regrowth.pendingCount).toBe(0);

      regrowth.tick(1000);
      expect(map.get(2, 3), 'a dropped tile grew back anyway').toBe(TILE.EMPTY);
    });

    it('starts again from the beginning when it burns a second time', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'forest', EXACT);
      char(map);
      regrowth.tick(30);
      expect(map.get(2, 3)).toBe(TILE.TREE);

      map.set(2, 3, TILE.ASH);
      regrowth.tick(10);
      expect(map.get(2, 3)).toBe(TILE.SAPLING);
    });
  });

  describe('moving to another map', () => {
    it('forgets tiles that were still growing on the last one', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'forest', EXACT);
      char(map);
      expect(regrowth.pendingCount).toBe(1);

      regrowth.retarget('castle');
      expect(regrowth.pendingCount).toBe(0);
    });

    it('takes the new map\'s rules with it', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'forest', EXACT);
      regrowth.retarget('maze');
      expect(regrowth.active).toBe(false);

      char(map);
      regrowth.tick(1000);
      expect(map.get(2, 3)).toBe(TILE.ASH);
    });

    it('forgets them on a plain grid reset too, since those coordinates are gone', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'forest', EXACT);
      char(map);
      map.reset(Array.from({ length: 8 }, () => new Array(8).fill(TILE.EMPTY) as never));
      expect(regrowth.pendingCount).toBe(0);
    });
  });

  describe('stagger', () => {
    it('brings a burnt patch back a tile at a time, not as one square', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'forest', DEFAULT_REGROWTH);
      for (let c = 0; c < 8; c++) map.set(4, c, TILE.ASH);

      // Halfway through the sprout window, some are up and some are not.
      regrowth.tick(DEFAULT_REGROWTH.sprout);
      const row = Array.from({ length: 8 }, (_, c) => map.get(4, c));
      expect(row).toContain(TILE.SAPLING);
      expect(row).toContain(TILE.ASH);
    });

    it('is lockstep at zero, which is what makes the default worth having', () => {
      const map = grid();
      const regrowth = new Regrowth(map, 'forest', EXACT);
      for (let c = 0; c < 8; c++) map.set(4, c, TILE.ASH);

      regrowth.tick(EXACT.sprout);
      for (let c = 0; c < 8; c++) expect(map.get(4, c)).toBe(TILE.SAPLING);
    });
  });
});

describe('regrowthDelay', () => {
  it('gives the same tile the same delay every time, with no rng to carry', () => {
    expect(regrowthDelay(DEFAULT_REGROWTH, 'sprout', 4, 7))
      .toBe(regrowthDelay(DEFAULT_REGROWTH, 'sprout', 4, 7));
  });

  it('gives neighbouring tiles different ones', () => {
    expect(regrowthDelay(DEFAULT_REGROWTH, 'sprout', 4, 7))
      .not.toBe(regrowthDelay(DEFAULT_REGROWTH, 'sprout', 4, 8));
  });

  it('is exactly the rule at zero stagger', () => {
    expect(regrowthDelay(EXACT, 'sprout', 4, 7)).toBe(EXACT.sprout);
    expect(regrowthDelay(EXACT, 'mature', 4, 7)).toBe(EXACT.mature);
  });

  it('stays inside the band the stagger describes', () => {
    const rules: RegrowthRules = { sprout: 10, mature: 10, stagger: 0.4 };
    for (let r = 0; r < 21; r++)
      for (let c = 0; c < 33; c++) {
        const d = regrowthDelay(rules, 'sprout', r, c);
        expect(d).toBeGreaterThanOrEqual(6);
        expect(d).toBeLessThanOrEqual(14);
      }
  });

  it('never asks for a negative delay, however wide the stagger', () => {
    const wild: RegrowthRules = { sprout: 1, mature: 1, stagger: 10 };
    for (let r = 0; r < 21; r++)
      for (let c = 0; c < 33; c++) {
        expect(regrowthDelay(wild, 'sprout', r, c)).toBeGreaterThanOrEqual(0);
      }
  });
});
