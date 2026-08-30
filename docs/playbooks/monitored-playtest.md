# Monitored playtests

Running a playtest that records itself, and reading what it recorded. The
design — what the flight recorder is, which halves live where, why beats and
a server stamp — is in [architecture.md](../architecture.md#the-flight-recorder)
and stays there. This file is the operating manual: the launch recipe, the
log's wire format line by line, what each kind of stop looks like in it, and
what a fresh session needs to pick the work up.

Written 2026-08-30, the day the recorder caught two shipped bugs in its first
hour of real use: the brawl freeze (a routeless bat meeting a closing tile in
`invalidateThrough`) and the WASD latch (a held key repeating under its
shifted name). Both diagnoses came straight from lines described below.

## Starting a monitored instance

- **Testing a branch?** Give it its own worktree, and arm the hooks — they
  are per-worktree, and a fresh worktree starts unguarded:

  ```bash
  git -C <repo> worktree add .claude/worktrees/<name> <branch>
  ```

  ```bash
  cd <repo>/.claude/worktrees/<name> && npm install && npm run hooks:install
  ```

- **Starting the instance** is just the dev server — the sink rides inside it:

  ```bash
  npm run dev -- --port 8090 --strictPort
  ```

  The port is free choice; `--strictPort` refuses to drift from it, which
  matters when a human is about to be handed the URL. The server prints
  `flight sink: <file>` at boot — that is the log you will read.

- **The player** opens the URL in their normal browser and just plays. The
  recorder is on by default under `npm run dev`; `?rec=0` opts a session out.
  **One game tab at a time**: beats carry no client id, so two open pages
  interleave into one file and the gap detector reads them as one confused
  page.

- **Watching live** (optional — the file is complete either way):

  ```bash
  npm run flight:watch
  ```

  One line per thing worth attention — alarms, uncaught errors, state
  transitions, page hello/goodbye — plus a `HANG?` line of its own when
  beats stop mid-run, which is the one failure the page cannot report.
  An agent arms the same script as a background monitor and gets pinged
  per line. It follows the *newest* log file and re-reads it from the
  start on attach, so the first burst is history, not news.

- **Driving the page from a harness instead of a human?** Read the traps
  first: a hidden Browser pane starves `requestAnimationFrame` while
  `visibilityState` still says `visible` (the recorder calls this
  `no-frames`), and `setInterval(() => __game.frame(16.7), 16)` is the way
  to run the real loop anyway — `frame()` keeps `liveLoop` true, unlike
  `takeClock()`, so the watchdogs stay armed.

## The log file

`_flightlogs/session-<server-start>.jsonl`, one file per dev-server run,
gitignored. One JSON object per line, in arrival order. Each line is one
POST from the page, wrapped by the sink with **`srv`** — the server's own
receive time, ms epoch. `srv` is the one clock the page cannot lie about:
a healthy page beats once a second, so a gap between `srv` stamps *is* the
freeze timestamp when everything below goes silent. A client `srv` key
loses the collision (`flight-sink.test.ts` holds that).

Timestamps inside the payload: `wall` is the page's `Date.now()` (lines up
with what a human says), `perf` is its `performance.now()` (monotonic,
survives clock changes), and `events[].timestamp` is `wall`-scale.

## Line kinds

| `kind` | When | Fields beyond `srv` |
|---|---|---|
| `hello` | page session start | `wall, href, ua, dpr` |
| `beat` | once a second | `wall, perf, raf, vis, pulse, events[], dropped?` |
| `alarm` | a watchdog classified a stop | `class, wall, perf, pulse, blockers, trace, events[]` |
| `err` | uncaught error / unhandled rejection | `wall, msg, stack?, events[]` |
| `bye` | pagehide — the tab closed or reloaded | `wall, events[]` (last ≤100) |

`raf` is the recorder's **own** requestAnimationFrame count — independent of
the game's loop, which is the comparison the watchdog lives on. `vis` is
`document.visibilityState`. `dropped` appears when a beat had more than 400
fresh events and says how many were counted instead of shipped.

### `pulse` — the run's vitals (`devHooks.pulse()` in game.js)

| Field | Meaning |
|---|---|
| `state` | `appState`: menu, charselect, playing, boss_fight, paused, chooser, gameover, win, … |
| `mode` | game mode (brawl, waves, siege) |
| `map` | map kind |
| `char` | selected character |
| `t` | sim seconds; advances only in `playing` / `boss_fight` |
| `lastTs` | the loop's own frame clock, ms — stalled means `loop()` stopped arriving |
| `live` | false while a harness holds the clock (`takeClock`); watchdogs stand down |
| `held` | hitstop frames still owed — context for a reader, not a watchdog input |
| `hp`, `kills` | player HP, kill count |
| `crows`, `skels`, `soldiers`, `arrows` | live array sizes |
| `boss` | boss kind, or null |

### `events[]` — the drained diagnostic log

