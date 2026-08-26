/**
 * The character-select screen's geometry, driven headlessly.
 *
 * `charSelectLayout` is arithmetic over `CONFIG` and `CHAR_PANELS` and touches
 * no canvas, so it runs here with no DOM the same way `stepSim` does. The
 * painting on top of it is checked in a browser; what is worth pinning in the
 * suite is that the row derives from the canvas and that the rects the draw
 * uses are the rects a click is tested against.
 */
import { describe, expect, it } from 'vitest';

import { type CharacterKind } from '../net/protocol';
import { CHARACTER_STATS } from '../sim/arena';
import { devHooks as g } from './game.js';

/** Every hero with a panel, in the order the row draws them. */
const ROSTER = ['archer', 'wizard', 'knight', 'ranger', 'sapper'] as const;

const layout = (): ReturnType<typeof g.charSelect> => g.charSelect();

const centres = (): number[] => layout().slots.map((s) => s.x + s.w / 2);

describe('char select layout', () => {
  it('gives every hero a panel', () => {
    expect(layout().slots).toHaveLength(ROSTER.length);
  });

  it('keeps every panel centred where it was, whichever hero is picked', () => {
    // The screen this replaces resized all five panels and re-centred the row
    // on each switch, so they slid sideways as the player cycled. That is
    // survivable with a keyboard and a moving target once they are clickable.
    g.selectChar('archer');
    const base = centres();
    for (const hero of ROSTER) {
      g.selectChar(hero);
      expect(centres()).toEqual(base);
    }
    g.selectChar('archer');
  });

  it('grows the picked panel and leaves the other four alone', () => {
    g.selectChar('knight');
    const { slots, selected } = layout();
    const picked = slots[selected]!;
    const others = slots.filter((_, i) => i !== selected);
    for (const s of others) {
      expect(picked.w).toBeGreaterThan(s.w);
      expect(picked.h).toBeGreaterThan(s.h);
    }
    // And the four that are not picked are all the same size as each other.
    expect(new Set(others.map((s) => `${s.w}x${s.h}`)).size).toBe(1);
    g.selectChar('archer');
  });

  it('fills most of the canvas it is given', () => {
    const { slots } = layout();
    const left = Math.min(...slots.map((s) => s.x));
    const right = Math.max(...slots.map((s) => s.x + s.w));
    const canvasW = g.config().canvasW;
    // The row this replaces was 998px wide from a hardcoded 1000, whatever the
    // canvas was — 94% of the shipped width and 57% of a wider one.
    expect(right - left).toBeGreaterThan(canvasW * 0.85);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(canvasW);
  });

  it('keeps every panel inside the canvas', () => {
    const canvasW = g.config().canvasW;
    const canvasH = g.config().canvasH;
    for (const hero of ROSTER) {
      g.selectChar(hero);
      for (const s of layout().slots) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(canvasW);
        expect(s.y).toBeGreaterThan(0);
        expect(s.y + s.h).toBeLessThan(canvasH);
      }
    }
    g.selectChar('archer');
  });

  it('leaves the detail strip and the key hint clear of the panels', () => {
    for (const hero of ROSTER) {
      g.selectChar(hero);
      const { slots, stripTop, hintY } = layout();
      const lowest = Math.max(...slots.map((s) => s.y + s.h));
      expect(lowest).toBeLessThan(stripTop);
      expect(stripTop).toBeLessThan(hintY);
      expect(hintY).toBeLessThan(g.config().canvasH);
    }
    g.selectChar('archer');
  });

  it('points `selected` at the hero that is actually picked', () => {
    for (let i = 0; i < ROSTER.length; i++) {
      g.selectChar(ROSTER[i]!);
      expect(layout().selected).toBe(i);
    }
    g.selectChar('archer');
  });
});

describe('char select stat rows', () => {
  it('gives every hero the same four rows, so panels can be read across', () => {
    const rows = g.charPanels().map((p) => p.statBars.map((b) => b.label));
    for (const set of rows) expect(set).toEqual(['RANGE', 'DAMAGE', 'HP', 'SPEED']);
  });

  it('prints a figure for HP and for nothing else', () => {
    // HP is the only one with a unit the player owns: 9 means nine hits.
    // RANGE and DAMAGE are authored impressions of a whole kit, and SPEED is
    // world units per second, which would be a number that says nothing.
    for (const p of g.charPanels()) {
      const withValue = p.statBars.filter((b) => b.value !== undefined).map((b) => b.label);
      expect(withValue).toEqual(['HP']);
    }
  });

  it('shows the HP the simulation actually runs on', () => {
    for (const p of g.charPanels()) {
      const hp = p.statBars.find((b) => b.label === 'HP');
      expect(hp?.value).toBe(CHARACTER_STATS[p.char as CharacterKind].maxHp);
    }
  });

  it('orders every difficulty, so the meter has a length to draw', () => {
    const orders = g.charPanels().map((p) => p.difficulty.order);
    for (const o of orders) {
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(1);
    }
    // EASY must read shorter than EXTRA HARD, or the meter says the opposite
    // of the word beside it.
    const byLabel = new Map(g.charPanels().map((p) => [p.difficulty.label, p.difficulty.order]));
    expect(byLabel.get('EASY')!).toBeLessThan(byLabel.get('MEDIUM')!);
    expect(byLabel.get('MEDIUM')!).toBeLessThan(byLabel.get('HARD')!);
    expect(byLabel.get('HARD')!).toBeLessThan(byLabel.get('EXTRA HARD')!);
  });
});
