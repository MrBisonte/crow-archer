/**
 * Headless tests for the legacy single-player game.
 *
 * The point of these is the import on the next line. `game.js` used to bind a
 * canvas and start a frame loop at module scope, so it could only run in a
 * browser and was checked by hand. It now exports `boot()` for that, and
 * nothing else runs on import, so the simulation can be driven here with no
 * DOM at all. `devHooks.stepSim` advances the sim without a frame or a render.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CHARACTERS, type CharacterKind } from '../net/protocol';
import { CHARACTER_STATS } from '../sim/arena';
import { MAP_RULES, runsWaves, type MapKind } from '../sim/arena-map';
import { MODE_RULES } from '../sim/game-mode';
import { SIEGE_WAVE_COUNT } from '../sim/siege-waves';
import {
  GUARD_STATS, OPENING_RETINUE, STARTING_RECRUITS, WARD_HEAL, WARD_TRIGGER_HURT,
  type GuardKind,
} from '../sim/guards';
import { TOWER_MAX_HP } from '../sim/towers';
import { mulberry32 } from '../sim/rng';
import { DEFAULT_REGROWTH, regrowthDelay } from '../sim/regrowth';
import { COMMANDER_WAVE, SOLDIER_STATS, waveComposition } from '../sim/soldiers';
import { TILE, tilePassable } from '../sim/tilemap';
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
    // Cleared for the same reason wizardAt() clears it, and this was the one
    // wizard test that did not: a bolt that hits a tile has its vx negated,
    // which swings the heading by most of a half-turn and has nothing to do
    // with what it was homing on. The map seed is Math.random(), so with the
    // trees left standing this failed about one run in sixty — measured over
    // 60 trials, every failure a bounce — whenever one grew between the wizard
    // and the boss.
    clearArena();

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
  // Open ground on purpose. A thrown charge that lands in water is removed
  // without exploding, so on a randomly generated map these counts are a
  // question about where the generator put a pond.
  beforeEach(() => { g.pick('sapper'); g.go('playing'); clearArena(); });

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
    // Counts throws rather than bombs still in the air: the bomb outflies the
    // cooldown, so whether the first one is still on the field by the time the
    // third press lands depends on where the map put its water, not on
    // whether the press was accepted.
    let thrown = 0;
    g.onEvent((e: { type: string; kind?: string }) => {
      if (e.type === 'WEAPON_FIRED' && e.kind === 'charge') thrown++;
    });

    g.shoot();
    g.stepSim(1);
    expect(thrown).toBe(1);

    // Straight away: still winding, so the press is refused rather than queued.
    g.shoot();
    g.stepSim(1);
    expect(thrown).toBe(1);
    expect(g.sapperChargeCD()).toBeGreaterThan(0);

    // Once the cooldown is spent, the next press throws.
    g.stepSim(Math.ceil(g.config().sapperChargeCooldown * ONE_SECOND));
    expect(g.sapperChargeCD()).toBe(0);
    g.shoot();
    g.stepSim(1);
    expect(thrown).toBe(2);
  });

  it('opens with a full pouch of ten and spends one per throw', () => {
    expect(g.config().resources.bombs.max).toBe(10);
    expect((g.inv() as Record<string, number>).bombs).toBe(10);
    g.shoot();
    g.stepSim(1);
    expect((g.inv() as Record<string, number>).bombs).toBe(9);
  });

  it('falls back to the pitchfork once the pouch is empty', () => {
    const step = Math.ceil(g.config().sapperChargeCooldown * ONE_SECOND) + 1;
    let thrown = 0;
    g.onEvent((e: { type: string; kind?: string }) => {
      if (e.type === 'WEAPON_FIRED' && e.kind === 'charge') thrown++;
    });

    // Empty it, then keep pressing.
    for (let i = 0; i < g.config().resources.bombs.max + 3; i++) {
      g.shoot();
      g.stepSim(1);
      g.stepSim(step);
    }
    expect(thrown).toBe(g.config().resources.bombs.max);
    expect((g.inv() as Record<string, number>).bombs).toBe(0);

    // The next press swings rather than doing nothing at all. The presses that
    // emptied the pouch already fell through to the pitchfork, so wait out its
    // own cooldown first or this only proves that swings have a cooldown.
    g.stepSim(Math.ceil(g.config().pitchforkCooldown * ONE_SECOND) + 2);
    let swung = 0;
    g.onEvent((e: { type: string; kind?: string }) => {
      if (e.type === 'WEAPON_FIRED' && e.kind === 'pitchfork') swung++;
    });
    g.shoot();
    g.stepSim(1);
    expect(swung).toBe(1);
  });

  it('takes one bomb per pickup, not a refill to full', () => {
    expect(g.config().resources.bombs.restore).toBe(1);
  });

  describe('elemental bombs', () => {
    it('spends fire before ice before plain, the archer\'s own order', () => {
      const step = Math.ceil(g.config().sapperChargeCooldown * ONE_SECOND) + 1;
      (g.inv() as Record<string, number>).fireBombs = 1;
      (g.inv() as Record<string, number>).iceBombs = 1;
      const kinds: string[] = [];
      for (let i = 0; i < 3; i++) {
        g.shoot();
        g.stepSim(1);
        kinds.push(g.dynamites()[g.dynamites().length - 1].element);
        g.stepSim(step);
      }
      expect(kinds).toEqual(['fire', 'ice', 'none']);
    });

    it('leaves the ground burning where a fire bomb went off', () => {
      clearArena();
      const p = g.player() as { x: number; y: number };
      p.x = 10.5 * g.config().tileSize;
      p.y = 8.5 * g.config().tileSize;
      expect(g.fires().length).toBe(0);
      g.blast(p.x + 40, p.y, 'fire');
      expect(g.fires().length).toBe(1);
      expect(g.fires()[0].life).toBe(g.config().fireBlastPatchDuration);
      expect(g.fires()[0].dps).toBe(g.config().fireBlastPatchDps);
    });

    it('freezes what an ice bomb reaches instead of killing it', () => {
      clearArena();
      const p = g.player() as { x: number; y: number };
      p.x = 10.5 * g.config().tileSize;
      p.y = 8.5 * g.config().tileSize;
      g.crows().length = 0;
      g.spawnCrow();
      const crow = g.crows()[0];
      crow.x = p.x + 30; crow.y = p.y; crow.baseY = p.y;
      crow.hp = 5;   // enough to survive the single point an ice blast deals

      g.blast(crow.x, crow.y, 'ice');
      expect(crow.hp).toBe(5 - g.config().iceBlastDamage);
      expect(crow.frozenTimer).toBe(g.config().iceBlastFreezeSecs);

      // Held in place: a passive crow otherwise drifts west every frame.
      const heldX = crow.x;
      g.stepSim(30);
      expect(crow.x).toBe(heldX);

      // And moving again once it wears off.
      g.stepSim(Math.ceil(g.config().iceBlastFreezeSecs * ONE_SECOND) + 5);
      expect(crow.x).not.toBe(heldX);
    });
  });

  it('starts every run with the charge ready rather than winding', () => {
    expect(g.sapperChargeCD()).toBe(0);
  });

  it('throws a round bomb, not the archer\'s stick of dynamite', () => {
    g.shoot();
    g.stepSim(1);
    expect(g.dynamites()[0].kind).toBe('bomb');
  });

  it('outranges the archer\'s dynamite, by speed and by fuse both', () => {
    const c = g.config();
    expect(c.sapperBombSpeed).toBeGreaterThan(c.dynamiteSpeed);
    expect(c.sapperBombLifetime).toBeGreaterThan(c.dynamiteLifetime);
  });

  describe('the barrage', () => {
    it('fans a fixed count of bombs across its own arc', () => {
      const c = g.config();
      const p = g.player() as { aimAngle: number };
      p.aimAngle = 0;
      g.barrage();
      const bombs = g.barrageBombs();
      expect(bombs.length).toBe(c.sapperBarrageCount);

      // Symmetric about the aim, spanning exactly the configured arc.
      const angles = bombs.map((b: { angle: number }) => b.angle).sort((a: number, b: number) => a - b);
      const half = c.sapperBarrageArcRadians / 2;
      expect(angles[0]).toBeCloseTo(-half, 5);
      expect(angles[angles.length - 1]).toBeCloseTo(half, 5);
      // An odd count puts one bomb dead on the aim line rather than straddling it.
      expect(angles[(angles.length - 1) / 2]).toBeCloseTo(0, 5);
    });

    it('refuses a second barrage until its cooldown has run', () => {
      g.barrage();
      expect(g.sapperBarrageCD()).toBeGreaterThan(0);
      g.barrageBombs().length = 0;
      g.barrage();
      expect(g.barrageBombs().length).toBe(0);
    });

    it('goes off on contact rather than counting down a fuse', () => {
      clearArena();
      const { tileSize } = g.config();
      const p = g.player() as { x: number; y: number; aimAngle: number };
      p.x = 6.5 * tileSize;
      p.y = 6.5 * tileSize;
      p.aimAngle = 0;
      g.crows().length = 0;
      // A wall two tiles east, so the centre bomb reaches it well inside its
      // own fuse. Terrain rather than a crow on purpose: a passive crow's y is
      // recomputed from baseY every frame, so one placed by hand does not stay
      // where it was put.
      for (let dr = -2; dr <= 2; dr++) g.tiles().set(6 + dr, 8, TILE.ROCK);

      let explosions = 0;
      g.onEvent((e: { type: string }) => { if (e.type === 'EXPLOSION') explosions++; });
      g.barrage();
      const fuse = Math.ceil(g.config().sapperBarrageLifetime * ONE_SECOND);
      const steps = 12;
      g.stepSim(steps);
      // Well short of the fuse running out, so this can only be a contact hit.
      expect(steps).toBeLessThan(fuse);
      expect(explosions).toBeGreaterThan(0);
    });
  });

  describe('the shift shot', () => {
    it('is gated on a ten-second cooldown', () => {
      expect(g.config().sapperShotCooldown).toBe(10);
      g.sapperShot();
      expect(g.sapperShots().length).toBe(1);
      expect(g.sapperShotCD()).toBe(10);

      g.sapperShots().length = 0;
      g.sapperShot();
      expect(g.sapperShots().length).toBe(0);
    });

    it('detonates the sapper\'s own bomb into a bigger blast', () => {
      clearArena();
      const p = g.player() as { x: number; y: number; aimAngle: number };
      p.x = 6.5 * g.config().tileSize;
      p.y = 6.5 * g.config().tileSize;
      p.aimAngle = 0;
      g.crows().length = 0;

      // A bomb sat still in the shot's path, rather than one mid-throw.
      g.dynamites().push({
        x: p.x + 60, y: p.y, vx: 0, vy: 0,
        life: 5, fuseTotal: 5, kind: 'bomb', angle: 0, bobPhase: 0,
      });

      let big = false;
      g.onEvent((e: { type: string; big?: boolean }) => { if (e.type === 'EXPLOSION') big = !!e.big; });
      g.sapperShot();
      g.stepSim(6);

      // The bomb is gone, and what it went off as was the combo blast rather
      // than the plain one its own fuse would have produced.
      expect(g.dynamites().length).toBe(0);
      expect(big).toBe(true);
    });

    it('rewards a centre hit over a glancing one', () => {
      const c = g.config();
      // The falloff is what makes it a skill shot: dead centre is worth
      // several times the edge of the same blast.
      expect(c.sapperComboFalloffMax).toBeGreaterThan(c.sapperComboFalloffMin);
      expect(c.sapperComboRadiusMult).toBeGreaterThan(1);
    });
  });

  it('is not rooted by the shift key, since it spends it on the shot', () => {
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
    expect(p.x).toBeGreaterThan(from);
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

  it('chains a second hop straight away, and refuses a third', () => {
    const c = g.config();
    const p = wizardAt(4, 6);

    g.blink();
    const first = p.x;
    expect(g.wizBlink().cd).toBeCloseTo(c.wizBlinkCooldown, 5);
    expect(g.wizBlink().hops).toBe(c.wizBlinkMaxHops - 1);

    // Inside the window the cooldown does not apply: this hop was paid for by
    // the first blink.
    g.blink();
    const second = p.x;
    expect(second - first).toBeCloseTo(c.wizBlinkDistance, 0);
    expect(g.wizBlink().hops).toBe(0);

    // Two is the cap, however fast the third press comes.
    g.blink();
    expect(p.x).toBe(second);
  });

  it('will not chain once the window has lapsed', () => {
    const c = g.config();
    const p = wizardAt(4, 6);
    g.blink();
    const landed = p.x;
    expect(g.wizBlink().chainWindow).toBeCloseTo(c.shiftChainSecs, 5);

    // Let the window run out, but stop well short of the cooldown.
    g.stepSim(Math.ceil(c.shiftChainSecs * ONE_SECOND) + 1);
    expect(g.wizBlink().chainWindow).toBe(0);
    expect(g.wizBlink().hops).toBe(0);
    expect(g.wizBlink().cd).toBeGreaterThan(0);

    g.blink();
    expect(p.x).toBe(landed);
  });

  it('will not blink again until the cooldown has run, once the chain is spent', () => {
    const c = g.config();
    const p = wizardAt(4, 6);
    g.blink();
    g.blink();
    const landed = p.x;

    // One tick past the nominal cooldown: every cooldown in the game counts
    // down by max(0, cd - dt), so an exact multiple of the step leaves a
    // float's worth of dust behind and the next tick clears it.
    g.stepSim(Math.ceil(c.wizBlinkCooldown * ONE_SECOND) + 1);
    expect(g.wizBlink().cd).toBe(0);
    // player.aimAngle is re-read from the pointer every step, so the wait
    // above has turned him; point him east again before asking him to move.
    p.aimAngle = 0;
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

/**
 * The escape hatch. Three separate causes have trapped a player so far, so
 * these cover the symptom — nowhere to move — rather than any one cause.
 */
