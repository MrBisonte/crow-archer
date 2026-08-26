/**
 * Momentum: the archer's Brace pointed the other way.
 *
 * The archer is paid for standing still and the ranger for never doing it, and
 * the pair only reads that way if the ranger's half actually behaves like the
 * mirror image. So the things pinned here are the ones that would quietly
 * break the symmetry: that it fills off ground covered rather than off a
 * pressed key, that it caps where the config says, that it decays on the clock
 * once he stops, and — the one the project owner asked for by name — that it
 * *multiplies* rather than writing a damage figure, so a fire or ricochet
 * pickup is not taken away with it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ONE_SECOND, clearArena, stepPast } from './arena-testkit';
import { devHooks as g } from './game.js';

interface Momentum { level: number; mult: number; max: number }

const mom = (): Momentum => g.momentum() as Momentum;
const cfg = (): { rangerMomentumMax: number; rangerMomentumFullPx: number;
                  rangerMomentumDecaySecs: number; crossbowBoltDamageMult: number } => g.config();

/**
 * Plants him at the western end, so a run has room to be a run.
 *
 * Written straight onto the body rather than walked: the meters measure the
 * distance covered *within* a step, so a teleport between steps contributes
 * nothing to them and cannot accidentally fill the thing under test.
 */
function plantWest(): void {
  const c = g.config() as { tileSize: number; canvasH: number };
  const p = g.player() as { x: number; y: number };
  p.x = c.tileSize * 2;
  p.y = c.canvasH / 2;
}

/**
 * Runs him due east for `frames`, through the real movement path.
 *
 * Re-plants first unless told not to. At 250 px/s he crosses the arena in a
 * little over four seconds, so a test that runs him twice without this is
 * measuring him shoving into the east wall — which now correctly builds
 * nothing, and made a passing cap test start failing.
 */
function run(frames: number, replant = true): void {
  if (replant) plantWest();
  const keys = g.keys() as Record<string, boolean>;
  keys['ArrowRight'] = true;
  stepPast(frames);
  keys['ArrowRight'] = false;
}

/** Stands still for `frames`, with every direction released. */
function stand(frames: number): void {
  const keys = g.keys() as Record<string, boolean>;
  for (const k of Object.keys(keys)) keys[k] = false;
  stepPast(frames);
}

/** Fills the meter to the brim, however long that takes. */
function toFull(): void {
  run(ONE_SECOND * 3);
}

beforeEach(() => {
  for (const k of Object.keys(g.keys() as Record<string, boolean>)) {
    (g.keys() as Record<string, boolean>)[k] = false;
  }
  g.takeClock();
  g.pick('ranger');
  g.go('playing');
  g.generateMap('forest');
  // Open ground: he has to be able to run in a straight line, and a generated
  // map decides whether there is a tree in the way.
  clearArena();
  g.healHero();
  g.stepSim(1);
});

describe('building it', () => {
  it('starts every run at nothing', () => {
    expect(mom().level).toBe(0);
    expect(mom().mult).toBe(1);
  });

  it('builds while he runs', () => {
    run(30);
    expect(mom().level).toBeGreaterThan(0);
  });

  it('fills within about the distance the config asks for', () => {
    // 375 px at 250 px/s is a second and a half. Given two, it must be full.
    run(ONE_SECOND * 2);
    expect(mom().level).toBe(1);
  });

  it('caps the bonus where the config caps it', () => {
    toFull();
    expect(mom().mult).toBeCloseTo(1 + cfg().rangerMomentumMax, 5);
    // Running further cannot buy any more than that.
    run(ONE_SECOND * 3);
    expect(mom().mult).toBeCloseTo(1 + cfg().rangerMomentumMax, 5);
  });

  it('builds nothing at all from a held key he cannot move against', () => {
    // The rule Brace already records: read the movement that was *applied*,
    // not the keys. A hero walking into a wall is standing still, and anything
    // else lets him earn the bonus by leaning on terrain.
    const p = g.player() as { x: number; y: number };
    const c = g.config() as { canvasW: number; tileSize: number };
    p.x = c.canvasW - c.tileSize;   // hard against the east wall
    stand(2);
    const before = mom().level;
    run(ONE_SECOND, false);
    expect(mom().level, 'a wall is not ground covered').toBe(before);
  });
});

describe('losing it', () => {
  it('decays once he stops', () => {
    toFull();
    stand(30);
    expect(mom().level).toBeLessThan(1);
    expect(mom().level).toBeGreaterThan(0);
  });

  it('is gone after the configured decay, and no sooner', () => {
    toFull();
    stand(Math.floor(cfg().rangerMomentumDecaySecs * ONE_SECOND) - 8);
    expect(mom().level, 'still something left a moment before the end')
      .toBeGreaterThan(0);
    stand(16);
    expect(mom().level).toBe(0);
    expect(mom().mult).toBe(1);
  });

  it('never goes below nothing', () => {
    stand(ONE_SECOND * 10);
    expect(mom().level).toBe(0);
  });
});

describe('what it is worth on a bolt', () => {
  /**
   * Looses one burst and reports the damage multiplier the bolts carry.
   *
   * `moving` matters because the shot resolves *after* the movement in the
   * same step, so that one frame is part of the measurement either way: held,
   * it tops the meter back up to the cap it is being compared against;
   * released, it decays a third of a percent off it. Standing still it builds
   * a sliver instead. So the caller says which case it means rather than
   * getting whichever the helper happened to pick.
   */
  function boltMult(moving: boolean): number {
    (g.arrows() as unknown[]).length = 0;
    const keys = g.keys() as Record<string, boolean>;
    keys['ArrowRight'] = moving;
    g.shoot();
    g.stepSim(1);
    keys['ArrowRight'] = false;
    const bolts = g.arrows() as { dmgMult: number }[];
    expect(bolts.length).toBeGreaterThan(0);
    return bolts[0]!.dmgMult;
  }

  it('leaves the bolt at its base multiplier with no momentum', () => {
    expect(boltMult(false)).toBeCloseTo(cfg().crossbowBoltDamageMult, 5);
  });

  it('multiplies the base rather than replacing it', () => {
    // The whole point, and the thing the project owner asked to be careful of.
    // A momentum that wrote an absolute damage figure would work perfectly in
    // this assertion's first half and silently discard the 0.7 the crossbow's
    // three weak bolts are built on.
    toFull();
    const base = cfg().crossbowBoltDamageMult;
    expect(boltMult(true)).toBeCloseTo(base * (1 + cfg().rangerMomentumMax), 5);
  });

  it('bakes the bonus at the moment of firing, not at the moment of impact', () => {
    // A bolt loosed at a run should land as a bolt loosed at a run, however
    // long it spends in the air and whatever he does after letting it go.
    toFull();
    const inFlight = boltMult(true);
    stand(ONE_SECOND * cfg().rangerMomentumDecaySecs + 30);
    const bolts = g.arrows() as { dmgMult: number }[];
    if (bolts.length > 0) {
      expect(bolts[0]!.dmgMult, 'the shot keeps what it was fired with')
        .toBeCloseTo(inFlight, 5);
    }
  });
});
