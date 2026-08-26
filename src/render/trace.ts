/**
 * Per-section frame timing and canvas op counting.
 *
 * The frame probe this replaces reported two numbers, UPD and REN, which is
 * enough to know a frame got slower and useless for knowing *where*. Three
 * separate costs live inside REN — the fog repaint, the body draws and the
 * full-screen overlays — and a change to one of them is indistinguishable
 * from a change to another when the only readout is their sum.
 *
 * Two things are measured, because they answer different questions. Elapsed
 * milliseconds say what a section costs on the machine it ran on. Op counts —
 * calls, and the pixel area those calls write — say what it *asked the GPU
 * for*, and unlike a duration they are identical on every machine and in a
 * headless test. That is what makes a regression budget possible at all: a
 * millisecond threshold in CI measures the runner's mood, an op count measures
 * the code.
 *
 * Cost when off is one integer comparison per call, the same gate and the same
 * reasoning as `Logger.record` in `src/sim/log.ts` — the point of both is that
 * they can stay wired into the hot path permanently rather than being added
 * back whenever someone needs a number.
 */

/**
 * The sections the frame is divided into, in the order they run.
 *
 * One list, read by the overlay, the log summary and the budget tests alike,
 * so a section cannot be measured under one name and asserted under another.
 * `sim` is the fixed-step accumulator in `loop()`; the rest are `render()`.
 */
export const SPANS = ['sim', 'tiles', 'fog', 'bodies', 'vignette', 'hud'] as const;

export type SpanName = (typeof SPANS)[number];

/**
 * What is tallied per section, beyond elapsed time.
 *
 * `px` is fill *area*, not a call count: a full-canvas `fillRect` and a
 * one-tile one are both a single call and differ by four orders of magnitude
 * in what they cost, so counting calls alone would have said the overdraw this
 * exists to find was free.
 */
export const COUNTERS = ['fillRect', 'drawImage', 'fill', 'stroke', 'px'] as const;

export type CounterName = (typeof COUNTERS)[number];

export type OpCounters = Record<CounterName, number>;

export function newCounters(): OpCounters {
  return { fillRect: 0, drawImage: 0, fill: 0, stroke: 0, px: 0 };
}

/**
 * How much a tracer does.
 *
 * A level rather than a flag because the two working modes have genuinely
 * different costs, and picking between them is a real decision: `time` reads
 * the clock six times a frame and can run through a whole playtest unnoticed,
 * while `ops` also routes every canvas call through a wrapper and is for
 * verifying a change, not for playing. `off` is the shipped state.
 */
export type TraceLevel = 'off' | 'time' | 'ops';

const LEVEL_ORDER: Record<TraceLevel, number> = { off: 0, time: 1, ops: 2 };

/** One section's cost, averaged over the frames the tracer is holding. */
export interface SpanStats {
  /** Mean milliseconds per frame. */
  readonly ms: number;
  /** The worst single frame, which the mean is built to hide. */
  readonly msMax: number;
  readonly fillRect: number;
  readonly drawImage: number;
  readonly fill: number;
  readonly stroke: number;
  /** Mean pixels of fill area per frame. */
  readonly px: number;
}

/** Metric 0 is milliseconds; metric `1 + i` is `COUNTERS[i]`. */
const METRICS = 1 + COUNTERS.length;

const ZERO_STATS: SpanStats = { ms: 0, msMax: 0, fillRect: 0, drawImage: 0, fill: 0, stroke: 0, px: 0 };

/** Area a draw covers, or 0 for anything not a pair of finite numbers. */
function area(w: unknown, h: unknown): number {
  if (typeof w !== 'number' || typeof h !== 'number') return 0;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 0;
  return Math.abs(w * h);
}

/** The area a `drawImage` writes, across the 3-, 5- and 9-argument forms. */
function drawnArea(args: readonly unknown[]): number {
  if (args.length >= 9) return area(args[7], args[8]);
  if (args.length >= 5) return area(args[3], args[4]);
  const source = args[0];
  if (typeof source !== 'object' || source === null) return 0;
  const { width, height } = source as { width?: unknown; height?: unknown };
  return area(width, height);
}

/**
 * The calls worth counting, and what each one costs.
 *
 * Deliberately not every drawing call the canvas has: these four are what the
 * render pass is actually built out of, and a table that tried to be complete
 * would be a list nobody maintains and a wrapper nobody can afford.
 */
