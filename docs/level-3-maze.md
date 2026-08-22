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

All three are built and the maze is on the path a normal run takes: the Dark
Knight's death opens it instead of ending the game. Each part says what it
decided and what it cost.

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

**One property worth noticing, and the decision it did not settle:** destructible
terrain is safe here, in the narrow sense that it cannot break the invariant.
Dynamite, Lightning Storm and Whirlwind clear `ROCK`, `TREE` and `HUT`
(`Terrain.destroyArea`). Removing walls can only ever add connections, never
remove them, so connectivity holds under every in-game mutation without anything
having to re-check it.

That reasoning still stands and the decision went the other way: **maze walls
are indestructible.** Safe for the invariant turned out not to mean good for the
level. A Lightning Storm or a Whirlwind does not dig a shortcut, it clears a
whole neighbourhood of wall at once, and two or three of them leave an open room
with an unkillable minotaur standing in it. The maze is the only thing making
that minotaur dangerous, so a level where a player can delete it on a cooldown
has no fight left. The minotaur breaking walls by charging them stays, because
that is one wall at a time, paid for by being in front of him.

The rule lives in `MAP_RULES` (`src/sim/arena-map.ts`), a second per-map table
next to `MAP_GEN`, one row per `MapKind` with a `destructibleTerrain` flag.
It is separate from `MAP_GEN` because the two are consulted at different times:
`MAP_GEN` builds the grid once, `MAP_RULES` is read every time something tries
to change it. Both sides read the same table. `Terrain.destroyArea` and
`Terrain.burnTile` return early on a map whose row says false, and the legacy
single-player `smashTile` gates on the same row.

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

### The lights are off

Added after the fact, and it belongs here rather than in Part 2 because it is a
property of the map, not of anything in it. `MAP_RULES` grew a `fogOfWar` row
for the same reason it grew `destructibleTerrain`: forest and castle are arenas
you read at a glance, and a corridor level is about not knowing what is round
the corner.

Sight on the maze is four tiles, against fourteen everywhere else. Three states
per tile, painted over the world as one pass after everything else:

| State | Looks like | Why |
|---|---|---|
| Lit now | Clear, fading toward the edge of the circle | A hard rim reads as a spotlight, not a torch |
| Remembered | 74% black | You know the shape of a corridor you have walked |
| Never seen | Black | |

Terrain remembers. Nothing alive does. Enemies, pickups, keys, the chest and the
door are drawn only where the player can see them right now, gated at each
draw call rather than by the overlay, because the overlay would let a rat show
through the dim of a remembered corridor. A rat you cannot see is a rat you do
not get to plan around, and that is the whole point of the level.

The cost is measurable and small: the fog pass is 693 fill calls and one hypot
per tile, and a full frame with it costs 0.3 ms.

**It broke the one shortcut in the file.** `minotaurSeesPlayer` answered "does
the warden see you" by reading the player's FOV cache, which was correct only
because both had the same sight range and shadowcasting is symmetric. At four
tiles against his sixteen, that shortcut becomes "he may only charge from inside
your torchlight", which deletes the reason he exists. He now walks his own line
of sight, from his own tile, over the same passability callback FOV and A* use.

`aggroCrows` had borrowed the same answer with the same intent, and now asks
from the crow at the open maps' old radius, so forest and castle keep the reach
they had. It is also the last caller: `tileVisible` is now read only by the fog.

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

### The minotaur

**Decided.** The maze's antagonist is a minotaur that charges the moment it
sees the hero, cannot be killed, and takes impact and stuns from hero attacks.

Damage stops meaning progress and starts meaning control. Every hit buys
distance, never a step toward winning. That single inversion is what makes the
level a chase rather than a cramped arena, and it decides Part 3 by
implication: if the boss cannot die, the win condition cannot be killing it.

Three of the four mechanics it needs are already built.

