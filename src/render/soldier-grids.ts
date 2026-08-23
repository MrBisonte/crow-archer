/**
 * The cavern garrison's pixel art: one grid builder per soldier kind, plus the
 * mounted commander.
 *
 * Here rather than in `src/legacy/game.js` for the reason character-grids.ts
 * is: art is data, and data that lives in the monolith cannot be looked at
 * without a browser. The legacy renderer imports these the same way it imports
 * the heroes' grids, and a test can build every one of them and check they are
 * distinct without a canvas, a DOM or a frame loop.
 *
 * Grid *data* is deliberately not cached here, same as the heroes: building
 * one is a few dozen pixel calls. The expensive half, painting it into a
 * canvas, is what pixel-sprite.ts's spriteCanvas caches, and the caller keys
 * that cache.
 *
 * Everything is drawn facing +x. The caller mirrors the whole sprite when the
 * body is looking the other way, which is what keeps a shield on the side the
 * shield actually guards.
 */

import type { SoldierKind } from '../sim/soldiers';
import {
  makePixelGrid, pixelRect, pixelEllipse, pixelCurve, pixelOutline, pixelTriangleUp,
  type PixelGrid,
} from './pixel-grid';

/** The three-frame stride every ground body in this game walks on. */
export type StrideFrame = 'a' | 'mid' | 'b';

export const SOLDIER_SPRITE = { w: 16, h: 24 };
export const COMMANDER_SPRITE = { w: 34, h: 28 };

/**
 * One palette per kind, chosen so the three read apart at a distance before
 * their silhouettes do: warm bronze for the spearman, cold steel and blue for
 * the shieldman, green and leather for the archer. A player has to know which
 * one is closing without waiting to see what it is carrying.
 */
export const SOLDIER_PALETTES: Record<SoldierKind, Record<string, string>> = {
  spearman: {
    cloth: '#8A6A38', clothHi: '#A88448', metal: '#9AA0A8', metalHi: '#C4CAD2',
    skin: '#C89868', edge: '#2A2018', accent: '#B03028',
  },
  shieldman: {
    cloth: '#44557A', clothHi: '#5E7296', metal: '#AAB4C0', metalHi: '#D8E0E8',
    skin: '#C89868', edge: '#1C2230', accent: '#C8A030',
  },
  archer: {
    cloth: '#3E5E3A', clothHi: '#52784C', metal: '#8A8A78', metalHi: '#B0B0A0',
    skin: '#C89868', edge: '#1A2418', accent: '#8A5A28',
  },
};

export const COMMANDER_PALETTE = {
  horse: '#3A3038', horseHi: '#544650', horseDark: '#241E22',
  plate: '#B8C2D0', plateHi: '#E4ECF4', cloth: '#8A2030', clothHi: '#B83848',
  skin: '#C89868', edge: '#12161C', gold: '#D8B048',
};

/** How far a limb swings on each frame of the stride. */
const swingOf = (frame: StrideFrame, amount: number): number =>
  frame === 'a' ? amount : frame === 'b' ? -amount : 0;

/**
 * The body all three soldiers share: legs on the stride, a tunic, a belt and a
 * head. What each kind carries is added on top by its own builder, so the walk
 * cycle is written once rather than three times.
 */
function buildSoldierBody(C: Record<string, string>, frame: StrideFrame): PixelGrid {
  const g = makePixelGrid(SOLDIER_SPRITE.w, SOLDIER_SPRITE.h);
  const swing = swingOf(frame, 2);

  pixelCurve(g, [6, 16], [6 + swing * 0.4, 19], [6 + swing, 22], C['cloth']!, 10);
  pixelCurve(g, [9, 16], [9 - swing * 0.4, 19], [9 - swing, 22], C['cloth']!, 10);
  pixelRect(g, 5 + swing, 21, 3, 2, C['edge']!);
  pixelRect(g, 8 - swing, 21, 3, 2, C['edge']!);

  pixelRect(g, 5, 9, 6, 8, C['cloth']!);
  pixelRect(g, 5, 9, 6, 2, C['clothHi']!);
  pixelRect(g, 5, 15, 6, 1, C['edge']!);

  pixelEllipse(g, 8, 5, 3, 3.2, C['skin']!);
  return g;
}

/** Spearman: conical helm, and the spear levelled at whatever it walks toward. */
export function buildSpearmanGrid(frame: StrideFrame): PixelGrid {
  const C = SOLDIER_PALETTES.spearman;
  const g = buildSoldierBody(C, frame);
  pixelTriangleUp(g, 8, 4, 4, 4, C['metal']!);
  pixelRect(g, 5, 4, 6, 1, C['metalHi']!);
  // Shaft across the chest and out past the leading hand, head at the tip.
  pixelRect(g, 4, 11, 12, 1, C['accent']!);
  pixelTriangleUp(g, 15, 12, 2, 3, C['metalHi']!);
  pixelRect(g, 10, 10, 2, 3, C['skin']!);
  return pixelOutline(g, C['edge']!);
}

