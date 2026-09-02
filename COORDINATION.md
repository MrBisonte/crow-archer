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

**The round-7 PR is the home-path remedy — do not cut a standalone fast-fix.**
`master` still shows Alex's home-dir path in `COORDINATION.md` (lines 114, 118)
and `docs/playbooks/monitored-playtest.md` (line 119), inherited from PR #41.
Round 7 already scrubs all three, so landing the round-7 PR is the whole fix; a
separate fast-fix branch only conflicts with work already done. Alex is holding
the PR until `feat/wizard-round` and the rest of the character balance land; the
interview moved to Fri 2026-09-05, so there is time. Before the PR opens, sweep
for other spellings the two-pattern grep misses — 8.3 short names,
`%USERPROFILE%` expansions, absolute paths baked into committed fixtures or log
samples.

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
| `Merger` | `integration/round-7` | Integrate round 7, keep origin clean, open the PR | `started` | `4396004` | n/a | n/a | 09-02 | Cut from `master` `d8f46ad`. Worktree `.claude/worktrees/integration-r7`. **Merged:** `feat/lessons-ledger` (`5c50a5f`), `feat/archer-round` (`4396004`), and `chore/public-hygiene` (this merge) — each gate-green. `feat/wizard-round` is held: owner says `started`. **Reconciliation pass 09-02:** swept both clones, logged all three branches below, pinged every owner for Head + a `finished` status before merge. Public-hygiene's sanitization was preserved on merge: the home-dir path is out of `docs/playbooks/monitored-playtest.md`, `session-39b` replaces the internal codename here, `CLAUDE.md` was taken from round 7 (it made zero changes), and its `.gitignore` stray blank was dropped. `Head` names the archer merge; the tip advances past it with the public-hygiene merge. `origin/integration/round-7` was at `0c992b6`; these merges are local pending the next push. |
| `Merger` | `feat/lessons-ledger` | The lessons ledger: `LESSONS.jsonl` (append-only, schema-tested), `AGENTS.md` for contributors, and the CLAUDE.md pattern | `finished` | `a0fb57c` | current | **yes** | 08-30 | Alex asked to evolve lessons-learned away from a table column into `LESSONS.jsonl`: one JSON object per line, `id`/`date`/`topic`/`level`/`lesson`(+`refs`,`session`), append-only so parallel sessions do not clobber, machine-shaped for a future fine-tuning pipeline. `src/lessons.test.ts` is the one home for the schema and is wired into the enforced-mechanically table; proven to fail on a malformed line before restoring green. Migrated the old "Traps that have already cost time here" section into `LESSONS.jsonl` (six traps + this session's three + the monitored-playtest practice) and left a pointer. **Collision with `chore/public-hygiene`** (now 3 commits at `02547c0`, unpushed): `5352ac1` deleted this whole file, but the tip `02547c0` reverts that — "keep the ledger, genericize it instead" — so it is a modify/modify against my round-7 ledger now, not a modify/delete. Resolve by taking the round-7 `COORDINATION.md` as base (LESSONS.jsonl already holds the migrated content) and folding in only genuine genericization. Both branches also edit `CLAUDE.md`. See the `chore/public-hygiene` row below. |
| `Aim` | `feat/archer-round` | Release polish + archer talents: unstick aim outside the canvas, post-resize rebalance, the archer's three talent trees (tower-count scaling deferred) | `finished` | `a9a68c3` | current | **yes** | 09-02 | **Owner confirmed finished 09-02.** 8 commits (code tip `6926f11`, ledger commit `a9a68c3` on top), cut from the round-7 base `master` `d8f46ad`, in the main clone's own working dir, unpushed — merge from the local ref. All eight gated green by `.githooks/pre-commit`: typecheck 0, 1992 tests / 76 files. Real and large: `src/legacy/game.js` (+370: CONFIG derivation, HUD band inset, the mousemove listener, `reticleAt`, two balance constants), `src/sim/talents.ts` (+178) & tests, `src/render/talent-sigils.ts` (new), the aim-mapping split in `src/sim/input.ts` (new exported `pointerToCanvas`, alongside `noteKeyDown`/`noteKeyUp`), `docs/talents.md`, `.gitignore` (+`crow-archer-complete.html`), balance (`maxPickupsOnMap` 3->8, `guardSpeed` 74->110, both carrying the 2.62x-area figure). **Scope call, not a defect:** scaling the bastion tower count is NOT on this tip — it is structural (`towerSites` returns a two-tuple by type) and needs a ten-wave play-through, so it comes later as its own branch off the round. Its own `COORDINATION.md` edit touches only the Aim row; `game.js` is the likely conflict point against any other branch that touches it (e.g. wizard-round's `updateArrows`). |
| `Wizard` | `feat/wizard-round` | The wizard's round: fix the bolt (done), balance the glass cannon (7 HP / 2.5x), feel & feedback; focus explicitly out of scope; talent tree is a retune of the five existing wizard entries, not a new tier | `started` | `915d4a1` | current | no | 09-02 | **Owner says do NOT queue for round 7 yet** — Alex set the scope 09-02, two of the three vectors are still to build; owner will message when finished. Cut from the round-7 base `master` `d8f46ad`, worktree `.claude/worktrees/wizard-round`, unpushed; take `915d4a1` as authoritative (its own row still marks Head `pending` — a SHA field cannot name the commit that writes it). Two things for the eventual merge, both in `915d4a1`: (1) it edits `src/sim/targeting.ts` (new `nearestHostileAmong`) and `src/legacy/game.js` (`spawnSkeleton`, `spawnSoldier`, the wizard bolt block in `updateArrows`) — a structural collision point against `feat/archer-round`'s `game.js`; Wizard will resolve with both diffs open. (2) It DELETES the `game.test.ts` characterisation test "does NOT home toward a skeleton or a soldier, which is a known gap" and replaces it with four tests asserting the fix — a merge that re-adds the old test would re-assert the bug, so watch it. This closes the ownerless homing-bolt finding below, which was two defects: the bolt's hit loop also never tested `soldiers`, so the wizard's primary passed clean through the whole garrison on every cavern map. |
| `portf demo prep` | `chore/public-hygiene` | Public-repo hygiene for the demo: sanitize the coordination ledger / strip local paths, plus a flight-recorder page-load-id | `finished` | `02547c0` | current | **yes** | 09-02 | **Owner confirmed finished 09-02.** 3 commits, cut from the round-7 base `master` `d8f46ad`, unpushed, no worktree currently. Real feature, wanted: a per-page-load client id on every flight record (`cid`, minted in `send()`, covers `bye`; `src/dev/flight-recorder.ts` + 8 tests), the wire-format + ER updates in `docs/playbooks/monitored-playtest.md`, and the README playbook row. **Correction to the lessons-row note:** it does NOT edit `CLAUDE.md` (zero changes — take that file from round 7). **COORDINATION.md:** nothing of its text needs to survive; take the round-7 ledger as base. What MUST survive is the sanitization *effect* — round 7 must not carry to master (1) the home-dir path at `docs/playbooks/monitored-playtest.md:119` and (2) the internal session codename in the open-findings section (genericized here to `session-39b`). Its `.gitignore` change is a single stray trailing blank line (drop it). |

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
  it does, and this is the loose end beside it. Belonged to `session-39b`
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
