import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GUARD_KINDS, MAX_RANK, type GuardKind } from '../sim/guards';
import { countFilled, gridSize, invalidColours, raggedRows } from './grid-testkit';
import { ANIM_FRAMES, type PixelGrid } from './pixel-grid';
import {
  GUARD_GRID_BUILDERS,
  GUARD_PALETTES,
  GUARD_SPRITE,
  buildGuardGrid,
  type StrideFrame,
} from './guard-grids';
import { SOLDIER_PALETTES } from './soldier-grids';

const KINDS: readonly GuardKind[] = GUARD_KINDS;

/**
 * The frames a baked cycle is called with, read from pixel-grid.ts rather than
 * written out again: a fourth frame added there and not here would leave the
 * new one untested while every test still passed.
 */
const FRAMES: StrideFrame[] = [...ANIM_FRAMES];

/** Every rank the ladder can reach, the rank-0 recruit included. */
const RANKS: number[] = Array.from({ length: MAX_RANK + 1 }, (_, r) => r);

/** The row a guard's boots land on, where two legs have to read as two. */
const BOOT_ROW = 22;

/**
 * What a rank badge is allowed to cost, as a share of the sprite it is worn on.
 *
 * The failure this catches is an insignia that stopped being an insignia:
 * a rank drawn as a second cloak, a full-torso sash or a different helm reads
 * as a different *kind*, and the player who has to re-identify a guard every
 * time it is promoted has lost the thing ranks were added for.
 *
 * Eight per cent — one twelfth of the filled sprite — because the three-pip
 * ladder as drawn costs between 2.8% and 4.3% depending on kind (the archer is
 * the dearest: its torso is narrow, so the badge hangs a column off the side
 * and drags a column of fresh outline with it). Doubling the measured worst
 * case leaves room for a fourth pip or a wider one without a test edit, and
 * still fails long before anything that could be mistaken for a costume.
 */
const RANK_BADGE_BUDGET = 0.08;

/** A grid as one comparable string, for telling two of them apart. */
const shapeOf = (g: PixelGrid): string => g.map((row) => row.join(',')).join('|');

/** How many cells two same-sized grids disagree on, colour changes included. */
function differingCells(a: PixelGrid, b: PixelGrid): number {
  let n = 0;
  for (const [y, row] of a.entries())
    for (const [x, cell] of row.entries()) if (cell !== b[y]?.[x]) n++;
  return n;
}

/** How many cells a grid paints in one exact colour. */
function countColour(g: PixelGrid, colour: string): number {
  let n = 0;
  for (const row of g) for (const cell of row) if (cell === colour) n++;
  return n;
}

