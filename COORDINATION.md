# COORDINATION — the session ledger

Every session working this repo owns a row here. Keeping it current is not
optional and not a courtesy: it is how several branches reach `origin` without
losing each other's work.

**Current round: `integration/round-5`, cut from `master` at `09f42f6`
(released as `v0.2.0`).** That branch name is written here once; everything
else refers to "the current integration branch" so this file is the only
thing that has to change when a round closes.

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
  fast-forward first — do not trust the local ref. Both clones on this disk
  ended round 4 with a stale local `master` (one behind, one four behind), so
  a branch cut from either would have started from the wrong release:

  ```bash
  git -C <clone> fetch origin --prune --tags && git -C <clone> fetch origin master:master
  ```

  `fetch origin master:master` updates the ref without checking `master` out,
  and refuses anything that is not a fast-forward — which is the guard you
  want. `git pull` on a checked-out `master` can merge instead of refusing.
- **Log your row before your first commit**, not after. A branch nobody knows
  about is a branch that gets clobbered.
- **Update your row on every commit.** At minimum `Head` and `Updated`. This
  is the whole point of the file — a stale row is worse than no row, because
  it is trusted.
- **Set `Status: finished` when you stop.** Merger will not merge a branch
  that is still moving; a branch left at `started` is a branch that waits.
- **Rebase onto `master` if it has moved** before your next commit. Never
  rebase a branch Merger has already merged — say so instead and let it top up.

## Status values

| Status | Meaning |
|---|---|
| `started` | Actively committing. Merger will not merge you yet. |
| `idle` | Not currently working, but not done either. May resume. |
| `blocked` | Waiting on something. Name it in `Notes`. |
| `finished` | Done and stable. Merger may merge without asking. |

## The ledger

`Head` is your branch tip, short SHA. `Base` is `current` if you are cut from
`master` at `09f42f6`, `STALE` otherwise. `In r5` is whether Merger has merged
you into the integration branch yet — Merger maintains that column, not you.

| Session | Branch | Task | Status | Head | Base | In r5 | Updated | Notes |
|---|---|---|---|---|---|---|---|---|
| `Merger` | `integration/round-5` | Integrate every branch, keep origin clean, open the PR | `started` | `4db680a` | current | — | 08-27 | Cut from `master` `09f42f6`. Worktree `.claude/worktrees/integration-r5`. No feature branch merged yet; carrying its own docs work — the round-5 ledger, the manual character picker, and the arena-size guard. Not pushed: awaiting Alex. |
| `robinhood-39b` | `feat/talent-trees-r5` | Talent trees: per-char tiers gated by mastery, run draft, mid-run capstone rite; wizard pilots | `started` | `5bbba12` | current | no | 08-27 | Round 5's headline. **Superseded `feat/talent-trees` (`b6b57ec`)**: rather than rebase, the two genuinely-new files were re-committed on a fresh cut from `09f42f6` — same content, honest ancestry; the old branch is untouched and may be deleted. Chooser screens BUILT in char-select style (owner's pick): TALENTS module (save/mastery/run-draft/rite), wizard pilot consumers live (blink/storm/focus + both capstones), draft+rite screens browser-verified. Chooser rebuilt on `render/panel-row.ts` after the first cut copied char select's PRE-rebuild idiom (literal 1000 row, sliding centres, no click) - now canvas-derived, fixed centres, clickable, with mutation-proved guards. `docs/talents.md` added (3 mermaid graphs, verified against mermaid 11). Remaining: buy screen (talents purchasable via devHooks only), axis re-split. Flake sighting: game.test.ts 'returns to its post after leaving it to fight' failed once in a full run (187.7 vs 170 leash), 4/4 green isolated - guard/post family, not new. **Planned collision:** the talent re-split moves kit axes (arrows/restore/tools/pfRange) OUT of `upgrades.ts` while `fix/upgrade-dead-cells` makes those same axes live per-hero in the same files. Sequence: dead-cells lands first, talents consumes its mappings as seed content. |
| *unclaimed* | `perf/projectiles-and-pathing` | Drop cached routes when terrain stops being walkable; characterise projectile flight before refactoring it | `idle`? | `ff95304` | **STALE** | no | 08-26 | **Lives in the other clone**, `labs/crow-archer`, not in `labs/robinhood`. Cut from `559c61f` — four releases behind, before the 55x33 field and the roster rebuild. Its 133 added lines in `game.test.ts` will collide hard with round 4's rewrite of the same file. Rebase onto `09f42f6` and re-run before offering it. Whoever owns this: claim the row. |

A `?` on a status means Merger inferred it from commit timing, not from the
session saying so. Replace it with the real value.

## Landed

- **`v0.2.0`** — round 4, merged as `09f42f6` (PR #39). Seven branches: the
  roster rebuild, the char-select screen, the 55x33 playfield, two siege flake
  fixes, the balance-doc drift test. 1757 tests across 66 files.
- **`v0.1.0`** — rounds 1-3.

## Traps that have already cost time here

- **The worktrees live inside the main repo,** at
  `robinhood\.claude\worktrees\<name>`. If a worktree's `.git` file is missing
  — deleted, or its worktree pruned while the session was still running —
  every git command from that directory silently resolves to the main clone at
  `C:\Users\bison\OneDrive\labs\robinhood`, where other sessions are working.
  Nothing warns you. Run `git rev-parse --show-toplevel` before anything that
  changes state, and prefer `git -C <path>` over relying on the shell's cwd.
  This has caught three sessions now, including Merger's own.
- **There are two clones of this repo on disk**, `labs\robinhood` and
  `labs\crow-archer`, with separate refs and separate stale `master`s. A branch
  you cannot find is probably in the other one.
- **A clean auto-merge can still drop content.** It happened in round 3: 154
  lines of `docs/architecture.md` and `docs/manual.md` vanished with no
  conflict and a fully green suite, because no test reads prose. After a merge,
  diff the result against the source and read what was not taken.
- **Git ancestry lies here in three separate ways** — squash merges, dropped
  content whose merge-base became the source tip, and cherry-picks that change
  the hash. Verify by content or tree hash, never by "N commits ahead". Every
  branch merged in round 4 still reports itself as ahead of `master`; all of
  them are fully in it. The check that settles it:
  `git rev-parse <branch>^{tree}` against `git rev-parse origin/master^{tree}`,
  or a plain `git diff --stat origin/master <branch>` read for *added* content
  rather than for size.
- **`git branch -d` refuses a squash-merged branch** as "not fully merged"
  even when every line of it is on `master`. That refusal is not evidence.
- **Two sessions can fix the same thing two different ways.** Round 4 had it
  twice: the `archer-pierce` flake, and the balance-doc drift test written
  once as `balance-doc.test.ts` and once inline in `game.test.ts`. Read the
  ledger before starting; if your task is already someone's row, say so.
