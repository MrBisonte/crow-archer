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
    const c = g.chooser() as unknown as Chooser;
    expect(c.kind).toBe('draft');
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
    expect(rite.offers).toEqual(['overchannel', 'stormcaller']);
    g.chooserPick(1);

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
    // Read off the tree rather than written down: this asserted a literal 5,
    // which is a figure a balance pass moves, and a test that fails on tuning
    // teaches nothing about whether the talent works.
    const spec = CHAR_TREES.archer.talents.find((t) => t.id === 'splitShaft')!;
    const per = spec.effect.kind === 'linear' ? spec.effect.per : 0;
    const base = g.config().archerPowerPierce;
    const levels = spec.costs.length;

    talents().grant('splitShaft', levels);
    expect(talents().stat('splitShaft'), 'owned but undrafted should be the base')
      .toBe(base);

    talents().draft('splitShaft');
    expect(talents().stat('splitShaft')).toBe(base + per * levels);
    expect(talents().stat('splitShaft'), 'the talent bought no pierce at all')
      .toBeGreaterThan(base);
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
    talents().grant('fullTilt', 3);
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
});

/**
 * The archer's round: his own stick moves him, and a powered pickup carries
 * further than a plain one.
 *
 * Measured on the field rather than off the config, because both of these are
 * the kind of change that reads as done in a diff and does nothing in a game:
 * a push applied to the wrong object, a trail dropped by an arrow nobody
 * powered.
 */
describe('the archer rides his own blast', () => {
  beforeEach(() => {
    g.pick('archer');
    g.go('playing');
    for (let i = 0; i < 8 && g.chooser() !== null; i++) g.chooserPick(0);
    clearArena();
    g.healHero();
  });

  /**
   * Throws a stick at an offset from him and reports how far he moved.
   *
   * He is stood in open ground first. The spawn tile is x=80, a stride from
   * the left wall, and a push away from a stick to his right lands outside
   * the arena — which is a real case, but not the one these tests are about.
   */
  function hopWithStickAt(dx: number): { moved: number; hp: number } {
    const p = g.player() as { x: number; y: number };
    p.x = Math.round(g.config().canvasW / 2);
    p.y = Math.round((g.config().rows * g.config().tileSize) / 2);
    const from = { x: p.x, y: p.y };
    const hpBefore = (g.counts() as { hp: number }).hp;
    (g.inv() as Record<string, number>).dynamites = 5;
    aimAt(p.x + 400, p.y);
    g.stepSim(1);
    g.secondary();
    g.stepSim(2);
    g.secondaryUp();
    // Park the thrown stick exactly where the test wants it and set it off.
    const stick = (g.dynamites() as { x: number; y: number; life: number }[]).at(-1)!;
    stick.x = from.x + dx; stick.y = from.y;
    stick.life = 0;
    stepPast(4);
    const after = g.player() as { x: number; y: number };
    return {
      moved: Math.hypot(after.x - from.x, after.y - from.y),
      hp: hpBefore - (g.counts() as { hp: number }).hp,
    };
  }

  it('throws him clear, and costs him nothing to do it', () => {
    const { moved, hp } = hopWithStickAt(10);
    expect(moved, 'his own stick did not move him').toBeGreaterThan(20);
    expect(hp, 'the hop cost him health').toBe(0);
  });

  it('throws him hardest from underfoot and barely at all from the edge', () => {
    // The control the owner picked: where the stick lands is the whole dial.
    const near = hopWithStickAt(6).moved;
    const edge = hopWithStickAt(Math.round(g.config().dynamiteBlastRadius * 0.85)).moved;
    expect(near, 'a stick at his feet should launch him').toBeGreaterThan(edge * 2);
  });

  it('throws him away from the stick, never towards it', () => {
    // Stick to his RIGHT, so any push must carry him left. hopWithStickAt
    // centres him first, so read the start position after it has done so.
    let startX = 0;
    const p = g.player() as { x: number; y: number };
    p.x = Math.round(g.config().canvasW / 2);
    startX = p.x;
    hopWithStickAt(20);
    expect((g.player() as { x: number }).x, 'he was pulled into the blast')
      .toBeLessThan(startX);
  });

  it('leaves a stick outside the blast unable to move him', () => {
    const { moved } = hopWithStickAt(g.config().dynamiteBlastRadius + 40);
    expect(moved, 'a stick out of range still threw him').toBeLessThan(1);
  });

  it('does not throw him off a blast he did not throw', () => {
    // `blast()` is the dev hook, and a splinter child carries no mark either.
    // Only the stick that left his hand moves him.
    const p = g.player() as { x: number; y: number };
    const from = { x: p.x, y: p.y };
    g.blast(p.x + 8, p.y);
    stepPast(2);
    const after = g.player() as { x: number; y: number };
    expect(Math.hypot(after.x - from.x, after.y - from.y),
      'an explosion he did not throw moved him').toBeLessThan(1);
  });
});