const MEASURED: Record<string, (counts: OpCounters, args: readonly unknown[]) => void> = {
  fillRect(counts, args) {
    counts.fillRect++;
    counts.px += area(args[2], args[3]);
  },
  drawImage(counts, args) {
    counts.drawImage++;
    counts.px += drawnArea(args);
  },
  fill(counts) {
    counts.fill++;
  },
  stroke(counts) {
    counts.stroke++;
  },
};

/**
 * Wraps a canvas context so the calls in `MEASURED` tally into `counts` on
 * their way through.
 *
 * Everything else — the dozens of methods and the mutable style properties the
 * render pass sets thousands of times a frame — passes straight to the real
 * context in both directions, so this is a drop-in for the real thing and not
 * a second, partial implementation of one that would drift from it.
 *
 * Each wrapper is built once and cached, because a method read inside a draw
 * loop would otherwise allocate a closure per call and the measurement would
 * be measuring itself. Only functions are cached: a style property has to be
 * read through every time or the wrapper would report a stale colour.
 *
 * Installed only at the `ops` level. It is genuinely expensive — every
 * property access on the context goes through a proxy trap — and that cost is
 * the reason `time` exists as a separate level.
 */
export function countingContext<T extends object>(target: T, counts: OpCounters): T {
  const wrappers = new Map<string, unknown>();
  return new Proxy(target, {
    get(obj, prop, receiver): unknown {
      if (typeof prop !== 'string') return Reflect.get(obj, prop, receiver);
      const cached = wrappers.get(prop);
      if (cached !== undefined) return cached;
      const value = Reflect.get(obj, prop, obj);
      if (typeof value !== 'function') return value;
      const call = value as (...args: unknown[]) => unknown;
      const measure = MEASURED[prop];
      const wrapped = measure === undefined
        ? (...args: unknown[]): unknown => call.apply(obj, args)
        : (...args: unknown[]): unknown => { measure(counts, args); return call.apply(obj, args); };
      wrappers.set(prop, wrapped);
      return wrapped;
    },
    set(obj, prop, value): boolean {
      return Reflect.set(obj, prop, value);
    },
  });
}

/** One overlay row, and the same text the log summary carries. */
export function formatSpan(name: SpanName, stats: SpanStats): string {
  return [
    name.padEnd(8),
    `${stats.ms.toFixed(2)}ms`.padStart(8),
    `max ${stats.msMax.toFixed(2)}`.padStart(10),
    `${Math.round(stats.fillRect)} fill`.padStart(10),
    `${Math.round(stats.drawImage)} img`.padStart(8),
    `${(stats.px / 1e6).toFixed(2)}Mpx`.padStart(9),
  ].join(' ');
}

export interface FrameTraceOptions {
  /** Injectable so a test states a duration instead of measuring one. */
  readonly clock?: () => number;
  /** Frames held. The mean is over these, so this is the smoothing window. */
  readonly capacity?: number;
}

/**
 * A ring of per-frame, per-section measurements.
 *
 * Frames are written into one flat `Float64Array` indexed
 * `(frame * spans + span) * metrics + metric`, and the live frame accumulates
 * into a second flat array that is cleared rather than reallocated. Nothing
 * here allocates after construction, which is the property that lets it run
 * inside the frame loop without the act of measuring showing up in the
 * measurement. `FovMap` in `src/sim/pathfinding.ts` is laid out the same way
 * and for the same reason.
 *
 * Sections are sequential, not nested: `mark` closes whichever span was open
 * and opens the named one. The render pass is a straight sequence, so a stack
 * would model something that never happens, and a pair of begin/end calls
 * would add a way to get it wrong that this shape does not have.
 */
export class FrameTrace {
  /**
   * Where a wrapped context tallies to. Public because it is the seam: the
   * wrapper writes, this class reads at every span boundary.
   */
  readonly counters: OpCounters = newCounters();

  private readonly clock: () => number;
  private readonly capacity: number;
  private readonly ring: Float64Array;
  private readonly live: Float64Array;
  private readonly openCounts: OpCounters = newCounters();

  private traceLevel: TraceLevel = 'off';
  private head = 0;
  private held = 0;
  private inFrame = false;
  /** Index into `SPANS` of the open section, or -1 when none is. */
  private open = -1;
  private openedAt = 0;

