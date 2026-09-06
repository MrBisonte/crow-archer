/**
 * Guards on the ultimate painters that looking at one cannot give you.
 *
 * The pictures are judged by playing the game; these are the faults that
 * survive being looked at. Two kinds are worth the code: a painter that draws
 * outside the life it was handed leaves a dead effect parked on the field, and
 * a painter that draws a REACH from anything but the number it was given is
 * lying to the player about where it is safe to stand.
 */
import { describe, expect, it } from 'vitest';

import {
  GROUND_SQUASH, paintPiercePip, paintUltimateBlast, paintUltimateCast,
  paintUltimateCharge, paintDetCord,
} from './ultimate-fx';
import { stamps } from './stamps';

/** Every context member these painters touch, and nothing else. */
const METHODS = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
  'ellipse', 'quadraticCurveTo', 'fill', 'stroke', 'fillRect', 'setLineDash',
  'drawImage', 'translate',
] as const;

const PROPS = [
  'globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineDashOffset',
] as const;

/** A call, with the alpha that was in force when it was made. Alpha is a
 *  property rather than an argument, so a recorder that only kept the last
 *  value could not tell which shape was drawn faintly. */
interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly alpha: number;
}

interface Recording {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: Call[];
  countOf(name: string): number;
  /** Every radius passed to `ellipse`, which is how a ground reach is drawn. */
  ellipseRadii(): number[];
}

/**
 * A context that remembers what it was asked to do.
 *
 * Deliberately smaller than the one in `characters.test.ts`: that one tracks a
 * transform matrix because the character painters nest rotations, and none of
 * these do. If a third painter test wants one of these, this is the copy to
 * lift into a testkit.
 */
function recorder(): Recording {
  const calls: Call[] = [];
  const target: Record<string, unknown> = {};
  const held: Record<string, unknown> = { globalAlpha: 1 };
  for (const name of METHODS) {
    target[name] = (...args: unknown[]): void => {
      calls.push({ name, args, alpha: held['globalAlpha'] as number });
    };
  }
  for (const name of PROPS) {
    Object.defineProperty(target, name, {
      get: () => held[name],
      set: (v: unknown) => { held[name] = v; },
    });
  }
  return {
    ctx: target as unknown as CanvasRenderingContext2D,
    calls,
    countOf: (name) => calls.filter((c) => c.name === name).length,
    ellipseRadii: () => calls.filter((c) => c.name === 'ellipse').map((c) => c.args[2] as number),
  };
}

// `stamps.get` needs a real canvas to cache into and vitest runs in `node`.
// The same stand-in `characters.test.ts` installs, for the same reason.
(globalThis as { document?: { createElement(tag: string): unknown } }).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`fake document can only create a canvas, got "${tag}"`);
    return { width: 0, height: 0, getContext: () => recorder().ctx };
  },
};

describe('the cast beat every ultimate opens on', () => {
  const pose = { x: 100, y: 200, age: 0.3, w: 800, h: 600 };

  it('draws its ring on the ground plane, not as a circle on the floor', () => {
    // The house rule `explosion.ts` states in full: the world is seen from
    // above and everything in it from the side, so a true circle reads as a
    // decal. Checked as the ratio the painter actually passed, because a
    // squash applied to the wrong axis still looks squashed in a screenshot.
    const rec = recorder();
    paintUltimateCast(rec.ctx, pose);
    const ellipses = rec.calls.filter((c) => c.name === 'ellipse');
    expect(ellipses.length).toBeGreaterThan(0);
    for (const e of ellipses) {
      expect((e.args[3] as number) / (e.args[2] as number)).toBeCloseTo(GROUND_SQUASH, 6);
    }
  });

  it('draws nothing before it starts or after it is over', () => {
    // A beat that painted past its life would park a gold ring on the field
    // and leave no error anywhere. Both bounds, because the two ways to get
    // this wrong are a missing guard and a clamp standing in for one.
    for (const age of [-0.01, 1, 1.5]) {
      const rec = recorder();
      paintUltimateCast(rec.ctx, { ...pose, age });
      expect(rec.calls, `age ${age}`).toEqual([]);
    }
  });

  it('leaves the context as it found it', () => {
    const rec = recorder();
    paintUltimateCast(rec.ctx, pose);
    expect(rec.countOf('save')).toBe(rec.countOf('restore'));
  });
});

