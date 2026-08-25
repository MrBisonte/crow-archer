import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A routed emit with no matching handler case is a silently missing effect:
 * it type-checks, runs, and does nothing. These tests compare the event union
 * against the handler's case labels so that gap fails the build.
 */
const here = dirname(fileURLToPath(import.meta.url));
const eventsSrc = readFileSync(resolve(here, 'events.ts'), 'utf8');
const legacySrc = readFileSync(resolve(here, '../legacy/game.js'), 'utf8');

/** Event type names declared in the GameEvent union. */
const declared = new Set(
  [...eventsSrc.matchAll(/\{ type: '([A-Z_]+)'/g)].map(m => m[1] as string),
);

/** Event type names the legacy handler has a case for. */
const handled = new Set(
  [...legacySrc.matchAll(/case '([A-Z_]+)':/g)].map(m => m[1] as string),
);

/** Event type names actually emitted somewhere in the sim. */
const emitted = new Set(
  [...legacySrc.matchAll(/events\.emit\(\{ type: '([A-Z_]+)'/g)].map(m => m[1] as string),
);

describe('event coverage', () => {
  it('declares a non-trivial union', () => {
    expect(declared.size).toBeGreaterThan(20);
  });

  it('handles every declared event type', () => {
    const missing = [...declared].filter(t => !handled.has(t));
    expect(missing).toEqual([]);
  });

  it('emits every declared event type', () => {
    const never = [...declared].filter(t => !emitted.has(t));
    expect(never).toEqual([]);
  });

  it('declares every handled event type', () => {
    const stray = [...handled].filter(t => !declared.has(t));
    expect(stray).toEqual([]);
  });

  /**
   * The fourth direction, and the one that was missing.
   *
   * The three tests above walk declared -> handled, declared -> emitted, and
   * handled -> declared. Nothing walked emitted -> declared, so an event the
   * sim emits under a name the union never mentions passed every check here:
   * it is not declared, so `declares a non-trivial union` never sees it; it is
   * not declared, so neither of the `every declared` tests looks for it; and it
   * has no handler, so `declares every handled` has nothing to catch. Five
   * siege events lived in exactly that blind spot -- GUARD_SWING, GUARD_SHOT,
   * GUARD_DOWN, TOWER_FELL, SIEGE_WAVE_CLEARED were emitted for the whole of
   * the bastion's development and were silent the entire time, with the suite
   * green. This closes the ring: with all four, the three sets are equal.
   */
  it('declares every emitted event type', () => {
    const undeclared = [...emitted].filter(t => !declared.has(t));
    expect(undeclared).toEqual([]);
  });
});
