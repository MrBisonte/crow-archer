import { describe, expect, it } from 'vitest';

import { loopFuse } from './game';

// The loop's circuit breaker. The wiring around it (try/catch, reschedule,
// halt) lives in loop() and drives real rAF, so it is not unit-isolated; this
// covers the decision that wiring leans on.
describe('loopFuse', () => {
  const LIMIT = 30;

  it('resets the count on a clean frame', () => {
    expect(loopFuse(7, false, LIMIT)).toEqual({ consecutive: 0, halt: false });
  });

  it('counts a thrown frame without halting under the limit', () => {
    expect(loopFuse(0, true, LIMIT)).toEqual({ consecutive: 1, halt: false });
    expect(loopFuse(1, true, LIMIT)).toEqual({ consecutive: 2, halt: false });
  });

  it('halts once consecutive throws reach the limit', () => {
    expect(loopFuse(LIMIT - 1, true, LIMIT)).toEqual({ consecutive: LIMIT, halt: true });
  });

  it('a clean frame between throws re-arms the fuse, so a lone hiccup never marches to a halt', () => {
    let s = loopFuse(0, true, LIMIT);          // threw once
    expect(s).toEqual({ consecutive: 1, halt: false });
    s = loopFuse(s.consecutive, false, LIMIT); // recovered
    expect(s).toEqual({ consecutive: 0, halt: false });
    s = loopFuse(s.consecutive, true, LIMIT);  // one throw again, not two-in-a-row from before
    expect(s).toEqual({ consecutive: 1, halt: false });
  });
});
