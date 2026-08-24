import { describe, it, expect } from 'vitest';
import { Hitstop } from './hitstop';

/** Runs `n` steps and returns the verdict the loop got for each one. */
const run = (h: Hitstop, n: number): string[] =>
  Array.from({ length: n }, () => h.step() as string);

describe('Hitstop', () => {
  it('runs the sim when nothing has landed', () => {
    const h = new Hitstop();
    expect(h.held).toBe(0);
    expect(run(h, 3)).toEqual(['run', 'run', 'run']);
  });

  it('holds for exactly the steps it was given, then runs again', () => {
    const h = new Hitstop();
    h.trigger(3);
    expect(h.held).toBe(3);
    expect(run(h, 5)).toEqual(['held', 'held', 'held', 'run', 'run']);
    expect(h.held).toBe(0);
  });

  it('takes the longest hold and never the sum', () => {
    const h = new Hitstop();
    h.trigger(2);
    h.trigger(5);
    h.trigger(3);
    // 5, not 10: several impacts in one frame cost one freeze, the way a
    // weaker ScreenShake during a stronger one is ignored rather than added.
    expect(h.held).toBe(5);
    expect(run(h, 6)).toEqual(['held', 'held', 'held', 'held', 'held', 'run']);
  });

  it('does not shorten a freeze already in progress', () => {
    const h = new Hitstop();
    h.trigger(4);
    h.step();
    h.trigger(1);
    expect(h.held).toBe(3);
  });

  it('ignores a row that asks for no freeze at all', () => {
    const h = new Hitstop();
    h.trigger(0);
    expect(h.held).toBe(0);
    expect(run(h, 1)).toEqual(['run']);
    h.trigger(-2);
    expect(h.held).toBe(0);
  });

  it('drops a freeze in progress when cleared', () => {
    const h = new Hitstop();
    h.trigger(6);
    h.step();
    h.clear();
    expect(h.held).toBe(0);
    expect(run(h, 1)).toEqual(['run']);
  });
});