/**
 * Shieldman: a flat-topped helm and a shield filling the leading side.
 *
 * The shield is deliberately large and on one side only, because that is the
 * mechanic drawn — sim/soldiers.ts stops shots inside 60 degrees of the nose,
 * and this is the picture a player reads that rule off.
 */
export function buildShieldmanGrid(frame: StrideFrame): PixelGrid {
  const C = SOLDIER_PALETTES.shieldman;
  const g = buildSoldierBody(C, frame);
  pixelRect(g, 5, 2, 6, 3, C['metal']!);
  pixelRect(g, 5, 2, 6, 1, C['metalHi']!);
  // Sword arm tucked behind the body.
  pixelRect(g, 4, 12, 1, 5, C['metal']!);
  // Shield: edge to edge down the leading side, boss in the middle.
  pixelRect(g, 11, 7, 4, 11, C['metal']!);
  pixelRect(g, 11, 7, 4, 1, C['metalHi']!);
  pixelRect(g, 11, 17, 4, 1, C['edge']!);
  pixelEllipse(g, 13, 12, 1.6, 1.8, C['accent']!);
  return pixelOutline(g, C['edge']!);
}

/** Archer: a hood instead of a helm, and a bow drawn down the leading side. */
export function buildBowmanGrid(frame: StrideFrame): PixelGrid {
  const C = SOLDIER_PALETTES.archer;
  const g = buildSoldierBody(C, frame);
  pixelEllipse(g, 8, 4, 3.6, 3.4, C['cloth']!);
  pixelEllipse(g, 8.5, 5, 2.4, 2.2, C['skin']!);
  pixelCurve(g, [12, 7], [15, 12], [12, 17], C['accent']!, 12);
  pixelRect(g, 12, 8, 1, 9, C['metalHi']!);
  pixelRect(g, 9, 11, 3, 1, C['skin']!);
  return pixelOutline(g, C['edge']!);
}

/** One row per kind, so a fourth soldier is a builder and a row, not a branch. */
export const SOLDIER_GRID_BUILDERS: Record<SoldierKind, (frame: StrideFrame) => PixelGrid> = {
  spearman: buildSpearmanGrid,
  shieldman: buildShieldmanGrid,
  archer: buildBowmanGrid,
};

/**
 * Horse and rider as one grid, drawn facing +x.
 *
 * One sprite rather than two stacked draws because the two never move
 * independently: he is mounted for the whole fight, and a rider who could come
 * off the horse would need a second silhouette nothing ever shows. The gait is
 * the same three-frame stride the soldiers walk on, so a charge reads as that
 * animation played faster rather than as a different one.
 */
export function buildCommanderGrid(frame: StrideFrame): PixelGrid {
  const C = COMMANDER_PALETTE;
  const g = makePixelGrid(COMMANDER_SPRITE.w, COMMANDER_SPRITE.h);
  const swing = swingOf(frame, 3);

  // Legs, fore and hind, swinging opposite each other.
  pixelRect(g, 7 + swing, 20, 3, 7, C.horseDark);
  pixelRect(g, 12 - swing, 20, 3, 7, C.horseDark);
  pixelRect(g, 21 + swing, 20, 3, 7, C.horseDark);
  pixelRect(g, 26 - swing, 20, 3, 7, C.horseDark);

  // Barrel, then neck and head.
  pixelEllipse(g, 18, 17, 12, 5, C.horse);
  pixelEllipse(g, 18, 15, 11, 3.5, C.horseHi);
  pixelCurve(g, [26, 16], [29, 11], [30, 8], C.horse, 7);
  pixelEllipse(g, 30, 7, 3.4, 2.4, C.horse);
  pixelRect(g, 31, 6, 3, 2, C.horseDark);
  pixelTriangleUp(g, 28, 5, 1, 2, C.horseDark);
  pixelCurve(g, [7, 14], [3, 16], [2, 21], C.horseDark, 6);
  // Caparison, so the horse reads as his rather than as a horse.
  pixelRect(g, 12, 18, 10, 5, C.cloth);
  pixelRect(g, 12, 18, 10, 1, C.clothHi);

  // Rider: breastplate, pauldrons, helm with a plume.
  pixelRect(g, 15, 8, 6, 7, C.plate);
  pixelRect(g, 15, 8, 6, 2, C.plateHi);
  pixelRect(g, 14, 9, 2, 3, C.plate);
  pixelRect(g, 20, 9, 2, 3, C.plate);
  pixelEllipse(g, 18, 4, 3, 3, C.plate);
  pixelRect(g, 16, 3, 5, 1, C.plateHi);
  pixelRect(g, 17, 1, 2, 3, C.cloth);
  pixelRect(g, 19, 4, 2, 2, C.skin);

  // Lance, couched and levelled ahead — the shape the charge is read from.
  pixelRect(g, 20, 11, 14, 1, C.gold);
  pixelTriangleUp(g, 33, 12, 2, 3, C.plateHi);

  return pixelOutline(g, C.edge);
}
