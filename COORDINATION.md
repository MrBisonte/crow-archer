# COORDINATION — the session ledger

Every session working this repo owns a row here. Keeping it current is not
optional and not a courtesy: it is how six branches reach `origin` without
losing each other's work.

**Merger is the coordinating session.** Alex has given it authority to ask any
session listed here to update its row, to settle collisions between branches,
and to decide merge order. Where two branches disagree, Merger judges. The aim
is one thing: `origin` stays clean, and `master` above all.

## Hard rules

- **`integration/round-4` is the only branch that may push to `origin`.**
  Nothing else. Not your feature branch, not `master`, not a backup push.
  All work reaches the remote through the integration branch and one PR that
  Merger opens.
- **`master` is never committed to or pushed to directly.** It moves only by
  a merged PR.
- **Log your row before your first commit**, not after. A branch nobody knows
  about is a branch that gets clobbered.
- **Update your row on every commit.** At minimum `Head` and `Updated`. This
  is the whole point of the file — a stale row is worse than no row, because
  it is trusted.
- **Set `Status: finished` when you stop.** Merger will not merge a branch
  that is still moving; a branch left at `started` is a branch that waits.
- **Branch from current `master`,** and rebase onto it before your next commit
  if `master` has moved. Never rebase a branch that Merger has already merged
  — say so instead and let it top up.

## Status values

| Status | Meaning |
|---|---|
| `started` | Actively committing. Merger will not merge you yet. |
| `idle` | Not currently working, but not done either. May resume. |
| `blocked` | Waiting on something. Name it in `Notes`. |
| `finished` | Done and stable. Merger may merge without asking. |

## The ledger

`Head` is your branch tip, short SHA. `Base` is `current` if you are cut from
the current `master`, `STALE` otherwise. `In r4` is whether Merger has merged
you into `integration/round-4` yet — Merger maintains that column, not you.

| Session | Branch | Task | Status | Head | Base | In r4 | Updated | Notes |
|---|---|---|---|---|---|---|---|---|
| `Merger` | `integration/round-4` | Integrate every branch, keep origin clean, open the PR | `started` | `5789592` | — | — | 08-26 12:30 | Coordinating session. Only branch permitted to push. |
| `robinhood-39` *(exited)* | `feat/char-redesign` | Rebuild the archer: profile sprite, walk cycle, live-drawn bow, brace and pierce | `finished` | `69662b5` | current | yes | 08-26 11:33 | Left the roster ~12:30 without ever replying. Treated as finished: merged, and no longer committing. Was the likely owner of `feat/charselect-screen`. |
| *orphaned* | `feat/charselect-screen` | Rework the char-select screen: per-hero stats, clickable, panel row from canvas | `blocked` | `ddfd0d2` | current | **NO** | 08-26 11:50 | **No live owner.** Conflicts with `feat/char-redesign` and `feat/playfield-55x33` in `src/legacy/game.js` and `game.test.ts` — a structural collision, sprite caching against panel layout. `chars` and `DESIGN` both disclaimed it; `robinhood-39`, the likely owner, has exited. **Claim this row if it is yours.** |
| `Crow Archer branch MAPS` | `feat/playfield-55x33` | Enlarge the playfield to 55x33 and scale the canvas to fit the window | `finished`? | `850a581` | current | yes | 08-25 22:51 | Merged. Status unconfirmed — has not replied. |
| `trusting-khorana-80b923-a0` | `fix/siege-answering-guard-flake` | Score the siege answering test by quarry identity, not by distance | `finished`? | `ddf5ea8` | current | yes | 08-26 10:17 | Merged. Status unconfirmed — has not replied. |
| `xenodochial-dijkstra-b642ec-65` | `fix/siege-wave-advance-flake` | Count sim steps, not frames, when a siege wave advances | `finished`? | `d2e342b` | current | yes | 08-25 19:26 | Merged. Status unconfirmed — has not replied. |
| `blissful-robinson-5963a5-58` | `test/balance-doc-drift` | Pin `docs/balance.md`'s character table to the panel it describes | `finished`? | `289ffb6` | current | yes | 08-26 10:17 | Merged on the assumption it was ready. A peer reported it "awaiting their user" — **say so and Merger will back it out.** |
| `inspiring-mayer-2d82d3-78` | *unknown* | *unknown* | `started` | — | — | — | 08-26 12:15 | New session, has not identified itself. Claim your row. |

A `?` on a status means Merger inferred it from commit timing, not from the
session saying so. Replace it with the real value.

## Traps that have already cost time here

- **The worktrees live inside the main repo,** at
  `robinhood\.claude\worktrees\<name>`. If a worktree's `.git` file is missing,
  every git command from that directory silently resolves to the main clone at
  `C:\Users\bison\OneDrive\labs\robinhood` — where other sessions are working.
  Run `git rev-parse --show-toplevel` before anything that changes state.
  This has caught two sessions already.
- **A clean auto-merge can still drop content.** It happened in round 3: 154
  lines of `docs/architecture.md` and `docs/manual.md` vanished with no
  conflict and a fully green suite, because no test reads prose. After a merge,
  diff the result against the source and read what was not taken.
- **Git ancestry lies here in three separate ways** — squash merges, dropped
  content whose merge-base became the source tip, and cherry-picks that change
  the hash. Verify by content or tree hash, never by "N commits ahead".
- **`git branch -d` refuses a squash-merged branch** as "not fully merged"
  even when every line of it is on `master`. That refusal is not evidence.