describe('a sapper ultimate waiting on its fuse', () => {
  const pose = { x: 40, y: 60, left: 0.5, reach: 270, big: true, t: 1 };

  it('draws its danger ring at the reach it was handed, and at no other figure', () => {
    // THE fault this exists for. The inline drawing rang every charge at the
    // bare `dynamiteBlastRadius`, so THE BIG ONE -- which goes off at three
    // times that -- drew a ring a third of the size of the blast, and a player
    // standing on the line it showed them died there.
    const rec = recorder();
    paintUltimateCharge(rec.ctx, pose);
    const rings = rec.ellipseRadii();
    expect(rings.length).toBeGreaterThan(0);
    for (const r of rings) expect(r).toBe(pose.reach);
  });

  it('draws a shorter fuse the further it has burnt', () => {
    // The fuse IS the ability -- the whole bargain of THE BIG ONE is that
    // things can walk out of it -- so a fuse drawn at one length would be the
    // ability's only real tell, missing.
    const tipAt = (left: number): number => {
      const rec = recorder();
      paintUltimateCharge(rec.ctx, { ...pose, left });
      const curve = rec.calls.find((c) => c.name === 'quadraticCurveTo');
      expect(curve, 'no fuse was drawn').toBeDefined();
      return curve!.args[3] as number;      // the tip's y, above the body
    };
    // Further from the body is a longer fuse, and y grows downward.
    expect(tipAt(1)).toBeLessThan(tipAt(0.5));
    expect(tipAt(0.5)).toBeLessThan(tipAt(0));
  });

  it('draws the same charge smaller when it is one link of the carpet', () => {
    const area = (big: boolean): number => {
      const rec = recorder();
      paintUltimateCharge(rec.ctx, { ...pose, big });
      const body = rec.calls.find((c) => c.name === 'fillRect');
      expect(body, 'no body was drawn').toBeDefined();
      return (body!.args[2] as number) * (body!.args[3] as number);
    };
    expect(area(false)).toBeLessThan(area(true));
  });
});

describe('the cord the carpet is laid on', () => {
  it('draws nothing at all before anything has been laid', () => {
    const rec = recorder();
    paintDetCord(rec.ctx, { x0: 0, y0: 0, angle: 0, laid: 0, spark: -1 });
    expect(rec.calls).toEqual([]);
  });

  it('puts the spark on the cord only while it is running it', () => {
    // Off either end it is a gold square sitting in open ground, which reads
    // as a pickup.
    const withSpark = (spark: number): number => {
      const rec = recorder();
      paintDetCord(rec.ctx, { x0: 0, y0: 0, angle: 0, laid: 300, spark });
      return rec.countOf('fillRect');
    };
    expect(withSpark(150)).toBe(1);
    expect(withSpark(-1)).toBe(0);
    expect(withSpark(301)).toBe(0);
  });
});

describe('the gold over an ultimate blast', () => {
  const pose = { x: 10, y: 20, radius: 90, age: 0.4 };

  it('draws nothing outside the blast it is layered over', () => {
    for (const age of [-0.01, 1, 2]) {
      const rec = recorder();
      paintUltimateBlast(rec.ctx, { ...pose, age });
      expect(rec.calls, `age ${age}`).toEqual([]);
    }
  });

  it('draws nothing for a blast with no radius', () => {
    const rec = recorder();
    paintUltimateBlast(rec.ctx, { ...pose, radius: 0 });
    expect(rec.calls).toEqual([]);
  });

  it('darkens the scorch as the fire goes out rather than with it', () => {
    // The scorch is the only mark any blast in this game leaves behind, and it
    // has to arrive as the fire LEAVES: painted at full strength from the
    // first frame it is just part of the fireball and reads as nothing.
    const scorchAlpha = (age: number): number => {
      const rec = recorder();
      paintUltimateBlast(rec.ctx, { ...pose, age });
      const last = rec.calls[rec.calls.length - 2];   // the scorch, then restore
      expect(last?.name, 'the scorch is not the last thing drawn').toBe('fill');
      return last!.alpha;
    };
    expect(scorchAlpha(0.9)).toBeGreaterThan(scorchAlpha(0.1));
    expect(scorchAlpha(0.02)).toBeLessThan(0.05);
  });
});

describe('the pip a pierced body throws', () => {
  it('bakes one stamp per size and keeps it', () => {
    // The sprite rule: `stamps.get` returns a cached canvas WITHOUT calling
    // the painter, so an unmemoized pip is rebuilt for every body a corridor
    // crosses, every frame it is held.
    const before = stamps.size;
    const rec = recorder();
    for (let i = 0; i < 20; i++) paintPiercePip(rec.ctx, i, i, 10, 1);
    expect(stamps.size - before).toBe(1);
    expect(rec.countOf('drawImage')).toBe(20);
  });

  it('draws nothing once it has faded out', () => {
    const rec = recorder();
    paintPiercePip(rec.ctx, 0, 0, 10, 0);
    expect(rec.calls).toEqual([]);
  });
});
