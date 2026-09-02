/**
 * Guards on the sigil table that a drawing cannot give you.
 *
 * A sigil is looked at to know whether it is GOOD. These are the faults that
 * survive being looked at: a path pasted twice draws in exactly the same place
 * as the one under it, so eleven parts render as five and the sheet shows
 * nothing wrong. `shrapnel` shipped that way -- three bolts pasted without
 * rotating any of them, one arrow drawn three times.
 */
import { describe, expect, it } from 'vitest';

import { CHAR_TREES } from '../sim/talents';
import { SIGILS } from './talent-sigils';

describe('the sigil table', () => {
  /** Every id a chooser can offer, from the trees themselves. */
  const drawnIds = Object.values(CHAR_TREES)
    .flatMap((tree) => [...tree.talents, ...tree.capstones])
    .map((entry) => entry.id)
    .sort();

  // The exact key set rather than a count: a length check catches a deletion
  // and misses an addition, and an orphan sigil is a drawing nobody can see.
  it('draws every talent and nothing else', () => {
    expect(Object.keys(SIGILS).sort()).toEqual(drawnIds);
  });

  it('repeats no path inside a sigil', () => {
    for (const [id, parts] of Object.entries(SIGILS)) {
      const ds = parts.map((p) => p.d);
      expect(new Set(ds).size, `${id} draws the same path more than once`)
        .toBe(ds.length);
    }
  });

  it('gives every part something to draw', () => {
    for (const [id, parts] of Object.entries(SIGILS)) {
      expect(parts.length, `${id} is empty`).toBeGreaterThan(0);
      for (const part of parts) {
        // Path2D swallows a malformed d and draws nothing, so a path that
        // never moves anywhere is a blank panel with no error behind it.
        expect(part.d.startsWith('M'), `${id}: '${part.d}' does not start at a point`)
          .toBe(true);
      }
    }
  });

  it('keeps every ghost visible', () => {
    for (const [id, parts] of Object.entries(SIGILS)) {
      for (const part of parts) {
        if (part.alpha === undefined) continue;
        expect(part.alpha, `${id} has a part at alpha ${part.alpha}`)
          .toBeGreaterThan(0.2);
        expect(part.alpha).toBeLessThanOrEqual(1);
      }
    }
  });
});
