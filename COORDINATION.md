# COORDINATION: the session ledger

Every session working this repo owns a row here. Keeping it current is not
optional and not a courtesy: it is how several branches reach `origin` without
losing each other's work.

**Current round: `integration/round-6`, cut from `master` at `f6890a5`.**
Round 5 landed as PR #40 (`10a5302`) and is not yet tagged: the release
download still serves `v0.2.0` while gh-pages already deploys the merge.
That branch name is written here once; everything
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
`master` at `f6890a5`, `STALE` otherwise. `In r6` is whether Merger has merged
you into the integration branch yet. Merger maintains that column, not you.

| Session | Branch | Task | Status | Head | Base | In r6 | Updated | Notes |
|---|---|---|---|---|---|---|---|---|
| `Merger` | `integration/round-6` | Integrate round 6, keep origin clean, open the PR | `started` | `ee62495` | n/a | n/a | 08-30 | Cut from `master` `f6890a5`. Worktree `.claude/worktrees/integration-r6`. Merged `feat/flight-recorder` as `3908126`, `fix/invalidate-routeless-agents` as `add32bc`, `fix/wasd-shift-latch` as `ee62495`; all three auto-merges clean, re-read by hand: per-branch reverse diffs empty and `game.js` carries all three edits. Round-5 rows retired to history; the Landed list records the round. |
| `Merger` | `feat/flight-recorder` | Flight recorder: ship the diagnostic log to a dev-server JSONL sink, with watchdogs that classify a stop (loop-dead / logic-freeze / no-frames / hard hang), for monitored playtests of the brawl freeze | `finished` | `02ca5a6` | current | **yes** | 08-30 | Spawned by Alex's brawl-freeze report (mid-game, first map, most characters). Reuses `src/sim/log.ts` (already event-bus-fed and transition-fed) and the `?perf` tracer; new files under `src/dev/`, sink inside the vite dev server, lines land in gitignored `_flightlogs/`; `npm run flight:watch` follows the newest log. Worktree `.claude/worktrees/flight-recorder`. **Self-tested live:** beats+pulse land, an induced uncaught error ships with its stack, a 100000-frame hitstop raised `logic-freeze` with `movementBlockers()` attached. The first run also caught the hidden-Browser-pane rAF starvation red-handed (its own raf counter at 8 after ~40s while visibility still said `visible`). That is almost certainly the artifact behind the earlier synthetic "freeze at iteration 51" repro; it now has the `no-frames` class. The real brawl-freeze hunt runs on Alex's monitored play next; any fix goes on its own branch. **Topped up 08-30 evening:** it caught two the same day: the brawl freeze (fixed on `fix/invalidate-routeless-agents`, `d127a7e`) and the WASD shift-latch (fixed on `fix/wasd-shift-latch`, `7a02a55`), both cut from `master`, rows travelling here per the `fix/globals-verb-coverage` precedent. Also added `docs/playbooks/monitored-playtest.md` (launch recipe, the log's wire format, hand-off) at Alex's request, with the README row and the architecture link, then rewrote it in the reference register Alex named (field tables to the leaf, mermaid, real sample lines). |
| `Merger` | `fix/invalidate-routeless-agents` | Brawl freeze: treat a missing `path` field as routeless in `invalidateThrough` | `finished` | `d127a7e` | current | **yes** | 08-30 | The crow king's bats ride in `crows` with no `path` field; a sapling maturing mid-boss-fight read `.length` off `undefined` and killed the frame loop. Caught live by the flight recorder with the full stack. Unit test plus a no-step conjunction test in `game.test.ts`; both reproduce the production TypeError with the guard reverted. Verified by Alex on a monitored replay: Crow King and both castle bosses cleared, zero alarms. |
| `Merger` | `fix/wasd-shift-latch` | Latched WASD: release a held key's old name when it repeats under a new one | `finished` | `7a02a55` | current | **yes** | 08-30 | Shift mid-hold renames the auto-repeat (w becomes W), orphaning the first `keys` entry; the latched key jams its axis until the next plain press of the same key. Diagnosed from a 9-second abandoned wizard run in the flight log. Bookkeeping moved to `noteKeyDown`/`noteKeyUp` in `src/sim/input.ts`; the latch case fails against a faithful port of the old logic. |
| `Wizard` | `feat/wizard-round` | The wizard's round: (1) fix what is broken in the bolt, (2) balance the glass cannon, (3) feel and feedback, and (4) a blink talent line Alex asked for after the first three were scoped. Focus is out of scope. | `started` | `5893601` | `master` `d8f46ad` | `integration/round-7` `0c992b6`; `feat/archer-round` merged into it at `4396004` and touches `game.js` heavily, so this branch's merge meets it — I resolve that, with both diffs open | 09-02 | Worktree `.claude/worktrees/wizard-round`, cut fresh from `master` `d8f46ad`, hooks installed. **Bolt fix** (`915d4a1`): the ownerless homing finding was two defects — it walked `crows` alone when choosing what to steer at, *and* its hit loop never mentioned `soldiers`, so his primary passed through the whole garrison. New pure helper `nearestHostileAmong` in `src/sim/targeting.ts`; skeletons and soldiers now carry `team: Team.ENEMY` at spawn, which makes the wrapping in `siegeHostiles()` removable (not this round). **Balance** (`5893601`): a time-to-kill harness showed the wizard needed 3.9 s to kill a shieldman the archer kills in 0.33 s, because `bossDamageMult` is boss-only and `balance.md` justified that scope on a claim the garrison outdated. `wizBoltBodyDamage: 2` fixes it; it also halves his time to kill a scaled crow in waves mode, which is the same defect and is written down. **Blink line:** LONG STEP -> HELD STEP (tier II, chain window) -> THIRD STEP (**the first tier-III talent in any tree**) -> THUNDERSTEP (a third capstone, each hop of a chain arrives harder). New pure module `src/sim/blink.ts`. **Merge-watch for Merger:** `updateArrows`, `tryWizardBlink` and `spawnSkeleton`/`spawnSoldier` in `game.js`; the wizard rows of `CHAR_TREES`, `TALENT_LOOK`, `SIGILS` and `TALENTS.STATS`; the deleted characterisation test `does NOT home toward a skeleton or a soldier` (a branch merging over it looks green while re-asserting the bug); and `talents-run.test.ts`'s capstone set, which is now three. **Still open:** the feel pass. Separately, the archer round's talent-icon work produced **no commits** — `_design/` is gitignored on purpose, so the only record is the design canvas https://claude.ai/code/artifact/aa2f6a93-e370-4855-8fab-f8c2b2ef8846 and the scratch under `_design/talent-feedback/`. |

A `?` on a status means Merger inferred it from commit timing, not from the
session saying so. Replace it with the real value.

## Open findings, owned by nobody

- **`MASTERY_AWARDS.boss_down` may be dead.** `src/sim/talents.ts` prices four
  milestones, but production awards only `stage_cleared`, `siege_cleared` and
  `run_won`; bosses go through `bossMastery(kind)` and the `BOSS_MASTERY` table
  instead. `boss_down` survives only in two test files, one of which is *named*
  for banking it. So either the entry is dead and the type should lose it, or
  there are two pricing paths for one event and they can disagree. Noticed by
  Merger while checking whether `talents.md`'s per-boss table matched the code;
  it does, and this is the loose end beside it. Belonged to `robinhood-39b`
  in round 5; ownerless since that row retired, so it is round-7 material
  along with the talent axis re-split that row left open.

- **The wizard's homing bolt only steers at crows.** `game.js` around line 4703:
  the target is the boss when one is in play, and otherwise the nearest of
  `crows`. Nothing walks `skeletons` or `soldiers`, so a bolt flies straight
  past both on the castle gauntlet, the maze and the cavern. Found and
  characterised by `route-salvage`, confirmed by Merger, and deliberately not
  fixed by either: what the bolt should chase is a balance call for whoever
  owns the wizard. The README sells the kit as "bolts that steer toward
  whoever is nearest", so this is a documentation defect as well as a
  behaviour one, and fixing either half alone leaves them disagreeing.

## Landed

- **PR #40** (`10a5302`): round 5. The talent trees, the route-invalidation
  fix, and three source-reading guards. 1932 tests across 73 files at the
  merge. Untagged so far: the downloadable release is still `v0.2.0` while
  gh-pages already deploys this merge.
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
