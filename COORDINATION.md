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
| `Merger` | `integration/round-7` | Integrate round 7, keep origin clean, open the PR | `started` | `see tip` | n/a | n/a | 09-02 | Cut from `master` `d8f46ad`. Worktree `.claude/worktrees/integration-r7`. **Merged, each gate-green:** `feat/lessons-ledger` (`5c50a5f`), `feat/archer-round` (`4396004`), `chore/public-hygiene` (`f041ccd`), `feat/hero-balance` (this merge). Public-hygiene's sanitization preserved (home-dir path out of `monitored-playtest.md`, `session-39b` for the codename). **DECISION 09-02 (Alex): wizard-round's talent system is canonical.** archer-round and wizard-round independently filled the same talent slots on a master base; wizard's wins for its even tier pricing (12% cost spread vs round-7's 36%) and its third rites, and its ids match the icon set (archer's would cost ~a day of icon rework). archer's **11 added talents are declined, not lost** — re-addable later per-talent (priced at 3 to wizard's rule), an afternoon each; the 6-vs-5-talents / 2-vs-3-rites shape is a design choice Alex owns. **Reconciliation routed to `talent-icons-fe`:** port wizard's `talents.ts` / `talent-sigils.ts` / its `game.js` talent hunks onto round 7, KEEP archer's non-talent `game.js` work (aim/HUD/reticle/balance) — reconciler must read archer's 6 game.js hunks — gate-green, `talent-icons` rebased on top; then Alex play-tests, then Merger merges. **Held for Alex's play-test:** `feat/bastion-tower-count`. |
| `Merger` | `feat/lessons-ledger` | The lessons ledger: `LESSONS.jsonl` (append-only, schema-tested), `AGENTS.md` for contributors, and the CLAUDE.md pattern | `finished` | `a0fb57c` | current | **yes** | 08-30 | Alex asked to evolve lessons-learned away from a table column into `LESSONS.jsonl`: one JSON object per line, `id`/`date`/`topic`/`level`/`lesson`(+`refs`,`session`), append-only so parallel sessions do not clobber, machine-shaped for a future fine-tuning pipeline. `src/lessons.test.ts` is the one home for the schema and is wired into the enforced-mechanically table; proven to fail on a malformed line before restoring green. Migrated the old "Traps that have already cost time here" section into `LESSONS.jsonl` (six traps + this session's three + the monitored-playtest practice) and left a pointer. **Collision with `chore/public-hygiene`** (now 3 commits at `02547c0`, unpushed): `5352ac1` deleted this whole file, but the tip `02547c0` reverts that — "keep the ledger, genericize it instead" — so it is a modify/modify against my round-7 ledger now, not a modify/delete. Resolve by taking the round-7 `COORDINATION.md` as base (LESSONS.jsonl already holds the migrated content) and folding in only genuine genericization. Both branches also edit `CLAUDE.md`. See the `chore/public-hygiene` row below. |
| `Aim` | `feat/archer-round` | Release polish + archer talents: unstick aim outside the canvas, post-resize rebalance, the archer's three talent trees (tower-count scaling deferred) | `finished` | `a9a68c3` | current | **yes** | 09-02 | **Owner confirmed finished 09-02.** 8 commits (code tip `6926f11`, ledger commit `a9a68c3` on top), cut from the round-7 base `master` `d8f46ad`, in the main clone's own working dir, unpushed — merge from the local ref. All eight gated green by `.githooks/pre-commit`: typecheck 0, 1992 tests / 76 files. Real and large: `src/legacy/game.js` (+370: CONFIG derivation, HUD band inset, the mousemove listener, `reticleAt`, two balance constants), `src/sim/talents.ts` (+178) & tests, `src/render/talent-sigils.ts` (new), the aim-mapping split in `src/sim/input.ts` (new exported `pointerToCanvas`, alongside `noteKeyDown`/`noteKeyUp`), `docs/talents.md`, `.gitignore` (+`crow-archer-complete.html`), balance (`maxPickupsOnMap` 3->8, `guardSpeed` 74->110, both carrying the 2.62x-area figure). **Scope call, not a defect:** scaling the bastion tower count is NOT on this tip — it is structural (`towerSites` returns a two-tuple by type) and needs a ten-wave play-through, so it comes later as its own branch off the round. Its own `COORDINATION.md` edit touches only the Aim row; `game.js` is the likely conflict point against any other branch that touches it (e.g. wizard-round's `updateArrows`). |
| `Wizard` | `feat/wizard-round` | The wizard's round: fix the bolt (done), balance the glass cannon (7 HP / 2.5x), feel & feedback; focus explicitly out of scope; talent tree is a retune of the five existing wizard entries, not a new tier | `started` | `d424479` | current | no | 09-02 | **Owner says do NOT queue for round 7 yet** — Alex set the scope 09-02, two of the three vectors are still to build; owner will message when finished. Cut from the round-7 base `master` `d8f46ad`, worktree `.claude/worktrees/wizard-round`, unpushed; take `915d4a1` as authoritative (its own row still marks Head `pending` — a SHA field cannot name the commit that writes it). Two things for the eventual merge, both in `915d4a1`: (1) it edits `src/sim/targeting.ts` (new `nearestHostileAmong`) and `src/legacy/game.js` (`spawnSkeleton`, `spawnSoldier`, the wizard bolt block in `updateArrows`) — a structural collision point against `feat/archer-round`'s `game.js`; Wizard will resolve with both diffs open. (2) It DELETES the `game.test.ts` characterisation test "does NOT home toward a skeleton or a soldier, which is a known gap" and replaces it with four tests asserting the fix — a merge that re-adds the old test would re-assert the bug, so watch it. This closes the ownerless homing-bolt finding below, which was two defects: the bolt's hit loop also never tested `soldiers`, so the wizard's primary passed clean through the whole garrison on every cavern map. **Now at `d424479`** — owner committed past `915d4a1` (the blink line, the bolt multiplier, the talent rites). `feat/talent-icons` is stacked on this exact tip, so this branch must not be rebased out from under it; merge order is wizard-round first, then talent-icons's delta. **DECISION 09-02 (Alex): this talent system is canonical** (over archer-round's — see the Merger row). It is NOT merged directly: `talent-icons-fe` reconciles it onto round 7 (keeping archer's non-talent `game.js`), gate-green, `talent-icons` on top; then Alex play-tests and Merger merges. Session inactive at `d424479`. |
| `portf demo prep` | `chore/public-hygiene` | Public-repo hygiene for the demo: sanitize the coordination ledger / strip local paths, plus a flight-recorder page-load-id | `finished` | `02547c0` | current | **yes** | 09-02 | **Owner confirmed finished 09-02.** 3 commits, cut from the round-7 base `master` `d8f46ad`, unpushed, no worktree currently. Real feature, wanted: a per-page-load client id on every flight record (`cid`, minted in `send()`, covers `bye`; `src/dev/flight-recorder.ts` + 8 tests), the wire-format + ER updates in `docs/playbooks/monitored-playtest.md`, and the README playbook row. **Correction to the lessons-row note:** it does NOT edit `CLAUDE.md` (zero changes — take that file from round 7). **COORDINATION.md:** nothing of its text needs to survive; take the round-7 ledger as base. What MUST survive is the sanitization *effect* — round 7 must not carry to master (1) the home-dir path at `docs/playbooks/monitored-playtest.md:119` and (2) the internal session codename in the open-findings section (genericized here to `session-39b`). Its `.gitignore` change is a single stray trailing blank line (drop it). |
| `Aim` | `feat/bastion-tower-count` | Scale the bastion tower count with the map — the item Aim deferred off `feat/archer-round` | `blocked` | `14d05c4` | current | no | 09-02 | **Do NOT merge yet — not play-tested.** Cut off `master` `d8f46ad`, 2 commits (`a0ef7dc` the change, `14d05c4` the ledger row), gate-green: typecheck 0, 1967 tests / 75 files. **Departs from what Alex picked:** he chose area-scaling (~5 towers at 55x33); Aim built it HEIGHT-scaled, which yields **4**, because `BARRIER_REACH_COLS` already settled in round 6 that extra width is open ground to cross, not a bigger keep — area-scaling would reverse that. Four is also the geometric ceiling (`isSpawnZone` clears ±3 centre rows and `TOWER_SPAN` needs separation, so a fifth has nowhere symmetric). Blocked on Alex's ten-wave play-test and his call on 4 vs forcing 5; Aim is putting that to him. Round 7 does not wait on it — lands if signed off before the round closes, else round 8, and **the PR is not held for it**. Touches `src/legacy/game.test.ts` (four hardcoded `2`s now routed through a `towerCount()` helper) → conflicts with `feat/wizard-round`, which also edits that file. |
| `Icons` (`talent-icons-99`) | `feat/talent-icons` | Talent-tree icon set: the icon SOURCE (`.py`/`.mjs`) under `_design/talent-feedback/` that generates every talent's sigil | `finished` | `(see tip)` | `reconcile/talents-on-r7` | no | 09-02 | **Owner confirmed finished 09-02.** **Stacked on `feat/wizard-round` (`d424479`), not `master` — merges AFTER it.** Six commits on top of wizard-round; footprint **vs wizard-round** is 55 files ALL under `_design/talent-feedback/` except `.gitignore` and `COORDINATION.md` — **nothing under `src/`**, so no collision with any gameplay branch (the `game.js`/`blink`/`talents`/`talent-sigils.ts` changes belong to wizard-round, not here). Green through pre-commit on every commit. **Genuinely ordered, not conventionally:** `draw-icons.py` coverage-checks the icon set against `src/sim/talents.ts` both directions, and four talents it draws — DEAD EYE, BULWARK, HOLDFAST, MINEFIELD — exist only on wizard-round, so merged before it the icon build fails by name (intended). If Wizard commits past `d424479`, ping `talent-icons-99` and it rebases onto the new tip before merge. **`.gitignore`:** `_design/` is deliberately no longer wholly ignored (commit `ee4f8c1`) — only the ~60 KB icon source is tracked; all generated output stays ignored (`icons32.js`, the 2.5 MB render cache, `Sigils.dc.html`, the 3.4 MB bundle). A MB-scale file in the diff would be a bug. **The 14 `icons/*` scratch worktrees + branches are pruned** (owner did it, containment proven: 169 files hash-checked vs `2c5c936`, one deliberate replacement archived outside the repo). **Rebased 09-02 off `feat/wizard-round` onto `reconcile/talents-on-r7`**, which is where wizard's talent system now lives. That settles the thing this branch was always exposed to and nobody had measured: the forty icons are drawn against WIZARD's ids, so against the archer round's tree eleven had no talent and eleven talents had no icon, and `draw-icons.py` checks both directions plus each icon's hero. On the reconciled tree it prints 40 of 40. Had the call gone the other way this branch owed eleven new icons and eleven retirements -- about a day -- which is the cost that was invisible in the diff. |
| `Talents` (`talent-icons-fe`) | `reconcile/talents-on-r7` | Fold `feat/wizard-round`'s talent system onto round 7, which already carries the archer round's. Alex's call: wizard's is canonical. | `finished` | `(see tip)` | `integration/round-7` `6a2ebf0` | supersedes the archer round's talent table; keeps every non-talent line of it | 09-02 | Both branches extended the SAME system rather than each building one: `master` already had the uniform five-hero shape at 25 talents, three plus two rites per hero, identical in both. The archer round filled the empty slots with six talents per hero in three exclusive FORKS plus two rites; the wizard round filled them with five talents and three rites, and levelled tier pricing so a rank buys the same amount whoever you picked. Wizard's wins, so eleven talents are declined and the fork mechanic goes with them. **Three judgement calls are recorded in the merge commit rather than made silently**: the archer's blast hop is kept but reads `CONFIG.archerBlastHopPx`, because its old scaling was an archer `longThrow` that now means throw SPEED; the braced power-shot cooldown cut is kept and composed with DEAD EYE rather than replaced by it; and the crossbow's in-flight gate goes back to `master`'s reserve rule, which the archer round changed while leaving master's comment above it saying the opposite. |
| `Balance` | `feat/hero-balance` | Knight and sapper base kits (not icons); ranger deliberately deferred. Decisions settled with Alex before code. | `finished` | `bb24d9d` | current | **yes** | 09-02 | **Merged into round 7 (this merge), clean.** Rebased onto `master` `d8f46ad` at Merger's request — cut off `feat/wizard-round` but its only dependency was one `docs/balance.md` paragraph naming WIDER FAN, and wizard-round went inactive with branches queued behind it; code applied to master with no conflict outside this ledger; pre-rebase tip kept as tag `hero-balance-prerebase`. Alex play-tested (charge + chain chip driven in a real run; chip pixels unseen — pane kept hiding → rAF `no-frames` — live state confirmed `peak: 2`). **Knight:** charge ran 0.5x walk (75 px/s, slower than any hero walking), 112 px against a 90 px reach; now 1.6x (360 px), chain 1.1x→2.0x. Bloodlust + one-hit block left by design (the tree answers them). **Sapper:** the chain was the only build-up with nothing on screen — now a lane-D chip holding the last cascade's depth 2 s; `docs/balance.md` gains its row, which surfaced that `sapperChainMaxLinks` is depth not bomb count (MORE LINKS pays only once WIDER FAN widens the fan). **Ranger NOT here** (reload/net/momentum are new mechanics → later branch). Footprint: `game.js`, `game.test.ts`, `docs/manual.md`, `docs/balance.md`; nothing under `_design/`. |

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
