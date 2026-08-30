// Follows the newest flight-recorder log and prints one line per thing worth
// a human's (or a monitoring agent's) attention: alarms, uncaught errors,
// page hellos and goodbyes, state transitions — and a HANG line of its own
// when the beats stop mid-run, which is the one failure the page cannot
// report because it is no longer running code. Beats themselves stay silent,
// so the output volume is "events", not "telemetry".
//
// Usage: node scripts/flight-watch.mjs [logDir]   (default: _flightlogs)
// Pairs with src/dev/flight-sink.ts, which writes what this reads.

import { openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const POLL_MS = 500;
/** Beats come every second; this much silence mid-run is a hang. */
const HANG_AFTER_MS = 3500;
const RUNNING_STATES = ['playing', 'boss_fight'];

const dir = process.argv[2] ?? '_flightlogs';

let file = null;
let offset = 0;
let partial = '';
let lastBeatAt = 0;      // wall clock when the last beat ARRIVED here
let lastState = null;    // pulse.state of the last beat
let hangSaid = false;

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

function say(line) {
  console.log(`[${stamp()}] ${line}`);
}

/** The newest session file, or null while the sink has not written one. */
function newestLog() {
  let names;
  try { names = readdirSync(dir).filter((n) => n.endsWith('.jsonl')); }
  catch { return null; }
  let best = null;
  for (const n of names) {
    const p = join(dir, n);
    const m = statSync(p).mtimeMs;
    if (best === null || m > best.m) best = { p, m };
  }
  return best === null ? null : best.p;
}

function handle(rec) {
  const k = rec.kind;
  if (k === 'beat') {
    lastBeatAt = Date.now();
    if (rec.pulse) lastState = rec.pulse.state;
    if (hangSaid) { say('beats resumed'); hangSaid = false; }
    for (const e of rec.events ?? []) {
      if (e.source === 'transitionTo') say(`state ${e.message}`);
      if (e.level === 'error') say(`ERROR ${e.source}: ${e.message}`);
    }
    return;
  }
  if (k === 'alarm') {
    const p = rec.pulse ?? {};
    say(`ALARM ${rec.class} — state=${p.state} t=${p.t} held=${p.held} map=${p.map} char=${p.char}`);
    return;
  }
  if (k === 'err') { say(`UNCAUGHT ${rec.msg}`); return; }
  if (k === 'hello') { say(`page connected: ${rec.href}`); lastState = null; return; }
  if (k === 'bye') { say('page closed (clean goodbye)'); lastState = null; hangSaid = false; return; }
}

function readNew() {
  const current = newestLog();
  if (current === null) return;
  if (current !== file) {
    file = current;
    offset = 0;
    partial = '';
    say(`following ${file}`);
  }
  const size = statSync(file).size;
  if (size <= offset) return;
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(size - offset);
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  offset = size;
  const text = partial + buf.toString('utf8');
  const lines = text.split('\n');
  partial = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim() === '') continue;
    try { handle(JSON.parse(line)); }
    catch { say(`unparsable line: ${line.slice(0, 80)}`); }
  }
}

function checkHang() {
  if (hangSaid || lastBeatAt === 0) return;
  if (lastState === null || !RUNNING_STATES.includes(lastState)) return;
  const quiet = Date.now() - lastBeatAt;
  if (quiet > HANG_AFTER_MS) {
    hangSaid = true;
    say(`HANG? no beat for ${(quiet / 1000).toFixed(1)}s mid-run — main thread likely hung; last state=${lastState}`);
  }
}

say(`watching ${dir} for flight logs`);
setInterval(() => { readNew(); checkHang(); }, POLL_MS);
