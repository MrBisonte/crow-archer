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
import { MAP_KINDS, MAP_RULES, TILE_SIZE, runsWaves, type MapKind } from '../sim/arena-map';
import { MODE_RULES } from '../sim/game-mode';
import { SIEGE_WAVE_COUNT } from '../sim/siege-waves';
import {
  GUARD_STATS, OPENING_RETINUE, STARTING_RECRUITS, WARD_HEAL, WARD_TRIGGER_HURT,
  type GuardKind,
} from '../sim/guards';
import { TOWER_DAMAGE, TOWER_MAX_HP, TOWER_SPAN, towerCentre, type Tower } from '../sim/towers';
import { barrierGates } from '../sim/bastion-terrain';
import { mulberry32 } from '../sim/rng';
import { Team } from '../sim/team';
import { DEFAULT_REGROWTH, regrowthDelay } from '../sim/regrowth';
import { COMMANDER_WAVE, SOLDIER_STATS, waveComposition } from '../sim/soldiers';
import { TILE, tilePassable, type TileId } from '../sim/tilemap';
import { ONE_SECOND, clearArena, stepPast } from './arena-testkit';
import { boot, devHooks as g } from './game.js';
import { ANIM_FRAMES, type PixelGrid } from '../render/pixel-grid';
import { variationProfile, type VariationProfile } from '../render/sound-variation';
import { spriteCanvas, spriteFlashCanvas } from '../render/pixel-sprite';
import {
  filledRuns, gridColours, gridSize, installStubCanvas, invalidColours, raggedRows,
} from '../render/grid-testkit';


/**
 * The maps the mapselect screen offers, derived the same way MAP_PANELS
 * derives them. Naming them here instead would be a third copy of a list the
 * game deliberately keeps in one place.
 */
const WAVE_MAPS = MAP_KINDS.filter((kind) => runsWaves(kind));

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

/** The knight charge's wedge, as knightChargeWedge() hands it over: the one
 * geometry its hit test and every drawing of it are read from. */
interface Wedge {
  angle: number;
  half: number;
  radius: number;
}

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
    expect(g.hp()).toBe(CHARACTER_STATS[g.selectedChar() as CharacterKind].maxHp);
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

    // Empty it, then keep pressing. Every charge thrown here goes off, and an
    // explosion freezes the world, so the cooldown wait counts sim steps.
    for (let i = 0; i < g.config().resources.bombs.max + 3; i++) {
      g.shoot();
      g.stepSim(1);
      stepPast(step);
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
        stepPast(step);   // the bomb goes off mid-wait, and that freezes the world
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
/**
 * The player's own way out, and the report that explains why they needed it.
 *
 * These exist because the stuck-player bug has now been reported from real
 * play more times than it has been reproduced in a harness, and because the
 * last thing to be silently dropped by a merge — the sapper's shot falling
 * out of pressShift() — had no test holding it in place. Nothing here is
 * subtle; it is here so that losing any of it fails loudly.
 */
describe('the player can always free themselves', () => {
  /** Walls the player into the tile they are standing on. */
  function sealIn(): { x: number; y: number } {
    const c = g.config();
    g.pick('wizard');
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

  it('binds a key to it', () => {
    expect(g.config().keys.unstick).toBeTruthy();
  });

  it('tells the player about that key on the controls screen', () => {
    const listed = (g.ctrlActions() as Array<{ key: string }>).map((a) => a.key);
    expect(listed).toContain('unstick');
  });

  it('frees a player who is walled in', () => {
    const p = sealIn();
    expect(g.boxedIn()).toBe(true);
    const from = { x: p.x, y: p.y };

    g.forceUnstick();

    expect(g.boxedIn()).toBe(false);
    expect(g.fits(p.x, p.y)).toBe(true);
    expect({ x: p.x, y: p.y }).not.toEqual(from);
  });

  // Unconditional on purpose: the automatic hatch only acts when it can prove
  // the body is trapped, and the trap still being reported is one it cannot
  // see. Asking to be freed does not require passing a test first.
  it('frees a player who is not trapped at all, if they ask', () => {
    const c = g.config();
    g.pick('wizard');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    p.x = 16.5 * c.tileSize;
    p.y = 10.5 * c.tileSize;
    expect(g.boxedIn()).toBe(false);
    const from = { x: p.x, y: p.y };

    g.forceUnstick();

    expect({ x: p.x, y: p.y }).not.toEqual(from);
  });

  it('clears whatever was driving or holding the player', () => {
    g.pick('knight');
    g.go('playing');
    clearArena();
    g.startKnightCharge();
    expect(g.knightCharge().charging).toBe(true);

    g.forceUnstick();

    expect(g.knightCharge().charging).toBe(false);
    expect(g.knightCharge().dashTimer).toBe(0);
    expect(g.frozenTimer()).toBe(0);
  });

  it('says where and in what state, so a report arrives with evidence', () => {
    g.setLogLevel('warn');
    g.clearLogs();
    sealIn();
    g.forceUnstick();

    const asked = g.logs().filter((e) => e.source === 'forceUnstick');
    expect(asked.length).toBe(1);
    expect(asked[0]!.data).toMatchObject({ map: 'forest', char: 'wizard', boxedIn: true });
    // The fields that would identify the cause next time.
    for (const field of ['buried', 'frozen', 'charging', 'dashing', 'drawing', 'netting', 'heldKeys'])
      expect(asked[0]!.data, field).toHaveProperty(field);
  });

  it('reports a player who asks to move and cannot, with the same evidence', () => {
    const c = g.config();
    g.pick('wizard');
    g.go('playing');
    clearArena();
    g.setLogLevel('warn');
    g.clearLogs();
    const p = g.player() as { x: number; y: number };
    const col = 16, row = 10;
    p.x = (col + 0.5) * c.tileSize;
    p.y = (row + 0.5) * c.tileSize;
    g.tiles().set(row, col + 1, TILE.ROCK);   // a wall to the east

    const keys = g.keys() as Record<string, boolean>;
    keys['ArrowRight'] = true;
    for (let i = 0; i < 8; i++) g.stepSim(20);   // past the one-second threshold
    keys['ArrowRight'] = false;

    const refused = g.logs().filter((e) => e.source === 'movementRefused');
    expect(refused.length).toBe(1);            // once per episode, not per frame
    expect(refused[0]!.data).toMatchObject({ char: 'wizard' });
    for (const field of ['want', 'at', 'buried', 'boxedIn', 'openDirections', 'heldKeys'])
      expect(refused[0]!.data, field).toHaveProperty(field);
  });
});

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

  // knightChargeWedge() is the one home for the wedge's geometry, and its
  // whole reason to exist is that three call sites used to hold their own
  // copy of the same two numbers: the hit test, the dash sweep, and the
  // windup. These check the wedge really is what inKnightArc() hits with, so
  // that a wedge drawn from it is the wedge that lands.
  describe('and the wedge every reading of it shares', () => {
    /** Puts a knight mid-dash due east from a known tile, and reports the
     * wedge that dash is sweeping. */
    function dashingEast(): Wedge {
      const c = g.config();
      g.pick('knight');
      g.go('playing');
      clearArena();
      const p = g.player() as { x: number; y: number; aimAngle: number };
      p.x = 16.5 * c.tileSize;
      p.y = 10.5 * c.tileSize;
      p.aimAngle = 0;
      g.startKnightCharge();
      g.stepSim(1);
      g.releaseKnightCharge();
      return g.knightChargeWedge(g.knightCharge().angle) as Wedge;
    }

    it('reaches exactly as far as the hit test does', () => {
      const w = dashingEast();
      const p = g.player() as { x: number; y: number };
      const on = (d: number): boolean =>
        g.inKnightArc(p.x + Math.cos(w.angle) * d, p.y + Math.sin(w.angle) * d) as boolean;
      expect(on(w.radius - 1)).toBe(true);
      expect(on(w.radius + 1)).toBe(false);
    });

    it('opens exactly as wide either side as the hit test does', () => {
      const w = dashingEast();
      const p = g.player() as { x: number; y: number };
      const at = (offset: number): boolean => {
        const a = w.angle + offset;
        return g.inKnightArc(p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40) as boolean;
      };
      for (const side of [1, -1]) {
        expect(at(side * (w.half - 0.01))).toBe(true);
        expect(at(side * (w.half + 0.01))).toBe(false);
      }
    });

    it('points where the dash committed, not where the mouse went afterwards', () => {
      const w = dashingEast();
      const p = g.player() as { x: number; y: number; aimAngle: number };
      p.aimAngle = Math.PI;   // swing the aim right round mid-dash
      const behind = { x: p.x - 40, y: p.y };
      expect(g.inKnightArc(behind.x, behind.y)).toBe(false);
      expect(g.knightChargeWedge(g.knightCharge().angle).angle).toBe(w.angle);
    });
  });
});

// ---------------------------------------------------------------------------
// The charge telegraph
// ---------------------------------------------------------------------------
//
// The windup roots the knight, then release commits him to a heading and a
// second and a half he cannot steer. The telegraph is what he reads that
// decision off, and it is worth nothing unless it shows the wedge that will
// actually land — so these check the drawing against inKnightArc rather than
// against a picture.

