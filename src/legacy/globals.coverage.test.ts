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
 *
 * The banner is the third set. `game.js` prints the verbs at boot so they are
 * discoverable from the console rather than only from a document the player
 * would have to already be reading, which makes that string a promise about
 * what a person can type. Nothing held it to the verbs that exist. It is a
 * softer failure than a missing assignment -- an unlisted verb is
 * undiscoverable, not undefined -- and it is the same shape: a claim about
 * `game.js` that `game.js` never has to honour.
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
 * Members of `Window`, each with the type it was declared at.
 *
 * Optional (`?:`) is the split that says who owes the assignment: an optional
 * member is the browser's, and `webkitAudioContext` is Safari's rather than
 * anything this game sets. A function type is the split that says what a
 * member is for -- a verb is something a person calls, a surface is something
 * the harness reads -- and both splits are pinned below rather than trusted,
 * so a member that lands in the wrong one fails rather than escapes.
 */
const members = [...body.matchAll(/^[^\S\n]*([A-Za-z_$][\w$]*)(\??)\s*:([^;]*);/gm)]
  .map(m => ({
    name: m[1] as string,
    optional: m[2] === '?',
    isFunction: (m[3] as string).includes('=>'),
  }));

const required = members.filter(m => !m.optional);
const optional = members.filter(m => m.optional).map(m => m.name);
/** Required members a person is meant to call. These owe the banner a line. */
const verbs = required.filter(m => m.isFunction).map(m => m.name).sort();
/** Required members that are read, not called. These do not. */
const surfaces = required.filter(m => !m.isFunction).map(m => m.name).sort();

/** Members `game.js` actually attaches. `=(?!=)` so a comparison is not one. */
const assigned = new Set(
  [...legacySrc.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map(m => m[1] as string),
);

/** The names the boot banner advertises, in `verb(arg)` form. */
function advertisedVerbs(src: string): string[] {
  const banner = /'console: ([^']*)'/.exec(src);
  if (!banner) throw new Error('game.js prints no `console: ` boot banner');
  return [...(banner[1] as string).matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)]
    .map(m => m[1] as string)
    .sort();
}

describe('window surface coverage', () => {
  /**
   * A source-text test that matches nothing passes everything after it, so
   * this names what the parse must have recovered instead of counting it -- a
   * floor goes stale as the surface grows.
   *
   * Both sets are exact rather than partial, and both are load bearing. The
   * optional set is the whole reason that split exists. The surface set is
   * the escape hatch from the banner rule below: a member declared `unknown`
   * is taken to be something the harness reads, so a verb typed loosely
   * enough would slip the rule entirely. Naming the two that qualify means a
   * third has to be argued for rather than added.
   */
  it('parses the surface it is walking', () => {
    expect(optional).toEqual(['webkitAudioContext']);
    expect(surfaces).toEqual(['CrowArcherInternals', '__game']);
    expect(verbs.length).toBeGreaterThan(0);
  });

  it('assigns every member it declares', () => {
    const unassigned = required.map(m => m.name).filter(name => !assigned.has(name));
    expect(unassigned).toEqual([]);
  });

  /**
   * Both directions at once, because they fail differently and both are real:
   * a verb missing from the banner is undiscoverable, and a name in the
   * banner that no longer exists sends the reader to type something that does
   * nothing. `906440b` got this right by hand while missing the `.d.ts`; the
   * point is that neither half was checked.
   */
  it('advertises every verb, and only verbs that exist', () => {
    expect(advertisedVerbs(legacySrc)).toEqual(verbs);
  });
});
