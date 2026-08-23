import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAP_RULES, type MapKind } from '../sim/arena-map';
import { TILE, TileMap } from '../sim/tilemap';
import {
  ANIMATED_THEMES,
  AnimatedTileOverlay,
  CASTLE_TILE_PAINTERS,
  CAVERN_TILE_PAINTERS,
  StaticTileLayer,
  TILE_PAINTERS,
  TILE_THEMES,
} from './tiles';

/** Every map there is, read off the rules table rather than typed out again. */
const EVERY_MAP = Object.keys(MAP_RULES) as MapKind[];

/** Mirrors entities.test.ts's fake canvas context: logs commands, draws nothing. */
type Entry =
  | { kind: 'call'; name: string; args: readonly unknown[] }
  | { kind: 'set'; name: string; value: unknown };

interface Recorder {
  ctx: CanvasRenderingContext2D;
  log: Entry[];
}

const NO_OP_METHODS = ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'arc', 'ellipse', 'quadraticCurveTo'];

function fakeContext(): Recorder {
  const log: Entry[] = [];
  const target: Record<string, unknown> = {};
  for (const name of NO_OP_METHODS) {
    target[name] = (...args: unknown[]): void => { log.push({ kind: 'call', name, args }); };
  }
  const proxy = new Proxy(target, {
    set(obj, prop, value): boolean {
      if (typeof prop === 'string') log.push({ kind: 'set', name: prop, value });
      return Reflect.set(obj, prop, value);
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, log };
}

const stylesOf = (rec: Recorder): string[] =>
  rec.log.flatMap((e) =>
    e.kind === 'set' && (e.name === 'fillStyle' || e.name === 'strokeStyle') && typeof e.value === 'string'
      ? [e.value]
      : []);

const GENERATABLE_TILES = [TILE.EMPTY, TILE.ROCK, TILE.WATER, TILE.TREE, TILE.ASH, TILE.HUT];

/**
 * Tiles no generator emits but a run can still put on the map. A missing
 * painter here is invisible rather than loud — StaticTileLayer skips a tile it
 * has no painter for — so a sapling with no art is a hole in the ground that
 * blocks nothing and shows nothing.
 */
const GROWN_TILES = [TILE.SAPLING];

describe('TILE_THEMES', () => {
  it("has 'forest' as exactly today's TILE_PAINTERS, so every unthemed caller is unaffected", () => {
    expect(TILE_THEMES.forest).toBe(TILE_PAINTERS);
  });

  // Every tile, every theme, not just the two hand-listed ones: a map whose
  // table is missing a row draws nothing at all where that tile stands, and
  // StaticTileLayer's `if (!painter) return` makes that a silent hole rather
  // than a crash.
  it.each(EVERY_MAP)('gives %s a painter for every tile a map can actually contain', (kind) => {
    for (const tile of [...GENERATABLE_TILES, ...GROWN_TILES]) {
      expect(TILE_THEMES[kind][tile]).toBeTypeOf('function');
    }
  });

  // The stage has to be legible or it is just a slower tree. Every theme draws
  // its sapling as neither the ash it came from nor the tree it becomes.
  it.each(EVERY_MAP)('draws %s\'s sapling as neither its ash nor its tree', (kind) => {
    const paint = (tile: number): string[] => {
      const rec = fakeContext();
      TILE_THEMES[kind][tile as keyof (typeof TILE_THEMES)[typeof kind]]!(
        rec.ctx, 0, 0, 5, { tileSize: 32, hudHeight: 0 }, false, false,
      );
      return stylesOf(rec);
    };
    expect(paint(TILE.SAPLING)).not.toEqual(paint(TILE.ASH));
    expect(paint(TILE.SAPLING)).not.toEqual(paint(TILE.TREE));
  });

  it.each(EVERY_MAP)('gives %s an animated palette to go with those painters', (kind) => {
    const palette = ANIMATED_THEMES[kind];
    expect(palette.waterBase).toHaveLength(2);
    expect(palette.waterRipple).toHaveLength(2);
    expect(palette.treeFlicker(0.5)).toBeTypeOf('string');
  });

  it("draws a rock tile differently between themes, since a pillar isn't a boulder", () => {
    const paintRock = (painters: typeof TILE_PAINTERS): string[] => {
      const rec = fakeContext();
      painters[TILE.ROCK]!(rec.ctx, 0, 0, 1, { tileSize: 32, hudHeight: 0 }, false, false);
      return stylesOf(rec);
    };
    const forest = paintRock(TILE_PAINTERS);
    const castle = paintRock(CASTLE_TILE_PAINTERS);
    const cavern = paintRock(CAVERN_TILE_PAINTERS);
    expect(castle).not.toEqual(forest);
    // The one a spread could get wrong: CAVERN_TILE_PAINTERS starts from the
    // castle's table, so an overridden row that failed to override would
    // compile, run, and draw a pillar in a cave.
    expect(cavern).not.toEqual(castle);
    expect(cavern).not.toEqual(forest);
  });

  it('gives the cavern its own art for everything it can generate, not the castle borrowed', () => {
    const paint = (painters: typeof TILE_PAINTERS, tile: number): string[] => {
      const rec = fakeContext();
      painters[tile as keyof typeof painters]!(
        rec.ctx, 0, 0, 3, { tileSize: 32, hudHeight: 0 }, false, false,
      );
      return stylesOf(rec);
    };
    // What CavernTerrain actually emits. HUT is deliberately the castle's,
    // because a cavern never generates one.
    for (const tile of [TILE.EMPTY, TILE.ROCK, TILE.WATER, TILE.TREE, TILE.ASH]) {
      expect(paint(CAVERN_TILE_PAINTERS, tile), `tile ${tile} still draws the castle's art`)
        .not.toEqual(paint(CASTLE_TILE_PAINTERS, tile));
    }
    expect(paint(CAVERN_TILE_PAINTERS, TILE.HUT)).toEqual(paint(CASTLE_TILE_PAINTERS, TILE.HUT));
  });
});

describe('StaticTileLayer', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement(tag: string): unknown {
          if (tag !== 'canvas') throw new Error(`only canvases, not <${tag}>`);
          return { width: 0, height: 0, getContext: (): CanvasRenderingContext2D => fakeContext().ctx };
        },
      },
    });
  });

  afterAll(() => { Reflect.deleteProperty(globalThis, 'document'); });

  it('defaults to TILE_PAINTERS when no theme is given', () => {
    const map = new TileMap(2, 2);
    expect(() => new StaticTileLayer(map, { tileSize: 32, hudHeight: 0 })).not.toThrow();
  });

  it('accepts a theme explicitly', () => {
    const map = new TileMap(2, 2);
    expect(() => new StaticTileLayer(map, { tileSize: 32, hudHeight: 0 }, CASTLE_TILE_PAINTERS)).not.toThrow();
  });

  it('switches theme and repaints without throwing, for a layer built once at startup', () => {
    const map = new TileMap(2, 2);
    const layer = new StaticTileLayer(map, { tileSize: 32, hudHeight: 0 });
    expect(() => layer.setPainters(CASTLE_TILE_PAINTERS)).not.toThrow();
  });

  it('swaps theme without painting anything, for a caller about to repaint anyway', () => {
    const map = new TileMap(2, 2);
    const rec = fakeContext();
    const layer = new StaticTileLayer(map, { tileSize: 32, hudHeight: 0 });
    Reflect.set(layer, 'g', rec.ctx);
    layer.usePainters(CASTLE_TILE_PAINTERS);
    expect(rec.log).toHaveLength(0);
    // and the swap still took, so the next repaint uses the new art
    layer.repaintAll();
    expect(rec.log.length).toBeGreaterThan(0);
  });

  // A full-map repaint is a game-start cost, so it has a draw-call budget.
  // Painting each cell individually blew this to ~250 per tile and made
  // starting a match visibly slow; runs of one colour go out as one rect.
  it('paints a tile in a bounded number of fills, not one per pixel', () => {
    const map = new TileMap(1, 1);
    const rec = fakeContext();
    const layer = new StaticTileLayer(map, { tileSize: 32, hudHeight: 0 });
    Reflect.set(layer, 'g', rec.ctx);
    map.reset([[TILE.HUT]]); // the busiest tile: bricks, roof, door and window
    const fills = rec.log.filter((e) => e.kind === 'call' && e.name === 'fillRect').length;
    expect(fills).toBeLessThan(80);
  });

  it('paints every tile once per map reset, not once per listener', () => {
    const rows = 4, cols = 4;
    const map = new TileMap(rows, cols);
    const rec = fakeContext();
    const layer = new StaticTileLayer(map, { tileSize: 32, hudHeight: 0 });
    Reflect.set(layer, 'g', rec.ctx);
    // Water is a flat fill: exactly one clearRect and one fillRect per tile,
    // so any extra pass shows up as a clean multiple.
    map.reset(Array.from({ length: rows }, () => Array.from({ length: cols }, () => TILE.WATER)));
    const clears = rec.log.filter((e) => e.kind === 'call' && e.name === 'clearRect').length;
    expect(clears).toBe(rows * cols);
  });
});

