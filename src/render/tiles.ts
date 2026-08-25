/**
 * Tile rendering. Static tile art is painted once into an offscreen layer and
 * blitted per frame. Only water, tree flicker, and ash embers draw live on top.
 */

import type { MapKind } from '../sim/arena-map';
import { TILE, type TileId, type TileMap } from '../sim/tilemap';
import {
  makePixelGrid, setPixel, pixelRect, pixelEllipse, pixelTriangleUp, blitPixelGrid, type PixelGrid,
} from './pixel-grid';
import {
  paintBastionAsh, paintBastionGround, paintBastionSapling, paintBastionStone,
  paintBastionTower, paintBastionTree, paintBastionWater,
} from './bastion-tiles';

/** Logical resolution every tile paints at, blown up to fill the real tile
 * size — chunkier than a character sprite on purpose: tiles repeat across
 * the whole map, and coarser pixels read cleaner at a glance than fine
 * detail would tiled dozens of times. */
const TILE_GRID = 16;

function paintGrid(
  g: CanvasRenderingContext2D, x: number, y: number, ts: number, build: (grid: PixelGrid) => void,
): void {
  const grid = makePixelGrid(TILE_GRID, TILE_GRID);
  build(grid);
  blitPixelGrid(g, grid, x, y, ts / TILE_GRID);
}

/** Grid geometry the renderer needs. Injected so render code has no global config. */
export interface TileLayout {
  tileSize: number;
  hudHeight: number;
}

/** Draws the static part of one tile at layer-local (x, y). */
type TilePainter = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: number,
  layout: TileLayout,
  hutAbove: boolean,
  hutLeft: boolean,
) => void;

