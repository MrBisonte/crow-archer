import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  drawCrow,
  drawPickup,
  drawShot,
  type PickupKind,
  type ShotFlavour,
  type ShotVisual,
} from './entities';
import { stamps } from './stamps';

/**
 * One thing the code did to the context, in order. Property sets and method
 * calls share a log because several assertions here are about ordering — which
 * colour was set last before the countdown was written, for instance.
 */
type Entry =
  | { kind: 'call'; name: string; args: readonly unknown[] }
  | { kind: 'set'; name: string; value: unknown };

interface Recorder {
  ctx: CanvasRenderingContext2D;
  log: Entry[];
}

/** Everything the painters call. All no-ops; only the fact of the call matters. */
const NO_OP_METHODS = [
  'save', 'restore', 'translate', 'scale', 'rotate', 'beginPath', 'moveTo', 'lineTo',
  'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'fill', 'stroke',
  'fillRect', 'strokeRect', 'drawImage', 'setLineDash', 'fillText', 'arcTo', 'rect',
  'clip', 'clearRect',
];

/**
 * A canvas context that draws nothing and remembers everything. The project
 * runs vitest under node with no DOM, and a fake is the point anyway: these are
 * assertions about the drawing commands, not about pixels.
 */
function fakeContext(): Recorder {
  const log: Entry[] = [];
  const target: Record<string, unknown> = {};
  for (const name of NO_OP_METHODS) {
    target[name] = (...args: unknown[]): void => { log.push({ kind: 'call', name, args }); };
  }
  const record = (name: string) => (...args: unknown[]): void => {
    log.push({ kind: 'call', name, args });
  };
  const gradient = { addColorStop: (): void => {} };
  target['createLinearGradient'] = (...args: unknown[]) => {
    record('createLinearGradient')(...args);
    return gradient;
  };
  target['createRadialGradient'] = (...args: unknown[]) => {
    record('createRadialGradient')(...args);
    return gradient;
  };
  target['measureText'] = (...args: unknown[]) => {
    record('measureText')(...args);
    return { width: 0 };
  };
  const proxy = new Proxy(target, {
    set(obj, prop, value): boolean {
      if (typeof prop === 'string') log.push({ kind: 'set', name: prop, value });
      return Reflect.set(obj, prop, value);
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, log };
}

const callsOf = (rec: Recorder, name: string): readonly (readonly unknown[])[] =>
  rec.log.flatMap((e) => (e.kind === 'call' && e.name === name ? [e.args] : []));

const setsOf = (rec: Recorder, prop: string): unknown[] =>
  rec.log.flatMap((e) => (e.kind === 'set' && e.name === prop ? [e.value] : []));

/** Every colour the draw committed to, in order. */
const stylesOf = (rec: Recorder): string[] =>
  rec.log.flatMap((e) =>
    e.kind === 'set'
    && (e.name === 'fillStyle' || e.name === 'strokeStyle')
    && typeof e.value === 'string'
      ? [e.value]
      : []);

const textsOf = (rec: Recorder): unknown[] => callsOf(rec, 'fillText').map((args) => args[0]);

const shot = (over: Partial<ShotVisual> = {}): ShotVisual =>
  ({ x: 100, y: 50, angle: 0, flavour: 'arrow', team: 0, fuse: 0, ...over });

/** Draws one shot into a fresh recorder and hands the recorder back. */
const recordShot = (over: Partial<ShotVisual>, loopT = 0): Recorder => {
  const rec = fakeContext();
  drawShot(rec.ctx, shot(over), loopT, 32);
  return rec;
};

/** The contract every one of these functions owes its caller. */
function expectContextHandedBack(rec: Recorder): void {
  expect(callsOf(rec, 'save').length).toBeGreaterThan(0);
  expect(callsOf(rec, 'save')).toHaveLength(callsOf(rec, 'restore').length);
  expect(setsOf(rec, 'globalAlpha').at(-1) ?? 1).toBe(1);
  expect(callsOf(rec, 'setLineDash').at(-1) ?? [[]]).toEqual([[]]);
}

beforeAll(() => {
  // The crow's eye glow comes from the shared stamp cache, which bakes it into
  // an offscreen canvas. Stubbed here rather than in the source, because the
  // source must keep talking to a real canvas in the browser.
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string): unknown {
        if (tag !== 'canvas') throw new Error(`the renderer only makes canvases, not <${tag}>`);
        return { width: 0, height: 0, getContext: (): CanvasRenderingContext2D => fakeContext().ctx };
      },
    },
  });
});

