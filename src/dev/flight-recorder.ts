/**
 * The flight recorder: ships the diagnostic log off the page while a human
 * plays, so a freeze arrives as a timestamped JSONL trail instead of a memory.
 *
 * Three pieces, one per way a game can stop:
 *
 * - A once-per-second beat POSTs the run's vitals (`devHooks.pulse()`) plus
 *   everything `log` (src/sim/log.ts) recorded since the last beat to the dev
 *   server's `/__flight` sink (src/dev/flight-sink.ts). If the beats stop with
 *   no goodbye, the main thread hung: the server-side gap IS the freeze
 *   timestamp, and the last beat's trace summary says which frame section to
 *   suspect. The page cannot diagnose a hard hang from inside — it runs no
 *   code — so that one is the sink's to catch.
 * - A watchdog compares the game's own frame clock against this module's
 *   independent requestAnimationFrame counter; `classify` below is the whole
 *   decision table. Its two alarms flush immediately with
 *   `movementBlockers()` attached, so a stuck run names its captor.
 * - `error` / `unhandledrejection` listeners flush immediately, stack attached.
 *
 * Dev-only: main.js imports this dynamically behind `import.meta.env.DEV`, so
 * the release build carries none of it; `?rec=0` opts a dev session out.
 * It reads the game through `window.__game` rather than importing game.js —
 * the recorder observes the page a player has, it is not part of the sim.
 */

import { log } from '../sim/log';
import type { LogEvent } from '../sim/log';

import { FLIGHT_PATH } from './flight-path';

/** What `devHooks.pulse()` answers once a beat: the run's vitals in one read. */
export interface Pulse {
  readonly state: string;
  readonly mode: string;
  readonly map: string;
  readonly char: string;
  /** Sim seconds; owes progress only in the states `classify` watches. */
  readonly t: number;
  /** The loop's own frame clock, ms. Stalled = loop() has stopped arriving. */
  readonly lastTs: number;
  /** False while a harness drives the clock (devHooks.takeClock). */
  readonly live: boolean;
  /** Hitstop frames still owed — context for the reader of an alarm, not a
   * `classify` input: the streak threshold is the hitstop filter. */
  readonly held: number;
  readonly hp: number;
  readonly kills: number;
  readonly crows: number;
  readonly skels: number;
  readonly soldiers: number;
  readonly arrows: number;
  readonly boss: string | null;
}

/** The stops the page can diagnose from inside. */
export type AlarmClass = 'loop-dead' | 'logic-freeze' | 'no-frames';

/** The states in which sim time owes progress (`gameTime += dt` branches). */
const RUNNING_STATES: readonly string[] = ['playing', 'boss_fight'];

/**
 * One watchdog sample against the previous one.
 *
 * 'loop-dead' says the game's frame clock stalled while this module's own
 * requestAnimationFrame kept ticking — the browser is still animating, so the
 * loop itself died (an exception unhooked it). 'no-frames' says nothing
 * animates at all while the tab still claims visible: not the loop's fault,
 * but exactly what a player calls a freeze, so it gets a line rather than
 * silence — an embedded or throttled view (the hidden Browser-pane trap)
 * looks like this. 'logic-freeze' says frames arrive but sim time is stuck during
 * a run with no state change to excuse it. Hitstop looks exactly like that
 * for a sample or two, deliberately: the caller's streak threshold outlasts
 * anything the hitstop ladder can owe, so a held world never alarms — and a
 * world held *forever* still does, which an exemption here would hide.
 *
 * Pure so the table is testable; the caller owns streaks and thresholds.
 */
export function classify(
  prev: Pulse | null,
  cur: Pulse,
  rafTicked: boolean,
  visible: boolean,
): AlarmClass | null {
  if (prev === null || !visible || !cur.live || !prev.live) return null;
  if (cur.lastTs === prev.lastTs) return rafTicked ? 'loop-dead' : 'no-frames';
  if (RUNNING_STATES.includes(cur.state) && cur.state === prev.state && cur.t === prev.t) {
    return 'logic-freeze';
  }
  return null;
}

/** What the recorder needs of `window.__game`; game.js owns the real thing. */
interface GameHooks {
  pulse(): Pulse;
  movementBlockers(): Record<string, unknown>;
  trace(): { level: string; frames: number; spans: Record<string, unknown> };
  setTrace(level: string): string;
}

const BEAT_MS = 1000;
const WATCH_MS = 500;
/** Consecutive suspicious samples before each alarm raises. A dead loop is
 * certain fast; a quiet second of sim time has innocent look-alikes (a long
 * hitstop tail, a modal about to open), so it gets two; a whole page not
 * animating has the most (window occlusion, a dragged tab), so it gets five. */
const ALARM_AFTER: Record<AlarmClass, number> = {
  'loop-dead': 2, 'logic-freeze': 4, 'no-frames': 10,
};
const ALARM_KINDS: readonly AlarmClass[] = ['loop-dead', 'logic-freeze', 'no-frames'];
/** A beat carries at most this many log events; the rest become a count. */
const MAX_EVENTS_PER_BEAT = 400;
/** After this many straight send failures the sink is gone; stop asking. */
const MAX_SEND_FAILURES = 5;

