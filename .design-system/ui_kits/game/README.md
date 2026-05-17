# CROW ARCHER — UI Kit (The Game)

A working 800×544 canvas demo that wires every entity, particle event and HUD element together so the system can be reviewed in motion. This is the closest thing to a screenshot of the live game.

## What's wired up

- 25×16 tilemap with all 4 existing tile types (EMPTY / ROCK / WATER / TREE)
- Player with WASD walk + mouse-aim + LMB charge-and-fire
- Normal crows (flock), white crows, aggro crows with rings + speed trails
- Boss (toggle with B)
- All 3 arrow types: normal, ricochet, fire
- Dynamite (drop with E, fuses live, real explosion particles, water-splash on water)
- Two pickup types (R / F), spawn on the map
- Fire patches drawn at fire-arrow impacts
- Pitchfork melee (Space)
- Full HUD: HP, arrows, wave, score, mode badge, INCOMING flash, low-HP pulse
- Particle system honoring every event spec
- Scanlines + scan sweep + vignette post

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Aim |
| LMB (hold then release) | Charge & fire arrow |
| 1 / 2 / 3 | Switch arrow mode (NORMAL / RICOCHET / FIRE) |
| Space | Pitchfork swing |
| E | Drop dynamite |
| B | Toggle boss |
| H | Low-HP demo |
| K | Kill a crow at random |
| R | Reset wave |

This is a **kit**, not a real game — there are no win/lose conditions, no AI beyond drift, no real damage. It exists to make every spec visible at the same time.
