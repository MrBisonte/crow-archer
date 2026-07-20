import { describe, expect, it } from 'vitest';

import { AIController, Button, hasButton, LocalInput, type RawInput } from './input';

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
