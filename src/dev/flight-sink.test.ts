import { describe, expect, it } from 'vitest';

import { toLine } from './flight-sink';

describe('toLine', () => {
  it('wraps a payload object with the server receive time', () => {
    expect(JSON.parse(toLine('{"kind":"beat","raf":42}', 1234))).toEqual({
      srv: 1234,
      kind: 'beat',
      raf: 42,
    });
  });

  it('keeps the server stamp when the client sends its own srv key', () => {
    const line = JSON.parse(toLine('{"srv":1,"kind":"beat"}', 999)) as { srv: number };
    expect(line.srv).toBe(999);
  });

  it('refuses a JSON array', () => {
    expect(() => toLine('[1,2]', 0)).toThrow();
  });

  it('refuses a JSON primitive', () => {
    expect(() => toLine('"beat"', 0)).toThrow();
  });

  it('refuses a body that is not JSON', () => {
    expect(() => toLine('beat', 0)).toThrow();
  });
});
