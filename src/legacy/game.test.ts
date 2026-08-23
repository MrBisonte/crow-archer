/**
 * Headless tests for the legacy single-player game.
 *
 * The point of these is the import on the next line. `game.js` used to bind a
 * canvas and start a frame loop at module scope, so it could only run in a
 * browser and was checked by hand. It now exports `boot()` for that, and
 * nothing else runs on import, so the simulation can be driven here with no
 * DOM at all. `devHooks.stepSim` advances the sim without a frame or a render.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MAP_RULES, type MapKind } from '../sim/arena-map';
import { DEFAULT_REGROWTH, regrowthDelay } from '../sim/regrowth';
import { TILE } from '../sim/tilemap';
import { boot, devHooks as g } from './game.js';

/** One second of simulation, at the fixed 60 Hz step the loop uses. */
const ONE_SECOND = 60;

/**
 * The maps the mapselect screen offers, derived the same way MAP_PANELS
 * derives them. Naming them here instead would be a third copy of a list the
 * game deliberately keeps in one place.
 */
const CROW_MAPS = (Object.keys(MAP_RULES) as MapKind[]).filter((kind) => MAP_RULES[kind].crows);

/** Walks the boss entrance until the boss exists, then opens the fight. */
function enterBossFight(): void {
  g.go('boss_entrance');
  for (let i = 0; i < 20 && !g.boss(); i++) g.stepSim(30);
  g.go('boss_fight');
}

const angle = (fromX: number, fromY: number, toX: number, toY: number): number =>
  Math.atan2(toY - fromY, toX - fromX);

/** Absolute angular difference, normalised to 0..PI. */
const angleGap = (a: number, b: number): number =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('legacy game module', () => {
  it('exports a boot seam and runs nothing on import', () => {
    expect(typeof boot).toBe('function');
    expect(typeof g.stepSim).toBe('function');
    // Untouched by import: boot() is what starts a run.
    expect(g.state()).toBe('menu');
  });
});

describe('a new run', () => {
  beforeEach(() => { g.go('playing'); });

  it('spawns the pace preset\'s opening crows at full health', () => {
    expect(g.crows().length).toBe(g.config().crowStartCount);
    expect(g.hp()).toBe(g.config().playerMaxHP);
    expect(g.killCount()).toBe(0);
  });

  it('advances game time by exactly the fixed step', () => {
    const before = g.gameTime();
    g.stepSim(ONE_SECOND);
    expect(g.gameTime() - before).toBeCloseTo(1, 10);
  });
});

describe('map generation', () => {
  it('announces the theme instead of driving the render layer', () => {
    const seen: string[] = [];
    g.onEvent((e: { type: string; kind?: string }) => {
      if (e.type === 'MAP_GENERATED') seen.push(e.kind!);
    });
    g.generateMap('castle');
    expect(g.mapKind()).toBe('castle');
    expect(seen).toContain('castle');
  });
});

describe('wizard homing bolts', () => {
  it('locks onto the boss rather than the nearest passive crow', () => {
    g.pick('wizard');
    g.go('playing');
    enterBossFight();

    const boss = g.boss();
    // `player` starts life as a bare object literal in the module, so its
    // fields are only known once initGame has filled it in.
    const player = g.player() as { x: number; y: number };

    // One passive crow, left well clear of the line to the boss. Before the
    // boss-first fix an idle leftover crow like this stole every bolt, which
    // is what this pins down. It sits square of the boss bearing rather than
    // opposite it, because a crow placed off the map is recycled back to the
    // spawn corridor on the next step, which is right next to the boss.
    const crows = g.crows();
    const decoy = crows[0];
    crows.length = 0;
    crows.push(decoy);
    decoy.state = 'passive';
    decoy.x = player.x;
    decoy.y = player.y - 200;

    g.shoot();
    g.stepSim(12);

    const bolt = g.arrows()[0];
    expect(bolt).toBeDefined();
    expect(bolt.wiz).toBe(true);
    expect(bolt.homing).toBe(true);

    const heading = Math.atan2(bolt.vy, bolt.vx);
    const toBoss = angle(bolt.x, bolt.y, boss.x, boss.y);
    const toDecoy = angle(bolt.x, bolt.y, decoy.x, decoy.y);

    // Pointing at the boss, and nowhere near the crow. A regression to
    // crow-first targeting flips both of these.
    expect(angleGap(heading, toBoss)).toBeLessThan(0.05);
    expect(angleGap(heading, toDecoy)).toBeGreaterThan(0.5);
  });
});

