# Rebuilding a character

What the archer's rebuild cost, written down so the wizard, knight, ranger and
sapper cost less. Triggers and the action each one requires, in the shape
`CLAUDE.md` uses. Rationale that already lives somewhere else is linked, not
restated.

Living document. Anything that costs more than ten minutes to work out a second
time belongs here.

## Before you draw anything

- **Starting on a character?** Find both render paths first. Every hero is
  drawn twice — the legacy single-player painter in `src/legacy/game.js` and
  the multiplayer one in `src/render/characters.ts` — and there is a third
  surface, the character-select preview (`CHAR_PANELS[].preview`). A change
  that lands in one and not the others is invisible until someone plays the
  mode you did not open.
- **About to call something a performance bug?** Measure it. The hero grids
  looked like the exact trap `CLAUDE.md` opens with: built every frame, thrown
  away by a cache that skips the painter. They cost **12.4 µs**, 0.07% of a
  frame, and the header comment in `character-grids.ts` saying so was right.
  A rule is a prior, not evidence.
- **A stat the manual advertises?** Grep for a *consumer*, not an assignment.
  `archerPowerPierce` was written onto every power arrow and read by nothing
  but the renderer, so a full second rooted bought three things and delivered
  two. `grep -n "theKey" src/` and look for a line that *reads* it.

## Drawing

- **Giving a character a walk?** Draw them in profile, facing +x. Face-on, a
  stride can only lift a boot a pixel, which is invisible at 24x32; side-on it
  swings the whole leg through nine columns. This is the codebase's own
  convention — see the header of `src/render/guard-grids.ts`, and every guard
  including the foot archer. The heroes are the outliers.
- **Placing two legs?** `pixelOutline` fills any empty cell orthogonally
  touching a filled one, from both sides. A gap of one or two columns becomes
  entirely outline colour, so the legs weld on the closed frame — the one frame
  nobody screenshots. Leave **three columns** at the narrowest frame.
- **Swinging them?** Both feet about a *shared* centre, opposite ways, so the
  extremes mirror. Swing each about its own top and they converge instead of
  splaying. Boots hang outside the ankle, never centred on it, or they eat a
  column of the gap from each side. Both rules and their reasons are already
  written in `buildGuardBody`.
- **Choosing leg width?** Two columns, not three, at a two-column swing.
  Three-wide shins leave only two columns between them when closed.
- **Picking colours?** No two adjacent parts may share a value. The first
  profile draft drew legs and cloak both in `C.leather`; the back leg vanished
  into the cloak and the stride had nothing to show.
- **Placing the trim stripe?** On the torso, never across the face. A trim row
  at head height reads as a blindfold, not as livery.

## Looking at it

- **Changed a sprite?** Render it and *look*. Three separate problems shipped
  past me — the shared colour, the trim across the face, welded legs — because
  I reasoned about pixel coordinates instead of rasterising them. Node has
  `zlib`, which is all a minimal PNG encoder needs; write the grid to a PNG and
  read it back. Every one of those was obvious in a picture and invisible in
  the numbers.
- **Changed a vector weapon?** The same, with a fifty-line 2D-context shim that
  flattens `quadraticCurveTo` and rasterises `stroke`/`fill` as lines. Enough
  to catch a bow anchored at the wrong height.
- **`before: N` in `character-grids.test.ts` failing?** Read its premise before
  raising the number back: it is "same pose, more detail". A re-pose does not
  survive it — a body edge-on is narrower than the same body face-on — and
  neither does moving a part into another module. Re-cut the baseline with a
  comment saying which of the two it was.

## Animating

- **A walk that does not read?** Frame count is the last lever, not the first.
  Only the legs moving is ten rows of a thirty-two row sprite. Add a **body
  bob** and an **arm swing** first; both are free. Only then consider frames —
  `ANIM_FRAMES` has 36 call sites across crows, skeletons, soldiers, guards and
  the ranger, so a fourth frame is a parallel convention or a ripple through all
  of them.
- **Writing a bob?** Twice the stride frequency: a body rises once per step and
  there are two steps to a cycle. The knight's `Math.sin(p.walk)` is a sway —
  it lifts on one extreme and drops on the other — and is left alone only
  because changing it would change a shipped character.