/** Adding a tile type means adding a painter here, not editing a loop. */
export const TILE_PAINTERS: Partial<Record<TileId, TilePainter>> = {
  [TILE.EMPTY](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#1a2a1a');
      pixelRect(grid, 0, 0, 16, 1, '#16241a');
      pixelRect(grid, 0, 0, 1, 16, '#16241a');
      // Ground texture: deterministic micro-spots per tile
      if (seed % 7 === 0)  pixelRect(grid, (seed % 11) + 1, (seed % 9) + 1, 2, 2, '#172517');
      if (seed % 11 === 0) pixelRect(grid, (seed % 9) + 3, (seed % 7) + 3, 2, 2, '#1c2f1c');
      if (seed % 5 === 0)  setPixel(grid, (seed % 13) + 2, (seed % 10) + 8, '#213a21');
      // A tuft of grass on some tiles, three blades of differing height. The
      // spots above are all stains *in* the ground; a floor the player crosses
      // constantly needs something standing on it too, and the seed keeps it
      // from landing in the same place on every tile that has one.
      if (seed % 4 === 1) {
        const gx = (seed % 10) + 3, gy = (seed % 6) + 9;
        pixelRect(grid, gx, gy - 1, 1, 2, '#254a25');
        pixelRect(grid, gx + 1, gy - 2, 1, 3, '#2c5a2c');
        pixelRect(grid, gx + 2, gy - 1, 1, 2, '#254a25');
      }
    });
  },
  [TILE.ROCK](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#1a2a1a');
      // The tree casts a contact shadow and the boulder did not, which left
      // it looking like it hovered a little over the ground.
      pixelEllipse(grid, 8, 14, 6, 1.6, 'rgba(0,0,0,0.30)');
      pixelEllipse(grid, 8, 9, 6, 5, '#585858');
      pixelEllipse(grid, 6 + (seed % 2), 7, 3, 3, '#6e6e6e');
      pixelEllipse(grid, 6, 8, 2, 2, '#828282');
      pixelEllipse(grid, 10, 11, 2, 2, '#484848');
      // A crack down the face, and moss where it meets the ground
      pixelRect(grid, 9 - (seed % 2), 7, 1, 4, '#3e3e3e');
      if (seed % 3 === 0) pixelRect(grid, 4, 11, 3, 1, '#2c4a2c');
    });
  },
  [TILE.WATER](g, x, y, _seed, { tileSize: ts }) {
    // Flat fill only — already blocky, no grid needed. The live overlay
    // (AnimatedTileOverlay) draws the phase color and ripples.
    g.fillStyle = '#1a4a8a'; g.fillRect(x, y, ts, ts);
  },
  [TILE.TREE](g, x, y, _seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#1a2a1a');
      pixelEllipse(grid, 8, 14, 5, 2, 'rgba(0,0,0,0.30)');
      // Roots spreading off the trunk, so the tree grows out of the ground
      // rather than being stuck into it
      pixelRect(grid, 4, 14, 3, 1, '#4a2a12');
      pixelRect(grid, 9, 14, 3, 1, '#4a2a12');
      pixelRect(grid, 6, 9, 3, 6, '#5c3317');
      pixelRect(grid, 6, 9, 1, 6, '#6e4420'); // lit side of the trunk
      setPixel(grid, 7, 11, '#43240f'); setPixel(grid, 8, 13, '#43240f'); // bark
      // Three canopy lobes and a shaded underside: two circles of one green
      // read as a lollipop, and every tree on the map is this one tile.
      pixelEllipse(grid, 8, 6, 5, 5, '#1e7a1e');
      pixelEllipse(grid, 11, 8, 3, 2.5, '#186016');
      pixelEllipse(grid, 6, 5, 3.5, 3.5, '#27962a');
      pixelEllipse(grid, 5, 4, 1.5, 1.5, '#31ad33');
    });
  },
  [TILE.ASH](g, x, y, seed, { tileSize: ts }) {
    // Charred ground, passable but scorched
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#141410');
      pixelRect(grid, 0, 0, 16, 1, '#100f0c');
      pixelRect(grid, 0, 0, 1, 16, '#100f0c');
      if (seed % 5 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 2, '#1e1a10');
      if (seed % 7 === 0) pixelRect(grid, (seed % 9) + 4, (seed % 7) + 6, 2, 1, '#1e1a10');
      if (seed % 3 === 0) setPixel(grid, (seed % 12) + 3, (seed % 10) + 9, '#26221a');
      // What is left of the trunk that burned, on some tiles. Ash is where a
      // tree used to be, and nothing in the tile said so.
      if (seed % 4 === 2) {
        const sx = (seed % 8) + 4;
        pixelRect(grid, sx, 9, 2, 4, '#2a2018');
        pixelRect(grid, sx, 9, 2, 1, '#3a2c20');
      }
    });
  },
  // Cover on its way back (sim/regrowth.ts): the TREE tile's silhouette at a
  // third the height, on ground still charred from what burned. Deliberately
  // small and dark — a player has to be able to tell at a glance that this is
  // something they can still walk through and still burn.
  [TILE.SAPLING](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#141410');
      if (seed % 5 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 2, '#1e1a10');
      pixelRect(grid, 7, 11, 2, 4, '#4a3a1e');
      pixelEllipse(grid, 8, 10, 3, 2.5, '#1e7a1e');
      pixelEllipse(grid, 7, 9, 1.5, 1.5, '#27962a');
    });
  },
  [TILE.HUT](g, x, y, _seed, { tileSize: ts }, hutAbove, hutLeft) {
    paintGrid(g, x, y, ts, (grid) => {
      // Ground beneath, then the outer wall, clay and stone
      pixelRect(grid, 0, 0, 16, 16, '#1a2a1a');
      pixelRect(grid, 1, 1, 14, 14, '#b89060');
      // Stone brick rows, 3 mortar lines
      for (let my = 0; my < 3; my++) pixelRect(grid, 1, 4 + my * 4, 14, 1, '#7a5c38');
      // Offset vertical mortar per row, for a brick pattern
      for (let my = 0; my < 4; my++) pixelRect(grid, my % 2 === 0 ? 5 : 9, 1 + my * 4, 1, 4, '#7a5c38');
      // Roof: top row of the hut cluster only, dark terracotta peak
      if (!hutAbove) {
        pixelTriangleUp(grid, 8, 4, 8, 5, '#7a3010');
        pixelRect(grid, 6, 1, 4, 1, '#c06030'); // ridge highlight
      }
      // Door: bottom-left tile of the cluster only, centred
      if (!hutLeft && hutAbove) {
        pixelRect(grid, 5, 7, 6, 9, '#3a1f08');   // door frame
        pixelRect(grid, 6, 8, 4, 8, '#5c3215');   // door fill
        setPixel(grid, 9, 12, '#c8a030');         // knob
      }
      // Small window on the other tiles
      if (hutAbove && hutLeft) {
        pixelRect(grid, 4, 5, 8, 6, '#3a1f08');
        pixelRect(grid, 5, 6, 6, 4, '#7ab8d8');
        pixelRect(grid, 7, 6, 1, 4, '#3a1f08');   // cross pane
        pixelRect(grid, 5, 8, 6, 1, '#3a1f08');
      }
      pixelRect(grid, 0, 0, 16, 1, '#5a3a18');
      pixelRect(grid, 0, 0, 1, 16, '#5a3a18');
    });
  },
};

