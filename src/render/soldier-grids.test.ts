import { describe, expect, it } from 'vitest';

import { SOLDIER_KINDS } from '../sim/soldiers';
import type { PixelGrid } from './pixel-grid';
import {
  COMMANDER_PALETTE,
  COMMANDER_SPRITE,
  SOLDIER_GRID_BUILDERS,
  SOLDIER_PALETTES,
  SOLDIER_SPRITE,
  buildCommanderGrid,
  type StrideFrame,
} from './soldier-grids';

const FRAMES: StrideFrame[] = ['a', 'mid', 'b'];

/** The row a soldier's boots land on, where two legs have to read as two. */
const BOOT_ROW = 22;

/** The row the commander's hooves land on, four legs in two pairs. */
const HOOF_ROW = 25;

/** How many cells a grid actually paints. A silent typo tends to paint none. */
const painted = (g: PixelGrid): number =>
  g.reduce((n, row) => n + row.filter((c) => c !== null && c !== undefined).length, 0);

/** A grid as one comparable string, for telling two of them apart. */
const shapeOf = (g: PixelGrid): string => g.map((row) => row.join(',')).join('|');

/**
 * How many separate runs of *body* a row has, ignoring the outline colour.
 *
 * This is the check for limbs collapsing. A stride swings limbs in antiphase,
 * and if each swings around its own top rather than a shared hip they cross at
 * one extreme and merge into a single block: one frame of the walk shows one
 * thick leg, invisible in a still and obvious in motion.
 *
 * Counting any filled cell is the obvious predicate and it is wrong on an
 * outlined sprite. pixelOutline fills the gap between two close limbs with
 * outline-coloured cells, so a two-column gap reads as one fused run on a
 * sprite whose legs are plainly separate. Skipping the outline colour measures
 * what is actually being asked — is there body, gap, body — instead of whether
 * any raw emptiness happens to have survived.
 *
 * `outline` must be the colour pixelOutline was actually called with, which
 * for these builders is C.edge. It is deliberately a parameter rather than
 * read off a palette slot named `edge`, because that name cannot be trusted
 * across sprites: the legacy rat's palette carries an `edge` slot so nothing
 * downstream has to know a rat is not a skeleton, but the rat never outlines
 * and paints its legs, tail and ear in it. Masking by slot name there erases
 * the whole row and reports zero legs on a sprite that has four.
 *
 * The converse trap is why the boots have a colour of their own. Anything
 * painted in the masked colour vanishes from this count, and the boots were:
 * the row came back as zero runs on a row that is entirely feet.
 *
 * Zero is the loud version, and it only happens when nothing else shares the
 * row. The quiet version is partial blindness, and this codebase already has
 * it — the archer's and the wizard's eyes are setPixel'd in C.outline
 * (render/character-grids.ts), so a face row has skin either side of them and
 * comes back nonzero and merely wrong. "Assert the band is not wholly masked"
 * therefore catches a badly chosen row, which is worth having, but it does not
 * catch this. The rule that does: structure must not be drawn in the seam
 * colour on any row this predicate is pointed at.
 */
function bodyRuns(g: PixelGrid, y: number, outline: string): number {
  const row = g[y] ?? [];
  let runs = 0;
  let inRun = false;
  for (const cell of row) {
    const isBody = cell !== null && cell !== undefined && cell !== outline;
    if (isBody && !inRun) runs++;
    inRun = isBody;
  }
  return runs;
}

