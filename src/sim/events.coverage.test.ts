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
});