/**
 * The castle map's own art for the same tile ids. ROCK keeps meaning "blocks
 * shots and movement" and TREE keeps meaning "burns to ash" — only what they
 * look like changes, so none of Terrain's collision or destruction code has
 * to know a theme exists.
 */
export const CASTLE_TILE_PAINTERS: Partial<Record<TileId, TilePainter>> = {
  [TILE.EMPTY](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#3a3a3c');
      pixelRect(grid, 0, 0, 16, 1, '#2c2c2e');
      pixelRect(grid, 0, 0, 1, 16, '#2c2c2e');
      if (seed % 5 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 2, '#333335');
      if (seed % 8 === 0) pixelRect(grid, (seed % 9) + 4, (seed % 7) + 6, 2, 2, '#424244');
      // A hairline crack and the odd chip. Deliberately not the maze's
      // flagstone lattice: the floor is most of what a player sees, so it is
      // most of what tells them at a glance which map they are standing on.
      if (seed % 6 === 2) pixelRect(grid, (seed % 8) + 3, (seed % 10) + 3, 4, 1, '#2e2e30');
      if (seed % 9 === 4) setPixel(grid, (seed % 12) + 2, (seed % 11) + 2, '#48484a');
    });
  },
  // A pillar, not a boulder: a vertical shaft with a capital and a base.
  [TILE.ROCK](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#3a3a3c');
      pixelEllipse(grid, 8, 15, 6, 1.4, 'rgba(0,0,0,0.30)');
      pixelRect(grid, 4, 2, 8, 12, '#6a6a6e');
      // Fluting and a shaded side. A flat shaft reads as a slab, and a hall
      // of slabs has no depth in it at all.
      pixelRect(grid, 5, 3, 1, 10, '#7c7c82');
      pixelRect(grid, 8, 3, 1, 10, '#5a5a5e');
      pixelRect(grid, 10, 3, 2, 10, '#4e4e52');
      pixelRect(grid, 2 + (seed % 2), 1, 12 - (seed % 2), 2, '#84848a');
      pixelRect(grid, 2 + (seed % 2), 13, 12 - (seed % 2), 2, '#84848a');
      // Capital and base each throw a line onto the shaft, so they read as
      // slabs resting on it rather than as more of it
      pixelRect(grid, 4, 3, 8, 1, '#5a5a5e');
      pixelRect(grid, 4, 12, 8, 1, '#5a5a5e');
    });
  },
  // A still, dark pool, not a sunlit pond — flat fill, same as the forest's water.
  [TILE.WATER](g, x, y, _seed, { tileSize: ts }) {
    g.fillStyle = '#0e2a3a'; g.fillRect(x, y, ts, ts);
  },
  // A stacked wooden crate, so "burns to ash" still makes sense here.
  [TILE.TREE](g, x, y, _seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#3a3a3c');
      pixelEllipse(grid, 8, 13, 5, 2, 'rgba(0,0,0,0.30)');
      pixelRect(grid, 3, 4, 10, 8, '#5c4326');
      // Plank courses, a lit lid rim and nail heads at the bracing corners:
      // the diagonals below already say "crate", these say "boards".
      pixelRect(grid, 3, 4, 10, 1, '#7a5a34');
      pixelRect(grid, 3, 7, 10, 1, '#4a351e');
      pixelRect(grid, 3, 11, 10, 1, '#4a351e');
      for (let i = 0; i < 8; i++) {
        setPixel(grid, 3 + i, 4 + i, '#3a2a16');
        setPixel(grid, 12 - i, 4 + i, '#3a2a16');
      }
      for (const [nx, ny] of [[3, 4], [12, 4], [3, 11], [12, 11]] as const) setPixel(grid, nx, ny, '#8a8a90');
    });
  },
  [TILE.ASH](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#242224');
      pixelRect(grid, 0, 0, 16, 1, '#1a1818');
      pixelRect(grid, 0, 0, 1, 16, '#1a1818');
      if (seed % 5 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 2, '#302c2a');
      if (seed % 7 === 0) pixelRect(grid, (seed % 9) + 4, (seed % 7) + 6, 2, 1, '#302c2a');
      // A charred board left in the scorch, the castle's answer to the
      // forest's burnt stump
      if (seed % 4 === 1) pixelRect(grid, (seed % 9) + 3, (seed % 8) + 5, 3, 2, '#3a3634');
    });
  },
  // Half a crate: the garrison restacking what burned. The TREE slot is
  // burnable cover in every theme, so what grows back is whatever that theme
  // makes cover out of, and a castle makes it out of crates.
  [TILE.SAPLING](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#242224');
      if (seed % 5 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 2, '#302c2a');
      pixelRect(grid, 4, 10, 8, 5, '#5c4326');
      for (let i = 0; i < 5; i++) setPixel(grid, 4 + i, 10 + i, '#3a2a16');
    });
  },
  // A shrine, not a hut: same 2x2/neighbour-aware silhouette (peak, archway,
  // sconce in place of roof, door, window), stone instead of clay.
  [TILE.HUT](g, x, y, _seed, { tileSize: ts }, hutAbove, hutLeft) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#3a3a3c');
      pixelRect(grid, 1, 1, 14, 14, '#54545a');
      for (let my = 0; my < 3; my++) pixelRect(grid, 1, 4 + my * 4, 14, 1, '#38383c');
      for (let my = 0; my < 4; my++) pixelRect(grid, my % 2 === 0 ? 5 : 9, 1 + my * 4, 1, 4, '#38383c');
      if (!hutAbove) {
        pixelTriangleUp(grid, 8, 4, 8, 5, '#3a2050');
        pixelRect(grid, 6, 1, 4, 1, '#7a50a8');
      }
      if (!hutLeft && hutAbove) {
        pixelRect(grid, 5, 7, 6, 9, '#181418');
        pixelRect(grid, 6, 8, 4, 8, '#2c2430');
      }
      if (hutAbove && hutLeft) {
        pixelRect(grid, 4, 5, 8, 6, '#181418');
        pixelRect(grid, 5, 6, 6, 4, '#7a50a8');
        pixelRect(grid, 7, 6, 1, 4, '#181418');
        pixelRect(grid, 5, 8, 6, 1, '#181418');
      }
      pixelRect(grid, 0, 0, 16, 1, '#26262a');
      pixelRect(grid, 0, 0, 1, 16, '#26262a');
    });
  },
};

