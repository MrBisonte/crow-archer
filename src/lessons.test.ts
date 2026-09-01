/**
 * Guards `LESSONS.jsonl` — the append-only lessons-learned ledger — against
 * the shape every reader and every future tool depends on.
 *
 * The file is data a contributor hand-appends, one JSON object per line. Type
 * checking never sees it and no other code imports it, so without this test a
 * malformed line, a typo'd field, or an unknown `level` ships silently and the
 * first thing to notice is whatever tries to parse the file downstream. This
 * is the one home for the schema: `AGENTS.md` describes the fields for a human,
 * the rules are enforced here, and nothing restates them a third time.
 *
 * Reads the file as text the way `src/legacy/balance-doc.test.ts` reads
 * `docs/balance.md` and `src/sim/events.coverage.test.ts` reads `game.js`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(here, '../LESSONS.jsonl'), 'utf8');

/** Every key a line may carry, and whether it is required. One home: the test
 * that enforces the schema is the schema. */
const REQUIRED = ['id', 'date', 'topic', 'level', 'lesson'] as const;
const OPTIONAL = ['refs', 'session'] as const;
const KNOWN = new Set<string>([...REQUIRED, ...OPTIONAL]);

/** The kind of lesson, so a reader can filter: a hazard to avoid, a specific
 * bug and its resolution, or a way of working that paid off. */
const LEVELS = new Set(['trap', 'fix', 'practice']);

/** Slugs and topics are kebab-case, so they are stable, greppable, and safe as
 * cross-reference targets in `refs`. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ParsedLine {
  readonly n: number;
  readonly obj: Record<string, unknown>;
}

/** JSONL, split to numbered non-blank lines. A blank line other than a single
 * trailing newline is itself a defect: it is the shape an accidental double
 * newline or a half-deleted entry leaves behind. */
function lines(): ParsedLine[] {
  const parts = raw.split('\n');
  const out: ParsedLine[] = [];
  parts.forEach((line, i) => {
    if (line.trim() === '') {
      // Only the final element may be empty (the trailing newline).
      expect(i, `blank line at ${i + 1}`).toBe(parts.length - 1);
      return;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1} is not valid JSON: ${line.slice(0, 60)}`);
    }
    expect(typeof obj === 'object' && obj !== null && !Array.isArray(obj),
      `line ${i + 1} is not a JSON object`).toBe(true);
    out.push({ n: i + 1, obj: obj as Record<string, unknown> });
  });
  return out;
}

const parsed = lines();

describe('LESSONS.jsonl', () => {
  it('has at least the seed entries', () => {
    expect(parsed.length).toBeGreaterThanOrEqual(10);
  });

  it('carries only known keys, and every required one', () => {
    for (const { n, obj } of parsed) {
      for (const key of REQUIRED) {
        expect(key in obj, `line ${n} missing required key "${key}"`).toBe(true);
      }
      for (const key of Object.keys(obj)) {
        expect(KNOWN.has(key), `line ${n} has unknown key "${key}"`).toBe(true);
      }
    }
  });

  it('types every field the schema names', () => {
    for (const { n, obj } of parsed) {
      expect(typeof obj.id === 'string' && KEBAB.test(obj.id), `line ${n} id`).toBe(true);
      expect(typeof obj.date === 'string' && ISO_DATE.test(obj.date as string), `line ${n} date`).toBe(true);
      expect(typeof obj.topic === 'string' && KEBAB.test(obj.topic), `line ${n} topic`).toBe(true);
      expect(typeof obj.level === 'string' && LEVELS.has(obj.level as string), `line ${n} level`).toBe(true);
      // The lesson is the training signal: it must read on its own, so it is
      // held to a floor rather than merely being a non-empty string.
      expect(typeof obj.lesson === 'string' && (obj.lesson as string).length >= 40, `line ${n} lesson`).toBe(true);
      if ('refs' in obj) {
        expect(Array.isArray(obj.refs)
          && (obj.refs as unknown[]).every((r) => typeof r === 'string' && r.length > 0),
          `line ${n} refs`).toBe(true);
      }
      if ('session' in obj) {
        expect(typeof obj.session === 'string' && (obj.session as string).length > 0, `line ${n} session`).toBe(true);
      }
    }
  });

  it('gives every lesson a unique id', () => {
    const ids = parsed.map((p) => p.obj.id as string);
    expect(new Set(ids).size, 'duplicate id').toBe(ids.length);
  });
});
