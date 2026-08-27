/**
 * Draws a talent's sigil onto a canvas.
 *
 * Split from the path data it draws for the reason `wizard-staff.ts` and the
 * rest of the FX modules are split from `game.js`: the shapes are data with no
 * opinion about a canvas, and this is the twenty lines that need one.
 *
 * The paths are cached as `Path2D` on first use rather than at module load,
 * because the headless tests import this file into an environment that has no
 * `Path2D` at all and never draws a frame. A game that has drawn one sigil has
 * built every path it will ever need for it.
 */

import { SIGILS, SIGIL_GRID, SIGIL_STROKE, type SigilPart } from './talent-sigils';

/** A sigil's paths, built once and kept. */
const _cache = new Map<string, Path2D[]>();

function pathsFor(id: string, parts: readonly SigilPart[]): Path2D[] {
  let built = _cache.get(id);
  if (built === undefined) {
    built = parts.map((p) => new Path2D(p.d));
    _cache.set(id, built);
  }
  return built;
}

/** How the caller wants a sigil drawn. */
export interface SigilPaint {
  /** Centre, in canvas pixels. */
  readonly x: number;
  readonly y: number;
  /** Width and height on screen, in canvas pixels. */
  readonly size: number;
  readonly color: string;
  /** Blur behind it, for the picked panel. Zero draws flat. */
  readonly glow?: number;
}

/**
 * Paints `id` centred on `(x, y)`.
 *
 * Unknown ids draw nothing rather than throwing: the chooser's own load check
 * already refuses a talent with no presentation row, so reaching here with a
 * stranger means something upstream is already wrong and a crash mid-frame
 * would only bury it.
 */
export function paintTalentSigil(
  ctx: CanvasRenderingContext2D, id: string, opts: SigilPaint,
): void {
  const parts = SIGILS[id];
  if (parts === undefined) return;
  const paths = pathsFor(id, parts);
  const scale = opts.size / SIGIL_GRID;

  ctx.save();
  ctx.translate(opts.x - opts.size / 2, opts.y - opts.size / 2);
  ctx.scale(scale, scale);
  // Divided by the scale so the stroke lands at SIGIL_STROKE pixels whatever
  // the size — the canvas equivalent of the sheets' non-scaling-stroke, and
  // the reason a 38 px sigil reads as the same drawing as a 76 px one rather
  // than as a thinner version of it.
  ctx.lineWidth = SIGIL_STROKE / scale;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;
  if (opts.glow) { ctx.shadowColor = opts.color; ctx.shadowBlur = opts.glow; }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    ctx.globalAlpha = part.alpha ?? 1;
    ctx.setLineDash(part.dash === true ? [2.4 / scale, 2 / scale] : []);
    if (part.fill === true) ctx.fill(paths[i]!);
    else ctx.stroke(paths[i]!);
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.restore();
}