  constructor(opts: FrameTraceOptions = {}) {
    this.clock = opts.clock ?? (() => performance.now());
    this.capacity = Math.max(1, Math.floor(opts.capacity ?? 120));
    this.ring = new Float64Array(this.capacity * SPANS.length * METRICS);
    this.live = new Float64Array(SPANS.length * METRICS);
  }

  setLevel(level: TraceLevel): void {
    this.traceLevel = level;
    this.inFrame = false;
    this.open = -1;
  }

  level(): TraceLevel {
    return this.traceLevel;
  }

  /** Frames currently held, which is what `summary()` averages over. */
  frames(): number {
    return this.held;
  }

  beginFrame(): void {
    if (this.traceLevel === 'off') return;
    this.live.fill(0);
    this.inFrame = true;
    this.open = -1;
  }

  /**
   * Closes the open section and opens `name`.
   *
   * A mark outside a frame is ignored rather than throwing: this runs six
   * times a frame in a loop that must not be able to take the game down, and
   * a lost measurement is the right failure for a diagnostic.
   *
   * `inFrame` is the whole gate, and it is also the level gate: `beginFrame`
   * refuses to set it while off and `setLevel` clears it, so an off tracer
   * cannot be inside a frame. Testing the level again here would be a second
   * comparison buying nothing.
   */
  mark(name: SpanName): void {
    if (!this.inFrame) return;
    this.closeOpen();
    this.open = SPANS.indexOf(name);
    this.openedAt = this.clock();
    if (this.traceLevel === 'ops') this.snapshotCounters();
  }

  /** Closes the frame and files it. A frame never ended is simply not filed. */
  endFrame(): void {
    if (!this.inFrame) return;
    this.closeOpen();
    this.ring.set(this.live, this.head * SPANS.length * METRICS);
    this.head = (this.head + 1) % this.capacity;
    if (this.held < this.capacity) this.held++;
    this.inFrame = false;
  }

  reset(): void {
    this.ring.fill(0);
    this.live.fill(0);
    this.head = 0;
    this.held = 0;
    this.inFrame = false;
    this.open = -1;
  }

  /** Every section's mean cost over the held frames, zeroed where unmeasured. */
  summary(): Record<SpanName, SpanStats> {
    const out = {} as Record<SpanName, SpanStats>;
    for (let s = 0; s < SPANS.length; s++) {
      const name = SPANS[s] as SpanName;
      if (this.held === 0) { out[name] = ZERO_STATS; continue; }
      let msMax = 0;
      const totals = new Float64Array(METRICS);
      for (let f = 0; f < this.held; f++) {
        const base = (f * SPANS.length + s) * METRICS;
        for (let m = 0; m < METRICS; m++) totals[m] = (totals[m] ?? 0) + (this.ring[base + m] ?? 0);
        const ms = this.ring[base] ?? 0;
        if (ms > msMax) msMax = ms;
      }
      const mean = (m: number): number => (totals[m] ?? 0) / this.held;
      out[name] = {
        ms: mean(0),
        msMax,
        fillRect: mean(1),
        drawImage: mean(2),
        fill: mean(3),
        stroke: mean(4),
        px: mean(5),
      };
    }
    return out;
  }

  /** Every row as text, for the log summary and for a headless dump. */
  lines(): string[] {
    const summary = this.summary();
    return SPANS.map((name) => formatSpan(name, summary[name]));
  }

  private snapshotCounters(): void {
    for (const key of COUNTERS) this.openCounts[key] = this.counters[key];
  }

  private closeOpen(): void {
    const s = this.open;
    if (s < 0) return;
    const base = s * METRICS;
    this.live[base] = (this.live[base] ?? 0) + (this.clock() - this.openedAt);
    if (this.traceLevel === 'ops') {
      for (let i = 0; i < COUNTERS.length; i++) {
        const key = COUNTERS[i] as CounterName;
        const slot = base + 1 + i;
        this.live[slot] = (this.live[slot] ?? 0) + (this.counters[key] - this.openCounts[key]);
      }
    }
    this.open = -1;
  }
}

/**
 * The one instance the game marks into, exported the way `log` and `stamps`
 * are: a single shared recorder, imported where it is needed rather than
 * threaded through every call site that wants to be measured.
 */
export const trace = new FrameTrace();

/** Whether `level` does at least as much as `least`. */
export function tracing(level: TraceLevel, least: TraceLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[least];
}
