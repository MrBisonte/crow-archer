/**
 * The difficulty ladder.
 *
 * `PACE_PRESETS` held three rows and the game could only ever be played on one
 * of them: `fast` was the default and the other two were reachable by a
 * `?pace=` query string nobody types. They are a ladder now, picked on the
 * character screen, and two things about that are worth a test rather than a
 * comment.
 *
 * The first is that `nightmare` IS the game that shipped. That is a promise to
 * the player -- the hardest rung is not a new invention, it is the version
 * nobody was winning -- and the figures below are the only place the promise is
 * written down, so tuning nightmare fails here and says why.
 *
 * The second is that the ladder only goes one way. Eleven figures move per
 * rung, and five of them mean an EASIER game when they go up, so "make calm
 * calmer" is an edit that can quietly make it harder on one knob and leave the
 * other ten telling the truth. Direction is per figure, and checked per figure.
 *
 * What is deliberately not tested here: HANDICAP's own arithmetic. The ladder
 * turns that module on by giving `handicap` a non-zero value, which is all this
 * change did to it; the curve it applies is older code and unchanged.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { devHooks as g } from './game.js';
import { press } from './arena-testkit';

type Config = Record<string, number>;

/** CONFIG as a table of figures, which is all this file reads it as. */
const cfg = (): Config => g.config() as unknown as Config;

/** Which rung is applied. Read apart from the figures because it is the only
 *  string among them. */
const pace = (): string => (g.config() as { pace: string }).pace;

/** One figure, by name, refusing a name CONFIG does not carry. Without this a
 *  renamed key compares `undefined` against `undefined` and passes. */
function figure(c: Config, key: string): number {
  const v = c[key];
  if (v === undefined) throw new Error('CONFIG has no figure named ' + key);
  return v;
}

/** The game as it shipped through round 9, when `fast` was the only pace a
 *  player could reach. Every figure here was `fast`'s; nightmare holds them
 *  now. A failure on this block is a failure of the promise, not of a number. */
const AS_SHIPPED: Record<string, number> = {
  crowStartCount: 9,
  crowEscalationInterval: 4.5,
  crowMax: 18,
  crowAggroTimeout: 7,
  crowPassiveSpeed: 85,
  maxArrowsInFlight: 5,
  baseArrows: 16,
  baseDynamites: 4,
  baseArrowRestore: 5,
  // Both dials the ladder added, at the values that were hardcoded before it.
  // handicap 0 is what kept the whole HANDICAP module inert, and it has to stay
  // 0 here: at full health the rubber band SPEEDS crows up by 12%, so any other
  // value would make the top rung harder than the version it preserves.
  handicap: 0,
  playerHitFlashSecs: 0.3,
};

/** Which way each figure points. `harder: 'up'` means a bigger number is a
 *  harder game; `harder: 'down'` means a bigger number is a kinder one. */
const KNOBS: { key: string; harder: 'up' | 'down' }[] = [
  { key: 'crowStartCount', harder: 'up' },
  { key: 'crowMax', harder: 'up' },
  { key: 'crowAggroTimeout', harder: 'up' },
  { key: 'crowPassiveSpeed', harder: 'up' },
  { key: 'crowEscalationInterval', harder: 'down' },
  { key: 'maxArrowsInFlight', harder: 'down' },
  { key: 'baseArrows', harder: 'down' },
  { key: 'baseDynamites', harder: 'down' },
  { key: 'baseArrowRestore', harder: 'down' },
  { key: 'handicap', harder: 'down' },
  { key: 'playerHitFlashSecs', harder: 'down' },
];

