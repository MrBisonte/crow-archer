import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `globals.d.ts` describes the `window` surface `game.js` attaches at boot,
 * and it is checked in one direction only. An assignment with no declaration
 * is caught: `window.foo = ...` for a `foo` not on `Window` is TS2339 under
 * `tsconfig.legacy.json`. A declaration with no assignment is not caught by
 * anything, because a `.d.ts` is an assertion about the world rather than a
 * claim to be verified -- so a verb that exists only there reads as real to
 * tsc, to an editor's completion, and to the next person to open the file,
 * and is `undefined` in the browser.
 *
 * `knights` sat in that gap. `906440b` deleted the review line it named --
 * `showKnights`, `window.knights()`, the `variant` field on a guard body, the
 * `held` flag -- as scaffolding with a stated end date, and updated the
 * console banner on the way out. The declaration was the one mention it
 * missed, and nothing in the build had a reason to look at it. This is that
 * reason. It walks the direction tsc cannot.
 */
const here = dirname(fileURLToPath(import.meta.url));
const dtsSrc = readFileSync(resolve(here, 'globals.d.ts'), 'utf8');
const legacySrc = readFileSync(resolve(here, 'game.js'), 'utf8');

/**
 * The body of `interface Window { ... }`.
 *
 * Brace-matched rather than terminated by a regex on indentation: a member
 * whose type contains braces would end the block early, and a source-text
 * test that reads half its input still passes every assertion below.
 */
function windowInterfaceBody(src: string): string {
  const at = src.indexOf('interface Window');
  if (at < 0) throw new Error('globals.d.ts declares no `interface Window`');
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('`interface Window` is never closed');
}

/** Doc comments stripped, so their prose cannot be read as a member. */
const body = windowInterfaceBody(dtsSrc).replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Members of `Window`, split by who owes the assignment. A required member is
 * one `game.js` attaches; an optional one (`?:`) is the browser's, and
 * `webkitAudioContext` is Safari's rather than anything this game sets.
 */
const members = [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)(\??)\s*:/gm)]
  .map(m => ({ name: m[1] as string, optional: m[2] === '?' }));
const required = members.filter(m => !m.optional).map(m => m.name);
const optional = members.filter(m => m.optional).map(m => m.name);

/** Members `game.js` actually attaches. `=(?!=)` so a comparison is not one. */
const assigned = new Set(
  [...legacySrc.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map(m => m[1] as string),
);

describe('window surface coverage', () => {
  /**
   * A source-text test that matches nothing passes everything after it, so
   * this names what the parse must have recovered instead of counting it -- a
   * floor goes stale as the surface grows. Both anchors are load bearing:
   * `__game` is the harness's entry point, and the optional set is the whole
   * reason the split exists, so a second entry there should have to be
   * argued for rather than added.
   */
  it('parses the surface it is walking', () => {
    expect(required).toContain('__game');
    expect([...assigned]).toContain('__game');
    expect(optional).toEqual(['webkitAudioContext']);
  });

  it('assigns every member it declares', () => {
    const unassigned = required.filter(name => !assigned.has(name));
    expect(unassigned).toEqual([]);
  });
});
