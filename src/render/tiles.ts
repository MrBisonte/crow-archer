/**
 * Tile rendering. Static tile art is painted once into an offscreen layer and
 * blitted per frame. Only water, tree flicker, and ash embers draw live on top.
 */

import type { MapKind } from '../sim/arena-map';
import { TILE, type TileId, type TileMap } from '../sim/tilemap';

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
    g.fillStyle = '#1a2a1a'; g.fillRect(x, y, ts, ts);
    // Ground texture: deterministic micro-spots per tile
    if (seed % 7 === 0) { g.fillStyle = '#172517'; g.fillRect(x+(seed%12)+2, y+(seed%11)+2, 4, 4); }
    if (seed % 11 === 0){ g.fillStyle = '#1c2f1c'; g.fillRect(x+(seed%18)+4, y+(seed%15)+3, 3, 3); }
    g.strokeStyle = '#1e2e1e'; g.lineWidth = 0.5; g.strokeRect(x+.5, y+.5, ts-1, ts-1);
  },
  [TILE.ROCK](g, x, y, seed, { tileSize: ts }) {
    g.fillStyle = '#1a2a1a'; g.fillRect(x, y, ts, ts);
    g.fillStyle = '#585858';
    g.beginPath();
    g.moveTo(x+6+(seed%3), y+4); g.lineTo(x+ts-5+(seed%2), y+5+(seed%3));
    g.lineTo(x+ts-4, y+ts-7+(seed%2)); g.lineTo(x+ts-8-(seed%3), y+ts-4);
    g.lineTo(x+5, y+ts-6+(seed%2)); g.lineTo(x+4+(seed%2), y+8);
    g.closePath(); g.fill();
    g.strokeStyle = '#747474'; g.lineWidth = 1; g.stroke();
  },
  [TILE.WATER](g, x, y, _seed, { tileSize: ts }) {
    // Base fill only. The live overlay draws the phase color and ripples.
    g.fillStyle = '#1a4a8a'; g.fillRect(x, y, ts, ts);
  },
  [TILE.TREE](g, x, y, _seed, { tileSize: ts }) {
    g.fillStyle = '#1a2a1a'; g.fillRect(x, y, ts, ts);
    // Shadow ellipse beneath canopy
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.beginPath(); g.ellipse(x+17, y+28, 10, 4, 0, 0, Math.PI*2); g.fill();
    // Trunk
    g.fillStyle = '#5c3317'; g.fillRect(x+13, y+18, 6, 13);
    // Canopy
    g.fillStyle = '#1e7a1e'; g.beginPath(); g.arc(x+16, y+14, 10, 0, Math.PI*2); g.fill();
    g.fillStyle = '#27962a'; g.beginPath(); g.arc(x+12, y+11, 7, 0, Math.PI*2); g.fill();
  },
  [TILE.ASH](g, x, y, seed, { tileSize: ts }) {
    // Charred ground, passable but scorched
    g.fillStyle = '#141410'; g.fillRect(x, y, ts, ts);
    g.fillStyle = '#1e1a10';
    if (seed % 5 === 0) g.fillRect(x+(seed%14)+4, y+(seed%11)+4, 5, 3);
    if (seed % 7 === 0) g.fillRect(x+(seed%18)+2, y+(seed%13)+8, 3, 5);
    if (seed % 3 === 0) g.fillRect(x+(seed%22)+3, y+(seed%9)+12, 4, 2);
    g.strokeStyle = '#0e0e0a'; g.lineWidth = 0.5; g.strokeRect(x+.5, y+.5, ts-1, ts-1);
  },
  [TILE.HUT](g, x, y, _seed, { tileSize: ts }, hutAbove, hutLeft) {
    // Ground beneath
    g.fillStyle = '#1a2a1a'; g.fillRect(x, y, ts, ts);
    // Outer wall, clay and stone
    g.fillStyle = '#b89060';
    g.fillRect(x+1, y+1, ts-2, ts-2);
    // Stone brick rows, 3 mortar lines
    g.strokeStyle = '#7a5c38'; g.lineWidth = 1;
    for (let my = 0; my < 3; my++) {
      const ly = y + 7 + my * 8;
      g.beginPath(); g.moveTo(x+1, ly); g.lineTo(x+ts-1, ly); g.stroke();
    }
    // Offset vertical mortar per row, for a brick pattern
    for (let my = 0; my < 4; my++) {
      const lx = x + (my % 2 === 0 ? 9 : 17);
      const ly0 = y + 1 + my * 8;
      g.beginPath(); g.moveTo(lx, ly0); g.lineTo(lx, ly0 + 8); g.stroke();
    }
    // Roof: top row of the hut cluster only, dark terracotta peak
    if (!hutAbove) {
      g.fillStyle = '#7a3010';
      g.beginPath();
      g.moveTo(x, y+7); g.lineTo(x+ts/2, y); g.lineTo(x+ts, y+7);
      g.closePath(); g.fill();
      // Ridge highlight
      g.strokeStyle = '#c06030'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x+3, y+6); g.lineTo(x+ts/2, y+1); g.lineTo(x+ts-3, y+6); g.stroke();
    }
    // Door: bottom-left tile of the cluster only, centred
    if (!hutLeft && hutAbove) {
      g.fillStyle = '#3a1f08';
      g.fillRect(x+10, y+14, 12, 18);   // door frame
      g.fillStyle = '#5c3215';
      g.fillRect(x+11, y+15, 10, 16);   // door fill
      // Door knob
      g.fillStyle = '#c8a030';
      g.beginPath(); g.arc(x+19, y+23, 1.5, 0, Math.PI*2); g.fill();
    }
    // Small window on the other tiles
    if (hutAbove && hutLeft) {
      g.fillStyle = '#3a1f08';
      g.fillRect(x+8, y+10, 16, 12);
      g.fillStyle = '#7ab8d8';
      g.fillRect(x+9, y+11, 14, 10);
      // Cross pane
      g.strokeStyle = '#3a1f08'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x+16, y+11); g.lineTo(x+16, y+21);
      g.moveTo(x+9,  y+16); g.lineTo(x+23, y+16);
      g.stroke();
    }
    // Border
    g.strokeStyle = '#5a3a18'; g.lineWidth = 1; g.strokeRect(x+.5, y+.5, ts-1, ts-1);
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
    g.fillStyle = '#3a3a3c'; g.fillRect(x, y, ts, ts);
    g.strokeStyle = '#2c2c2e'; g.lineWidth = 1; g.strokeRect(x+.5, y+.5, ts-1, ts-1);
    if (seed % 5 === 0) { g.fillStyle = '#333335'; g.fillRect(x+(seed%14)+3, y+(seed%11)+3, 5, 3); }
    if (seed % 8 === 0) { g.fillStyle = '#424244'; g.fillRect(x+(seed%16)+4, y+(seed%13)+6, 4, 4); }
  },
  // A pillar, not a boulder: a vertical shaft with a capital and a base.
  [TILE.ROCK](g, x, y, seed, { tileSize: ts }) {
    g.fillStyle = '#3a3a3c'; g.fillRect(x, y, ts, ts);
    g.fillStyle = '#6a6a6e'; g.fillRect(x+7, y+3, ts-14, ts-6);
    g.fillStyle = '#84848a';
    g.fillRect(x+4+(seed%2), y+2, ts-8-(seed%2), 4);
    g.fillRect(x+4+(seed%2), y+ts-6, ts-8-(seed%2), 4);
    g.strokeStyle = '#26262a'; g.lineWidth = 1; g.strokeRect(x+7.5, y+3.5, ts-15, ts-7);
  },
  // A still, dark pool, not a sunlit pond.
  [TILE.WATER](g, x, y, _seed, { tileSize: ts }) {
    g.fillStyle = '#0e2a3a'; g.fillRect(x, y, ts, ts);
  },
  // A stacked wooden crate, so "burns to ash" still makes sense here.
  [TILE.TREE](g, x, y, _seed, { tileSize: ts }) {
    g.fillStyle = '#3a3a3c'; g.fillRect(x, y, ts, ts);
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.beginPath(); g.ellipse(x+16, y+27, 10, 4, 0, 0, Math.PI*2); g.fill();
    g.fillStyle = '#5c4326'; g.fillRect(x+6, y+9, ts-12, ts-14);
    g.strokeStyle = '#3a2a16'; g.lineWidth = 1; g.strokeRect(x+6.5, y+9.5, ts-13, ts-15);
    g.beginPath();
    g.moveTo(x+6, y+9); g.lineTo(x+ts-6, y+ts-5);
    g.moveTo(x+ts-6, y+9); g.lineTo(x+6, y+ts-5);
    g.stroke();
  },
  [TILE.ASH](g, x, y, seed, { tileSize: ts }) {
    g.fillStyle = '#242224'; g.fillRect(x, y, ts, ts);
    g.fillStyle = '#302c2a';
    if (seed % 5 === 0) g.fillRect(x+(seed%14)+4, y+(seed%11)+4, 5, 3);
    if (seed % 7 === 0) g.fillRect(x+(seed%18)+2, y+(seed%13)+8, 3, 5);
    if (seed % 3 === 0) g.fillRect(x+(seed%22)+3, y+(seed%9)+12, 4, 2);
    g.strokeStyle = '#1a1818'; g.lineWidth = 0.5; g.strokeRect(x+.5, y+.5, ts-1, ts-1);
  },
  // A shrine, not a hut: same 2x2/neighbour-aware silhouette (peak, archway,
  // sconce in place of roof, door, window), stone instead of clay.
  [TILE.HUT](g, x, y, _seed, { tileSize: ts }, hutAbove, hutLeft) {
    g.fillStyle = '#3a3a3c'; g.fillRect(x, y, ts, ts);
    g.fillStyle = '#54545a'; g.fillRect(x+1, y+1, ts-2, ts-2);
    g.strokeStyle = '#38383c'; g.lineWidth = 1;
    for (let my = 0; my < 3; my++) {
      const ly = y + 7 + my * 8;
      g.beginPath(); g.moveTo(x+1, ly); g.lineTo(x+ts-1, ly); g.stroke();
    }
    for (let my = 0; my < 4; my++) {
      const lx = x + (my % 2 === 0 ? 9 : 17);
      const ly0 = y + 1 + my * 8;
      g.beginPath(); g.moveTo(lx, ly0); g.lineTo(lx, ly0 + 8); g.stroke();
    }
    if (!hutAbove) {
      g.fillStyle = '#3a2050';
      g.beginPath();
      g.moveTo(x, y+7); g.lineTo(x+ts/2, y); g.lineTo(x+ts, y+7);
      g.closePath(); g.fill();
      g.strokeStyle = '#7a50a8'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x+3, y+6); g.lineTo(x+ts/2, y+1); g.lineTo(x+ts-3, y+6); g.stroke();
    }
    if (!hutLeft && hutAbove) {
      g.fillStyle = '#181418'; g.fillRect(x+10, y+14, 12, 18);
      g.fillStyle = '#2c2430'; g.fillRect(x+11, y+15, 10, 16);
    }
    if (hutAbove && hutLeft) {
      g.fillStyle = '#181418'; g.fillRect(x+8, y+10, 16, 12);
      g.fillStyle = '#7a50a8'; g.fillRect(x+9, y+11, 14, 10);
      g.strokeStyle = '#181418'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x+16, y+11); g.lineTo(x+16, y+21);
      g.moveTo(x+9,  y+16); g.lineTo(x+23, y+16);
      g.stroke();
    }
    g.strokeStyle = '#26262a'; g.lineWidth = 1; g.strokeRect(x+.5, y+.5, ts-1, ts-1);
  },
};

