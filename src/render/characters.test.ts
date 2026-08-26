import { describe, expect, it } from 'vitest';

import { CHARACTERS } from '../net/protocol';
import type { CharacterKind } from '../net/protocol';
import { drawCharacter, type CharacterVisual } from './characters';

// ---------------------------------------------------------------------------
// A recording stand-in for CanvasRenderingContext2D
// ---------------------------------------------------------------------------
//
// vitest runs in the `node` environment here, so there is no canvas and no
// pixels to look at. The drawing calls themselves are the output, so the fake
// records them and the tests assert on what was asked for.
//
// It also tracks the transform stack, because a coordinate on its own says
// almost nothing: the knight's thrust lives in a translate, not in the numbers
// passed to lineTo, so an untransformed recording shows a resting spear and a
// thrusting one as identical.

/** Canvas transform, in the [a, b, c, d, e, f] order the DOM API uses. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface Point {
  x: number;
  y: number;
}

interface Call {
  name: string;
  args: readonly unknown[];
}

interface PropSet {
  name: string;
  value: unknown;
}

interface Recording {
  /** The context handed to the code under test. */
  ctx: CanvasRenderingContext2D;
  calls: Call[];
  props: PropSet[];
  /** Every drawn point, mapped through the transform that was live at the time. */
  points: Point[];
  /** save() minus restore(). Zero once a balanced draw finishes. */
  depth(): number;
  /** The live transform. The identity again once a balanced draw finishes. */
  matrix(): Matrix;
  /** Every value assigned to one property, in order, raw. */
  valuesOf(prop: string): unknown[];
  countOf(method: string): number;
}

/** Index of the x of each (x, y) pair in a method's argument list. */
const POINT_ARGS: Record<string, readonly number[] | undefined> = {
  moveTo: [0],
  lineTo: [0],
  arc: [0],
  ellipse: [0],
  rect: [0],
  fillRect: [0],
  strokeRect: [0],
  arcTo: [0, 2],
  quadraticCurveTo: [0, 2],
  bezierCurveTo: [0, 2, 4],
  // The baked body is one drawImage call; its destination is the only place
  // position-only animation (the knight's walk bob) still shows up, now that
  // the shape itself is baked into a cached canvas instead of redrawn.
  drawImage: [1],
};

/** Rectangles also pin down their far corner, which is where their extent is. */
const RECT_METHODS = new Set(['rect', 'fillRect', 'strokeRect']);

const PLAIN_METHODS = [
  'beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo',
  'closePath', 'fill', 'stroke', 'fillRect', 'strokeRect', 'drawImage', 'setLineDash',
  'fillText', 'arcTo', 'rect', 'clip', 'clearRect',
] as const;

const TRACKED_PROPS = [
  'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'shadowColor', 'shadowBlur',
  'font', 'textAlign', 'lineCap', 'lineJoin', 'globalCompositeOperation',
] as const;

const apply = (m: Matrix, x: number, y: number): Point => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

function fakeContext(): Recording {
  const calls: Call[] = [];
  const props: PropSet[] = [];
  const points: Point[] = [];
  const stack: Matrix[] = [];
  let matrix: Matrix = IDENTITY;
  const target: Record<string, unknown> = {};

  const record = (name: string, args: readonly unknown[]): void => {
    calls.push({ name, args });
    for (const i of POINT_ARGS[name] ?? []) {
      const x = args[i];
      const y = args[i + 1];
      if (typeof x === 'number' && typeof y === 'number') points.push(apply(matrix, x, y));
    }
    if (RECT_METHODS.has(name)) {
      const [x, y, w, h] = args;
      if (typeof x === 'number' && typeof y === 'number' &&
          typeof w === 'number' && typeof h === 'number') {
        points.push(apply(matrix, x + w, y + h));
      }
    }
  };

  for (const name of PLAIN_METHODS) {
    target[name] = (...args: unknown[]): void => record(name, args);
  }
  target['save'] = (): void => { record('save', []); stack.push(matrix); };
  target['restore'] = (): void => {
    record('restore', []);
    const previous = stack.pop();
    if (previous) matrix = previous;
  };
  target['translate'] = (tx: number, ty: number): void => {
    record('translate', [tx, ty]);
    const [a, b, c, d, e, f] = matrix;
    matrix = [a, b, c, d, e + a * tx + c * ty, f + b * tx + d * ty];
  };
  target['scale'] = (sx: number, sy: number): void => {
    record('scale', [sx, sy]);
    const [a, b, c, d, e, f] = matrix;
    matrix = [a * sx, b * sx, c * sy, d * sy, e, f];
  };
  target['rotate'] = (r: number): void => {
    record('rotate', [r]);
    const [a, b, c, d, e, f] = matrix;
    const cos = Math.cos(r), sin = Math.sin(r);
    matrix = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
  };
  target['createLinearGradient'] = (...args: unknown[]): { addColorStop: () => void } => {
    record('createLinearGradient', args);
    return { addColorStop: () => undefined };
  };
  target['measureText'] = (...args: unknown[]): { width: number } => {
    record('measureText', args);
    return { width: 0 };
  };

  for (const name of TRACKED_PROPS) {
    let held: unknown;
    Object.defineProperty(target, name, {
      get: () => held,
      set: (next: unknown) => { held = next; props.push({ name, value: next }); },
    });
  }

  return {
    ctx: target as unknown as CanvasRenderingContext2D,
    calls,
    props,
    points,
    depth: () => stack.length,
    matrix: () => matrix,
    valuesOf: (prop) => props.filter((p) => p.name === prop).map((p) => p.value),
    countOf: (method) => calls.filter((c) => c.name === method).length,
  };
}

