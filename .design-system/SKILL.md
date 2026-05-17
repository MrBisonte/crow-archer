---
name: crow-archer-design
description: Use this skill to generate well-branded interfaces and assets for CROW ARCHER, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and Canvas-draw specs for prototyping the game's CRT-phosphor aesthetic.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files. Key files:

- `README.md` — game context, content fundamentals (voice / casing / punctuation), visual foundations (color / type / spacing / lighting / animation principles), iconography (none — by design)
- `colors_and_type.css` — CSS variables for color + type tokens (the same hex values are also literal-baked in the spec files so canvas code never has to resolve CSS vars)
- `specs/entities.md` — full Canvas 2D draw specs for all 13 game entities (player, normal/white/aggro crow, boss, 3 arrow types, dynamite, 2 pickups, fire patch, pitchfork). Each entity has Palette, Geometry, Animations and Draw Order sections, all in pixels and hex.
- `specs/particles.md` — 7 particle events + 3 continuous-emission helpers, all as direct arguments for the `burst(x, y, opts)` API: colors, count, speed, decay, shape, gravity, shadowBlur.
- `specs/animations.md` — state-variable registry and per-property formulas in the form `base + amplitude * sin(loopT * freq + phase)`.
- `preview/_lib.js` — a reference Canvas 2D draw library that implements every entity in the specs. Treat it as an executable copy of the spec — if the doc and the lib disagree, the doc is canonical and the lib should be updated.
- `preview/*.html` — one small live-Canvas card per token / entity / particle event. Useful as a visual reference when designing new content.
- `ui_kits/game/index.html` + `game-loop.js` — a working 800×544 demo wiring every entity, particle and HUD element together. Best single artifact to point at when discussing the game in motion.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML files for the user to view. Reuse `preview/_lib.js` for any canvas work — it already implements every entity correctly. If working on production code in the game engine, you can copy the spec values directly into `ctx.*` calls. The implementing developer should be able to translate every spec line into Canvas 2D primitives without judgement calls.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Hard rules

- Single HTML file. Zero external assets. Canvas 2D API only (`fillRect`, `arc`, `ellipse`, `bezierCurveTo`, `lineTo`, `createLinearGradient`, `createRadialGradient`, `shadowBlur`).
- Canvas is 800×544 px. Game world is 800×512 px. HUD is the top 32 px.
- World is a 25×16 tile grid; each tile is 32×32 px.
- Phosphor green `#39FF14` is the only brand color. Pair only with ink-black, threat-red, cyan-ricochet, orange-fire, gold-arrow, steel-blue-player.
- All text is system monospace, ALL CAPS, no end-of-line punctuation, 6 words or fewer per line.
- All glow is `ctx.shadowBlur` with `shadowColor` matching the fill. Never use `ctx.filter`. Never use `border-radius` or rounded sprites.
- No emoji. No icons. No SVG. No external fonts. No images. Diegetic monochrome-green minimalism.
