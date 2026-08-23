# Architecture

Tech stack, dependencies and the framework decisions behind them. See the [README](../README.md) for the quick start and the [manual](manual.md) for how to play.

- [Tech](#tech)
- [Object composition](#object-composition)
- [Netcode](#netcode)
- [Dependencies](#dependencies)
- [See also](#see-also)

## Tech

- TypeScript and Vite. `vite-plugin-singlefile` inlines the bundle, so the build stays one HTML file
- Single `<canvas>`, all UI drawn with the Canvas 2D API
- CRT scanline aesthetic via CSS plus a vignette overlay
- Fixed 60 Hz timestep with an accumulator, capped at 8 catch-up steps per frame
- Simulation and rendering are separating into `src/sim/` and `src/render/`, joined by an event bus: the sim states what happened, rendering decides how it looks and sounds
- Particle system capped at 120 active particles, oldest dropped first
- All tunable values centralized in the `CONFIG` object at the top of `src/legacy/game.js`
- rot.js FOV cache invalidates only when the player moves to a new tile
- `vitest` covers the extracted sim modules; `npm test` and `npm run typecheck` gate changes

## Object composition

Reference for every kind-tagged content system: what the tag is, which
tables key off it, and what actually happens when a new value is added.
Rationale and worked examples for *why* this shape was chosen live in
[Design patterns](design-patterns.md#composition-over-inheritance-character-definition),
and the case for one number per character rather than a column per boss in
[One dial per character](design-patterns.md#one-dial-per-character-not-a-column-per-boss);
this section is the flat data reference across every kind, not just
character.

### At a glance

| Class | Kind type | Values today | Tables keyed on it | Cross-cuts |
|---|---|---|---|---|
| Character | `CharacterKind` | `archer \| wizard \| knight \| ranger \| sapper` | `PRIMARY`, `SILHOUETTES`, `PAINTERS`, `CHARACTER_STATS`, `CHARACTER_KEYS` | sim, render, net, ui |
| Map | `MapKind` | `forest \| castle \| maze \| cavern` | `MAP_GEN`, `MAP_RULES`, `TILE_THEMES`, `ANIMATED_THEMES`, `MAP_KEYS` | sim, render, net, ui |
| Pickup (multiplayer) | `PickupKind` | `shield \| fire` | `EFFECTS` | sim |
| Skeleton (single-player) | plain string | `normal \| fire \| ice` | `SKELETON_PALETTES` | `src/legacy/game.js` only |
| Boss | plain string, **HP tabled, behavior branched** | `crowking \| dark_archer \| dark_knight \| minotaur \| commander` | `BOSS_HP_KEY` (HP), `BOSS_ON_HIT`, `BOSS_HUNTS_WHILE_EXPLORING` (see [Boss: the deliberate exception](#boss-the-deliberate-exception)) | `src/legacy/game.js` only |
| Weapon | implicit, via `PRIMARY` | `Bow \| Staff \| Spear \| Crossbow \| PowderCharge` | each implements the `Weapon` interface | sim, net |

Two systems only exist in `src/legacy/game.js` (skeletons, bosses): the
castle stage's monster content is single-player-only today, with no
protocol representation for it in multiplayer.

### How a new map value flows through the tables

```mermaid
flowchart LR
    classDef newKind stroke-width:3px,stroke-dasharray:6 3

    forest((forest))
    castle((castle))
    maze((maze))
    cavern((cavern))
    next(("?, new")):::newKind

    subgraph GEN["MAP_GEN (one generator per tag)"]
        gf["NoiseTerrain 0.45"]
        gc["NoiseTerrain 0.5"]
        gm["MazeTerrain"]
        gv["CavernTerrain"]
        g3["? generator"]:::newKind
    end

    subgraph THEME["TILE_THEMES / ANIMATED_THEMES (one row per tag)"]
        tf["forest painters"]
        tc["castle painters"]
        tm["maze painters"]
        tv["cavern painters"]
        t3["? painters"]:::newKind
    end

    forest --> gf
    castle --> gc
    maze --> gm
    cavern --> gv
    next -.-> g3
    forest --> tf
    castle --> tc
    maze --> tm
    cavern --> tv
    next -.-> t3

    gf & gc & gm & gv & g3 --> Terrain["Terrain.fromSeed(seed, mapKind)\nsrc/sim/arena-map.ts"]
    tf & tc & tm & tv & t3 --> TileLayer["StaticTileLayer(painters)\nsrc/render/tiles.ts"]
    Terrain --> Sim["sim: passability, spawn points"]
    TileLayer --> Render["render: what a tile looks like"]
```

Same shape as the character diagram in design-patterns.md: a new `MapKind`
value is one new circle, one row in each table. `TILE.ROCK` still means
"blocks movement and shots" in every theme; only the art differs, so
`Terrain`'s collision code never has to know a theme exists.

The row a generator holds stopped being a config value when the maze
arrived: `MAP_GEN` holds the generator itself, because a maze is not the
noise algorithm at any density. Forest and castle are the same `NoiseTerrain`
at two settings; the maze is carved and the cavern is grown. See
[Level 3: the maze](level-3-maze.md).

One table is not keyed on `MapKind` and is worth knowing about:
`MAP_PANEL_INFO` in `src/legacy/game.js` holds only the presentation of the
Waves map-select panels, and *membership* of that screen is derived from
`MAP_RULES[kind].crows` rather than listed. A map earns a panel by having
crows. `MAP_PANELS` throws at load if a map earns one and has no
presentation row, so the half that cannot be derived fails early instead of
drawing blank.

### Map selection: where the free choice actually lives

**Decision (2026-08-21):** map is a real, player-facing choice in exactly
two places. Everywhere else it is fixed. Logged as ROADMAP.md decision 9.

| Context | Map choice | Mechanism |
|---|---|---|
| Multiplayer lobby | **Free**, host-selected | `SET_MAP` → `Room.setMap()` → `MATCH_START` |
| Single-player, Waves mode | **Free**, player-selected | mapselect screen (`MAP_PANELS`, filtered from `MAP_RULES.crows`) → `selectedMapKind` → `initGame()` |
| Single-player, Brawl mode | **Fixed** | `generateMap('castle')` fires once, hardcoded inside `updateBossDeath()` when the Crow King dies: a story beat, not a menu |

```mermaid
sequenceDiagram
    participant Host
    participant Lobby as Lobby (client)
    participant Server
    participant Match as MatchView (client)

    Host->>Lobby: press map key (table-driven, mirrors CHARACTER_KEYS)
    Lobby->>Server: SET_MAP
    Server->>Server: host-only Room.setMap(mapKind)
    Server-->>Lobby: ROOM_STATE (mapKind)
    Note over Lobby: every player sees the pick; only the host can change it
    Host->>Server: ready
    Server->>Match: MATCH_START (mapKind, seed)
    Match->>Match: Terrain.fromSeed(seed, mapKind)
    Match->>Match: StaticTileLayer(TILE_THEMES[mapKind])
```

Single-player's `gameMode` (`'brawl' | 'waves'`, `src/legacy/game.js:635`)
is a different, older concept from multiplayer's `GameMode`
(`'coop' | 'deathmatch'`, `src/net/protocol.ts:72`). Same name, unrelated
values, picked at the main menu, not per-match. Worth not confusing the two
when this gets built.

### Boss: the deliberate exception

`boss.kind` (`'crowking' | 'dark_archer' | 'dark_knight' | 'minotaur' |
'commander'`, `src/legacy/game.js`) is a plain string with five values, and
what keys off it is split by field, not by kind.

| Field | Where it lives | What a row is |
|---|---|---|
| HP | `BOSS_HP_KEY` | one CONFIG key per boss, the same pool whoever is fighting it |
| What a landed hit does | `BOSS_ON_HIT` | one function per kind |
| Alive outside a boss fight | `BOSS_HUNTS_WHILE_EXPLORING` | one flag per kind |
| Shield window, orbit vs. charge tuning, secondary attacks | branched, no table | no row: genuinely divergent algorithm, not a shared data shape a table could hold |

A table earns its keep when new rows are mostly data, and a boss is mostly
algorithm, which is the same call `GameMode` makes over `CharacterKind`. The
two behavior tables are not a counter-example: a row holds a function or a
flag that selects one, so they are that branch written out per kind, which
makes a fifth boss answer the question rather than inherit whichever answer
an `if` happened to give it.

HP is the one field that failed the test the other way. It used to be twelve
hand-tuned numbers, four bosses times three named characters, read by a
ternary on `selectedChar`; it is one pool per boss now, scaled by one
`bossDamageMult` per character, so the two axes add instead of multiplying.
Same test, applied per field rather than per kind. See
[One dial per character](design-patterns.md#one-dial-per-character-not-a-column-per-boss)
for the decision and [Balance](balance.md#boss-health) for the numbers.

The minotaur is why the split is worth naming. He has no HP row at all,
`bossHpFor` returns `Infinity` for him, and a hit buys a stun rather than
damage: he sits in both behavior tables and outside the data one.

### Data structures (verified against current code)

```ts
// src/net/protocol.ts
type CharacterKind = 'archer' | 'wizard' | 'knight' | 'ranger' | 'sapper'

// src/sim/arena.ts
interface CharacterStats { speed: number; maxHp: number; bossDamageMult: number }
const CHARACTER_STATS: Record<CharacterKind, CharacterStats>
// rows are no longer identical; the figures are in docs/balance.md

// src/sim/arena-map.ts
type MapKind = 'forest' | 'castle' | 'maze' | 'cavern'
const MAP_GEN: Record<MapKind, MapGenerator>
const MAP_RULES: Record<MapKind, {
  destructibleTerrain: boolean; fogOfWar: boolean; crows: boolean
}>

// src/sim/map-generators.ts
interface MapGenerator { generate(rows, cols, rng, noise): TileGrid }
class NoiseTerrain  // thresholded noise: forest, castle
class MazeTerrain   // recursive backtracker, braided
class CavernTerrain // cellular automata, then joined into one region

// src/render/tiles.ts
const TILE_THEMES: Record<MapKind, Partial<Record<TileId, TilePainter>>>
const ANIMATED_THEMES: Record<MapKind, AnimatedPalette>

// src/ui/lobby-controller.ts
const MAP_KEYS: Record<MapKind, string>

// src/sim/pickups.ts
type PickupKind = 'shield' | 'fire'
const EFFECTS: Record<PickupKind, (target: Empowerable) => void>

// src/sim/tilemap.ts
const TILE =
  { EMPTY: 0, ROCK: 1, WATER: 2, TREE: 3, ASH: 4, HUT: 5, SAPLING: 6 } as const
const tilePassable = (t: TileId) =>
  t === TILE.EMPTY || t === TILE.ASH || t === TILE.SAPLING

// src/sim/regrowth.ts
class Regrowth  // ash -> sapling -> tree, on destructibleTerrain maps only

// src/legacy/game.js: single-player only, not compiler-checked
let gameMode: 'brawl' | 'waves'
const SKELETON_PALETTES: Record<'normal' | 'fire' | 'ice', Palette>
// boss.kind is a plain string; BossKind is this block's name for its five values
type BossKind = 'crowking' | 'dark_archer' | 'dark_knight' | 'minotaur' | 'commander'
const BOSS_HP_KEY: Record<Exclude<BossKind, 'minotaur'>, string>  // kind -> CONFIG key
const BOSS_ON_HIT: Record<BossKind, (amount: number) => void>
const BOSS_HUNTS_WHILE_EXPLORING: Record<BossKind, boolean>
```

`CharacterKind` and its five tables are the most complete instance of this
pattern and are documented in full, with the rejected class-hierarchy
alternative, in
[Design patterns](design-patterns.md#composition-over-inheritance-character-definition).

### Transformations worth knowing about

- **Wire packing.** A `Kind` value is a string, so it survives
  `JSON`/the wire format for free. Richer state (player position, HP) is
  packed into fixed-size numbers by `packPlayerState`
  (`src/net/entity-state.ts`) and unpacked client-side; kinds themselves
  are never packed, just sent as-is.
- **sim → render.** Neither `sim/` nor its tables know about `HTMLCanvas`.
  A kind resolves to *data* (a `Weapon` instance, a density number, a
  painter table lookup) inside `sim/`, and `render/` is where that data
  becomes pixels. This is the same split the "Tech" section above
  describes for the engine generally, just applied per-kind.
- **Legacy game.js is a separate build, not a port.** Single-player's
  `src/legacy/game.js` shares some tables directly with the TS side
  (`generateMap()` imports `MAP_GEN`/`TILE_THEMES` for real) but
  reimplements others by hand (`CHAR_PANELS` is a plain array, not a
  `Record`; pickups have a third kind, `'ricochet'`, that the multiplayer
  `PickupKind` doesn't). Where the two diverge it's deliberate: PvE and
  PvP numbers are tuned separately. It means "add a kind" is two separate
  edits today, not one. `CHARACTER_STATS` now carries that seam inside one
  table: `BattleWorld` reads `speed` and `maxHp` out of it, so the roster's
  bodies really are shared, while `bossDamageMult` in the same row is read
  only by `src/legacy/game.js`, because multiplayer has no bosses. The field
  name carries its own scope. See [Balance](balance.md#multiplayer).

## Netcode

The server runs the only simulation. Each client predicts its own movement so your body answers the keyboard without waiting for a round trip, and draws everyone else 100 ms in the past so they move smoothly.

Arrows are the server's: it decides where they go and what they hit. Your own movement is predicted locally, so it stays instant, but an arrow appears a round trip after you ask for it. That is the deliberate trade. The alternative is drawing arrows the server later disagrees with and having to take them back.

Every match uses a fresh generated map (rock, trees, water and huts) built independently on both machines from the same four-byte seed rather than sent over the wire.

## Dependencies

Two npm packages, bundled into the build. The ZzFX-compatible synth is written into the source rather than installed. The server adds [`ws`](https://github.com/websockets/ws) ([MIT](https://github.com/websockets/ws/blob/master/LICENSE)), which the client build does not include.

| Library | Version | Purpose | License |
|---------|---------|---------|---------|
| [simplex-noise](https://github.com/jwagner/simplex-noise.js) | 2.4.0 | Coherent 2-D noise for terrain, independent layers for rocks, water and forest so tiles cluster naturally | [MIT](https://github.com/jwagner/simplex-noise.js/blob/main/LICENSE) |
| [rot.js](https://github.com/ondras/rot.js) | 2.2.1 | `FOV.PreciseShadowcasting` for crow line-of-sight, `Path.AStar` so aggro crows path around obstacles | [BSD-2-Clause](https://github.com/ondras/rot.js/blob/master/license.txt) |

Sound comes from a small synth in `src/legacy/game.js` that reads [ZzFX](https://github.com/KilledByAPixel/ZzFX)-style positional parameter arrays. It is a partial reimplementation rather than the upstream library ([MIT](https://github.com/KilledByAPixel/ZzFX/blob/master/LICENSE)): the envelope has no decay stage, shapes 4 and 5 are noise instead of ZzFX's waveforms, and seven parameters are accepted but ignored. Every sound was tuned against this implementation, so arrays copied from the ZzFX designer will not sound the same.

## See also

- [Design patterns](design-patterns.md): composition over inheritance for character definitions
- [Balance](balance.md): what every character and every boss is worth, and the one rule relating them
- [Level 3: the maze](level-3-maze.md): why a third map breaks `MAP_GEN`'s row shape, and the Strategy table proposed to fix it
- [Design system](../.design-system/README.md): draw specs in pixels and hex, live preview cards, a playable UI kit demo