/**
 * The labyrinth: mortared block walls and worn flagstone.
 *
 * Only EMPTY and ROCK are the maze's own art, because `MazeTerrain` emits
 * nothing else and no in-game mutation can introduce a third: blasts turn ROCK
 * straight to EMPTY, and ASH only ever comes from burning a TREE the maze does
 * not have. The castle's stone covers the rest so the table is total if the
 * maze ever grows water or a shrine.
 *
 * A wall fills its tile edge to edge, unlike the castle's pillar. In a maze the
 * wall is the level, and art that reads as an object standing in a room makes
 * a corridor look like a colonnade.
 */
export const MAZE_TILE_PAINTERS: Partial<Record<TileId, TilePainter>> = {
  ...CASTLE_TILE_PAINTERS,
  [TILE.EMPTY](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#2a2622');
      // Flagstone seams on a 8x8 lattice, offset per row so joints stagger.
      const off = (seed % 2) * 8;
      pixelRect(grid, 0, 0, 16, 1, '#211e1a');
      pixelRect(grid, 0, 8, 16, 1, '#211e1a');
      pixelRect(grid, off, 0, 1, 8, '#211e1a');
      pixelRect(grid, (off + 8) % 16, 8, 1, 8, '#211e1a');
      if (seed % 6 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 1, '#332e28');
      if (seed % 9 === 0) setPixel(grid, (seed % 13) + 1, (seed % 12) + 3, '#3c352c');
      // A chipped slab here and there, worn deeper than the grit above it
      if (seed % 7 === 3) pixelRect(grid, (seed % 9) + 3, (seed % 10) + 4, 3, 1, '#241f1a');
    });
  },
  [TILE.ROCK](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#4a443c');
      // Three courses of block, running bond, so a long wall does not tile
      // into obvious vertical stripes.
      for (let course = 0; course < 3; course++) {
        const top = course * 6;
        pixelRect(grid, 0, top, 16, 5, '#5c554a');
        // Every course catches the light on its own top edge, so a wall reads
        // as stacked blocks rather than as one field ruled into squares.
        pixelRect(grid, 0, top, 16, 1, '#655d51');
        pixelRect(grid, 0, top + 5, 16, 1, '#332f29');
        const jog = course % 2 === 0 ? 5 : 11;
        pixelRect(grid, jog, top, 1, 5, '#332f29');
      }
      // Damp catching the light along the top edge, moss in the joints.
      pixelRect(grid, 0, 0, 16, 1, '#6d6558');
      if (seed % 4 === 0) pixelRect(grid, (seed % 12) + 1, (seed % 2) * 6 + 5, 3, 1, '#3f4a30');
    });
  },
};

