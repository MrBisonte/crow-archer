import { describe, expect, it } from 'vitest';

import {
  AIController, Button, hasButton, LocalInput, noteKeyDown, noteKeyUp, pointerToCanvas,
  type RawInput,
} from './input';

const raw = (over: Partial<RawInput> = {}): RawInput => ({
  up: false,
  down: false,
  left: false,
  right: false,
  fire: false,
  special: false,
  snipe: false,
  aimAngle: 0,
  ...over,
});

describe('LocalInput', () => {
  it('maps each raw flag to its button bit', () => {
    const c = new LocalInput(() => raw({ up: true, left: true, fire: true, snipe: true }));
    const cmd = c.sample();
    expect(hasButton(cmd, Button.UP)).toBe(true);
    expect(hasButton(cmd, Button.LEFT)).toBe(true);
    expect(hasButton(cmd, Button.FIRE)).toBe(true);
    expect(hasButton(cmd, Button.SNIPE)).toBe(true);
    expect(hasButton(cmd, Button.DOWN)).toBe(false);
    expect(hasButton(cmd, Button.RIGHT)).toBe(false);
    expect(hasButton(cmd, Button.SPECIAL)).toBe(false);
  });

  it('passes aimAngle through', () => {
    const c = new LocalInput(() => raw({ aimAngle: 1.25 }));
    expect(c.sample().aimAngle).toBe(1.25);
  });

  it('increments seq on each sample', () => {
    const c = new LocalInput(() => raw());
    expect(c.sample().seq).toBe(0);
    expect(c.sample().seq).toBe(1);
    expect(c.sample().seq).toBe(2);
  });

  it('reads fresh raw input each sample', () => {
    let down = false;
    const c = new LocalInput(() => raw({ down }));
    expect(hasButton(c.sample(), Button.DOWN)).toBe(false);
    down = true;
    expect(hasButton(c.sample(), Button.DOWN)).toBe(true);
  });
});

describe('AIController', () => {
  it('produces an empty command', () => {
    const cmd = new AIController().sample();
    expect(cmd.buttons).toBe(0);
    expect(cmd.aimAngle).toBe(0);
  });
});

describe('key name bookkeeping', () => {
  const maps = (): { keys: Record<string, boolean>; downAs: Record<string, string> } =>
    ({ keys: {}, downAs: {} });
  const held = (keys: Record<string, boolean>): string[] =>
    Object.keys(keys).filter((k) => keys[k]);

  it('clears a key whose release reports a different name', () => {
    // Pressed plain, released with shift already down: the keyup says 'W'.
    const { keys, downAs } = maps();
    noteKeyDown(keys, downAs, 'KeyW', 'w');
    noteKeyUp(keys, downAs, 'KeyW', 'W');
    expect(held(keys)).toEqual([]);
  });

  it('reports the name the key went down under', () => {
    const { keys, downAs } = maps();
    noteKeyDown(keys, downAs, 'KeyW', 'w');
    expect(noteKeyUp(keys, downAs, 'KeyW', 'W')).toBe('w');
  });

  // The wizard's jammed WASD of 2026-08-30: W held while shift came down
  // for a blink, so the auto-repeat arrived as 'W' and overwrote the slot;
  // the release — shift still down — also said 'W', and the orphaned 'w'
  // stayed held for the rest of the run. Up jammed on, down cancelled out.
  it('releases the old name when a held key repeats under a new one', () => {
    const { keys, downAs } = maps();
    noteKeyDown(keys, downAs, 'KeyW', 'w');
    noteKeyDown(keys, downAs, 'KeyW', 'W');   // auto-repeat, shift now down
    noteKeyUp(keys, downAs, 'KeyW', 'W');
    expect(held(keys)).toEqual([]);
  });

  it('keeps a key held across same-name repeats', () => {
    const { keys, downAs } = maps();
    noteKeyDown(keys, downAs, 'KeyW', 'w');
    noteKeyDown(keys, downAs, 'KeyW', 'w');
    expect(held(keys)).toEqual(['w']);
  });

  it('shrugs at a keyup whose keydown it never saw', () => {
    const { keys, downAs } = maps();
    expect(noteKeyUp(keys, downAs, 'KeyW', 'w')).toBeUndefined();
    expect(held(keys)).toEqual([]);
  });
});

describe('pointerToCanvas', () => {
  // The canvas is 1760x1104 shown at 1137x713 and centred, which is what
  // scale-to-fit does in a window too small to hold it at 1:1.
  const RECT = { left: 311, top: 190, width: 1137, height: 713 };
  const W = 1760, H = 1104;

  it('scales a point inside the picture to canvas pixels', () => {
    expect(pointerToCanvas(311, 190, RECT, W, H)).toEqual({ x: 0, y: 0 });
    const middle = pointerToCanvas(311 + 1137 / 2, 190 + 713 / 2, RECT, W, H);
    expect(middle.x).toBeCloseTo(W / 2, 6);
    expect(middle.y).toBeCloseTo(H / 2, 6);
  });

  // The bug players reported. Clamping here pinned both axes past the edge, so
  // two very different pointer positions produced one aim and the shot froze at
  // whatever angle the pointer had crossed the border at.
  it('keeps reporting movement out in the letterbox margin', () => {
    const near = pointerToCanvas(RECT.left - 20, 400, RECT, W, H);
    const far = pointerToCanvas(RECT.left - 300, 400, RECT, W, H);
    expect(near.x).toBeLessThan(0);
    expect(far.x).toBeLessThan(near.x);

    const below = pointerToCanvas(700, RECT.top + RECT.height + 250, RECT, W, H);
    expect(below.y).toBeGreaterThan(H);
  });

  it('reports past every edge, not just the left one', () => {
    expect(pointerToCanvas(RECT.left + RECT.width + 400, 400, RECT, W, H).x).toBeGreaterThan(W);
    expect(pointerToCanvas(700, RECT.top - 400, RECT, W, H).y).toBeLessThan(0);
  });
});
