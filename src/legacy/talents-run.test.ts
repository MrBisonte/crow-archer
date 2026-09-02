/**
 * The talent system's wiring: mastery paid by real milestones, and drafted
 * talents reaching the figures the wizard's kit actually runs on.
 *
 * The tree arithmetic is pinned pure in sim/talents.test.ts; nothing here
 * re-checks a price or a threshold. What this file holds is the seams —
 * that a boss dying through the real death sequence banks mastery, that a
 * drafted LONG STEP moves the player further on a real blink, that FOCUS
 * DEPTH raises the ceiling the regen actually clamps to, and that the two
 * capstones change the storm and the bolt the way the rite promises.
 *
 * Grants persist across tests inside one run of this file (the bank is
 * module state, exactly like the FEATHERS wallet), so every test grants what
 * it needs and measures deltas — none assumes an empty bank.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { CHARACTERS } from '../net/protocol';
import { CHAR_TREES, RANK_THRESHOLDS } from '../sim/talents';
import { rowAt } from '../render/list-rows';
import { ONE_SECOND, aimAt, clearArena, stepPast } from './arena-testkit';
import { devHooks as g } from './game.js';

/** Drives the same `keys` map a keyboard drives, one frame per press — the
 *  helper game.test.ts uses, for the reason it gives: dispatching a real
 *  KeyboardEvent needs a browser and this suite runs under node. */
function press(key: string): void {
  (g.keys() as Record<string, boolean>)[key] = true;
  g.stepSim(1);
}

interface TalentState { mastery: number; levels: Record<string, number> }
interface Talents {
  state: () => TalentState;
  award: (milestone: string) => void;
  grant: (id: string, level: number) => void;
  draft: (id: string) => void;
  drafted: () => string[];
  sealCapstone: (id: string) => void;
  resetRun: () => void;
  buy: (id: string) => { kind: string };
  blinkDistance: () => number;
  stormRadius: () => number;
  focusMax: () => number;
  stormCooldown: () => number;
  stat: (id: string) => number;
  held: (id: string) => boolean;
  grantMastery: (points: number) => void;
  purse: () => number;
  cursor: () => number;
  moveCursor: (dir: number) => void;
  setCursor: (i: number) => void;
  buyCurrent: () => { kind: string } | null;
  lastBuy: () => { kind: string } | null;
}

const talents = (): Talents => g.talents() as unknown as Talents;

interface Focus { points: number; spendable: number; max: number; melee: string }
const focus = (): Focus => g.focus() as unknown as Focus;

/** Straight-line displacement of the player since `from` — the default aim
 * is diagonal, so a single axis under-reports a blink by cos 45. */
function movedSince(from: { x: number; y: number }): number {
  const p = g.player() as { x: number; y: number };
  return Math.hypot(p.x - from.x, p.y - from.y);
}
const playerAt = (): { x: number; y: number } => {
  const p = g.player() as { x: number; y: number };
  return { x: p.x, y: p.y };
};

/** Sets the pool to an exact number of points, so a spend reads clean. */
function setFocus(points: number): void {
  (g.inv() as { focus: number }).focus = points;
}

/** Empties the field and parks one crow at an exact spot from the player —
 * the forest opens with its own flock, which would drown a one-crow count. */
function parkCrowAt(dx: number): { hp: number } {
  (g.crows() as unknown[]).length = 0;
  g.spawnCrow();
  const p = g.player() as { x: number; y: number };
  const c = (g.crows() as { x: number; y: number; hp: number }[])[0]!;
  c.x = p.x + dx; c.y = p.y;
  return c;
}

beforeEach(() => {
  for (const k of Object.keys(g.keys() as Record<string, boolean>)) {
    (g.keys() as Record<string, boolean>)[k] = false;
  }
  g.takeClock();
  g.pick('wizard');
  // Zero every ladder before entering play: grants persist across tests, and
  // a non-empty pool would open the run-start draft over this beforeEach.
  for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 0);
  g.go('playing');
  g.generateMap('forest');
  // Open ground: a blink refuses a hop with no room, and the storm tests
  // park a crow at an exact range.
  clearArena();
  g.healHero();
  g.stepSim(1);
});

describe('LONG STEP reaches the blink', () => {
  it('blinks the base distance with nothing drafted', () => {
    const from = playerAt();
    g.blink();
    expect(movedSince(from)).toBeCloseTo(g.config().wizBlinkDistance, 6);
  });

  it('blinks no further merely for owning it — undrafted is the base', () => {
    talents().grant('blinkReach', 2);
    const from = playerAt();
    g.blink();
    expect(movedSince(from)).toBeCloseTo(g.config().wizBlinkDistance, 6);
  });

  it('blinks 40 px further with two levels drafted', () => {
    talents().grant('blinkReach', 2);
    talents().draft('blinkReach');
    const from = playerAt();
    g.blink();
    expect(movedSince(from)).toBeCloseTo(g.config().wizBlinkDistance + 40, 6);
  });
});

/**
 * A talent that scales a CONFIG key does nothing wherever that key is still
 * read straight.
 *
 * `TALENTS.STATS` says which CONFIG number each talent moves, and `stat(id)`
 * returns the base plus what this run drafted. But nothing makes the CODE use
 * it: a call site left reading `CONFIG.thatKey` keeps the base forever, and
 * the talent is bought, drawn, described and inert. It fails silently in
 * both directions — a stat wired for damage but not for the telegraph draws a
 * lie, and one wired for the sim but not the HUD reports a lie.
 *
 * That is not hypothetical. FULL TILT has raised the ranger's momentum
 * ceiling since the talent pilot, and `rangerMomentumMult` read it correctly,
 * but the HUD chip and the dev hook both still divided by the base — so a
 * ranger at +45% was told +30%. This test is what found it.
 *
 * Source text rather than behaviour on purpose: the failure is the ABSENCE of
 * a call, and there is no frame in which an absent call misbehaves. Comment
 * lines are dropped first, since naming a key in prose is how the reasons get
 * written down.
 */
describe('every talent stat reaches its call sites', () => {
  const legacy = readFileSync(resolve(fileURLToPath(import.meta.url), '../game.js'), 'utf8');

  /**
   * Keys a live call site may still read straight, and why.
   *
   * An entry here is a claim that the base figure is the right answer for
   * that reader — not that the talent is unfinished.
   */
  const ALLOWED: Readonly<Record<string, string>> = {
    // The knight's charge chains on the same window the wizard's blink does,
    // deliberately, so both hands learn one rhythm. HELD STEP is keyed on it,
    // and only the wizard's reading is talent-aware: routing the knight
    // through stat() would let a wizard talent widen a knight's chain.
    shiftChainSecs: "the knight's charge shares the base window on purpose",
  };

  /** Every CONFIG key TALENTS.STATS claims a talent moves. */
  function statKeys(): string[] {
    const table = legacy.slice(legacy.indexOf('  const STATS = {'));
    const end = table.indexOf('};');
    return [...table.slice(0, end).matchAll(/key: '(\w+)'/g)].map((m) => m[1]!);
  }

  /** Lines that read `CONFIG.<key>` as code, past the CONFIG block itself. */
  function directReads(key: string): string[] {
    const lines = legacy.split('\n');
    const declaredBefore = lines.findIndex((l) => l.includes('let inv    = {}'));
    return lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line, n }) =>
        n > declaredBefore
        && !line.startsWith('//') && !line.startsWith('*')
        && line.includes(`CONFIG.${key}`)
        && !line.slice(0, line.indexOf(`CONFIG.${key}`)).includes('//'))
      .map(({ line, n }) => `${n}: ${line}`);
  }

  it('has at least one stat wired, or this test is checking nothing', () => {
    expect(statKeys().length).toBeGreaterThan(10);
  });

  it('reads no talent-scaled key straight, outside the allowlist', () => {
    for (const key of statKeys()) {
      if (key in ALLOWED) continue;
      expect(directReads(key), `${key} is scaled by a talent but still read raw`).toEqual([]);
    }
  });

  // An allowlist that outlives the reason for it is worse than none: it goes
  // on excusing a call site nobody has looked at in a year.
  it('keeps no allowlist entry that has nothing left to excuse', () => {
    for (const key of Object.keys(ALLOWED)) {
      expect(directReads(key), `${key} is allowlisted but no longer read raw`)
        .not.toEqual([]);
    }
  });
});

/**
 * The eight talents that brought archer, knight, ranger and sapper up to the
 * wizard's shape.
 *
 * Two halves, and neither is enough alone. The table below says each talent's
 * figure actually MOVES when it is owned and drafted, which is the sim.js side
 * of it; `every talent stat reaches its call sites` above says no call site is
 * still reading the base, which is the game.js side. A talent needs both to do
 * anything, and each fails in a way the other cannot see.
 *
 * The three with a one-line observable get one as well, because a count of
 * bolts on the field is worth more than a number in a table.
 */
/**
 * The four third capstones, one per hero, each on the tool that hero's other
 * two rites do not touch.
 *
 * Every one of them is a RULE rather than a figure, so none can be checked by
 * asking TALENTS what a number is. What each test does is run the tool twice
 * -- once with the rite sealed and once without -- and assert on what the sim
 * actually did with it.
 */
