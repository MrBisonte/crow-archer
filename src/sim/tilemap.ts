/** Tile grid state. Pure, no DOM; renderers subscribe to change events. */

/**
 * Every tile a map can hold.
 *
 * The names are the forest's, and stay the forest's in every theme: TREE is a
 * stacked crate in the castle and a fungus cluster in the cavern, HUT is a
 * shrine. What a name pins down is the slot's rules — TREE is cover that burns,
 * HUT is cover that does not — and only the art changes per map. Renaming them
 * to something theme-neutral would cost every call site its meaning to buy a
 * word.
 *
 * SAPLING is that slot half grown: what burnt ground becomes on its way back to
 * TREE. See sim/regrowth.ts.
 */
export const TILE = {
  EMPTY: 0,
  ROCK: 1,
  WATER: 2,
  TREE: 3,
  ASH: 4,
  HUT: 5,
  SAPLING: 6,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

export type TileGrid = TileId[][];

export type TileChangeListener = (r: number, c: number, oldTile: TileId, newTile: TileId) => void;

/**
 * Can a body stand here?
 *
 * A sapling is passable, and that is the whole point of it existing rather
 * than ash turning straight back into a tree. Cover coming back is a thing the
 * player should be able to see arriving and walk through — or burn — before it
 * closes the line they were shooting down.
 */
export const tilePassable = (t: TileId | undefined): boolean =>
  t === TILE.EMPTY || t === TILE.ASH || t === TILE.SAPLING;

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
