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

  describe('invalidateThrough', () => {
    const TS = 32;
    /** A route along row 3, walking right through columns 1 to 4. */
    const walker = (): PathAgent => ({
      x: 48, y: 112, state: 'aggro', pathTimer: 0.4,
      path: [
        { x: 1 * TS + 16, y: 3 * TS + 16 },
        { x: 2 * TS + 16, y: 3 * TS + 16 },
        { x: 3 * TS + 16, y: 3 * TS + 16 },
        { x: 4 * TS + 16, y: 3 * TS + 16 },
      ],
    });

    it('drops a route that walks through the tile that just turned solid', () => {
      const s = new PathScheduler(() => []);
      const a = walker();
      expect(s.invalidateThrough([a], 3, 2, TS)).toBe(1);
      expect(a.path).toBeNull();
    });

    it('re-requests immediately rather than after the interval', () => {
      const s = new PathScheduler(() => []);
      const a = walker();
      s.invalidateThrough([a], 3, 2, TS);
      expect(a.pathTimer).toBe(0);
    });

    it('leaves a route that does not touch that tile alone', () => {
      const s = new PathScheduler(() => []);
      const a = walker();
      const before = a.path;
      expect(s.invalidateThrough([a], 9, 9, TS)).toBe(0);
      expect(a.path).toBe(before);
      expect(a.pathTimer).toBe(0.4);
    });

    it('drops only the agents actually routed through it', () => {
      const s = new PathScheduler(() => []);
      const through = walker();
      const elsewhere = walker();
      elsewhere.path = [{ x: 9 * TS + 16, y: 9 * TS + 16 }];
      expect(s.invalidateThrough([through, elsewhere], 3, 2, TS)).toBe(1);
      expect(through.path).toBeNull();
      expect(elsewhere.path).not.toBeNull();
    });

    it('ignores agents with no route yet', () => {
      const s = new PathScheduler(() => []);
      const idle: PathAgent = { x: 0, y: 0, state: 'aggro', path: null, pathTimer: 0.4 };
      expect(s.invalidateThrough([idle], 3, 2, TS)).toBe(0);
      expect(idle.pathTimer).toBe(0.4);
    });

    // The freeze the flight recorder caught on 2026-08-30: the Crow King's
    // bats ride in `crows` with no `path` field at all, and a sapling maturing
    // mid-boss-fight walked exactly that roster through here. `undefined` must
    // be as ignorable as `null`, or one field-less agent kills the frame loop.
    it('shrugs at an agent that has no path field at all', () => {
      const s = new PathScheduler(() => []);
      const bat: PathAgent = { x: 0, y: 0, state: 'aggro', pathTimer: 0 };
      const routed = walker();
      expect(s.invalidateThrough([bat, routed], 3, 2, TS)).toBe(1);
      expect(routed.path).toBeNull();
    });

    // A tile is a square, and only one of its two coordinates matching is the
    // same column on a different row. Walking the route's own row one tile up
    // is the cheapest way to say so.
    it('does not confuse a tile with its neighbour in the other axis', () => {
      const s = new PathScheduler(() => []);
      const a = walker();
      expect(s.invalidateThrough([a], 2, 2, TS)).toBe(0);
      expect(a.path).not.toBeNull();
    });
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
