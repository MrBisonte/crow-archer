import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TILE, TileMap } from '../sim/tilemap';
import {
  ANIMATED_THEMES,
  AnimatedTileOverlay,
  CASTLE_TILE_PAINTERS,
  StaticTileLayer,
  TILE_PAINTERS,
  TILE_THEMES,
} from './tiles';

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

describe('TILE_THEMES', () => {
  it("has 'forest' as exactly today's TILE_PAINTERS, so every unthemed caller is unaffected", () => {
    expect(TILE_THEMES.forest).toBe(TILE_PAINTERS);
  });

  it('gives castle a painter for every tile a map can actually contain', () => {
    for (const tile of GENERATABLE_TILES) {
      expect(TILE_THEMES.castle[tile]).toBeTypeOf('function');
    }
  });

  it("draws a rock tile differently between themes, since a pillar isn't a boulder", () => {
    const forest = fakeContext();
    TILE_PAINTERS[TILE.ROCK]!(forest.ctx, 0, 0, 1, { tileSize: 32, hudHeight: 0 }, false, false);
    const castle = fakeContext();
    CASTLE_TILE_PAINTERS[TILE.ROCK]!(castle.ctx, 0, 0, 1, { tileSize: 32, hudHeight: 0 }, false, false);
    expect(stylesOf(castle)).not.toEqual(stylesOf(forest));
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
});
