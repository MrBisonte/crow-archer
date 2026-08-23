/**
 * Structured, leveled diagnostic logging for human testing sessions.
 *
 * Distinct from `EventBus`/`GameEvent` (`src/sim/events.ts`): that system
 * states gameplay facts for the render/audio layer to react to, a closed
 * set of variants, kept for exactly as long as one `emit()` call takes to
 * fan out. This one is an open, freeform diagnostic stream for the question
 * that matters after a bug report: what happened, in what order, right
 * before this went wrong. `attachToEvents` below folds every gameplay event
 * into this stream too, so nothing needs a second call at every `emit()`
 * site to also get logged — reuse where the shapes actually match, rather
 * than a second parallel mechanism.
 *
 * Performance is the reason for the level gate: `record()` returns before
 * building the event object at all when the call is below the current
 * level, so a disabled `debug()` costs one integer comparison, not an
 * allocation. That is the whole answer to running this on a human's machine
 * during a real playtest rather than only in CI.
 */

import type { EventBus, GameEvent } from './events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEvent {
  /** Unique within this logger's lifetime, in emission order. Lets a
   * report say "show me everything from #482 on" without a timestamp
   * collision ever being a concern. */
  readonly id: number;
  readonly level: LogLevel;
  /** `clock()` at record time — `Date.now()` by default, wall-clock so it
   * lines up with when a human says something went wrong. */
  readonly timestamp: number;
  /** The caller's own name for itself — `'transitionTo'`, `'updatePlayer'`
   * — passed explicitly rather than read off a stack trace. A trace is
   * slower to capture on every call and unreadable once this project's
   * single-file build has minified it; a literal string the call site
   * already knows is neither. */
  readonly source: string;
  readonly message: string;
  /** Set only on `error()` — a short, machine-checkable tag, the same
   * category+message+hint shape this project's error convention already
   * asks for elsewhere. */
  readonly code?: string;
  /** Whatever structured context helps reconstruct the moment: a position,
   * a map kind, the gameplay event that triggered this. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface LoggerOptions {
  /** Bounds memory: the oldest event drops once this many are held. */
  readonly capacity?: number;
  /** Injectable so tests don't depend on wall-clock time. */
  readonly clock?: () => number;
  /** Mirrors to `console` at/above this level; `'silent'` mirrors nothing.
   * Independent of the ring buffer, which always keeps everything at or
   * above the logger's own level regardless of what reaches the console. */
  readonly consoleLevel?: LogLevel | 'silent';
}

/**
 * One diagnostic log. A class because there is exactly one useful instance
 * and nothing about it varies by a kind tag the way a character or a map
 * does — see `docs/design-patterns.md`'s note on `boss.kind` for the same
 * judgment call made explicit: a table earns its keep when new rows are
 * mostly data, and a logger has no rows, only one shared ring buffer.
 * Mirrors `StampCache`/`stamps` in `src/render/stamps.ts` for the same
 * reason: a single caching/recording instance, exported once, imported
 * wherever it's needed, rather than reconstructed per call site.
 */
export class Logger {
  private readonly capacity: number;
  private readonly clock: () => number;
  private consoleLevel: LogLevel | 'silent';
  private level: LogLevel = 'warn';
  private nextId = 1;
  private readonly ring: LogEvent[] = [];

  constructor(opts: LoggerOptions = {}) {
    this.capacity = opts.capacity ?? 500;
    this.clock = opts.clock ?? Date.now;
    this.consoleLevel = opts.consoleLevel ?? 'warn';
  }

  /** The floor: calls below this level are not recorded at all. Raise it
   * to `'debug'` for a human testing session, lower it back to `'warn'` or
   * above for real play. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setConsoleLevel(level: LogLevel | 'silent'): void {
    this.consoleLevel = level;
  }

  currentLevel(): LogLevel {
    return this.level;
  }

  debug(source: string, message: string, data?: Record<string, unknown>): void {
    this.record('debug', source, message, undefined, data);
  }

  info(source: string, message: string, data?: Record<string, unknown>): void {
    this.record('info', source, message, undefined, data);
  }

  warn(source: string, message: string, data?: Record<string, unknown>): void {
    this.record('warn', source, message, undefined, data);
  }

  /** `code` is a short tag, not a sentence — `'map-gen-disconnected'`, not
   * a restatement of `message`. Optional because not every error rises to
   * one worth a stable, greppable name yet. */
  error(source: string, message: string, code?: string, data?: Record<string, unknown>): void {
    this.record('error', source, message, code, data);
  }

  private record(
    level: LogLevel,
    source: string,
    message: string,
    code: string | undefined,
    data: Record<string, unknown> | undefined,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const event: LogEvent = { id: this.nextId++, level, timestamp: this.clock(), source, message, code, data };
    this.ring.push(event);
    if (this.ring.length > this.capacity) this.ring.shift();
    if (this.consoleLevel !== 'silent' && LEVEL_ORDER[level] >= LEVEL_ORDER[this.consoleLevel]) {
      const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      sink(`[${source}] ${message}`, data ?? '');
    }
  }

  /** Everything currently held, oldest first. A copy: a caller iterating
   * this cannot have it change length under them mid-loop from a `record()`
   * that fires from inside their own iteration. */
  events(): readonly LogEvent[] {
    return [...this.ring];
  }

  clear(): void {
    this.ring.length = 0;
    this.nextId = 1;
  }
}

/** The one shared instance every call site imports, the same shape as
 * `stamps` in `src/render/stamps.ts`. */
export const log = new Logger();

/**
 * Subscribes a logger to a gameplay event bus, recording every event as a
 * debug-level entry tagged `'EventBus'`. Returns the unsubscribe function
 * `EventBus.on()` itself returns, so the caller can undo this the same way
 * it would undo any other subscription.
 */
export function attachToEvents(target: Logger, bus: EventBus): () => void {
  return bus.on((e: GameEvent) => {
    const { type, ...data } = e;
    target.debug('EventBus', type, data as Record<string, unknown>);
  });
}
