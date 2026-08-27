/**
 * The pause menu's printed keys and the keys it answers, held to each other.
 *
 * The pause screen answered `T` and never said so. `transitionTo('talents')`
 * had been in `case 'paused':` since the talent shop landed, and `drawPause`
 * listed `[ESC] [C] [M] [I]` and stopped. So the shop that sells every talent
 * was reachable and unadvertised, and the draft that deals from what you own
 * therefore had nothing to deal: a player who never found the shop never owned
 * a talent, and the ceremony correctly skipped itself every run. One missing
 * hint read as an entire system doing nothing.
 *
 * Nothing caught it. The handler is covered -- `talents-run.test.ts` presses
 * `t` from the pause menu and asserts the shop opens -- and the hint is a
 * string in a draw call that no test reads. Behaviour and advertisement were
 * each checked alone, and the bug lived exactly between them.
 *
 * This is `globals.coverage.test.ts` reasoning applied to a screen instead of
 * to `window`: a claim the code makes about itself, held to the code. Both
 * directions in one assertion, because they fail differently. A key answered
 * but unlisted cannot be found. A key listed but unanswered sends the reader
 * to press something that does nothing.
 *
 * Scoped to the pause menu deliberately. It is the hub every other screen is
 * reached through, and the only one where the two sets disagreed: at the time
 * of writing `inventory`, `talents`, `controls`, `gameover` and `win` each
 * already advertise exactly what they answer. Generalising over all six needs
 * the draw dispatcher parsed to learn which function paints which state, which
 * is a good deal more machinery than one screen's bug has earned. If a second
 * screen ever drifts, that is the third case and the time to build it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'game.js'), 'utf8');

/**
 * The body of a top-level `function <name>() {`, brace-matched.
 *
 * Matched rather than terminated by a regex, for the reason
 * `globals.coverage.test.ts` gives about its own parse: a source-text test
 * that reads half its input still passes every assertion made against it.
 */
function functionBody(name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`game.js declares no \`function ${name}\``);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`\`function ${name}\` is never closed`);
}

/**
 * One arm of the key-handling switch, from its `case` to its `break`.
 *
 * Bounded rather than read to the end of the switch, because `keys['Escape']`
 * is handled by `playing` and `boss_fight` as well; a parse that overran would
 * credit the pause menu with their keys and pass while it advertised none.
 */
function caseBlock(state: string): string {
  const at = src.indexOf(`case '${state}':`);
  if (at < 0) throw new Error(`game.js handles no \`case '${state}'\``);
  const end = src.indexOf('break;', at);
  if (end < 0) throw new Error(`\`case '${state}'\` never breaks`);
  return src.slice(at, end);
}

/**
 * `Escape` is the one key whose printed name is not its `KeyboardEvent.key`.
 * Pinned as a table rather than special-cased inline so a second alias has to
 * be added deliberately, which is the point at which someone should ask
 * whether the screens should agree on a spelling instead.
 */
const PRINTED_AS: Readonly<Record<string, string>> = { ESCAPE: 'ESC' };

/** The keys a screen prints in `[X]` form. `[◆12 FTH]` is not one of them. */
const advertised = [...new Set(
  [...functionBody('drawPause').matchAll(/\[([A-Z]{1,6})\]/g)].map(m => m[1] as string),
)].sort();

/**
 * The keys an arm of the switch answers, folded to one name each. `game.js`
 * tests both cases of every letter (`keys['t']||keys['T']`) because `keys` is
 * indexed by what the key produced, so the pair is one key to a player.
 */
const handled = [...new Set(
  [...caseBlock('paused').matchAll(/keys\['([A-Za-z]+)'\]/g)]
    .map(m => (m[1] as string).toUpperCase())
    .map(k => PRINTED_AS[k] ?? k),
)].sort();

describe('the pause menu advertises what it answers', () => {
  /**
   * A source-text test that matches nothing passes everything after it, so
   * this names what each parse must have recovered rather than counting it.
   * Both anchors are load bearing. `ESC` is the only aliased name, so it
   * proves the table above is reached rather than merely declared; `I` is a
   * key the screen has advertised and answered since long before the talent
   * shop existed, so it proves neither parse is returning an empty set that
   * would make the assertion below vacuously true.
   */
  it('parses both sides of what it is comparing', () => {
    expect(advertised).toContain('ESC');
    expect(advertised).toContain('I');
    expect(handled).toContain('ESC');
    expect(handled).toContain('I');
  });

  it('prints every key it handles, and handles every key it prints', () => {
    expect(advertised).toEqual(handled);
  });
});