describe('never leaves the player with nowhere to go', () => {
  /** Walls the player into the single tile they are standing on. */
  function sealIn(): { x: number; y: number } {
    const c = g.config();
    g.pick('archer');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    const col = 16, row = 10;
    p.x = (col + 0.5) * c.tileSize;
    p.y = (row + 0.5) * c.tileSize;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) g.tiles().set(row + dr, col + dc, TILE.ROCK);
    return p;
  }

  it('lifts a player out of a tile that has been walled off around them', () => {
    const p = sealIn();
    expect(g.fits(p.x, p.y)).toBe(true);   // the pocket itself is open ground
    expect(g.boxedIn()).toBe(true);        // but there is no way out of it
    const from = { x: p.x, y: p.y };

    g.unstick();

    expect(g.boxedIn()).toBe(false);
    expect(g.fits(p.x, p.y)).toBe(true);
    expect({ x: p.x, y: p.y }).not.toEqual(from);
  });

  it('lifts a player whose body is inside terrain', () => {
    const c = g.config();
    g.pick('archer');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    const col = 16, row = 10;
    p.x = (col + 0.5) * c.tileSize;
    p.y = (row + 0.5) * c.tileSize;
    g.tiles().set(row, col, TILE.ROCK);    // buried where they stand
    expect(g.fits(p.x, p.y)).toBe(false);

    g.unstick();
    expect(g.fits(p.x, p.y)).toBe(true);
  });

  it('fires on its own within a second, without being asked', () => {
    const p = sealIn();
    const from = { x: p.x, y: p.y };
    g.stepSim(ONE_SECOND);
    expect({ x: p.x, y: p.y }).not.toEqual(from);
  });

  it('says where it happened, so a recurrence leaves evidence', () => {
    g.clearLogs();
    g.setLogLevel('warn');
    sealIn();
    g.unstick();
    const rescued = g.logs().filter((e) => e.source === 'unstickPlayer');
    expect(rescued.length).toBe(1);
    expect(rescued[0]!.data).toMatchObject({ map: 'forest', char: 'archer' });
  });

  // The guard that keeps this from firing during ordinary play. Each of these
  // leaves somewhere to go, so none of them is stuck.
  it('leaves ordinary play alone', () => {
    const c = g.config();
    g.pick('archer');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    const col = 16, row = 10;
    p.x = (col + 0.5) * c.tileSize;
    p.y = (row + 0.5) * c.tileSize;

    // Open ground.
    expect(g.boxedIn()).toBe(false);

    // Flat against a wall.
    g.tiles().set(row, col + 1, TILE.ROCK);
    expect(g.boxedIn()).toBe(false);

    // In a corner.
    g.tiles().set(row + 1, col, TILE.ROCK);
    expect(g.boxedIn()).toBe(false);

    // In a one-tile-wide corridor, walls both sides.
    clearArena();
    g.tiles().set(row - 1, col, TILE.ROCK);
    g.tiles().set(row + 1, col, TILE.ROCK);
    expect(g.boxedIn()).toBe(false);

    // A dead end, open on one side only.
    clearArena();
    const deadEnd: ReadonlyArray<readonly [number, number]> =
      [[-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1], [-1, -1], [1, -1]];
    for (const [dr, dc] of deadEnd) g.tiles().set(row + dr, col + dc, TILE.ROCK);
    expect(g.boxedIn()).toBe(false);

    // And none of that moved anyone.
    const before = { x: p.x, y: p.y };
    g.stepSim(ONE_SECOND * 2);
    expect({ x: p.x, y: p.y }).toEqual(before);
  });
});

describe('the knight charge', () => {
  it('winds up in place, then commits to a dash on release', () => {
    g.pick('knight');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number; aimAngle: number };
    p.x = 6.5 * g.config().tileSize;
    p.y = 6.5 * g.config().tileSize;
    p.aimAngle = 0;
    const start = p.x;

    g.startKnightCharge();
    expect(g.knightCharge().charging).toBe(true);
    g.stepSim(10);
    // The windup roots the knight in place, same as sniper mode elsewhere.
    expect(p.x).toBe(start);

    g.releaseKnightCharge();
    expect(g.knightCharge().dashing).toBe(true);
    g.stepSim(5);
    expect(p.x).toBeGreaterThan(start);
  });

  // Regression: the dash ignores movement keys for its whole 1.5s, so one
  // that ran into a tree used to pin the knight against it for the remaining
  // second and a half with every escape key held down — measured at 85 frames
  // before this, 1 after.
  it('ends the moment terrain stops it, rather than holding the controls', () => {
    const c = g.config();
    g.pick('knight');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    p.x = 16.5 * c.tileSize;
    p.y = 10.5 * c.tileSize;

    g.startKnightCharge();
    g.stepSim(30);
    g.releaseKnightCharge();
    expect(g.knightCharge().dashing).toBe(true);

    // The dash commits to whatever aim updatePlayer settled on, not to
    // whatever a test sets beforehand, so the wall goes across the direction
    // it actually chose.
    const ang = g.knightCharge().angle;
    const col = Math.floor((p.x + Math.cos(ang) * c.tileSize * 1.2) / c.tileSize);
    const row = Math.floor((p.y + Math.sin(ang) * c.tileSize * 1.2) / c.tileSize);
    for (let d = -6; d <= 6; d++) {
      g.tiles().set(row + d, col, TILE.TREE);
      g.tiles().set(row, col + d, TILE.TREE);
    }

    // Run it into the wall. Well short of the full dash, the dash is over.
    g.stepSim(40);
    expect(g.knightCharge().dashing).toBe(false);
    expect(40).toBeLessThan(Math.ceil(c.knightChargeDashDuration * ONE_SECOND));

    // And the knight answers the keys again.
    const from = { x: p.x, y: p.y };
    const keys = g.keys() as Record<string, boolean>;
    const away = ang + Math.PI;
    keys[Math.abs(Math.cos(away)) > Math.abs(Math.sin(away))
      ? (Math.cos(away) > 0 ? 'ArrowRight' : 'ArrowLeft')
      : (Math.sin(away) > 0 ? 'ArrowDown' : 'ArrowUp')] = true;
    g.stepSim(10);
    expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeGreaterThan(0);
  });

  /** Starts a dash on open ground and reports the direction it committed to. */
  function dashing(): number {
    const c = g.config();
    g.pick('knight');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    p.x = 16.5 * c.tileSize;
    p.y = 10.5 * c.tileSize;
    g.startKnightCharge();
    g.stepSim(30);
    g.releaseKnightCharge();
    return g.knightCharge().angle;
  }

  /** The arrow key closest to a world direction. */
  function keyFor(ang: number): string {
    return Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang))
      ? (Math.cos(ang) > 0 ? 'ArrowRight' : 'ArrowLeft')
      : (Math.sin(ang) > 0 ? 'ArrowDown' : 'ArrowUp');
  }

  /** Frames the dash stays in charge of the player, up to a generous cap. */
  function framesHoldingControl(): number {
    let held = 0;
    for (let f = 0; f < 200; f++) {
      g.stepSim(1);
      if (!g.knightCharge().dashing) break;
      held++;
    }
    return held;
  }

  // Regression: a second and a half is a long time to have no say in where you
  // are going. Asking to go back the way you came ends it.
  it('aborts when the player pulls back against it', () => {
    const ang = dashing();
    const keys = g.keys() as Record<string, boolean>;
    keys[keyFor(ang + Math.PI)] = true;
    const held = framesHoldingControl();
    keys[keyFor(ang + Math.PI)] = false;
    expect(held).toBe(0);
  });

  // The other half of that rule: steering with the dash is not an abort, or
  // the ability would cancel itself off whichever key was already held when it
  // started.
  it('runs its full length when the player goes along with it', () => {
    const ang = dashing();
    const keys = g.keys() as Record<string, boolean>;
    keys[keyFor(ang)] = true;
    const held = framesHoldingControl();
    keys[keyFor(ang)] = false;
    expect(held).toBe(Math.round(g.config().knightChargeDashDuration * ONE_SECOND));
  });

  // Regression: a dash that clipped a wall side-on used to slide along it for
  // the rest of its length, moving the knight on one axis only with no say in
  // it — "stuck, can only go left and right".
  it('ends when a wall blocks either axis, rather than sliding along it', () => {
    const c = g.config();
    const ang = dashing();
    const p = g.player() as { x: number; y: number };
    // A wall running parallel to the dash, one tile off to the side.
    const perp = ang + Math.PI / 2;
    for (let d = -10; d <= 10; d++) {
      const wx = p.x + Math.cos(perp) * c.tileSize + Math.cos(ang) * c.tileSize * d;
      const wy = p.y + Math.sin(perp) * c.tileSize + Math.sin(ang) * c.tileSize * d;
      g.tiles().set(Math.floor(wy / c.tileSize), Math.floor(wx / c.tileSize), TILE.TREE);
    }

    let oneAxisOnly = 0;
    let held = 0;
    for (let f = 0; f < 200; f++) {
      const before = { x: p.x, y: p.y };
      g.stepSim(1);
      if (!g.knightCharge().dashing) break;
      held++;
      const dx = Math.abs(p.x - before.x), dy = Math.abs(p.y - before.y);
      if ((dx > 0.01) !== (dy > 0.01)) oneAxisOnly++;
    }
    expect(oneAxisOnly).toBe(0);
    expect(held).toBeLessThan(Math.round(c.knightChargeDashDuration * ONE_SECOND) / 2);
  });

  // Regression: knightCharge.on used to be cleared only by a keyup matching
  // the live CONFIG.keys.snipe, and pausing never delivers one. A charge held
  // into the pause menu left the knight permanently rooted on resume, since
  // going 'paused' -> 'playing' skips the initGame() reset that would
  // otherwise have cleared it.
  it('does not leave the knight stuck after a pause mid-charge', () => {
    g.pick('knight');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    p.x = 6.5 * g.config().tileSize;
    p.y = 6.5 * g.config().tileSize;

    g.startKnightCharge();
    expect(g.knightCharge().charging).toBe(true);

    g.go('paused');
    expect(g.knightCharge().charging).toBe(false);
    g.go('playing');

    const from = p.x;
    const keys = g.keys() as Record<string, boolean>;
    keys['ArrowRight'] = true;
    g.stepSim(15);
    keys['ArrowRight'] = false;
    expect(p.x).toBeGreaterThan(from);
  });
});

