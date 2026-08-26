# Building a screen

Character select, the HUD, menus: anything laid out in canvas coordinates and
pointed at. Written after the character-select rebuild, which replaced a screen
that had every one of these wrong.

## Laying it out

- **Writing a pixel width?** Derive it from `CONFIG.canvasW`/`canvasH`, never
  from a literal. The row this replaced was 998 px wide because someone typed
  1000: fine at the shipped 1056 canvas, 56.7% of a 1760 one, with the other
  43% empty. Canvas-derived, the same row fills 91% and 96%.
- **A margin that depends on a width that depends on the margin?** Solve it
  twice. One pass leaves the margin computed from a slot width that the margin
  then changed; two converge. `panelSlots` in `src/render/panel-row.ts` is four
  lines of loop and a comment saying why.
- **Selection that resizes things?** Move nothing but the selected item. The old
  screen resized all five panels and re-centred the row on every switch, so the
  whole row slid sideways as the player cycled. Survivable with a keyboard, not
  with a mouse, because the thing you are reaching for is somewhere else by the
  time you get there. Fixed slot centres, and the picked panel grows about its
  own centre.
- **Tempted to drop the grow entirely?** Do not. The pop is what makes a roster
  feel like an RPG roster. It was 2.33x, which was too big; it is 1.25x now,
  clamped to 1.0 to 1.6, and the clamp is there so a future tweak cannot put a
  panel off the canvas.
- **Laying out a column of values?** Reserve its width on every row, including
  the rows that have no value. `STAT_VALUE_W` is reserved on all four stat rows
  so the pips start at the same x whether or not a number precedes them.

## Making it clickable

- **Adding a click target?** Hit-test the exact rects the draw used. Not a
  recomputed approximation of them, the same function: `charSelectLayout()`
  returns the slots, `_drawCharPanel` paints them and `panelAt` tests them.
  Anything else drifts the moment one side is tuned.
- **Targets that overlap?** Test the one drawn on top *first*. At a high pop the
  grown panel covers its neighbour, so the click has to land on what the player
  can actually see. `panelAt` takes the selected index for exactly this.
- **A screen that was keyboard-only?** The cursor has three states now, not two.
  `cursorStyle` replaced a `cursorHidden` boolean once a screen existed where
  the pointer is sometimes a crosshair, sometimes a hand and sometimes gone.

## Reading it

- **Picking a text colour?** Check it against the ground it sits on. Two colours
  on this screen were below 3:1: the key hint at 2.1 and the subtitle at 3.8.
  Both are `#6f8a6c` now, 5.5:1, and still read as the same green.
- **Printing a stat as a number?** Only where the player owns the unit. HP
  prints, because 9 means nine hits. RANGE and DAMAGE are authored impressions
  of a whole kit and SPEED is world units per second, so they get pips and no
  figure: a number nobody can act on is noise that looks like precision.
- **Showing one hero's detail?** Show every hero's basics. The old screen put
  four stat rows on the selected panel only, so comparing two heroes meant
  remembering the first one.

## Sprites on a screen

- **Drawing one sprite at two sizes in one frame?** Check that the size is in
  the cache key before you do anything else. This is the screen that finds key
  bugs: `stamps.get` is first-write-wins and never re-checks the dimensions it
  was handed, so two sizes sharing a key means both draws get whichever
  rendered first. `scale` was missing from it, and no call site had ever passed
  anything but the default until this screen asked for 4x and 3x together. The
  rule and the key format are in [design-patterns.md](../design-patterns.md),
  under "Cache canvas primitives once".
- **Adding a hero to the preview registry?** It is the third render surface,
  after the legacy painter and `src/render/characters.ts`, and the one that
  gets forgotten. It is also the one the typechecker will not defend: `game.js`
  is `checkJs`, not strict, so a grid builder's arity is checked by nothing.
- **Changing a grid builder's signature?** The break lands on the *other*
  branch, at merge, and nothing goes red. `buildArcherGrid(trim)` became
  `buildArcherGrid(frame, trim)` on `feat/char-redesign`, where both call sites
  moved with it; every branch still carrying master's one-arg calls has two
  that will quietly start passing a colour where the frame goes. It belongs to
  whoever merges, applied to the merged result, and it is found by grepping the
  builder's name rather than by reading either diff.

## Testing it

- **Geometry you can compute?** Put it in `src/render/` as a pure function and
  test it there with no canvas and no DOM. `panel-row.ts` is 60 lines of
  arithmetic and 13 tests; none of them opens a context.
- **Geometry stuck in `game.js`?** Reach it through `devHooks`, the way
  `charSelect()` and `selectChar()` do, and test it under `environment: 'node'`
  like `stepSim`. Anything that genuinely needs a canvas gets `installStubCanvas`
  from `src/render/grid-testkit.ts`.
- **Asserting a layout?** Assert the property, not the pixels. "Every centre is
  where it was, whichever hero is picked" survives a tuning pass; "the third
  panel starts at x=612" fails on the next one and tells you nothing.
