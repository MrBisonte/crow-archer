/**
 * Bloodlust, and the double hit it sits on top of.
 *
 * The knight is the only hero who has to be in contact to do anything at all,
 * so what is hard about him is not reaching a fight but staying in one.
 * Bloodlust pays for exactly that: a swing that connects banks a stack, a
 * swing that hits nothing empties him.
 *
 * The spear's second boss hit is checked here too, because Bloodlust multiplies
 * it and the two were broken together. `knightSpearPhase2Hit` was reset at the
 * start of a *run* and never per swing, so the half of the swing the manual
 * sells as "lands twice" — and that docs/balance.md prices a swing at — landed
 * once per run and never again.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { clearArena, stepPast } from './arena-testkit';
import { devHooks as g } from './game.js';

interface Bloodlust { stacks: number; mult: number; connected: boolean; cooldown: number }

const lust = (): Bloodlust => g.bloodlust() as Bloodlust;
const cfg = (): { knightSpearCooldown: number; knightSpearSwingDuration: number;
                  knightBloodlustMax: number; knightBloodlustPer: number;
                  knightSpearRange: number } => g.config();

/** A body planted just inside the spear's reach, straight down +x. */
function targetInReach(): void {
  const p = g.player() as { x: number; y: number; aimAngle: number };
  p.aimAngle = 0;
  g.spawnSkeleton();
  const s = (g.skeletons() as { x: number; y: number }[]).at(-1);
  if (s) { s.x = p.x + cfg().knightSpearRange * 0.7; s.y = p.y; }
}

/** Clears the field so a swing meets nothing at all. */
function emptyField(): void {
  (g.skeletons() as unknown[]).length = 0;
  (g.crows() as unknown[]).length = 0;
}

/**
 * One full swing: the press, then far enough for the swing to finish.
 *
 * `stepPast` rather than `stepSim`, and it is load-bearing: a swing that kills
 * something triggers an impact freeze, which spends frames without advancing
 * the swing. Counted in frames this read zero stacks off a swing that had
 * plainly connected, and looked like the mechanic was broken.
 */
function swing(): void {
  g.shoot();
  stepPast(Math.ceil(cfg().knightSpearSwingDuration * 60) + 2);
}

/** Waits out whatever cooldown the current stack count has earned. */
function waitForNextSwing(): void {
  stepPast(Math.ceil(cfg().knightSpearCooldown * 60) + 2);
}

beforeEach(() => {
  for (const k of Object.keys(g.keys() as Record<string, boolean>)) {
    (g.keys() as Record<string, boolean>)[k] = false;
  }
  g.takeClock();
  g.pick('knight');
  g.go('playing');
  g.generateMap('forest');
  // Open ground: a generated map decides where bodies can stand, which would
  // make every count here a question about the terrain.
  clearArena();
  g.healHero();
  emptyField();
  g.stepSim(1);
});

describe('stacking', () => {
  it('banks a stack for a swing that connects', () => {
    expect(lust().stacks).toBe(0);
    targetInReach();
    swing();
    expect(lust().stacks).toBe(1);
  });

  it('stops at the configured maximum', () => {
    for (let i = 0; i < cfg().knightBloodlustMax + 3; i++) {
      targetInReach();
      swing();
      waitForNextSwing();
    }
    expect(lust().stacks).toBe(cfg().knightBloodlustMax);
  });

  it('empties on a swing that hits nothing, however many were banked', () => {
    targetInReach();
    swing();
    waitForNextSwing();
    targetInReach();
    swing();
    waitForNextSwing();
    expect(lust().stacks).toBe(2);

    emptyField();
    swing();
    expect(lust().stacks, 'one whiff costs the lot').toBe(0);
  });

  it('counts a hit landed early in the swing, not only one still in reach at the end', () => {
    // The thrust sweeps: a body caught at full reach is out of the hit test by
    // the recovery frames, so asking "is anything in range now" at the end
    // would empty him after a swing that plainly connected.
    targetInReach();
    g.shoot();
    stepPast(2);
    emptyField();
    stepPast(Math.ceil(cfg().knightSpearSwingDuration * 60) + 2);
    expect(lust().stacks).toBe(1);
  });
});