/** Presses a hotkey the way a real key-up/key-down pair would, then runs one
 * step so the handler that reads `keys` sees and consumes it. `devHooks.key`
 * dispatches a DOM KeyboardEvent, which needs a browser; this drives the same
 * `keys` map directly, which is what the vitest `node` environment allows. */
function press(key: string): void {
  (g.keys() as Record<string, boolean>)[key] = true;
  g.stepSim(1);
}

/** Reaches mapselect the real way: the menu hotkey is what sets `gameMode`,
 * so a shortcut through `g.go('mapselect')` would leave a stale gameMode
 * from an earlier test in place. */
function openWavesMapSelect(): void {
  g.go('menu');
  press('w');
  press('Enter');
}

// Pins down charselect's pre-existing cycling behavior. Written before
// factoring its cycling logic into the same shared helper mapselect uses,
// so a refactor that changes behavior fails here rather than shipping.
describe('character select cycling', () => {
  it('arrow keys cycle through CHAR_PANELS in order and wrap both directions', () => {
    g.pick('archer');
    g.go('charselect');

    press('ArrowRight');
    expect(g.selectedChar()).toBe('wizard');
    press('ArrowRight');
    expect(g.selectedChar()).toBe('knight');
    press('ArrowRight');
    expect(g.selectedChar()).toBe('ranger');
    press('ArrowRight'); // wraps past the last panel back to the first
    expect(g.selectedChar()).toBe('archer');

    press('ArrowLeft'); // wraps the other way
    expect(g.selectedChar()).toBe('ranger');
  });

  it('a panel hotkey selects that character directly, regardless of current position', () => {
    g.pick('archer');
    g.go('charselect');

    press('k'); // KNIGHT
    expect(g.selectedChar()).toBe('knight');
    press('x'); // RANGER
    expect(g.selectedChar()).toBe('ranger');
  });
});

