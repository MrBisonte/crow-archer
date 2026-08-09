import { beforeEach, describe, expect, it } from 'vitest';

import type { Snapshot } from './protocol';
import { Interpolator } from './interpolation';

const DELAY = 100;

/** A snapshot with one body at x, the rest of the shape fixed. */
function snapAt(tick: number, x: number, y = 0): Snapshot {
  return {
    tick,
    entities: [{ id: 1, kind: 0, x, y, hp: 10, state: 0 }],
    acks: [],
  };
}

describe('Interpolator', () => {
  let interp: Interpolator;

  beforeEach(() => { interp = new Interpolator({ delayMs: DELAY }); });

  const xAt = (now: number) => interp.at(now).find((e) => e.id === 1)?.x;

  it('shows nothing before any snapshot arrives', () => {
    expect(interp.at(1000)).toEqual([]);
  });

  it('shows the only snapshot it has, whatever the time', () => {
    interp.push(snapAt(1, 100), 1000);
    expect(xAt(1000)).toBe(100);
    expect(xAt(5000)).toBe(100);
  });

  describe('between two snapshots', () => {
    beforeEach(() => {
      interp.push(snapAt(1, 100), 1000);
      interp.push(snapAt(2, 200), 1100);
    });

    it('sits on the older one at the start of the window', () => {
      // render time 1100 - 100 = 1000, exactly the first snapshot
      expect(xAt(1100)).toBe(100);
    });

    it('lands halfway at the midpoint', () => {
      expect(xAt(1150)).toBe(150);
    });

    it('reaches the newer one at the end of the window', () => {
      expect(xAt(1200)).toBe(200);
    });

    it('holds at the newest rather than guessing past it', () => {
      // Extrapolation invents positions the server never sent
      expect(xAt(2000)).toBe(200);
    });

    it('holds at the oldest rather than guessing before it', () => {
      expect(xAt(1000)).toBe(100);
    });
  });

  it('renders behind by the delay, which is the point of it', () => {
    interp.push(snapAt(1, 0), 1000);
    interp.push(snapAt(2, 100), 1100);
    // At 1150 the newest snapshot says 100, but we deliberately show 50
    expect(xAt(1150)).toBe(50);
  });

  it('ignores a snapshot that arrives out of order', () => {
    interp.push(snapAt(2, 200), 1000);
    interp.push(snapAt(1, 100), 1050);        // late, older tick
    expect(xAt(1100)).toBe(200);
  });

  it('drops snapshots too old to be needed', () => {
    for (let i = 1; i <= 20; i++) interp.push(snapAt(i, i * 10), 1000 + i * 50);
    expect(interp.buffered()).toBeLessThanOrEqual(4);
  });

  describe('entities coming and going', () => {
    it('takes a body present in only the newer snapshot', () => {
      interp.push({ tick: 1, entities: [], acks: [] }, 1000);
      interp.push(snapAt(2, 200), 1100);
      expect(xAt(1150)).toBe(200);
    });

    it('drops a body the newer snapshot no longer has', () => {
      interp.push(snapAt(1, 100), 1000);
      interp.push({ tick: 2, entities: [], acks: [] }, 1100);
      expect(interp.at(1150)).toEqual([]);
    });
  });

  it('rounds to whole pixels, matching what the world sends', () => {
    interp.push(snapAt(1, 0), 1000);
    interp.push(snapAt(2, 3), 1100);
    expect(Number.isInteger(xAt(1133))).toBe(true);
  });
});