let started = false;
let hooks: GameHooks | null = null;
let lastEventId = 0;
let rafCount = 0;
let rafSeen = 0;
let failures = 0;
let lastSample: Pulse | null = null;
const streaks: Record<AlarmClass, number> = {
  'loop-dead': 0, 'logic-freeze': 0, 'no-frames': 0,
};

/** Everything `log` holds that has not been shipped yet, watermarked by id. */
function drain(): readonly LogEvent[] {
  const fresh = log.events().filter((e) => e.id > lastEventId);
  const last = fresh[fresh.length - 1];
  if (last !== undefined) lastEventId = last.id;
  return fresh;
}

function send(payload: Record<string, unknown>, urgent = false): void {
  if (failures >= MAX_SEND_FAILURES) return;
  const body = JSON.stringify(payload);
  // sendBeacon survives a closing page, which is what `urgent` means here.
  if (urgent && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(FLIGHT_PATH, body)) return;
  void fetch(FLIGHT_PATH, { method: 'POST', body, keepalive: urgent })
    .then((r) => { failures = r.ok ? 0 : failures + 1; })
    .catch(() => { failures += 1; });
}

/** Lazy because boot() assigns `window.__game` and import order is not a
 * contract; the first sighting also turns the tracer and the log floor up to
 * what a monitored session needs. */
function gameHooks(): GameHooks | null {
  if (hooks !== null) return hooks;
  const g = (window as Window & { __game?: unknown }).__game;
  if (g !== null && typeof g === 'object' && typeof (g as GameHooks).pulse === 'function') {
    hooks = g as GameHooks;
    if (hooks.trace().level === 'off') hooks.setTrace('time');
    log.info('recorder', 'flight recorder on', { beatMs: BEAT_MS, watchMs: WATCH_MS });
  }
  return hooks;
}

function raise(kind: AlarmClass, cur: Pulse, h: GameHooks): void {
  log.error('recorder', `${kind} after ${ALARM_AFTER[kind] * WATCH_MS}ms`, kind);
  send({
    kind: 'alarm', class: kind, wall: Date.now(), perf: Math.round(performance.now()),
    pulse: cur, blockers: h.movementBlockers(), trace: h.trace(), events: drain(),
  }, true);
}

function watch(): void {
  const h = gameHooks();
  if (h === null) return;
  const cur = h.pulse();
  const ticked = rafCount > rafSeen;
  rafSeen = rafCount;
  const alarm = classify(lastSample, cur, ticked, document.visibilityState === 'visible');
  lastSample = cur;
  for (const kind of ALARM_KINDS) {
    if (alarm !== kind) { streaks[kind] = 0; continue; }
    streaks[kind] += 1;
    // Fires once at the threshold, not every sample after it; the streak
    // resets when the condition clears, which re-arms the alarm.
    if (streaks[kind] === ALARM_AFTER[kind]) raise(kind, cur, h);
  }
}

function beat(): void {
  const h = gameHooks();
  const fresh = drain();
  const dropped = Math.max(0, fresh.length - MAX_EVENTS_PER_BEAT);
  send({
    kind: 'beat', wall: Date.now(), perf: Math.round(performance.now()),
    raf: rafCount, vis: document.visibilityState,
    pulse: h === null ? null : h.pulse(),
    events: dropped > 0 ? fresh.slice(-MAX_EVENTS_PER_BEAT) : fresh,
    ...(dropped > 0 ? { dropped } : {}),
  });
}

function installErrorHooks(): void {
  window.addEventListener('error', (e) => {
    log.error('window', String(e.message), 'uncaught', { file: e.filename, line: e.lineno });
    send({
      kind: 'err', wall: Date.now(), msg: String(e.message),
      stack: e.error instanceof Error ? e.error.stack : undefined, events: drain(),
    }, true);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
    log.error('window', reason.message, 'unhandled-rejection');
    send({
      kind: 'err', wall: Date.now(), msg: reason.message, stack: reason.stack,
      events: drain(),
    }, true);
  });
}

export function startFlightRecorder(): void {
  if (started) return;
  started = true;
  installErrorHooks();
  // Debug is the floor a human testing session wants — src/sim/log.ts says so
  // — and it is what makes the per-second trace summary and the EventBus feed
  // start landing in the ring this module drains.
  log.setLevel('debug');
  document.addEventListener('visibilitychange', () => {
    log.info('recorder', `tab ${document.visibilityState}`);
  });
  // A goodbye separates "closed the tab" from "the tab died": a hang sends
  // nothing, so a log that ends without one ended the bad way.
  window.addEventListener('pagehide', () => {
    send({ kind: 'bye', wall: Date.now(), events: drain().slice(-100) }, true);
  });
  const tick = (): void => { rafCount += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setInterval(watch, WATCH_MS);
  setInterval(beat, BEAT_MS);
  send({
    kind: 'hello', wall: Date.now(), href: location.href,
    ua: navigator.userAgent, dpr: devicePixelRatio,
  });
}