describe('the third rite of the four heroes who had two', () => {
  /** Seals `id` for this run, after clearing whatever the last test sealed. */
  function seal(char: string, id: string): void {
    talents().resetRun();
    g.pick(char);
    g.go('playing');
    clearArena();
    g.healHero();
    talents().sealCapstone(id);
  }

  function plain(char: string): void {
    talents().resetRun();
    g.pick(char);
    g.go('playing');
    clearArena();
    g.healHero();
  }

  describe('DEAD EYE', () => {
    /** A full brace and a full draw, loosed. Returns the cooldown it left. */
    function perfectShot(): number {
      (g.inv() as { arrows: number }).arrows = 20;
      // The brace fills only while he is standing still, and nothing in this
      // harness is holding a key, so stepping IS standing still.
      stepPast(Math.ceil(ONE_SECOND * (g.config().braceFillSecs as number + 0.4)));
      expect((g.brace() as { level: number }).level, 'he never finished bracing').toBe(1);
      g.shift();
      g.holdDraw(2);                    // backdated: a full draw without the wait
      g.shiftUp();
      return (g.archerDraw() as { cooldown: number }).cooldown;
    }

    it('costs the full cooldown without the rite', () => {
      plain('archer');
      expect(perfectShot()).toBeCloseTo(g.config().archerPowerCooldown as number, 3);
    });

    it('costs nothing with it', () => {
      seal('archer', 'deadEye');
      expect(perfectShot()).toBe(0);
    });

    // The half that makes it a rite rather than a switch: the refund is bought
    // with the standing still, so a shot that skipped either half still pays.
    it('still costs the full cooldown for a tapped draw', () => {
      seal('archer', 'deadEye');
      (g.inv() as { arrows: number }).arrows = 20;
      stepPast(Math.ceil(ONE_SECOND * (g.config().braceFillSecs as number + 0.4)));
      g.shift();
      g.holdDraw(0);                    // braced, but loosed at once
      g.shiftUp();
      expect((g.archerDraw() as { cooldown: number }).cooldown)
        .toBeCloseTo(g.config().archerPowerCooldown as number, 3);
    });
  });

  describe('BULWARK', () => {
    /** Swings the spear into a parked skeleton until Bloodlust shows a stack. */
    function buildAStack(): number {
      g.spawnSkeleton('normal');
      const sk = (g.skeletons() as { x: number; y: number; hp: number }[]);
      const p = g.player() as { x: number; y: number };
      aimAt(p.x + 200, p.y);
      // Re-parked every frame. A skeleton left alone walks out of the 80 px
      // the spear reaches between one swing and the next, and a swing that
      // connects with nothing is the exact thing that resets Bloodlust -- so
      // a harness that parks it once measures the reset, not the stack.
      for (let i = 0; i < 240 && (g.bloodlust() as { stacks: number }).stacks === 0; i++) {
        for (const s of sk) { s.x = p.x + 70; s.y = p.y; s.hp = 99; }
        g.shoot();
        stepPast(1);
      }
      // Parked at 70: inside the spear's 80 and outside its own reach, so it
      // feeds swings without hitting back. Cleared afterwards all the same --
      // the guard is what the next helper measures, and a skeleton left
      // standing there spends it before the test does.
      (g.skeletons() as unknown[]).length = 0;
      g.healHero();
      return (g.bloodlust() as { stacks: number }).stacks;
    }

    /** Waits for the guard to come up, then takes two hits. */
    function twoHits(): { lost: number; stacks: number } {
      stepPast(Math.ceil(ONE_SECOND * (g.config().knightBlockCooldown as number + 1)));
      const before = g.hp() as number;
      g.hurtHero(1);
      // damagePlayer drops everything while playerHitFlash runs, so two calls
      // in one frame are one hit however the guard resolved the first.
      stepPast(Math.ceil(ONE_SECOND * (g.config().playerHitFlashSecs as number + 0.05)));
      g.hurtHero(1);
      return { lost: before - (g.hp() as number),
               stacks: (g.bloodlust() as { stacks: number }).stacks };
    }

    it('lets the second hit through without the rite', () => {
      plain('knight');
      expect(buildAStack(), 'no stack, so the test proves nothing').toBeGreaterThan(0);
      expect(twoHits().lost, 'the guard blocks one and one lands').toBe(1);
    });

    it('blocks both, and a stack pays for it', () => {
      seal('knight', 'bulwark');
      const had = buildAStack();
      expect(had).toBeGreaterThan(0);
      const after = twoHits();
      expect(after.lost, 'the guard came straight back').toBe(0);
      expect(after.stacks, 'and blood paid for it').toBe(had - 1);
    });

    it('cannot pay with no blood, so the second hit lands', () => {
      seal('knight', 'bulwark');
      expect((g.bloodlust() as { stacks: number }).stacks).toBe(0);
      expect(twoHits().lost).toBe(1);
    });
  });

  describe('HOLDFAST', () => {
    /** Parks a spearman in reach, nets him, and reports what one bolt took. */
    function netThenHit(): number {
      g.spawnSoldier('spearman');
      const sold = g.soldiers() as { x: number; y: number; hp: number; heldTimer: number }[];
      const p = g.player() as { x: number; y: number };
      const reach = g.config().netThrowMin as number;
      aimAt(p.x + reach * 3, p.y);
      g.shift();
      g.holdNet(0);                     // a tapped net: it only has to land
      g.shiftUp();
      // Pinned to the landing point for the whole flight: a tapped net lands
      // at netThrowMin and takes a third of a second to fly there, and an
      // aggroed spearman covers 30 px in that time.
      for (let i = 0; i < 60; i++) {
        for (const s of sold) { s.x = p.x + reach; s.y = p.y; s.hp = 40; }
        stepPast(1);
      }
      expect(sold[0]!.heldTimer, 'the net never caught him').toBeGreaterThan(0);
      const before = sold[0]!.hp;
      g.damageSoldier(0, 1);
      return before - sold[0]!.hp;
    }

    it('a held body takes a plain hit without the rite', () => {
      plain('ranger');
      expect(netThenHit()).toBeCloseTo(1, 4);
    });

    it('and takes double with it', () => {
      seal('ranger', 'holdfast');
      expect(netThenHit()).toBeCloseTo(g.config().rangerHoldfastMult as number, 4);
    });

    // The rite is about the NET, and a boss can be dazed by a stun as well.
    it('does not double for a body that is merely stunned', () => {
      seal('ranger', 'holdfast');
      g.spawnSoldier('spearman');
      const sold = g.soldiers() as { x: number; y: number; hp: number; heldTimer: number }[];
      const p = g.player() as { x: number; y: number };
      for (const s of sold) { s.x = p.x + 40; s.y = p.y; s.hp = 40; s.heldTimer = 0; }
      const before = sold[0]!.hp;
      g.damageSoldier(0, 1);
      expect(before - sold[0]!.hp).toBeCloseTo(1, 4);
    });
  });

  describe('MINEFIELD', () => {
    /** Throws a fan into empty ground and waits out its fuse. */
    function fanIntoNothing(): { kind: string; mine?: boolean }[] {
      (g.barrageBombs() as unknown[]).length = 0;
      g.barrage();
      expect((g.barrageBombs() as unknown[]).length, 'the fan never left').toBeGreaterThan(0);
      stepPast(Math.ceil(ONE_SECOND * (g.config().sapperBarrageLifetime as number + 0.3)));
      return g.barrageBombs() as { kind: string; mine?: boolean }[];
    }

    it('a fan that touches nothing is spent without the rite', () => {
      plain('sapper');
      expect(fanIntoNothing().length).toBe(0);
    });

    it('and stays on the ground armed with it', () => {
      seal('sapper', 'minefield');
      const left = fanIntoNothing();
      expect(left.length).toBe(g.config().sapperBarrageCount as number);
      expect(left.every((b) => b.mine === true), 'left lying but not armed').toBe(true);
    });

    it('and a mine answers to something walking near it', () => {
      seal('sapper', 'minefield');
      const live = fanIntoNothing() as unknown as { x: number; y: number }[];
      const armed = live.length;
      expect(armed).toBeGreaterThan(0);
      // A snapshot, because `live` is the array under test: comparing its
      // length with itself after a frame compares four with four forever.
      const at = { x: live[0]!.x, y: live[0]!.y };
      g.spawnSkeleton('normal');
      const sk = g.skeletons() as { x: number; y: number }[];
      for (const s of sk) { s.x = at.x; s.y = at.y; }
      stepPast(4);
      expect((g.barrageBombs() as unknown[]).length,
             'it sat there while something stood on it').toBeLessThan(armed);
    });
  });
});