describe('waves map select', () => {
  it('brawl always starts on forest, even with a map picked from a previous waves run', () => {
    g.pickMap('castle'); // leftover from a hypothetical earlier waves run
    g.go('menu');
    press('b'); // BRAWL
    expect(g.state()).toBe('charselect');

    press('Enter'); // brawl's map is fixed, so this goes straight to the run
    expect(g.state()).toBe('playing');
    expect(g.mapKind()).toBe('forest');
  });

  it('waves opens mapselect after charselect, and confirming starts on the chosen map', () => {
    g.go('menu');
    press('w'); // WAVES
    expect(g.state()).toBe('charselect');

    press('Enter');
    expect(g.state()).toBe('mapselect');

    press('c'); // CASTLE
    press('Enter');
    expect(g.state()).toBe('playing');
    expect(g.mapKind()).toBe('castle');
    // Castle is a full waves map, not just a visual swap: it still spawns
    // the pace preset's opening crows (MAP_RULES.castle.crows).
    expect(g.crows().length).toBe(g.config().crowStartCount);
  });

  it('regression: waves on castle keeps escalating past the opening wave', () => {
    // Waves+Castle used to hard-stop crow escalation forever (a stale
    // mapKind==='castle' guard written back when only brawl's scripted
    // stage could set it) — clearing the opening crows and simulating well
    // past one escalation interval is what catches that; asserting only the
    // opening count, as the test above does, would not have caught it.
    g.go('menu');
    press('w');
    press('Enter');
    press('c');
    press('Enter');
    expect(g.mapKind()).toBe('castle');

    g.crows().length = 0;
    g.stepSim(g.config().crowEscalationInterval * ONE_SECOND * 3);
    expect(g.crows().length).toBeGreaterThan(0);
  });

  it('escape from mapselect returns to charselect without starting a run', () => {
    openWavesMapSelect();
    expect(g.state()).toBe('mapselect');

    press('Escape');
    expect(g.state()).toBe('charselect');
  });

  // Walks the whole cycle once instead of naming the panels, because the
  // panel list is derived: MAP_PANELS is every MAP_RULES map with crows, in
  // table order. Written out by hand this test had to be edited to add a third
  // map, which is exactly the hand-kept second list that derivation removed.
  it('arrow keys cycle through every crow map in table order, and wrap', () => {
    g.pickMap(CROW_MAPS[0]!);
    openWavesMapSelect();
    expect(g.state()).toBe('mapselect');

    const walked = [g.selectedMapKind()];
    for (let i = 0; i < CROW_MAPS.length; i++) {
      press('ArrowRight');
      walked.push(g.selectedMapKind());
    }
    // Every panel once, then back to where it started.
    expect(walked).toEqual([...CROW_MAPS, CROW_MAPS[0]]);

    press('ArrowLeft'); // and the other way, off the first panel
    expect(g.selectedMapKind()).toBe(CROW_MAPS[CROW_MAPS.length - 1]);
  });

  it('leaves the maze off the screen entirely, because MAP_RULES gives it no crows', () => {
    expect(MAP_RULES.maze.crows).toBe(false);
    expect(CROW_MAPS).not.toContain('maze');
  });

  it('waves on the cavern starts there and spawns the opening crows', () => {
    g.go('menu');
    press('w');
    press('Enter');
    press('v'); // CAVERN — V, because the castle has C
    press('Enter');
    expect(g.state()).toBe('playing');
    expect(g.mapKind()).toBe('cavern');
    expect(g.crows().length).toBe(g.config().crowStartCount);
  });

  // The Waves+Castle bug, which was a population rule keyed on mapKind where
  // it should have been keyed on gameMode and MAP_RULES. A new map kind
  // reintroduces it the moment anything special-cases the kind by name, so the
  // check comes with the kind rather than after someone reports it.
  it('regression: waves on the cavern keeps escalating past the opening wave', () => {
    g.go('menu');
    press('w');
    press('Enter');
    press('v');
    press('Enter');
    expect(g.mapKind()).toBe('cavern');

    g.crows().length = 0;
    g.stepSim(g.config().crowEscalationInterval * ONE_SECOND * 3);
    expect(g.crows().length).toBeGreaterThan(0);
  });
});