/**
 * The cavern: wet limestone underfoot, stalagmites for cover, and fungus where
 * the forest has trees.
 *
 * Cold and blue where the castle is a neutral grey and the maze a warm brown,
 * because those three are the only things telling a player at a glance which
 * map they are on. The silhouettes do the rest of that work: ROCK is a cluster
 * of points rather than the castle's flat-topped pillar or the maze's
 * edge-to-edge wall, and it is deliberately smaller than its tile, because a
 * cavern's rock is something you take cover behind rather than the level
 * itself.
 *
 * HUT is the castle's shrine, inherited: `CavernTerrain` emits no huts, and
 * nothing in a run can introduce one, so this row exists only to keep the
 * table total — the same reason and the same borrowing the maze does.
 */
export const CAVERN_TILE_PAINTERS: Partial<Record<TileId, TilePainter>> = {
  ...CASTLE_TILE_PAINTERS,
  [TILE.EMPTY](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#22262e');
      pixelRect(grid, 0, 0, 16, 1, '#1a1e25');
      pixelRect(grid, 0, 0, 1, 16, '#1a1e25');
      // Wet grit, and the odd mineral fleck catching the light.
      if (seed % 4 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 1, '#2b303a');
      if (seed % 7 === 0) pixelRect(grid, (seed % 9) + 4, (seed % 7) + 7, 2, 2, '#282d36');
      if (seed % 9 === 0) setPixel(grid, (seed % 13) + 1, (seed % 12) + 3, '#3a4250');
    });
  },
  // A cluster of stalagmites: three points of differing height, tallest
  // centre-left, so a wall of them reads as broken teeth rather than a fence.
  [TILE.ROCK](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#22262e');
      pixelEllipse(grid, 8, 14, 6, 2, 'rgba(0,0,0,0.35)');
      pixelTriangleUp(grid, 5 + (seed % 2), 14, 4, 9, '#464f60');
      pixelTriangleUp(grid, 11, 14, 3, 6, '#3d4554');
      pixelTriangleUp(grid, 8, 15, 5, 11, '#59637a');
      // Damp highlight down the tall one's lit face.
      pixelRect(grid, 7, 6, 1, 6, '#788197');
      pixelRect(grid, 8, 5, 1, 4, '#8e99b4');
    });
  },
  // A still pool, lit from nowhere. Flat fill; the live overlay does the rest.
  [TILE.WATER](g, x, y, _seed, { tileSize: ts }) {
    g.fillStyle = '#0f3c44'; g.fillRect(x, y, ts, ts);
  },
  // Fungus, so "burns to ash" still means something underground: a pale stalk
  // under a cap that glows the colour the animated palette flickers.
  [TILE.TREE](g, x, y, _seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#22262e');
      pixelEllipse(grid, 8, 14, 5, 2, 'rgba(0,0,0,0.30)');
      pixelRect(grid, 7, 8, 2, 7, '#8f9a86');
      pixelRect(grid, 11, 11, 2, 4, '#8f9a86');
      pixelEllipse(grid, 8, 6, 5, 4, '#2f7d68');
      pixelEllipse(grid, 7, 5, 3, 2.5, '#4fbf9a');
      pixelEllipse(grid, 12, 10, 2.5, 2, '#2f7d68');
    });
  },
  [TILE.ASH](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#191c20');
      pixelRect(grid, 0, 0, 16, 1, '#131518');
      pixelRect(grid, 0, 0, 1, 16, '#131518');
      // Spore dust rather than the forest's charcoal: paler, and it settles.
      if (seed % 5 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 1, '#2a3030');
      if (seed % 7 === 0) setPixel(grid, (seed % 12) + 3, (seed % 10) + 8, '#39433f');
    });
  },
  // A bud, from spores the burn left behind. Dimmer than the grown cluster,
  // and the animated palette's glow does not reach it: only TILE.TREE is on
  // the overlay's flicker list, which is the difference a player reads.
  [TILE.SAPLING](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => {
      pixelRect(grid, 0, 0, 16, 16, '#191c20');
      if (seed % 5 === 0) pixelRect(grid, (seed % 11) + 2, (seed % 9) + 2, 2, 1, '#2a3030');
      pixelRect(grid, 7, 11, 2, 4, '#6d7568');
      pixelEllipse(grid, 8, 10, 3, 2, '#2f7d68');
      pixelEllipse(grid, 7, 9, 1.5, 1.5, '#4fbf9a');
    });
  },
};