describe('the four trees levelled up to the wizard\'s shape', () => {
  /** Owns every level of `id` and wakes it for this run. */
  function take(char: string, id: string, levels: number): void {
    g.pick(char);
    g.go('playing');
    clearArena();
    g.healHero();
    talents().grant(id, levels);
    talents().draft(id);
  }

  const MOVED: ReadonlyArray<{
    char: string; id: string; levels: number; from: string; delta: number;
  }> = [
    { char: 'archer', id: 'longThrow', levels: 2, from: 'dynamiteSpeed', delta: 96 },
    { char: 'archer', id: 'fullDraw', levels: 1, from: 'archerDrawMaxSecs', delta: -0.25 },
    { char: 'knight', id: 'towerGuard', levels: 2, from: 'knightBlockCooldown', delta: -4 },
    { char: 'knight', id: 'longReach', levels: 1, from: 'knightSpearRange', delta: 12 },
    { char: 'ranger', id: 'wideNet', levels: 2, from: 'netRadiusBonus', delta: 16 },
    { char: 'ranger', id: 'fourthBolt', levels: 1, from: 'crossbowBoltCount', delta: 1 },
    { char: 'sapper', id: 'widerFan', levels: 2, from: 'sapperBarrageCount', delta: 2 },
    { char: 'sapper', id: 'shortFuse', levels: 1, from: 'sapperChargeCooldown', delta: -0.15 },
  ];

  for (const { char, id, levels, from, delta } of MOVED) {
    it(`${id} moves ${from} by ${delta} at ${levels} level(s)`, () => {
      const base = (g.config() as unknown as Record<string, number>)[from]!;
      g.pick(char);
      g.go('playing');
      talents().grant(id, 0);
      expect(talents().stat(id), `${id} undrafted must be the base`).toBeCloseTo(base, 6);

      take(char, id, levels);
      expect(talents().stat(id)).toBeCloseTo(base + delta, 6);
    });

    it(`${id} is inert while merely owned`, () => {
      const base = (g.config() as unknown as Record<string, number>)[from]!;
      g.pick(char);
      g.go('playing');
      talents().grant(id, levels);          // owned, never drafted
      expect(talents().stat(id)).toBeCloseTo(base, 6);
    });
  }

  it('FOURTH BOLT puts a fourth bolt on the field', () => {
    const base = g.config().crossbowBoltCount as number;

    /** One volley, on a clear field with a full quiver. */
    function volley(): number {
      (g.arrows() as unknown[]).length = 0;
      // hasShaft() gates the whole function, and a volley reserves room
      // against maxArrowsInFlight, so both have to be clear of the answer.
      (g.inv() as { arrows: number }).arrows = 20;
      stepPast(ONE_SECOND);                    // clear of the shot cooldown
      // shoot() sets the pressed flag the loop reads; nothing leaves the
      // bow until a frame actually runs.
      g.shoot();
      stepPast(1);
      return (g.arrows() as unknown[]).length;
    }

    g.pick('ranger');
    g.go('playing');
    clearArena();
    g.healHero();
    expect(volley(), 'the base volley never left').toBe(base);

    take('ranger', 'fourthBolt', 1);
    expect(volley()).toBe(base + 1);
  });

  it('WIDE NET throws a wider net at the same draw', () => {
    /** A tapped net, thrown down the sniper key the way the keyboard does. */
    function netRadius(): number {
      (g.nets() as unknown[]).length = 0;
      g.shift();
      g.holdNet(0);
      g.shiftUp();
      const net = (g.nets() as { radius: number }[])[0];
      if (net === undefined) throw new Error('no net was thrown');
      return net.radius;
    }

    g.pick('ranger');
    g.go('playing');
    clearArena();
    g.healHero();
    const plain = netRadius();

    take('ranger', 'wideNet', 2);
    stepPast(ONE_SECOND * 11);                 // clear of the 10 s net cooldown
    // To a tenth of a pixel: the draw fraction is read off a clock, so two
    // taps are never bit-identical, and the figure under test is 16.
    expect(netRadius()).toBeCloseTo(plain + 16, 1);
  });

  it('WIDER FAN puts two more bombs in a barrage', () => {
    g.pick('sapper');
    g.go('playing');
    clearArena();
    g.healHero();
    g.barrage();
    const plain = (g.barrageBombs() as unknown[]).length;
    expect(plain, 'the base barrage threw nothing').toBeGreaterThan(0);

    take('sapper', 'widerFan', 2);
    (g.barrageBombs() as unknown[]).length = 0;
    g.barrage();
    expect((g.barrageBombs() as unknown[]).length).toBe(plain + 2);
  });
});

describe('HELD STEP holds the chain window open', () => {
  it('opens the base window with nothing drafted', () => {
    g.blink();
    expect(g.wizBlink().chainWindow).toBeCloseTo(g.config().shiftChainSecs, 6);
  });

  it('adds 0.8 s with two levels drafted', () => {
    talents().grant('heldStep', 2);
    talents().draft('heldStep');
    g.blink();
    expect(g.wizBlink().chainWindow).toBeCloseTo(g.config().shiftChainSecs + 0.8, 6);
  });

  // What the talent buys, said in hops rather than in seconds: a second press
  // this late is refused without it, and the wizard has not moved.
  it('lets a hop be taken after the base window would have shut', () => {
    const late = Math.ceil(ONE_SECOND * (g.config().shiftChainSecs + 0.25));

    g.blink();
    stepPast(late);
    const refused = playerAt();
    g.blink();
    expect(movedSince(refused), 'the base window did not shut').toBe(0);

    talents().grant('heldStep', 2);
    talents().draft('heldStep');
    stepPast(ONE_SECOND * 7);            // clear of the 6 s cooldown
    g.blink();
    stepPast(late);
    const from = playerAt();
    g.blink();
    expect(movedSince(from)).toBeGreaterThan(0);
  });

  // The window is shared: the knight's charge chains on the same figure,
  // deliberately, so both hands learn one rhythm. A talent in the wizard's
  // tree that widened the knight's chain would be this line's one real way to
  // go wrong, and it is invisible from the wizard's own screen. His charge
  // reads CONFIG.shiftChainSecs straight, so what this pins is that the
  // talent never writes to the shared figure it reads.
  it('leaves the shared figure the knight chains on exactly where it was', () => {
    const before = g.config().shiftChainSecs;
    talents().grant('heldStep', 2);
    talents().draft('heldStep');

    expect(g.config().shiftChainSecs).toBe(before);
    expect(talents().stat('heldStep')).toBeCloseTo(before + 0.8, 6);
  });
});

describe('THIRD STEP adds a hop to the chain', () => {
  /** Blinks until the chain refuses, and answers how many hops it took. */
  function hopsInOneChain(): number {
    let hops = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      const from = playerAt();
      g.blink();
      if (movedSince(from) === 0) break;
      hops += 1;
      // Two frames: well inside any window here, so what ends the chain is
      // the hop count and never the clock.
      stepPast(2);
    }
    return hops;
  }

  it('chains twice with nothing drafted, which is what it shipped with', () => {
    expect(hopsInOneChain()).toBe(g.config().wizBlinkMaxHops);
  });

  it('chains three times when drafted', () => {
    talents().grant('thirdStep', 1);
    talents().draft('thirdStep');
    expect(hopsInOneChain()).toBe(g.config().wizBlinkMaxHops + 1);
  });

  it('chains twice for merely owning it — undrafted is the base', () => {
    talents().grant('thirdStep', 1);
    expect(hopsInOneChain()).toBe(g.config().wizBlinkMaxHops);
  });
});

describe('THUNDERSTEP makes arriving the attack', () => {
  /** The arrival radius every hop of the next chain reports. */
  function chainRadii(hops: number): number[] {
    const seen: number[] = [];
    g.onEvent((e: { type: string; radius?: number }) => {
      if (e.type === 'WIZARD_BLINK' && e.radius !== undefined) seen.push(e.radius);
    });
    for (let hop = 0; hop < hops; hop++) { g.blink(); stepPast(2); }
    return seen;
  }

  it('leaves an unsealed chain at the base radius, every hop', () => {
    const base = g.config().wizBlinkPulseRadius;
    expect(chainRadii(2)).toEqual([base, base]);
  });

  it('widens each hop of a sealed chain over the one before it', () => {
    talents().sealCapstone('thunderstep');
    const base = g.config().wizBlinkPulseRadius;
    const radii = chainRadii(2);

    expect(radii.length).toBe(2);
    expect(radii[0]).toBeCloseTo(base, 6);
    expect(radii[1]).toBeCloseTo(base * (1 + g.config().wizThunderstepGrowth), 6);
  });

  // The reason it is worth a rite. A chain is a real share of a boss taken
  // while moving, with an i-frame on every arrival — the answer to a fight
  // that will not let him stand and cast.
  it('takes 1 + 2 off a boss over a two-hop chain, against 1 + 1 unsealed', () => {
    function bossLostOverAChain(sealed: boolean): number {
      // A fresh fight each time: initGame resets the run layer, so the seal
      // has to come after it rather than before.
      g.go('playing');
      clearArena();
      g.go('boss_entrance');
      for (let i = 0; i < 20 && !g.boss(); i++) g.stepSim(30);
      g.go('boss_fight');
      g.healHero();
      if (sealed) talents().sealCapstone('thunderstep');

      const boss = g.boss() as { hp: number; x: number; y: number; shield?: boolean };
      boss.shield = false;                       // he opens behind one
      const before = boss.hp;
      for (let hop = 0; hop < 2; hop++) {
        // The pulse resolves where the blink LANDS, not where it left, so the
        // boss is parked on the destination rather than on the wizard — the
        // first draft of this test moved him to the departure point and
        // measured a chain that never touched him.
        const p = g.player() as { x: number; y: number };
        aimAt(p.x + 500, p.y);                   // due east, so the landing is known
        stepPast(1);                             // the aim ray reads the pointer
        boss.x = p.x + talents().stat('blinkReach');
        boss.y = p.y;
        g.blink();
        stepPast(2);
        boss.shield = false;                     // he re-shields on his own timer
      }
      return before - (g.boss() as { hp: number }).hp;
    }

    const plain = bossLostOverAChain(false);
    const sealed = bossLostOverAChain(true);

    expect(plain, 'an unsealed chain took nothing off the boss').toBeGreaterThan(0);
    expect(sealed).toBeCloseTo(plain * 1.5, 6);   // 1 + 2 against 1 + 1
  });
});