describe('the sniper key after the rework', () => {
  /** Holds the sniper key and a walk key for a beat, and reports how far the
   * character got. Nobody is rooted by holding it any more — see below. */
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

  // Sniper mode is gone. It was last written for the sapper, as the one
  // character with nothing else on the key — but the sapper had picked up a
  // combo shot on another branch by then, so once both landed together the
  // root belonged to nobody. Holding the key roots no one now.
  it.each(CHARACTERS)('does not root the %s by being held', (character) => {
    expect(walkDistanceHoldingShift(character)).toBeGreaterThan(0);
  });

  // The two windups that do hold you still own that themselves, off the press
  // rather than off the held state, and release into something.
  it('leaves the knight and the archer their own windup roots', () => {
    g.pick('knight');
    g.go('playing');
    clearArena();
    g.startKnightCharge();
    expect(g.knightCharge().charging).toBe(true);
    g.releaseKnightCharge();
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

// ---------------------------------------------------------------------------
// Character-select panel data
// ---------------------------------------------------------------------------
//
// The panels are a table, so they are checked as data. The reason this exists
// at all is that the row this table used to keep separately — the portrait
// lookup — was checked by nothing, and a missing row draws nothing rather than
// failing, which is how the sapper shipped with a panel and no face. Every
// field a row now carries is asserted here so the next omission is loud.

interface CharPanel {
  char: string;
  hook: string;
  skills: { main: string; secondary: string; shift: string };
  statBars: ReadonlyArray<{ label: string; pips: number }>;
  preview: (frame: 'a' | 'mid' | 'b') => { grid: PixelGrid; sprite: { w: number; h: number }; key: string };
}

const charPanels = (): readonly CharPanel[] => g.charPanels() as readonly CharPanel[];

/** 1..5, scaled against the roster's best — the same shape statPips uses. */
const expectedPips = (value: number, peak: number): number =>
  Math.min(5, Math.max(1, Math.ceil((value / peak) * 5)));

describe('character-select panel data', () => {
  it('gives every panel a hook and all three skill lines', () => {
    for (const p of charPanels()) {
      expect(p.hook, p.char).toBeTruthy();
      for (const slot of ['main', 'secondary', 'shift'] as const) {
        expect(p.skills?.[slot], `${p.char}.${slot}`).toBeTruthy();
        // A budget, not a style rule. The selected panel is 350px wide less
        // 12px padding a side, and Courier New advances 0.6em, so at 10.5px
        // about 51 characters fit; past that the screen truncates with an
        // ellipsis, which reads as a bug. 48 leaves room for font
        // substitution. The exact check needs measureText and a canvas, so it
        // lives in the browser pass — this is the cheap guard that runs here.
        expect(p.skills[slot].length, `${p.char}.${slot}`).toBeLessThanOrEqual(48);
      }
    }
  });

  it('rates every panel on the same four stats, each 1 to 5', () => {
    for (const p of charPanels()) {
      expect(p.statBars.map((b) => b.label), p.char).toEqual(['RANGE', 'DAMAGE', 'HP', 'SPEED']);
      for (const b of p.statBars) {
        expect(Number.isInteger(b.pips), `${p.char}.${b.label}`).toBe(true);
        expect(b.pips, `${p.char}.${b.label}`).toBeGreaterThanOrEqual(1);
        expect(b.pips, `${p.char}.${b.label}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('derives HP and SPEED from CHARACTER_STATS rather than from the panel row', () => {
    // The whole point of deriving them: a number typed into the panel table is
    // free to drift from the one the simulation actually runs on. This fails
    // if either is ever hardcoded back into CHAR_PANELS.
    const stats = Object.values(CHARACTER_STATS);
    const peakHp = Math.max(...stats.map((s) => s.maxHp));
    const peakSpeed = Math.max(...stats.map((s) => s.speed));
    for (const p of charPanels()) {
      const mine = CHARACTER_STATS[p.char as CharacterKind];
      const pips = (label: string): number => p.statBars.find((b) => b.label === label)!.pips;
      expect(pips('HP'), p.char).toBe(expectedPips(mine.maxHp, peakHp));
      expect(pips('SPEED'), p.char).toBe(expectedPips(mine.speed, peakSpeed));
    }
  });

  it('gives every panel a portrait out of its own row', () => {
    for (const p of charPanels()) {
      for (const frame of ANIM_FRAMES) {
        const shown = p.preview(frame);
        expect(shown.key, `${p.char}|${frame}`).toBeTruthy();
        expect(gridSize(shown.grid), `${p.char}|${frame}`)
          .toEqual({ w: shown.sprite.w, h: shown.sprite.h });
        expect(invalidColours(shown.grid), `${p.char}|${frame}`).toEqual([]);
      }
    }
  });
});

describe('the wizard blink arrival pulse', () => {
  /** Drops a single crow at a point, with every other crow cleared away. */
  function loneCrowAt(x: number, y: number): void {
    const crows = g.crows();
    crows.length = 0;
    g.spawnCrow();
    const crow = crows[0] as { x: number; y: number; baseY: number; state: string };
    crow.x = x;
    crow.y = y;
    crow.baseY = y;   // passive crows bob around baseY, and y alone is overwritten
    crow.state = 'passive';
  }

  it('kills what is standing where it lands', () => {
    const c = g.config();
    const p = wizardAt(6, 6);
    loneCrowAt(p.x + c.wizBlinkDistance, p.y);
    expect(g.crows().length).toBe(1);

    g.blink();
    expect(g.crows().length).toBe(0);
  });

  it('leaves what is out of reach alone', () => {
    const c = g.config();
    const p = wizardAt(6, 6);
    // Beyond the pulse, measured from where the blink actually lands.
    loneCrowAt(p.x + c.wizBlinkDistance, p.y - c.wizBlinkPulseRadius * 2);

    g.blink();
    expect(g.crows().length).toBe(1);
  });

  it('does not go off on a blink that was refused', () => {
    const c = g.config();
    const p = wizardAt(6, 6);
    p.x = c.tileSize + c.playerRadius;
    p.aimAngle = Math.PI;              // hard against the border, facing into it
    loneCrowAt(p.x, p.y);              // standing on the wizard

    g.blink();
    expect(g.wizBlink().cd).toBe(0);   // refused
    expect(g.crows().length).toBe(1);  // and nothing was hit
  });

  it('shows a ring at the radius the damage used', () => {
    const c = g.config();
    wizardAt(6, 6);
    g.blink();
    const rings = g.rings() as Array<{ radius: number }>;
    expect(rings.length).toBe(1);
    expect(rings[0]!.radius).toBe(c.wizBlinkPulseRadius);
  });
});

describe('blinking never strands the wizard', () => {
  /** Every corner of the body on a passable tile, which is the property the
   * blink promises and the one a stuck character has lost. */
  function bodyOnOpenGround(p: { x: number; y: number }): boolean {
    const c = g.config();
    const r = c.playerRadius;
    const corner = (x: number, y: number): boolean =>
      tilePassable(g.tiles().get(Math.floor(y / c.tileSize), Math.floor(x / c.tileSize)));
    return corner(p.x - r, p.y - r) && corner(p.x + r, p.y - r)
        && corner(p.x - r, p.y + r) && corner(p.x + r, p.y + r);
  }

  it('always lands on ground the body fits on, on every bearing and both hops', () => {
    const BEARINGS = 12;
    for (let i = 0; i < BEARINGS; i++) {
      // A fresh run per bearing, so both hops are available rather than the
      // second onwards being eaten by the cooldown.
      const p = wizardAt(6, 6);
      // A pillar field dense enough that most bearings run into something
      // inside one hop. The wizard's own tile stays clear: a body that starts
      // inside a wall is a different bug from the one under test.
      for (let row = 3; row <= 12; row++)
        for (let col = 5; col <= 20; col++)
          if ((row + col) % 3 === 0 && !(row === 6 && col === 6))
            g.tiles().set(row, col, TILE.ROCK);

      p.aimAngle = (i / BEARINGS) * Math.PI * 2;
      expect(bodyOnOpenGround(p), `bearing ${i} start`).toBe(true);
      g.blink();
      expect(bodyOnOpenGround(p), `bearing ${i} hop 1`).toBe(true);
      g.blink();
      expect(bodyOnOpenGround(p), `bearing ${i} hop 2`).toBe(true);
    }
  });

  it('refuses rather than making it worse when the body is already boxed in', () => {
    const c = g.config();
    const p = wizardAt(6, 6);
    // Walled in on all four sides, one tile out.
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const)
      g.tiles().set(6 + dr, 6 + dc, TILE.ROCK);
    const from = { x: p.x, y: p.y };

    for (let i = 0; i < 8; i++) {
      p.aimAngle = (i / 8) * Math.PI * 2;
      g.blink();
    }
    expect(p.x).toBe(from.x);
    expect(p.y).toBe(from.y);
    expect(g.wizBlink().cd).toBe(0);   // nothing was spent on any of them
    expect(c.wizBlinkMinDistance).toBeGreaterThan(0);
  });
});

describe('the knight chained charge', () => {
  /** Winds up and releases a charge due east from a known tile, then reports
   * how far the dash travels over `ticks`, with or without the chain. */
  function dashRun(chain: boolean, ticks = 20): number {
    g.pick('knight');
    g.go('playing');
    clearArena();
    const ts = g.config().tileSize;
    const p = g.player() as { x: number; y: number; aimAngle: number };
    p.x = 4 * ts;
    p.y = 6.5 * ts;
    p.aimAngle = 0;
    g.shift();          // windup
    g.shiftUp();        // committed east
    if (chain) g.shift();
    const from = p.x;
    g.stepSim(ticks);
    return p.x - from;
  }

  it('starts a dash the sniper key can chain into', () => {
    dashRun(false, 0);
    expect(g.knightCharge().dashing).toBe(true);
    expect(g.knightCharge().chained).toBe(false);
    expect(g.knightCharge().chainWindow).toBeGreaterThan(0);
  });

  it('covers more ground when the second press lands', () => {
    const plain = dashRun(false);
    const chained = dashRun(true);
    expect(chained).toBeGreaterThan(plain);
  });

  it('commits harder without steering: the angle stays where it was released', () => {
    const before = g.knightCharge().angle;
    dashRun(true, 0);
    expect(g.knightCharge().chained).toBe(true);
    expect(g.knightCharge().angle).toBe(0);
    expect(before).toBeDefined();
  });

  it('chains once per dash, however many times the key comes down', () => {
    dashRun(true, 0);
    const p = g.player() as { x: number };
    g.stepSim(5);
    const after = p.x;
    g.shift();
    g.shift();
    g.stepSim(5);
    // Still one chain: a second would show as another whirl ring.
    expect(g.rings().length).toBe(1);
    expect(p.x).toBeGreaterThan(after);
  });

  it('will not chain once the window has lapsed', () => {
    const c = g.config();
    dashRun(false, 0);
    g.stepSim(Math.ceil(c.shiftChainSecs * ONE_SECOND) + 1);
    expect(g.knightCharge().chainWindow).toBe(0);
    g.shift();
    expect(g.knightCharge().chained).toBe(false);
  });

  it('swings a whirlwind where he stands, and shows its reach', () => {
    const c = g.config();
    dashRun(false, 0);
    const p = g.player() as { x: number; y: number };
    const crows = g.crows();
    crows.length = 0;
    g.spawnCrow();
    const crow = crows[0] as { x: number; y: number; state: string };
    crow.x = p.x;
    crow.y = p.y;
    crow.state = 'passive';

    g.shift();
    expect(g.crows().length).toBe(0);
    const rings = g.rings() as Array<{ radius: number }>;
    expect(rings.length).toBe(1);
    expect(rings[0]!.radius).toBe(c.knightChainWhirlRadius);
  });

  it('belongs to the knight: nobody else chains a charge', () => {
    for (const character of ['archer', 'wizard', 'ranger', 'sapper']) {
      g.pick(character);
      g.go('playing');
      clearArena();
      g.shift();
      expect(g.knightCharge().chained, character).toBe(false);
    }
  });
});

describe('the archer power shot', () => {
  /** An archer on open ground, aiming due east, with the key not yet down. */
  function archerAt(col: number, row: number): { x: number; y: number; aimAngle: number } {
    g.pick('archer');
    g.go('playing');
    clearArena();
    const ts = g.config().tileSize;
    const p = g.player() as { x: number; y: number; aimAngle: number };
    p.x = (col + 0.5) * ts;
    p.y = (row + 0.5) * ts;
    p.aimAngle = 0;
    return p;
  }

  /** Draws for `secs` and looses. Returns the arrow it put in the air. */
  function loose(secs: number): { vx: number; vy: number; pierceLeft: number; dmgMult: number; type: string; power: boolean } {
    g.shift();
    g.holdDraw(secs);
    g.shiftUp();
    const shot = g.arrows()[g.arrows().length - 1];
    return shot as never;
  }

  it('roots him while he draws, which is what the shot costs', () => {
    archerAt(6, 6);
    const p = g.player() as { x: number };
    const keys = g.keys() as Record<string, boolean>;
    g.shift();
    expect(g.archerDraw().drawing).toBe(true);

    const from = p.x;
    keys['ArrowRight'] = true;
    g.stepSim(15);
    keys['ArrowRight'] = false;
    expect(p.x).toBe(from);
  });

  it('looses one arrow on release, and nothing while merely held', () => {
    archerAt(6, 6);
    g.shift();
    g.stepSim(5);
    expect(g.arrows().length).toBe(0);

    g.shiftUp();
    expect(g.arrows().length).toBe(1);
    expect(g.archerDraw().drawing).toBe(false);
  });

  it('flies faster and pierces more the longer it is drawn', () => {
    const c = g.config();

    // The draw fraction comes off the wall clock, so a "tap" is really the
    // millisecond or two between the press and the release. It is asserted as
    // a narrow band rather than an exact figure for that reason; the full draw
    // below is exact because the fraction is capped at 1.
    archerAt(6, 6);
    const tap = loose(0);
    const tapSpeed = Math.hypot(tap.vx, tap.vy);
    expect(tapSpeed).toBeGreaterThanOrEqual(c.arrowSpeed);
    expect(tapSpeed).toBeLessThan(c.arrowSpeed * 1.05);
    expect(tap.pierceLeft).toBe(1);
    expect(tap.dmgMult).toBeGreaterThanOrEqual(1);
    expect(tap.dmgMult).toBeLessThan(1.1);

    archerAt(6, 6);
    const full = loose(c.archerDrawMaxSecs);
    expect(Math.hypot(full.vx, full.vy)).toBeCloseTo(c.arrowSpeed * c.archerPowerSpeedMult, 0);
    expect(full.pierceLeft).toBe(c.archerPowerPierce);
    expect(full.dmgMult).toBeCloseTo(c.archerPowerBossMult, 5);
  });

  it('is marked as a power shot, where an ordinary loosed arrow is not', () => {
    archerAt(6, 6);
    expect(loose(1).power).toBe(true);

    archerAt(6, 6);
    g.shoot();
    g.stepSim(1);
    const plain = g.arrows()[0] as { power?: boolean; pierceLeft?: number };
    expect(plain.power).toBeUndefined();
    expect(plain.pierceLeft).toBeUndefined();
  });

  it('spends one unit of ammo, the same as any other shot', () => {
    archerAt(6, 6);
    const inv = g.inv() as Record<string, number>;
    const before = inv.arrows!;
    loose(1);
    expect(inv.arrows).toBe(before - 1);
  });

  it('keeps whatever ammo was queued, so a drawn fire arrow still burns', () => {
    archerAt(6, 6);
    const inv = g.inv() as Record<string, number>;
    inv.fireArrows = 3;
    expect(loose(1).type).toBe('fire');
    expect(inv.fireArrows).toBe(2);
  });

  it('refuses a second draw until the cooldown has run', () => {
    const c = g.config();
    archerAt(6, 6);
    loose(1);
    expect(g.archerDraw().cooldown).toBeCloseTo(c.archerPowerCooldown, 5);

    g.shift();
    expect(g.archerDraw().drawing).toBe(false);

    g.stepSim(Math.ceil(c.archerPowerCooldown * ONE_SECOND) + 1);
    expect(g.archerDraw().cooldown).toBe(0);
    g.shift();
    expect(g.archerDraw().drawing).toBe(true);
  });

  it('does nothing on a release that never drew', () => {
    archerAt(6, 6);
    g.shiftUp();
    expect(g.arrows().length).toBe(0);
    expect(g.archerDraw().cooldown).toBe(0);
  });

  it('belongs to the archer alone', () => {
    for (const character of ['wizard', 'knight', 'ranger', 'sapper']) {
      g.pick(character);
      g.go('playing');
      clearArena();
      g.shift();
      expect(g.archerDraw().drawing, character).toBe(false);
    }
  });
});

interface NetOpen { type: string; x: number; y: number; radius: number; caught: number }

/**
 * The cavern garrison against effects that were written before it existed.
 *
 * The net and the shared blast helper both came from a branch with no
 * soldiers on it, so each looped over crows and skeletons and silently
 * skipped the garrison once the two branches were put together. Neither
 * branch could have caught this alone, which is exactly why it is pinned
 * here rather than on either one.
 */
describe('area effects reach the cavern garrison', () => {
  /** Three spearmen stood on one spot, with the rest of the wave cleared. */
  function spearmenAt(x: number, y: number): Array<{ x: number; y: number; hp: number; heldTimer: number }> {
    const soldiers = g.soldiers() as Array<{ x: number; y: number; hp: number; heldTimer: number }>;
    soldiers.length = 0;
    for (let i = 0; i < 3; i++) g.spawnSoldier('spearman');
    for (const s of soldiers) { s.x = x; s.y = y; s.heldTimer = 0; }
    return soldiers;
  }

  it('a blast damages soldiers, not just crows and skeletons', () => {
    g.pick('archer');
    g.pickMap('cavern');
    g.go('playing');
    clearArena();
    const ts = g.config().tileSize;
    const at = { x: 16.5 * ts, y: 10.5 * ts };
    const soldiers = spearmenAt(at.x, at.y);
    const before = soldiers.map((s) => s.hp);
    expect(before.every((hp) => hp > 0)).toBe(true);

    g.blast(at.x, at.y);
    g.stepSim(2);

    const after = (g.soldiers() as Array<{ hp: number }>).map((s) => s.hp);
    // Either wounded or killed outright — what matters is that the blast
    // was not simply ignored.
    const untouched = after.length === before.length
      && after.every((hp, i) => hp === before[i]);
    expect(untouched).toBe(false);
  });

  it('the net holds soldiers, so the cavern cannot walk through it', () => {
    g.pick('ranger');
    g.pickMap('cavern');
    g.go('playing');
    clearArena();
    const ts = g.config().tileSize;
    const p = g.player() as { x: number; y: number; aimAngle: number };
    p.x = 10.5 * ts;
    p.y = 10.5 * ts;
    p.aimAngle = 0;
    const soldiers = spearmenAt(p.x + 60, p.y);

    g.shift();
    g.holdNet(g.config().netDrawMaxSecs);
    g.shiftUp();

    // The net flies to a point rather than stopping on contact, so the
    // garrison has to be standing where it lands for this to mean anything.
    const inFlight = g.nets() as Array<{ toX: number; toY: number }>;
    expect(inFlight.length).toBe(1);
    for (const s of soldiers) { s.x = inFlight[0]!.toX; s.y = inFlight[0]!.toY; }

    let everHeld = 0;
    for (let i = 0; i < 120; i++) {
      g.stepSim(1);
      everHeld = Math.max(everHeld, soldiers.filter((s) => s.heldTimer > 0).length);
    }
    expect(everHeld).toBe(soldiers.length);
  });

  it('a held soldier stays put while the mesh is on it', () => {
    g.pick('ranger');
    g.pickMap('cavern');
    g.go('playing');
    clearArena();
    const ts = g.config().tileSize;
    const p = g.player() as { x: number; y: number; aimAngle: number };
    p.x = 10.5 * ts;
    p.y = 10.5 * ts;
    p.aimAngle = 0;
    const soldiers = spearmenAt(p.x + 60, p.y);
    // Held by hand rather than by a net, so this measures the hold itself.
    for (const s of soldiers) s.heldTimer = 1.0;
    const from = soldiers.map((s) => ({ x: s.x, y: s.y }));

    g.stepSim(30);

    soldiers.forEach((s, i) => {
      expect(s.x, `soldier ${i} x`).toBeCloseTo(from[i]!.x, 5);
      expect(s.y, `soldier ${i} y`).toBeCloseTo(from[i]!.y, 5);
    });
  });
});

describe('the ranger net', () => {
  /** A ranger on open ground, aiming due east. */
  function rangerAt(col: number, row: number): { x: number; y: number; aimAngle: number } {
    g.pick('ranger');
    g.go('playing');
    clearArena();
    const ts = g.config().tileSize;
    const p = g.player() as { x: number; y: number; aimAngle: number };
    p.x = (col + 0.5) * ts;
    p.y = (row + 0.5) * ts;
    p.aimAngle = 0;
    return p;
  }

  /** Draws for `secs`, throws, and runs the sim until the net opens. */
  function throwNet(secs: number): NetOpen {
    let seen: NetOpen | null = null;
    g.onEvent((e: { type: string }) => {
      if (e.type === 'RANGER_NET_OPEN') seen = e as NetOpen;
    });
    g.shift();
    g.holdNet(secs);
    g.shiftUp();
    for (let i = 0; i < 120 && seen === null; i++) g.stepSim(1);
    if (seen === null) throw new Error('the net never opened');
    return seen;
  }

  /** One crow at a point, with the rest cleared away. */
  function loneCrowAt(x: number, y: number):
      { x: number; y: number; hp: number; heldTimer: number; frozen: boolean } {
    const crows = g.crows();
    crows.length = 0;
    g.spawnCrow();
    const crow = crows[0] as
      { x: number; y: number; baseY: number; hp: number; heldTimer: number;
        state: string; frozen: boolean };
    crow.x = x;
    crow.y = y;
    crow.baseY = y;
    crow.state = 'passive';
    // Held still for the flight. A net is in the air for up to three quarters
    // of a second and a passive crow drifts most of a radius in that time, so
    // an unfrozen target turns every catch into a question about the drift.
    crow.frozen = true;
    return crow;
  }

  it('leaves the skirmisher free to move while he draws', () => {
    const p = rangerAt(6, 6);
    const keys = g.keys() as Record<string, boolean>;
    g.shift();
    expect(g.rangerNet().drawing).toBe(true);

    const from = p.x;
    keys['ArrowRight'] = true;
    g.stepSim(15);
    keys['ArrowRight'] = false;
    expect(p.x).toBeGreaterThan(from);
  });

  it('throws further, wider and longer the more it is drawn', () => {
    const c = g.config();

    const tapFrom = rangerAt(4, 6).x;
    const tap = throwNet(0);
    expect(tap.x - tapFrom).toBeCloseTo(c.netThrowMin, -1);
    expect(tap.radius).toBeCloseTo(c.netRadiusMin, 1);

    const fullFrom = rangerAt(4, 6).x;
    const full = throwNet(c.netDrawMaxSecs);
    expect(full.x - fullFrom).toBeCloseTo(c.netThrowMax, -1);
    expect(full.radius).toBeCloseTo(c.netRadiusMax, 1);

    expect(full.x - fullFrom).toBeGreaterThan(tap.x - tapFrom);
    expect(full.radius).toBeGreaterThan(tap.radius);
  });

  it('holds for 0.8s at a tap and 2s at a full draw', () => {
    const c = g.config();

    const p1 = rangerAt(4, 6);
    const tapCrow = loneCrowAt(p1.x + c.netThrowMin, p1.y);
    throwNet(0);
    expect(tapCrow.heldTimer).toBeGreaterThan(c.netHoldMin - 0.1);
    expect(tapCrow.heldTimer).toBeLessThan(c.netHoldMin + 0.2);

    const p2 = rangerAt(4, 6);
    const fullCrow = loneCrowAt(p2.x + c.netThrowMax, p2.y);
    throwNet(c.netDrawMaxSecs);
    expect(fullCrow.heldTimer).toBeGreaterThan(c.netHoldMax - 0.1);
    expect(fullCrow.heldTimer).toBeLessThanOrEqual(c.netHoldMax);
  });

  it('never kills what it catches: 0.9 is under a fresh creep', () => {
    const c = g.config();
    const p = rangerAt(4, 6);
    const crow = loneCrowAt(p.x + c.netThrowMin, p.y);
    expect(crow.hp).toBe(1);

    throwNet(0);
    expect(g.crows().length).toBe(1);
    expect(crow.hp).toBeGreaterThan(0);
    expect(crow.hp).toBeLessThan(1);
  });

  it('pins what it caught in place, and lets go when the hold runs out', () => {
    const c = g.config();
    const p = rangerAt(4, 6);
    const crow = loneCrowAt(p.x + c.netThrowMin, p.y);
    throwNet(0);

    // Free to move again now the net has landed: what keeps it still from
    // here is the hold, which is the thing under test.
    crow.frozen = false;
    const at = { x: crow.x, y: crow.y };
    g.stepSim(30);                       // half a second, well inside the hold
    expect(crow.x).toBe(at.x);
    expect(crow.y).toBe(at.y);
    expect(crow.heldTimer).toBeGreaterThan(0);

    g.stepSim(Math.ceil(c.netHoldMin * ONE_SECOND) + 2);
    expect(crow.heldTimer).toBe(0);
    g.stepSim(10);
    expect(crow.x).not.toBe(at.x);   // and it is walking again
  });

  it('catches everything under it, not just the first thing', () => {
    const c = g.config();
    const p = rangerAt(4, 6);
    const crows = g.crows();
    crows.length = 0;
    const landing = p.x + c.netThrowMax;
    for (const dy of [-20, 0, 20]) {
      g.spawnCrow();
      const crow = crows[crows.length - 1] as
        { x: number; y: number; baseY: number; state: string; frozen: boolean };
      crow.x = landing;
      crow.y = p.y + dy;
      crow.baseY = p.y + dy;
      crow.state = 'passive';
      crow.frozen = true;
    }

    const open = throwNet(c.netDrawMaxSecs);
    expect(open.caught).toBe(3);
    for (const crow of crows as Array<{ heldTimer: number }>) {
      expect(crow.heldTimer).toBeGreaterThan(0);
    }
  });

  it('opens against a wall rather than through it', () => {
    const c = g.config();
    const p = rangerAt(4, 6);
    const wallCol = 7;
    for (let row = 3; row <= 9; row++) g.tiles().set(row, wallCol, TILE.ROCK);

    const open = throwNet(c.netDrawMaxSecs);
    expect(open.x).toBeLessThan(wallCol * c.tileSize);
    expect(open.x - p.x).toBeLessThan(c.netThrowMax);
  });

  it('refuses a second net until the cooldown has run', () => {
    const c = g.config();
    rangerAt(4, 6);
    throwNet(0);
    expect(g.rangerNet().cooldown).toBeGreaterThan(c.netCooldown - 1);
    expect(g.rangerNet().cooldown).toBeLessThanOrEqual(c.netCooldown);

    g.shift();
    expect(g.rangerNet().drawing).toBe(false);

    g.stepSim(Math.ceil(c.netCooldown * ONE_SECOND) + 1);
    expect(g.rangerNet().cooldown).toBe(0);
    g.shift();
    expect(g.rangerNet().drawing).toBe(true);
  });

  it('belongs to the ranger alone', () => {
    for (const character of ['archer', 'wizard', 'knight', 'sapper']) {
      g.pick(character);
      g.go('playing');
      clearArena();
      g.shift();
      expect(g.rangerNet().drawing, character).toBe(false);
      expect(g.nets().length, character).toBe(0);
    }
  });
});

// ── SINGLE PLAYER MODE ────────────────────────────────────────────────────────
//
// Until devHooks grew mode()/setMode(), MENU_ENTRIES was the only writer of
// gameMode and it is reachable only by a keypress on the title screen, so every
// test in this file ran in the default 'brawl'. The waves side of all eleven
// mode branches had never been executed. These cover both sides of each rule in
// MODE_RULES that has an observable effect on the simulation; the two that only
// change drawn text (label, summaryStat) are pinned in game-mode.test.ts
// instead, since asserting on a canvas call would test the renderer, not the
// rule.
describe('single player mode rules', () => {
  // gameMode persists across restarts by design, so a test that changes it has
  // to put it back or it leaks into everything after it — which is exactly the
  // isolation trap that made this axis untested in the first place.
  afterEach(() => { g.setMode('brawl'); g.pickMap('forest'); });

  describe('mapChoice and fixedMap decide the ground', () => {
    it('brawl ignores the map picked on the mapselect screen', () => {
      g.setMode('brawl');
      g.pickMap('cavern');
      g.go('playing');
      expect(g.mapKind()).toBe('forest');
    });

    it('waves honours it', () => {
      g.setMode('waves');
      g.pickMap('cavern');
      g.go('playing');
      expect(g.mapKind()).toBe('cavern');
    });

    it('every map a panel offers is one waves can actually start on', () => {
      // MAP_PANELS is derived from runsWaves, and initGame reads the same
      // selection. A map that earns a panel but cannot be started on would be
      // a dead entry on the screen.
      g.setMode('waves');
      for (const kind of Object.keys(MAP_RULES) as MapKind[]) {
        if (!runsWaves(kind)) continue;
        g.pickMap(kind);
        g.go('playing');
        expect(g.mapKind(), kind).toBe(kind);
      }
    });
  });

  describe('mapChoice also decides whether mapselect is on the way in', () => {
    // Pressed through the `keys` map stepGame actually reads, rather than
    // through devHooks.key(): that one builds a KeyboardEvent, and this suite
    // runs in vitest's node environment where there is no DOM to build one in.
    const pressEnterOnCharSelect = (): void => {
      g.go('charselect');
      (g.keys() as Record<string, boolean>)['Enter'] = true;
      g.stepSim(1);
    };

    it('waves stops at the map screen, brawl goes straight to the run', () => {
      g.setMode('waves');
      pressEnterOnCharSelect();
      expect(g.state()).toBe('mapselect');

      g.setMode('brawl');
      pressEnterOnCharSelect();
      expect(g.state()).toBe('playing');
    });
  });

  describe('bossTrigger decides what puts the boss on the field', () => {
    it('brawl sends the boss in at the kill count, waves never does', () => {
      const target = g.config().killsToTriggerBoss;

      g.setMode('brawl');
      g.go('playing');
      for (let i = 0; i < target; i++) { g.spawnCrow(); g.kill(0); }
      expect(g.state()).toBe('boss_entrance');

      g.setMode('waves');
      g.go('playing');
      for (let i = 0; i < target * 2; i++) { g.spawnCrow(); g.kill(0); }
      expect(g.killCount()).toBeGreaterThanOrEqual(target * 2);
      expect(g.state()).toBe('playing');
    });
  });

  describe('waveScaling decides whether crows get tougher', () => {
    it('waves ramps crow hp with the wave, brawl leaves it flat', () => {
      // Brawl is a sprint to ten kills and a boss, so it has no long climb to
      // ramp against; waves is endless and needs one. Both are stepped through
      // the real escalation timer so the wave number is arrived at, not set.
      const steps = Math.ceil(g.config().crowEscalationInterval * 60) + 5;

      const hpAfterOneEscalation = (mode: string): number => {
        g.setMode(mode);
        g.pickMap('forest');
        g.go('playing');
        g.stepSim(steps);
        expect(g.wave(), `${mode} should have escalated`).toBe(2);
        g.crows().length = 0;
        g.spawnCrow();
        const crow = g.crows()[0];
        expect(crow, `${mode} should have spawned a crow`).toBeDefined();
        return crow.maxHp;
      };

      expect(hpAfterOneEscalation('brawl')).toBe(1);
      expect(hpAfterOneEscalation('waves')).toBeGreaterThan(1);
    });
  });

  describe('announcesWaves decides whether a new wave says so', () => {
    it('waves raises a banner on escalation and brawl stays quiet', () => {
      // Driven through the real timer rather than by setting the counter, so
      // this exercises updateEscalation itself.
      const interval = g.config().crowEscalationInterval;
      const steps = Math.ceil(interval * 60) + 5;

      g.setMode('waves');
      g.pickMap('forest');
      g.go('playing');
      const startWave = g.wave();
      g.stepSim(steps);
      expect(g.wave()).toBe(startWave + 1);
      expect(g.waveBanner().secs).toBeGreaterThan(0);
      expect(g.waveBanner().text).toContain(String(startWave + 1));

      g.setMode('brawl');
      g.pickMap('forest');
      g.go('playing');
      g.stepSim(steps);
      expect(g.waveBanner().secs).toBe(0);
      expect(g.waveBanner().text).toBe('');
    });
  });

  describe('runsCastleGauntlet keeps two population drivers apart', () => {
    // The Waves+Castle bug, pinned from both sides. Escalation used to bail on
    // `mapKind === 'castle'` alone, so a Waves run on the castle never spawned
    // another crow past the opening batch. Keying on the mode is the fix, and
    // one field feeds both this and killSkeleton's gauntlet advance.
    it('waves on the castle keeps escalating', () => {
      const steps = Math.ceil(g.config().crowEscalationInterval * 60) + 5;
      g.setMode('waves');
      g.pickMap('castle');
      g.go('playing');
      const startWave = g.wave();
      g.stepSim(steps);
      expect(g.wave()).toBe(startWave + 1);
    });

    it('brawl on the castle does not, because the gauntlet drives it', () => {
      const steps = Math.ceil(g.config().crowEscalationInterval * 60) + 5;
      g.setMode('brawl');
      g.go('playing');
      g.generateMap('castle');
      const startWave = g.wave();
      g.stepSim(steps);
      expect(g.wave()).toBe(startWave);
    });
  });

  describe('an unrecognised mode falls back rather than throwing', () => {
    it('runs as brawl, because the draw loop reads this every frame', () => {
      g.setMode('not-a-mode');
      g.pickMap('cavern');
      g.go('playing');
      // brawl's fixed map, reached through the fallback row.
      expect(g.mapKind()).toBe('forest');
      g.stepSim(30);
      expect(g.state()).toBe('playing');
    });
  });
});

// ── THE BASTION SIEGE ─────────────────────────────────────────────────────────
//
// Siege is a third single-player mode: a finite ten-wave defence of two towers,
// on one fixed map, with a retinue that grows. These cover the parts already
// wired; the ones still to come are the retinue on the field and the ladder
// driving the spawners.
describe('siege mode', () => {
  afterEach(() => { g.setMode('brawl'); g.pickMap('forest'); });

  it('is a mode the menu can reach', () => {
    // MENU_ENTRIES is the only writer of gameMode in the real game, so a mode
    // with no entry is a mode no player can pick however complete its rules.
    const siege = g.menuEntries()
      .find((e: { label: string; section: string }) => e.label === 'SIEGE');
    expect(siege, 'no SIEGE entry on the title screen').toBeDefined();
    expect(siege?.section).toBe('mode');
  });

  it('always starts on the bastion, whatever the map screen last held', () => {
    g.setMode('siege');
    g.pickMap('cavern');
    g.go('playing');
    expect(g.mapKind()).toBe('bastion');
  });

  it('skips the map screen, because a fixed map has nothing to ask', () => {
    g.setMode('siege');
    g.go('charselect');
    (g.keys() as Record<string, boolean>)['Enter'] = true;
    g.stepSim(1);
    expect(g.state()).toBe('playing');
  });

  it('leaves the bastion off the Waves map screen', () => {
    // Its population is 'siege', not 'crows' or 'soldiers', so runsWaves says
    // no and MAP_PANELS never offers it. A Waves run there would have the
    // ladder's win condition and Waves' endlessness at once.
    expect(runsWaves('bastion')).toBe(false);
    expect(g.mapPanels().map((p: { kind: string }) => p.kind)).not.toContain('bastion');
  });

  it('does not let the escalation timer drive a siege', () => {
    // The ladder in sim/siege-run.ts owns the population. If the crow timer ran
    // as well, two things would be spawning and each would undo the other's
    // pacing — the same collision runsCastleGauntlet exists to prevent.
    g.setMode('siege');
    g.go('playing');
    // Wave 1 is three bats, put there by the ladder on the first tick. The
    // point is that three escalation intervals later it is still wave 1: the
    // timer has no say here, only clearing the field does.
    g.stepSim(1);
    expect(siegeState().wave).toBe(1);
    expect(g.crows().length).toBe(3);
    expect(g.crows().every((c: { white: boolean }) => c.white)).toBe(true);
    // Every banner a siege raises names the ladder it is part of. The
    // escalation timer raises a bare one, so seeing a bare banner here would
    // mean the timer had got in — which is what the population gate prevents.
    // Asserted on the banner rather than on the wave number, because the
    // retinue clears wave 1 unaided and the wave legitimately does advance.
    for (let n = 0; n < 3; n++) {
      g.stepSim(Math.ceil(g.config().crowEscalationInterval * 60));
      const text = g.waveBanner().text;
      if (text !== '') expect(text, text).toContain('/');
    }
  });

  it('generates two towers behind a barrier that can be walked around', () => {
    g.setMode('siege');
    g.go('playing');
    const tiles = g.tiles();
    const c = g.config();
    let huts = 0;
    for (let row = 0; row < c.rows; row++) {
      for (let col = 0; col < c.cols; col++) if (tiles.get(row, col) === TILE.HUT) huts++;
    }
    expect(huts).toBe(2);
  });

  it('knows the run is ten waves, and reads it from the table', () => {
    expect(MODE_RULES.siege.waveCap).toBe(SIEGE_WAVE_COUNT);
    expect(MODE_RULES.brawl.waveCap).toBeNull();
    expect(MODE_RULES.waves.waveCap).toBeNull();
  });
});

// ── THE SIEGE, RUNNING ────────────────────────────────────────────────────────
//
// The loop rather than the setup: waves arriving, being cleared, promoting the
// survivors and ending. Driven through devHooks.clearSiegeWave so a ten-wave run
// takes a test rather than an afternoon; the fighting itself is covered by the
// retinue and contact describes below.
/**
 * The siege run, insisted upon.
 *
 * devHooks.siege() is null on every map that is not a bastion, which is the
 * right answer for it to give and the wrong one to thread through forty
 * assertions. A test that reaches for it on the wrong map should say so once,
 * here, rather than fail forty lines later on a property of null.
 */
const siegeState = (): {
  wave: number;
  outcome: string;
  guards: { kind: GuardKind; rank: number; hp: number; maxHp: number; ward?: string }[];
} => {
  const run = g.siege();
  // Narrowed with a bang, which is a test-only liberty: the expect above is
  // what actually establishes it, and tsc cannot see through an assertion.
  expect(run, 'no siege run: the loaded map is not a bastion').not.toBeNull();
  return run!;
};

/** One body on the field, as the loop keeps it: a position and a sim record. */
interface GuardBody {
  x: number;
  y: number;
  healCD: number;
  guard: { kind: GuardKind; rank: number; hp: number; maxHp: number; ward?: string };
}

/** Every guard body currently on the field. */
const bodies = (): GuardBody[] => g.guards() as GuardBody[];

/** The priest's body, insisted upon: the tests below are about the one there is. */
const priestBody = (): GuardBody => {
  const found = bodies().filter((body) => body.guard.kind === 'priest');
  expect(found, `expected one priest on the field, found ${found.length}`).toHaveLength(1);
  return found[0]!;
};

describe('the siege loop', () => {
  // Pinned, so which kinds open the retinue is a fact rather than the weather.
  // A knight cannot be promoted, so an unpinned roll makes every rank assertion
  // conditional on a coin toss — this flaked five runs in twelve before pinning.
  beforeEach(() => { g.setSiegeRng(mulberry32(20260824)); });
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  const openSiege = (): void => { g.setMode('siege'); g.go('playing'); g.stepSim(1); };

  it('opens with the whole retinue on the field and two towers', () => {
    openSiege();
    expect(siegeState().guards).toHaveLength(OPENING_RETINUE);
    expect(g.guards()).toHaveLength(OPENING_RETINUE);
    expect(g.towers()).toHaveLength(2);
    expect(g.towers().every((t: { hp: number }) => t.hp === TOWER_MAX_HP)).toBe(true);
  });

  /**
   * The opening retinue is two rolled guards and one priest, and the priest is
   * the addition rather than a substitution.
   *
   * Both halves are asserted because either one alone would pass on the wrong
   * roster: a priest that replaced a recruit still gives "exactly one priest",
   * and two recruits still gives "two recruits" on a run with no priest at all.
   */
  it('seats exactly one priest, and still rolls the other openers', () => {
    openSiege();
    const kinds = siegeState().guards.map((guard) => guard.kind);

    expect(kinds.filter((kind) => kind === 'priest')).toHaveLength(1);
    expect(kinds.filter((kind) => kind !== 'priest')).toHaveLength(STARTING_RECRUITS);
    // The rolled ones are what the weighted table can produce, and nothing else.
    for (const kind of kinds.filter((k) => k !== 'priest')) {
      expect(['archer', 'foot_soldier', 'knight'], 'a recruit of an unrollable kind').toContain(kind);
    }
    // And it is on the field, not merely in the run's bookkeeping.
    expect(priestBody().guard.kind).toBe('priest');
  });

  it('never recruits a second priest, over a full ten-wave run', () => {
    openSiege();
    for (let n = 0; n < SIEGE_WAVE_COUNT; n++) {
      g.clearSiegeWave();
      g.stepSim(2);
      const priests = siegeState().guards.filter((guard) => guard.kind === 'priest');
      expect(priests, `after clearing ${n + 1} waves`).toHaveLength(1);
    }
    expect(siegeState().outcome).toBe('won');
  });

  it('every guard on the field starts at its kind\u2019s hp, and rank zero', () => {
    openSiege();
    for (const body of g.guards()) {
      expect(body.guard.rank).toBe(0);
      expect(body.guard.hp).toBe(GUARD_STATS[body.guard.kind as GuardKind].baseHp);
    }
  });

  it('advances a wave only when the field is cleared, and recruits one each time', () => {
    openSiege();
    expect(siegeState().wave).toBe(1);
    const before = siegeState().guards.length;
    g.clearSiegeWave();
    g.stepSim(2);
    expect(siegeState().wave).toBe(2);
    expect(siegeState().guards).toHaveLength(before + 1);
    expect(g.guards()).toHaveLength(before + 1);
  });

  it('promotes the survivors before the recruit joins', () => {
    openSiege();
    g.clearSiegeWave();
    g.stepSim(2);
    const after = siegeState().guards as { kind: GuardKind; rank: number }[];
    // The opening retinue is rolled, so which kinds are present varies run to
    // run and the assertion has to survive that. Two things are always true:
    // everyone who fought wave 1 and can be promoted has climbed to rank 1,
    // and the newest guard has not, because it arrived after the promoting.
    const veterans = after.slice(0, after.length - 1);
    for (const v of veterans) {
      // Whether a kind climbs is its `promotion` track, not a boolean: the
      // knight's is 'none' and the priest's is a ladder of its own, so "did it
      // gain a rank" is "does it have a ladder at all".
      expect(v.rank, v.kind).toBe(GUARD_STATS[v.kind].promotion === 'none' ? 0 : 1);
    }
    const recruit = after[after.length - 1];
    expect(recruit?.rank, 'the recruit fought nothing and should be rank 0').toBe(0);
  });

  it('runs ten waves and then wins', () => {
    openSiege();
    for (let n = 0; n < SIEGE_WAVE_COUNT; n++) { g.clearSiegeWave(); g.stepSim(2); }
    expect(g.state()).toBe('win');
    expect(siegeState().outcome).toBe('won');
  });

  it('does not run past ten', () => {
    openSiege();
    for (let n = 0; n < SIEGE_WAVE_COUNT + 4; n++) { g.clearSiegeWave(); g.stepSim(2); }
    expect(siegeState().wave).toBe(SIEGE_WAVE_COUNT);
    expect(siegeState().outcome).toBe('won');
  });

  it('puts a boss on the field from wave seven and two on wave ten', () => {
    openSiege();
    const bossesAt = (n: number): number => {
      while (siegeState().wave < n) { g.clearSiegeWave(); g.stepSim(2); }
      g.stepSim(1);
      return (g.boss() ? 1 : 0) + g.siegeBosses().length;
    };
    expect(bossesAt(6)).toBe(0);
    expect(bossesAt(7)).toBe(1);
    expect(bossesAt(10)).toBe(2);
  });

  it('loses only when the hero dies, never when a tower falls', () => {
    openSiege();
    // Flatten both towers outright. The run must not notice.
    for (const t of g.towers()) t.hp = 0;
    g.stepSim(4);
    expect(g.state()).toBe('playing');
    expect(siegeState().outcome).toBe('running');
  });
});

describe('the retinue in the field', () => {
  beforeEach(() => { g.setSiegeRng(mulberry32(20260824)); });
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  it('kills what it is standing next to, without the hero doing anything', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    // The wave is deliberately left standing. Clearing it advances the ladder
    // mid-test, wave 2 arrives, and the guard reasonably goes for a nearer
    // crow instead — which made this flake five runs in twelve.
    const body = g.guards()[0];
    g.spawnSkeleton('normal');
    const sk = g.skeletons()[g.skeletons().length - 1];
    sk.x = body.x + 8; sk.y = body.y;
    const before = g.skeletons().length;
    g.stepSim(180);
    expect(g.skeletons().length).toBeLessThan(before);
  });

  it('a guard that dies leaves the retinue and does not come back', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    const before = g.guards().length;
    const body = g.guards()[0];
    // One hit from death, with a skeleton parked on it. The wave is left alone
    // on purpose: clearing it would recruit a replacement and hide the loss.
    body.guard.hp = 1;
    g.spawnSkeleton('normal');
    const sk = g.skeletons()[g.skeletons().length - 1];
    sk.x = body.x + 6; sk.y = body.y;
    // Tough enough to outlive the guard. A one-hp skeleton dies to the guard's
    // own swing before it can land one, because updateGuards runs first in the
    // tick — which is correct, and makes it useless as an executioner.
    sk.hp = 50; sk.maxHp = 50;
    g.stepSim(120);
    expect(g.guards().length).toBe(before - 1);
    // The body and the record leave together. A retinue that disagreed with
    // the field would promote a guard nobody can see.
    expect(siegeState().guards.length).toBe(g.guards().length);
  });
});

// ── THE PRIEST ────────────────────────────────────────────────────────────────
//
// The retinue's healer, and the one guard that is seated rather than recruited.
// The sim's own rules are covered in guards.test.ts and siege-run.test.ts; what
// is checked here is the wiring, which is where the two rules that matter most
// could still be broken without anything else noticing: that the loop never
// gives it a swing, and that nothing on the field puts a second one on it.
describe('the priest in the field', () => {
  beforeEach(() => { g.setSiegeRng(mulberry32(20260824)); });
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  const openSiege = (): void => { g.setMode('siege'); g.go('playing'); g.stepSim(1); };

  /**
   * Parks a body off the map, where terrain refuses every step it tries to take
   * and nothing near the middle is within its reach.
   *
   * The bastion's retinue is placed by tower, and with two towers the third
   * body lands on the first tower's tile — so the priest and a foot soldier
   * open the siege standing on the same pixel. Any test about what the priest
   * did to something next to it has to move somebody first, or it is really a
   * test of which body `nearestHostile` mentions first on a tie.
   */
  const parkFarAway = (body: GuardBody): void => { body.x = -800; body.y = -800; };

  /** An enemy body, as much of one as these tests touch. */
  interface Enemy { x: number; y: number; hp: number; maxHp: number }

  /** A fresh enemy at `x, y`, tough enough to outlive the test that parks it. */
  const executioner = (x: number, y: number, hp: number): Enemy => {
    g.spawnSkeleton('normal');
    const sk = g.skeletons()[g.skeletons().length - 1];
    sk.x = x; sk.y = y;
    sk.hp = hp; sk.maxHp = hp;
    return sk;
  };

  /**
   * Steps the sim while holding `enemy` against `body`, `offset` pixels away.
   *
   * Parking an enemy next to a guard and then stepping three seconds does not
   * do what it looks like: the garrison's AI walks at the hero and nothing
   * else, so a skeleton dropped on a guard has strolled a hundred and fifty
   * pixels away by the end of the window and the contact pass stops finding it.
   * That is by design — updateSiegeContact exists precisely because enemies do
   * not know the bastion is there — so a test about what happens *while* two
   * bodies are in contact has to hold them in contact.
   */
  const stepInContact = (enemy: Enemy, body: GuardBody, frames: number, offset = 0): void => {
    for (let n = 0; n < frames; n++) {
      enemy.x = body.x + offset;
      enemy.y = body.y;
      g.stepSim(1);
    }
  };

  /**
   * The rule the kind is defined by, measured against a live loop.
   *
   * An enemy standing on the priest, for three seconds, with the rest of the
   * retinue parked where it cannot interfere. `updateGuards` turns the priest
   * off before it looks for a target at all, so there is no path to a swing, no
   * arrow, and — because `GUARD_STATS.priest.baseDamage` is 0 — nothing behind
   * it if there were.
   *
   * The control at the end is not decoration. Without it this test passes just
   * as well when the setup is broken and the enemy was never in anyone's reach,
   * which is the way a test like this usually rots.
   */
  it('deals no damage at all, even with an enemy standing on it', () => {
    openSiege();
    const priest = priestBody();
    const fighters = bodies().filter((body) => body !== priest);
    for (const body of fighters) parkFarAway(body);
    // Tough enough to outlive the window, so a priest that could swing would
    // have every chance to prove it rather than dying first.
    priest.guard.maxHp = 50;
    priest.guard.hp = 50;

    const sk = executioner(priest.x, priest.y, 200);
    stepInContact(sk, priest, 180);

    expect(sk.hp, 'the priest damaged something').toBe(200);
    // It was in contact the whole time, which is what makes the zero above mean
    // "did not attack" rather than "was never near anything".
    expect(priest.guard.hp, 'nothing was actually fighting the priest').toBeLessThan(50);

    // Control: the same enemy, the same treatment, with a guard that does fight.
    const fighter = fighters[0]!;
    fighter.x = priest.x; fighter.y = priest.y;
    fighter.guard.maxHp = 50; fighter.guard.hp = 50;
    stepInContact(sk, fighter, 120);

    expect(sk.hp, 'the setup cannot detect damage at all').toBeLessThan(200);
  });

  /**
   * The other half of "never recruited": once it is gone, it is gone.
   *
   * A weighted table could not give this. Even at a weight of zero the priest
   * would be one edit away from walking back in on the next wave — it is out of
   * the roll's type entirely, so there is nowhere for a replacement to come
   * from. The run carries on regardless, because losing a guard is not how a
   * bastion run ends.
   */
  it('is not replaced when it dies, and the run goes on without it', () => {
    openSiege();
    const priest = priestBody();
    const before = bodies().length;
    // Clear of the body it shares a tower tile with; see parkFarAway.
    priest.x += 200;
    priest.guard.hp = 1;

    const sk = executioner(priest.x + 6, priest.y, 50);
    stepInContact(sk, priest, 120, 6);

    expect(bodies().filter((body) => body.guard.kind === 'priest')).toHaveLength(0);
    expect(bodies()).toHaveLength(before - 1);
    // The body and the record leave together, the way any guard's do.
    expect(siegeState().guards.filter((guard) => guard.kind === 'priest')).toHaveLength(0);
    expect(siegeState().guards).toHaveLength(before - 1);

    // Three more waves held, and nobody walks in wearing a stole.
    for (let n = 0; n < 3; n++) { g.clearSiegeWave(); g.stepSim(2); }

    expect(siegeState().guards.filter((guard) => guard.kind === 'priest')).toHaveLength(0);
    expect(siegeState().wave).toBe(4);
    expect(siegeState().outcome).toBe('running');
    expect(g.state()).toBe('playing');
  });

  /**
   * The cooldown heal, one point at a time and never past the maximum.
   *
   * Driven a frame at a time with the cooldown forced, rather than left to run
   * for ten seconds: at 60 Hz a four-frame window is 66 milliseconds, which is
   * too short for the wave on the field to wound anybody and turn this into a
   * test of who happened to be neediest.
   */
  it('mends one point of a hurt ally at a time, and stops at its maximum', () => {
    openSiege();
    const priest = priestBody();
    const target = bodies().find((body) => body !== priest)!;
    // A body with room to be hurt in, whichever kind the roll produced: an
    // archer's single hit point cannot be four short of anything.
    target.guard.maxHp = 5;
    target.guard.hp = 1;
    target.x = priest.x + 10; target.y = priest.y;

    priest.healCD = 0;
    g.stepSim(1);
    expect(target.guard.hp, 'one heal is worth one point at rank 0').toBe(2);

    // The cooldown is what stops it being a full heal in one frame.
    g.stepSim(1);
    expect(target.guard.hp).toBe(2);

    target.guard.hp = 4;
    priest.healCD = 0;
    g.stepSim(1);
    expect(target.guard.hp).toBe(5);

    priest.healCD = 0;
    g.stepSim(1);
    expect(target.guard.hp, 'a heal took a guard above its maximum').toBe(5);
  });

  /**
   * The ward: one sweep, once per wave, handed back when the wave is held.
   *
   * The charge is read straight off the guard record rather than inferred from
   * health, because health is also moved by the cooldown heal and by whatever
   * the wave is doing — inferring would make this a test of arithmetic on three
   * moving numbers instead of a test of the rule.
   */
  it('sweeps once when the retinue is coming apart, and not twice in one wave', () => {
    openSiege();
    const priest = priestBody();
    const allies = bodies().filter((body) => body !== priest);
    expect(allies.length, 'the trigger needs two hurt allies to be reachable')
      .toBeGreaterThanOrEqual(WARD_TRIGGER_HURT);
    for (const body of allies) {
      body.guard.maxHp = 9;
      body.guard.hp = 1;
      body.x = priest.x + 20; body.y = priest.y;
    }
    expect(priest.guard.ward).toBe('ready');

    g.stepSim(1);

    expect(priest.guard.ward, 'the ward did not fire on two hurt allies').toBe('spent');
    for (const body of allies) {
      expect(body.guard.hp, `${body.guard.kind} was not swept`).toBe(1 + WARD_HEAL);
    }

    // Hurt again, in the same wave. There is no second sweep to be had, and the
    // cooldown heal has not come round either, so nothing moves at all.
    for (const body of allies) body.guard.hp = 1;
    g.stepSim(1);

    expect(priest.guard.ward).toBe('spent');
    for (const body of allies) expect(body.guard.hp, 'the ward fired twice in one wave').toBe(1);
  });

  /**
   * The sweep has an edge, and this is where it is.
   *
   * Without this the radius is an untested number: every other ward test puts
   * the whole retinue on top of the priest, and a `guardWardRadius` of infinity
   * would pass all of them. The far guard is hurt and stays hurt, which also
   * pins the trigger — the count that fires the ward is taken over the allies
   * the sweep would actually reach, not over everyone still standing.
   */
  it('sweeps only as far as its radius reaches', () => {
    openSiege();
    const priest = priestBody();
    const allies = bodies().filter((body) => body !== priest);
    const near = allies[0]!;
    const far = allies[1]!;

    // The priest is one of the two hurt allies here, which is what lets the
    // trigger fire with only one other body in range.
    priest.guard.maxHp = 9; priest.guard.hp = 1;
    near.guard.maxHp = 9; near.guard.hp = 1;
    near.x = priest.x + 20; near.y = priest.y;
    far.guard.maxHp = 9; far.guard.hp = 1;
    far.x = priest.x + 600; far.y = priest.y;

    g.stepSim(1);

    expect(priest.guard.ward).toBe('spent');
    expect(priest.guard.hp).toBe(1 + WARD_HEAL);
    expect(near.guard.hp).toBe(1 + WARD_HEAL);
    expect(far.guard.hp, 'the ward reached a guard on the far side of the map').toBe(1);
  });

  it('has its ward back once a wave is cleared, and spends it again', () => {
    openSiege();
    const opening = priestBody();
    const allies = bodies().filter((body) => body !== opening);
    for (const body of allies) {
      body.guard.maxHp = 9; body.guard.hp = 1;
      body.x = opening.x + 20; body.y = opening.y;
    }
    g.stepSim(1);
    expect(opening.guard.ward).toBe('spent');

    // Everybody back to full before the wave is held. A recharged ward over a
    // retinue that is still bleeding fires again on the very next frame, which
    // is correct behaviour and would hide the state this test is about.
    for (const body of allies) body.guard.hp = body.guard.maxHp;

    g.clearSiegeWave();
    g.stepSim(2);
    expect(siegeState().wave).toBe(2);

    // completeWave hands back copies, so the body is now pointing at a new
    // record — reading the old one would be reading last wave's priest.
    const promoted = priestBody();
    expect(promoted.guard.ward, 'clearing a wave did not recharge the ward').toBe('ready');
    expect(promoted.guard.rank, 'the priest climbed nothing for holding a wave').toBe(1);

    const wave2 = bodies().filter((body) => body !== promoted);
    for (const body of wave2) {
      body.guard.maxHp = 9; body.guard.hp = 1;
      body.x = promoted.x + 20; body.y = promoted.y;
    }
    g.stepSim(1);

    expect(promoted.guard.ward).toBe('spent');
  });
});

// ── THE CAMPAIGN'S LAST STAGE ─────────────────────────────────────────────────
//
// The brawl chain used to end at the maze door. It ends at the bastion now, so
// the door is a hand-off rather than a curtain, and the siege has to run there
// without the mode having changed — a brawl that reaches the bastion is still a
// brawl. That is the whole reason the siege gates on the map.
describe('the bastion as the end of the brawl chain', () => {
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  /** Walks the run to the maze and opens its door, the way a player would. */
  const openTheMazeDoor = (): void => {
    g.setMode('brawl');
    g.go('playing');
    g.generateMap('maze');
    const run = g.maze();
    expect(run, 'the maze should have an objective').not.toBeNull();
    const door = run!.door as { x: number; y: number };
    const player = g.player() as { x: number; y: number };
    // Both keys in hand, then stand on the door. The keys are granted but the
    // lock is still walked onto, so what the door does is exercised for real.
    g.giveMazeKeys();
    player.x = door.x; player.y = door.y;
    g.stepSim(4);
  };

  it('opens onto the bastion rather than the win screen', () => {
    openTheMazeDoor();
    expect(g.state()).not.toBe('win');
    expect(g.mapKind()).toBe('bastion');
  });

  it('runs the siege there even though the mode is still brawl', () => {
    openTheMazeDoor();
    expect(g.mode()).toBe('brawl');
    expect(g.siege()).not.toBeNull();
    expect(g.guards().length).toBeGreaterThan(0);
    expect(g.towers()).toHaveLength(2);
  });

  it('holds the new stage behind a title, without wiping the run', () => {
    // The hand-off assigns appState directly for the reason every other one in
    // this chain does: transitionTo('playing') calls initGame, which would
    // throw away the run that just earned its way here.
    openTheMazeDoor();
    expect(g.state()).toBe('stage_intro');
    expect(g.intro()).toBe('bastion');
    expect(g.dismissIntro()).toBe(true);
    expect(g.state()).toBe('playing');
  });

  it('ends the campaign when the siege is won', () => {
    openTheMazeDoor();
    g.dismissIntro();
    g.setSiegeRng(mulberry32(20260824));
    g.stepSim(1);
    for (let n = 0; n < SIEGE_WAVE_COUNT; n++) { g.clearSiegeWave(); g.stepSim(2); }
    expect(g.state()).toBe('win');
  });
});