/**
 * The siege ground. Thin by comparison with the others because the art itself
 * lives in `bastion-tiles.ts`: painters that take a PixelGrid and a seed and
 * nothing else, so a test can look at what they drew without a canvas. This
 * table is only the mapping from tile id to painter.
 *
 * TILE.HUT is the defence tower. The bastion has exactly two of them, stamped
 * by BastionTerrain at `towerSites`, and they are the reason the hut slot is
 * used rather than a new tile id: a tower is already what a hut is to the
 * renderer — one solid tile with a roof — and a new id would have meant a row
 * in every theme that has no tower in it.
 */
const BASTION_TILE_PAINTERS: Partial<Record<TileId, TilePainter>> = {
  [TILE.EMPTY](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => paintBastionGround(grid, seed));
  },
  [TILE.ROCK](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => paintBastionStone(grid, seed));
  },
  [TILE.HUT](g, x, y, seed, { tileSize: ts }, hutAbove, hutLeft) {
    // A bastion tower is 2x2, so the painter needs to know which quarter of it
    // this tile is. Same two flags the castle's huts assemble on.
    paintGrid(g, x, y, ts, (grid) => paintBastionTower(grid, seed, hutAbove, hutLeft));
  },
  [TILE.TREE](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => paintBastionTree(grid, seed));
  },
  [TILE.ASH](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => paintBastionAsh(grid, seed));
  },
  [TILE.SAPLING](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => paintBastionSapling(grid, seed));
  },
  [TILE.WATER](g, x, y, seed, { tileSize: ts }) {
    paintGrid(g, x, y, ts, (grid) => paintBastionWater(grid, seed));
  },
};

/** Which painter table draws each map's tiles. One row per MapKind. */
export const TILE_THEMES: Record<MapKind, Partial<Record<TileId, TilePainter>>> = {
  forest: TILE_PAINTERS,
  castle: CASTLE_TILE_PAINTERS,
  maze: MAZE_TILE_PAINTERS,
  cavern: CAVERN_TILE_PAINTERS,
  bastion: BASTION_TILE_PAINTERS,
};

/**
 * Offscreen canvas holding the static art of every tile. Repaints only what a
 * TileMap change invalidates. The per-frame cost is a single drawImage.
 */
export class StaticTileLayer {
  readonly canvas: HTMLCanvasElement;
  private map: TileMap;
  private layout: TileLayout;
  private g: CanvasRenderingContext2D | null;
  private painters: Partial<Record<TileId, TilePainter>>;

  constructor(map: TileMap, layout: TileLayout, painters: Partial<Record<TileId, TilePainter>> = TILE_PAINTERS) {
    this.map = map;
    this.layout = layout;
    this.painters = painters;
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.cols * layout.tileSize;
    this.canvas.height = map.rows * layout.tileSize;
    this.g = this.canvas.getContext('2d');
    map.onReset(() => this.repaintAll());
    // Hut art depends on neighbours, so repaint the 3x3 window around a change.
    map.onChange((r, c) => this.repaintWindow(r, c));
  }

  repaintAll(): void {
    for (let r = 0; r < this.map.rows; r++)
      for (let c = 0; c < this.map.cols; c++) this.paintTile(r, c);
  }

  /**
   * Switches which art draws this map's tiles, for a layer built once at
   * startup rather than per match, single player's own tileLayer. A repaint
   * is not optional here: without one the canvas keeps showing the old theme
   * until the next unrelated tile change happens to touch it.
   */
  setPainters(painters: Partial<Record<TileId, TilePainter>>): void {
    this.usePainters(painters);
    this.repaintAll();
  }

  /**
   * The same swap without the repaint, for a caller that is about to cause
   * one anyway. Regenerating a map resets the TileMap right after choosing a
   * theme, and that reset repaints everything; going through setPainters
   * there would paint all 693 tiles twice for one map.
   */
  usePainters(painters: Partial<Record<TileId, TilePainter>>): void {
    this.painters = painters;
  }

  repaintWindow(r: number, c: number): void {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < this.map.rows && nc >= 0 && nc < this.map.cols) this.paintTile(nr, nc);
      }
  }

  paintTile(r: number, c: number): void {
    const g = this.g;
    if (!g) return;
    const ts = this.layout.tileSize, x = c * ts, y = r * ts;
    g.clearRect(x, y, ts, ts);
    const tile = this.map.get(r, c);
    if (tile === undefined) return;
    const painter = this.painters[tile];
    if (!painter) return;
    const hutAbove = r > 0 && this.map.get(r - 1, c) === TILE.HUT;
    const hutLeft = c > 0 && this.map.get(r, c - 1) === TILE.HUT;
    painter(g, x, y, r * 97 + c * 31, this.layout, hutAbove, hutLeft);
  }

  draw(target: CanvasRenderingContext2D): void {
    target.drawImage(this.canvas, 0, this.layout.hudHeight);
  }
}

