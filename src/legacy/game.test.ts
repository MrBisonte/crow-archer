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
import { TILE, tilePassable } from '../sim/tilemap';
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

describe('the wizard blink arrival pulse', () => {
  /** Drops a single crow at a point, with every other crow cleared away. */
  function loneCrowAt(x: number, y: number): void {
    const crows = g.crows();
    crows.length = 0;
    g.spawnCrow();
    const crow = crows[0] as { x: number; y: number; state: string };
    crow.x = x;
    crow.y = y;
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
    g.releaseShift();   // committed east
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
