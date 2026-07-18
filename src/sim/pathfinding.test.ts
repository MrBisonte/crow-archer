import { describe, expect, it } from 'vitest';

import { FovMap, PathScheduler, type PathAgent } from './pathfinding';

const agent = (state = 'aggro'): PathAgent => ({ x: 0, y: 0, state, path: null, pathTimer: 0 });

describe('PathScheduler', () => {
  it('enqueues each agent once, idempotently', () => {
    const s = new PathScheduler(() => []);
    const agents = Array.from({ length: 10 }, () => agent());
    agents.forEach(a => s.request(a));
    agents.forEach(a => s.request(a));
    expect(s.pending).toBe(10);
  });

  it('serve honors the per-frame budget and leaves the rest queued', () => {
    let computes = 0;
    const s = new PathScheduler(() => { computes++; return [{ x: 1, y: 1 }]; }, { budget: 3 });
    const agents = Array.from({ length: 10 }, () => agent());
    agents.forEach(a => s.request(a));
    s.serve(0, 0);
    expect(computes).toBe(3);
    expect(s.pending).toBe(7);
  });

  it('serves FIFO so no agent starves', () => {
    const s = new PathScheduler(() => [{ x: 1, y: 1 }], { budget: 3 });
    const agents = Array.from({ length: 5 }, () => agent());
    agents.forEach(a => s.request(a));
    s.serve(0, 0);
    expect(agents.map(a => a.path !== null)).toEqual([true, true, true, false, false]);
  });

  it('skips agents that stopped being aggro while queued', () => {
    let computes = 0;
    const s = new PathScheduler(() => { computes++; return []; }, { budget: 5 });
    const live = agent('aggro');
    const dead = agent('passive');
    s.request(live);
    s.request(dead);
    s.serve(0, 0);
    expect(computes).toBe(1);
  });

  it('initialPhase spreads across the interval', () => {
    const s = new PathScheduler(() => [], { interval: 0.4 });
    const phases = new Set<number>();
    for (let i = 0; i < 50; i++) phases.add(s.initialPhase());
    expect(phases.size).toBeGreaterThan(40);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(0.4);
    }
  });
});

describe('FovMap', () => {
  // Fake FOV: marks a 3x3 block around the origin
  const block3x3 = (col: number, row: number, mark: (x: number, y: number) => void) => {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) mark(col + dc, row + dr);
  };

  it('marks computed cells visible, others not', () => {
    const f = new FovMap(10, 10, block3x3);
    f.update(5, 5);
    expect(f.isVisible(5, 5)).toBe(true);
    expect(f.isVisible(4, 4)).toBe(true);
    expect(f.isVisible(6, 6)).toBe(true);
    expect(f.isVisible(0, 0)).toBe(false);
  });

  it('bounds-checks isVisible', () => {
    const f = new FovMap(10, 10, block3x3);
    f.update(5, 5);
    expect(f.isVisible(-1, 5)).toBe(false);
    expect(f.isVisible(5, 99)).toBe(false);
  });

  it('skips recompute when the tile is unchanged', () => {
    let calls = 0;
    const f = new FovMap(10, 10, (c, r, mark) => { calls++; block3x3(c, r, mark); });
    f.update(5, 5);
    f.update(5, 5);
    expect(calls).toBe(1);
  });

  it('recomputes on a new tile and clears stale cells', () => {
    let calls = 0;
    const f = new FovMap(10, 10, (c, r, mark) => { calls++; block3x3(c, r, mark); });
    f.update(5, 5);
    f.update(2, 2);
    expect(calls).toBe(2);
    expect(f.isVisible(2, 2)).toBe(true);
    expect(f.isVisible(6, 6)).toBe(false);
  });

  it('invalidate clears visibility and forces recompute', () => {
    const f = new FovMap(10, 10, block3x3);
    f.update(2, 2);
    f.invalidate();
    expect(f.isVisible(2, 2)).toBe(false);
    expect(f.tile).toEqual([-1, -1]);
  });
});