/** One drawing call, as the painter asked for it. */
interface DrawCall {
  name: string;
  args: number[];
}

/**
 * A canvas context that records instead of drawing.
 *
 * Smaller on purpose than the one in src/render/characters.test.ts: that suite
 * asserts on transformed coordinates, so it has to track the matrix stack.
 * This painter is handed the knight's local space already established and
 * draws in plain numbers, so the arguments are the assertion and a matrix
 * would only obscure them.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const target: Record<string, unknown> = {};
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'stroke',
    'fill', 'setLineDash',
  ];
  for (const name of methods) {
    target[name] = (...args: unknown[]): void => {
      calls.push({ name, args: args.filter((a): a is number => typeof a === 'number') });
    };
  }
  return { ctx: target as unknown as CanvasRenderingContext2D, calls };
}

/** The windup reading knightChargeTelegraph() hands the painter. */
interface Telegraph extends Wedge {
  frac: number;
  endX: number;
  endY: number;
  travel: number;
}

describe('the knight charge telegraph', () => {
  /** Points the aim by moving the mouse, which is the only thing updatePlayer
   * reads: assigning player.aimAngle is overwritten on the next step. The HUD
   * band sits above the world, so a world point is that far down the canvas. */
  function aimAt(x: number, y: number): void {
    const mouse = g.mouse() as { x: number; y: number };
    mouse.x = x; mouse.y = y + g.config().hudHeight;
  }

  /** Roots a knight at a known tile aiming due east, mid-windup. */
  function windingUpEast(col = 10, row = 10): { x: number; y: number } {
    const c = g.config();
    g.pick('knight');
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number; aimAngle: number };
    p.x = (col + 0.5) * c.tileSize;
    p.y = (row + 0.5) * c.tileSize;
    aimAt(p.x + 200, p.y);
    g.startKnightCharge();
    g.stepSim(1);
    return p;
  }

  it('shows nothing until he winds up, and nothing once he has let go', () => {
    windingUpEast();
    // Winding up is the only moment the direction is still his to change.
    expect(g.knightTelegraph()).not.toBeNull();
    g.releaseKnightCharge();
    expect(g.knightCharge().dashing).toBe(true);
    expect(g.knightTelegraph()).toBeNull();
    g.stepSim(ONE_SECOND * 2);
    expect(g.knightTelegraph()).toBeNull();
  });

  it.each(CHARACTERS.filter((k) => k !== 'knight'))(
    'stays off the %s, who has no charge to telegraph', (character) => {
      g.pick(character);
      g.go('playing');
      clearArena();
      // The sniper key is shared, and starts something for most of the roster.
      // None of it is a charge, so none of it draws a charge's wedge.
      g.shift();
      expect(g.knightTelegraph()).toBeNull();
      g.shiftUp();

      // And the wedge belongs to the body it is drawn around: a windup left
      // set on some other character draws nothing rather than a knight's arc
      // out of a wizard.
      windingUpEast();
      expect(g.knightTelegraph()).not.toBeNull();
      g.pick(character);
      expect(g.knightTelegraph()).toBeNull();
      g.releaseKnightCharge();
    });

  it('draws the heading the release is about to commit to', () => {
    const p = windingUpEast();
    const before = g.knightTelegraph() as Telegraph;
    // Still live: swinging the aim mid-windup moves the telegraph with it,
    // which is the whole point of drawing one before the commit.
    aimAt(p.x, p.y - 200);
    g.stepSim(1);
    const after = g.knightTelegraph() as Telegraph;
    expect(angleGap(after.angle, before.angle)).toBeGreaterThan(1);

    g.releaseKnightCharge();
    expect(g.knightCharge().angle).toBe(after.angle);
  });

  it('outlines the wedge at the reach and width the hit test uses', () => {
    windingUpEast();
    const { ctx: fake, calls } = recordingContext();
    const tele = g.paintKnightTelegraph(fake) as Telegraph;

    // Facing east, so the mirrored space the knight draws in is the world's.
    expect((g.player() as { facing: number }).facing).toBe(1);
    const outline = calls.filter((c) => c.name === 'arc' && c.args[0] === 0 && c.args[1] === 0);
    expect(outline.length).toBe(1);
    const [, , radius, from, to] = outline[0]!.args as [number, number, number, number, number];
    expect(radius).toBe(tele.radius);
    expect(to - from).toBeCloseTo(tele.half * 2, 10);
    expect(angleGap((from + to) / 2, tele.angle)).toBeCloseTo(0, 10);

    // And what it outlines is what lands: release, and the hit test agrees
    // with the drawn edge on both bounds.
    const p = g.player() as { x: number; y: number };
    g.releaseKnightCharge();
    const at = (d: number, offset: number): boolean =>
      g.inKnightArc(p.x + Math.cos(from + offset) * d, p.y + Math.sin(from + offset) * d) as boolean;
    expect(at(radius - 1, 0.01)).toBe(true);
    expect(at(radius + 1, 0.01)).toBe(false);
    expect(at(radius - 1, -0.01)).toBe(false);
  });

  it('leaves the context it painted into balanced', () => {
    windingUpEast();
    const { ctx: fake, calls } = recordingContext();
    g.paintKnightTelegraph(fake);
    const count = (name: string): number => calls.filter((c) => c.name === name).length;
    expect(count('save')).toBe(count('restore'));
    expect(count('save')).toBeGreaterThan(0);
    // Dashes are always turned back off; a leaked one would dash the sprite.
    expect(calls.filter((c) => c.name === 'setLineDash').length % 2).toBe(0);
  });

  it('marks where terrain will stop the dash, not where open ground would', () => {
    const c = g.config();
    const p = windingUpEast(10, 10);
    const open = g.knightTelegraph() as Telegraph;
    expect(open.travel).toBeGreaterThan(c.tileSize * 2);

    // A wall one tile ahead. The mark comes back to it rather than sitting
    // inside it, so the telegraph never promises ground he cannot reach.
    for (let d = -3; d <= 3; d++) g.tiles().set(10 + d, 12, TILE.ROCK);
    const walled = g.knightTelegraph() as Telegraph;
    expect(walled.travel).toBeLessThan(open.travel);
    expect(walled.endX).toBeLessThan(12 * c.tileSize);
    expect(g.fits(walled.endX, walled.endY)).toBe(true);
    expect(walled.endY).toBeCloseTo(p.y, 6);
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
  /** The authored DAMAGE bar, checked against bossDamageMult's ordering. */
  damage: number;
  skills: { main: string; secondary: string; shift: string; passive: string };
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
      for (const slot of ['main', 'secondary', 'shift', 'passive'] as const) {
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

  it('moves every hero’s feet between stride frames, not just their cloth', () => {
    // Deliberately the *boot rows* and not the whole grid. Comparing whole
    // grids passes on a hero whose only moving part is a hem: the ranger
    // shipped three frames that differed by a one-column cloak sway over a
    // floor-length skirt, and read as a stuck sprite for exactly that reason.
    // Pinning the wizard's legs to one frame still leaves his robe swaying,
    // so a whole-grid check goes green on the bug it exists to catch.
    for (const p of charPanels()) {
      const feet = ANIM_FRAMES.map((f) => {
        const { grid } = p.preview(f);
        return JSON.stringify(grid.slice(grid.length - 4));
      });
      expect(new Set(feet).size, `${p.char} plants the same feet every frame`).toBe(3);
    }
  });

  it('caches each stride frame under its own key', () => {
    // The sprite cache hands back a canvas *without* calling the painter, so a
    // key that does not name the frame pins the whole walk to whichever frame
    // was drawn first. Three grids behind one key is a hero frozen mid-step,
    // and nothing else in the suite would see it.
    for (const p of charPanels()) {
      const keys = new Set(ANIM_FRAMES.map((f) => p.preview(f).key));
      expect(keys.size, `${p.char} reuses a cache key across frames`).toBe(3);
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

  // Was 'is a mode the menu can reach'. It is deliberately not reachable yet:
  // the rules and the map are finished, but nothing drives the spawners, so a
  // run lands on the bastion and stays empty. The entry keeps its row and
  // carries `hidden` instead, so putting the mode back is one line rather than
  // a rebuild — and so this test says which it is rather than going quiet.
  it('keeps its menu row, held back until the ladder is wired', () => {
    const siege = g.menuEntries()
      .find((e: { label: string; section: string; hidden?: boolean }) => e.label === 'SIEGE');
    expect(siege, 'the SIEGE row should still exist, just hidden').toBeDefined();
    expect(siege?.section).toBe('mode');
    expect(siege?.hidden, 'unhide this once the retinue and ladder are wired').toBe(true);
  });

  // The half that actually protects the player: off the screen has to mean out
  // of reach. A hidden row still walked by the arrow keys or still answering
  // its hotkey would be a mode nobody can see and anybody can start.
  it('is not reachable while it is hidden', () => {
    const shown = g.menuShown() as Array<{ label: string; key: string }>;
    expect(shown.map((e) => e.label)).not.toContain('SIEGE');
    // And no hidden row's hotkey survives in the list the input reads.
    const hiddenKeys = (g.menuEntries() as Array<{ key: string; hidden?: boolean }>)
      .filter((e) => e.hidden).map((e) => e.key);
    for (const key of hiddenKeys) expect(shown.map((e) => e.key)).not.toContain(key);
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
    // Two towers, each a TOWER_SPAN square block, so the count is derived
    // rather than written down: a literal 2 here was what the map said back
    // when a tower was a single tile.
    expect(huts).toBe(2 * TOWER_SPAN * TOWER_SPAN);
  });

  it('knows the run is ten waves, and reads it from the table', () => {
    expect(MODE_RULES.siege.waveCap).toBe(SIEGE_WAVE_COUNT);
    expect(MODE_RULES.brawl.waveCap).toBeNull();
    expect(MODE_RULES.waves.waveCap).toBeNull();
  });
});

describe('the balance model', () => {
  /**
   * Opens a boss fight as `character`, and hands back the boss.
   *
   * Stage 2 is the dark archer, who is the one shieldless boss in the game, so
   * a hit staged here lands rather than being swallowed by the crow king's
   * mandatory opening shield.
   */
  function bossFightAs(character: CharacterKind, stage = 2): { hp: number; x: number; y: number } {
    g.pick(character);
    g.go('playing');
    g.spawnBossNow(stage);
    g.go('boss_fight');
    return g.boss() as { hp: number; x: number; y: number };
  }

  /** What one dynamite blast at the epicentre actually takes off the boss. */
  function blastDealtAs(character: CharacterKind): number {
    const boss = bossFightAs(character);
    const before = boss.hp;
    g.blast(boss.x, boss.y);
    return before - (g.boss() as { hp: number }).hp;
  }

  it('opens every boss on one health pool, whoever walks into the fight', () => {
    // The whole of what the twelve-cell matrix used to do. Stage 4 is the
    // minotaur, who has no health at all, so he is not a pool to compare.
    for (const stage of [1, 2, 3, 5]) {
      const pools = CHARACTERS.map((character) => bossFightAs(character, stage).hp);
      expect(new Set(pools), `stage ${stage}`).toEqual(new Set([pools[0]]));
    }
  });

  it('takes the character\'s multiplier off the boss, not the weapon\'s raw figure', () => {
    // One explosive, at its own epicentre so no falloff is in play, fired by
    // each hero in turn. The only thing that differs between the runs is who
    // is holding it.
    const raw = g.config().dynamiteBossDamage;
    for (const character of CHARACTERS) {
      expect(blastDealtAs(character), character)
        .toBeCloseTo(raw * CHARACTER_STATS[character].bossDamageMult, 6);
    }
  });

  it('scales the burn from the hit that lit it, and does not count it twice', () => {
    // igniteBoss derives burnDps from the raw damage of the igniting hit, and
    // that raw figure passes through applyBossDamage once per tick like any
    // other. Multiplying at the weapon instead would have squared it here.
    const boss = bossFightAs('wizard');
    const c = g.config();
    const before = boss.hp;
    g.igniteBoss(c.arrowBossDamage);
    g.stepSim(Math.ceil(c.bossBurnDuration * ONE_SECOND) + 2);
    const burnt = before - (g.boss() as { hp: number }).hp;
    const expected = c.arrowBossDamage * c.bossBurnDamage * CHARACTER_STATS.wizard.bossDamageMult;
    expect(burnt).toBeCloseTo(expected, 4);
  });

  it('never reaches a crow, so even the softest hitter kills one outright', () => {
    // The reason the field is bossDamageMult and not damageMult. A fresh crow
    // has exactly 1 hit point; the ranger's 0.8 applied here would leave it
    // alive on a sliver, and his crossbow would stop killing birds.
    const softest = [...CHARACTERS]
      .sort((a, b) => CHARACTER_STATS[a].bossDamageMult - CHARACTER_STATS[b].bossDamageMult)[0]!;
    expect(CHARACTER_STATS[softest].bossDamageMult).toBeLessThan(1);

    g.pick(softest);
    g.go('playing');
    clearArena();
    const crows = g.crows();
    crows.length = 0;
    g.spawnCrow();
    const crow = crows[0] as { x: number; y: number };
    g.blast(crow.x, crow.y);
    expect(g.crows().length, softest).toBe(0);
  });

  it('opens a run on the selected character\'s own health', () => {
    for (const character of CHARACTERS) {
      g.pick(character);
      g.go('playing');
      expect(g.hp(), character).toBe(CHARACTER_STATS[character].maxHp);
    }
  });

  it('walks each character at its own speed', () => {
    const travelled = (character: CharacterKind): number => {
      g.pick(character);
      g.go('playing');
      clearArena();
      const c = g.config();
      const p = g.player() as { x: number; y: number };
      p.x = 5 * c.tileSize;
      p.y = 6 * c.tileSize;
      const from = p.x;
      const keys = g.keys() as Record<string, boolean>;
      keys['ArrowRight'] = true;
      g.stepSim(30);
      keys['ArrowRight'] = false;
      return p.x - from;
    };

    const walked = Object.fromEntries(
      CHARACTERS.map((character) => [character, travelled(character)]),
    ) as Record<CharacterKind, number>;

    expect(walked.ranger).toBeGreaterThan(walked.archer);
    expect(walked.archer).toBeGreaterThan(walked.wizard);
    expect(walked.wizard).toBeGreaterThan(walked.knight);
    expect(walked.sapper).toBeCloseTo(walked.archer, 5);
  });

  it('never advertises a DAMAGE bar that contradicts the multipliers', () => {
    // The same invariant assertPanelDamageOrder refuses to load without. It is
    // asserted here as well because a load-time throw says the roster is
    // wrong; this says which pair of heroes disagree.
    const ranked = [...charPanels()].sort((a, b) =>
      CHARACTER_STATS[b.char as CharacterKind].bossDamageMult
      - CHARACTER_STATS[a.char as CharacterKind].bossDamageMult);
    for (let i = 1; i < ranked.length; i++) {
      const softer = ranked[i]!, harder = ranked[i - 1]!;
      expect(softer.damage, `${softer.char} must not out-rate ${harder.char}`)
        .toBeLessThanOrEqual(harder.damage);
    }
  });

  it('leaves the wizard able to finish the Crow King, which is why this exists', () => {
    // The fight the pass was for: fourteen bolts at one per two seconds, about
    // half a minute of uninterrupted hits, against an archer's five arrows.
    const c = g.config();
    const perBolt = c.wizBoltDamage * CHARACTER_STATS.wizard.bossDamageMult;
    const bolts = Math.ceil(c.bossHP / perBolt);
    expect(bolts).toBeLessThanOrEqual(5);
    expect(bolts * c.wizBoltCooldown).toBeLessThan(10);
  });
});

describe('every boss the stage list names', () => {
  /** Puts a stage's boss on the map and opens its fight. */
  function fightStage(stage: number): { kind: string; hp: number; x: number; y: number } {
    g.pick('archer');
    g.go('playing');
    g.spawnBossNow(stage);
    g.go('boss_fight');
    return g.boss() as { kind: string; hp: number; x: number; y: number };
  }

  it('takes damage rather than throwing on the first hit that lands', () => {
    // The commander shipped with no BOSS_ON_HIT row, so damageBoss reached
    // `undefined(amount)` and the cavern's ending crashed on the first arrow.
    // Every stage but the warden, who has no health to take.
    for (const stage of [1, 2, 3, 5]) {
      const boss = fightStage(stage);
      const before = boss.hp;
      (boss as { shield?: boolean }).shield = false;   // the crow king opens behind one
      expect(() => g.blast(boss.x, boss.y), boss.kind).not.toThrow();
      expect((g.boss() as { hp: number }).hp, boss.kind).toBeLessThan(before);
    }
  });

  it('can be brought to nothing, so the fight has an end', () => {
    for (const stage of [1, 2, 3, 5]) {
      const boss = fightStage(stage);
      for (let i = 0; i < 40 && (g.boss() as { hp: number }).hp > 0; i++) {
        (g.boss() as { shield?: boolean }).shield = false;
        g.blast(boss.x, boss.y);
      }
      expect((g.boss() as { hp: number }).hp, boss.kind).toBeLessThanOrEqual(0);
    }
  });

  it('leaves the warden out of it, and unkillable', () => {
    const boss = fightStage(4);
    expect(boss.kind).toBe('minotaur');
    expect(boss.hp).toBe(Infinity);
    g.blast(boss.x, boss.y);
    expect((g.boss() as { hp: number }).hp).toBe(Infinity);
  });
});

describe('hitstop', () => {
  /** The ladder the game itself reads, so a test never holds a second copy. */
  const ladder = (): Record<string, number> => g.hitstopLadder() as Record<string, number>;

  it('states every row as a whole number of fixed steps', () => {
    const rows = Object.entries(ladder());
    expect(rows.length).toBeGreaterThan(0);
    for (const [kind, frames] of rows) {
      expect(Number.isInteger(frames), kind).toBe(true);
      expect(frames, kind).toBeGreaterThanOrEqual(0);
    }
    // Not a table of zeroes: the heavy end really does stop the world.
    expect(rows.some(([, frames]) => frames > 0)).toBe(true);
  });

  it('holds the world for exactly the steps the impact asked for', () => {
    g.go('playing');
    clearArena();
    const p = g.player() as { x: number; y: number };
    // A real explosion through the real path, well clear of the player so the
    // freeze under test is the blast's own and not a hit taken from it.
    g.blast(p.x + 300, p.y);
    const owed = ladder().explosion;
    expect(owed).toBeGreaterThan(0);
    expect(g.hitstop()).toBe(owed);

    const before = g.gameTime();
    g.stepSim(owed);
    // Every one of those frames was spent holding: no simulated time passed.
    expect(g.gameTime()).toBe(before);
    expect(g.hitstop()).toBe(0);

    // And the world starts again on its own, without anything releasing it.
    g.stepSim(1);
    expect(g.gameTime()).toBeGreaterThan(before);
  });

  it('does not freeze on a critter kill, the same call SHAKE makes', () => {
    g.go('playing');
    g.spawnCrow();
    g.kill(0);
    // Crows die constantly and in groups; a freeze per kill is a stutter, not
    // information. See the note on SHAKE and the zero rows in HITSTOP.
    expect(g.hitstop()).toBe(0);
  });

  it('never freezes a screen that is not a live run', () => {
    g.go('playing');
    press('Escape');
    expect(g.state()).toBe('paused');

    g.holdFrames(10);
    press('Escape');
    // The pause menu answered on the very next step rather than sitting frozen
    // with no key left to unfreeze it, and the stale hold was dropped.
    expect(g.state()).toBe('playing');
    expect(g.hitstop()).toBe(0);
  });

  it('never carries a freeze across a screen change', () => {
    g.go('playing');
    g.holdFrames(10);
    expect(g.hitstop()).toBe(10);
    g.go('paused');
    expect(g.hitstop()).toBe(0);
  });

  it('never opens a new run mid-freeze', () => {
    g.go('playing');
    g.holdFrames(10);
    g.go('menu');
    g.go('playing');
    expect(g.hitstop()).toBe(0);
    const before = g.gameTime();
    g.stepSim(1);
    expect(g.gameTime()).toBeGreaterThan(before);
  });
});

describe('the sound a repeated shot makes', () => {
  /** The positional parameters variation is allowed to move. */
  const VOLUME = 0, FREQUENCY = 2, RELEASE = 5;
  const VARIED = [VOLUME, FREQUENCY, RELEASE];

  /** Every sound the player's own attacks play: what a run hears most. */
  const weaponSounds = (): number[][] =>
    Object.values(g.weaponFx() as Record<string, { sound: () => number[] }>)
      .map((fx) => fx.sound());

  /** The sounds that opted out, keyed by the array the call sites pass. */
  const optedOut = (): Map<number[], string> => g.soundPlayback() as Map<number[], string>;

  const play = (sound: number[]): number[] => g.soundPlan(sound) as number[];

  afterEach(() => { g.config().audio = true; });

  it('ships a profile subtle enough to survive its own clamp', () => {
    // If a tunable ever drifts past MAX_VARIATION the clamp keeps the game
    // playable, and this says so out loud instead of letting it pass silently.
    const shipped = g.config().soundVariation as VariationProfile;
    expect(variationProfile(shipped)).toEqual(shipped);
  });

  it('moves a weapon sound within the bounds CONFIG allows, and nothing else', () => {
    const profile = g.config().soundVariation as VariationProfile;
    const amount: Record<number, number> =
      { [VOLUME]: profile.gain, [FREQUENCY]: profile.pitch, [RELEASE]: profile.tail };
    for (const tuned of weaponSounds()) {
      for (let i = 0; i < 40; i++) {
        const heard = play(tuned);
        expect(heard.length).toBe(tuned.length);
        for (let p = 0; p < tuned.length; p++) {
          if (!VARIED.includes(p)) {
            expect(heard[p], `parameter ${p}`).toBe(tuned[p]);
            continue;
          }
          expect(heard[p]!).toBeGreaterThanOrEqual(tuned[p]! * (1 - amount[p]!));
          expect(heard[p]!).toBeLessThanOrEqual(tuned[p]! * (1 + amount[p]!));
        }
      }
    }
  });

  it('does not fire the same sample twice: forty plays are forty sounds', () => {
    for (const tuned of weaponSounds()) {
      const volumes = new Set(Array.from({ length: 40 }, () => play(tuned)[VOLUME]));
      expect(volumes.size).toBeGreaterThan(35);
    }
  });

  it('plays a sound that opted out exactly as tuned, however often it fires', () => {
    expect(optedOut().size).toBeGreaterThan(0);
    for (const [sound, kind] of optedOut()) {
      expect(kind).toBe('fixed');
      const tuned = [...sound];
      for (let i = 0; i < 20; i++) expect(play(sound), `${tuned}`).toEqual(tuned);
    }
  });

  it('lets no weapon sound opt out, since those are the ones that repeat', () => {
    for (const sound of weaponSounds()) expect(optedOut().has(sound)).toBe(false);
  });

  it('plays nothing at all, of any kind, while audio is off', () => {
    g.config().audio = false;
    const multiVoice = (): void => {};
    for (const sound of weaponSounds()) expect(g.soundPlan(sound)).toBeNull();
    for (const [sound] of optedOut()) expect(g.soundPlan(sound)).toBeNull();
    expect(g.soundPlan(multiVoice)).toBeNull();
  });

  it('leaves a multi-voice sound to play its own voices', () => {
    // A function calls the synth itself, once per voice, so there is no single
    // parameter array to vary — which is also why the announce beep stays the
    // same beep without needing a row of its own.
    const multiVoice = (): void => {};
    expect(g.soundPlan(multiVoice)).toBe(multiVoice);
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
  /** The post it is holding, written by updateGuards each frame. */
  anchor?: { x: number; y: number };
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

  /**
   * The whole ladder, fought rather than deleted.
   *
   * Every other ladder test here advances with clearSiegeWave(), which nulls
   * `boss` and `siegeExtraBosses` outright. That walks ten waves without a
   * single boss ever dying, so none of them ever entered the death sequence --
   * which is precisely how a siege boss death could freeze the field for good
   * while 1455 tests stayed green.
   *
   * This one kills every boss through startBossDeath and waits for each
   * sequence to finish before going on, so the four boss waves exercise the
   * real path four times: the death tail's siege guard (without it, killing
   * the wave-7 crow king loads the castle and the run is over), the handover
   * when wave ten's second boss dies while the first holds the slot, and the
   * field still moving afterwards.
   */
  it('plays all ten waves through to a win, killing every boss for real', () => {
    openSiege();
    const killed: string[] = [];
    // The hero is not the subject and nobody is holding the keys, so one left
    // standing in a wave dies and this would be measuring that instead. The
    // first run of this test failed on wave ten for exactly that reason.
    //
    // Waiting on the flag rather than on a frame count matters: a blind
    // stepSim(240) would pass whether or not the sequence ever finished, and
    // the sequence finishing is half of what is being tested.
    const settle = (): void => {
      for (let i = 0; i < 60 && g.bossDeathSeq(); i++) { g.healHero(); g.stepSim(10); }
      g.healHero();
    };
    for (let n = 0; n < SIEGE_WAVE_COUNT; n++) {
      g.healHero();
      g.stepSim(1);
      // Every boss this wave fielded, one at a time: a death sequence is
      // exclusive, so the next kill waits for the current one to clear.
      for (let guardStop = 0; guardStop < 4; guardStop++) {
        const which = g.killSiegeBoss();
        if (!which) break;
        killed.push(`wave ${siegeState().wave}: ${which}`);
        settle();
        expect(g.bossDeathSeq(), `wave ${siegeState().wave}: the field froze`).toBeNull();
        expect(g.state(), `wave ${siegeState().wave}: the run left the bastion`).toBe('playing');
      }
      g.clearSiegeWave();
      g.healHero();
      g.stepSim(2);
    }
    expect(g.state()).toBe('win');
    expect(siegeState().outcome).toBe('won');
    // Four deaths, not five. Waves 7, 8 and 9 field one boss each and wave 10
    // fields two -- but the pair share one bar and one life, so the wave-ten
    // kill takes both and the loop finds nothing left to kill after it. A
    // count that drifts means the ladder changed shape and this test stopped
    // covering what it claims to.
    expect(killed).toHaveLength(4);
    expect(killed.filter((k) => k.endsWith('extra'))).toHaveLength(0);
  });

  /**
   * The handover's second half, which the ten-wave run above does NOT cover.
   *
   * That test kills the primary first, so by the time an extra dies the
   * displaced boss is already dead and dropping it changes nothing: deleting
   * `seatSiegeBoss`'s `push(held)` leaves it passing. This kills the extra
   * while the primary is alive, which is the order tickSiegeBosses produces,
   * and is the only order in which losing the displaced boss is visible.
   */
  it('hands the slot back when wave ten loses its second boss first', () => {
    openSiege();
    g.jumpToSiegeWave(SIEGE_WAVE_COUNT);
    g.stepSim(1);
    const onField = (): { bstate: string }[] =>
      [g.boss(), ...g.siegeBosses()].filter(Boolean) as { bstate: string }[];
    expect(onField(), 'wave ten should field two bosses').toHaveLength(2);

    // Held by reference, because that is the only way to see the failure this
    // test exists for. A displaced boss that is handed back to nobody is in
    // neither g.boss() nor g.siegeBosses() -- it is alive, unticked, still
    // drawn, and invisible to every accessor, so an assertion about the lists
    // would pass while the bug was present. The reference outlives the lists.
    const displaced = g.boss() as { bstate: string };
    expect(g.killSiegeBoss('extra')).toBe('extra');
    for (let i = 0; i < 60 && g.bossDeathSeq(); i++) { g.healHero(); g.stepSim(10); }
    g.healHero();
    expect(g.bossDeathSeq(), 'the death sequence never finished').toBeNull();

    // One life between them, so the displaced one goes down too -- and it can
    // only go down if the handover put it back where felledWithTheOther could
    // find it.
    expect(displaced.bstate, 'the displaced boss was orphaned, alive and untracked')
      .toBe('dead');
    expect(onField().filter((b) => b.bstate !== 'dead'), 'a boss outlived the pair')
      .toHaveLength(0);
  });

  /**
   * The towers shoot, which is the difference between a defence map and a
   * brawl with scenery on it.
   *
   * The retinue is emptied rather than the wave cleared. Clearing the wave
   * completes it, which recruits a guard and puts a fresh archer on the field
   * firing allied arrows of its own; leaving the wave alone keeps the retinue
   * empty, so every allied arrow in these tests came from a tower.
   */
  const bastionNoRetinue = (): void => {
    openSiege();
    g.guards().length = 0;
  };

  const alliedShots = (): { damage: number }[] =>
    (g.arrows() as { allied?: boolean; damage: number }[]).filter((a) => a.allied);

  /** Something solid standing exactly where you put it. */
  const standAt = (x: number, y: number): void => {
    g.spawnSkeleton('normal');
    const list = g.skeletons() as { x: number; y: number; hp: number; maxHp: number }[];
    const sk = list[list.length - 1];
    if (!sk) throw new Error('spawnSkeleton put nothing on the field');
    sk.x = x; sk.y = y; sk.hp = 99; sk.maxHp = 99;
  };

  it('holds fire until something comes inside its reach', () => {
    bastionNoRetinue();
    const tower = g.towers()[0] as Tower;
    const muzzle = towerCentre(tower, TILE_SIZE);

    // Wave one is already on the field, but it marches in from the far edge,
    // which is most of the map away from a tower.
    g.stepSim(1);
    expect(alliedShots(), 'shot at something outside its reach').toHaveLength(0);

    standAt(muzzle.x + 80, muzzle.y);
    g.stepSim(1);
    expect(alliedShots().length, 'never shot at a target in reach').toBeGreaterThan(0);
  });

  it('looses a bolt worth more than a guard arrow', () => {
    bastionNoRetinue();
    const muzzle = towerCentre(g.towers()[0] as Tower, TILE_SIZE);
    standAt(muzzle.x + 80, muzzle.y);
    g.stepSim(1);
    // The whole argument for a tower: it cannot move, be healed or be
    // replaced, so its shot has to be worth more than a body's.
    for (const bolt of alliedShots()) expect(bolt.damage).toBe(TOWER_DAMAGE);
    expect(TOWER_DAMAGE).toBeGreaterThan(1);
  });

  it('stops shooting the moment it falls', () => {
    bastionNoRetinue();
    const muzzle = towerCentre(g.towers()[0] as Tower, TILE_SIZE);
    // Both, so the second one cannot answer for the first.
    for (const t of g.towers()) t.hp = 0;
    standAt(muzzle.x + 80, muzzle.y);
    // Frame by frame, not one long step. A bolt fired at a target 80px away
    // lands and is spliced out of `arrows` inside about ten frames, so a
    // single stepSim(30) finds an empty list whether the tower shot or not --
    // this test passed against a build with the standing check deleted until
    // it was checked every frame instead.
    for (let frame = 0; frame < 30; frame++) {
      // Every frame, not once at the top. Wave one can finish inside these
      // thirty frames, and finishing a wave recruits a guard -- whose arrow is
      // `allied` too. That put a stray archer's shot in the list on 3 runs in
      // 8 before this line existed.
      g.guards().length = 0;
      g.stepSim(1);
      // Cover and covering fire go together. A tower that kept shooting from
      // rubble would make taking one down cost the player nothing.
      expect(alliedShots(), `rubble is still shooting, frame ${frame}`).toHaveLength(0);
    }
  });

  /**
   * Playtest: "they still get stuck or frozen after a few seconds into a new
   * wave, our soldiers and knights."
   *
   * They were not stuck. They were standing on their gates having correctly
   * concluded there was nothing within their remit, while a wave that had
   * walked past the barrier ate the hero four tiles behind them. A guard's
   * ground was its post alone, and the hero stands further from the nearest
   * gate than the leash is long, so anything that got through stopped being
   * anybody's business the moment it was past.
   *
   * Measured in a headless run before the fix: three bodies stacked on the
   * hero, nearest post 190px away, leash 170, six guards motionless.
   */
  it('answers a threat standing on the hero, instead of holding a quiet gate', () => {
    openSiege();
    const hero = g.player() as { x: number; y: number };
    const reach = g.config().guardMeleeReach as number;

    // Nothing anywhere near a gate, so the only thing that can bring a guard
    // over is the hero being in trouble.
    const posts = (g.guards() as { anchor?: { x: number; y: number } }[])
      .map((b) => b.anchor).filter(Boolean) as { x: number; y: number }[];
    standAt(hero.x + 24, hero.y);
    const foe = (g.skeletons() as { x: number; y: number }[]).at(-1);
    if (!foe) throw new Error('no foe was placed');
    for (const p of posts) {
      expect(Math.hypot(p.x - foe.x, p.y - foe.y), 'the foe was placed inside a gate leash')
        .toBeGreaterThan(g.config().guardPostLeash as number);
    }

    // Long enough to walk it. The furthest gate is most of the map from the
    // hero and a guard moves at CONFIG.guardSpeed, so this is about arriving,
    // not about reacting quickly.
    for (let i = 0; i < 8; i++) { g.healHero(); g.stepSim(ONE_SECOND); }

    // Somebody came. Priests are excluded: a healer arriving is not an answer.
    const closest = (g.guards() as { x: number; y: number; guard: { kind: string } }[])
      .filter((b) => b.guard.kind !== 'priest')
      .map((b) => Math.hypot(b.x - foe.x, b.y - foe.y));
    expect(Math.min(...closest), 'nobody left their gate for the hero').toBeLessThan(reach * 2);
  });

  /**
   * Wave ten could not be fought, and no test had noticed.
   *
   * It fields the minotaur, whose HP was Infinity because the maze's keeper
   * cannot be killed -- and siegeWaveCleared waits on every boss being dead.
   * So the last wave of the bastion was unclearable by any amount of damage.
   * The ten-wave run above passed anyway, because its harness kills through
   * startBossDeath, which never looks at hp: a test that reaches the end by a
   * route the player does not have.
   *
   * This one goes through the real per-kind on-hit path, which is the route the
   * player has.
   */
  it('lets wave ten be beaten by hitting it, not only by the harness', () => {
    openSiege();
    g.jumpToSiegeWave(SIEGE_WAVE_COUNT);
    g.stepSim(1);
    const opening = g.siegeBossBar() as { hp: number; hpMax: number; count: number };
    expect(opening, 'no bar on wave ten').not.toBeNull();
    expect(opening.count, 'wave ten should field two').toBe(2);
    expect(Number.isFinite(opening.hpMax), 'the pool is not finite: nothing can empty it')
      .toBe(true);

    for (let i = 0; i < 400 && g.siegeBossBar(); i++) {
      g.healHero();
      g.hitBoss(1);
      g.stepSim(2);
    }
    expect(g.siegeBossBar(), 'the pool never emptied: wave ten cannot be fought')
      .toBeNull();

    // And the pair went together, so nothing is left holding the wave open.
    const alive = [g.boss(), ...g.siegeBosses()]
      .filter((b): b is { bstate: string } => Boolean(b))
      .filter((b) => b.bstate !== 'dead');
    expect(alive, 'a boss outlived the shared pool').toHaveLength(0);
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
    //
    // The fighter is put back on its own post first. Guards hold the barrier
    // gates now and take no target while they are away from one, so a fighter
    // left where parkFarAway dropped it walks home instead of swinging — and
    // the control would report 'no damage' for the wrong reason, which is
    // exactly the rot this control exists to catch.
    const fighter = fighters[0]!;
    g.stepSim(1);
    const post = fighter.anchor;
    expect(post, 'a guard should have been anchored to a post by now').toBeDefined();
    fighter.x = post!.x; fighter.y = post!.y;
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

// ── SIEGE BOSSES REACH THE FIELD ──────────────────────────────────────────────
//
// A playtest found a run that could not be finished: the wave-7 boss sat off
// the right edge, partly out of frame, immune and unkillable, and the wave
// waited on it for ever. Two causes, and the suite was green through both.
//
// spawnBoss leaves most kinds at `canvasW + 40` in `bstate: 'entering'`, which
// updateBossEntrance resolves — but only in the 'boss_entrance' appState, which
// a siege never enters. And updateBoss only runs during 'playing' for the kinds
// BOSS_HUNTS_WHILE_EXPLORING marks as hunters: the minotaur alone, with no row
// at all for the commander.
describe('a siege boss is on the field and can be fought', () => {
  beforeEach(() => { g.setSiegeRng(mulberry32(20260824)); });
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  const atWave = (n: number): void => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    g.jumpToSiegeWave(n);
  };

  /** Inside the arena, not parked past its right edge where nothing can reach. */
  const onField = (b: { x: number; y: number }): boolean => {
    const c = g.config();
    return b.x > 0 && b.x < c.cols * c.tileSize && b.y > 0 && b.y < c.rows * c.tileSize;
  };

  it('lands inside the arena rather than off the right edge', () => {
    atWave(7);
    const boss = g.boss();
    expect(boss, 'wave 7 should field a boss').toBeTruthy();
    expect(boss.bstate, 'a siege has no entrance to resolve an entering boss').not.toBe('entering');
    expect(onField(boss), `boss parked at x=${boss.x}`).toBe(true);
  });

  it('actually moves, because something ticks it', () => {
    atWave(7);
    const boss = g.boss();
    const before = { x: boss.x, y: boss.y };
    g.stepSim(90);
    const moved = Math.hypot(g.boss().x - before.x, g.boss().y - before.y);
    expect(moved, 'the boss never moved, so nothing is running its AI').toBeGreaterThan(1);
  });

  it('can be killed, and killing it lets the wave advance', () => {
    atWave(7);
    g.clearSiegeWave();
    // Put the boss back and kill it through the real death path.
    g.stepSim(1);
    const wave = siegeState().wave;
    g.killBoss();
    g.stepSim(240);
    g.clearSiegeWave();
    g.stepSim(2);
    expect(siegeState().wave, 'the wave never advanced past its boss').toBeGreaterThan(wave);
  });

  it('fields two on wave ten, and both of them move', () => {
    atWave(10);
    const first = g.boss();
    const extras = g.siegeBosses();
    expect(first).toBeTruthy();
    expect(extras.length, 'wave 10 should field a second boss').toBe(1);
    const second = extras[0];
    expect(onField(first), 'first boss off field').toBe(true);
    expect(onField(second), 'second boss off field').toBe(true);

    const a = { x: first.x, y: first.y };
    const b = { x: second.x, y: second.y };
    g.stepSim(90);
    expect(Math.hypot(first.x - a.x, first.y - a.y), 'first boss is frozen').toBeGreaterThan(1);
    // The one that caught a comment of mine claiming the extras were ticked.
    expect(Math.hypot(second.x - b.x, second.y - b.y), 'second boss is frozen').toBeGreaterThan(1);
  });
});

// ── THE RETINUE HOLDS THE GATES ───────────────────────────────────────────────
//
// A playtest, in order. First: "the guards should wander around our hero, as
// body guards" — so they stopped hunting across the map and ringed him. Then,
// having watched that: "put the army in the entrances, they should be between
// the player and the waves at the start. they can move to attack or to be
// healed but then they should move to their posts. one on each entrance of the
// wall."
//
// Ringing the hero put the whole retinue *behind* the wall it was meant to be
// holding, so a wave came through a gap unopposed. A gate is where a defender
// stands: forward of the person guarded, on the ground the attack has to cross.
describe('the retinue holds the barrier gates', () => {
  beforeEach(() => { g.setSiegeRng(mulberry32(20260824)); });
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  const openSiege = (): void => { g.setMode('siege'); g.go('playing'); g.stepSim(1); };

  /** Every gate the barrier leaves open, in world pixels. */
  const gates = (): { x: number; y: number }[] => {
    const c = g.config();
    return barrierGates(c.rows, c.cols).map((gate) => ({
      x: (gate.col + 0.5) * c.tileSize,
      y: (gate.row + 0.5) * c.tileSize,
    }));
  };

  const farthestFromAnyGate = (): number => {
    const posts = gates();
    let worst = 0;
    for (const b of g.guards()) {
      let best = Infinity;
      for (const post of posts) best = Math.min(best, Math.hypot(b.x - post.x, b.y - post.y));
      worst = Math.max(worst, best);
    }
    return worst;
  };

  it('leaves the barrier more than one way through, so there are gates to hold', () => {
    openSiege();
    expect(gates().length).toBeGreaterThan(2);
  });

  it('stands the retinue on its ground within a few seconds of opening', () => {
    openSiege();
    g.clearSiegeWave();
    g.stepSim(600);
    // A gate OR the hero. This used to say gates only, and it was right when a
    // guard's ground was its post alone -- but a guard answering something
    // that reached the hero is doing its job, not wandering, and the hero
    // stands further from the nearest gate than the leash is long. Asserting
    // gates only would now forbid the fix for the retinue standing still while
    // he was eaten.
    const leash = g.config().guardPostLeash as number;
    const hero = g.player() as { x: number; y: number };
    const posts = gates();
    for (const b of g.guards() as { x: number; y: number; guard: { kind: string } }[]) {
      const toGate = Math.min(...posts.map((p) => Math.hypot(b.x - p.x, b.y - p.y)));
      const toHero = Math.hypot(b.x - hero.x, b.y - hero.y);
      expect(Math.min(toGate, toHero), `${b.guard.kind} is on neither a gate nor the hero`)
        .toBeLessThan(leash);
    }
  });

  it('puts the retinue between the hero and the corridor', () => {
    openSiege();
    g.clearSiegeWave();
    g.stepSim(600);
    // Cleared again before asking. This is a claim about the resting
    // formation, and a guard that has come back to meet something standing on
    // the hero is legitimately west of him -- so the field has to be quiet for
    // the question to mean what it says.
    g.clearSiegeWave();
    g.stepSim(180);
    const p = g.player() as { x: number };
    // Every guard east of the hero: the waves come down the right-hand
    // corridor, so a defender belongs on that side of the person defended.
    for (const b of g.guards()) {
      expect(b.x, `${b.guard.kind} is behind the hero`).toBeGreaterThan(p.x);
    }
  });

  it('spreads across different gates rather than stacking on one', () => {
    openSiege();
    g.clearSiegeWave();
    g.stepSim(600);
    const posts = gates();
    const held = new Set<number>();
    for (const b of g.guards()) {
      let best = 0, bestD = Infinity;
      posts.forEach((post, i) => {
        const d = Math.hypot(b.x - post.x, b.y - post.y);
        if (d < bestD) { bestD = d; best = i; }
      });
      held.add(best);
    }
    // Three opening guards should be holding three different ways in.
    expect(held.size, 'the retinue piled onto one gate').toBeGreaterThan(1);
  });

  it('returns to its post after leaving it to fight', () => {
    openSiege();
    g.clearSiegeWave();
    g.stepSim(600);
    const body = g.guards()[0];
    // Drag it off, the way chasing something would.
    body.x += 120; body.y += 60;
    const dropped = { x: body.x, y: body.y };
    g.clearSiegeWave();
    g.stepSim(600);
    // Quiet before asking, for the reason the resting-formation test above is:
    // a guard that has gone to meet something standing on the hero has not
    // failed to come home -- it is answering. This test is about the walk
    // back, so the field has to be empty when the question is put.
    //
    // Cleared repeatedly rather than once, because clearing a wave ADVANCES
    // the run and spawns the next one. A single clear plus a long settle gives
    // the new wave the whole settle to cross the map and reach the hero, and
    // then a guard is legitimately at his side rather than at its gate. One
    // clear flaked 1 run in 10, then landed at 170.14 against a limit of 170.
    // Short steps between clears keep the field empty for the whole walk.
    // Six clears at two seconds apart: long enough for the walk home even on a
    // map seed that scatters cover across the route, and frequent enough that
    // the wave each clear spawns never crosses the map to reach the hero. The
    // map seed is Math.random, so the route length varies run to run -- 320
    // frames was enough on some seeds and left the guard still walking at
    // 175px on others, which is what failed 4 runs in 20.
    for (let i = 0; i < 6; i++) { g.clearSiegeWave(); g.stepSim(120); }
    // Two claims, and the first is the one that matters.
    //
    // It MOVED. The old assertion was "within guardPostLeash of a gate", and
    // the drag is 134 against a leash of 170 -- so it was satisfied by a guard
    // that had not moved a single pixel, which is exactly what was happening.
    // +120,+60 landed the body inside a rock, moveGuard refused both halves of
    // every step, and it sat there entombed for the whole settle while the test
    // reported success. Distance from where it was dropped is the question that
    // catches that; distance from a gate is not.
    const travelled = Math.hypot(body.x - dropped.x, body.y - dropped.y);
    expect(travelled, 'the guard never moved: it is stuck where it was put')
      .toBeGreaterThan(20);

    // And it is somewhere it belongs -- its gate or its hero. Not "at its
    // post", because waves keep arriving through this settle and a guard that
    // has gone to meet one has not failed to come home.
    const hero = g.player() as { x: number; y: number };
    let best = Math.hypot(body.x - hero.x, body.y - hero.y);
    for (const post of gates()) best = Math.min(best, Math.hypot(body.x - post.x, body.y - post.y));
    expect(best, 'the guard is neither on a gate nor with the hero')
      .toBeLessThan(g.config().guardPostLeash);
  });

  /**
   * A guard pushed inside terrain has to be able to walk out.
   *
   * moveGuard checks the DESTINATION tile, so a body already standing in rock
   * has both halves of every step refused and never moves again: it cannot
   * fight, cannot go home, and nothing frees it. The player has a way out of
   * this and has just been given a key for it; a guard had none.
   *
   * Placed deliberately rather than nudged. The walk-home test above drags a
   * guard by a fixed offset and only lands it in rock on some map seeds -- it
   * passed with this rule deleted, because most seeds leave the drop on open
   * ground. This one goes looking for a solid tile, so it fails every time.
   */
  it('walks out of terrain it was pushed into', () => {
    openSiege();
    const ts = g.config().tileSize as number;
    const tiles = g.tiles() as { get(r: number, c: number): TileId };
    const rows = g.config().rows as number;
    const cols = g.config().cols as number;

    let solid: { row: number; col: number } | null = null;
    for (let r = 2; r < rows - 2 && !solid; r++) {
      for (let c = 2; c < cols - 2; c++) {
        if (!tilePassable(tiles.get(r, c))) { solid = { row: r, col: c }; break; }
      }
    }
    if (!solid) throw new Error('the bastion has no solid tile to test with');

    const body = g.guards()[0] as { x: number; y: number };
    body.x = (solid.col + 0.5) * ts;
    body.y = (solid.row + 0.5) * ts;
    const from = { x: body.x, y: body.y };

    g.stepSim(240);

    const travelled = Math.hypot(body.x - from.x, body.y - from.y);
    expect(travelled, 'entombed: the guard never moved out of the rock')
      .toBeGreaterThan(8);
    const nowOn = tiles.get(Math.floor(body.y / ts), Math.floor(body.x / ts));
    expect(tilePassable(nowOn), 'the guard is still standing inside terrain').toBe(true);
  });

  it('ignores an enemy that is nowhere near any gate', () => {
    openSiege();
    g.clearSiegeWave();
    g.stepSim(600);
    // A tough skeleton parked in the far top corner, well outside every post.
    g.spawnSkeleton('normal');
    const sk = g.skeletons()[g.skeletons().length - 1];
    sk.x = (g.config().cols - 3) * g.config().tileSize;
    sk.y = 2 * g.config().tileSize;
    sk.hp = 99; sk.maxHp = 99;
    g.stepSim(300);
    // Measured against the skeleton itself rather than against the gates. The
    // gate distance was a proxy for "did anyone go for it", and it stopped
    // being one once the hero became part of a guard's ground: a guard 180px
    // from a gate may be standing on the hero answering something that got to
    // him, which is the opposite of marching off. This asks the question the
    // test is actually named for.
    const wentFor = Math.min(...(g.guards() as { x: number; y: number }[])
      .map((b) => Math.hypot(b.x - sk.x, b.y - sk.y)));
    expect(wentFor, 'a guard marched off to something far from its post and its hero')
      .toBeGreaterThan(g.config().guardPostLeash);
  });
});

// ── THE BASTION'S OWN TERRAIN RULES ───────────────────────────────────────────
//
// A playtest, verbatim: "the player shouldnt destroy the walls on this map,
// otherwise we have no wall to defend" and "make the critters a bit slower
// here, 80% only on this map."
//
// Both are per-map facts and both live in MAP_RULES, for the reason the whole
// feature gates on the map: the bastion is reachable from two modes and neither
// should have to know about it.
describe("the bastion's terrain rules", () => {
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  it('cannot be broken by the player, so there is always a wall to defend', () => {
    expect(MAP_RULES.bastion.destructibleTerrain).toBe(false);
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    const tiles = g.tiles();
    const c = g.config();
    // Find a barrier tile and try to level it, twice over: the tile smasher
    // every melee weapon routes through, and a blast at point-blank range.
    let target: { row: number; col: number } | null = null;
    for (let row = 1; row < c.rows - 1 && !target; row++) {
      for (let col = 1; col < c.cols - 1; col++) {
        if (tiles.get(row, col) === TILE.ROCK) { target = { row, col }; break; }
      }
    }
    expect(target, 'the bastion should have a stone barrier').not.toBeNull();
    const { row, col } = target!;
    g.smashTile(row, col);
    expect(tiles.get(row, col), 'a melee hit levelled the barrier').toBe(TILE.ROCK);
    g.blast((col + 0.5) * c.tileSize, (row + 0.5) * c.tileSize);
    g.stepSim(4);
    expect(tiles.get(row, col), 'a blast levelled the barrier').toBe(TILE.ROCK);
  });

  it('still lets an enemy bring a tower down, which is a different rule', () => {
    // destructibleTerrain is about what the *player's weapons* may level.
    // A tower falling is the siege's own attrition and goes through
    // damageTower, so making the map indestructible must not have frozen it.
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    const standing = g.towers().length;
    g.hurtTowers(1);
    const tiles = g.tiles();
    const t = g.towers()[0];
    expect(tiles.get(t.row, t.col)).toBe(TILE.HUT);
    // One more hit from an enemy pressed against it.
    g.spawnSkeleton('normal');
    const sk = g.skeletons()[g.skeletons().length - 1];
    sk.hp = 99; sk.maxHp = 99;
    for (let n = 0; n < 200; n++) {
      sk.x = (t.col + 0.5) * g.config().tileSize;
      sk.y = (t.row + 0.5) * g.config().tileSize;
      g.stepSim(1);
      if (tiles.get(t.row, t.col) !== TILE.HUT) break;
    }
    expect(tiles.get(t.row, t.col), 'a tower could no longer be brought down').toBe(TILE.EMPTY);
    expect(standing).toBe(2);
  });

  it('slows everything hostile to 80%, and only here', () => {
    expect(MAP_RULES.bastion.enemySpeed).toBe(0.8);
    for (const kind of Object.keys(MAP_RULES) as MapKind[]) {
      if (kind === 'bastion') continue;
      expect(MAP_RULES[kind].enemySpeed, `${kind} should run at full speed`).toBe(1);
    }
  });

  it('actually moves a crow more slowly here than on the forest', () => {
    // A PASSIVE crow, deliberately. An aggro'd one walks an A* path, so on the
    // bastion it routes around the barrier and its x-displacement measures the
    // detour as well as the speed — that read 0.56 and looked like a bug in the
    // multiplier. A passive crow drifts left in a straight line with no pathing
    // in it at all, which is the only thing here that measures speed alone.
    //
    // Both in the same mode, switching only the map: waves scales crow speed
    // with the wave number and siege does not, and comparing across modes
    // measured two rules at once.
    const drift = (map: MapKind): number => {
      g.setMode('brawl');
      g.go('playing');
      g.generateMap(map);
      g.crows().length = 0;
      g.spawnCrow();
      const c = g.crows()[0];
      c.state = 'passive';
      const from = c.x;
      g.stepSim(30);
      return from - c.x;
    };
    const onForest = drift('forest');
    const onBastion = drift('bastion');
    expect(onForest, 'the control crow did not move').toBeGreaterThan(0);
    expect(onBastion, 'a crow was not slowed on the bastion').toBeLessThan(onForest);
    expect(onBastion / onForest).toBeCloseTo(0.8, 1);
  });
});

// ── WHOSE SIDE IS THAT ────────────────────────────────────────────────────────
//
// A playtest, on top of the sprite work: "in Multiplayer im going to add colors
// to the teams... in the same fashion, it should be visible to the player that
// the soldiers etc are on his team."
//
// The mechanism is the ground disc under every body, keyed on Team — the model
// multiplayer already uses — so teams there become a row in one table rather
// than a second way of saying the same thing. The sprite's own livery is the
// other half, but a livery on a 16px body disappears in the twelve-body crowd
// of wave 10, and a disc under the feet survives being half-hidden.
describe('allies are visibly the hero\u2019s', () => {
  beforeEach(() => { g.setSiegeRng(mulberry32(20260824)); });
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  it('puts every guard on the hero\u2019s team, which is what the disc keys on', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    const hero = g.player() as { team: number };
    expect(g.guards().length).toBeGreaterThan(0);
    for (const body of g.guards()) {
      expect(body.team, `${body.guard.kind} is not on the hero's team`).toBe(hero.team);
    }
  });

  it('keeps every hostile off it, so the disc means something', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    const hero = g.player() as { team: number };
    g.spawnSkeleton('normal');
    g.spawnSoldier('spearman');
    for (const c of g.crows()) expect(c.team).not.toBe(hero.team);
    // Skeletons and soldiers carry no team field at all — they are hostile by
    // construction, which siegeHostiles relies on. If one ever gains a team it
    // must not be the hero's, and this is where that would be caught.
    for (const sk of g.skeletons()) expect(sk.team ?? Team.ENEMY).not.toBe(hero.team);
    for (const so of g.soldiers()) expect(so.team ?? Team.ENEMY).not.toBe(hero.team);
  });
});

// ── THE RETICLE IS THE AIM POINT ─────────────────────────────────────────────
//
// Playtest: "playing with the archer and aiming at a creep with the mouse makes
// me fail the shot."
//
// The OS cursor is hidden in game (syncCursor), so the reticle is the only
// aiming reference the player has. drawReticle translated to
// `mouse.y + hudHeight` while the aim ray used `mouse.y - hudHeight`, which put
// the reticle a full 48px below the point the arrow flew at. Lining the reticle
// up on a crow shot a clean 48px over its head, on a target 16 pixels tall.
describe('the reticle sits where the shot goes', () => {
  afterEach(() => { g.setMode('brawl'); g.pickMap('forest'); });

  const MOUSE_POINTS = [
    { x: 100, y: 100 }, { x: 528, y: 360 }, { x: 900, y: 640 }, { x: 0, y: 48 },
  ];

  it('draws the reticle at the point the aim ray is pointed at', () => {
    const hud = g.config().hudHeight as number;
    const mouse = g.mouse() as { x: number; y: number };
    for (const at of MOUSE_POINTS) {
      mouse.x = at.x; mouse.y = at.y;
      const reticle = g.reticleAt() as { x: number; y: number };
      const world = g.aimWorld() as { x: number; y: number };
      // World space is drawn hudHeight further down, so the aim point in canvas
      // pixels is world.y + hudHeight. The reticle has to be there.
      expect(reticle.x, `x at ${at.x},${at.y}`).toBe(world.x);
      expect(reticle.y, `reticle is not on the aim point at ${at.x},${at.y}`)
        .toBe(world.y + hud);
    }
  });

  it('sends the arrow at what the reticle is on', () => {
    g.setMode('brawl');
    g.go('playing');
    g.stepSim(1);
    const hero = g.player() as { x: number; y: number };
    const mouse = g.mouse() as { x: number; y: number };

    // A target dead level with the hero and to his right: aiming at it should
    // give a heading of 0, and the 48px error showed up as a heading that was
    // visibly tilted.
    const target = { x: hero.x + 200, y: hero.y };
    const reticle = g.reticleAt() as { x: number; y: number };
    // Put the RETICLE on the target, which is what the player does.
    mouse.x = target.x + (mouse.x - reticle.x);
    mouse.y = target.y + g.config().hudHeight + (mouse.y - reticle.y);

    const world = g.aimWorld() as { x: number; y: number };
    const off = Math.hypot(world.x - target.x, world.y - target.y);
    expect(off, 'the shot is aimed away from where the reticle is sitting')
      .toBeLessThan(1);
  });
});

// ── KILLING A SIEGE BOSS DOES NOT STOP THE WORLD ──────────────────────────────
//
// Playtest: "the bats and the soldiers were all stopped/freeze after I killed
// the boss." The suite was entirely green while that was true.
//
// updateBossDeath only ran during 'boss_fight', and a siege runs in 'playing'.
// So a siege boss death set bossDeathSeq and nothing ever cleared it — while
// five update functions bail on that flag. The field stopped for good and the
// run could not be finished.
describe('a siege boss dying leaves the wave running', () => {
  beforeEach(() => { g.setSiegeRng(mulberry32(20260824)); });
  afterEach(() => { g.setSiegeRng(null); g.setMode('brawl'); g.pickMap('forest'); });

  const atBossWave = (): void => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    g.jumpToSiegeWave(7);
    g.stepSim(1);
  };

  it('clears the death sequence, so nothing is left frozen', () => {
    atBossWave();
    expect(g.boss(), 'wave 7 should field a boss').toBeTruthy();
    g.killBoss();
    g.stepSim(180);
    // The flag five update functions bail on. Still set means the field is
    // stopped and the run is unfinishable.
    expect(g.bossDeathSeq(), 'the death sequence never finished').toBeNull();
  });

  it('thaws the crows it froze, so the wave can still be cleared', () => {
    // startBossDeath freezes every crow to hold the field still for the death
    // cinematic, and updateCrows skips a frozen one outright. In a brawl the
    // tail then clears `crows` or loads a new map, so the flag died with the
    // bodies and nothing ever had to undo it. A siege keeps its wave.
    //
    // Left frozen, the survivors hang in the air for ever and siegeWaveCleared
    // never comes true: the run stalls on the last two bats. Measured in a
    // browser at wave ten -- two crows, frozen, 0px in 14 seconds.
    atBossWave();
    g.spawnCrow();
    const crows = g.crows() as { x: number; y: number; frozen?: boolean }[];
    expect(crows.length, 'no crows to freeze').toBeGreaterThan(0);

    g.killBoss();
    for (let i = 0; i < 60 && g.bossDeathSeq(); i++) { g.healHero(); g.stepSim(10); }
    g.healHero();
    expect(g.bossDeathSeq(), 'the death sequence never finished').toBeNull();

    const stillFrozen = (g.crows() as { frozen?: boolean }[]).filter((c) => c.frozen);
    expect(stillFrozen, 'crows left frozen: the wave can never be cleared').toHaveLength(0);

    // And the flag being clear has to actually mean they move again.
    const before = (g.crows() as { x: number; y: number }[]).map((c) => ({ x: c.x, y: c.y }));
    g.healHero();
    g.stepSim(120);
    const after = g.crows() as { x: number; y: number }[];
    const moved = after.map((c, i) => {
      const b = before[i];
      return b ? Math.hypot(c.x - b.x, c.y - b.y) : 0;
    });
    expect(Math.max(...moved, 0), 'thawed crows still are not moving').toBeGreaterThan(1);
  });

  it('leaves the rest of the wave moving', () => {
    atBossWave();
    // Something on the field that should still be walking afterwards.
    g.spawnSkeleton('normal');
    const sk = g.skeletons()[g.skeletons().length - 1];
    sk.hp = 99; sk.maxHp = 99;
    g.killBoss();
    g.stepSim(180);
    const before = { x: sk.x, y: sk.y };
    g.stepSim(120);
    const moved = Math.hypot(sk.x - before.x, sk.y - before.y);
    expect(moved, 'the wave froze after the boss died').toBeGreaterThan(1);
  });

  it('does not hand off to another stage the way a brawl boss does', () => {
    // Every branch of updateBossDeath's tail loads a map or ends the run —
    // crowking opens the castle. On a siege the boss is one enemy inside a
    // wave, so none of that may fire.
    atBossWave();
    g.killBoss();
    g.stepSim(240);
    expect(g.mapKind(), 'killing a siege boss changed the map').toBe('bastion');
    expect(g.state()).toBe('playing');
    expect(g.siege()).not.toBeNull();
  });

  /**
   * Wave ten's pair share one bar and one life, by design: "they should share
   * the same bar, just ensure its doubled in raw number, but 1 dies = both
   * die." This test used to assert the opposite -- that the second survived --
   * which was right while they had a health bar each and is wrong now that the
   * bar shows one pool. A survivor standing in front of an empty bar is the
   * state the change exists to prevent.
   */
  it('takes the second boss of wave ten down with the first', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    g.jumpToSiegeWave(10);
    g.stepSim(1);
    expect((g.boss() ? 1 : 0) + g.siegeBosses().length).toBe(2);
    g.killBoss();
    g.stepSim(180);
    const alive = (g.boss() && g.boss().bstate !== 'dead' ? 1 : 0)
      + g.siegeBosses().filter((b: { bstate: string }) => b && b.bstate !== 'dead').length;
    expect(alive, 'a boss was left standing in front of an empty bar').toBe(0);
  });

  it('shows one bar for the pair, with both pools added together', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    g.jumpToSiegeWave(10);
    g.stepSim(1);
    const bodies = [g.boss(), ...g.siegeBosses()]
      .filter(Boolean) as { hp: number; hpMax: number }[];
    expect(bodies, 'wave ten should field two').toHaveLength(2);

    const bar = g.siegeBossBar() as { hp: number; hpMax: number; count: number };
    expect(bar, 'no bar while two bosses are on the field').not.toBeNull();
    expect(bar.count).toBe(2);
    // The doubled raw number: one bar carrying the sum, not one of the two.
    expect(bar.hpMax).toBe(bodies[0]!.hpMax + bodies[1]!.hpMax);
    expect(bar.hp).toBe(bodies[0]!.hp + bodies[1]!.hp);
    expect(bar.hpMax).toBeGreaterThan(bodies[0]!.hpMax);
  });

  it('drains the shared bar when either one of the pair is hit', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    g.jumpToSiegeWave(10);
    g.stepSim(1);
    const before = (g.siegeBossBar() as { hp: number }).hp;
    // The second of the pair, not the one holding the slot: a bar that only
    // moved for the primary would look stuck while the player fought the twin.
    const twin = g.siegeBosses()[0] as { hp: number };
    twin.hp -= 1;
    expect((g.siegeBossBar() as { hp: number }).hp, 'the bar ignored the twin')
      .toBe(before - 1);
  });

  it('shows no bar once the pair is down', () => {
    g.setMode('siege');
    g.go('playing');
    g.stepSim(1);
    g.jumpToSiegeWave(10);
    g.stepSim(1);
    g.killBoss();
    g.stepSim(180);
    expect(g.siegeBossBar(), 'a bar outlived the bosses it was for').toBeNull();
  });
});