afterAll(() => { Reflect.deleteProperty(globalThis, 'document'); });

const FLAVOURS: readonly ShotFlavour[] = ['arrow', 'bolt', 'dynamite'];
const KINDS: readonly PickupKind[] = ['ricochet', 'fire', 'shield'];

describe('drawShot', () => {
  it('draws every flavour without falling over', () => {
    for (const flavour of FLAVOURS) {
      expect(() => recordShot({ flavour, fuse: 0.4 }, 1.7)).not.toThrow();
    }
  });

  it('hands the context back the way it found it', () => {
    for (const flavour of FLAVOURS) expectContextHandedBack(recordShot({ flavour, fuse: 0.4 }, 1.7));
  });

  it('draws below the HUD, because that is where the arena starts', () => {
    expect(callsOf(recordShot({ x: 100, y: 50 }), 'translate')[0]).toEqual([100, 82]);
  });

  it('points an arrow where it is going', () => {
    expect(callsOf(recordShot({ angle: 0 }), 'rotate')).toEqual([[0]]);
    expect(callsOf(recordShot({ angle: Math.PI / 2 }), 'rotate')).toEqual([[Math.PI / 2]]);
  });

  it('points a bolt where it is going too', () => {
    expect(callsOf(recordShot({ flavour: 'bolt', angle: Math.PI / 2 }), 'rotate'))
      .toEqual([[Math.PI / 2]]);
  });

  it('paints the two sides apart, so you can tell whose arrow is coming at you', () => {
    const green = stylesOf(recordShot({ team: 0 }));
    const cyan = stylesOf(recordShot({ team: 1 }));
    expect(green).toContain('#39FF14');
    expect(cyan).toContain('#39E0FF');
    expect(green).not.toEqual(cyan);
  });

  it('tints the bolt glow by side as well', () => {
    const green = recordShot({ flavour: 'bolt', team: 0 });
    const cyan = recordShot({ flavour: 'bolt', team: 1 });
    expect(setsOf(green, 'shadowColor')).toContain('#39FF14');
    expect(setsOf(cyan, 'shadowColor')).toContain('#39E0FF');
    expect(stylesOf(green)).not.toEqual(stylesOf(cyan));
  });

  it('keeps dynamite red for both sides, because the blast does not take sides', () => {
    const theirs = recordShot({ flavour: 'dynamite', team: 0, fuse: 0.3 }, 2);
    const ours = recordShot({ flavour: 'dynamite', team: 1, fuse: 0.3 }, 2);
    expect(stylesOf(theirs)).toEqual(stylesOf(ours));
    expect(stylesOf(theirs)).toContain('#FF1F1F');
  });

  describe('dynamite', () => {
    const dyn = (fuse: number, loopT = 0): Recorder =>
      recordShot({ flavour: 'dynamite', fuse }, loopT);

    it('shows the blast it is about to make', () => {
      expect(callsOf(dyn(0.2), 'arc').map((args) => args[2])).toContain(90);
      expect(callsOf(dyn(0.2), 'setLineDash')[0]).toEqual([[4, 4]]);
    });

    it('counts the seconds down as the fuse burns', () => {
      expect(textsOf(dyn(0.1)).at(-1)).toBe('2');
      expect(textsOf(dyn(0.9)).at(-1)).toBe('1');
      expect(textsOf(dyn(0.1))).not.toEqual(textsOf(dyn(0.9)));
    });

    it('never shows a zero, which would claim it had already gone off', () => {
      expect(textsOf(dyn(1))).not.toContain('0');
    });

    it('runs the number white, then amber, then red as it runs out', () => {
      expect(stylesOf(dyn(0.1)).at(-1)).toBe('#FFFFFF');
      expect(stylesOf(dyn(0.5)).at(-1)).toBe('#FFB400');
      expect(stylesOf(dyn(0.9)).at(-1)).toBe('#FF1F1F');
    });

    it('tumbles on the clock, so no stored angle has to be sent for it', () => {
      expect(callsOf(dyn(0.4, 0), 'rotate')).not.toEqual(callsOf(dyn(0.4, 1.5), 'rotate'));
    });

    it('chars more of the wick the further the fuse has burnt', () => {
      const curves = (fuse: number): readonly (readonly unknown[])[] =>
        callsOf(dyn(fuse), 'quadraticCurveTo');
      expect(curves(0.2)).toHaveLength(2);
      expect(curves(0.2)[1]).not.toEqual(curves(0.8)[1]);
    });
  });
});

