# COORDINATION: the session ledger

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
`master` at `09f42f6`, `STALE` otherwise. `In r5` is whether Merger has merged
you into the integration branch yet. Merger maintains that column, not you.

| Session | Branch | Task | Status | Head | Base | In r5 | Updated | Notes |
|---|---|---|---|---|---|---|---|---|
| `Merger` | `integration/round-5` | Integrate every branch, keep origin clean, open the PR | `started` | `fa737e3` | current | n/a | 08-27 | Cut from `master` `09f42f6`. Worktree `.claude/worktrees/integration-r5`. **`feat/talent-trees-r5` merged** as `62403b4`, no conflicts, gate green after: typecheck 0, 72 files, 1909 tests (v0.2.0 shipped 66 and 1757). **`fix/globals-verb-coverage` merged** as `fa737e3`, clean on the one file it shared with the talent trees. Also carrying its own docs work: the round-5 ledger, the manual character picker, and the arena-size guard. Pushed. No PR open yet. |
| `robinhood-39b` | `feat/talent-trees-r5` | Talent trees: per-char tiers gated by mastery, run draft, mid-run capstone rite; wizard pilots | `started` | `4c1b889` | current | **yes** | 08-27 | Round 5's headline. **Superseded `feat/talent-trees` (`b6b57ec`)**: rather than rebase, the two genuinely-new files were re-committed on a fresh cut from `09f42f6` — same content, honest ancestry; the old branch is untouched and may be deleted. Chooser screens BUILT in char-select style (owner's pick): TALENTS module (save/mastery/run-draft/rite), wizard pilot consumers live (blink/storm/focus + both capstones), draft+rite screens browser-verified. Chooser rebuilt on `render/panel-row.ts` after the first cut copied char select's PRE-rebuild idiom (literal 1000 row, sliding centres, no click) - now canvas-derived, fixed centres, clickable, with mutation-proved guards. `docs/talents.md` added (3 mermaid graphs, verified against mermaid 11). All five trees now live: 20 talents wired through one TALENTS.STATS table with a load-time check. Real bug the suite caught: giving the four heroes capstones let the rite open MID-SIEGE (game.test.ts's boss kills push mastery past rank III inside the bastion) - queueBossChoosers now refuses while siegeRun is set. Talent system COMPLETE bar the buy screen: all 25 talents wired (13 numeric + 8 unlocks), colour-coded by kind, drawn sigils generated from the design sheets. Two unlocks had to be redefined - their written effects were already true of the base kit (the dash always cut along its line; barrage bombs never bounced). Remaining: buy screen (purchase works via devHooks only), axis re-split. Flake sighting: game.test.ts 'returns to its post after leaving it to fight' failed once in a full run (187.7 vs 170 leash), 4/4 green isolated - guard/post family, not new. **Planned collision:** the talent re-split moves kit axes (arrows/restore/tools/pfRange) OUT of `upgrades.ts` while `fix/upgrade-dead-cells` makes those same axes live per-hero in the same files. Sequence: dead-cells lands first, talents consumes its mappings as seed content. **Merger, 08-27:** merged at `4c1b889`, which is four commits past the head this row names. That collision never happened: `04f1b43` did both halves on this one branch, so no `fix/upgrade-dead-cells` was ever cut and none is expected. The branch also stopped editing this file at `4c1b889` and hands its status over as a message, which is why the round-4 ledger did not come back with the merge. Two files overlapped Merger's docs work and were read by hand after the auto-merge: the README Docs table kept both edits, and `docs/manual.md` kept the TALENTS row above the corrected arena size. Still `started`: the buy screen and the axis re-split are open, so expect a top-up. |
| `loving-archimedes-1a5e3d` | `fix/globals-verb-coverage` | Drop the dead `window.knights` declaration from `src/legacy/globals.d.ts`, and add a coverage test so the next stale verb fails the build | `finished` | `5461d4d` | current | **yes** | 08-27 | Claimed by message before its first commit, and deliberately does not touch this file: it is cut from `master` `09f42f6`, where this is still the round-4 ledger, so a row on its side is the hazard `4c1b889` recorded. Its status travels here instead. **Merger verified the diagnosis:** `906440b` ("one knight, and it is the destrier", 08-25) deleted `window.knights` and the console banner that advertised it, and touched no `.d.ts` at all, so the declaration is the leftover and deleting it is the fix rather than assigning it. Confirmed live on r5: `typeof window.knights` is `undefined` while every sibling verb is a function. Two files. **Merged `fa737e3`.** `globals.d.ts` was the one file it shared with the talent trees, which had added `draft` and `rite` eight lines below the deletion; the auto-merge kept both and the interface now holds nine members. Merger re-proved the guard on the merged tree rather than on the report: cutting the live `window.rite` assignment turned it red naming `rite`, so the two members the talent branch added are held to the same rule as the rest. Gate after: typecheck 0, 72 files, 1909 tests, which is exactly the one file and two tests this branch claims. Two follow-ups the author raised and correctly left alone: nothing holds the boot banner at `game.js:14767` to the verbs that exist (accurate today, unguarded), and no doc anywhere lists the console verbs, so that banner is their only advertisement. Both are round-6 material. |
| *unclaimed* | `perf/projectiles-and-pathing` | Drop cached routes when terrain stops being walkable; characterise projectile flight before refactoring it | `idle`? | `ff95304` | **STALE** | no | 08-26 | **Lives in the other clone**, `labs/crow-archer`, not in `labs/robinhood`. Cut from `559c61f`. Four releases behind: before the 55x33 field and the roster rebuild. Its 133 added lines in `game.test.ts` will collide hard with round 4's rewrite of the same file. Rebase onto `09f42f6` and re-run before offering it. Whoever owns this: claim the row. |

A `?` on a status means Merger inferred it from commit timing, not from the
session saying so. Replace it with the real value.

## Landed

- **`v0.2.0`**: round 4, merged as `09f42f6` (PR #39). Seven branches: the
  roster rebuild, the char-select screen, the 55x33 playfield, two siege flake
  fixes, the balance-doc drift test. 1757 tests across 66 files.
- **`v0.1.0`**: rounds 1-3.

## Traps that have already cost time here

- **The worktrees live inside the main repo,** at
  `robinhood\.claude\worktrees\<name>`. If a worktree's `.git` file is missing
  (deleted, or its worktree pruned while the session was still running), every
  git command from that directory silently resolves to the main clone at
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
- **Git ancestry lies here in three separate ways:** squash merges, dropped
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
