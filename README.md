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

### Wizard *(NEW)*
Teleguided magic with area control.
- **Primary:** Magic bolts — 3 s cooldown, automatically home toward nearest enemy, disappear on contact
- **Special:** Lightning Storm — massive 450 px AoE around the player; destroys ROCK and TREE tiles, damages all enemies
- **Pickups:** Fire bolt (2× damage) · Laser stream (passes through walls, stops on first enemy)

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

## Technical Notes

- Pure vanilla JS — no frameworks, no bundler
- Single `<canvas>` element; all UI drawn via Canvas 2D API
- CRT scanline aesthetic via CSS + vignette overlay
- Particle system capped at 120 active particles (oldest dropped first)
- Delta-time game loop via `requestAnimationFrame`
- All tunable values centralized in the `CONFIG` object at the top of `game.html`