describe('FOCUS DEPTH raises the ceiling the regen clamps to', () => {
  it('caps at the base pool with nothing drafted', () => {
    stepPast(10 * ONE_SECOND);
    expect(focus().points).toBe(g.config().wizFocusMax);
  });

  it('caps one higher — and the HUD reports it — when drafted', () => {
    talents().grant('focusDepth', 1);
    talents().draft('focusDepth');
    stepPast(10 * ONE_SECOND);
    expect(focus().points).toBe(g.config().wizFocusMax + 1);
    expect(focus().max).toBe(g.config().wizFocusMax + 1);
  });
});

describe('WIDER SKY reaches the storm', () => {
  // The crow is parked between the base radius (450) and the one-level
  // radius (500): the same cast either reaches it or does not, and nothing
  // moves before the cast resolves — the storm damages synchronously.
  const EDGE = 480;

  it('leaves the edge crow alive at the base radius', () => {
    talents().grant('stormWidth', 1);
    parkCrowAt(EDGE);
    g.secondary();
    g.stepSim(1);
    expect((g.crows() as unknown[]).length).toBe(1);
  });

  it('kills the edge crow once the level is drafted', () => {
    talents().grant('stormWidth', 1);
    talents().draft('stormWidth');
    parkCrowAt(EDGE);
    g.secondary();
    g.stepSim(1);
    expect((g.crows() as unknown[]).length).toBe(0);
  });
});

describe('the rite: STORMCALLER', () => {
  it('halves the wait between storms, and only when sealed', () => {
    expect(talents().stormCooldown()).toBe(g.config().stormCooldown);
    talents().sealCapstone('stormcaller');
    expect(talents().stormCooldown()).toBe(g.config().stormCooldown / 2);
  });

  it('lets a sealed wizard cast again after half the base wait', () => {
    talents().sealCapstone('stormcaller');
    g.secondary();
    stepPast(Math.ceil((g.config().stormCooldown / 2 + 0.2) * ONE_SECOND));
    const crow = parkCrowAt(40);
    g.secondary();
    g.stepSim(1);
    expect(crow.hp).toBeLessThanOrEqual(0);
  });
});

describe('the rite: OVERCHANNEL', () => {
  it('swings the broom dry when the capstone is not sealed', () => {
    g.blink();
    setFocus(0);
    g.shoot();
    g.stepSim(1);
    expect(focus().melee).toBe('broom');
  });

  it('casts free from an empty pool inside the window a blink opens', () => {
    talents().sealCapstone('overchannel');
    g.blink();
    expect(g.wizOverchannel() as number).toBeCloseTo(g.config().wizOverchannelSecs, 3);
    setFocus(0);
    g.shoot();
    g.stepSim(1);
    // A bolt in flight from an empty pool is the whole claim: the cast
    // happened and it spent nothing (the sliver below one is regen).
    expect(g.arrows().length).toBe(1);
    expect(focus().points).toBeGreaterThanOrEqual(0);
    expect(focus().spendable).toBe(0);
  });

  it('closes the window: dry casting is the broom again once it expires', () => {
    talents().sealCapstone('overchannel');
    g.blink();
    stepPast(Math.ceil((g.config().wizOverchannelSecs + 0.3) * ONE_SECOND));
    setFocus(0);
    g.shoot();
    g.stepSim(1);
    expect(g.arrows().length, 'no bolt leaves an empty pool').toBe(0);
    expect(focus().melee).toBe('broom');
  });
});

describe('mastery is paid by real milestones', () => {
  it('banks boss_down plus stage_cleared when a stage boss dies for real', () => {
    const before = talents().state().mastery;
    g.spawnBossNow(2);
    g.go('boss_fight');
    const boss = g.boss() as { hp: number; x: number; y: number };
    boss.hp = 1;
    g.blast(boss.x, boss.y);
    // The death sequence runs 1.2 s before the tail pays out and hands off.
    stepPast(Math.ceil(1.5 * ONE_SECOND));
    expect(talents().state().mastery - before).toBe(3);
  });

  it('banks run_won at the one door into the win screen', () => {
    const before = talents().state().mastery;
    g.go('win');
    expect(talents().state().mastery - before).toBe(3);
  });
});

interface Chooser { kind: string; offers: string[]; cursor: number; resume: string }

/**
 * Kills a boss through the real death sequence, which is the only thing that
 * offers a talent choice.
 *
 * It used to be reachable far more cheaply — a run opened with a draft, so
 * `go('playing')` was enough. That opening ceremony is gone: a choice between
 * three names, offered before anything has happened, asks the player to prefer
 * one for no reason and delays the run to do it. The first boss pays for the
 * first choice now, so every test that wants a chooser has to earn one.
 *
 * The 1.5 s is the death sequence: the tail pays out at 1.2 s and hands off.
 */
function killABoss(): void {
  g.spawnBossNow(2);
  g.go('boss_fight');
  const boss = g.boss() as { hp: number; x: number; y: number };
  boss.hp = 1;
  g.blast(boss.x, boss.y);
  stepPast(Math.ceil(1.5 * ONE_SECOND));
}

describe('the choosers', () => {
  it('offers nothing at run start, however much is owned', () => {
    // The rule this replaced: a run opened on the chooser. Owning the whole
    // tree is the strongest case for a ceremony and it still must not fire.
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 1);
    g.go('menu');
    g.go('playing');
    expect(g.state(), 'the run opened on a ceremony').toBe('playing');
    expect(g.chooser()).toBeNull();
    expect(talents().drafted(), 'a run start woke a talent').toEqual([]);
  });

  it('opens the tree when the first boss pays and nothing is owned yet', () => {
    // The gap this closes, reported from a real play-through: the draft deals
    // from OWNED talents and mastery is what buys ownership, so a new player
    // killed the boss, banked the mastery and was handed straight to the next
    // stage. The pool was empty, the ceremony skipped itself, and nothing
    // invited them to spend what they had just been paid.
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 0);
    talents().grantMastery(0);
    g.go('menu');
    g.go('playing');
    expect(g.state()).toBe('playing');

    killABoss();

    expect(g.state(), 'the boss paid mastery and offered nothing').toBe('talents');
    expect((g.chooser() as unknown as Chooser).kind).toBe('tree');
    expect(talents().purse(), 'the boss paid nothing to spend').toBeGreaterThan(0);
  });

  it('hands the run back when the tree is done with', () => {
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 0);
    talents().grantMastery(0);
    g.go('menu');
    g.go('playing');
    killABoss();
    expect(g.state()).toBe('talents');

    press('b');

    // The dark archer's death leads into the dark knight's entrance, and the
    // ceremony has to give that hand-off back rather than strand the player.
    expect(g.state(), 'the tree kept the run').toBe('boss_entrance');
    expect(g.chooser()).toBeNull();
  });

  it('skips the tree when the purse can buy nothing', () => {
    // Every ladder at its top, so there is nothing to spend on. A screen
    // offering only prices the purse cannot meet is a stop with no decision.
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, t.costs.length);
    g.go('menu');
    g.go('playing');
    killABoss();

    const c = g.chooser() as unknown as Chooser | null;
    expect(c, 'a boss offered nothing at all').not.toBeNull();
    expect(c!.kind, 'the tree opened with nothing to sell').toBe('draft');
  });

  it('opens the draft once something is owned, and a pick wakes it', () => {
    // Maxed, so the tree is skipped and the draft is what a boss opens.
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, t.costs.length);
    g.go('menu');
    g.go('playing');
    killABoss();

    expect(g.state()).toBe('chooser');
    // A boss queues rite, then tree, then draft, and which of those actually
    // open depends on the mastery this character has banked -- which earlier
    // tests in this file have moved. That used to be invisible because the
    // rite sat at 18 points and nothing here ever reached it; at 8 it is
    // reachable and outranks the draft. So walk the queue to the draft rather
    // than assuming it is first.
    let c = g.chooser() as unknown as Chooser | null;
    for (let i = 0; i < 3 && c !== null && c.kind !== 'draft'; i++) {
      if (c.kind === 'tree') press('b'); else g.chooserPick(0);
      c = g.chooser() as unknown as Chooser | null;
    }
    expect(c, 'no draft followed the boss').not.toBeNull();
    expect(c!.kind).toBe('draft');
    g.chooserPick(0);
    expect(talents().drafted().length).toBe(1);
  });

  it('offers the rite, then the tree, then the draft', () => {
    for (let i = 0; i < 6; i++) talents().award('siege_cleared');   // rank 3
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 0);
    talents().grant('blinkReach', 1);
    killABoss();

    const rite = g.chooser() as unknown as Chooser;
    expect(g.state()).toBe('chooser');
    expect(rite.kind).toBe('rite');
    // The exact set, not a length: a length catches a capstone deleted and
    // misses one added, which is the rule CLAUDE.md states for tables.
    expect(rite.offers).toEqual(['overchannel', 'stormcaller', 'thunderstep']);
    g.chooserPick(1);   // stormcaller, whose halved cooldown this asserts below

    // The tree comes next: the rank is spent, and the mastery is not.
    expect(g.state(), 'the tree did not follow the rite').toBe('talents');
    expect((g.chooser() as unknown as Chooser).kind).toBe('tree');
    press('b');

    // And the draft behind it, without leaving the ceremony.
    const draft = g.chooser() as unknown as Chooser;
    expect(draft.kind).toBe('draft');
    g.chooserPick(0);

    expect(talents().stormCooldown()).toBe(g.config().stormCooldown / 2);
    expect(g.state()).toBe('boss_entrance');
  });
});