interface AnimatedTile {
  x: number;
  y: number;
  seed: number;
}

/** The live-animated colours a theme needs: water's two-phase base and its
 * ripple bands, and the tint the TREE tile's slot flickers (a canopy
 * highlight in the forest, embers on a crate elsewhere). Ash keeps one look
 * across themes — charred rubble reads the same regardless of what burned. */
export interface AnimatedPalette {
  waterBase: readonly [string, string];
  waterRipple: readonly [string, string];
  treeFlicker: (alpha: number) => string;
}

const FOREST_PALETTE: AnimatedPalette = {
  waterBase: ['#1a4a8a', '#2356a0'],
  waterRipple: ['#2d62b0', '#1a3e7a'],
  treeFlicker: (a) => `rgba(80,200,80,${a.toFixed(2)})`,
};

const CASTLE_PALETTE: AnimatedPalette = {
  waterBase: ['#0e2a3a', '#123244'],
  waterRipple: ['#1a4256', '#0a1e2a'],
  treeFlicker: (a) => `rgba(200,150,60,${a.toFixed(2)})`,
};

/**
 * Mostly inert today: `MazeTerrain` emits no water and no trees, so nothing
 * here has anything to animate. It exists because the table is total, and
 * because torchlight amber is the right answer if the maze ever gets either.
 */
const MAZE_PALETTE: AnimatedPalette = {
  waterBase: ['#101c22', '#14222a'],
  waterRipple: ['#1c3038', '#0c1418'],
  treeFlicker: (a) => `rgba(220,140,50,${a.toFixed(2)})`,
};

/**
 * Unlike the maze's, this one is live: a cavern generates both pools and
 * fungus. The flicker is the cap's own glow rather than a highlight or an
 * ember, so it is the one theme where the tree slot lights the floor instead
 * of catching light from somewhere else.
 */
const CAVERN_PALETTE: AnimatedPalette = {
  waterBase: ['#0f3c44', '#134a54'],
  waterRipple: ['#1d5f6c', '#0b2e36'],
  treeFlicker: (a) => `rgba(90,220,170,${a.toFixed(2)})`,
};

/**
 * The bastion generates no water at all, so the water entries here can never
 * be reached. They are filled with the earth's own dark rather than left as a
 * copy of another map's blue: if a pool ever does appear on this map it should
 * look like a mistake in the right palette, not like a window onto the forest.
 */
const BASTION_PALETTE_ANIM: AnimatedPalette = {
  waterBase: ['#3c3020', '#4a3b28'],
  waterRipple: ['#5a4832', '#2e2418'],
  treeFlicker: (a) => `rgba(150,120,70,${a.toFixed(2)})`,
};

export const ANIMATED_THEMES: Record<MapKind, AnimatedPalette> = {
  forest: FOREST_PALETTE,
  castle: CASTLE_PALETTE,
  maze: MAZE_PALETTE,
  cavern: CAVERN_PALETTE,
  bastion: BASTION_PALETTE_ANIM,
};

/**
 * Live pass for the few tiles that animate. Keeps flat coordinate lists, so the
 * per-frame loop touches only animated tiles, never the whole grid.
 */
export class AnimatedTileOverlay {
  // Keyed by cell so one changed tile is one delete and one insert. These were
  // arrays rebuilt in full on every change; see the constructor.
  private water = new Map<number, AnimatedTile>();
  private trees = new Map<number, AnimatedTile>();
  private ash = new Map<number, AnimatedTile>();
  private map: TileMap;
  private layout: TileLayout;
  private palette: AnimatedPalette;

  constructor(map: TileMap, layout: TileLayout, palette: AnimatedPalette = FOREST_PALETTE) {
    this.map = map;
    this.layout = layout;
    this.palette = palette;
    map.onReset(() => this.rebuild());
    // Per changed tile, not per change. This was `() => this.rebuild()`, a full
    // rows x cols rescan for every single tile written — and TileMap.set fires
    // the callback once per tile, so a mass terrain event cost changes x area.
    // The boss entrance turns every TREE to ASH in one frame. StaticTileLayer
    // above already takes the coordinates it is handed; this now does too.
    map.onChange((r, c, old, tile) => {
      this.listFor(old)?.delete(this.cellOf(r, c));
      this.seat(r, c, tile);
    });
  }

