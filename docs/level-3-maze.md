# Level 3: the maze

Design and architecture for the third single-player level. Written to be read
before any code exists, so the shape can be argued with while arguing is still
cheap.

The point of this document is not the maze. It is that a third map is the
smallest possible feature that breaks the map abstraction this project already
has, which makes it a good place to show what the existing guardrails buy and
what they cost. Every claim below points at a real file and line.

- [The three parts](#the-three-parts)
- [Part 1: the maze map](#part-1-the-maze-map)
- [Part 2: what lives in the maze](#part-2-what-lives-in-the-maze)
- [Part 3: the objective and stage wiring](#part-3-the-objective-and-stage-wiring)

## The three parts

Terrain, then inhabitants, then reason to be there. Each part is independently
playable and independently revertable.

| Part | Delivers | Breaks |
|---|---|---|
| 1. The maze map | A third `MapKind` that generates, renders, and spawns correctly | `MAP_GEN`'s row shape |
| 2. What lives in it | The enemy that makes a corridor frightening | `boss.kind`'s branch-not-table decision |
| 3. The objective | A win condition that is traversal, not extermination | `bossStage` doing two jobs |

Part 1 is specified below. Parts 2 and 3 are proposals, sketched at the end.

## Part 1: the maze map

### What exists today

A map is a string tag with tables hanging off it. This is the same
composition-over-inheritance shape documented for characters in
[Design patterns](design-patterns.md#composition-over-inheritance-character-definition).

| Name | Where | Shape |
|---|---|---|
| `MapKind` | `src/sim/arena-map.ts:25` | `'forest' \| 'castle'` |
| `MAP_GEN` | `src/sim/arena-map.ts:38` | `Record<MapKind, { density: number }>` |
| `TILE_THEMES` | `src/render/tiles.ts:202` | `Record<MapKind, Partial<Record<TileId, TilePainter>>>` |
| `ANIMATED_THEMES` | `src/render/tiles.ts:312` | `Record<MapKind, AnimatedPalette>` |
| `MAPS` | `src/net/protocol.ts:394` | `readonly MapKind[]`, backs `isMapKind` at :424 |

`MAP_GEN` has exactly two consumers: `Terrain.fromSeed`
(`src/sim/arena-map.ts:78`) and `generateMap` in the legacy single-player file
(`src/legacy/game.js:520`). Both do the same thing with it. They pass
`MAP_GEN[kind].density` into `generateGrid`.

Widening the union to `'forest' | 'castle' | 'maze'` produces three compile
errors, one per `Record`, and leaves `MAPS` as the one runtime edit the
compiler cannot find. That is the pattern working exactly as designed, and it
is worth saying plainly: **the type system will do most of this refactor for
you.** The problem is not finding the call sites. The problem is what you are
supposed to write once you get there.

### Where it breaks

`density` is not a general knob. It is a noise threshold multiplier, and it
only means anything inside `generateGrid`:

```js
const cut = (base) => 1 - (1 - base) * density;
const waterAt = cut(0.76);
const rockAt  = cut(0.77);
const treeAt  = cut(0.76);
```

`src/sim/mapgen.ts:28`

Forest and castle differ only in how much simplex noise survives thresholding.
They are the same algorithm with two settings, which is precisely why one
number per row was the right call when castle was added.

A maze is not that algorithm at any setting. Noise scatters tiles that happen
to cluster. A maze carves corridors that are guaranteed to connect. There is no
value of `density` that turns one into the other, so `MAP_GEN.maze` would be a
row that exists only to satisfy the compiler and that nothing reads.

This is the same criterion [architecture.md](architecture.md#boss-the-deliberate-exception)
already states for bosses:

> A table earns its keep when new rows are mostly data; bosses here are mostly
> algorithm.

Maps were mostly data. The maze is the row where that stops being true.

### Three ways forward

**Option A: branch inside `generateGrid`.** Add `if (kind === 'maze')` at the
top and carve instead of threshold.

Pro: smallest diff, one file, ships in an afternoon.

Con: it is the thing the project's guardrails name explicitly. *Adding a
variant must be a new implementation, not an edit inside an existing core
loop.* It also forces `generateGrid` to take a `kind` it currently does not
know about, which pushes map identity down into a function whose entire job is
to be a pure grid builder. The second exotic map makes it a three-way branch,
and the branch is now the real design.

**Option B: make the row shape a union.** `{ density: number } | { braid: number }`,
discriminated on kind.

Pro: keeps one table, stays honest about the fields being unrelated.

Con: every consumer has to narrow before it can read anything, and there are
two consumers today that currently just say `.density`. It spreads the branch
rather than removing it, and the narrowing has to be repeated in the legacy
file, which has no type checking to enforce it.

**Option C, recommended: the row becomes a generator.** `MAP_GEN` stops being
a config table and becomes a Strategy table.

```ts
export interface MapGenerator {
  generate(rows: number, cols: number, rng: Rng, noise: Noise2D | null): TileGrid;
}

export const MAP_GEN: Record<MapKind, MapGenerator> = {
  forest: new NoiseTerrain({ density: 0.45 }),
  castle: new NoiseTerrain({ density: 0.5 }),
  maze:   new MazeTerrain({ braid: 0.15 }),
};
```

`Terrain.fromSeed` loses its knowledge of density entirely:

```ts
map.reset(MAP_GEN[kind].generate(MAP_ROWS, MAP_COLS, mulberry32(seed), noise(seed)));
```

`NoiseTerrain` is today's `generateGrid` with its density captured at
construction. `MazeTerrain` is new code that shares nothing with it. Neither
knows the other exists.

**Pros.**

- The tag stays a tag and the table stays a table. Only the row's value type
  gets richer, so `TILE_THEMES`, `ANIMATED_THEMES`, `Terrain`, `pickSpawns`,
  the protocol and the wire format are all untouched. This is the cheapest
  possible change that does not lie.
- A fourth map is a new class, not an edit. That is the guardrail satisfied
  rather than argued around.
- Per-generator tuning stops being one flat number. `NoiseTerrain` can keep
  three thresholds instead of deriving them from one multiplier, if that ever
  becomes useful.
- It is testable in isolation. `MazeTerrain.generate` is pure given an `Rng`,
  so its connectivity guarantee can be asserted over a hundred seeds in a
  `vitest` file with no DOM and no game loop.

**Cons, stated plainly.**

- It is more machinery than two maps needed. If the maze were the last map
  this game ever got, Option A would be the correct engineering call and this
  would be over-design. The bet is that map count keeps growing.
- Classes with one method are a function with extra steps. `MapGenerator`
  could be `Record<MapKind, GenerateFn>` and lose nothing today. Classes are
  proposed only because `NoiseTerrain` genuinely carries construction
  parameters and `MazeTerrain` will carry more of them. If that turns out to be
  wrong, the interface collapses to a function type without touching callers.
- `src/legacy/game.js:520` has to change too, and it is untyped, so nothing
  catches it if the signature drifts. Until the core/shell split lands and
  that file gets tests, this edit is verified by playing the game.
- One indirection is added between "which map" and "what it looks like". A
  reader chasing forest generation now goes tag, table, class, method instead
  of tag, table, function.

### The invariant a maze introduces

Noise maps have no connectivity guarantee and do not need one. An unreachable
pocket of grass behind a rock cluster costs nothing: crows fly, and a player
simply never goes there.

A maze must connect, or the level is unfinishable. That is a new class of
requirement for this codebase, and it invalidates a documented assumption. From
`src/sim/spawns.ts:80`:

> Every tile within twelve of the anchor is solid, which the generator does not
> produce.

A maze generator absolutely can produce that. A spawn anchored at
`{x: 0.82, y: 0.72}` can land in a walled cell, and `nearestStandable` rings
outwards to twelve tiles and then falls back to the anchor itself, which puts a
body inside a wall.

Two things follow.

**The generator must guarantee reachability, not hope for it.** A carving
algorithm gives this for free: a recursive backtracker visits every cell
exactly once, so every open cell is reachable from every other by construction.
That is a stronger guarantee than a post-hoc flood fill and it costs nothing
extra.

**The guarantee should be checked anyway, once, at construction.** This is the
guardrail about wrapping values that have rules:

> Passing a bare String/int that has rules (id, count, size, path)? Wrap it in
> a newtype that enforces the rule at construction.

A `TileGrid` that must be connected is exactly such a value. A flood fill over
33x21 is 693 tiles and runs in microseconds, so asserting it in
`MazeTerrain.generate` before returning is free at runtime and turns a class of
unplayable-level bug into a loud failure. It also gives the test a single
assertion to make across many seeds.

**One property worth noticing:** destructible terrain is safe here. Dynamite,
Lightning Storm and Whirlwind clear `ROCK`, `TREE` and `HUT`
(`Terrain.destroyArea`). Removing walls can only ever add connections, never
remove them, so the invariant holds under every in-game mutation without
anything having to re-check it. Players digging shortcuts through maze walls is
a feature that costs zero architecture.

### Algorithm and grid fit

The arena is 33 by 21 tiles (`MAP_COLS`, `MAP_ROWS`, `src/sim/arena-map.ts:47`).
Standard carvers place cells on odd indices with walls between them, which
needs odd dimensions in both axes. 33 = 2(16) + 1 and 21 = 2(10) + 1, so the
existing grid is exactly a 16 by 10 cell maze with no resizing and no border
special-casing. That is luck, but it is usable luck.

**Recommended: recursive backtracker, then braid.**

A perfect maze has exactly one path between any two points. That reads well on
paper and plays badly in an action game: every wrong turn is a dead end, every
dead end is backtracking, and a ranged character with an 80 pixel sightline
spends the level walking. Braiding removes a fraction of dead ends by knocking
out one wall each, which creates loops. Loops give you flanking, escape routes
and circular chases.

`braid: 0.15` is a starting number and nothing downstream depends on it. Tune
it by playing.

Alternatives considered: Prim's algorithm produces more uniform, less
corridor-like mazes with many short branches, which suits a maze you look at
more than one you run through. Recursive division is fastest but yields long
straight walls and obvious rooms, which undercuts the whole point of the level.

### What this costs the rest of the engine

Flagged, not solved. These are consequences to measure once it runs, not
blockers.

- **Field of view gets cheaper, cache churn gets worse.** `rot.js`
  `PreciseShadowcasting` has less to trace in a corridor. But the FOV cache
  invalidates when the player moves to a new tile
  ([architecture.md](architecture.md#tech)), and maze movement crosses tile
  boundaries constantly, so recompute frequency goes up even as each recompute
  gets cheaper. Net effect is unknown until measured.
- **A\* paths get long and winding.** `PathScheduler` budgets pathfinding work
  per frame. A maze is the worst case for path length, and this is the most
  likely place for a real frame-time regression. Measure it in the same
  headless harness rather than by feel.
- **Ranged characters get weaker and melee gets stronger.** Corridors are the
  knight's terrain. The archer, wizard and ranger all lose most of their range
  advantage. This is a balance consequence of geometry, and it is worth
  deciding on purpose whether that is the level's identity or a problem to
  compensate for.
- **The crow corridor assumption disappears.** `generateGrid` always leaves the
  right-hand two columns open so crows can enter (`src/sim/mapgen.ts:53`).
  `MazeTerrain` has no such corridor unless it is built in deliberately. Part 2
  has to say where enemies come from.

### Scope of Part 1

Done when: `maze` is a valid `MapKind` end to end, generates a connected
braided maze from a seed, renders with its own theme, spawns players on
walkable tiles, is selectable in the multiplayer lobby, and has a `vitest` file
asserting connectivity across many seeds.

Not in Part 1: enemies, objective, stage progression, single-player entry. The
maze is reachable through the multiplayer lobby's existing map picker first,
because that path already exists and needs no new state machine.

## Part 2: what lives in the maze

Proposal.

A maze changes the threat model before it changes anything else. Sightlines
drop from most of the arena to one corridor, which means enemies that walk at
you in the open are trivial and enemies that appear around a corner are not.

Movement is in better shape than expected. Skeletons already path: they call
`pathScheduler.request(s)` (`src/legacy/game.js:1999`) and only beeline as a
fallback when no path exists. Aggro crows do the same. Both work in a maze
with no change at all.

Two things do break, and neither is movement.

**Passive crows fly through walls.** A passive crow moves `c.x -= spd * dt`
with no terrain check and wraps when it leaves the left edge
(`src/legacy/game.js:2168`). On an open forest map that reads as a bird
crossing the sky. Inside a maze it reads as a bug.

**Screech-aggro almost never fires.** `aggroCrows` only converts crows that
pass a `tileVisible` line-of-sight check (`src/legacy/game.js:2204`), which is
correct on an open map and nearly always false in a corridor. Any maze
antagonist that summons or aggros needs a rule that is not line of sight.

The interesting design question is whether the level's antagonist is a boss at
all. A maze suggests something that hunts: it knows the layout, it moves faster
than you, and the tension is in hearing it before seeing it. That is closer to
a stalker than to the three arena bosses.

Architecturally this is where `boss.kind` gets re-examined.
[architecture.md](architecture.md#boss-the-deliberate-exception) records the
deliberate choice to branch on it rather than table it, justified by "exactly
three bosses, ever". A fourth boss with genuinely different movement is the
event that decision was implicitly waiting for. Part 2 either honours the
original reasoning by making the maze's antagonist not-a-boss, or it revisits
the decision honestly. Both are defensible. Pretending the question did not
come up is not.

## Part 3: the objective and stage wiring

Proposal.

A maze whose win condition is "kill everything" is just a cramped arena. The
level wants traversal: reach the exit, or find a thing and get out. That is a
different verb from every level so far, and it is the part most likely to make
the game feel like it has three levels rather than two levels and a variant.

This is also where the current stage wiring runs out. `bossStage`
(`src/legacy/game.js:429`) is a 1-based index into
`BOSS_STAGES = ['crowking', 'dark_archer', 'dark_knight']` at :2351, and it
does two unrelated jobs: it picks which boss spawns, and it implies which map
you are on. The castle transition is a literal hardcoded beat inside
`updateBossDeath` at :2917-2918:

```js
bossStage = 2;
generateMap('castle');
```

There is no level concept to extend. Adding a third level means either a fourth
boss stage that is not a boss, or splitting level identity out of `bossStage`
into its own progression. The second is correct and is the same
`Record<Kind, X>` move made everywhere else in this codebase.

Part 3 is also where the state-table refactor proposed for `appState` pays for
itself. `castle_intro` already had to bypass `transitionTo` by assigning
`appState` directly (:2930) because the transition helper unconditionally calls
`initGame()` and would have wiped the run. A third level adds a second such
screen and a second bypass. One table with an explicit `keepsRun` property
removes both.

## Open questions

1. Does the maze belong in single-player, multiplayer, or both? Part 1 targets
   multiplayer first only because that path needs no new state machine, not
   because it is the better home.
2. Is a maze that ranged characters find frustrating a design failure or the
   level's identity?
3. Should maze walls be destructible? The invariant holds either way. Making
   them solid preserves the maze; making them breakable makes dynamite a
   navigation tool and rewards the archer in a level that otherwise punishes
   them.
