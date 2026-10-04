# COORDINATION: the session ledger

Every session working this repo owns a row here. Keeping it current is not
optional and not a courtesy: it is how several branches reach `origin` without
losing each other's work.

**Current round: `integration/round-13`, cut from `master` at `13994a7`.**
Round 12 shipped as `v0.3.3` (PR #52): the fifth bastion tower and two blink
fixes. Round 13 holds the refusal reasons and Alex's three refusal calls. Alex
play-checked it 10-04 and signed off; its PR tags `v0.3.4`. That branch name is written here once; everything else
refers to "the current integration branch" so this file is the only thing that
has to change when a round closes.


**Merger is the coordinating session.** Alex has given it authority to ask any
session listed here to update its row, to settle collisions between branches,
and to decide merge order. Where two branches disagree, Merger judges. The aim
is one thing: `origin` stays clean, and `master` above all.

## Hard rules

- **The current integration branch is the only branch that may push to
  `origin`.** Nothing else. Not your feature branch, not `master`, not a
  backup push. All work reaches the remote through the integration branch and
  one PR that Merger opens.
- **`master` is never committed to or pushed to directly.** It moves only by
  a merged PR.
- **Branch from a freshly fetched `master`, every time.** Fetch and
  fast-forward first. Do not trust the local ref. Both clones on this disk
  ended round 4 with a stale local `master` (one behind, one four behind), so
  a branch cut from either would have started from the wrong release:

  ```bash
  git -C <clone> fetch origin --prune --tags && git -C <clone> fetch origin master:master
  ```

  `fetch origin master:master` updates the ref without checking `master` out,
  and refuses anything that is not a fast-forward. That is the guard you
  want. `git pull` on a checked-out `master` can merge instead of refusing.
- **Log your row before your first commit**, not after. A branch nobody knows
  about is a branch that gets clobbered.
- **Update your row on every commit.** At minimum `Head` and `Updated`. This
  is the whole point of the file. A stale row is worse than no row, because
  it is trusted.
- **Set `Status: finished` when you stop.** Merger will not merge a branch
  that is still moving; a branch left at `started` is a branch that waits.
- **Rebase onto `master` if it has moved** before your next commit. Never
  rebase a branch Merger has already merged. Say so instead and let it top up.

## Status values

| Status | Meaning |
|---|---|
| `started` | Actively committing. Merger will not merge you yet. |
| `idle` | Not currently working, but not done either. May resume. |
| `blocked` | Waiting on something. Name it in `Notes`. |
| `finished` | Done and stable. Merger may merge without asking. |

## The ledger

`Head` is your branch tip, short SHA. `Base` is `current` if you are cut from
`master` at `13994a7`, `STALE` otherwise. `In r13` is whether Merger has merged
you into the integration branch yet. Merger maintains that column, not you.

| Session | Branch | Task | Status | Head | Base | In r13 | Updated | Notes |
|---|---|---|---|---|---|---|---|---|
| `Merger` | `integration/round-13` | Assemble round 13; open the PR on Alex's word | `started` | `see tip` | current | n/a | 10-04 | Session `local_ea47dfd7`, Merger + sole pusher. Cut from `master` `13994a7` (`v0.3.3`). Folded `fix/refusal-reasons` and `fix/refusal-tuning`. |
| `Refusals` | `fix/refusal-reasons` | Every refusal outside a HUD chip says why | `finished` | `c5466a8` | `integration/round-12` `8646cf2` | **yes** | 10-04 | Session `local_aa25de04`, started by Merger. Cut from `integration/round-12` `f7b98bd` for `watchBlocked()`, rebased onto `8646cf2`. Checkout `labs/robinhood-refusal-reasons`. Ten bare refusals now carry a `BLOCKED` reason; the nine that a HUD chip counts stay quiet. New reasons: `NO BOMBS`, `NO ROOM AHEAD`, `NO TARGET IN RANGE`, `TOO MANY SHOTS IN THE AIR`, `CHARGE NOT READY`, `SPEAR NOT READY`. Each reason line reverted alone fails its own test. Gate: typecheck 0, 2409 tests / 91 files. Round 12 was signed off before this branch, so Merger picks round 12 or 13. Folded into round 13 by cherry-pick: `ee377ab` (code) and `9a5e9cd` (lessons); its two ledger commits targeted round 12's ledger, so this row moved by hand. Alex play-checked it 10-04 and signed off. |
| `Refusal-calls` | `fix/refusal-tuning` | Alex's three refusal calls: reload, knight charge, spear | `finished` | `5961f9c` | current | **yes** | 10-04 | Session `local_aa25de04`. Cut from `integration/round-13` `bad4873`. Checkout `labs/robinhood-refusal-tuning`. Reload says `RELOADING` once per reload; the knight's charge gets a lane-D chip (new `dash` glyph, sixth slot like the sapper's) and keeps `CHARGE NOT READY`; an early spear press goes silent and `SPEAR NOT READY` is removed. Each changed line reverted alone fails its own test. Gate: typecheck 0, 2411 tests / 91 files. Alex play-checked it 10-04 and signed off. |

A `?` on a status means Merger inferred it from commit timing, not from the
session saying so. Replace it with the real value.

## Open findings, owned by nobody

None. The last one, `MASTERY_AWARDS.boss_down`, is answered in code:
`src/sim/talents.ts` keeps it as the milestone type's default and says
nothing pays it, and `docs/talents.md` says the same.

## Landed

- **`v0.3.3`** (`13994a7`, PR #52): round 12. The fifth bastion tower, a refused
  blink names its reason, a new stage starts the blink ready, and the
  Integration PR section in the writing standard.
- **`v0.3.2`** (`8bcc083`, PR #46): the difficulty ladder. Three rungs on the
  character screen; `nightmare` holds the pre-ladder figures, and the ladder
  moves the chase, not the crowd.
- **`v0.3.1`** (round 11): the public flight sink (opt-in behind `?rec=1`,
  posting to `crow-archer.fly.dev` with a storage guard at 80%) and the
  maze-beacon flake fix (#47).
- **`v0.3.0`** (`270b6d1`, PR #45): round 10. The brawl-freeze fix, the
  ultimate-pick fix, the maze, the bastion (four towers), and the recorder gate.
- **PR #44** (`553f141`): round 9. Two ultimates per hero and the run-start pick.
- **PR #42** (`d8f46ad`): round 6. The flight recorder, the brawl-freeze fix
  (routeless bat in `invalidateThrough`), and the WASD shift-latch fix. Caught
  by monitored play, not by CI.
- **PR #40** (`10a5302`): round 5. The talent trees, the route-invalidation
  fix, and three source-reading guards. 1932 tests across 73 files at the merge.
- **`v0.2.0`**: round 4, merged as `09f42f6` (PR #39). Seven branches: the
  roster rebuild, the char-select screen, the 55x33 playfield, two siege flake
  fixes, the balance-doc drift test. 1757 tests across 66 files.
- **`v0.1.0`**: rounds 1-3.

## Traps that have already cost time here

Moved to [`LESSONS.jsonl`](LESSONS.jsonl): these were episodic lessons, not
live session state, so they now live in the append-only ledger with the rest.
Grep it by topic: `worktree`, `clones`, `merge`, `git-ancestry`,
`branch-cleanup`, `coordination`. `AGENTS.md` explains the format;
`src/lessons.test.ts` enforces it.
