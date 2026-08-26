/**
 * Chain detonation: the sapper's pouch as one weapon.
 *
 * His piercing shot already detonated one of his own bombs, so half a combo
 * system existed and needed a shot threaded through it to reach. Chaining
 * finishes it — a bomb going off lights every other bomb near it, and those
 * light the next.
 *
 * Two things make it worth testing rather than eyeballing. It is recursive in
 * spirit, so the failure mode is a pair of bombs relighting each other forever
 * and never going off; and its boss bonus is the entire reason it exists at
 * all, since every ordinary enemy has one hit point and dies to anything, so
 * against a crowd a chain is worth exactly its coverage and nothing more.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ONE_SECOND, clearArena, stepPast } from './arena-testkit';
import { devHooks as g } from './game.js';

interface Bomb { kind: string; x: number; y: number; life: number; lit: boolean; link: number }

const chain = (): Bomb[] => g.chain() as Bomb[];
const cfg = (): { sapperChainRadius: number; sapperChainDelaySecs: number;
                  sapperChainBossBonus: number; sapperChainMaxLinks: number;
                  dynamiteBossDamage: number; sapperBombLifetime: number } => g.config();

/** Puts `n` bombs in a line, each a comfortable step inside chain reach. */
function bombLine(n: number, gapFraction = 0.6): Bomb[] {
  const p = g.player() as { x: number; y: number; aimAngle: number };
  const gap = cfg().sapperChainRadius * gapFraction;
  const live = g.dynamites() as { kind: string; x: number; y: number; life: number;
                                  vx: number; vy: number; element: string }[];
  live.length = 0;
  for (let i = 0; i < n; i++) {
    live.push({
      kind: 'bomb', x: p.x + 120 + i * gap, y: p.y, vx: 0, vy: 0,
      life: cfg().sapperBombLifetime, element: 'none',
    });
  }
  return chain();
}

/** Sets the first bomb's fuse to nothing, so the next step starts the cascade. */
function lightTheFirst(): void {
  const live = g.dynamites() as { life: number }[];
  if (live[0]) live[0].life = 0.0001;
}

beforeEach(() => {
  for (const k of Object.keys(g.keys() as Record<string, boolean>)) {
    (g.keys() as Record<string, boolean>)[k] = false;
  }
  g.takeClock();
  g.pick('sapper');
  g.go('playing');
  g.generateMap('forest');
  // Open ground: a bomb that lands in water is removed without exploding, so
  // on a generated map every count here is a question about where the ponds are.
  clearArena();
  g.healHero();
  g.stepSim(1);
});

describe('a chain runs', () => {
  it('sets off the whole line from one bomb', () => {
    bombLine(4);
    lightTheFirst();
    stepPast(ONE_SECOND);
    expect(chain().length, 'every bomb in reach went off').toBe(0);
  });

  it('leaves a bomb out of reach standing', () => {
    // Two clusters: three in reach of each other, one well beyond. Placed by
    // hand rather than by bombLine, because the whole point is the gap.
    const p = g.player() as { x: number; y: number };
    const live = g.dynamites() as { kind: string; x: number; y: number; life: number;
                                    vx: number; vy: number; element: string }[];
    live.length = 0;
    const near = cfg().sapperChainRadius * 0.5;
    for (const dx of [120, 120 + near, 120 + near * 2]) {
      live.push({ kind: 'bomb', x: p.x + dx, y: p.y, vx: 0, vy: 0,
                  life: cfg().sapperBombLifetime, element: 'none' });
    }
    live.push({ kind: 'bomb', x: p.x + 120 + cfg().sapperChainRadius * 4, y: p.y,
                vx: 0, vy: 0, life: 60, element: 'none' });

    lightTheFirst();
    stepPast(ONE_SECOND);
    expect(chain().length, 'the far bomb is untouched').toBe(1);
  });

  it('staggers rather than going off on one frame', () => {
    // A cascade that resolved in a single step is one loud blast, and the whole
    // appeal is hearing it run.
    bombLine(4);
    lightTheFirst();
    stepPast(2);
    const left = chain().length;
    expect(left, 'some but not all have gone').toBeGreaterThan(0);
    expect(left).toBeLessThan(4);
  });

  it('clears a pack where every bomb is in reach of every other', () => {
    bombLine(6, 0.2);
    lightTheFirst();
    stepPast(ONE_SECOND * 2);
    expect(chain().length).toBe(0);
  });

  it('does not pay him extra for piling them up', () => {
    // A ratchet, cut against a measurement, and the guard on the one thing
    // this mechanic could quietly become: free damage for the easiest input
    // the sapper has, which is standing still and dropping bombs on his feet.
    //
    // Six bombs in a line, each well inside the next one's reach, do 20.4 to a
    // boss as this is written. Removing the lit-once guard in chainNearbyBombs
    // -- so every blast promotes its neighbours a link deeper again -- takes
    // the same six to 32.4, a 59% bonus bought by doing nothing. 25 sits
    // between the two.
    //
    // Spaced rather than stacked on purpose: co-located bombs all go off as
    // one generation and the guard makes no difference to them, so a stacked
    // arrangement would pass whether the guard was there or not.
    expect(bossDamageFromPack(6, 0.15)).toBeLessThan(25);
  });
});