/** Which painter table draws each map's tiles. One row per MapKind. */
export const TILE_THEMES: Record<MapKind, Partial<Record<TileId, TilePainter>>> = {
  forest: TILE_PAINTERS,
  castle: CASTLE_TILE_PAINTERS,
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
    this.painters = painters;
    this.repaintAll();
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

export const ANIMATED_THEMES: Record<MapKind, AnimatedPalette> = {
  forest: FOREST_PALETTE,
  castle: CASTLE_PALETTE,
};

/**
 * Live pass for the few tiles that animate. Keeps flat coordinate lists, so the
 * per-frame loop touches only animated tiles, never the whole grid.
 */
export class AnimatedTileOverlay {
  water: AnimatedTile[] = [];
  trees: AnimatedTile[] = [];
  ash: AnimatedTile[] = [];
  private map: TileMap;
  private layout: TileLayout;
  private palette: AnimatedPalette;

  constructor(map: TileMap, layout: TileLayout, palette: AnimatedPalette = FOREST_PALETTE) {
    this.map = map;
    this.layout = layout;
    this.palette = palette;
    map.onReset(() => this.rebuild());
    map.onChange(() => this.rebuild());
  }

  rebuild(): void {
    const ts = this.layout.tileSize, hh = this.layout.hudHeight;
    this.water.length = 0;
    this.trees.length = 0;
    this.ash.length = 0;
    for (let r = 0; r < this.map.rows; r++)
      for (let c = 0; c < this.map.cols; c++) {
        const entry = { x: c * ts, y: r * ts + hh, seed: r * 97 + c * 31 };
        const t = this.map.get(r, c);
        if (t === TILE.WATER) this.water.push(entry);
        else if (t === TILE.TREE) this.trees.push(entry);
        else if (t === TILE.ASH) this.ash.push(entry);
      }
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
    for (const w of this.water) target.fillRect(w.x, w.y, ts, ts);
    target.fillStyle = phase ? ripple0 : ripple1;
    for (const w of this.water) {
      const wp = t * 1.8 + (w.seed % 10) * 0.7;
      target.fillRect(w.x + 4 + Math.round(2*Math.sin(wp)),     w.y + 8  + Math.round(Math.sin(wp*0.7)),    11, 2);
      target.fillRect(w.x + 18 + Math.round(2*Math.sin(wp+1.5)),w.y + 17 + Math.round(Math.sin(wp*0.9+.5)), 8,  2);
      target.fillRect(w.x + 7 + Math.round(2*Math.sin(wp+2.8)), w.y + 23 + Math.round(Math.sin(wp*0.6+1)),  13, 2);
    }
    // Tree slot's flicker: a canopy highlight in the forest, ember glow elsewhere
    for (const tr of this.trees) {
      const tfl = 0.7 + 0.3 * Math.sin(t * 2.5 + tr.seed * 0.8);
      target.fillStyle = this.palette.treeFlicker(tfl * 0.18);
      target.beginPath();
      target.arc(tr.x + 14, tr.y + 10, 5, 0, Math.PI * 2);
      target.fill();
    }
    // Ash embers, slowly fading orange dots
    for (const a of this.ash) {
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
    const vg = g.createRadialGradient(
      width / 2, height / 2, height * 0.35,
      width / 2, height / 2, height * 0.80);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.52)');
    g.fillStyle = vg;
    g.fillRect(0, hudHeight, width, height - hudHeight);
  }
  return cv;
}