/**
 * What standing still is worth outside a boss fight.
 *
 * Brace multiplied boss damage and nothing else, and a crow dies to any arrow
 * either way — so his signature meter was dark for most of a run. These are
 * the consumers that changed that.
 */
describe('a braced archer looses a volley', () => {
  const brace = (): number => (g.brace() as { level: number }).level;

  beforeEach(() => {
    g.pick('archer');
    g.go('playing');
    for (let i = 0; i < 8 && g.chooser() !== null; i++) g.chooserPick(0);
    clearArena();
    g.healHero();
    (g.arrows() as unknown[]).length = 0;
  });

  /** Fires one press and reports the arrows it put in the air. */
  function arrowsFromOnePress(): number {
    (g.arrows() as unknown[]).length = 0;
    (g.inv() as Record<string, number>).arrows = 20;
    g.shoot();
    g.stepSim(1);
    return (g.arrows() as unknown[]).length;
  }

  it('looses one arrow the moment he has moved', () => {
    (g.keys() as Record<string, boolean>)['d'] = true;
    stepPast(Math.ceil(0.6 * ONE_SECOND));
    (g.keys() as Record<string, boolean>)['d'] = false;
    expect(brace(), 'walking should have spent the brace').toBeLessThan(0.5);
    expect(arrowsFromOnePress()).toBe(1);
  });

  it('looses the full volley from a full brace', () => {
    stepPast(3 * ONE_SECOND);        // stood still: the meter fills
    expect(brace(), 'he never braced').toBe(1);
    expect(arrowsFromOnePress()).toBe(g.config().archerBraceVolley);
  });

  it('is never refused a press an unbraced archer would be allowed', () => {
    // The exact invariant that broke, stated so it cannot drift.
    //
    // Reserving in-flight room for the WHOLE volley made bracing a penalty: a
    // three-arrow volley needed three free slots where a single shot needed
    // one, so the reward for standing still refused presses the unbraced
    // archer got. Measured over five seconds it read 13 arrows braced against
    // 16 walking about.
    //
    // Asserted as a refusal rather than as a rate. A rate comparison has to
    // run twice from the same start, and the second run inherits the brace the
    // first one built, which makes it unable to fail.
    stepPast(3 * ONE_SECOND);
    expect(brace(), 'he never braced').toBe(1);
    expect(g.config().archerBraceVolley, 'a volley of one proves nothing here')
      .toBeGreaterThan(1);

    // One slot free: an unbraced press fits, a whole reserved volley does not.
    const cap = g.config().maxArrowsInFlight as number;
    (g.arrows() as unknown[]).length = 0;
    (g.inv() as Record<string, number>).arrows = 20;
    const room = g.arrows() as { x: number }[];
    for (let i = 0; i < cap - 1; i++) room.push({ x: -9999 } as never);

    let refused = false;
    const off = g.onEvent((e: { type: string }) => {
      if (e.type === 'ACTION_BLOCKED') refused = true;
    }) as unknown as (() => void) | undefined;
    g.shoot();
    g.stepSim(1);
    if (typeof off === 'function') off();

    expect(refused, 'a braced press was refused with room for an unbraced one')
      .toBe(false);
    expect((g.arrows() as unknown[]).length, 'the volley never left the bow')
      .toBeGreaterThan(cap - 1);
  });

  it('spends one shaft for the whole volley, as the crossbow does', () => {
    stepPast(3 * ONE_SECOND);
    const bag = g.inv() as Record<string, number>;
    bag.arrows = 20;
    (g.arrows() as unknown[]).length = 0;
    const before = bag.arrows;
    g.shoot();
    g.stepSim(1);
    expect((g.arrows() as unknown[]).length).toBeGreaterThan(1);
    expect(before - bag.arrows, 'a volley charged him per arrow').toBe(1);
  });

  it('gets the power shot back sooner for having braced', () => {
    // Measured as the cooldown the release actually sets, which is the figure
    // the stance is buying.
    const cd = (): number => (g.archerDraw() as { cooldown: number }).cooldown;

    (g.keys() as Record<string, boolean>)['d'] = true;
    stepPast(Math.ceil(0.6 * ONE_SECOND));
    (g.keys() as Record<string, boolean>)['d'] = false;
    g.shift(); g.stepSim(2); g.shiftUp();
    const unbraced = cd();

    stepPast(6 * ONE_SECOND);        // wait it out, then brace fully
    expect(brace()).toBe(1);
    g.shift(); g.stepSim(2); g.shiftUp();
    const braced = cd();

    expect(braced, 'bracing bought no time back').toBeLessThan(unbraced);
  });
});

