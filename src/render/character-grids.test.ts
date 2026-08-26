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
  type KnightKind,
} from './character-grids';
import { ANIM_FRAMES, type PixelGrid } from './pixel-grid';
import { spriteCanvas, spriteFlashCanvas } from './pixel-sprite';
import {
  countFilled, gridColours, gridSize, installStubCanvas, invalidColours, raggedRows,
} from './grid-testkit';

installStubCanvas();

/** A caller-supplied trim colour, standing in for a team or a theme colour. */
const TRIM = '#39FF14';

/** Every palette the knight's grid is built against. */
const KNIGHT_KINDS: readonly KnightKind[] = ['normal', 'fireSword'];

interface HeroCase {
  name: string;
  sprite: { w: number; h: number };
  grid: PixelGrid;
  /** Filled cells before the detail pass. */
  before: number;
}

const HEROES: readonly HeroCase[] = [
  // The archer's three are 340, not the 440 the rest carry, and the gap is two
  // deliberate changes rather than a flattening. He was redrawn from a
  // front-facing 3/4 into profile, and a body edge-on is narrower than the same
  // body face-on. Then the bow came out of the grid entirely — it has to swing
  // to the aim and bend through a draw, so render/archer-bow.ts paints it live.
  // The ratchet's premise is "same pose, more detail"; neither survives a
  // change of pose or a part moving to another module, so it is re-cut here.
  { name: 'archer|a', sprite: ARCHER_SPRITE, grid: buildArcherGrid('a', TRIM), before: 340 },
  { name: 'archer|mid', sprite: ARCHER_SPRITE, grid: buildArcherGrid('mid', TRIM), before: 340 },
  { name: 'archer|b', sprite: ARCHER_SPRITE, grid: buildArcherGrid('b', TRIM), before: 340 },
  { name: 'wizard', sprite: WIZARD_SPRITE, grid: buildWizardGrid(TRIM), before: 440 },
  { name: 'ranger|a', sprite: RANGER_SPRITE, grid: buildRangerGrid('a', TRIM), before: 374 },
  { name: 'ranger|mid', sprite: RANGER_SPRITE, grid: buildRangerGrid('mid', TRIM), before: 376 },
  { name: 'ranger|b', sprite: RANGER_SPRITE, grid: buildRangerGrid('b', TRIM), before: 385 },
  { name: 'knight|normal', sprite: KNIGHT_SPRITE, grid: buildKnightGrid('normal', TRIM), before: 713 },
  { name: 'knight|fireSword', sprite: KNIGHT_SPRITE, grid: buildKnightGrid('fireSword', TRIM), before: 713 },
];

describe('hero pixel grids', () => {
  it('cover every frame and kind the renderers ask a builder for', () => {
    // The table above is hand-written, so this is what stops a new stride
    // frame or knight palette from being added and simply never checked.
    // ANIM_FRAMES is the builders' own frame list, not a copy of it, so a
    // fourth frame would fail here rather than quietly go unchecked.
    const names = new Set(HEROES.map((h) => h.name));
    for (const frame of ANIM_FRAMES) expect(names).toContain(`archer|${frame}`);
    for (const frame of ANIM_FRAMES) expect(names).toContain(`ranger|${frame}`);
    for (const kind of KNIGHT_KINDS) expect(names).toContain(`knight|${kind}`);
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
