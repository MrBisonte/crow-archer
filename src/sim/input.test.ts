import { describe, expect, it } from 'vitest';

import { AIController, Button, hasButton, LocalInput, noteKeyDown, noteKeyUp, type RawInput } from './input';

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