describe('the difficulty ladder', () => {
  // The pace is module state and outlives a test, so every test in this file
  // hands back the default rather than trusting the next one to set it.
  afterEach(() => { g.setPace('fast'); });

  it('has exactly the three rungs, in order', () => {
    // The exact set, not a length: a length check catches a deleted rung and
    // misses an added one, and an added rung that nobody placed in the order
    // is a rung with no position on the ladder.
    expect(g.paceOrder()).toEqual(['calm', 'fast', 'nightmare']);
  });

  it('nightmare is the game that shipped, figure for figure', () => {
    g.setPace('nightmare');
    const c = cfg();
    for (const [key, value] of Object.entries(AS_SHIPPED)) {
      expect(figure(c, key), key + ' on nightmare').toBe(value);
    }
  });

  it('every figure moves toward harder, one rung at a time', () => {
    const rungs = g.paceOrder() as string[];
    const applied = rungs.map((name) => { g.setPace(name); return { ...cfg() }; });

    for (let i = 1; i < applied.length; i++) {
      const below = applied[i - 1] as Config, above = applied[i] as Config;
      for (const { key, harder } of KNOBS) {
        const lo = figure(below, key), hi = figure(above, key);
        const where = key + ': ' + rungs[i - 1] + ' ' + lo + ' -> ' + rungs[i] + ' ' + hi;
        // Not strictly, on purpose: two rungs are allowed to agree on one
        // figure -- the ammo cap is the same on all three, which is how the
        // easier rungs get their tilt -- but neither may move the wrong way.
        if (harder === 'up') expect(hi, where).toBeGreaterThanOrEqual(lo);
        else expect(hi, where).toBeLessThanOrEqual(lo);
      }
    }
  });

  it('the easier rungs are actually easier, not just differently shaped', () => {
    g.setPace('nightmare');
    const hard = { ...cfg() };
    g.setPace('calm');
    const easy = cfg();
    // One assertion per direction of the change, because "tuned down" is three
    // separate claims and a preset can satisfy one of them while failing the
    // other two.
    expect(figure(easy, 'crowMax'), 'fewer crows on the field')
      .toBeLessThan(figure(hard, 'crowMax'));
    expect(figure(easy, 'baseArrows'), 'more to answer them with')
      .toBeGreaterThan(figure(hard, 'baseArrows'));
    expect(figure(easy, 'playerHitFlashSecs'), 'longer between two hits landing')
      .toBeGreaterThan(figure(hard, 'playerHitFlashSecs'));
    expect(figure(easy, 'handicap'), 'the rubber band is on at all').toBeGreaterThan(0);
  });

  // The screen is the only way a player reaches any of this, so at least one
  // test comes in the front door: a key press on the character screen, not
  // setPace. Every siege test in this repo opened with setMode('siege') and so
  // not one of them could tell whether the menu row a player presses reached
  // anything -- the same shape of hole, kept shut here.
  describe('from the character screen', () => {
    beforeEach(() => {
      g.setPace('fast');
      g.go('menu');
      g.go('charselect');
    });

    it('up steps toward nightmare and down steps back', () => {
      expect(pace()).toBe('fast');
      press('ArrowUp');
      expect(pace()).toBe('nightmare');
      press('ArrowDown');
      expect(pace()).toBe('fast');
      press('ArrowDown');
      expect(pace()).toBe('calm');
    });

    it('clamps at both ends instead of wrapping', () => {
      // Wrapping is what makes a held key start a run on a difficulty nobody
      // picked: one press past NIGHTMARE and the player is on CALM.
      press('ArrowUp');
      press('ArrowUp');
      expect(pace()).toBe('nightmare');
      press('ArrowDown');
      press('ArrowDown');
      press('ArrowDown');
      expect(pace()).toBe('calm');
    });

    it('applies the rung it lands on, not just the name', () => {
      press('ArrowDown');
      expect(pace()).toBe('calm');
      // The name changing without the figures following is the failure this
      // catches: cyclePace could set CONFIG.pace and never call applyPace.
      expect(figure(cfg(), 'crowMax')).toBe(10);
      expect(figure(cfg(), 'handicap')).toBe(60);
    });
  });
});
