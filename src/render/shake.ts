/**
 * Screen shake. State plus math, no canvas: the caller applies the offset as a
 * translate before drawing the world.
 */
export class ScreenShake {
  private mag = 0;
  private dur = 0;
  private maxDur = 0;

  /** A stronger shake replaces a weaker one. A weaker one is ignored. */
  trigger(mag: number, ms: number): void {
    if (mag > this.mag) {
      this.mag = mag;
      this.dur = ms / 1000;
      this.maxDur = ms / 1000;
    }
  }

  update(dt: number): void {
    if (this.dur > 0) {
      this.dur = Math.max(0, this.dur - dt);
      if (this.dur === 0) this.mag = 0;
    }
  }

  /** Offset in pixels at time t, decaying to zero over the shake duration. */
  offset(t: number): { x: number; y: number } {
    if (this.dur <= 0) return { x: 0, y: 0 };
    const d = this.dur / this.maxDur;
    return { x: Math.sin(t * 90) * this.mag * d, y: Math.cos(t * 75) * this.mag * d };
  }

  get active(): boolean {
    return this.dur > 0;
  }
}
