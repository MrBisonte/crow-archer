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
import { boot, devHooks as g } from './game.js';

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