interface Slot { x: number; y: number; w: number; h: number }
interface ChooserLayout { slots: Slot[]; selected: number; hintY: number }

describe('the chooser row obeys the screens playbook', () => {
  const layout = (): ChooserLayout => g.chooserLayout() as unknown as ChooserLayout;

  /** Opens a draft with everything owned, so the row has three panels. */
  function openDraft(): void {
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 1);
    g.go('menu');
    g.go('playing');
    killABoss();
    expect(g.state()).toBe('chooser');
  }

  it('sizes the row from the canvas, not from a literal design width', () => {
    // The fault this guards: char select's pre-rebuild row was sized from a
    // literal 1000, which is 57% of the 1760 canvas the game ships now.
    //
    // Asserted as proportionality rather than as a minimum width, because a
    // minimum is really a claim about how big the panels should look, and
    // tuning that — which the owner has already done once — would then read
    // as this rule breaking. Widen the canvas and the row must widen with it;
    // a literal would not move at all.
    openDraft();
    const rowW = (): number => {
      const slots = layout().slots;
      return Math.max(...slots.map((s) => s.x + s.w)) - Math.min(...slots.map((s) => s.x));
    };
    const cfg = g.config() as { canvasW: number };
    const was = cfg.canvasW;
    const before = rowW();
    try {
      cfg.canvasW = Math.round(was * 1.5);
      expect(rowW() / before).toBeCloseTo(1.5, 1);
    } finally {
      cfg.canvasW = was;   // never leak a resized canvas into the next test
    }
  });

  it('keeps every panel inside the canvas, edges included', () => {
    openDraft();
    const W = g.config().canvasW, H = g.config().canvasH;
    // A real margin, not merely on-canvas: `panelSlots` clamps a panel that
    // would overflow, so "inside" is satisfied by one that is jammed flush
    // against the edge — which is exactly what too small a sideMargin gives.
    const clear = W * 0.02;
    for (const s of layout().slots) {
      expect(s.x, 'a panel is jammed against the left edge').toBeGreaterThan(clear);
      expect(s.x + s.w, 'a panel is jammed against the right edge').toBeLessThan(W - clear);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y + s.h).toBeLessThan(H);
    }
  });

  it('moves nothing but the picked panel when the cursor changes', () => {
    // The other fault: the old screen re-centred the row on every switch, so
    // the panel a player was reaching for moved out from under the cursor.
    openDraft();
    const centres = (): number[] => layout().slots.map((s) => Math.round(s.x + s.w / 2));
    const first = centres();
    const c = g.chooser() as unknown as { cursor: number };
    c.cursor = 1;
    const second = centres();
    for (let i = 0; i < first.length; i++) {
      if (i === 1) continue;
      expect(second[i], `panel ${i} slid when the cursor moved`).toBe(first[i]);
    }
  });
});

/**
 * Every hero's tree reaches its own kit.
 *
 * One test per talent would be four times this file; what these hold instead
 * is the seam each tree hangs on — that the drafted figure reaches the code
 * that runs on it, measured through the real path rather than by reading the
 * accessor back. The accessor agreeing with itself proves nothing.
 */
describe('the archer tree reaches Brace', () => {
  const brace = (): number => (g.brace() as { level: number }).level;

  beforeEach(() => {
    g.pick('archer');
    for (const t of CHAR_TREES.archer.talents) talents().grant(t.id, 0);
    g.go('playing');
    clearArena();
    g.healHero();
  });

  it('fills faster with SET FEET drafted', () => {
    // Half a second of standing still, with and without the talent.
    const half = Math.ceil(0.5 * ONE_SECOND);
    stepPast(half);
    const plain = brace();
    g.go('menu'); g.go('playing'); clearArena(); g.healHero();
    talents().grant('setFeet', 2);
    talents().draft('setFeet');
    stepPast(half);
    expect(brace(), 'a set-feet archer braces further in the same time')
      .toBeGreaterThan(plain);
  });

  it('punches through more bodies with SPLIT SHAFT drafted', () => {
    const base = g.config().archerPowerPierce;
    talents().grant('splitShaft', 2);
    talents().draft('splitShaft');
    expect(talents().stat('splitShaft')).toBe(base + 2);
  });

  it('holds a full brace through movement only once ROOTED is sealed', () => {
    stepPast(2 * ONE_SECOND);
    expect(brace(), 'the archer should be fully braced by now').toBe(1);
    // Walking normally spends it.
    (g.keys() as Record<string, boolean>)['d'] = true;
    stepPast(Math.ceil(0.4 * ONE_SECOND));
    (g.keys() as Record<string, boolean>)['d'] = false;
    expect(brace(), 'walking drains an unsealed brace').toBeLessThan(1);

    stepPast(2 * ONE_SECOND);
    talents().sealCapstone('rooted');
    (g.keys() as Record<string, boolean>)['d'] = true;
    stepPast(Math.ceil(0.4 * ONE_SECOND));
    (g.keys() as Record<string, boolean>)['d'] = false;
    expect(brace(), 'ROOTED carries a full brace through the same walk').toBe(1);
  });
});

describe('the knight tree reaches Bloodlust', () => {
  beforeEach(() => {
    g.pick('knight');
    for (const t of CHAR_TREES.knight.talents) talents().grant(t.id, 0);
    g.go('playing');
    clearArena();
    g.healHero();
  });

  it('makes each stack worth more with DEEPER CUT drafted', () => {
    const base = g.config().knightBloodlustPer;
    talents().grant('deeperCut', 2);
    talents().draft('deeperCut');
    expect(talents().stat('deeperCut')).toBeCloseTo(base + 0.06, 6);
  });

  /**
   * One connecting swing at the same body, re-planted in reach each time.
   *
   * Re-planted rather than freshly spawned: a skeleton walks, and a new one
   * per swing piles a crowd around the knight that shoves him off his own
   * aim. Measured that way the fourth swing simply missed, which reads as the
   * talent failing when it is the harness drifting.
   */
  function swingInto(s: { x: number; y: number; hp: number }): void {
    const p = g.player() as { x: number; y: number };
    const c = g.config();
    s.x = p.x + c.knightSpearRange * 0.7; s.y = p.y; s.hp = 9999;
    // The target hits back, and a knight standing in contact for six swings
    // dies partway through — after which nothing resolves and the stack count
    // simply stops, which reads exactly like the talent failing. CLAUDE.md
    // names healHero for precisely this.
    g.healHero();
    aimAt(p.x + c.knightSpearRange, p.y);
    g.shoot();
    stepPast(Math.ceil(c.knightSpearSwingDuration * 60) + 2);
    stepPast(Math.ceil(c.knightSpearCooldown * 60) + 2);
  }

  /** One body to swing at, for the whole test. */
  function plantTarget(): { x: number; y: number; hp: number } {
    g.spawnSkeleton();
    return (g.skeletons() as { x: number; y: number; hp: number }[]).at(-1)!;
  }

  const stacks = (): number => (g.bloodlust() as { stacks: number }).stacks;

  it('stops at the base ceiling with nothing drafted', () => {
    const target = plantTarget();
    for (let i = 0; i < 6; i++) swingInto(target);
    expect(stacks()).toBe(g.config().knightBloodlustMax);
  });

  it('banks a fourth stack once FOURTH BLOOD is drafted', () => {
    // Counted off the real stack the swing banks, not off the table that
    // decides the ceiling.
    talents().grant('fourthBlood', 1);
    talents().draft('fourthBlood');
    const target = plantTarget();
    for (let i = 0; i < 6; i++) swingInto(target);
    expect(stacks()).toBe(g.config().knightBloodlustMax + 1);
  });
});

