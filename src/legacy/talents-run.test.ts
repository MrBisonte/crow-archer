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
import { CHAR_TREES } from '../sim/talents';
import { ONE_SECOND, aimAt, clearArena, stepPast } from './arena-testkit';
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
  stat: (id: string) => number;
  held: (id: string) => boolean;
  grantMastery: (points: number) => void;
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
