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

import { CHAR_TREES } from '../sim/talents';
import { ONE_SECOND, clearArena, stepPast } from './arena-testkit';
import { devHooks as g } from './game.js';

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

describe('the choosers', () => {
  it('opens the draft at run start when something is owned, and a pick wakes it', () => {
    talents().grant('blinkReach', 1);
    g.go('menu');
    g.go('playing');
    expect(g.state()).toBe('chooser');
    const c = g.chooser() as unknown as Chooser;
    expect(c.kind).toBe('draft');
    expect(c.offers).toEqual(['blinkReach']);
    g.chooserPick(0);
    expect(g.state()).toBe('playing');
    expect(talents().drafted()).toEqual(['blinkReach']);
  });

  it('skips the ceremony entirely when nothing is owned', () => {
    // beforeEach zeroed every ladder, so this run opened with no chooser.
    expect(g.state()).toBe('playing');
    expect(g.chooser()).toBeNull();
  });

  it('offers the rite before the boss draft, once, at the top rank', () => {
    for (let i = 0; i < 6; i++) talents().award('siege_cleared');   // rank 3
    talents().grant('blinkReach', 1);
    g.spawnBossNow(2);
    g.go('boss_fight');
    (g.boss() as { hp: number }).hp = 1;
    const b = g.boss() as { x: number; y: number };
    g.blast(b.x, b.y);
    stepPast(Math.ceil(1.5 * ONE_SECOND));
    const rite = g.chooser() as unknown as Chooser;
    expect(g.state()).toBe('chooser');
    expect(rite.kind).toBe('rite');
    expect(rite.offers).toEqual(['overchannel', 'stormcaller']);
    g.chooserPick(1);
    // The draft queued behind the rite opens without leaving the screen.
    const draft = g.chooser() as unknown as Chooser;
    expect(draft.kind).toBe('draft');
    g.chooserPick(0);
    // Both picks landed, and the screen handed back to the staged hand-off —
    // the dark archer's death leads into the dark knight's entrance.
    expect(talents().stormCooldown()).toBe(g.config().stormCooldown / 2);
    expect(talents().drafted()).toEqual(['blinkReach']);
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
    expect(g.state()).toBe('chooser');
  }

  it('fills the canvas rather than a literal design width', () => {
    // The fault this guards: char select's pre-rebuild row was sized from a
    // literal 1000, which is 57% of the 1760 canvas the game ships now.
    openDraft();
    const slots = layout().slots;
    const left = Math.min(...slots.map((s) => s.x));
    const right = Math.max(...slots.map((s) => s.x + s.w));
    expect(right - left).toBeGreaterThan(g.config().canvasW * 0.75);
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

describe('buying goes through the FEATHERS wallet', () => {
  it('refuses an open-tier talent the wallet cannot cover', () => {
    // Tier 1 is open at any rank, so this pins the wallet coupling alone;
    // the mastery gate itself is pinned pure in sim/talents.test.ts.
    const purse = g.feathers() as unknown as { wallet: () => number; spend: (n: number) => void };
    purse.spend(purse.wallet());
    // Ungranted first: an earlier test walked this ladder to its top, and a
    // maxed talent would answer before the wallet got to.
    talents().grant('blinkReach', 0);
    expect(talents().buy('blinkReach').kind).toBe('tooPoor');
  });
});
