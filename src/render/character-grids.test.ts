/**
 * The four heroes' pixel art, checked as data (see grid-testkit.ts for why).
 *
 * The `before` counts are the filled-cell totals measured on the commit this
 * detail pass was cut from. They are what makes "the sprite got more detailed"
 * a fact the suite can hold rather than an impression: a later change that
 * flattens a hero back out trips the guard instead of passing quietly.
 */

import { describe, expect, it } from 'vitest';

import {
  ARCHER_SPRITE, buildArcherGrid,
  WIZARD_SPRITE, buildWizardGrid,
  RANGER_SPRITE, buildRangerGrid,
  KNIGHT_SPRITE, buildKnightGrid,
  SAPPER_SPRITE, buildSapperGrid,
  type KnightKind,
} from './character-grids';
import { ANIM_FRAMES, type AnimFrame, type PixelGrid } from './pixel-grid';
import { spriteCanvas, spriteFlashCanvas } from './pixel-sprite';
import {
  countFilled, gridColours, gridSize, installStubCanvas, invalidColours, raggedRows,
} from './grid-testkit';

installStubCanvas();

/** A caller-supplied trim colour, standing in for a team or a theme colour. */
const TRIM = '#39FF14';

/** Every palette the knight's grid is built against. */
const KNIGHT_KINDS: readonly KnightKind[] = ['normal', 'fireSword'];

/** One hero, one frame, one palette: exactly what a renderer asks a builder for. */
interface HeroCase {
  name: string;
  sprite: { w: number; h: number };
  grid: PixelGrid;
  /** Filled cells before the detail pass. */
  before: number;
}

/**
 * A hero, before its frames are expanded.
 *
 * The table used to be written out one frame at a time, with a separate test
 * checking that every frame the renderers ask for had a row. Expanding over
 * ANIM_FRAMES here removes the gap that test was watching: a fourth stride
 * frame gets checked because it exists, not because someone remembered. It is
 * also how the sapper came to be missing from this file entirely — he had no
 * frames when it was written, so nobody added the row.
 */
interface HeroSpec {
  name: string;
  sprite: { w: number; h: number };
  build: (frame: AnimFrame) => PixelGrid;
  before: number;
}

/**
 * The `before` counts are the filled-cell totals this ratchet was cut against.
 *
 * Four of the five were re-cut when the hero was redrawn from a front-facing
 * 3/4 into profile. The ratchet's premise is "same pose, more detail", and a
 * re-pose does not survive it: a body edge-on is simply narrower than the same
 * body face-on, and in the wizard's and knight's case a weapon left the grid
 * for a live painter at the same time. Re-cut, not raised — the guard still
 * catches a later change that flattens a hero back out.
 */
const HEROES: readonly HeroCase[] = ([
  { name: 'archer', sprite: ARCHER_SPRITE, build: (f) => buildArcherGrid(f, TRIM), before: 340 },
  { name: 'wizard', sprite: WIZARD_SPRITE, build: (f) => buildWizardGrid(f, TRIM), before: 320 },
  { name: 'ranger', sprite: RANGER_SPRITE, build: (f) => buildRangerGrid(f, TRIM), before: 350 },
  { name: 'sapper', sprite: SAPPER_SPRITE, build: (f) => buildSapperGrid(f, TRIM), before: 380 },
  ...KNIGHT_KINDS.map((kind) => ({
    name: `knight|${kind}`,
    sprite: KNIGHT_SPRITE,
    build: (f: AnimFrame) => buildKnightGrid(kind, f, TRIM),
    before: 440,
  })),
] satisfies readonly HeroSpec[]).flatMap((h) =>
  ANIM_FRAMES.map((frame) => ({
    name: `${h.name}|${frame}`,
    sprite: h.sprite,
    grid: h.build(frame),
    before: h.before,
  })),
);

describe('hero pixel grids', () => {
  it('covers every hero the char-select screen can offer, in every frame', () => {
    // Compared against the exact key set rather than a length: a length check
    // catches a deletion and misses an addition, and a sixth hero arriving
    // with no rows here is precisely the gap that left the sapper unchecked.
    const expected = new Set<string>();
    for (const hero of ['archer', 'wizard', 'ranger', 'sapper']) {
      for (const frame of ANIM_FRAMES) expected.add(`${hero}|${frame}`);
    }
    for (const kind of KNIGHT_KINDS) {
      for (const frame of ANIM_FRAMES) expected.add(`knight|${kind}|${frame}`);
    }
    expect(new Set(HEROES.map((h) => h.name))).toEqual(expected);
  });

  for (const hero of HEROES) {
    describe(hero.name, () => {
      it('is exactly the size its sprite constants promise', () => {
        expect(gridSize(hero.grid)).toEqual({ w: hero.sprite.w, h: hero.sprite.h });
        expect(raggedRows(hero.grid)).toEqual([]);
      });

      it('paints every filled cell in a hex colour', () => {
        expect(invalidColours(hero.grid)).toEqual([]);
      });

      it('still shows the trim colour it was handed', () => {
        // Detail is painted over the body, and the trim stripe is the one
        // marker a player reads a side off. Burying it is the failure this
        // catches — every builder paints its trim last for that reason.
        expect([...gridColours(hero.grid)]).toContain(TRIM);
      });

      it('carries more filled cells than it did before the detail pass', () => {
        expect(countFilled(hero.grid)).toBeGreaterThan(hero.before);
      });

      it('bakes into the shared sprite cache, in colour and as a hit-flash', () => {
        const { w, h } = hero.sprite;
        expect(() => spriteCanvas(`test|${hero.name}`, hero.grid, w, h)).not.toThrow();
        expect(() => spriteFlashCanvas(`test|${hero.name}`, hero.grid, w, h, '#FFFFFF')).not.toThrow();
      });
    });
  }
});