describe('AnimatedTileOverlay', () => {
  it('draws with the default palette without throwing', () => {
    const map = new TileMap(2, 2);
    map.set(0, 0, TILE.WATER);
    const overlay = new AnimatedTileOverlay(map, { tileSize: 32, hudHeight: 0 });
    const rec = fakeContext();
    expect(() => overlay.draw(rec.ctx, 0, true)).not.toThrow();
  });

  it('switches palette without throwing, and keeps drawing after', () => {
    const map = new TileMap(2, 2);
    map.set(0, 0, TILE.WATER);
    const overlay = new AnimatedTileOverlay(map, { tileSize: 32, hudHeight: 0 });
    overlay.setPalette(ANIMATED_THEMES.castle);
    const rec = fakeContext();
    expect(() => overlay.draw(rec.ctx, 0, true)).not.toThrow();
  });

  // "Does not throw" would pass just as happily with the palette ignored. The
  // cavern is the theme where that would show: it is the only one whose water
  // and fungus both really generate, so its colours are the ones a player sees.
  it.each(EVERY_MAP)("paints %s's water and tree flicker in that theme's own colours", (kind) => {
    const map = new TileMap(2, 2);
    const overlay = new AnimatedTileOverlay(map, { tileSize: 32, hudHeight: 0 });
    overlay.setPalette(ANIMATED_THEMES[kind]);
    // After the overlay exists, so onChange rebuilds its coordinate lists. Set
    // first and they stay empty, and every assertion below passes for the
    // wrong reason: the water styles are assigned outside the loop that reads
    // them, so an overlay with no water still records them.
    map.set(0, 0, TILE.WATER);
    map.set(1, 1, TILE.TREE);
    const rec = fakeContext();
    overlay.draw(rec.ctx, 0, true);
    const styles = stylesOf(rec);
    expect(styles).toContain(ANIMATED_THEMES[kind].waterBase[0]);
    expect(styles).toContain(ANIMATED_THEMES[kind].waterRipple[0]);
    // The flicker's alpha is driven by the frame phase, so match the colour it
    // is an alpha of rather than pinning a number this test would have to
    // recompute the animation to know.
    const flicker = ANIMATED_THEMES[kind].treeFlicker(0);
    const rgb = flicker.slice(0, flicker.lastIndexOf(',') + 1);
    expect(styles.some((s) => s.startsWith(rgb)), `nothing drew in ${rgb}…)`).toBe(true);
  });
});
