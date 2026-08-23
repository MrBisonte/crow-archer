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
import { CHARACTERS } from '../net/protocol';
import { MAP_RULES, runsWaves, type MapKind } from '../sim/arena-map';
import { DEFAULT_REGROWTH, regrowthDelay } from '../sim/regrowth';
import { COMMANDER_WAVE, SOLDIER_STATS, waveComposition } from '../sim/soldiers';
import { TILE } from '../sim/tilemap';
import { boot, devHooks as g } from './game.js';
import { ANIM_FRAMES, type PixelGrid } from '../render/pixel-grid';
import { spriteCanvas, spriteFlashCanvas } from '../render/pixel-sprite';
import {
  filledRuns, gridColours, gridSize, installStubCanvas, invalidColours, raggedRows,
} from '../render/grid-testkit';

/** One second of simulation, at the fixed 60 Hz step the loop uses. */
const ONE_SECOND = 60;

/**
 * The maps the mapselect screen offers, derived the same way MAP_PANELS
 * derives them. Naming them here instead would be a third copy of a list the
 * game deliberately keeps in one place.
 */
const WAVE_MAPS = (Object.keys(MAP_RULES) as MapKind[]).filter((kind) => runsWaves(kind));

/**
 * Waves mode remembers the last map picked, for the whole session and so
 * across tests. A test that starts a run without saying which map opens on
 * whichever one an earlier test happened to choose, which was harmless only
 * while every wave map's population was crows: the cavern's is soldiers, so
 * the leftover now decides whether a run has any birds in it at all.
 *
 * Every test starts from forest, and the ones that care pick their own.
 */
beforeEach(() => { g.pickMap('forest'); });

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

