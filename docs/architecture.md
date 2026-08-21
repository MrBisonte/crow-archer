# Architecture

Tech stack, dependencies and the framework decisions behind them. See the [README](../README.md) for the quick start and the [manual](manual.md) for how to play.

- [Tech](#tech)
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
- [Design system](../.design-system/README.md): draw specs in pixels and hex, live preview cards, a playable UI kit demo