describe('the ranger tree reaches Momentum', () => {
  beforeEach(() => {
    g.pick('ranger');
    for (const t of CHAR_TREES.ranger.talents) talents().grant(t.id, 0);
    g.go('playing');
    clearArena();
    g.healHero();
  });

  /** Runs right for `frames`, then reports the meter and what it is worth. */
  function runFor(frames: number): { level: number; mult: number } {
    (g.keys() as Record<string, boolean>)['d'] = true;
    stepPast(frames);
    (g.keys() as Record<string, boolean>)['d'] = false;
    return g.momentum() as { level: number; mult: number };
  }

  it('is worth 45% at a full meter with FULL TILT drafted', () => {
    // Read off rangerMomentumMult, the figure a bolt's damage runs on. Asking
    // the accessor what the accessor thinks proves nothing, and this file's
    // own opening says exactly that.
    // Two levels now, not three. If the ceiling had moved with the cost this
    // is the assertion that would have caught it.
    talents().grant('fullTilt', 2);
    talents().draft('fullTilt');
    const m = runFor(4 * ONE_SECOND);
    expect(m.level, 'the ranger should be at full tilt by now').toBe(1);
    expect(m.mult).toBeCloseTo(1.45, 4);
  });

  it('is worth only the base ceiling without it', () => {
    const m = runFor(4 * ONE_SECOND);
    expect(m.level).toBe(1);
    expect(m.mult).toBeCloseTo(1 + g.config().rangerMomentumMax, 4);
  });

  it('fills over less ground with LIGHT FOOT drafted', () => {
    // The same run for the same frames: the talent has to show as a fuller
    // meter, not as a different number in the table.
    const plain = runFor(Math.ceil(0.45 * ONE_SECOND)).level;
    expect(plain, 'this run must not already be capped').toBeLessThan(1);
    g.go('menu'); g.go('playing'); clearArena(); g.healHero();
    talents().grant('lightFoot', 2);
    talents().draft('lightFoot');
    const light = runFor(Math.ceil(0.45 * ONE_SECOND)).level;
    expect(light, 'less ground to cover should mean a fuller meter')
      .toBeGreaterThan(plain);
  });
});

describe('the sapper tree reaches the chain', () => {
  beforeEach(() => {
    g.pick('sapper');
    for (const t of CHAR_TREES.sapper.talents) talents().grant(t.id, 0);
    g.go('playing');
    clearArena();
    g.healHero();
  });

  it('reaches further with LONG FUSE drafted', () => {
    const base = g.config().sapperChainRadius;
    talents().grant('longFuse', 2);
    talents().draft('longFuse');
    expect(talents().stat('longFuse')).toBe(base + 36);
  });

  it('runs through more bombs with MORE LINKS drafted', () => {
    const base = g.config().sapperChainMaxLinks;
    talents().grant('moreLinks', 2);
    talents().draft('moreLinks');
    expect(talents().stat('moreLinks')).toBe(base + 4);
  });
});

describe('a numeric talent nothing has drafted is exactly its base', () => {
  // The whole run layer in one assertion, over every hero: owning a tree does
  // not change a single figure the game runs on until a run drafts it.
  it('leaves every hero\'s figures alone', () => {
    for (const char of CHARACTERS) {
      g.pick(char);
      for (const t of CHAR_TREES[char].talents) talents().grant(t.id, 2);
      g.go('menu');
      g.go('playing');
      // The run-start draft may be waiting; nothing has been picked from it.
      for (const t of CHAR_TREES[char].talents) {
        if (t.effect.kind !== 'linear') continue;
        const before = talents().stat(t.id);
        talents().grant(t.id, 0);
        expect(talents().stat(t.id), `${char}.${t.id} moved without being drafted`)
          .toBe(before);
      }
    }
  });
});

describe('the choosers keep out of a siege', () => {
  it('pays mastery for a siege boss without stopping the wave', () => {
    // A siege boss is one enemy inside a wave, not the end of a stage. A
    // ceremony here would hold the field with crows still on it.
    g.pick('wizard');
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 1);
    talents().grantMastery(100);          // far past the rite's rank
    g.setMode('siege');
    g.go('playing');
    // The run's opening draft is legitimate and opens first; take it, so what
    // this test measures afterwards is the siege boss alone.
    if (g.state() === 'chooser') g.chooserPick(0);
    expect(g.state()).toBe('playing');
    g.jumpToSiegeWave(7);
    const before = talents().state().mastery;
    g.killSiegeBoss();
    stepPast(Math.ceil(2 * ONE_SECOND));
    expect(g.state(), 'a siege boss opened a chooser mid-wave').toBe('playing');
    expect(talents().state().mastery, 'the siege boss paid no mastery')
      .toBeGreaterThan(before);
  });
});

interface Kind { label: string; color: string; dim: string; bg: string }
interface LookRow { kind: string; sigil: string; hook: string }
interface Look { kinds: Record<string, Kind>; look: Record<string, LookRow> }

describe('the colour code says what a talent does', () => {
  const look = (): Look => g.talentLook() as unknown as Look;

  it('gives every talent and capstone a kind the table knows', () => {
    const { kinds, look: rows } = look();
    for (const char of CHARACTERS) {
      const tree = CHAR_TREES[char];
      for (const entry of [...tree.talents, ...tree.capstones]) {
        const row = rows[entry.id];
        expect(row, `${char}.${entry.id} has no look row`).toBeDefined();
        expect(kinds[row!.kind], `${char}.${entry.id} has an unknown kind`).toBeDefined();
      }
    }
  });

  it('gives each kind its own colour, so the code can be read', () => {
    // Two kinds sharing a colour is not a code, it is a coincidence.
    const kinds = Object.values(look().kinds);
    expect(new Set(kinds.map((k) => k.color)).size).toBe(kinds.length);
    expect(new Set(kinds.map((k) => k.label)).size).toBe(kinds.length);
  });

  it('never colours by hero: a tree spends more than one kind', () => {
    // The fault this replaced — a whole tree in one colour, which told the
    // player only whose tree they were looking at.
    //
    // Deliberately counted over talents AND capstones, which is weaker than
    // it looks: the knight's three buyable talents are all `direct` and the
    // ranger's are all `indirect`, so those two shops and those two draft
    // pools really are monochrome. That is the trees being honest — his three
    // are all damage, hers are all build-up — and tightening this to
    // talents-only would force a recolour that lied about what they do. It is
    // a balance observation, recorded in docs/talents.md, not a bug here.
    const rows = look().look;
    for (const char of CHARACTERS) {
      const tree = CHAR_TREES[char];
      const all = [...tree.talents, ...tree.capstones];
      if (all.length === 0) continue;
      const kindsUsed = new Set(all.map((e) => rows[e.id]!.kind));
      expect(kindsUsed.size, `${char}'s whole tree is one kind`).toBeGreaterThan(1);
    }
  });

  it('keeps movement talents out of the damage colours', () => {
    // The three the owner named as mechanics, pinned by id so a re-categorised
    // teleport or cloak has to be a deliberate edit here.
    const rows = look().look;
    for (const id of ['blinkReach', 'slipstream', 'stickyFan']) {
      expect(rows[id]!.kind, `${id} should read as movement`).toBe('mechanic');
    }
  });
});

/**
 * The unlocks, measured on the field.
 *
 * Two of these exist because the effect first written for them was already
 * true of the base kit: the dash always wounded along its line, and barrage
 * bombs never bounced. A talent that promises what the hero already does is
 * the same defect as one nothing reads, so each test below is written to fail
 * if the talent is doing nothing.
 */
describe('CHARGE THROUGH widens the charge', () => {
  beforeEach(() => {
    g.pick('knight');
    for (const t of CHAR_TREES.knight.talents) talents().grant(t.id, 0);
    g.go('playing');
    clearArena();
    g.healHero();
  });

  /** Puts one body directly BEHIND the knight and charges the other way. */
  function bodyBehindAfterDash(): number {
    const p = g.player() as { x: number; y: number };
    (g.skeletons() as unknown[]).length = 0;
    g.spawnSkeleton();
    const sk = (g.skeletons() as { x: number; y: number; hp: number }[]).at(-1)!;
    sk.x = p.x - 26; sk.y = p.y; sk.hp = 1;
    aimAt(p.x + 400, p.y);          // charge away from it
    g.shift();
    g.shiftUp();
    stepPast(Math.ceil(0.5 * 60));
    return (g.skeletons() as unknown[]).length;
  }

  it('leaves a body behind him alone without it', () => {
    expect(bodyBehindAfterDash(), 'the base charge only cuts ahead').toBe(1);
  });

  it('cuts a body behind him once drafted', () => {
    talents().grant('chargeThrough', 1);
    talents().draft('chargeThrough');
    expect(bodyBehindAfterDash(), 'the charge should cut on every side').toBe(0);
  });
});