describe('soldier grids', () => {
  it.each(SOLDIER_KINDS)('builds %s at the declared sprite size', (kind) => {
    for (const frame of FRAMES) {
      const g = SOLDIER_GRID_BUILDERS[kind](frame);
      expect(g).toHaveLength(SOLDIER_SPRITE.h);
      expect(g[0]).toHaveLength(SOLDIER_SPRITE.w);
    }
  });

  // The check that catches a builder which throws nothing and draws nothing —
  // an off-grid coordinate, or a colour that came out undefined. In the game
  // that is an invisible enemy, and nothing else fails.
  it.each(SOLDIER_KINDS)('paints a real body for %s, not an empty grid', (kind) => {
    for (const frame of FRAMES) {
      expect(painted(SOLDIER_GRID_BUILDERS[kind](frame)), `${kind} ${frame}`)
        .toBeGreaterThan(40);
    }
  });

  it('draws the three kinds differently, so they are told apart on sight', () => {
    const shapes = SOLDIER_KINDS.map((k) => shapeOf(SOLDIER_GRID_BUILDERS[k]('mid')));
    expect(new Set(shapes).size).toBe(SOLDIER_KINDS.length);
  });

  // The stride is the whole animation. Two frames that came out identical
  // would leave a soldier sliding across the floor without moving its legs.
  it.each(SOLDIER_KINDS)('moves %s between the two extremes of its stride', (kind) => {
    expect(shapeOf(SOLDIER_GRID_BUILDERS[kind]('a')))
      .not.toBe(shapeOf(SOLDIER_GRID_BUILDERS[kind]('b')));
  });

  // Reported by the pixel-art session, which hit this twice on its own
  // sprites: the skeleton's four leg bones landed in the same three columns at
  // full swing and read as one thick leg, and the minotaur's two feet fused
  // into one hoof. Same cause here — legs that swing around their own tops
  // instead of a shared hip cross at one extreme and merge.
  //
  // Both extremes, because the bug is asymmetric: the frame that splays
  // correctly proves nothing about the frame that collapses.
  it.each(SOLDIER_KINDS)('keeps %s\'s two legs apart at both ends of the stride', (kind) => {
    // Two is right for these three because all three have visible legs. It is
    // not a universal invariant and does not belong in a shared helper: a body
    // in a long cloak legitimately reports one run across the whole leg band,
    // and asserting two for every sprite would fail on the sprite rather than
    // on the assertion.
    const outline = SOLDIER_PALETTES[kind]['edge']!;
    for (const frame of ['a', 'b'] as const) {
      const g = SOLDIER_GRID_BUILDERS[kind](frame);
      expect(bodyRuns(g, BOOT_ROW, outline), `${kind} ${frame} fused its legs into one`).toBe(2);
    }
  });

  it('lets the legs meet in the middle of the stride, which is not the bug', () => {
    // Mid-stride is legs together, so one run there is correct. Asserting two
    // everywhere would forbid a walk cycle rather than fix one.
    expect(bodyRuns(SOLDIER_GRID_BUILDERS.spearman('mid'), BOOT_ROW,
      SOLDIER_PALETTES.spearman['edge']!)).toBe(1);
  });

  // The precondition the masking predicate needs, asserted over every row
  // rather than at the one or two the other tests happen to sample.
  //
  // A row painted entirely in the seam colour vanishes under masking, so any
  // check later pointed at it reports zero and reads as a broken sprite. The
  // belt and the shieldman's shield rim were exactly that until they were
  // given a shade of their own. buildKnightGrid is the codebase's worked
  // example: it has a dedicated `visor` slot and reaches for the outline
  // colour nowhere but the outline call, which is why it is the one hero with
  // no masking problem.
  //
  // NOT TESTED, deliberately, and this is the note explaining why.
  //
  // The precondition the masking predicate needs is that structure is never
  // painted in the seam colour. It cannot be asserted from a finished grid:
  // once pixelOutline has run, a seam cell and a structural cell of the same
  // colour are the same cell, and nothing downstream can tell them apart.
  //
  // Two attempts are worth recording, because both look workable. "No row is
  // entirely seam" fails on the outline's own caps, the seam across the top of
  // the helm. Narrowing it to interior rows fails on the neck: the seam
  // between head and torso spans the full width and is legitimately all seam.
  // Every further narrowing is a way of not testing it while appearing to.
  //
  // So this is maintained by convention instead, following buildKnightGrid,
  // the codebase's one hero with no masking problem: it gives its visor a
  // palette slot of its own and reaches for the outline colour nowhere but the
  // outline call. The soldiers now do the same — boots and belts and the
  // shield's rim have a `shade` of their own — and the reason that slot is not
  // called `edge` is the legacy rat, whose `edge` means "darkest structural
  // tone" and whose legs vanish under a mask keyed on the name.

  it('is deterministic, so the sprite cache can key on kind and frame alone', () => {
    for (const kind of SOLDIER_KINDS) {
      expect(shapeOf(SOLDIER_GRID_BUILDERS[kind]('a')))
        .toBe(shapeOf(SOLDIER_GRID_BUILDERS[kind]('a')));
    }
  });

  // The shieldman's guard is a rule in sim/soldiers.ts, and this is the
  // picture a player reads it off. If the shield stopped being drawn on the
  // leading side, the rule would still work and would stop making sense.
  it('puts the shieldman\'s shield on the side it is facing', () => {
    const g = SOLDIER_GRID_BUILDERS.shieldman('mid');
    const half = (from: number, to: number): number => {
      let n = 0;
      for (const row of g) for (let x = from; x < to; x++) if (row[x]) n++;
      return n;
    };
    const leading = half(SOLDIER_SPRITE.w / 2, SOLDIER_SPRITE.w);
    const trailing = half(0, SOLDIER_SPRITE.w / 2);
    expect(leading).toBeGreaterThan(trailing);
  });
});

describe('the commander grid', () => {
  it.each(FRAMES)('builds at the declared sprite size on frame %s', (frame) => {
    const g = buildCommanderGrid(frame);
    expect(g).toHaveLength(COMMANDER_SPRITE.h);
    expect(g[0]).toHaveLength(COMMANDER_SPRITE.w);
  });

  it('paints a horse and rider rather than an empty grid', () => {
    expect(painted(buildCommanderGrid('mid'))).toBeGreaterThan(150);
  });

  it('is wider than a soldier, because he is mounted', () => {
    expect(COMMANDER_SPRITE.w).toBeGreaterThan(SOLDIER_SPRITE.w);
  });

  it('moves between the two extremes of the gait', () => {
    expect(shapeOf(buildCommanderGrid('a'))).not.toBe(shapeOf(buildCommanderGrid('b')));
  });

  // Four legs in two pairs, and the same collapse the soldiers had: a pair
  // that swings around its own tops crosses at one extreme and reads as one
  // wide hoof. Four runs at both ends of the gait.
  it.each(['a', 'b'] as const)('keeps all four legs apart on frame %s', (frame) => {
    expect(bodyRuns(buildCommanderGrid(frame), HOOF_ROW, COMMANDER_PALETTE.edge)).toBe(4);
  });
});
