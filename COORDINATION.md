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
| `Merger` | `integration/round-4` | Integrate every branch, keep origin clean, open the PR | `started` | `0be414e` | — | — | 08-27 00:15 | Pushed; PR #39 open against master. All seven branches in. Alive — renamed from agitated-lamport, not exited. |
| `robinhood-39b` | `feat/talent-trees-r5` | Talent trees: five hero trees, the draft and rite choosers, the eight unlock effects, drawn sigils | `started` | `bench` | current | **NO** | 08-27 | **Branch renamed.** `feat/talent-trees` (head `b6b57ec`) was cut from `feat/char-redesign`; everything below it landed in master via PR #39, so it was re-cut fresh from master `09f42f6` as `feat/talent-trees-r5`. Same content, honest ancestry — do not look for the old name. **Planned collision, unchanged:** the axis re-split will move kit axes (arrows/restore/tools/pfRange) OUT of `upgrades.ts` while `fix/upgrade-dead-cells` makes those same axes live per-hero in the same files. Sequence: dead-cells lands first, talents consumes its mappings as seed content. |
| `robinhood-39` | `feat/char-redesign` | Rebuild the roster: all five heroes redrawn in profile with a real stride; archer's brace/pierce/quiver; live-drawn bow and staff | `idle` | `ead94d7` | current | yes | 08-27 00:15 | Merger note: tip `ead94d7` (21 commits) merged into r4 as `9f4b5d9`, knight-aim staging fixed in testkit. Row was stale at `1697291`; superseded. Original note: Eight commits past r4's `69662b5`, gate green (typecheck 0, 54 files, 1626 tests). Wizard, knight, ranger and sapper are now profile sprites with baked three-frame strides; the wizard's staff came out of his grid into `render/wizard-staff.ts` (it had been baked **and** painted live by the multiplayer renderer — two staffs). `buildWizardGrid`, `buildKnightGrid` and `buildSapperGrid` **changed signature** to take an `AnimFrame`, and `CHAR_PANELS` rows gained `paintWeapon`. **Collision, unchanged:** `2cb0fc2` rewrites `_drawCharPreview`, which `feat/charselect-screen` also rewrites; merge-tree reports no markers, so a textual merge silently drops one — diff that function by hand. That function is now *more* contested, not less. **I do not own `feat/charselect-screen`.** Merger left the roster; recording here instead of messaging. |
| *orphaned* | `feat/charselect-screen` | Rework the char-select screen: per-hero stats, clickable, panel row from canvas | `finished` | `ddfd0d2` | current | yes | 08-27 00:15 | Resolved by Merger on Alex's call (author unreachable, robinhood-39 disclaimed in writing). 4 hunks: imports+devHooks unions, preview keeps char-redesign's routine under charselect's scale signature, drawCharSelect takes the new panel layout. `_drawCharPreview` diffed by hand per robinhood-39's warning. PASSIVE row survives via SKILL_SLOTS. |
| `Crow Archer branch MAPS` | `feat/playfield-55x33` | Enlarge the playfield to 55x33 and scale the canvas to fit the window | `finished`? | `850a581` | current | yes | 08-25 22:51 | Merged. Status unconfirmed — has not replied. |
| `trusting-khorana-80b923-a0` | `fix/siege-answering-guard-flake` | Score the siege answering test by quarry identity, not by distance | `finished`? | `ddf5ea8` | current | yes | 08-26 10:17 | Merged. Status unconfirmed — has not replied. |
| `xenodochial-dijkstra-b642ec-65` | `fix/siege-wave-advance-flake` | Count sim steps, not frames, when a siege wave advances | `finished`? | `d2e342b` | current | yes | 08-25 19:26 | Merged. Status unconfirmed — has not replied. |
| `blissful-robinson-5963a5-58` | `test/balance-doc-drift` | Pin `docs/balance.md`'s character table to the panel it describes | `finished`? | `289ffb6` | current | yes | 08-26 10:17 | Merged on the assumption it was ready. A peer reported it "awaiting their user" — **say so and Merger will back it out.** |
| `inspiring-mayer-2d82d3-78` | *unknown* | *unknown* | `started` | — | — | — | 08-26 12:15 | New session, has not identified itself. Claim your row. |

A `?` on a status means Merger inferred it from commit timing, not from the
session saying so. Replace it with the real value.

## Traps that have already cost time here

- **Two branches fix the same flake two different ways.** `archer-pierce.test.ts`
  fails about one run in five because the arrow spends a pierce charge on a
  generated tree. r4 has `4277d8a` ("clear the field before the pierce test");
  `feat/char-redesign` has `62fd89b`, which extracts `clearArena` out of
  `game.test.ts` into a new `src/legacy/arena-testkit.ts` and imports it from
  both. Same root cause, incompatible edits to the same `beforeEach`. Take one
  deliberately — a textual merge that keeps both clears the field twice and
  leaves a dead local helper behind.
- **`master` still lacks `d2e342b`** (`fix/siege-wave-advance-flake`, in r4).
  Every branch cut from `master` therefore carries the old frame-counting
  `stepSim(240)` and fails a full-suite run roughly one time in three. It cost
  three blocked commits in this session alone. Re-run rather than debugging it,
  and do not cherry-pick — see the ancestry note below.
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
- **`master` is behind r4 on test stability.** `d2e342b`
  (`fix/siege-wave-advance-flake`) is in `integration/round-4` and never reached
  `master`, so every branch cut from master still carries the old frame-counting
  `g.stepSim(240)` in `game.test.ts`. Measured from `feat/char-redesign`: the
  siege wave-advance test fails about **1 full-suite run in 3**, and passes 4/4
  in isolation. It is not your change. Re-run rather than cherry-picking the
  fix — a cherry-pick duplicates content already in r4 and buys a conflict at
  merge time. It goes away for everyone when r4's PR lands.
- **`git branch -d` refuses a squash-merged branch** as "not fully merged"
  even when every line of it is on `master`. That refusal is not evidence.
