/** Tile grid state. Pure, no DOM; renderers subscribe to change events. */

export const TILE = {
  EMPTY: 0,
  ROCK: 1,
  WATER: 2,
  TREE: 3,
  ASH: 4,
  HUT: 5,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

export type TileGrid = TileId[][];

export type TileChangeListener = (r: number, c: number, oldTile: TileId, newTile: TileId) => void;

export const tilePassable = (t: TileId | undefined): boolean => t === TILE.EMPTY || t === TILE.ASH;

/**
 * Owns the tile grid and is the only mutation path for it. Renderers subscribe
 * to change/reset events so per-tile repaints know exactly what to redraw.
 */
export class TileMap {
  readonly rows: number;
  readonly cols: number;
  grid: TileGrid;
  private changeFns: TileChangeListener[] = [];
  private resetFns: (() => void)[] = [];

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => new Array<TileId>(cols).fill(TILE.EMPTY));
  }

  get(r: number, c: number): TileId | undefined {
    return this.grid[r]?.[c];
  }

  set(r: number, c: number, tile: TileId): void {
    const row = this.grid[r];
    if (row === undefined || c < 0 || c >= this.cols) return;
    const old = row[c];
    if (old === undefined || old === tile) return;
    row[c] = tile;
    for (const fn of this.changeFns) fn(r, c, old, tile);
  }

  reset(grid: TileGrid): void {
    this.grid = grid;
    for (const fn of this.resetFns) fn();
  }

  onChange(fn: TileChangeListener): void {
    this.changeFns.push(fn);
  }

  onReset(fn: () => void): void {
    this.resetFns.push(fn);
  }
}
