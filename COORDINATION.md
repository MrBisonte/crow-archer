# COORDINATION: the session ledger

Every session working this repo owns a row here. Keeping it current is not
optional and not a courtesy: it is how several branches reach `origin` without
losing each other's work.

**Current round: `integration/round-7`, cut from `master` at `d8f46ad`.**
Round 6 landed as PR #42 (`d8f46ad`) and is not yet tagged: the release
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
`master` at `d8f46ad`, `STALE` otherwise. `In r7` is whether Merger has merged
you into the integration branch yet. Merger maintains that column, not you.

| Session | Branch | Task | Status | Head | Base | In r7 | Updated | Notes |
|---|---|---|---|---|---|---|---|---|
| `Merger` | `integration/round-7` | Integrate round 7, keep origin clean, open the PR | `started` | `5c50a5f` | n/a | n/a | 08-30 | Cut from `master` `d8f46ad`, pushed to `origin`. Worktree `.claude/worktrees/integration-r7`. First integration: `feat/lessons-ledger` merged no-ff as `5c50a5f`, clean, gate green. Awaiting more: `chore/public-hygiene` is the next candidate once "portf demo prep" says finished — see the collision note on the lessons row. |
| `Merger` | `feat/lessons-ledger` | The lessons ledger: `LESSONS.jsonl` (append-only, schema-tested), `AGENTS.md` for contributors, and the CLAUDE.md pattern | `finished` | `a0fb57c` | current | **yes** | 08-30 | Alex asked to evolve lessons-learned away from a table column into `LESSONS.jsonl`: one JSON object per line, `id`/`date`/`topic`/`level`/`lesson`(+`refs`,`session`), append-only so parallel sessions do not clobber, machine-shaped for a future fine-tuning pipeline. `src/lessons.test.ts` is the one home for the schema and is wired into the enforced-mechanically table; proven to fail on a malformed line before restoring green. Migrated the old "Traps that have already cost time here" section into `LESSONS.jsonl` (six traps + this session's three + the monitored-playtest practice) and left a pointer. **Collision with `chore/public-hygiene`** ("portf demo prep", 2 local commits, unpushed): its `5352ac1` deletes this whole file for public hygiene, so the Traps-pointer edit is a modify/delete against that branch. LESSONS.jsonl already holds the content, so resolve by taking the deletion; the ledger's own future home is a decision still open. Both branches also edit `CLAUDE.md`. |

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

- **PR #42** (`d8f46ad`): round 6. The flight recorder, the brawl-freeze fix
  (routeless bat in `invalidateThrough`), and the WASD shift-latch fix. Caught
  by monitored play, not by CI. gh-pages deploys it; still untagged.
- **PR #40** (`10a5302`): round 5. The talent trees, the route-invalidation
  fix, and three source-reading guards. 1932 tests across 73 files at the
  merge. Untagged so far: the downloadable release is still `v0.2.0` while
  gh-pages already deploys this merge.
- **`v0.2.0`**: round 4, merged as `09f42f6` (PR #39). Seven branches: the
  roster rebuild, the char-select screen, the 55x33 playfield, two siege flake
  fixes, the balance-doc drift test. 1757 tests across 66 files.
- **`v0.1.0`**: rounds 1-3.

## Traps that have already cost time here

Moved to [`LESSONS.jsonl`](LESSONS.jsonl) — these were episodic lessons, not
live session state, so they now live in the append-only ledger with the rest.
Grep it by topic: `worktree`, `clones`, `merge`, `git-ancestry`,
`branch-cleanup`, `coordination`. `AGENTS.md` explains the format;
`src/lessons.test.ts` enforces it.