describe('diagnostic logging', () => {
  it('records a state transition at info level, with prev/next in the data', () => {
    g.clearLogs();
    g.setLogLevel('info');
    g.go('menu');
    g.go('charselect');

    const transitions = g.logs().filter((e) => e.source === 'transitionTo');
    expect(transitions.length).toBeGreaterThan(0);
    const last = transitions[transitions.length - 1]!;
    expect(last.message).toBe('menu -> charselect');
    expect(last.data).toMatchObject({ prev: 'menu', next: 'charselect' });
  });

  it('does not log a no-op transition (going to the state already active)', () => {
    g.clearLogs();
    g.setLogLevel('info');
    g.go('menu');
    const countAfterFirst = g.logs().filter((e) => e.source === 'transitionTo').length;
    g.go('menu'); // already there
    const countAfterSecond = g.logs().filter((e) => e.source === 'transitionTo').length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('gameplay events reach the log too, at debug, via the same bus everything else uses', () => {
    g.clearLogs();
    g.setLogLevel('debug');
    g.pick('archer');
    g.go('playing');
    g.kill(0); // a real crow kill, not a synthetic log call
    const crowKilled = g.logs().find((e) => e.message === 'CROW_KILLED');
    expect(crowKilled).toBeDefined();
    expect(crowKilled!.source).toBe('EventBus');
  });

  it('below the log floor, nothing is recorded at all — the default stays warn', () => {
    g.clearLogs();
    g.setLogLevel('warn');
    g.go('menu');
    g.go('charselect');
    expect(g.logs().filter((e) => e.source === 'transitionTo')).toHaveLength(0);
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
    press('ArrowRight');
    expect(g.selectedChar()).toBe('sapper');
    press('ArrowRight'); // wraps past the last panel back to the first
    expect(g.selectedChar()).toBe('archer');

    press('ArrowLeft'); // wraps the other way
    expect(g.selectedChar()).toBe('sapper');
  });

  it('a panel hotkey selects that character directly, regardless of current position', () => {
    g.pick('archer');
    g.go('charselect');

    press('k'); // KNIGHT
    expect(g.selectedChar()).toBe('knight');
    press('x'); // RANGER
    expect(g.selectedChar()).toBe('ranger');
    press('s'); // SAPPER
    expect(g.selectedChar()).toBe('sapper');
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
    g.pickMap(WAVE_MAPS[0]!);
    openWavesMapSelect();
    expect(g.state()).toBe('mapselect');

    const walked = [g.selectedMapKind()];
    for (let i = 0; i < WAVE_MAPS.length; i++) {
      press('ArrowRight');
      walked.push(g.selectedMapKind());
    }
    // Every panel once, then back to where it started.
    expect(walked).toEqual([...WAVE_MAPS, WAVE_MAPS[0]]);

    press('ArrowLeft'); // and the other way, off the first panel
    expect(g.selectedMapKind()).toBe(WAVE_MAPS[WAVE_MAPS.length - 1]);
  });

  it('leaves the maze off the screen entirely, because its population is scripted', () => {
    expect(MAP_RULES.maze.population).toBe('scripted');
    expect(WAVE_MAPS).not.toContain('maze');
  });

  // The cavern is the case the old `crows` boolean would have got wrong: it
  // fields a wave, so it belongs on this screen, but that wave is not birds.
  it('keeps a map whose wave is not made of crows', () => {
    expect(MAP_RULES.cavern.population).toBe('soldiers');
    expect(WAVE_MAPS).toContain('cavern');
  });

  it('waves on the cavern starts there and musters the garrison, not a flock', () => {
    g.go('menu');
    press('w');
    press('Enter');
    press('v'); // CAVERN — V, because the castle has C
    press('Enter');
    expect(g.state()).toBe('playing');
    expect(g.mapKind()).toBe('cavern');
    // Wave 1 of its own table, and no birds at all.
    expect(g.soldiers().length).toBe(waveComposition(1).length);
    expect(g.crows().length).toBe(0);
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

    // Same shape as the castle regression above, against the garrison instead
    // of the flock: clear the field and step well past one interval. A
    // population rule keyed on mapKind rather than on gameMode and
    // MAP_RULES.population is what this catches.
    g.soldiers().length = 0;
    g.stepSim(g.config().crowEscalationInterval * ONE_SECOND * 2);
    expect(g.soldiers().length).toBeGreaterThan(0);
  });
});

describe('the cavern garrison', () => {
  /** Starts a cavern run and clears the opening wave, so a test places its own. */
  function emptyCavern(): void {
    g.pickMap('cavern');
    g.go('playing');
    g.soldiers().length = 0;
  }

  /**
   * Puts one soldier at a spot and hands it back, having first cleared the
   * tiles around it.
   *
   * The clearing is not tidiness. A cavern is better than a third rock, so a
   * fixed spot lands inside a wall often enough that an arrow fired at it is
   * deleted by the terrain check before it ever reaches — which for a shield
   * test looks exactly like a successful block.
   */
  function place(kind: 'spearman' | 'shieldman' | 'archer', x: number, y: number) {
    const { tileSize } = g.config();
    const col = Math.floor(x / tileSize), row = Math.floor(y / tileSize);
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) g.tiles().set(row + dr, col + dc, TILE.EMPTY);
    g.spawnSoldier(kind);
    const s = g.soldiers()[g.soldiers().length - 1];
    s.x = x;
    s.y = y;
    return s;
  }

  it('musters wave 1 of its own table on arrival, and no crows', () => {
    g.pickMap('cavern');
    g.go('playing');
    expect(g.soldiers().map((s: { kind: string }) => s.kind).sort())
      .toEqual([...waveComposition(1)].sort());
    expect(g.crows().length).toBe(0);
  });

  it('gives each kind the health its stats table says', () => {
    emptyCavern();
    for (const kind of ['spearman', 'shieldman', 'archer'] as const) {
      const s = place(kind, 400, 300);
      expect(s.hp).toBe(SOLDIER_STATS[kind].hp);
    }
  });

  describe('the shieldman\'s guard', () => {
    /**
     * Fires one arrow travelling along `heading` into a shieldman facing +x,
     * and reports both its health and whether the guard actually stopped
     * something.
     *
     * The block event is what makes "it survived" mean anything: an arrow that
     * never reached leaves health untouched too, so health alone would pass
     * this test with the collision code deleted.
     */
    function shootAt(heading: number): { hp: number; blocked: number } {
      emptyCavern();
      const s = place('shieldman', 400, 300);
      s.facing = 0; // looking +x
      let blocked = 0;
      g.onEvent((e: { type: string }) => { if (e.type === 'SHIELD_BLOCKED') blocked++; });
      // An arrow already in flight, sat on top of it: this exercises the
      // collision branch, not the player's aim.
      g.arrows().push({
        x: s.x, y: s.y,
        vx: Math.cos(heading) * 400, vy: Math.sin(heading) * 400,
        life: 1, type: 'normal', bounces: 0,
      });
      g.stepSim(1);
      return { hp: s.hp, blocked };
    }

    it('turns away an arrow coming at its face', () => {
      // Travelling -x, so arriving head on at a soldier looking +x.
      const shot = shootAt(Math.PI);
      expect(shot.blocked, 'the arrow never reached the shield').toBe(1);
      expect(shot.hp).toBe(SOLDIER_STATS.shieldman.hp);
    });

    it('does not stop one that comes in from the flank', () => {
      // Square from the side is outside the 120 degree guard.
      const shot = shootAt(Math.PI / 2);
      expect(shot.blocked).toBe(0);
      expect(shot.hp).toBeLessThan(SOLDIER_STATS.shieldman.hp);
    });

    it('leaves the other two kinds with no guard at all', () => {
      emptyCavern();
      const s = place('spearman', 400, 300);
      s.facing = 0;
      g.arrows().push({
        x: s.x, y: s.y, vx: -400, vy: 0, life: 1, type: 'normal', bounces: 0,
      });
      g.stepSim(1);
      expect(s.hp).toBeLessThan(SOLDIER_STATS.spearman.hp);
    });
  });

  it('sends a spearman into a committed charge once the player is close', () => {
    emptyCavern();
    const player = g.player() as { x: number; y: number };
    // Inside its reach, so the charge triggers on the next step.
    const s = place('spearman', player.x + SOLDIER_STATS.spearman.reach - 20, player.y);
    // One step, which is the step that commits it. Running further would be
    // testing something else as well: a charge is stopped dead by terrain, and
    // a cavern is a third rock, so a longer run would fail wherever the spot
    // picked happened to have a wall in front of it.
    g.stepSim(1);
    expect(s.charge).toBeGreaterThan(0);
    expect(s.chargeAngle).toBeCloseTo(Math.PI, 1); // committed at the player
  });

  it('leaves a spearman walking while the player is still out of reach', () => {
    emptyCavern();
    const player = g.player() as { x: number; y: number };
    const s = place('spearman', player.x + SOLDIER_STATS.spearman.reach + 200, player.y);
    g.stepSim(2);
    expect(s.charge).toBe(0);
  });

  it('has an archer shoot from its reach rather than closing all the way', () => {
    emptyCavern();
    const player = g.player() as { x: number; y: number };
    const s = place('archer', player.x + SOLDIER_STATS.archer.reach - 20, player.y);
    // Counted as it is fired, not sampled off hostileBolts afterwards: a bolt
    // has a 2.5s life and crosses the map at 300px/s, so by the end of the run
    // the one it fired has already hit something and been spliced out, and the
    // array is back to empty whether or not it ever shot.
    let shots = 0;
    g.onEvent((e: { type: string }) => { if (e.type === 'SOLDIER_SHOT') shots++; });
    g.stepSim(g.config().soldierArcherShotInterval * ONE_SECOND + 10);
    expect(shots).toBeGreaterThan(0);
    // And it held its ground rather than walking into contact.
    expect(Math.abs(s.x - player.x)).toBeGreaterThan(g.config().soldierContactReach);
  });
});

describe('the commander', () => {
  /** Runs a cavern waves run forward until its wave counter reaches `wave`. */
  function runToWave(wave: number): void {
    g.go('menu');
    press('w');
    press('Enter');
    press('v');
    press('Enter');
    expect(g.mapKind()).toBe('cavern');
    // One interval per wave, plus a little, and the field kept clear so the
    // run is not decided by a spearman while the clock advances.
    for (let i = 0; i < wave; i++) {
      g.soldiers().length = 0;
      g.stepSim(g.config().crowEscalationInterval * ONE_SECOND + 2);
    }
  }

  it('does not ride out while the garrison is still holding', () => {
    runToWave(COMMANDER_WAVE - 2);
    expect(g.state()).toBe('playing');
    expect(g.boss()).toBeFalsy();
  });

  it('rides out on his own wave and opens the fight', () => {
    runToWave(COMMANDER_WAVE);
    // The entrance is a state of its own; walk it the way the brawl tests do.
    expect(['boss_entrance', 'boss_fight']).toContain(g.state());
    for (let i = 0; i < 20 && !g.boss(); i++) g.stepSim(30);
    expect(g.boss().kind).toBe('commander');
  });

  it('carries more health than either dark boss, and hits for less than the knight', () => {
    const c = g.config();
    expect(c.commanderHP).toBeGreaterThan(c.darkArcherHP);
    expect(c.commanderHP).toBeGreaterThan(c.darkKnightHP);
    expect(c.commanderContactDamage).toBeLessThan(c.darkKnightContactDamage);
  });

  it('holds his charge for at least the minimum gap, however the roll lands', () => {
    runToWave(COMMANDER_WAVE);
    for (let i = 0; i < 20 && !g.boss(); i++) g.stepSim(30);
    g.go('boss_fight');
    const boss = g.boss();

    // Wind the first charge out, then watch the next gap. However the random
    // spread rolls, it can never come in under the floor — which is the whole
    // reason the floor exists.
    boss.chargeCD = 0;
    g.stepSim(1);
    expect(boss.charge).toBeGreaterThan(0);
    expect(boss.chargeCD).toBeGreaterThanOrEqual(g.config().commanderChargeMinGap);
  });

  it('commits a charge to the heading it picked, not to where the player went', () => {
    runToWave(COMMANDER_WAVE);
    for (let i = 0; i < 20 && !g.boss(); i++) g.stepSim(30);
    g.go('boss_fight');
    const boss = g.boss();
    const player = g.player() as { x: number; y: number };

    boss.chargeCD = 0;
    g.stepSim(1);
    const committed = boss.chargeAngle;
    // Move the player well off that line; the charge must not re-aim.
    player.y += 260;
    g.stepSim(4);
    expect(boss.chargeAngle).toBe(committed);
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

describe('the population follows MAP_RULES, not the map name', () => {
  it('takes the birds to a map that has them and leaves them behind on one that does not', () => {
    g.go('playing'); // forest, with the pace preset's opening crows
    expect(g.crows().length).toBeGreaterThan(0);

    // Also a crows map, so the flock carries over rather than being cleared.
    g.generateMap('castle');
    expect(MAP_RULES.castle.population).toBe('crows');
    expect(g.crows().length).toBeGreaterThan(0);

    // Scripted. Left in place the birds would keep flying through the walls of
    // a map with no crow win condition at all.
    g.generateMap('maze');
    expect(g.crows().length).toBe(0);
  });

  it('leaves the birds behind on a map garrisoned by soldiers', () => {
    g.go('playing');
    expect(g.crows().length).toBeGreaterThan(0);

    g.generateMap('cavern');
    expect(g.crows().length).toBe(0);
  });

  it('takes the garrison off a map that has no garrison', () => {
    g.pickMap('cavern');
    g.go('playing');
    expect(g.soldiers().length).toBeGreaterThan(0);

    g.generateMap('forest');
    expect(g.soldiers().length).toBe(0);
  });
});

describe('the character roster reaches the single-player screen', () => {
  it('gives every character the protocol knows a char-select panel', () => {
    const panelled = g.charPanels().map((p: { char: string }) => p.char);
    for (const kind of CHARACTERS) expect(panelled).toContain(kind);
  });

  it('gives every panel its own hotkey', () => {
    const keys = g.charPanels().map((p: { key: string }) => p.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the sapper', () => {
  beforeEach(() => { g.pick('sapper'); g.go('playing'); });

  it('throws a powder charge on the primary, where the archer throws an arrow', () => {
    expect(g.dynamites().length).toBe(0);
    expect(g.arrows().length).toBe(0);
    g.shoot();
    g.stepSim(1);
    expect(g.dynamites().length).toBe(1);
    // The charge is the whole attack: nothing is loosed from a quiver.
    expect(g.arrows().length).toBe(0);
  });

  it('refuses a second charge until the cooldown has run', () => {
    g.shoot();
    g.stepSim(1);
    expect(g.dynamites().length).toBe(1);

    // Straight away: still winding, so the press is refused rather than queued.
    g.shoot();
    g.stepSim(1);
    expect(g.dynamites().length).toBe(1);
    expect(g.sapperChargeCD()).toBeGreaterThan(0);

    // Once the cooldown is spent, the next press throws. Stopping short of the
    // 1.5s fuse keeps the first charge on the field to be counted.
    g.stepSim(Math.ceil(g.config().sapperChargeCooldown * ONE_SECOND));
    expect(g.sapperChargeCD()).toBe(0);
    g.shoot();
    g.stepSim(1);
    expect(g.dynamites().length).toBe(2);
  });

  it('spends no ammo, so it keeps throwing past what a pouch would hold', () => {
    const pouch = g.config().resources.dynamites.max;
    const step = Math.ceil(g.config().sapperChargeCooldown * ONE_SECOND) + 1;
    let thrown = 0;
    for (let i = 0; i < pouch + 3; i++) {
      g.shoot();
      g.stepSim(1);
      thrown++;
      g.stepSim(step);
    }
    expect(thrown).toBeGreaterThan(pouch);
    // And every one of them went off rather than piling up: the last throw is
    // still mid-fuse when the loop ends, so wait out a full fuse first.
    g.stepSim(Math.ceil(g.config().dynamiteLifetime * ONE_SECOND) + 2);
    expect(g.dynamites().length).toBe(0);
  });

  it('starts every run with the charge ready rather than winding', () => {
    expect(g.sapperChargeCD()).toBe(0);
  });
});

/**
 * Flattens the arena to open floor.
 *
 * The map is procedural, so "blink five tiles east" is otherwise a question
 * about whichever tree the generator happened to put there. These tests are
 * about the rule, not the map, so they lay their own walls where they want
 * them and leave the rest empty.
 */
function clearArena(): void {
  const c = g.config();
  const tiles = g.tiles();
  for (let row = 1; row < c.rows - 1; row++)
    for (let col = 1; col < c.cols - 1; col++) tiles.set(row, col, TILE.EMPTY);
}

/** Puts the wizard at a tile centre, aiming due east, on open ground. */
function wizardAt(col: number, row: number): { x: number; y: number; aimAngle: number } {
  g.pick('wizard');
  g.go('playing');
  clearArena();
  const ts = g.config().tileSize;
  const p = g.player() as { x: number; y: number; aimAngle: number };
  p.x = (col + 0.5) * ts;
  p.y = (row + 0.5) * ts;
  p.aimAngle = 0;
  return p;
}

describe('the wizard blink', () => {
  it('carries the wizard down the aim line, the whole distance on open ground', () => {
    const p = wizardAt(6, 6);
    const from = p.x;
    g.blink();
    expect(p.x - from).toBeCloseTo(g.config().wizBlinkDistance, 0);
    expect(p.y).toBeCloseTo((6 + 0.5) * g.config().tileSize, 5);
  });

  it('stops in front of a wall rather than passing through it', () => {
    const c = g.config();
    const p = wizardAt(6, 6);
    const from = p.x;
    // A column of rock three tiles east, taller than the body, well within
    // the blink's reach.
    const wallCol = 9;
    for (let row = 4; row <= 8; row++) g.tiles().set(row, wallCol, TILE.ROCK);

    g.blink();
    expect(p.x).toBeGreaterThan(from);                       // it did move
    expect(p.x - from).toBeLessThan(c.wizBlinkDistance);     // but not all the way
    expect(p.x + c.playerRadius).toBeLessThanOrEqual(wallCol * c.tileSize);
  });

  it('refuses a blink with nowhere to go, and charges nothing for it', () => {
    const c = g.config();
    const p = wizardAt(6, 6);
    // Hard against the western border, facing into it.
    p.x = c.tileSize + c.playerRadius;
    p.aimAngle = Math.PI;
    const from = p.x;

    g.blink();
    expect(p.x).toBe(from);
    expect(g.wizBlink().cd).toBe(0);
  });

  it('will not blink again until the cooldown has run', () => {
    const c = g.config();
    const p = wizardAt(4, 6);
    g.blink();
    const landed = p.x;
    expect(g.wizBlink().cd).toBeCloseTo(c.wizBlinkCooldown, 5);

    g.blink();
    expect(p.x).toBe(landed);

    // One tick past the nominal cooldown: every cooldown in the game counts
    // down by max(0, cd - dt), so an exact multiple of the step leaves a
    // float's worth of dust behind and the next tick clears it.
    g.stepSim(Math.ceil(c.wizBlinkCooldown * ONE_SECOND) + 1);
    expect(g.wizBlink().cd).toBe(0);
    g.blink();
    expect(p.x).toBeGreaterThan(landed);
  });

  it('eats the hit it blinked away from, and only that one', () => {
    const c = g.config();
    wizardAt(6, 6);
    const before = g.hp();

    g.blink();
    expect(g.wizBlink().iframe).toBeGreaterThan(0);
    g.hurt(3);
    expect(g.hp()).toBe(before);

    // Once the window closes the wizard is as soft as ever.
    g.stepSim(Math.ceil(c.wizBlinkIFrames * ONE_SECOND) + 1);
    expect(g.wizBlink().iframe).toBe(0);
    g.hurt(3);
    expect(g.hp()).toBe(before - 3);
  });

  it('belongs to the wizard alone', () => {
    for (const character of ['archer', 'knight', 'ranger', 'sapper']) {
      g.pick(character);
      g.go('playing');
      clearArena();
      const p = g.player() as { x: number; aimAngle: number };
      p.aimAngle = 0;
      const from = p.x;
      g.blink();
      expect(p.x, character).toBe(from);
      expect(g.wizBlink().cd, character).toBe(0);
    }
  });
});

describe('the sniper key after the rework', () => {
  /** Holds the sniper key and a walk key for a beat, and reports how far the
   * character got. Sniper mode roots whoever still has it. */
  function walkDistanceHoldingShift(character: string): number {
    g.pick(character);
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    p.x = 6.5 * g.config().tileSize;
    p.y = 6.5 * g.config().tileSize;
    const from = p.x;
    const keys = g.keys() as Record<string, boolean>;
    keys[g.config().keys.snipe] = true;
    keys['ArrowRight'] = true;
    g.stepSim(15);
    keys[g.config().keys.snipe] = false;
    keys['ArrowRight'] = false;
    return p.x - from;
  }

  it('still roots the characters who aim down it', () => {
    expect(walkDistanceHoldingShift('archer')).toBe(0);
  });

  it('no longer roots the wizard, whose bolts steer themselves anyway', () => {
    expect(walkDistanceHoldingShift('wizard')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Pixel art
// ---------------------------------------------------------------------------
//
// Sprite art is data long before it is pixels (see src/render/pixel-grid.ts),
// and devHooks.spriteGrids/spriteGrid hand over every grid this module bakes,
// so the art is checked the same way the simulation is: headlessly, with no
// canvas and no frame loop. What each reading means lives in one place,
// src/render/grid-testkit.ts.

installStubCanvas();

interface SpriteInfo {
  name: string;
  w: number;
  h: number;
  kinds: string[];
  frames: string[];
}

const SPRITES = g.spriteGrids() as SpriteInfo[];

const gridOf = (name: string, kind: string, frame: string): PixelGrid =>
  g.spriteGrid(name, kind, frame) as PixelGrid;

/**
 * Palette sizes before the detail pass, per sprite.
 *
 * Distinct colours rather than filled cells is what "gained detail" means for
 * these. The dark archer's hem was torn into tongues, which *removes* cells
 * while plainly adding detail, and the crow king's crown and feather work
 * recolours a mass that was already solid, so a filled-cell floor would need
 * an exception per sprite. A palette that only ever grows needs none.
 */
const PALETTE_BEFORE: Record<string, number> = {
  crow: 4,
  skeleton: 3,
  rat: 3,
  crowking: 5,
  minotaur: 8,
  darkarcher: 6,
  darkknight: 9,
};

describe('sprite grids', () => {
  it('expose every grid the draw code bakes', () => {
    expect(SPRITES.map((s) => s.name).sort()).toEqual(
      ['crow', 'crowking', 'darkarcher', 'darkknight', 'minotaur', 'rat', 'skeleton'],
    );
  });

  for (const sprite of SPRITES) {
    describe(sprite.name, () => {
      for (const kind of sprite.kinds) {
        for (const frame of sprite.frames) {
          it(`builds ${kind}|${frame} as a well-formed grid`, () => {
            const grid = gridOf(sprite.name, kind, frame);
            expect(gridSize(grid)).toEqual({ w: sprite.w, h: sprite.h });
            expect(raggedRows(grid)).toEqual([]);
            expect(invalidColours(grid)).toEqual([]);
          });

          it(`bakes ${kind}|${frame} through the shared sprite cache`, () => {
            const grid = gridOf(sprite.name, kind, frame);
            const key = `test|${sprite.name}|${kind}|${frame}`;
            expect(() => spriteCanvas(key, grid, sprite.w, sprite.h)).not.toThrow();
            expect(() => spriteFlashCanvas(key, grid, sprite.w, sprite.h, '#FFFFFF')).not.toThrow();
          });
        }
      }

      const before = PALETTE_BEFORE[sprite.name];
      if (before !== undefined) {
        it('draws from a wider palette than it did before the detail pass', () => {
          for (const kind of sprite.kinds)
            for (const frame of sprite.frames)
              expect(gridColours(gridOf(sprite.name, kind, frame)).size).toBeGreaterThan(before);
        });
      }
    });
  }
});

describe('walk cycles keep their limbs apart', () => {
  // These three regressed the same way and were invisible the same way. A
  // stride that swings limbs sideways can land two of them in the same
  // columns at the extreme of the swing; while the limbs were sparse curves
  // that read as noise either way, and the moment they are solid it reads as
  // one thick limb. Each sprite's gap is checked the way its own silhouette
  // convention makes it visible.

  it('stands the skeleton on two legs in every frame', () => {
    for (const kind of ['normal', 'fire', 'ice'])
      for (const frame of ANIM_FRAMES) {
        // Row 19 is below the pelvis, where only legs can be. This sprite is
        // outlined, so the gap between the legs is a seam pixel rather than
        // emptiness: the two legs are two columns that match each other and
        // do not match what lies between them.
        const row = gridOf('skeleton', kind, frame)[19] ?? [];
        expect(row[5]).toBe(row[6]);
        expect(row[8]).toBe(row[9]);
        expect(row[7]).not.toBe(row[6]);
      }
  });

  it('stands the minotaur on two hooves in every frame', () => {
    // No outline pass on this one, so two touching hooves fuse into a single
    // bar with nothing to seam them and the gap has to be real emptiness.
    for (const frame of ANIM_FRAMES)
      expect(filledRuns(gridOf('minotaur', 'minotaur', frame), 32)).toBe(2);
  });

  it('gives the rat all four legs in every frame', () => {
    for (const frame of ANIM_FRAMES)
      expect(filledRuns(gridOf('rat', 'rat', frame), 8)).toBe(4);
  });
});
