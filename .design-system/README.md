# CROW ARCHER — Design System

A visual-language guide and developer spec for the browser game **CROW ARCHER**: an archery survival game played on an 800×544px canvas with a CRT-terminal aesthetic and phosphor-green brand palette.

> No external assets exist. Everything in the game is drawn with the Canvas 2D API (`fillRect`, `arc`, `ellipse`, `bezierCurveTo`, `lineTo`, `createLinearGradient`, `createRadialGradient`, `shadowBlur`). This system documents every shape, color, easing curve, and particle so a developer can translate it directly into `ctx.*` calls.

---

## Sources

This system was written from the design brief, before integration into `game.html`. The brief is the source of truth, and all entities, palettes and animation curves below derive from its constraints:

- Canvas: 800×544px, HUD 32px, world 800×512px, tile grid 25×16 @ 32px
- Tiles already exist: `EMPTY`, `ROCK`, `WATER`, `TREE` (do not redesign)
- HUD chrome, overlay screens, screen-shake, vignette and chromatic aberration already exist (do not redesign)
- 13 entities, 7 particle events, and a unified animation system are the scope of this redesign

---

## Index

| File | Purpose |
| --- | --- |
| `README.md` | This document — context, content fundamentals, visual foundations |
| `colors_and_type.css` | CSS variables for color + type (use anywhere the game's chrome is HTML — overlays, dev tools, this doc set) |
| `specs/entities.md` | Full draw specs for all 13 game entities |
| `specs/particles.md` | All 7 particle events — colors, counts, decay |
| `specs/animations.md` | Animation formulas, state variables, easing |
| `preview/*.html` | One card per token / entity / event — visible in the Design System tab |
| `ui_kits/game/index.html` | A playable canvas demo wiring every entity, particle and HUD element together |

---

## Content Fundamentals

The voice is **terse, all-caps, machine-cold** — every string in the game looks like it was printed by a serial terminal in 1983. Diegetic where possible. Personality through restraint, not adjectives.

**Casing.** ALL CAPS for any text rendered on screen (HUD, banners, menus, game-over). lowercase or Title Case only in surfaces the player never sees (dev tooling, source comments).

**Voice.** Imperative or declarative, never conversational. The game **tells** the player what just happened or what to do — there is no "we", no "you" used softly. If a pronoun is needed, "YOU" appears only in stark direct addresses on game-over (`YOU DIED`, never `you have died`).

**Length.** Six words or fewer per line. HUD slots are 1–2 chars (`HP`, `×3`, `99`). Banners are 1–3 words (`WAVE 4`, `INCOMING`, `BOSS APPROACHING`). Tutorial strings are a single imperative (`MOVE WASD`, `AIM MOUSE`, `FIRE LMB`).

**Punctuation.** None at line-end. Em-dashes and brackets `[ ]` are allowed as structural marks. Periods only inside numeric values (`12.4s`). Never `!` or `?`.

**Tone vibe.** Pre-game arcade attract-mode meets a green CRT in an abandoned military bunker. Confidence and threat — never cute, never apologetic.

**Specific examples (use these patterns):**

```
HP 03/05         ARROWS ×07         WAVE 04         SCORE 1240
INCOMING                             ← banner, flashes
BOSS APPROACHING                     ← wave banner
PRESS SPACE TO START                 ← attract / pause prompts
RICOCHET ACQUIRED                    ← pickup confirm
YOU DIED   [R] RETRY                 ← game over
CROWS REMAINING 03                   ← wave HUD line
```

**Emoji.** Never. Unicode block-drawing chars (`█ ▓ ▒ ░ ─ │ ╳`) are permitted in HUD ornaments. Phosphor green braces `[ ]` wrap stateful values.

---

## Visual Foundations

The brand is one color (phosphor green `#39FF14`) over deep ink-black, scored with scanlines, soaked in a soft bloom. Nothing else competes.

### Color

- **Brand.** Phosphor green `#39FF14`. Used for HUD text, separators, glow on headings, friendly indicators, the cursor reticle, and the player's bow string.
- **Ink.** Deep blacks `#0A0F0A` (canvas/void) and `#1A2A1A` (ground tile). All world fills sit on top of `#0A0F0A` so the vignette and scanline have a true black to bite into.
- **Threat.** Crow-red `#FF1F1F` and rust `#8A1010` carry all hostile signal (boss eyes, aggro crows, dynamite body, low-HP pulse, explosion core).
- **Power-ups.** Cyan `#39E0FF` (ricochet — sibling to phosphor on the cool side) and orange `#FF7A1F` / amber `#FFB400` (fire — sibling on the warm side). These two are the **only** non-green/non-red hues in the gameplay layer.
- **Player.** Steel blue `#3A5F88` body + skin `#D9B98A` so the archer reads as the one human in a green-and-black world. Don't tint the cloak — let it be near-black `#0E1410` with a 1px phosphor edge.
- Everything else is built from rgba() over those base hex codes. See `colors_and_type.css`.

### Type

- One typeface only: **system monospace** stack (`ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`). In-game text is `ctx.font = "12px monospace"` or `"16px monospace"`.
- Three sizes: **10px** (HUD micro-labels), **12px** (HUD body, banners), **24px** (overlay headings — menu / game over / pause).
- Letter-spacing: `2px` on banners and headings (rendered character-by-character with extra `x` advance), `0` everywhere else.
- All text is `#39FF14` with `shadowColor: #39FF14, shadowBlur: 4` for the phosphor bloom. Banners pulse the blur (`4 + 4*sin(loopT*4)`).

### Spacing & grid

- Everything snaps to the **8px sub-grid** (tiles are 32px = 4× sub-grid). Entity hit-rects, HUD slot widths, banner padding are all multiples of 8.
- Entity collision boxes are tighter than their visual silhouettes — the cloak/wings overhang the hitbox by 2–3px. This keeps the game feeling fair while letting silhouettes feel chunky.

### Backgrounds

- No images, no full-bleed photography, no hand illustration. The "background" is the tilemap: `EMPTY` tiles are `#1A2A1A` with a 1-in-16 chance of a 2×2px `#243424` speckle — that is the entire ambient texture.
- The world is **flat top-down**. No parallax, no depth fog. Depth is suggested by the entity shadow ellipses and the vignette only.
- Every overlay (menu, pause, game over) draws over the live world with a `rgba(10,15,10,0.78)` wash, then a scan sweep, then corner brackets.

### Lighting & glow

- Glow is universal but **restrained**. Default `shadowBlur` for any luminous fill is `6`. Pulsing glows oscillate between `4` and `12`. Boss eyes and the player's bow-charge cap at `16`. Never above 20 — over-bloom looks like a JPEG, not a CRT.
- Shadow color **always** matches the fill (green glows green, red glows red, orange glows orange). Never use black `shadowBlur` — that's a drop-shadow, which doesn't belong in this aesthetic.
- The CRT scanline is drawn as `rgba(0,0,0,0.12)` horizontal lines every 2px on top of the entire frame, plus a single 80px-tall `rgba(57,255,20,0.04)` sweep band that translates down the screen on a 6-second loop.

### Animation

- **Engine.** Everything is a function of `loopT` (seconds since `performance.now()` start) and `dt` (delta seconds). Per-entity phase floats (`crow.phase = Math.random() * Math.PI * 2`) decorrelate identical entities so a flock doesn't beat in sync.
- **Pattern.** `property = base + amplitude * sin(loopT * freq + phase)`. This is the only animation primitive — no easing libraries, no tween curves.
- **Easing.** Where ease-in/out is desired, square the sine: `sin²(x)` for ease-in-out, `1 - cos(x)` for ease-out feel. Discrete events (swing, hit-stop, explosion) use `t/duration` linear interpolation gated on a state variable.
- **No bounces.** Squash-and-stretch belongs in cartoons. Things in this world wobble (sin) or strike (linear ramp). Never overshoot.
- **No fades on entities.** Entities pop in (1-frame appear) and explode out (particles). The only fade is HUD overlay opacity.

### Hover / press / interactive states

The game is not a UI app — there are no hover states inside the canvas. For overlay menus:
- **Hover.** Menu item gets a 1px phosphor underline + shadowBlur bumped from 4 → 8.
- **Press.** Underline thickens to 2px; text translates +1px Y on the press frame.
- **Selected.** Bracketed: `[ START ]`. No background fill.

### Borders, corners, shadows

- **Corner radius: 0.** Everything is sharp pixels. The CRT aesthetic forbids `border-radius`.
- **Borders** are always 1px and always match the fill of what they contain — they're a phosphor edge, not a separator. The HUD's bottom phosphor line is the only 2px line in the game.
- **Inner shadows.** Don't exist. The CRT bloom is the only "shadow" — `ctx.shadowBlur` with same-color `shadowColor`.
- **Drop shadows on entities** are diegetic — a flat dark `rgba(0,0,0,0.45)` ellipse drawn before the entity. Trees, crows, the player and the boss all sit on one. Arrows and particles do not.

### Transparency & blur

- `rgba()` alpha is used for:
  - Overlay washes (0.78)
  - Vignette (0.6 at corners → 0 at center)
  - Scanlines (0.12)
  - Aggro pulse rings (`0.5 - 0.4*sin²(loopT*6)`)
  - Particle fade (`alpha -= decay * dt`)
- **No blur filter is used.** Bloom is faked entirely with `shadowBlur`. `ctx.filter` is forbidden — it is slow and not CRT-correct.

### Cards / containers

There are no cards in the game itself. The Design System cards in `preview/` follow these rules:
- Solid `#0A0F0A` background, no rounding, 1px `#39FF14` inset border with `shadowBlur: 6` phosphor glow.
- 12px monospace label in the upper-left corner of each card, all caps, e.g. `01. PLAYER`.
- Each card contains a live canvas demonstrating the entity / particle / animation it documents.

### Imagery vibe

If reference imagery were ever used, it would be: monochrome green, high-contrast, low-resolution, scanned-from-VHS grain. Cool, never warm. Always vignetted. The game never displays such imagery; it just informs that nothing pictorial should ever enter the canvas.

---

## Iconography

There are **no icons** in CROW ARCHER. The HUD uses two-letter labels (`HP`, `AR`, `WV`) instead of glyphs, and entity types are communicated by silhouette + color, not by icon overlay.

- No icon font ships with the game.
- No SVG.
- No emoji.
- Unicode block characters (`█ ▓ ▒ ░ ─ │`) may appear in HUD ornament rows and the win-screen flourish — these are **type**, not icons.

If a future feature truly needs an icon (e.g. settings gear), draw it with the same Canvas 2D primitives, in `#39FF14`, with `shadowBlur: 6`, on a 16×16 pixel grid.

---

## Caveats

- This system predates the game code, so all decisions are downstream of the brief's hard constraints, not reverse-engineered from a build. If something feels off when wired up, revisit the spec, don't fight the constraints.
- All animation timings were chosen by feel from the brief, not measured against a working prototype. Expect to tweak `freq` and `amplitude` constants by ±20% after first integration.
- The system monospace stack will render slightly differently on Mac vs. Windows vs. Linux. The brief constrains us to monospace, so we accept the platform variance.
