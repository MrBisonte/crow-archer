# CROW ARCHER

A single-file browser game built with vanilla JS, HTML5 Canvas, and Web Audio API. No dependencies, no build step — just open `game.html`.

```
  ██████╗██████╗  ██████╗ ██╗    ██╗
 ██╔════╝██╔══██╗██╔═══██╗██║    ██║
 ██║     ██████╔╝██║   ██║██║ █╗ ██║
 ██║     ██╔══██╗██║   ██║██║███╗██║
 ╚██████╗██║  ██║╚██████╔╝╚███╔███╔╝
  ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝
        A R C H E R
```

## Play

Open `game.html` in any modern browser. No server required.

## Characters

### Archer
Classic ranged fighter. Mouse-aimed arrows with a dotted aim line.
- **Primary:** Arrows (quiver of 10, refilled by pickups)
- **Special:** Dynamite — hold to charge, release to throw; blast radius clears tiles and damages boss
- **Pickups:** Ricochet arrows (bounce off walls with speed boost) · Fire arrows (leave burning patches)

### Wizard
Teleguided magic with area control.
- **Primary:** Magic bolts — 3 s cooldown, automatically home toward nearest enemy, disappear on contact
- **Special:** Lightning Storm — massive 450 px AoE around the player; destroys ROCK and TREE tiles, damages all enemies
- **Pickups:** Fire bolt (2× damage) · Laser stream (passes through walls, stops on first enemy)

### Knight *(NEW)*
Frontline melee fighter with a long spear.
- **Primary:** Spear thrust — 80 px directional cone, 0.9 s cooldown, 2 damage to boss
- **Special:** Whirlwind — 3-second spinning AoE (72 px radius); continuously damages enemies and destroys ROCK/TREE tiles; 8 s cooldown
- **Pickups:** Iron Javelin (thrown piercing spear, 2 pierce charges, 3 per pickup) · Fire Sword (2× damage + 2× range for 8 s, leaves burning patches)

## Controls

| Action | Default |
|--------|---------|
| Move | Arrow keys |
| Aim | Mouse |
| Shoot / Cast | Space |
| Charge special | Right-click hold (Archer) / Right-click (Wizard) |
| Pause | Escape |
| Inventory | I (while paused) |
| Sniper mode | Shift |

All keys are remappable from the Controls screen.

## Gameplay Loop

1. Survive waves of crows spawning from the right edge
2. Reach **10 kills** to trigger the **Boss Entrance** cinematic
3. Defeat the Boss Crow King to win

**Boss shield phases:**
- First 10 s — blue rotating shield, fully immune
- 5 s open window — attack freely
- Randomly re-shields for 5 s (purple ring), up to 3 times per 30-second window

## Gamification Systems

| Module | Description |
|--------|-------------|
| **FORESHADOW** | Sky tint darkens and banners appear at kill milestones leading up to the boss |
| **STREAK** | UT99-style announcer: Double Kill → Multi Kill → Mega Kill → Ultra Kill → Monster Kill |
| **FEATHERS** | Meta-currency earned from kills, persisted in `localStorage`. Spend on upgrades (arrows, HP, range, speed) via the in-game inventory screen |
| **HANDICAP** | `CONFIG.handicap` (0–100) rubber-bands crow speed and drop rate for accessibility |
| **BOUNTIES** | Two active micro-objectives tied to kill streaks; grant bonus rewards on completion |

## Map

- **25 × 16** procedural tile grid (EMPTY · ROCK · WATER · TREE · ASH)
- Player spawns in a guaranteed clear zone; crows enter from the right corridor
- Trees burn to ash on boss arrival, opening the arena
- Dynamite and Lightning Storm destroy ROCK and TREE tiles permanently

## Audio

All sound is synthesized via Web Audio API (no audio files). Sounds initialize on first user gesture.

## Dependencies

Three CDN-loaded libraries are referenced in `game.html`. An internet connection is required to load them; no npm install or build step is needed.

| Library | Version | Purpose | License |
|---------|---------|---------|---------|
| [ZzFX](https://github.com/KilledByAPixel/ZzFX) | latest | Procedural sound-effect synthesizer — replaces all hand-rolled Web Audio API synth functions with compact parameter arrays | [MIT](https://github.com/KilledByAPixel/ZzFX/blob/master/LICENSE) |
| [simplex-noise](https://github.com/jwagner/simplex-noise) | 2.4.0 | Coherent 2-D noise for procedural terrain — rocks, water, and forest each get an independent noise layer, producing natural clusters instead of scattered random tiles. v2.4.0 is the last release with a browser-compatible UMD/global build | [MIT](https://github.com/jwagner/simplex-noise/blob/master/LICENSE) |
| [rot.js](https://github.com/ondras/rot.js) | 2.2.1 | Roguelike toolkit: `ROT.FOV.PreciseShadowcasting` for crow line-of-sight checks; `ROT.Path.AStar` so aggro crows path-find around obstacles instead of beelining through walls | [BSD-2-Clause](https://github.com/ondras/rot.js/blob/master/LICENSE) |

## Technical Notes

- No build step — open `game.html` directly in any modern browser
- Three CDN script tags (ZzFX · simplex-noise · rot.js) are the only external references
- Single `<canvas>` element; all UI drawn via Canvas 2D API
- CRT scanline aesthetic via CSS + vignette overlay
- Particle system capped at 120 active particles (oldest dropped first)
- Delta-time game loop via `requestAnimationFrame`
- All tunable values centralized in the `CONFIG` object at the top of `game.html`
- rot.js FOV cache invalidates only when the player moves to a new tile (performance)