// stamps.ts needs a real `document.createElement('canvas')` to cache the
// baked body into, once per (character, trim, wash) key; vitest's `node`
// environment has none. A minimal stand-in is enough — the same recording
// technique as the main draw target, so the cached canvas's own fillRect
// calls stay inspectable via `.getContext('2d')` instead of silently
// vanishing into a real, un-inspectable canvas.
interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D;
}

(globalThis as { document?: { createElement(tag: string): FakeCanvas } }).document = {
  createElement(tag: string): FakeCanvas {
    if (tag !== 'canvas') throw new Error(`fake document can only create a canvas, got "${tag}"`);
    return { width: 0, height: 0, getContext: () => fakeContext().ctx };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KINDS: readonly CharacterKind[] = ['archer', 'wizard', 'knight'];

const visual = (over: Partial<CharacterVisual> = {}): CharacterVisual => ({
  x: 0, y: 0, character: 'archer', facing: 1, aimAngle: 0, walkPhase: 0,
  team: 0, shielded: false, dead: false, swingProgress: 0, hitFlash: 0,
  ...over,
});

const draw = (over: Partial<CharacterVisual> = {}, loopT = 0, hudHeight = 0): Recording => {
  const rec = fakeContext();
  drawCharacter(rec.ctx, visual(over), loopT, hudHeight);
  return rec;
};

const dist = (p: Point): number => Math.hypot(p.x, p.y);

/**
 * The cached canvas the baked body was blitted from. Body colour (team trim,
 * hit-flash white, down-state grey) is baked into that canvas by stamps.ts
 * and never touches the outer context directly, so "does the body look
 * different" is answered by comparing *which* cached canvas got drawn, not
 * by looking for a hex colour that no longer appears out here.
 */
const bodyCanvas = (rec: Recording): unknown => rec.calls.find((c) => c.name === 'drawImage')?.args[0];

/** The drawn point furthest from the body's own origin: a weapon tip, in practice. */
const reach = (rec: Recording): Point =>
  rec.points.reduce((far, p) => (dist(p) > dist(far) ? p : far), { x: 0, y: 0 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('drawCharacter', () => {
  for (const character of KINDS) {
    it(`draws the ${character} without throwing`, () => {
      expect(() => draw({ character })).not.toThrow();
      // The body itself is one drawImage call now (see paintBakedBody), not
      // a few dozen individual shape draws — this floor is a "did the
      // shadow, body and weapon all actually run" sanity check, not a count
      // calibrated to the old per-shape implementation.
      expect(draw({ character }).calls.length).toBeGreaterThan(8);
    });

    it(`gives the ${character} back the context it was handed`, () => {
      const rec = draw({ character, dead: true, shielded: true, facing: -1 });
      expect(rec.countOf('save')).toBe(rec.countOf('restore'));
      expect(rec.depth()).toBe(0);
      expect(rec.matrix()).toEqual(IDENTITY);
    });

    it(`draws the ${character} the same way twice, holding no state`, () => {
      const v = { character, walkPhase: 2.1, aimAngle: 0.9, hitFlash: 0.3 } as const;
      expect(draw(v, 3.5).calls).toEqual(draw(v, 3.5).calls);
    });

    it(`shows which side the ${character} is on`, () => {
      // Team trim is baked into the body (see character-grids.ts), so two
      // teams draw from two different cached canvases, not two fillStyles
      // on the same one.
      const teamA = draw({ character, team: 0 });
      const teamB = draw({ character, team: 1 });
      expect(bodyCanvas(teamA)).toBeDefined();
      expect(bodyCanvas(teamA)).not.toBe(bodyCanvas(teamB));
    });

    it(`haloes a shielded ${character}, knight included`, () => {
      const bare = draw({ character });
      const shielded = draw({ character, shielded: true });
      expect(shielded.calls.length).toBeGreaterThan(bare.calls.length);
      expect(shielded.valuesOf('strokeStyle').some(
        (v) => typeof v === 'string' && v.startsWith('rgba(255,180,0'),
      )).toBe(true);
    });

    it(`stands the ${character} on a contact shadow`, () => {
      expect(draw({ character }).calls.some((c) => c.name === 'ellipse')).toBe(true);
    });
  }

  it('puts the body below the HUD, at the position it was given', () => {
    const rec = draw({ x: 120, y: 40 }, 0, 32);
    expect(rec.calls[0]).toEqual({ name: 'save', args: [] });
    expect(rec.calls[1]).toEqual({ name: 'translate', args: [120, 72] });
  });

  it('mirrors the sprite rather than authoring it twice', () => {
    expect(draw({ facing: -1 }).calls).toContainEqual({ name: 'scale', args: [-1, 1] });
    expect(draw({ facing: 1 }).calls).toContainEqual({ name: 'scale', args: [1, 1] });
  });

  it('keeps the weapon on the side the body is aiming at', () => {
    const left = reach(draw({ character: 'knight', facing: -1, aimAngle: Math.PI }));
    const right = reach(draw({ character: 'knight', facing: 1, aimAngle: 0 }));
    expect(left.x).toBeLessThan(-50);
    expect(right.x).toBeGreaterThan(50);
    // The mirror is a scale, so the two are the same drawing either way round.
    expect(left.x).toBeCloseTo(-right.x, 6);
  });

  describe('the knight thrust', () => {
    it('reaches further at the peak of the swing', () => {
      const rest = dist(reach(draw({ character: 'knight', swingProgress: 0 })));
      const peak = dist(reach(draw({ character: 'knight', swingProgress: 0.5 })));
      expect(peak).toBeGreaterThan(rest);
      // The legacy thrust: sin(prog * PI) * 22, so the peak is a full 22 px.
      expect(peak - rest).toBeCloseTo(22, 6);
    });

    it('is back to resting reach once the swing ends', () => {
      const rest = dist(reach(draw({ character: 'knight', swingProgress: 0 })));
      const done = dist(reach(draw({ character: 'knight', swingProgress: 1 })));
      expect(done).toBeCloseTo(rest, 6);
    });

    it('flares the spearhead white over the window that lands the hit', () => {
      expect(draw({ character: 'knight', swingProgress: 0.5 }).valuesOf('fillStyle'))
        .toContain('#FFFFFF');
      expect(draw({ character: 'knight', swingProgress: 0 }).valuesOf('fillStyle'))
        .not.toContain('#FFFFFF');
    });
  });

  describe('a body that is down', () => {
    it('is still drawn, so team-mates can see where it fell', () => {
      expect(bodyCanvas(draw({ dead: true }))).toBeDefined();
    });

    it('is faded and tipped over, unlike a live one', () => {
      const live = draw({ character: 'archer' });
      const down = draw({ character: 'archer', dead: true });
      expect(down.valuesOf('globalAlpha')).toContain(0.42);
      expect(live.valuesOf('globalAlpha')).toHaveLength(0);
      expect(down.countOf('rotate')).toBe(live.countOf('rotate') + 1);
    });

    it('is greyed rather than painted in its own colours', () => {
      // Down bakes a corpse-grey silhouette (see paintBakedBody), a
      // different cached canvas from the body's own colours.
      const live = draw({ character: 'archer' });
      const down = draw({ character: 'archer', dead: true });
      expect(bodyCanvas(down)).not.toBe(bodyCanvas(live));
    });
  });

  describe('the hit flash', () => {
    it('washes the body white', () => {
      // A lit blink frame bakes an all-white silhouette (see
      // paintBakedBody), a different cached canvas from the body's own
      // colours.
      const bare = draw({ character: 'archer' });
      const hit = draw({ character: 'archer', hitFlash: 0.3 });
      expect(bodyCanvas(hit)).not.toBe(bodyCanvas(bare));
    });

    it('blinks rather than holding, so it reads as pain and not as a fault', () => {
      // 10 Hz: 0.30 s left is a lit frame, 0.25 s left is a dark one — the
      // same, un-flashed canvas as no hit at all.
      const bare = draw({ character: 'archer' });
      const dark = draw({ character: 'archer', hitFlash: 0.25 });
      expect(bodyCanvas(dark)).toBe(bodyCanvas(bare));
    });

    it('leaves an unhurt body alone', () => {
      const bare = draw({ character: 'archer' });
      const unhurt = draw({ character: 'archer', hitFlash: 0 });
      expect(bodyCanvas(unhurt)).toBe(bodyCanvas(bare));
    });
  });

  it('animates the wizard on the wall clock, so a standing body is never still', () => {
    // The body itself is one fixed pose now (see buildWizardGrid); what
    // still never holds still is the orb glow paintStaff draws live.
    const still = draw({ character: 'wizard' }, 0).valuesOf('fillStyle');
    const later = draw({ character: 'wizard' }, 1.3).valuesOf('fillStyle');
    expect(later).not.toEqual(still);
  });

  it('animates the knight on the walk phase', () => {
    const standing = draw({ character: 'knight', walkPhase: 0 });
    const striding = draw({ character: 'knight', walkPhase: 1.5 });
    expect(striding.points).not.toEqual(standing.points);
  });

  it('swings the archer bow onto the aim', () => {
    // Aiming straight down, so the grip is directly below the body and the
    // stave lies across it: one limb tip to the left, the other to the right.
    const rec = draw({ character: 'archer', aimAngle: Math.PI / 2 });
    const stave = rec.calls.find((c) => c.name === 'quadraticCurveTo');
    expect(stave).toBeDefined();
    const [cpx, cpy, tipX, tipY] = (stave?.args ?? []).map((n) => Math.round(Number(n)));
    // Control point sits beyond the grip along the aim: the belly of the bow.
    expect([cpx, cpy]).toEqual([0, 13]);
    // Far tip is out to the side at grip depth, not along the aim.
    expect([tipX, tipY]).toEqual([8, 9]);
  });

  it('draws every combination of kind, facing and state without throwing', () => {
    for (const character of KINDS)
      for (const facing of [1, -1] as const)
        for (const dead of [false, true])
          for (const shielded of [false, true])
            expect(() =>
              draw({ character, facing, dead, shielded, aimAngle: 2.4, hitFlash: 0.3 }, 7.1, 32),
            ).not.toThrow();
  });
});

describe('every character in the roster', () => {
  // SILHOUETTES and PAINTERS are private to the module, so this is how a
  // missing row shows up: drawCharacter reaches for one and finds nothing.
  it('has a painter and a silhouette, so it can be drawn at all', () => {
    for (const character of CHARACTERS) {
      const rec = draw({ character });
      expect(bodyCanvas(rec), character).toBeDefined();
      expect(rec.calls.some((c) => c.name === 'ellipse'), character).toBe(true);
    }
  });

  it('draws a shield halo when shielded, whoever is wearing it', () => {
    for (const character of CHARACTERS) {
      const bare = draw({ character });
      const held = draw({ character, shielded: true });
      expect(held.calls.length, character).toBeGreaterThan(bare.calls.length);
    }
  });
});

describe('the sapper', () => {
  it('holds a lit charge out along the aim', () => {
    const rec = draw({ character: 'sapper' });
    // The ember is the one thing drawn in its own colour rather than shaded,
    // so a fuse still reads as fire through a hit flash.
    expect(rec.props.some((p) => p.name === 'fillStyle' && p.value === '#FF7A1A')).toBe(true);
    // Aim is 0, so the charge and its fuse are the only things drawn well
    // ahead of the body on the aim axis.
    expect(rec.points.some((p) => p.x > 6)).toBe(true);
  });

  it('keeps the ember lit through a hit flash and through being down', () => {
    for (const over of [{ hitFlash: 1 }, { dead: true }]) {
      const rec = draw({ character: 'sapper', ...over });
      expect(rec.props.some((p) => p.name === 'fillStyle' && p.value === '#FF7A1A')).toBe(true);
    }
  });
});