**Line of sight is free.** `updateFOV` computes visibility from the player's
own tile (`src/legacy/game.js:550`), and shadowcasting is symmetric in
practice, so `tileVisible(minotaurCol, minotaurRow)` is a correct and free
answer to "does the minotaur see the hero". No second FOV pass. A corridor
gives one long sightline down its axis, so the maze produces the "he is at the
end of this hall" moment on its own, with no scripting.

**The stun already exists.** `dazeBoss()` sets one countdown and
`bossDazePhase()` derives `'stun' | 'slow1' | 'slow2' | null` from it
(`src/legacy/game.js:2543`), so movement, speed and the visual all read one
source. It is gated to the Crow King today by a single line in `damageBoss`.
The minotaur is that mechanic with the HP line removed.

**Smashing walls is free, and safe.** `smashTile` (`src/legacy/game.js:531`)
already turns ROCK and HUT to EMPTY and TREE to ASH. A charge that ends in a
wall should break it. That opens the maze up as the fight goes on, and by the
invariant above it can never make the level unfinishable, because removing a
wall only ever adds connections.

**The fourth piece is the one that needs design work.** `damageBoss` routes
every hit through `applyBossDamage`, which calls `startBossDeath()` at zero HP
(`src/legacy/game.js:2421`). An unkillable boss has no HP row for
`BOSS_HP_KEYS` to hold and no death sequence to run.