describe('drawPickup', () => {
  const pickup = (kind: PickupKind, loopT = 0): Recorder => {
    const rec = fakeContext();
    drawPickup(rec.ctx, { x: 60, y: 40, kind }, loopT, 32);
    return rec;
  };

  it('draws all three kinds without falling over', () => {
    for (const kind of KINDS) expect(() => pickup(kind, 3.1)).not.toThrow();
  });

  it('hands the context back the way it found it', () => {
    for (const kind of KINDS) expectContextHandedBack(pickup(kind, 3.1));
  });

  it('gives each kind a look of its own, so loot is identifiable on sight', () => {
    const looks = KINDS.map((kind) => stylesOf(pickup(kind)).join('|'));
    expect(new Set(looks).size).toBe(3);
  });

  it('sits every kind on the same pedestal', () => {
    for (const kind of KINDS) {
      expect(callsOf(pickup(kind), 'ellipse')[0]).toEqual([0, 8, 8, 1.8, 0, 0, Math.PI * 2]);
    }
  });

  it('bobs, so loot does not read as scenery', () => {
    // Translate 0 is the pickup's spot; translate 1 is the float on top of it.
    expect(callsOf(pickup('shield', 0), 'translate')[1])
      .not.toEqual(callsOf(pickup('shield', 0.7), 'translate')[1]);
  });

  it('draws below the HUD', () => {
    expect(callsOf(pickup('fire'), 'translate')[0]).toEqual([60, 72]);
  });
});

describe('drawCrow', () => {
  const crow = (wingPhase: number, loopT = 0): Recorder => {
    const rec = fakeContext();
    drawCrow(rec.ctx, { x: 200, y: 90, wingPhase }, loopT, 32);
    return rec;
  };

  it('draws without falling over and hands the context back', () => {
    expect(() => crow(1.2, 4.4)).not.toThrow();
    expectContextHandedBack(crow(1.2, 4.4));
  });

  it('draws below the HUD', () => {
    expect(callsOf(crow(0), 'translate')[0]).toEqual([200, 122]);
  });

  it('flaps: a different wing phase puts the wings somewhere else', () => {
    expect(callsOf(crow(0.4), 'ellipse')).not.toEqual(callsOf(crow(2.9), 'ellipse'));
  });

  it('counter-phases the two wings, so it reads as flapping and not as bouncing', () => {
    const wings = callsOf(crow(1), 'ellipse');
    expect(wings.length).toBeGreaterThanOrEqual(7);
    expect(wings[3]).toBeDefined();
    expect(wings[3]).not.toEqual(wings[5]);
  });

  it('never blurs live, because a whole flock of them would cost the frame', () => {
    expect(setsOf(crow(1, 2), 'shadowBlur')).toEqual([0]);
    expect(callsOf(crow(1, 2), 'drawImage')).toHaveLength(1);
  });

  it('reuses one baked eye across the flock rather than baking one per bird', () => {
    const before = stamps.size;
    crow(0.1);
    crow(2.2);
    expect(stamps.size - before).toBeLessThanOrEqual(1);
  });
});
