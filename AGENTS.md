# Contributing — humans and agents

This repo is worked by several contributors at once, some of them AI agents.
It keeps **one home per fact**, so this page routes you to the homes rather
than restating them. Read it once before your first change; it is short on
purpose.

## Read first

- **[CLAUDE.md](CLAUDE.md)** — the working rules: triggers and the action each
  one demands (sprites, events, the bastion, tests, shell and git). Read it
  before writing code; it is the distilled cost of every trap this codebase
  has already fallen into.
- **[docs/architecture.md](docs/architecture.md)** — the tech, the sim/render
  split, the console verbs, the flight recorder.
- **[docs/playbooks/](docs/playbooks/README.md)** — what specific kinds of
  work have cost, one file per kind (character rebuilds, monitored playtests).

## Set up and stay green

```
npm install
npm run hooks:install    # once per clone AND once per worktree
npm run dev              # play at the printed localhost URL
npm test                 # vitest, the whole suite
npm run typecheck        # tsc for src, and tsconfig.legacy.json for game.js
```

`npm run hooks:install` is not optional and not once-per-machine: the git hook
path is per-worktree, so a fresh worktree starts unguarded. The pre-commit
hook refuses a commit while typecheck or tests are red — see CLAUDE.md's
"enforced mechanically" table for the full list of what the build holds for
you and what it leaves to you.

## Branch and land

- **Never commit to `master`.** Cut a feature branch from a freshly fetched
  `master`, and everything reaches `master` through a pull request — including
  a one-line docs fix.
- **One logical change per commit**, Conventional Commits, a message that says
  why.
- **Fixed a bug?** Revert the fix, watch the test go red, restore it. A test
  that stays green with the fix gone is not covering the fix.
- Parallel agent sessions additionally coordinate branch order through the
  session ledger; if you are one, read it before you start so your task is not
  already someone's row.

## Lessons: leave the next contributor better off

When a trap, a bug, or a practice here costs you real time, append it to
**`LESSONS.jsonl`** so the next contributor meets it already warned. One
self-contained JSON object per line, for example:

```json
{"id":"wasd-shift-latch","date":"2026-08-30","topic":"input","level":"fix","lesson":"Holding a key across a Shift press makes the OS auto-repeat it under its shifted name (w becomes W), orphaning the first keys entry so keyup clears the wrong one and the key jams its axis. Fix: release a code's old name when it repeats under a new one.","refs":["src/sim/input.ts"],"session":"fix/wasd-shift-latch"}
```

- **`id`** and **`topic`** are kebab-case; `id` is unique and is how other
  lessons and docs link to this one.
- **`level`** is one of `trap` (a hazard to avoid), `fix` (a bug and its
  resolution), or `practice` (a way of working that paid off).
- **`lesson`** must read on its own — it is the whole point of the entry, and
  the thing a future reader or tool consumes without the other fields.
- **`refs`** (optional) links files, PR numbers, or other lesson `id`s;
  **`session`** (optional) is who learned it.

Two rules make it safe for many sessions to share one file: **append only —
never rewrite a past line**, and let `LESSONS.jsonl` hold the dated episode
while [CLAUDE.md](CLAUDE.md) holds any imperative rule it grows into, linked by
`id`. The exact schema is enforced by [`src/lessons.test.ts`](src/lessons.test.ts),
which is its one authoritative home; if your entry is malformed, that test
fails before your commit does.

## Where things live

| Area | Path |
|---|---|
| Game logic (the legacy monolith) | `src/legacy/game.js` |
| Simulation modules | `src/sim/` |
| Rendering and sprites | `src/render/` |
| Multiplayer client and server | `src/net/`, `src/server/` |
| Dev tooling (flight recorder) | `src/dev/` |
| Prose docs, playbooks, balance | `docs/` |
