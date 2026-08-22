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
import { boot, devHooks as g } from './game.js';
import type { PixelGrid } from '../render/pixel-grid';
import { spriteCanvas, spriteFlashCanvas } from '../render/pixel-sprite';
import {
  gridColours, gridSize, installStubCanvas, invalidColours, raggedRows,
} from '../render/grid-testkit';

/** One second of simulation, at the fixed 60 Hz step the loop uses. */
const ONE_SECOND = 60;

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

  it('arrow keys cycle and wrap between the two panels', () => {
    g.pickMap('forest');
    openWavesMapSelect();
    expect(g.state()).toBe('mapselect');

    press('ArrowRight');
    press('Enter');
    expect(g.mapKind()).toBe('castle');

    g.pickMap('castle');
    openWavesMapSelect();
    press('ArrowRight'); // wraps past the last panel back to the first
    press('Enter');
    expect(g.mapKind()).toBe('forest');
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
