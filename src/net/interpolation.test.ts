import { beforeEach, describe, expect, it } from 'vitest';

import type { Snapshot } from './protocol';
import { Interpolator } from './interpolation';

const DELAY = 100;

/** Simulated milliseconds in one tick and in one snapshot, as the server sends. */
const MS_PER_TICK = 1000 / 60;
const SNAPSHOT_MS = 3 * MS_PER_TICK;          // 50 ms, a 20 Hz snapshot

/** When the first snapshot lands, so the numbers below read as a wall clock. */
const T0 = 1000;

/**
 * Snapshot number n: tick 3(n+1), so it sits at (n+1) * 50 ms of sim time.
 *
 * With arrivals a snapshot apart the clock offset works out to T0 - SNAPSHOT_MS,
 * which makes the moment being drawn `now - 1050` throughout. Every expectation
 * below is that arithmetic and nothing cleverer.
 */
function snapshot(n: number, x: number, y = 0): Snapshot {
  return {
    tick: 3 * (n + 1),
    entities: [{ id: 1, kind: 0, x, y, hp: 10, state: 0 }],
    acks: [],
  };
}

/** When snapshot n lands if the connection is behaving. */
const arrivalOf = (n: number) => T0 + n * SNAPSHOT_MS;

/** The moment being drawn at a wall-clock time, for readable expectations. */
const drawnMomentAt = (now: number) => now - (T0 - SNAPSHOT_MS) - DELAY;

describe('Interpolator', () => {
  let interp: Interpolator;

  beforeEach(() => {
    interp = new Interpolator({ delayMs: DELAY, msPerTick: MS_PER_TICK });
  });

  const xAt = (now: number) => interp.at(now).find((e) => e.id === 1)?.x;

  it('shows nothing before any snapshot arrives', () => {
    expect(interp.at(1000)).toEqual([]);
  });

  it('shows the only snapshot it has, whatever the time', () => {
    interp.push(snapshot(0, 100), arrivalOf(0));
    expect(xAt(1000)).toBe(100);
    expect(xAt(5000)).toBe(100);
  });

  describe('between two snapshots', () => {
    beforeEach(() => {
      interp.push(snapshot(0, 100), arrivalOf(0));      // sim 50 ms, x 100
      interp.push(snapshot(1, 200), arrivalOf(1));      // sim 100 ms, x 200
    });

    it('sits on the older one at the start of the window', () => {
      expect(drawnMomentAt(1100)).toBe(SNAPSHOT_MS);    // exactly the first
      expect(xAt(1100)).toBe(100);
    });

    it('lands halfway at the midpoint', () => {
      expect(xAt(1125)).toBe(150);
    });

    it('reaches the newer one at the end of the window', () => {
      expect(xAt(1150)).toBe(200);
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
    interp.push(snapshot(0, 0), arrivalOf(0));
    interp.push(snapshot(1, 100), arrivalOf(1));
    // The newest snapshot says 100; halfway through the window we show 50
    expect(xAt(1125)).toBe(50);
  });

  it('ignores a snapshot that arrives out of order', () => {
    interp.push(snapshot(1, 200), arrivalOf(1));
    interp.push(snapshot(0, 100), arrivalOf(1) + 10);   // late, older tick
    expect(xAt(1150)).toBe(200);
  });

  it('drops snapshots too old to be needed', () => {
    for (let n = 0; n < 30; n++) interp.push(snapshot(n, n * 10), arrivalOf(n));
    expect(interp.buffered()).toBeLessThanOrEqual(6);
  });

  /**
   * The reason the timeline is the server's. Ticks are evenly spaced and
   * arrivals are not, which is what a real connection does. Rendered motion
   * must follow the ticks: against arrival times a 700 px/s arrow changed speed
   * by a quarter on every packet.
   */
  it('moves at a steady speed however unevenly the packets land', () => {
    const jitteredArrivals = [0, 63, 96, 150, 197, 261];
    // 35 px per snapshot is an arrow at 700 px/s
    jitteredArrivals.forEach((offset, n) => {
      interp.push(snapshot(n, n * 35), T0 + offset);
    });

    // Sampled inside the interpolated range rather than on the clamp at either
    // end, which is a different behaviour with its own tests.
    const samples: number[] = [];
    for (let now = 1140; now <= 1300; now += 10) samples.push(xAt(now)!);
    const steps = samples.slice(1).map((x, i) => x - samples[i]!);

    // 10 ms of a 700 px/s arrow is 7 px, on every sample, with no exceptions
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...steps)).toBeLessThanOrEqual(8);
  });

  /**
   * The delay must not move. It was briefly derived from measured lateness, and
   * a target that shifts between frames spread a 700 px/s arrow across 379 to
   * 1285 px/s. Any fixed value held it inside 680 to 790.
   */
  it('renders behind by the same amount however late the packets are', () => {
    interp.push(snapshot(0, 0), arrivalOf(0));
    expect(interp.delayMs()).toBe(DELAY);
    interp.push(snapshot(1, 10), arrivalOf(1) + 400);       // very late
    expect(interp.delayMs()).toBe(DELAY);
  });

  describe('entities coming and going', () => {
    it('waits for a body the older snapshot did not have yet', () => {
      // The moment being drawn is at or after the older snapshot, and this body
      // did not exist then. Drawing it early puts it a delay ahead of itself.
      interp.push({ tick: 3, entities: [], acks: [] }, arrivalOf(0));
      interp.push(snapshot(1, 200), arrivalOf(1));
      expect(xAt(1125)).toBeUndefined();
    });

    it('keeps a body the newer snapshot has dropped', () => {
      // An arrow that hit something is still in flight at the moment being
      // drawn. Removing it now deletes it a whole delay before the impact.
      interp.push(snapshot(0, 100), arrivalOf(0));
      interp.push({ tick: 6, entities: [], acks: [] }, arrivalOf(1));
      expect(xAt(1125)).toBe(100);
    });

    it('lets it go once the drawn moment passes the snapshot that dropped it', () => {
      interp.push(snapshot(0, 100), arrivalOf(0));
      interp.push({ tick: 6, entities: [], acks: [] }, arrivalOf(1));
      interp.push({ tick: 9, entities: [], acks: [] }, arrivalOf(2));
      expect(interp.at(1200)).toEqual([]);
    });
  });

  it('rounds to whole pixels, matching what the world sends', () => {
    interp.push(snapshot(0, 0), arrivalOf(0));
    interp.push(snapshot(1, 3), arrivalOf(1));
    expect(Number.isInteger(xAt(1133))).toBe(true);
  });
});