The ring from `src/sim/log.ts`, shipped incrementally by `id` watermark.
Shape per entry: `{ id, level, timestamp, source, message, code?, data? }`.
Sources in the wild: `transitionTo` (state changes, with mode and map),
`EventBus` (every gameplay event, debug level), `trace` (per-second frame
timings once a second), `path` (a terrain change dropped routes),
`recorder` (its own lifecycle and alarms), `window` (uncaught errors).

### `alarm` — the classification

`class` is one of three; the fourth stop needs no line because it writes
itself as silence. Streaks are counted in 500 ms watchdog samples, so an
alarm is (streak × 500) ms of sustained evidence, once per episode.

| `class` | Evidence | Streak | Meaning |
|---|---|---|---|
| `loop-dead` | game clock stalled, page still animating | 2 | an exception unhooked the rAF loop |
| `logic-freeze` | frames arrive, `t` stuck mid-run, no state change | 4 | the sim is being held; hitstop never lasts this long |
| `no-frames` | nothing animates, tab claims visible | 10 | environment starved rAF (occlusion, embedded pane) |
| *(hard hang)* | beats stop, no `bye` | — | main thread hung; the `srv` gap is the timestamp |

`blockers` is `devHooks.movementBlockers()` — frozen, charging, dashing,
buried, snipeKeyHeld, heldKeys, position, state, char, map — so a stuck run
names its captor in the alarm itself. `trace` is level, frame count and
per-section spans from the `?perf` tracer.

## Reading it

The kinds histogram plus every alarm and error, for a first look:

```bash
node -e "const l=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n').map(JSON.parse);const k={};for(const r of l)k[r.kind]=(k[r.kind]||0)+1;console.log(k);for(const r of l)if(r.kind==='alarm'||r.kind==='err')console.log(new Date(r.srv).toISOString(),r.kind,r.class||r.msg)" _flightlogs/<file>
```

A window around a moment the player names ("it broke around 17:14"):

```bash
node -e "const[f,a,b]=process.argv.slice(1);const t0=Date.parse(a),t1=Date.parse(b);for(const r of require('fs').readFileSync(f,'utf8').trim().split('\n').map(JSON.parse))if(r.srv>=t0&&r.srv<=t1)console.log(new Date(r.srv).toISOString(),r.kind,JSON.stringify(r.pulse||r.msg||r.class||'').slice(0,120))" _flightlogs/<file> 2026-08-30T15:13:50Z 2026-08-30T15:14:10Z
```

- **A run that ends in `bye`** closed on purpose. **A run that just stops**
  hung — read the last beat's `trace` for the heaviest section and its
  `events` for the final second.
- **`beats resumed` after `HANG?`** in the watcher usually means a frozen
  tab was backgrounded and throttled, not a second failure — a dead page
  in a background tab beats about once a minute.

## Turning it off, and the release

There is nothing to turn off. The page half is imported dynamically behind
`import.meta.env.DEV` in `main.js`, so `vite build` ships zero bytes of it;
the sink is `apply: 'serve'`, so a built server has no endpoint either. The
release cannot record and cannot leak — by construction, not by flag.
`?rec=0` is the only switch, and it exists for dev sessions.

**Building an instrumented release-shaped artifact** (to chase a bug that
only lives in the single-file build) is the one case that needs more, and it
is not built. The owner has asked for verbosity levels as the shape for it:
`?rec=off|alarms|beats|full` deciding what the page sends (errors and alarms
always ride above `off`), the level table living in `flight-recorder.ts` as
one constant, and any non-dev build defaulting to `off` with an explicit
sink origin required. A per-page client id in `hello` and `beat` would fall
out of the same change and would lift the one-tab rule above. Whoever builds
it: the DEV-gate guarantee for the *normal* release must survive untouched.

## Picking this up in a fresh session

State as of 2026-08-30 evening — three branches, all local, none pushed,
`COORDINATION.md` governs everything that touches `origin`:

| Branch | Tip | What |
|---|---|---|
| `feat/flight-recorder` | this file's commit | recorder, sink, watcher, docs |
| `fix/invalidate-routeless-agents` | `d127a7e` | the brawl-freeze fix + its two tests |
| `fix/wasd-shift-latch` | `7a02a55` | the input latch fix + `noteKeyDown`/`noteKeyUp` |
| `verify/brawl-freeze` | throwaway | the three above merged for live verification |

- **Resuming the hunt or the ship?** Read `COORDINATION.md` first — the
  round, the worktree traps, and who may push are all there and only there.
- **Re-creating the instance** is the recipe at the top of this file run
  against whichever branch is under test; `verify/brawl-freeze` is what a
  player-facing session should serve until the round merges.
- **Driving the in-app preview at a worktree** from a session whose own
  directory is elsewhere: `.claude/launch.json` with
  `"runtimeArgs": ["--prefix", "<worktree>", "run", "dev", "--", "--port", "8090", "--strictPort"]`
  — npm's `--prefix` is what points the server at the right checkout.