describe('STICKY FAN leaves the fan on the ground', () => {
  beforeEach(() => {
    g.pick('sapper');
    for (const t of CHAR_TREES.sapper.talents) talents().grant(t.id, 0);
    g.go('playing');
    clearArena();
    g.healHero();
  });

  /** Fires the barrage into a body and reports the bombs still on the map. */
  function barrageIntoBody(): number {
    const c = g.config();
    // Fired into the arena's border wall, not at bodies: crows reposition
    // themselves, so a parked crow is gone by the time a bomb arrives — and
    // measuring that reads as the talent working. A wall stays put.
    const p = g.player() as { x: number; y: number };
    p.x = c.tileSize * 2.5;
    aimAt(0, p.y);
    // One step between pointing and firing: aimAngle is recomputed from the
    // pointer during the tick, so firing in the same breath throws the fan
    // wherever he was already facing.
    g.stepSim(1);
    g.secondary();
    stepPast(Math.ceil(0.5 * ONE_SECOND));
    return (g.barrageBombs() as unknown[]).length;
  }

  it('spends the bombs on contact without it', () => {
    expect(barrageIntoBody(), 'bombs should have gone off on the body').toBe(0);
  });

  it('parks them where they land once drafted', () => {
    talents().grant('stickyFan', 1);
    talents().draft('stickyFan');
    expect(barrageIntoBody(), 'stuck bombs should still be on the map')
      .toBeGreaterThan(0);
  });

  // The talent's own words are that they KEEP THEIR FUSE. A stuck bomb went on
  // scanning for bodies every frame, so one resting against the thing it landed
  // on re-stuck itself forever and never went off at all -- the fan was not a
  // delayed blast, it was a blast that never came.
  it('runs the fuse out even with the body still standing on them', () => {
    talents().grant('stickyFan', 1);
    talents().draft('stickyFan');
    expect(barrageIntoBody()).toBeGreaterThan(0);
    const c = g.config();
    g.spawnSkeleton('normal');
    const sk = g.skeletons() as { x: number; y: number; hp: number }[];
    const bombs = g.barrageBombs() as { x: number; y: number }[];
    const at = { x: bombs[0]!.x, y: bombs[0]!.y };
    // Pinned on top of a stuck bomb for the whole of the rest of its fuse.
    for (let i = 0; i < Math.ceil(ONE_SECOND * (c.sapperBarrageLifetime as number + 0.6)); i++) {
      for (const k of sk) { k.x = at.x; k.y = at.y; k.hp = 99; }
      stepPast(1);
    }
    expect((g.barrageBombs() as unknown[]).length,
           'a bomb sat under a body instead of going off').toBe(0);
  });
});

describe('the rite: the capstones that change the field', () => {
  /** Everything the blast reached, as a count of bodies left alive. */
  function crowsLeftAfter(run: () => void, plant: (i: number) => [number, number]): number {
    (g.crows() as unknown[]).length = 0;
    for (let i = 0; i < 8; i++) {
      g.spawnCrow();
      const c = (g.crows() as { x: number; y: number }[]).at(-1)!;
      const [x, y] = plant(i);
      c.x = x; c.y = y;
    }
    run();
    g.stepSim(1);
    return (g.crows() as unknown[]).length;
  }

  it('SPLINTER reaches bodies a single crater does not', () => {
    g.pick('archer');
    g.go('playing'); clearArena(); g.healHero();
    const p = g.player() as { x: number; y: number };
    const c = g.config();
    // Just outside the parent crater, comfortably inside where a splinter
    // lands plus its own reach. Both derived, because a guessed ring sat
    // inside the base blast and killed everything either way.
    const at = c.dynamiteBlastRadius + 6;
    const ring = (i: number): [number, number] => {
      const a = (i / 8) * Math.PI * 2;
      return [p.x + 300 + Math.cos(a) * at, p.y + Math.sin(a) * at];
    };
    const plain = crowsLeftAfter(() => g.blast(p.x + 300, p.y), ring);
    talents().sealCapstone('splinter');
    const split = crowsLeftAfter(() => g.blast(p.x + 300, p.y), ring);
    expect(split, 'the splinters should reach further than the one crater')
      .toBeLessThan(plain);
  });

  it('SHOCKWAVE throws survivors clear of the blast', () => {
    g.pick('sapper');
    g.go('playing'); clearArena(); g.healHero();
    const p = g.player() as { x: number; y: number };
    (g.crows() as unknown[]).length = 0;
    g.spawnCrow();
    const c = (g.crows() as { x: number; y: number; hp: number }[])[0]!;
    c.x = p.x + 260; c.y = p.y; c.hp = 9999;   // survives, so it can be thrown
    const before = c.x;
    talents().sealCapstone('shockwave');
    g.sapperCombo(p.x + 250, p.y);
    g.stepSim(1);
    expect(c.x, 'a survivor should have been thrown outward').toBeGreaterThan(before);
  });

  it('SLIPSTREAM carries her through a body, and only for its window', () => {
    g.pick('ranger');
    for (const t of CHAR_TREES.ranger.talents) talents().grant(t.id, 0);
    g.go('playing'); clearArena(); g.healHero();
    talents().sealCapstone('slipstream');
    const keys = g.keys() as Record<string, boolean>;
    const p = g.player() as { x: number; y: number };
    p.x = g.config().tileSize * 3;          // room to run without meeting the far wall

    /**
     * Three hits with frames between them.
     *
     * Between, because the first hit that lands sets an invulnerable flash and
     * the ward eats one on top of that — hit twice in the same breath and HP
     * is untouched whether or not she is phasing, which is a test that cannot
     * fail. She keeps running throughout: the window is spent only while the
     * meter is full, and a ranger standing still loses both.
     */
    function takeThree(): void {
      for (let i = 0; i < 3; i++) { g.hurtHero(1); stepPast(14); }
    }

    keys['d'] = true;
    stepPast(4 * ONE_SECOND);
    expect((g.momentum() as { level: number }).level).toBe(1);
    expect(g.slipstream() as number, 'a full meter should arm the window')
      .toBeGreaterThan(0);

    const hp = (g.counts() as { hp: number }).hp;
    takeThree();
    keys['d'] = false;
    expect((g.counts() as { hp: number }).hp, 'she should have run through all three')
      .toBe(hp);

    // Standing still drops the meter, which closes the window at once.
    stepPast(ONE_SECOND);
    expect(g.slipstream() as number, 'stopping should close the window').toBe(0);
    takeThree();
    expect((g.counts() as { hp: number }).hp, 'a closed window should let one land')
      .toBeLessThan(hp);
  });
});

interface ShopRow { x: number; y: number; w: number; h: number; midY: number }
interface ShopLayout { rows: ShopRow[]; cursor: number; hintY: number; riteY: number }

/**
 * The talent shop.
 *
 * `TALENTS.buy()` enforced the mastery gate and the wallet from the day the
 * model landed, and until this screen the only way to reach it was the
 * console. What is pinned here is the screen's own seams: that the cursor
 * spends the row it is on, that a refusal is worded rather than swallowed,
 * and that the rects the click handler tests are the rects the draw used.
 *
 * The painting itself is not driven here. The stub canvas knows `fillRect`
 * and nothing else, and a screen asserted through a fake `fillText` tests the
 * fake. It was looked at instead.
 */