describe('cover grows back', () => {
  /** Seconds of simulation, rounded up to whole frames and one over, so a
   * delay that lands mid-frame has actually elapsed by the time we look. */
  const seconds = (s: number): number => Math.ceil(s * ONE_SECOND) + 1;

  /** A tree the player is not standing on, so occupancy is not what is tested. */
  function findTree(): [number, number] {
    const tiles = g.tiles();
    const { rows, cols, tileSize } = g.config();
    const player = g.player() as { x: number; y: number };
    const onPlayer = (r: number, c: number): boolean =>
      Math.floor(player.x / tileSize) === c && Math.floor(player.y / tileSize) === r;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (tiles.get(r, c) === TILE.TREE && !onPlayer(r, c)) return [r, c];
      }
    throw new Error('the forest generated no trees to burn');
  }

  it('takes a burnt tree back through a walkable sapling to a tree', () => {
    g.go('playing');
    g.generateMap('forest');
    g.respawnPlayer();
    expect(g.regrowth().active).toBe(true);

    const [r, c] = findTree();
    g.smashTile(r, c);
    expect(g.tiles().get(r, c)).toBe(TILE.ASH);
    expect(g.regrowth().pending).toBe(1);

    // Stepped to this tile's own delays rather than to a round number: the
    // stagger means no two tiles come back together, which is the point of it.
    g.stepSim(seconds(regrowthDelay(DEFAULT_REGROWTH, 'sprout', r, c)));
    expect(g.tiles().get(r, c)).toBe(TILE.SAPLING);

    g.stepSim(seconds(regrowthDelay(DEFAULT_REGROWTH, 'mature', r, c)));
    expect(g.tiles().get(r, c)).toBe(TILE.TREE);
    expect(g.regrowth().pending).toBe(0);
  });

  // Reported from play: "chars get stuck in rocks and trees sometimes".
  //
  // A body is a box of CONFIG.playerRadius, not the point at its centre, and
  // updatePlayer only moves when all four corners of that box are passable. So
  // a body standing near a tile edge is partly on the next tile over, and a
  // tree maturing there locks it in place: every incremental step keeps the
  // same corner inside the new tree, so all four directions refuse and the
  // only way out is burning the tile back down.
  //
  // Occupancy has to mean "overlaps", not "is centred on".
  it('does not mature into the half of a body hanging over the next tile', () => {
    g.go('playing');
    g.generateMap('forest');
    g.respawnPlayer();
    const { tileSize, playerRadius } = g.config();
    const player = g.player() as { x: number; y: number };

    // Park the player just inside one tile, close enough to the edge that its
    // box spills into the next column.
    const col = Math.floor(player.x / tileSize);
    const row = Math.floor(player.y / tileSize);
    player.x = (col + 1) * tileSize - 2;
    player.y = row * tileSize + tileSize / 2;
    expect(Math.floor((player.x + playerRadius) / tileSize),
      'the test did not actually straddle two tiles').toBe(col + 1);

    // Burn the tile the overhang is on, then wait out the whole regrowth.
    g.tiles().set(row, col + 1, TILE.ASH);
    g.stepSim(seconds(
      regrowthDelay(DEFAULT_REGROWTH, 'sprout', row, col + 1)
      + regrowthDelay(DEFAULT_REGROWTH, 'mature', row, col + 1),
    ));

    expect(g.tiles().get(row, col + 1)).toBe(TILE.SAPLING);
  });

  it('matures it as soon as that body steps clear', () => {
    g.go('playing');
    g.generateMap('forest');
    g.respawnPlayer();
    const { tileSize } = g.config();
    const player = g.player() as { x: number; y: number };
    const col = Math.floor(player.x / tileSize);
    const row = Math.floor(player.y / tileSize);
    player.x = (col + 1) * tileSize - 2;
    player.y = row * tileSize + tileSize / 2;

    g.tiles().set(row, col + 1, TILE.ASH);
    g.stepSim(seconds(
      regrowthDelay(DEFAULT_REGROWTH, 'sprout', row, col + 1)
      + regrowthDelay(DEFAULT_REGROWTH, 'mature', row, col + 1),
    ));
    expect(g.tiles().get(row, col + 1)).toBe(TILE.SAPLING);

    // Step the body fully back into its own tile, and it finishes.
    player.x = col * tileSize + tileSize / 2;
    g.stepSim(ONE_SECOND);
    expect(g.tiles().get(row, col + 1)).toBe(TILE.TREE);
  });

  it('grows nothing on the maze, the map that refuses to be broken', () => {
    g.go('playing');
    g.generateMap('maze');
    expect(MAP_RULES.maze.destructibleTerrain).toBe(false);
    expect(g.regrowth().active).toBe(false);

    // A maze is only rock and floor, so plant something burnable and try:
    // nothing chars it, so nothing is ever queued to come back.
    g.tiles().set(3, 3, TILE.TREE);
    g.smashTile(3, 3);
    expect(g.tiles().get(3, 3)).toBe(TILE.TREE);
    expect(g.regrowth().pending).toBe(0);
  });

  it('drops what was still growing when the map changes under it', () => {
    g.go('playing');
    g.generateMap('forest');
    g.respawnPlayer();
    const [r, c] = findTree();
    g.smashTile(r, c);
    expect(g.regrowth().pending).toBe(1);

    g.generateMap('cavern');
    expect(g.regrowth().pending).toBe(0);
    expect(g.regrowth().active).toBe(true);
  });
});

describe('crows follow MAP_RULES, not the map name', () => {
  it('takes the birds to a map that has them and leaves them behind on one that does not', () => {
    g.go('playing'); // forest, with the pace preset's opening crows
    expect(g.crows().length).toBeGreaterThan(0);

    // crows: true, so the flock carries over rather than being cleared.
    g.generateMap('cavern');
    expect(MAP_RULES.cavern.crows).toBe(true);
    expect(g.crows().length).toBeGreaterThan(0);

    // crows: false. Left in place they would keep flying through the walls of
    // a map with no crow win condition at all.
    g.generateMap('maze');
    expect(g.crows().length).toBe(0);
  });
});