This is where `boss.kind`'s branch stops paying.
[architecture.md](architecture.md#boss-the-deliberate-exception) justified
branching over tabling with "exactly three bosses, ever", and the three share
one contract: they have HP, they take damage, they die. The minotaur shares
none of it. That is not a fourth branch inside the contract, it is a second
contract.

The move is to make a hit's effect a per-boss policy, the same
`Record<Kind, X>` shape `BOSS_HIT_FX` already uses two hundred lines earlier:

```js
const ON_HIT = {
  crowking:    (dmg) => { dazeBoss(); applyBossDamage(dmg); },
  dark_archer: (dmg) => applyBossDamage(dmg),
  dark_knight: (dmg) => applyBossDamage(dmg),
  minotaur:    (dmg) => stun(dmg),   // no HP, no death path
};
```

**How it looks.** A character sprite with a bull's head on a human body, at
most 50% larger than a hero. Not a monster that fills a corridor: the point is
that it is recognisably the same kind of thing as you, and bigger. A hero is
about 20 px across, so this lands near 30 px in a 64 px corridor, which leaves
room to slip past and makes that a skill rather than a coin flip.

**Corridor width follows from it.** `MazeTerrain` originally carved one-tile
corridors, 32 px, against a 20 px body. There is no dodging in that. Corridors
are two tiles by default (`corridor: 2`), which is why the parameter exists at
all.

**One balance risk worth naming now.** Three of the four characters are
ranged, and if stun is the only verb, damage numbers stop mattering and their
identities collapse into "applies stun at a distance". Each character's stun
tool has to feel different, or the maze punishes three quarters of the roster
twice: once through geometry, once through the boss. Worth deciding on purpose
before tuning.

### The supporting cast

The critters exist to make the chase work, so none of them should also chase.
Their job is to stall the hero or reveal them.

| Critter | Role | Cost |
|---|---|---|
| **Rats** | Fast, 1 HP, spawn in fives, body-block a corridor | Low. Reuses skeleton pathing unchanged |
| **Wisp** | Extends the hero's FOV, and reveals them to the minotaur | Low. No attack, no pathing |
| **Wall-crawler** | Moves through walls, follows where he has to smash | High. First mover with its own movement rule |

Rats are the core of it. Being stalled by something trivial while something
unkillable charges down the hall is the level in one sentence.

The wisp is the interesting one because it inverts. Light is what you want in
a maze and it is exactly what gets you caught, so picking one up is a real
decision rather than a pickup.

A lurker, an ambusher that wakes on line of sight, was considered and dropped.
The minotaur already owns dread at a blind corner, and two ambushers is one
too many.

### The pack, and who is not in it

`CONFIG.ratPackSize` shipped with the rat and had no consumer. Nothing put a rat
on the map outside the dev harness, so the objective's key could never drop and
the level could not be finished by playing it. A pack of five now spawns on open
floor away from the player, and the next pack only arrives once the last is
dead.

Topping up to five one rat at a time was tried first and is worse. It reads as
fairer and plays as a tax you can never get ahead of, which makes clearing a
corridor meaningless. Killing all five buys six seconds of quiet, and that quiet
is the only reason to shoot something that drops one key in five.

Crows are gone from this map, by a third `MAP_RULES` row. Part 2 already noted
that a passive crow crosses the map in a straight line with no terrain check and
reads as a bug in a corridor. In single player it carried a second cost nobody
had noticed: ten crow kills is the forest's win condition, so a maze run could
turn into the Crow King's entrance halfway through and replace the level the
player was in. Two win conditions in one level means neither.

### Torches

The counterweight to the dark. Three per maze, on open floor away from the
spawn, and finding one is meant to feel like luck rather than a stop on a route.

Lighting one is a keypress, and it is the only new bind the level adds. That is
the line the level draws: a torch is a decision, while keys, the chest and the
door are foregone conclusions your inventory has already made, and a prompt in
front of a foregone conclusion is a button press rather than a choice. The bind
goes through `CONFIG.keys` and the controls screen like every other action.

The first torch triples sight for the rest of the run, not for a timer. A maze
is a place you are meant to search, and light on a clock punishes searching; it
would also contradict the map, since the torch keeps burning either way. Later
torches change nothing about sight and everything about navigation: a lit one
holds the fog open around itself and stays visible from anywhere, which makes it
the only landmark the level has. Marking a junction you have already been
through is a real use for the second and third.

### Two things about the warden that did not work

Both only surface once he hunts outside a boss fight, and together they left the
level with no counterplay at all.

**He was invulnerable.** Every weapon gated its boss check on
`appState === 'boss_fight'`, which was the same question as "is there a boss to
hit" for as long as a boss only existed inside its own fight. Here he was on
screen, hitting the player, and immune to arrows, spears, dynamite, storm and
whirlwind alike. `bossInPlay()` states the real condition once, next to the
table that says which bosses live outside a fight. Measured: before the fix, no
scripted playthrough of any character landed a single hit on him.

**The stun did not stun.** `stunMinotaur` set `dazeTimer = 1.5` and called it a
1.5 second stun. `bossDazePhase` reads that timer as a position inside stun,
then slow1, then slow2, counting down, so 1.5 lands inside slow2 and freezes
nothing. The config comment said "what a hit buys you"; the code bought a mild
slow. `dazeTimerForStun` does the conversion and has a name, so nobody sets that
countdown by hand again.

The balance risk Part 2 named, that stun at a distance collapses three
characters into one, is not what happened. Stun is not the only verb, because
the rats are: what actually separates the roster is how fast each character
clears five of them in the dark.

## Part 3: the objective and stage wiring

**Both are built, and they were built separately.** They shared a heading
because they arrived together in the sketch, but only the objective was needed
to make the level finishable, so it shipped first and the wiring followed once
there was something worth routing a run into.

A maze whose win condition is "kill everything" is a cramped arena. This one is
traversal. Damage against the warden buys distance and never progress, so the
way out has to be something you carry, not something you kill.

### The chain

1. A chest sits far from the spawn, locked.
2. A door sits at the far end. It is the exit.
3. A rat drops the silver key, at one in five, and only after the player's
   first real encounter with the minotaur.
4. The silver key opens the chest. The chest holds the golden key.
5. The golden key opens the door, and the door ends the level.

Step 3 is the only rule that is not self-explanatory, and it is the one that
makes the level read in order. Before you meet him, rats are vermin. After, they
are the way out. A drop that could fire on the first kill would hand over the
chain before the level has said anything, so `mazeRun.metMinotaur` gates it. He
counts as met the first time he commits to a charge or the first time a hit
stuns him, whichever lands first: both mean the player has seen what he is.

One silver key exists, ever. The roll stops when a key is on the floor, not when
one is in hand, so a player who walks past it cannot farm a second.

### Shape

All of it lives in one nullable object, `mazeRun` in `src/legacy/game.js`, built
and cleared inside `generateMap` alongside the grid it sits on. Null on every
map that is not the maze. That is what keeps forest and castle untouched by
construction rather than by six separate checks on `mapKind`: every consumer,
the update, the HUD row, the draw pass and the rat's drop roll, opens with the
same one-line guard.

The chest and the door are two rows in `MAZE_LOCKS`, keyed by which key they
eat and what opening them buys. They are one interaction, and treating them as
two branches would have meant editing that interaction twice forever. Painting
them is a second table, `MAZE_LOCK_PAINTERS`, in the shape `RETICLE_PAINTERS`
already uses.

Nothing new is bound to the keyboard. Pickups already teach that walking onto a
thing is how you use it, the level's verb is traversal, and reaching the exit
should be the act of leaving rather than a prompt in front of it. Keys, chest
and door all resolve at `CONFIG.pickupRadius`, so a key collects at exactly the
reach a quiver does. The cost is that a player standing on the chest with the
wrong key gets no feedback at all, which a keypress would have given for free.
That is the trade and it is worth revisiting if playtesting says people miss it.

Held keys draw in the HUD with the icon-per-unit loop the quiver uses, from a
`MAZE_KEYS` table with the same row shape as `CONFIG.resources`. They are
deliberately not rows in that table: `resetInv` hands the player a full set of
everything in it, and a key you start the level holding is not a key.

Four events carry the beats: `KEY_DROPPED`, `KEY_TAKEN`, `CHEST_OPENED`,
`DOOR_OPENED`. Three were specified. `KEY_TAKEN` is the fourth because
`PICKUP_TAKEN` promises ammo and power-ups, and a key grants neither, so
widening `PickupKind` would have made the wire type lie. Each is declared in
`src/sim/events.ts` and handled in the one `events.on` switch, which
`events.coverage.test.ts` enforces in both directions.

### Placing two things that both have to be far away

`openTileAwayFrom` answers for one anchor at a time, and this problem has two:
the chest and the door both have to clear the spawn, and they have to clear each
other. Rather than write a second sampler, `newMazeRun` draws the door first as
the far end, then re-rolls the chest until it clears the door as well. The retry
is capped at twelve. On a 33 by 21 grid the two constraints can genuinely fight,
and an awkward layout beats a hang.

The distances are pixels on a 1056 by 672 arena: 620 from the spawn to the door,
380 to the chest, 300 between them. Measured on a real seed that puts the chest
866 pixels from the spawn and the door 708, which is most of the way across the
map in both cases.

### What the warden needed

`updateBoss` only ran inside `boss_fight`, so the minotaur stood still while the
player explored. He now ticks in `playing` too, gated on
`BOSS_HUNTS_WHILE_EXPLORING`, one row per boss kind. The three arena bosses read
false and are provably frozen outside their own fight. A table rather than a
kind check because the fact worth recording is not "the minotaur is special", it
is "being alive outside a boss fight is a property a boss either has or does
not", and a fifth boss should have to answer it.

Two things that assumption had quietly been holding up broke with it, and both
are written up under Part 2: he could not be hit, and hitting him did not stun.

### Playing it

Eight scripted playthroughs per character, driven through the real keyboard
handlers and the same A* the pursuers walk, targeting only what fog lets the
player see, and spending each character's charge ability. Not a substitute for a
human, but the same crude player for all four, which makes the columns
comparable to each other and not to a person.

| Character | Finished | Where the losses happen |
|---|---|---|
| Knight | 6 of 8 | Rarely. Melee clears a pack faster than anything else here |
| Ranger | 5 of 8 | Hunting the pack, before the key drops |
| Archer | 3 of 8 | Split between the hunt and the last walk to the door |
| Wizard | 3 of 8 | The hunt. A two second bolt cooldown against five rats |

Every character can finish. Wins take 6 to 49 seconds of play.

Three things this measured that were worth knowing.

**Corridors invert the roster.** Part 2's worry was that the maze punishes three
quarters of the roster twice, through geometry and through the boss. The
opposite happened: four tiles of sight means nobody is shooting at range
anyway, so the archer's reach buys nothing and the knight's pack clear buys
everything. The knight is the strongest character in this level by a distance.

**The wizard is the one to watch.** His primary is on a two second cooldown,
which is one rat every two seconds against five that move faster than he does.
He is only viable because Lightning Storm clears a pack outright, so his run
lives or dies on a ten second cooldown. Flagged rather than tuned: it is a
balance decision, not a bug.

**Poison is close to a death sentence.** A bite halves the player to 100 px/s
against a rat's 215, so once bitten you cannot break contact and the only way
out is to kill what is biting you. That is the trap Part 2 designed, working
exactly as written, and it is worth deciding on purpose whether it should be
quite this absolute.

Neither Whirlwind nor Lightning Storm needed the walls: both damage what is in
their radius, and `smashTile` returning early on the maze costs them nothing.

### What is still a proposal

The maze is now on the path a normal run takes. Killing the Dark Knight no
longer ends the game: it opens the floor into the labyrinth under the castle.

```
forest -> Crow King -> castle -> Dark Archer -> Dark Knight -> maze -> the door
```

`updateBossDeath` builds the stage exactly the way the castle hand-off already
did, in the order the pieces need: `bossStage` to 4 first, because `spawnBoss`
reads it, then the map, because the minotaur has to pick a tile to stand on,
then the player onto real floor through `nearestOpenTile`, then the warden.

### One screen became a table

`castle_intro` was its own `appState` with its own painter and its own literal
in the click handler. The maze needed a second one, and two copies of a black
screen is the point a copy stops being cheaper than a row.

There is now one `stage_intro` state and a `STAGE_INTROS` table holding what
each hand-off says and what colour it says it in. The castle keeps its purple,
the maze gets torchlight amber, on the reasoning that the title should be the
last warm thing on screen before the dark. `showStageIntro(kind)` is the only
writer, and it still assigns `appState` directly for the original reason:
`transitionTo('playing')` runs `initGame()` and would wipe the run that just
cleared the previous stage.

That bypass is the one thing this did not fix. The `appState` table with an
explicit `keepsRun` property is still owed, and is still the right answer. What
changed is that it is now owed once rather than once per stage: a fourth level
adds a row to `STAGE_INTROS`, not a fourth state that skips `transitionTo`.

`bossStage` still does two jobs, picking the boss and implying the map, and
four stages is where that starts to strain rather than where it breaks.
Splitting level identity out of it remains the correct next move.

## Open questions

1. Does the maze belong in single-player, multiplayer, or both? Part 1 targets
   multiplayer first only because that path needs no new state machine, not
   because it is the better home. Part 3 answers half of it: the objective is
   single-player only, and it lives in the legacy file rather than `src/sim/`,
   so multiplayer still gets terrain and no reason to be there.
2. ~~Is a maze that ranged characters find frustrating a design failure or the
   level's identity?~~ **Overtaken by fog of war.** Nobody has range at four
   tiles, so the question is no longer ranged against melee. It is whether the
   wizard's two second bolt is playable against a pack of five. See
   [Playing it](#playing-it).
3. ~~Should maze walls be destructible?~~ **Settled: no.** See the
   destructible-terrain paragraph above. Kept here rather than deleted so the
   question and its answer stay findable together.