describe('the talent shop', () => {
  const layout = (): ShopLayout => g.talentTreeLayout() as unknown as ShopLayout;
  /** What the shop can spend: mastery earned and not yet spent. */
  const purse = (): number => talents().purse();
  /** Earns exactly `n` mastery and clears any debt, so the purse is `n`. */
  const setPurse = (n: number): void => talents().grantMastery(n);
  /** The feather wallet, which a talent must never touch. */
  const coins = (): number => (g.feathers() as unknown as { wallet: () => number }).wallet();

  beforeEach(() => {
    g.pick('archer');
    g.go('talents');
    g.talents().setCursor(0);
  });

  it('puts the cursor on a row and buys that row', () => {
    const tree = CHAR_TREES.archer;
    const spec = tree.talents[0]!;
    talents().grant(spec.id, 0);
    setPurse(spec.costs[0]! + 4);         // tier I is open at rank 0
    const before = purse();
    const feathersBefore = coins();

    talents().setCursor(0);
    const result = talents().buyCurrent();

    expect(result!.kind).toBe('bought');
    expect(talents().state().levels[spec.id]).toBe(1);
    expect(before - purse(), 'the purse paid the price on the row').toBe(spec.costs[0]);
    expect(coins(), 'a talent spent feathers, which belong to the upgrades')
      .toBe(feathersBefore);
  });

  it('buys the row the cursor moved to, not the one it started on', () => {
    // The bug this exists for: a screen that draws a cursor and buys index 0.
    const tree = CHAR_TREES.archer;
    const second = tree.talents[1]!;
    talents().grant(second.id, 0);
    setPurse(20);

    talents().setCursor(0);
    talents().moveCursor(1);
    expect(talents().cursor()).toBe(1);
    talents().buyCurrent();

    expect(talents().state().levels[second.id]).toBe(1);
  });

  it('wraps the cursor at both ends and never leaves the tree', () => {
    const n = CHAR_TREES.archer.talents.length;
    talents().setCursor(0);
    talents().moveCursor(-1);
    expect(talents().cursor()).toBe(n - 1);
    talents().moveCursor(1);
    expect(talents().cursor()).toBe(0);
  });

  it('never lets the cursor off the tree on screen', () => {
    // Whichever character is picked, the cursor indexes a real row. The clamp
    // itself is `clampCursor`, pinned against lists of differing length in
    // sim/talents.test.ts -- every tree happens to be three rows today, so a
    // test written only against the live trees could not fail.
    for (const char of CHARACTERS) {
      g.pick(char);
      const tree = CHAR_TREES[char];
      expect(tree.talents[talents().cursor()], `${char}'s cursor is off its tree`)
        .toBeDefined();
    }
    g.pick('archer');
  });

  it('words every refusal the model can hand back', () => {
    // A purchase kind with no note renders as a blank line: the player
    // presses ENTER, nothing visible happens, and the screen has lied about
    // whether it heard them. The painter throws on an unknown kind; this is
    // what proves the known ones are all covered.
    const kinds = [
      { kind: 'bought', spent: 14 },
      { kind: 'maxed' },
      { kind: 'tooPoor', cost: 26, short: 12 },
      { kind: 'tierLocked', rankNeeded: 1, rankHeld: 0 },
    ];
    for (const result of kinds) {
      const note = (g.talentBuyNote as (r: unknown) => { text: string; color: string } | null)(result);
      expect(note, `no note for '${result.kind}'`).not.toBeNull();
      expect(note!.text.length, `an empty note for '${result.kind}'`).toBeGreaterThan(0);
    }
    expect((g.talentBuyNote as (r: unknown) => unknown)(null)).toBeNull();
  });

  it('says a tier is locked rather than doing nothing', () => {
    const locked = CHAR_TREES.archer.talents.find((t) => t.tier > 1)!;
    setPurse(0);
    talents().setCursor(CHAR_TREES.archer.talents.indexOf(locked));

    const result = talents().buyCurrent();

    expect(result!.kind).toBe('tierLocked');
    expect(talents().state().levels[locked.id] ?? 0).toBe(0);
    expect((g.talentBuyNote as (r: unknown) => { text: string })(result).text).toContain('LOCKED');
  });

  it('says how short the purse is rather than doing nothing', () => {
    // A second level, so the price is not 1: a note printing only "1" would
    // satisfy a test asking for the cost and the shortfall at the same time.
    const spec = CHAR_TREES.archer.talents.find((t) => t.costs.length > 1)!;
    talents().grant(spec.id, 1);
    setPurse(0);
    talents().setCursor(CHAR_TREES.archer.talents.indexOf(spec));

    const result = talents().buyCurrent();

    expect(result!.kind).toBe('tooPoor');
    const note = (g.talentBuyNote as (r: unknown) => { text: string })(result).text;
    expect(note, 'the note never says the price').toContain(String(spec.costs[1]));
    expect(note).toContain('MASTERY');
  });

  it('drops the note as soon as the cursor moves', () => {
    // A message about a row you are no longer on is worse than no message.
    setPurse(0);
    talents().setCursor(0);
    talents().buyCurrent();
    expect(talents().lastBuy()).not.toBeNull();

    talents().moveCursor(1);

    expect(talents().lastBuy()).toBeNull();
  });

  it('lays its rows out from the canvas, not from a pixel count', () => {
    // The screens playbook's own rule. Widen the canvas and the row must
    // widen with it; a literal width would report the same number twice.
    const cfg = g.config() as { canvasW: number; canvasH: number };
    const w0 = cfg.canvasW;
    const narrow = layout().rows[0]!.w;
    cfg.canvasW = w0 * 2;
    const wide = layout().rows[0]!.w;
    cfg.canvasW = w0;
    expect(wide / narrow).toBeCloseTo(2, 5);
  });

  it('keeps every row inside the canvas and clear of the rite', () => {
    const cfg = g.config() as { canvasW: number; canvasH: number };
    for (const char of CHARACTERS) {
      g.pick(char);
      const { rows, riteY } = layout();
      expect(rows.length, `${char} has no rows`).toBe(CHAR_TREES[char].talents.length);
      for (const r of rows) {
        expect(r.x, `${char} row starts off canvas`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `${char} row runs off canvas`).toBeLessThanOrEqual(cfg.canvasW);
        expect(r.y + r.h, `${char} row overlaps the rite`).toBeLessThanOrEqual(riteY);
      }
    }
    g.pick('archer');
  });

  it('moves nothing when the cursor moves', () => {
    // Char select's lesson, applied here: a row that shifts under the pointer
    // is a row you cannot click.
    const before = JSON.stringify(layout().rows);
    talents().moveCursor(1);
    talents().moveCursor(1);
    expect(JSON.stringify(layout().rows)).toBe(before);
  });

  it('is clickable exactly where it is drawn', () => {
    // The hit test and the draw read one layout; this is the round trip that
    // proves it, and the guard against a recomputed approximation creeping
    // back in.
    const { rows } = layout();
    rows.forEach((r, i) => {
      expect(rowAt(rows, r.x + r.w / 2, r.midY), `row ${i} is not clickable`).toBe(i);
    });
    const gap = rows[0]!.y + rows[0]!.h + 1;
    expect(rowAt(rows, rows[0]!.x + 4, gap), 'the gap between rows buys something').toBeNull();
  });
});

describe('reaching the two shops', () => {
  /**
   * Starts a run and clears whatever the run staged in front of it.
   *
   * A character that owns talents is dealt the run's opening draft, so
   * `go('playing')` lands on the chooser rather than on the field. Tests
   * earlier in this file leave the archer owning most of his tree, which
   * makes this the normal case here rather than the exception.
   */
  const enterRun = (): void => {
    g.go('playing');
    for (let i = 0; i < 8 && g.chooser() !== null; i++) g.chooserPick(0);
    expect(g.state(), 'a chooser queue that will not drain').toBe('playing');
  };

  beforeEach(() => {
    g.pick('archer');
    enterRun();
  });

  it('opens the talent shop from the pause menu and comes back', () => {
    g.go('paused');
    press('t');
    expect(g.state()).toBe('talents');
    press('b');
    expect(g.state()).toBe('paused');
  });

  it('crosses between the two shops without going through the pause menu', () => {
    g.go('inventory');
    press('t');
    expect(g.state()).toBe('talents');
    press('u');
    expect(g.state()).toBe('inventory');
  });

  it('buys with ENTER and moves with the arrows', () => {
    const spec = CHAR_TREES.archer.talents[0]!;
    talents().grant(spec.id, 0);
    talents().grantMastery(20);
    g.go('talents');
    talents().setCursor(0);

    press('ArrowDown');
    expect(talents().cursor()).toBe(1);
    press('ArrowUp');
    expect(talents().cursor()).toBe(0);

    const before = talents().state().levels[spec.id] ?? 0;
    press('Enter');
    expect(talents().state().levels[spec.id]).toBe(before + 1);
  });

  it('returns to a run in progress without restarting it', () => {
    // Both shops are reached mid-run, so leaving one must not call initGame.
    // The inventory was already exempt; the talent shop is the second door.
    //
    // Measured on the run clock rather than on the kill count: initGame zeroes
    // both, and a run that has killed nothing starts at zero anyway, so a
    // kill-count assertion here compares zero to zero and passes with the
    // exemption removed.
    enterRun();
    stepPast(ONE_SECOND);
    const clock = g.gameTime() as number;
    expect(clock, 'the run clock never started').toBeGreaterThan(0);

    g.go('talents');
    g.go('playing');

    expect(g.state()).toBe('playing');
    expect(g.gameTime(), 'the run was restarted').toBeGreaterThanOrEqual(clock);
  });
});

describe('talents are bought with mastery, never with feathers', () => {
  it('refuses an open-tier talent an empty purse cannot cover', () => {
    // Tier 1 is open at any rank, so this pins the purse coupling alone; the
    // mastery gate itself is pinned pure in sim/talents.test.ts.
    talents().grantMastery(0);
    // Ungranted first: an earlier test walked this ladder to its top, and a
    // maxed talent would answer before the purse got to.
    talents().grant('blinkReach', 0);
    expect(talents().buy('blinkReach').kind).toBe('tooPoor');
  });

  it('leaves the feather wallet alone when a talent is taken', () => {
    // The whole point of the split. Feathers buy upgrades; a talent that also
    // spent them would make the player choose between a talent and a heart,
    // which is not a choice either tree was built to ask.
    const wallet = g.feathers() as unknown as { wallet: () => number; grant: (n: number) => void };
    wallet.grant(120);
    talents().grantMastery(20);
    talents().grant('blinkReach', 0);

    expect(talents().buy('blinkReach').kind).toBe('bought');

    expect(wallet.wallet(), 'a talent charged the upgrade wallet').toBe(120);
  });

  it('never lets spending shut a tier the rank already opened', () => {
    // The whole reason mastery and spent are two figures rather than one
    // balance. Earn exactly the rank that opens tier II, spend every point of
    // it on tier I, and tier II must still answer "you cannot afford this"
    // rather than "you have not earned this".
    const tier2 = CHAR_TREES.wizard.talents.find((t) => t.tier === 2)!;
    const tier1 = CHAR_TREES.wizard.talents.filter((t) => t.tier === 1);
    const earned = RANK_THRESHOLDS[0]!;          // exactly rank I: tier II opens
    talents().grantMastery(earned);
    for (const t of CHAR_TREES.wizard.talents) talents().grant(t.id, 0);
    expect(talents().buy(tier2.id).kind, 'tier II was shut before a point was spent')
      .not.toBe('tierLocked');
    talents().grant(tier2.id, 0);                // undo that probe purchase
    talents().grantMastery(earned);

    // Spend the lot on tier I, which is priced to absorb exactly this much.
    let spent = 0;
    for (const t of tier1) {
      for (let lvl = 0; lvl < t.costs.length && spent < earned; lvl++) {
        if (talents().buy(t.id).kind === 'bought') spent += t.costs[lvl]!;
      }
    }
    expect(talents().purse(), 'the purse should be spent out').toBe(0);

    expect(talents().buy(tier2.id).kind, 'an empty purse shut a tier the rank opened')
      .toBe('tooPoor');
  });
});
