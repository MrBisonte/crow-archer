# CROW ARCHER — working rules

Triggers and the action each one requires. Rationale lives in `docs/`;
this file links rather than restates, so there is one home per fact.

Read this before writing code. `docs/design-patterns.md` is 465 lines of
reasoning and nothing makes you read it before writing a draw function —
which is how the rule at its line 216 was broken by the person who had
just read it.

## Coordination — do this before your first commit

- **Starting work in this repo?** Add your row to `COORDINATION.md` before
  you commit anything, and update it on every commit after that. Several
  sessions share these branches and a branch nobody logged is a branch that
  gets clobbered.
- **Cutting a branch?** Fetch and fast-forward `master` first, every time —
  `git -C <clone> fetch origin --prune --tags && git -C <clone> fetch origin
  master:master`. The local ref goes stale silently and a branch cut from it
  starts a release behind. Two clones of this repo sit on disk and both were
  stale at the end of round 4. `master:master` refuses a non-fast-forward,
  which is the guard you want; `git pull` on a checked-out `master` merges.
- **Pushing anything?** Only the current integration branch may push to
  `origin`, and `master` moves only by a merged PR. `COORDINATION.md` names
  that branch — it is the one home for the round number — and everything
  else reaches the remote through it.
- **Colliding with another branch?** Merger is the coordinating session and
  decides merge order; it can ask any session in the ledger to update its row
  or resolve a gap. A structural collision is resolved by the author of the
  branch that caused it, with both diffs open — not by whoever merges last.

## What is enforced mechanically, and what is not

| Rule | Enforced by |
|---|---|
| No commit while typecheck or tests are red | `.githooks/pre-commit` |
| `game.js` binds every name it calls | `tsconfig.legacy.json` |
| Every event declared, handled and emitted | `events.coverage.test.ts` |
| A siege run can be finished | the ten-wave play-through |
| Everything below | nothing. You. |

Run `npm run hooks:install` once per clone **and once per worktree** —
the hook path is per-worktree, so a fresh worktree starts unguarded.

## Sprites

- **Writing a `draw*` that builds a `PixelGrid`?** Memoize the grid in a
  module-level cache keyed by everything that varies, the way
  `_skeletonGrids` and `_guardGrids` do. `stamps.get` returns a cached
  canvas *without calling the painter*, so an unmemoized grid is built
  and thrown away every frame. See `docs/design-patterns.md`.
- **Painting structure in `C.edge`?** Don't. That is the outline seam
  and a source-text test fails by name.
- **Changing a stride?** Four separate legs on every frame. Pairs two
  columns apart fuse under the outline pass for exactly one frame.
- **Rebuilding a character?** Read `docs/character-rebuild-playbook.md`
  first. It is what the archer's rebuild cost: the profile convention,
  the outline gap that welds legs, the two render paths plus the
  select-screen preview, and the harness traps that eat an hour each.

## Events

- **Emitting a new event?** It needs three things or the build fails: a
  variant in `src/sim/events.ts`, a `case` in the handler, and the emit
  itself. `events.coverage.test.ts` walks all four directions between
  those sets.
- **Adding a high-frequency one?** Route the sound through a voice
  window. Twelve guards swinging on their own timers stack twelve
  clangs into one frame; `retinueVoice` is the existing one.

## The bastion

- **Gating siege behaviour?** Branch on `mapPopulation() === 'siege'`,
  never `gameMode === 'siege'`. The bastion is reachable two ways — the
  S menu and the maze door as the campaign's last stage — and a mode
  check leaves one of them inert. That exact bug already shipped once
  for Waves + Castle; see `src/sim/game-mode.ts`.
- **Adding a stage-transition tail?** Check whether a siege is running
  before handing off. A siege runs in `'playing'`, so a tail that
  assumes `'boss_fight'` will load the castle mid-wave.

## Tests

- **Advancing a siege?** `clearSiegeWave()` *deletes* the field;
  `killSiegeBoss()` *kills* through the real death sequence. Ten waves
  cleared the first way never enters a death sequence at all, which is
  how a total freeze survived a green suite.
- **Fixed a bug?** Revert the fix and watch the test fail before you
  commit. If it still passes, the test is not covering the fix. Prefer
  reverting the *specific line*: a test can cover half a function.
- **Driving a long run?** `devHooks.healHero()`. Nobody is holding the
  keys, so an idle hero dies and the test measures that instead.
- **A siege test that reads ranks?** `g.setSiegeRng(mulberry32(seed))`
  in `beforeEach`. Unpinned, the retinue roll decides the assertion —
  this flaked five runs in twelve.
- **Asserting a table's shape?** Compare the exact key set, not
  `toHaveLength(n)`. A length check catches a deletion and misses an
  addition.

## Shell and git

- **Gating a command on another's success?** Never through a pipe.
  `tsc | grep error && git commit` runs the commit *because grep
  succeeded* — a pipeline's exit status is its last command's. Capture
  exit codes into variables and branch on those.
- **Scripting an edit?** Assert the match count. A `str.replace()` that
  matches nothing returns the string unchanged and reports success;
  `checkJs` was off, so a silently-missed import shipped as a crash.
