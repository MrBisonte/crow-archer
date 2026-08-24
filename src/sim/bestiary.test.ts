import { describe, expect, it } from 'vitest';

import {
  BESTIARY,
  BOSS_KINDS,
  ENEMY_KINDS,
  type EnemyKind,
  type Roster,
} from './bestiary';

/** The kinds that answer true for a field, as a set, driven off the union. */
const kindsWhere = (pick: (kind: EnemyKind) => boolean): Set<EnemyKind> =>
  new Set(ENEMY_KINDS.filter(pick));

describe('BESTIARY', () => {
  it.each(ENEMY_KINDS)('has a row for %s', (kind) => {
    expect(BESTIARY[kind]).toBeDefined();
  });

  // The Record makes a missing row a compile error; nothing makes a missing
  // entry in ENEMY_KINDS one, and a short list is how a kind quietly stops
  // being counted by everything that walks the cast. This is that guard.
  it('has exactly as many rows as ENEMY_KINDS names kinds', () => {
    expect(Object.keys(BESTIARY)).toHaveLength(ENEMY_KINDS.length);
  });

  it('names each kind once', () => {
    expect(new Set(ENEMY_KINDS).size).toBe(ENEMY_KINDS.length);
  });

  it('names a kind that has a row, for every name it lists', () => {
    for (const kind of ENEMY_KINDS) {
      expect(Object.keys(BESTIARY), `${kind} is named but has no row`).toContain(kind);
    }
  });
});

describe('what each kind is made of', () => {
  // Two kinds reach across the map, and which two decides whether backing off
  // is an answer. Pinned by name rather than by count alone: a third shooter
  // is a real design change and should not arrive as a passing test.
  it('gives exactly two kinds a ranged attack, the ice skeleton and the soldier archer', () => {
    const ranged = kindsWhere((kind) => BESTIARY[kind].ranged);
    expect(ranged.size).toBe(2);
    expect(ranged).toEqual(new Set<EnemyKind>(['ice_skeleton', 'soldier_archer']));
  });

  it.each(ENEMY_KINDS)('gives %s a spawn argument that is null or a real string', (kind) => {
    const { spawnArg } = BESTIARY[kind];
    if (spawnArg !== null) {
      expect(typeof spawnArg).toBe('string');
      expect(spawnArg.trim()).not.toBe('');
    }
  });

  it.each(ENEMY_KINDS)('puts %s in one of the three legacy arrays', (kind) => {
    const rosters: readonly Roster[] = ['crows', 'skeletons', 'soldiers'];
    expect(rosters).toContain(BESTIARY[kind].roster);
  });

  // The crows array has one shape of bird and a `white` flag, not a kind
  // argument, so its two kinds are the ones with nothing to pass.
  it('asks for no argument exactly where the spawner takes none', () => {
    expect(kindsWhere((kind) => BESTIARY[kind].spawnArg === null))
      .toEqual(new Set<EnemyKind>(['bat', 'crow']));
  });

  // A bat is a white crow: spawnBossBats() pushes into `crows`. Worth pinning
  // because the name is the one thing that does not say so.
  it('keeps the bat in the crows roster, where the summoner puts it', () => {
    expect(BESTIARY.bat.roster).toBe('crows');
    expect(BESTIARY.bat.roster).toBe(BESTIARY.crow.roster);
  });

  // Likewise the rat, which lives with the skeletons and behaves like none of
  // them: placed in the map rather than marched in off the edge.
  it('keeps the rat in the skeletons roster but places it in the map', () => {
    expect(BESTIARY.rat.roster).toBe('skeletons');
    expect(BESTIARY.rat.walksIn).toBe(false);
  });

  // walksIn is per kind and not per roster, and the skeletons roster is why:
  // the rat is placed in the map, while the three castle kinds it shares an
  // array with march in off the right edge. `spawnSkeleton` splits on exactly
  // that. Everything else is already inside with you when it appears.
  it('walks in the crow and the three castle skeletons, and nothing else', () => {
    expect(kindsWhere((kind) => BESTIARY[kind].walksIn)).toEqual(
      new Set<EnemyKind>(['crow', 'skeleton', 'fire_skeleton', 'ice_skeleton']),
    );
  });
});

describe('BOSS_KINDS', () => {
  it('lists the five bosses, each once', () => {
    expect(BOSS_KINDS).toHaveLength(5);
    expect(new Set(BOSS_KINDS).size).toBe(BOSS_KINDS.length);
  });

  // The two unions are separate on purpose; a name in both would mean a body
  // that is a boss in one table and rabble in the other.
  it('shares no name with an enemy kind', () => {
    const enemies = new Set<string>(ENEMY_KINDS);
    for (const boss of BOSS_KINDS) expect(enemies).not.toContain(boss);
  });
});