describe('what the stacks are worth', () => {
  it('multiplies by the configured step per stack', () => {
    expect(lust().mult).toBe(1);
    targetInReach();
    swing();
    expect(lust().mult).toBeCloseTo(1 + cfg().knightBloodlustPer, 5);
  });

  it('shortens the interval as a rate, not as a subtraction', () => {
    // "+10% attack speed" divides the interval rather than taking a tenth off
    // it, so three stacks is 1.0 / 1.3 = 0.77 s and not 0.70.
    targetInReach();
    swing();
    const expected = cfg().knightSpearCooldown / (1 + cfg().knightBloodlustPer);
    waitForNextSwing();
    targetInReach();
    g.shoot();
    stepPast(1);
    expect(lust().cooldown).toBeGreaterThan(expected - 0.1);
    expect(lust().cooldown).toBeLessThan(cfg().knightSpearCooldown);
  });

  it('reaches the roster figure at a full stack', () => {
    // Damage and speed take the same figure and multiply each other, so a full
    // stack is 1.3 x 1.3 on damage per second. Worth stating once here so the
    // balance table has something to be checked against.
    const full = 1 + cfg().knightBloodlustMax * cfg().knightBloodlustPer;
    expect(full).toBeCloseTo(1.3, 5);
    expect(full * full).toBeCloseTo(1.69, 5);
  });
});

describe('the spear lands twice on every swing, not once per run', () => {
  /**
   * Counts boss hits over one swing, holding the boss in reach throughout.
   *
   * Re-planted every frame rather than placed once. A boss flies its own
   * pattern, so a position written onto it is gone by the next step — the same
   * trap docs/character-rebuild-playbook.md records for crows — and the two
   * halves of this swing land a fifth of a second apart. Placed once, the
   * first hit lands and the second measures where the boss wandered to.
   */
  function bossHitsInOneSwing(): number {
    let hits = 0;
    const off = g.onEvent((e: { type: string; source?: string }) => {
      if (e.type === 'BOSS_HIT' && e.source === 'spear') hits += 1;
    });
    const p = g.player() as { x: number; y: number; aimAngle: number };
    const plant = (): void => {
      const b = g.boss() as { x: number; y: number; shield: boolean } | null;
      if (!b) return;
      b.shield = false;
      b.x = p.x + cfg().knightSpearRange * 0.6;
      b.y = p.y;
    };
    p.aimAngle = 0;
    plant();
    g.shoot();
    for (let i = 0; i < Math.ceil(cfg().knightSpearSwingDuration * 60) + 2; i++) {
      while (g.hitstop() > 0) { plant(); g.stepSim(1); }
      plant();
      g.stepSim(1);
    }
    if (typeof off === 'function') off();
    return hits;
  }

  it('lands both halves on the second swing as well as the first', () => {
    // Order matters twice over. transitionTo('boss_fight') writes onto the
    // boss, so it has to exist first; and bossInPlay() refuses a target
    // outside that state, so in ordinary play the spear passes straight
    // through the Crow King and this test measures nothing at all.
    g.spawnBossNow(1);
    g.go('boss_fight');
    (g.boss() as { bstate: string }).bstate = 'orbit';
    g.stepSim(1);
    const first = bossHitsInOneSwing();
    waitForNextSwing();
    const second = bossHitsInOneSwing();

    expect(first, 'the first swing always worked').toBe(2);
    // This is the assertion the bug failed. knightSpearPhase2Hit latched true
    // on the first swing of a run and was never cleared, so every swing after
    // it was worth half what the manual advertises.
    expect(second, 'and so does every swing after it').toBe(2);
  });
});
