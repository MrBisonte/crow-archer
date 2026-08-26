/**
 * The bow is the one part of the archer that reports a game state back to the
 * player: how far the power shot is drawn, and whether a shot just left. Those
 * are checked here as geometry rather than as a picture, the same way the
 * pixel grids are — see grid-testkit.ts for why.
 */

import { describe, expect, it } from 'vitest';

import { paintArcherBow, type BowPose } from './archer-bow';

interface Call { name: string; args: number[] }

/**
 * A recording stand-in for the 2D context. vitest runs in `node` here, so the
 * drawing calls themselves are the output.
 */
function fake(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const record = (name: string) => (...args: unknown[]) =>
    calls.push({ name, args: args.map(Number) });
  const ctx = {
    beginPath: record('beginPath'), moveTo: record('moveTo'), lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'), closePath: record('closePath'),
    stroke: record('stroke'), fill: record('fill'),
    strokeStyle: '', fillStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const pose = (over: Partial<BowPose> = {}): BowPose => ({
  aim: 0, draw: 0, recoil: 0, trim: '#39FF14', wash: (c) => c, ...over,
});

/** Where the string's nock ended up: the middle point of the three-point string. */
function nockOf(calls: Call[]): { x: number; y: number } {
  // The string is the last moveTo/lineTo/lineTo run in the pose.
  const i = calls.map((c) => c.name).lastIndexOf('moveTo');
  const line = calls[i + 1];
  return { x: line?.args[0] ?? NaN, y: line?.args[1] ?? NaN };
}

describe('the archer\'s bow', () => {
  it('holds the string at the grip when nothing is drawn', () => {
    // Aiming along +x, so the grip is 11 out and the nock sits on it.
    const { ctx, calls } = fake();
    paintArcherBow(ctx, pose());
    expect(Math.round(nockOf(calls).x)).toBe(11);
  });

  it('sights down the middle of the bow, not over his boots', () => {
    // The sprite's origin is on the ground between his feet and the body runs
    // from -22 to +10 around it, so a bow anchored at 0 hangs at ankle height —
    // which is where this one hung. It has to sit on his chest to be aimed
    // along, so the grip is well above the origin whatever the aim is doing.
    const { ctx, calls } = fake();
    paintArcherBow(ctx, pose({ aim: 0 }));
    expect(nockOf(calls).y).toBeLessThan(-5);
  });

  it('pulls the nock back as the draw deepens', () => {
    const at = (draw: number): number => {
      const { ctx, calls } = fake();
      paintArcherBow(ctx, pose({ draw }));
      return nockOf(calls).x;
    };
    // Monotonic, and a full draw has travelled the whole pull.
    expect(at(0.5)).toBeLessThan(at(0));
    expect(at(1)).toBeLessThan(at(0.5));
    expect(Math.round(at(0) - at(1))).toBe(10);
  });

  it('nocks an arrow only while the bow is drawn', () => {
    // The arrowhead is the one filled shape in the pose, so a fill is the tell.
    const drawn = fake(); paintArcherBow(drawn.ctx, pose({ draw: 0.6 }));
    const rest = fake(); paintArcherBow(rest.ctx, pose({ draw: 0 }));
    expect(drawn.calls.some((c) => c.name === 'fill')).toBe(true);
    expect(rest.calls.some((c) => c.name === 'fill')).toBe(false);
  });

  it('snaps the string past its rest on release, rather than easing back to it', () => {
    // A release is not a draw running backwards. If the nock only returned to
    // the grip there would be no loose to see: it has to overshoot and settle.
    const { ctx, calls } = fake();
    paintArcherBow(ctx, pose({ draw: 0, recoil: 1 }));
    expect(nockOf(calls).x).toBeGreaterThan(11);
  });

  it('swings the whole bow with the aim', () => {
    // Same bow a quarter turn on: what was along +x is now along +y.
    const along = fake(); paintArcherBow(along.ctx, pose({ aim: 0 }));
    const down = fake(); paintArcherBow(down.ctx, pose({ aim: Math.PI / 2 }));
    // Reach is measured from the bow hand, so aiming down puts the grip
    // GRIP below HAND_Y rather than GRIP below the origin.
    expect(Math.round(nockOf(along.calls).x)).toBe(11);
    expect(Math.round(nockOf(down.calls).y)).toBe(4);
  });
});