/**
 * How many separate runs of *body* a row has, ignoring the outline colour.
 *
 * Lifted from soldier-grids.test.ts, whose comment is the long version of why
 * it is written this way. The short version: counting any filled cell is the
 * obvious predicate and it is wrong on an outlined sprite, because pixelOutline
 * paints the gap between two close limbs, and a sprite with plainly separate
 * legs then reads as one fused run. Masking the seam colour asks the question
 * that was meant — body, gap, body — rather than whether any raw emptiness
 * happened to survive.
 *
 * Copied rather than imported, and rather than hoisted into grid-testkit.ts.
 * Importing it would make one sprite family's test file a dependency of
 * another's, which is a worse coupling than the duplication. Hoisting is the
 * move the rule of three would want and the seam parameter is what argues
 * against it *today*: `outline` has to be the colour pixelOutline was actually
 * called with, and the two call sites disagree about how that colour is found
 * (a palette slot here, a palette slot of a different family there, neither
 * trustworthy by name — the legacy rat carries an `edge` slot it paints its
 * legs in). A third caller is the point at which that is worth solving once.
 *
 * The precondition it needs is the last test in this file: structure is never
 * painted in the seam colour. Anything that is vanishes from this count, which
 * is how a row of boots once came back as zero legs.
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

describe('guard grids', () => {
  // Driven off GUARD_KINDS with a length check, because the Record type only
  // guarantees that every *declared* kind has a row. It says nothing about
  // GUARD_KINDS listing every kind, and nothing about a stale extra row left
  // behind by a rename — an array cannot state completeness in the type system,
  // so the count has to be asserted.
  it('has a palette and a builder for every kind, and nothing else', () => {
    expect(Object.keys(GUARD_PALETTES).sort()).toEqual([...KINDS].sort());
    expect(Object.keys(GUARD_GRID_BUILDERS).sort()).toEqual([...KINDS].sort());
    expect(Object.keys(GUARD_PALETTES)).toHaveLength(KINDS.length);
    expect(Object.keys(GUARD_GRID_BUILDERS)).toHaveLength(KINDS.length);
  });

  it.each(KINDS)('builds %s at the declared sprite size, unragged', (kind) => {
    for (const frame of FRAMES)
      for (const rank of RANKS) {
        const g = buildGuardGrid(kind, frame, rank);
        expect(gridSize(g), `${kind} ${frame} r${rank}`).toEqual(GUARD_SPRITE);
        expect(raggedRows(g), `${kind} ${frame} r${rank}`).toEqual([]);
      }
  });

  // The check that catches a builder which throws nothing and draws nothing —
  // an off-grid coordinate, or a colour that came out undefined. In the game
  // that is an invisible guard, and nothing else fails.
  it.each(KINDS)('paints a real body for %s, not an empty grid', (kind) => {
    for (const frame of FRAMES)
      expect(countFilled(buildGuardGrid(kind, frame, 0)), `${kind} ${frame}`)
        .toBeGreaterThan(40);
  });

  /**
   * The most important test in this file.
   *
   * Reported by the pixel-art session and recorded in soldier-grids.ts: legs
   * written the obvious way — one at `6 + swing`, the other at `9 - swing` —
   * converge instead of splaying, meet at full swing and fuse into one thick
   * leg for a frame of the walk. Invisible in a still, unmissable in motion.
   *
   * Every frame rather than only the two extremes, which is stricter than the
   * garrison's version of this test and is a claim about these sprites: a guard
   * holds a braced stance and never passes through feet-together, so one run at
   * the boot row is a bug on any frame. The garrison legitimately closes its
   * feet mid-stride and is allowed its one run there.
   *
   * Every kind, because the shared body is not shared by fiat — a kind that
   * grew its own legs, or hung a robe or a staff across the boot row, would be
   * caught here and nowhere else.
   */
  it.each(KINDS)('keeps %s\'s two legs apart on every frame of the stride', (kind) => {
    const outline = GUARD_PALETTES[kind]['edge']!;
    for (const frame of FRAMES)
      for (const rank of RANKS) {
        const g = buildGuardGrid(kind, frame, rank);
        expect(bodyRuns(g, BOOT_ROW, outline), `${kind} ${frame} r${rank} fused its legs into one`)
          .toBe(2);
      }
  });

  // The stride is the whole animation. Two frames that came out identical would
  // leave a guard sliding across the bastion without moving its legs.
  it.each(KINDS)('moves %s between the two extremes of its stride', (kind) => {
    const shapes = FRAMES.map((frame) => shapeOf(buildGuardGrid(kind, frame, 0)));
    expect(new Set(shapes).size, `${kind} repeats a frame`).toBe(FRAMES.length);
  });

  it('draws every kind differently, so they are told apart on sight', () => {
    const shapes = KINDS.map((kind) => shapeOf(buildGuardGrid(kind, 'mid', 0)));
    expect(new Set(shapes).size).toBe(KINDS.length);
  });

  /**
   * "Different" is not enough for the priest, so this measures how different.
   *
   * The check above passes on a one-pixel difference, which is the whole
   * distance between two sprites that are the same body with a recoloured hood.
   * The priest is the one guard the player has exactly one of and cannot get
   * back, so picking it out of a scrum is a thing the art has to do rather than
   * a thing the player has to remember — and the pairwise minimum below is the
   * floor for that being true.
   *
   * A third of the sprite is the threshold and the measured figures are 97%,
   * 117% and 103% of its filled cells (a share can exceed 100% because a cell
   * the priest leaves empty and another kind fills counts as a difference). So
   * this fails long before the silhouettes converge, and it does not fail for a
   * palette tweak.
   */
  it('keeps the priest plainly apart from every other kind', () => {
    const priest = buildGuardGrid('priest', 'mid', 0);
    const body = countFilled(priest);
    for (const kind of KINDS) {
      if (kind === 'priest') continue;
      const share = differingCells(priest, buildGuardGrid(kind, 'mid', 0)) / body;
      expect(share, `the priest differs from the ${kind} by only ${(share * 100).toFixed(0)}%`)
        .toBeGreaterThan(0.33);
    }
  });

  /**
   * The priest's own version of the leg check, on the rows a robe would cover.
   *
   * A floor-length cassock is the obvious way to dress this kind and it is
   * exactly the fusion recorded in guard-grids.ts: a hem is one band of cloth
   * across the boot row, which merges the legs on *every* frame rather than
   * only at full swing. The shared check above reads BOOT_ROW; this one reads
   * the three rows a hem would reach, so a robe that stopped one pixel short of
   * the floor is caught too.
   *
   * BOOT_ROW - 3 is deliberately not included: the staff's shaft ends there and
   * is a legitimate third run, being neither a leg nor anywhere near one.
   */
  it('keeps the priest\'s robe clear of its legs on every frame and rank', () => {
    const outline = GUARD_PALETTES.priest['edge']!;
    for (const frame of FRAMES)
      for (const rank of RANKS)
        for (const row of [BOOT_ROW - 2, BOOT_ROW - 1, BOOT_ROW]) {
          const g = buildGuardGrid('priest', frame, rank);
          expect(bodyRuns(g, row, outline), `priest ${frame} r${rank} row ${row}`).toBe(2);
        }
  });

  // Pairwise, not "the top differs from the bottom". A ladder that draws one
  // pip for rank 1 and the same one pip for rank 2 passes that weaker check on
  // both ends and still leaves the player unable to read the middle of it.
  it.each(KINDS)('gives %s a distinguishable grid at every rank', (kind) => {
    const shapes = RANKS.map((rank) => shapeOf(buildGuardGrid(kind, 'mid', rank)));
    for (const [i, a] of shapes.entries())
      for (const [j, b] of shapes.entries())
        if (i < j) expect(a, `${kind} rank ${i} and rank ${j} draw the same sprite`).not.toBe(b);
  });

  // The countable half of the device: one more mark per rank, in a colour used
  // for nothing else on the sprite. Strictly increasing rather than an exact
  // pip geometry, so widening a pip is not a test edit — what must not change
  // is that a higher rank shows visibly more of it.
  it.each(KINDS)('adds a mark per rank for %s, in a colour it uses nowhere else', (kind) => {
    const gold = GUARD_PALETTES[kind]['rank']!;
    const marks = RANKS.map((rank) => countColour(buildGuardGrid(kind, 'mid', rank), gold));
    expect(marks[0], `${kind} marks a recruit`).toBe(0);
    for (const [i, n] of marks.entries())
      if (i > 0) expect(n, `${kind} rank ${i} is no louder than rank ${i - 1}`)
        .toBeGreaterThan(marks[i - 1]!);
  });

  /**
   * The insignia has to be an insignia.
   *
   * A rank that changes a large share of the sprite is a redraw, and a redrawn
   * guard is a guard the player has to identify again. Measured against rank
   * 0's filled count and including colour-only changes, because overpainting a
   * pauldron gold costs no pixels and is exactly as loud as adding one.
   */
  it.each(KINDS)('marks %s\'s rank rather than redrawing it', (kind) => {
    const recruit = buildGuardGrid(kind, 'mid', 0);
    const veteran = buildGuardGrid(kind, 'mid', MAX_RANK);
    const share = differingCells(recruit, veteran) / countFilled(recruit);
    expect(share, `${kind}'s rank badge covers ${(share * 100).toFixed(1)}% of the sprite`)
      .toBeLessThanOrEqual(RANK_BADGE_BUDGET);
  });

  /**
   * Out-of-range ranks clamp, and the clamp is the drawn one.
   *
   * Clamping rather than ignoring is guard-grids.ts's decision and this is the
   * test of it: rank 4 draws the rank-3 sprite exactly, so a caller that got
   * ahead of the ladder shows a veteran rather than silently showing a recruit.
   * Below zero goes the other way for the same reason. Neither throws — a
   * renderer that can take down the frame loop over a number it could clamp is
   * a bad trade for art.
   *
   * The fourth-insignia half is the equality itself: if a fourth pip were drawn
   * anywhere, rank 4 would not be rank 3's sprite.
   */
  it.each(KINDS)('clamps an out-of-range rank on %s instead of throwing', (kind) => {
    const top = shapeOf(buildGuardGrid(kind, 'mid', MAX_RANK));
    const recruit = shapeOf(buildGuardGrid(kind, 'mid', 0));
    for (const over of [MAX_RANK + 1, MAX_RANK + 9, 99])
      expect(shapeOf(buildGuardGrid(kind, 'mid', over)), `${kind} at rank ${over}`).toBe(top);
    for (const under of [-1, -99])
      expect(shapeOf(buildGuardGrid(kind, 'mid', under)), `${kind} at rank ${under}`).toBe(recruit);
    // A fraction is a rank between two marks, and half a pip is not a thing the
    // device can draw. It floors, so 2.9 is still a rank 2.
    expect(shapeOf(buildGuardGrid(kind, 'mid', 2.9))).toBe(shapeOf(buildGuardGrid(kind, 'mid', 2)));
  });

  it.each(KINDS)('emits only colours a canvas fillStyle can take for %s', (kind) => {
    for (const frame of FRAMES)
      for (const rank of RANKS)
        expect(invalidColours(buildGuardGrid(kind, frame, rank)), `${kind} ${frame} r${rank}`)
          .toEqual([]);
  });

  it('is deterministic, so the sprite cache can key on kind, frame and rank alone', () => {
    for (const kind of KINDS)
      for (const frame of FRAMES)
        for (const rank of RANKS)
          expect(shapeOf(buildGuardGrid(kind, frame, rank)))
            .toBe(shapeOf(buildGuardGrid(kind, frame, rank)));
  });

  it('routes buildGuardGrid through the same builders the table exposes', () => {
    for (const kind of KINDS)
      expect(shapeOf(buildGuardGrid(kind, 'a', 2)))
        .toBe(shapeOf(GUARD_GRID_BUILDERS[kind]('a', 2)));
  });

  /**
   * The retinue must not be mistakable for the cavern's garrison, and the
   * strongest form of that is sharing no paint with it at all.
   *
   * Stated as disjoint colour sets rather than as "guards are lighter", which
   * was the first version and is false: the foot soldier's violet is darker
   * than the spearman's bronze, and the rule would have had to be weakened
   * until it stopped meaning anything. Disjointness is the property the palette
   * was actually built to have, so it is the one asserted.
   *
   * Case-insensitive, because two spellings of the same colour are the same
   * colour on a canvas and this check exists to catch a collision, not a
   * spelling.
   */
  it('shares no colour with the enemy soldiers', () => {
    const enemy = new Set(
      Object.values(SOLDIER_PALETTES).flatMap((p) => Object.values(p)).map((c) => c.toLowerCase()),
    );
    const shared = Object.values(GUARD_PALETTES)
      .flatMap((p) => Object.values(p))
      .map((c) => c.toLowerCase())
      .filter((c) => enemy.has(c));
    expect([...new Set(shared)], 'a guard is painted in a cavern soldier\'s colour').toEqual([]);
  });

  // The other half of the "reads as friendly" argument: the three enemies share
  // nothing, the whole retinue shares a livery. If a kind drifted onto its own
  // violet the retinue would stop reading as one body, and nothing on screen
  // would say so — the sprites would each still look fine alone.
  it('paints the whole retinue in one livery and one promotion gold', () => {
    for (const slot of ['livery', 'liveryHi', 'rank'])
      expect(new Set(KINDS.map((kind) => GUARD_PALETTES[kind][slot])).size, `${slot} drifted`)
        .toBe(1);
  });

  /**
   * The precondition bodyRuns needs: structure is never painted in the seam
   * colour.
   *
   * Checked against the source, because it cannot be checked against a grid.
   * Once pixelOutline has run, a seam cell and a structural cell of the same
   * colour are the same cell and nothing downstream can tell them apart — which
   * is precisely how a leg check can report zero legs on a row that is entirely
   * feet. soldier-grids.test.ts carries the full account of why every attempt
   * to ask this of the finished grid fails; this is the same check, scoped to
   * this file's builders.
   *
   * File-wide rather than per builder, and for the same reason it is there:
   * buildGuardBody and drawRankPips carry the belt and the badge and have no
   * pixelOutline call of their own, so a per-function scope would skip the two
   * helpers every kind's structure actually comes from.
   */
  it('reaches for the seam colour nowhere but the pixelOutline call', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'guard-grids.ts'),
      'utf8',
    );
    // The comments discuss the seam colour by name at length. Stripping them
    // first is the difference between a check and a tripwire on its own
    // documentation.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // The seam colours are whatever the pixelOutline calls are actually passed,
    // read off those call sites rather than written down here, so the check
    // survives a rename of the palette slot.
    const parsed = [...code.matchAll(/pixelOutline\(\s*\w+\s*,\s*([^)]+?)\s*\)/g)];
    const calls = (code.match(/pixelOutline\(/g) ?? []).length;

    // A call the pattern cannot read yields no seam colour, that builder's
    // structure goes unexamined and nothing goes red. Silent exemption is the
    // worst failure a check like this can have, so an unreadable call is an
    // assertion failure rather than an abstention.
    expect(calls, 'no pixelOutline call found to read the seam colour from').toBeGreaterThan(0);
    expect(parsed.length, 'a pixelOutline call did not parse, so its builder would go unchecked')
      .toBe(calls);

    const seams = new Set(parsed.map((m) => m[1]!.replace(/!$/, '').trim()));
    const offenders = code
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => [...seams].some((seam) => line.includes(seam)))
      .filter(({ line }) => !line.includes('pixelOutline'));

    expect(offenders, `structure painted in the seam colour: ${JSON.stringify(offenders)}`)
      .toEqual([]);
  });
});