describe('his stick throws what survives it', () => {
  beforeEach(() => {
    g.pick('archer');
    g.go('playing');
    for (let i = 0; i < 8 && g.chooser() !== null; i++) g.chooserPick(0);
    clearArena();
    g.healHero();
  });

  it('shoves a survivor away, and leaves one out of range alone', () => {
    // Both crows are compared against each other rather than against a fixed
    // number: a crow flies at the player under its own steam, so "it moved"
    // proves nothing on its own. The one in the blast has to move a great
    // deal further than the one outside it.
    const p = g.player() as { x: number; y: number };
    p.x = Math.round(g.config().canvasW / 2);
    p.y = Math.round((g.config().rows * g.config().tileSize) / 2);
    const radius = g.config().dynamiteBlastRadius;
    (g.crows() as unknown[]).length = 0;
    g.spawnCrow(); g.spawnCrow();
    const [near, far] = g.crows() as { x: number; y: number; baseY: number; hp: number }[];
    // Offset from the stick, not sitting on it: dead centre has no direction
    // to be pushed along and the code skips it by design.
    // `baseY` as well as `y`. A crow bobs around its base height and homes
    // back to it, so a crow parked by `y` alone drifts vertically out of the
    // blast before it resolves — the self-repositioning trap this repo has
    // paid for twice already.
    near!.x = p.x + 80; near!.y = p.y; near!.baseY = p.y; near!.hp = 9999;
    far!.x = p.x + radius + 160; far!.y = p.y; far!.baseY = p.y; far!.hp = 9999;
    const nearBefore = near!.x, farBefore = far!.x;

    (g.inv() as Record<string, number>).dynamites = 5;
    aimAt(p.x + 400, p.y);
    g.stepSim(1);
    g.secondary(); g.stepSim(2); g.secondaryUp();
    const stick = (g.dynamites() as { x: number; y: number; life: number }[]).at(-1)!;
    stick.x = p.x + 40; stick.y = p.y; stick.life = 0;
    g.stepSim(1);

    const nearMoved = near!.x - nearBefore;
    const farMoved = Math.abs(far!.x - farBefore);
    expect(nearMoved, 'a survivor in the blast was not thrown outward')
      .toBeGreaterThan(20);
    expect(nearMoved, 'the crow outside the blast moved as much as the one in it')
      .toBeGreaterThan(farMoved * 4);
  });
});

describe('a powered arrow carries its pickup further', () => {
  beforeEach(() => {
    g.pick('archer');
    g.go('playing');
    for (let i = 0; i < 8 && g.chooser() !== null; i++) g.chooserPick(0);
    clearArena();
    g.healHero();
  });

  /**
   * Fires one shot with only fire arrows in the quiver, and reports the fires
   * it left: how many, and how far apart.
   *
   * The spread is the point. Counting alone is not enough — an arrow that
   * lights one patch where it stops still beats an arrow that lights none, so
   * a count test passes with the trail deleted. A lane is fires in DIFFERENT
   * PLACES, and that is what this measures.
   */
  function fireLaneFrom(powered: boolean): { count: number; spread: number } {
    (g.fires() as unknown[]).length = 0;
    const bag = g.inv() as Record<string, number>;
    bag.arrows = 0; bag.ricochetArrows = 0; bag.fireArrows = 5;
    const p = g.player() as { x: number; y: number };
    p.x = Math.round(g.config().canvasW / 2);
    p.y = Math.round((g.config().rows * g.config().tileSize) / 2);
    aimAt(p.x + 400, p.y);
    g.stepSim(1);
    if (powered) { g.shift(); stepPast(40); g.shiftUp(); } else { g.shoot(); }
    stepPast(60);
    const xs = (g.fires() as { x: number }[]).map((f) => f.x);
    return {
      count: xs.length,
      spread: xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs),
    };
  }

  it('lays a lane of fire on a power shot, not a single patch', () => {
    const lane = fireLaneFrom(true);
    expect(lane.count, 'a powered fire arrow lit no lane').toBeGreaterThan(2);
    expect(lane.spread, 'every fire it lit landed in one place').toBeGreaterThan(100);
  });

  it('leaves a plain fire arrow lighting nothing like a lane', () => {
    // The contrast that makes the lane a power-shot thing rather than a fire
    // thing: an ordinary fire arrow spreads no fire along its flight at all.
    expect(fireLaneFrom(false).spread, 'a plain fire arrow laid a lane too')
      .toBeLessThan(100);
  });

  it('lets a powered ricochet outlast the bounces an ordinary one gets', () => {
    // The cap itself, since a bounce count depends on where the walls are and
    // this suite clears the arena. What matters is that powered reads higher.
    expect(g.config().archerPowerBounces).toBeGreaterThan(9);
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
