/**
 * Tile rendering. Static tile art is painted once into an offscreen layer and
 * blitted per frame. Only water, tree flicker, and ash embers draw live on top.
 */

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
 * Offscreen canvas holding the static art of every tile. Repaints only what a
 * TileMap change invalidates. The per-frame cost is a single drawImage.
 */
export class StaticTileLayer {
  readonly canvas: HTMLCanvasElement;
  private map: TileMap;
  private layout: TileLayout;
  private g: CanvasRenderingContext2D | null;

  constructor(map: TileMap, layout: TileLayout) {
    this.map = map;
    this.layout = layout;
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
    const painter = TILE_PAINTERS[tile];
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

  constructor(map: TileMap, layout: TileLayout) {
    this.map = map;
    this.layout = layout;
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

  draw(target: CanvasRenderingContext2D, t: number, phase: boolean): void {
    const ts = this.layout.tileSize;
    // Water: phase-flipped base plus three ripple bands per tile
    target.fillStyle = phase ? '#1a4a8a' : '#2356a0';
    for (const w of this.water) target.fillRect(w.x, w.y, ts, ts);
    target.fillStyle = phase ? '#2d62b0' : '#1a3e7a';
    for (const w of this.water) {
      const wp = t * 1.8 + (w.seed % 10) * 0.7;
      target.fillRect(w.x + 4 + Math.round(2*Math.sin(wp)),     w.y + 8  + Math.round(Math.sin(wp*0.7)),    11, 2);
      target.fillRect(w.x + 18 + Math.round(2*Math.sin(wp+1.5)),w.y + 17 + Math.round(Math.sin(wp*0.9+.5)), 8,  2);
      target.fillRect(w.x + 7 + Math.round(2*Math.sin(wp+2.8)), w.y + 23 + Math.round(Math.sin(wp*0.6+1)),  13, 2);
    }
    // Tree canopy highlight flicker
    for (const tr of this.trees) {
      const tfl = 0.7 + 0.3 * Math.sin(t * 2.5 + tr.seed * 0.8);
      target.fillStyle = `rgba(80,200,80,${(tfl * 0.18).toFixed(2)})`;
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