/**
 * Total boss damage from lighting `n` bombs, all sitting on the boss.
 *
 * Every bomb on the same point, so distance decides nothing and the only
 * variable left is which link of the chain each one goes off as.
 */
function bossDamageFromPack(n: number, gapFraction = 0): number {
  g.spawnBossNow(1);
  g.go('boss_fight');
  const b = g.boss() as { bstate: string; shield: boolean; hp: number; hpMax: number;
                          x: number; y: number };
  b.bstate = 'orbit';
  b.shield = false;
  // Far more health than the chain can spend. At his real 10 the boss dies
  // partway through and the total saturates there, so every arrangement scores
  // 10 and the measurement stops measuring anything.
  b.hp = 100000;
  b.hpMax = 100000;
  const before = b.hp;

  // `gapFraction` 0 stacks them all on the boss, which takes distance out of
  // the measurement entirely and leaves the chain link as the only variable.
  // A real spacing puts them in a line away from him, which is what a thrown
  // pouch actually looks like and the only arrangement in which a bomb can be
  // reached by more than one blast in turn.
  const gap = cfg().sapperChainRadius * gapFraction;
  const live = g.dynamites() as { kind: string; x: number; y: number; life: number;
                                  vx: number; vy: number; element: string }[];
  live.length = 0;
  for (let i = 0; i < n; i++) {
    live.push({ kind: 'bomb', x: b.x + i * gap, y: b.y, vx: 0, vy: 0,
                life: cfg().sapperBombLifetime, element: 'none' });
  }
  lightTheFirst();
  // The shield is cleared every step: the Crow King raises it on his own timer,
  // and a chain that ran into it would be measuring his cooldown rather than
  // its own links.
  for (let i = 0; i < ONE_SECOND; i++) {
    const boss = g.boss() as { shield: boolean } | null;
    if (boss) boss.shield = false;
    while (g.hitstop() > 0) g.stepSim(1);
    g.stepSim(1);
  }
  const after = (g.boss() as { hp: number } | null)?.hp ?? 0;
  return before - after;
}

describe('what a link is worth', () => {
  it('hits a boss harder as the chain runs than a single bomb does', () => {
    // The reason it exists. Against a crowd a chain is worth its coverage and
    // nothing else, because everything out there dies to one hit of anything.
    const one = bossDamageFromPack(1);
    const three = bossDamageFromPack(3);
    expect(one).toBeGreaterThan(0);
    expect(three, 'three chained bombs beat three times one bomb')
      .toBeGreaterThan(one * 3);
  });

  it('caps the bonus rather than letting a full pouch end a boss', () => {
    const max = cfg().sapperChainMaxLinks;
    const perLink = cfg().sapperChainBossBonus;
    // Stated here so the ceiling is checkable: the last link a chain can reach
    // is worth this much of a lone bomb, and no arrangement buys more.
    expect(1 + max * perLink).toBeCloseTo(3.5, 5);
  });
});
