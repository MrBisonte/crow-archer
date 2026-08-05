/**
 * Pre-rendered sprites for glowing primitives. Painting happens once per key.
 * At runtime a stamp costs one drawImage instead of a shadowBlur raster pass
 * per draw, which is what made dense particle frames stall.
 */

type StampPainter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export class StampCache {
  private map = new Map<string, HTMLCanvasElement>();

  get(key: string, w: number, h: number, painter: StampPainter): HTMLCanvasElement {
    let s = this.map.get(key);
    if (!s) {
      s = document.createElement('canvas');
      s.width = Math.ceil(w);
      s.height = Math.ceil(h);
      const g = s.getContext('2d');
      if (g) painter(g, s.width, s.height);
      this.map.set(key, s);
    }
    return s;
  }

  get size(): number {
    return this.map.size;
  }
}

export const stamps = new StampCache();

/**
 * Radius is quantized to 0.25 px and blur to 1 px, so shrinking particles
 * reuse stamps and the cache stays bounded.
 */
export function glowDotStamp(color: string, r: number, blur: number): HTMLCanvasElement {
  const rq = Math.max(0.25, Math.round(r * 4) / 4);
  const bq = Math.max(1, Math.round(blur));
  const size = (rq + bq * 2 + 2) * 2;
  return stamps.get(`dot|${color}|${rq}|${bq}`, size, size, (g, w, h) => {
    g.shadowColor = color;
    g.shadowBlur = bq;
    g.fillStyle = color;
    g.beginPath();
    g.arc(w / 2, h / 2, rq, 0, Math.PI * 2);
    g.fill();
  });
}

export function glowRectStamp(
  color: string,
  rw: number,
  rh: number,
  blur: number,
): HTMLCanvasElement {
  const bq = Math.max(1, Math.round(blur));
  const pad = bq * 2 + 2;
  return stamps.get(`rect|${color}|${rw}x${rh}|${bq}`, rw + pad * 2, rh + pad * 2, (g, w, h) => {
    g.shadowColor = color;
    g.shadowBlur = bq;
    g.fillStyle = color;
    g.fillRect((w - rw) / 2, (h - rh) / 2, rw, rh);
  });
}