- **Anything derived from movement?** Derive it from ground covered, not from a
  flat rate. `walkPhase += 8 * dt` meant one stride per 157px, so the hero
  skated while his legs shuffled, and no speed upgrade or poison slow ever
  reached the animation. `WALK_CYCLE_PX` is the shape to copy.
- **Touching the walk?** Check the character-select screen too. Its preview ran
  at `t * 1.5`, one cycle every four seconds, which read as a stuck sprite.

## Weapons

- **A weapon that moves for more than one reason?** It cannot be baked. The bow
  swings to the aim, bends through a held draw and snaps on release; baking
  that is one grid per angle per draw step. Draw it live and give it **one
  painter both renderers call** — they already build the same mirrored
  transform and the same local aim angle. See `src/render/archer-bow.ts`.
- **Anchoring a held weapon?** Not at the sprite's origin. The origin is on the
  ground between the feet, and the body runs from -22 to +10 around it, so a
  weapon at 0 hangs at ankle height. Anchor at chest, about -7, and measure
  reach from there so aiming down swings the grip below the *chest*.
- **Making a weapon readable across the arena?** Not by glowing it in the team
  trim. A lit bar held at arm's length is a lightsaber. Paint the material —
  wood, hemp, steel — and put the side on a small unlit binding.
- **Selling a release?** It is not the windup running backwards. Overshoot past
  rest and settle, on a short timer set by *every* shot. An ordinary shot has
  no windup at all, so that snap is the only thing that makes it look like
  anything.

## Mechanics

- **Adding an ability?** Four things or it does not exist: a `GLYPH`, a `CHIP`
  row, a row in `LANE_D`, and — if it emits — a variant in `src/sim/events.ts`,
  a `case` in the handler and the emit itself. `events.coverage.test.ts` walks
  all four directions between those sets.
- **Writing a chip?** `cooldownChip` only fits something gated and spent.
  Brace is neither, so "READY" would be a lie; it reports a stance that is
  filling, full or draining, and shows the same fraction the arrows read.
- **Reading movement for a mechanic?** Read the movement that was *applied*,
  not the keys. A hero walking into a wall is standing still, and anything else
  lets him earn a stance by leaning on terrain.
- **Scaling damage?** `dmgMult` on an arrow reaches **boss damage only**
  (`resolveBossHit`). Ordinary enemies have 1 hp and die to anything, so a
  multiplier is a boss-fight lever and nothing else — which is usually the
  right one, since reach-based heroes are short exactly there.

## The headless harness

These cost an hour each. See also the traps already recorded in `CLAUDE.md`.

- **Need a body to stand still?** Use a skeleton. A **crow's `y` is driven by
  its own flight every step**, so a position written onto one is gone by the
  next frame. Worse, crows spawn *beyond the right edge*, so placing the
  shooter relative to one puts him off the map and the arrow leaves it before
  reaching anything.
- **Resetting between tests?** `devHooks.respawnPlayer()` is a teleport, not a
  death — it moves the body and nothing else. `initGame` is the per-run reset,
  and `go('playing')` runs it.
- **A test that will not go red?** Trace it before theorising. Printing the
  arrow's position and every body's position per frame found both crow traps in
  one run, after two wrong hypotheses that each looked reasonable.
- **Reverting a fix to prove a test?** Match on enough context to be unique.
  `arrows.splice(i, 1); hit = true; break;` appears three times; a
  count-asserted replace caught it, an unguarded one would have restored the
  wrong site silently.

## Working with the person

- **Made a claim that turned out wrong?** Say so plainly and carry on. Four in
  this session: the grid rebuild was not a bug, the ranger does not share the
  archer's body (the **sapper** does), the tower break at 71x37 *was* fixable,
  and the walk-frame cost did not triple. Each was cheaper to correct than to
  defend.
- **About to spend effort on art?** Show it first. Standalone single-file
  builds (`npm run build` with `vite-plugin-singlefile`) open from `file://`
  with no server, which is the fastest way to put a real, playable thing in
  front of someone.
- **Approval given on a premise you later disprove?** It is not approval any
  more. The grid memoisation was signed off as "first, before any art work" and
  skipping it was right, because the measurement removed the reason for it.