  rebuild(): void {
    this.water.clear();
    this.trees.clear();
    this.ash.clear();
    for (let r = 0; r < this.map.rows; r++)
      for (let c = 0; c < this.map.cols; c++) this.seat(r, c, this.map.get(r, c));
  }

  /** Stable identity for a cell, so a tile can be found again to remove it. */
  private cellOf(r: number, c: number): number {
    return r * this.map.cols + c;
  }

  /** Which list a tile animates in, or null if it does not animate at all. */
  private listFor(tile: TileId | undefined): Map<number, AnimatedTile> | null {
    if (tile === TILE.WATER) return this.water;
    if (tile === TILE.TREE) return this.trees;
    if (tile === TILE.ASH) return this.ash;
    return null;
  }

  /** Records a cell in the list its tile animates in, if it animates. */
  private seat(r: number, c: number, tile: TileId | undefined): void {
    const list = this.listFor(tile);
    if (!list) return;
    const ts = this.layout.tileSize, hh = this.layout.hudHeight;
    list.set(this.cellOf(r, c), { x: c * ts, y: r * ts + hh, seed: r * 97 + c * 31 });
  }

  /**
   * Switches which colours the live pass animates with. No rebuild needed:
   * draw() reads the palette fresh every call, rebuild() only maintains the
   * water/trees/ash coordinate lists, which do not depend on it.
   */
  setPalette(palette: AnimatedPalette): void {
    this.palette = palette;
  }

  draw(target: CanvasRenderingContext2D, t: number, phase: boolean): void {
    const ts = this.layout.tileSize;
    const [base0, base1] = this.palette.waterBase;
    const [ripple0, ripple1] = this.palette.waterRipple;
    // Water: phase-flipped base plus three ripple bands per tile
    target.fillStyle = phase ? base0 : base1;
    for (const w of this.water.values()) target.fillRect(w.x, w.y, ts, ts);
    target.fillStyle = phase ? ripple0 : ripple1;
    for (const w of this.water.values()) {
      const wp = t * 1.8 + (w.seed % 10) * 0.7;
      target.fillRect(w.x + 4 + Math.round(2*Math.sin(wp)),     w.y + 8  + Math.round(Math.sin(wp*0.7)),    11, 2);
      target.fillRect(w.x + 18 + Math.round(2*Math.sin(wp+1.5)),w.y + 17 + Math.round(Math.sin(wp*0.9+.5)), 8,  2);
      target.fillRect(w.x + 7 + Math.round(2*Math.sin(wp+2.8)), w.y + 23 + Math.round(Math.sin(wp*0.6+1)),  13, 2);
    }
    // Tree slot's flicker: a canopy highlight in the forest, ember glow elsewhere
    for (const tr of this.trees.values()) {
      const tfl = 0.7 + 0.3 * Math.sin(t * 2.5 + tr.seed * 0.8);
      target.fillStyle = this.palette.treeFlicker(tfl * 0.18);
      target.beginPath();
      target.arc(tr.x + 14, tr.y + 10, 5, 0, Math.PI * 2);
      target.fill();
    }
    // Ash embers, slowly fading orange dots
    for (const a of this.ash.values()) {
      const emb = 0.12 + 0.10 * Math.sin(t * 1.5 + a.seed * 0.6);
      target.fillStyle = `rgba(160,60,0,${emb.toFixed(2)})`;
      target.fillRect(a.x + (a.seed % 20) + 4, a.y + (a.seed % 18) + 5, 2, 2);
    }
  }
}

/**
 * The vignette gradient never changes for a fixed-size canvas, so bake it once.
 * The canvas is full size with only the below-HUD region filled, so geometry
 * and blit offset match a direct gradient fill exactly.
 */
export function makeVignette(width: number, height: number, hudHeight: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const g = cv.getContext('2d');
  if (g) {
    // Keyed to the diagonal, not the height. Height alone works only while the
    // arena stays near its shipped 1.47:1 — the outer radius has to reach the
    // side edges, and at 1.84:1 `height * 0.80` stops 150px short of them,
    // leaving a hard black band down each side rather than a fade. The ratios
    // are chosen to reproduce the shipped 1056x720 within a pixel: 255.6 and
    // 575.1 against the 252 and 576 they replace.
    const reach = Math.hypot(width, height);
    const vg = g.createRadialGradient(
      width / 2, height / 2, reach * 0.20,
      width / 2, height / 2, reach * 0.45);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.52)');
    g.fillStyle = vg;
    g.fillRect(0, hudHeight, width, height - hudHeight);
  }
  return cv;
}
