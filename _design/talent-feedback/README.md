# talent-feedback — the icon pass

Gitignored design scratch. Nothing here ships; it is what the canvas is built
from.

    python draw-icons.py     # shapes  -> icons32.js
    node render-svg.mjs      # icons32 -> icons32.rendered.json (via compose.mjs)
    python build-dc.py       # renders -> Sigils.dc.html
    # then reseed with the /design helper and republish

- `draw-icons.py` is the one home for the shapes. `icons32.js` is generated;
  a pixel tweaked there is lost on the next run.
- `compose.mjs` is the one home for the bezel, ground, cast shadow and outline.
  The browser preview and the artboards both import it, so what you look at in
  `preview32.html` is what the canvas shows.
- `Main.dc.html` is hand-written; its four inline icons are swapped in by a
  patch step, so re-generating it by hand means re-swapping them.

Canvas: https://claude.ai/code/artifact/aa2f6a93-e370-4855-8fab-f8c2b2ef8846
Favicon on republish: 🎯 (keep it -- a changed favicon reads as a new page).

Ten icons now: the archer's four, the wizard's blink line -- HELD STEP (an
hourglass), THIRD STEP (three cut steps, the third gold), THUNDERSTEP (a bolt
widening as it falls) -- and one each for the knight, sapper and ranger.

## What the archer and wizard passes established

Both of the wizard's first two were drawn three times each. An outlined
hourglass reads as a wireframe; flat-toned risers read as a bar chart, and
drawn straight on they read as a zigzag line, because a step only reads as a
step when you can see the top of it. The hourglass's third fix was material,
not light: a WOOD frame on the golden `movement` ground is brown on brown, and
the dark end of the wood ramp lands on the ground's own lit pool. Steel is the
only cool ramp in the set -- on a warm socket, reach for it.

## What the other three cost, bringing them up to that bar

- **A char with no entry in the icon's own legend paints NOTHING.** TOWER
  GUARD's face was drawn in leather against `mk('steel', 'gold')`, so every
  `E C H h L` fell through and the steel rim filled the silhouette. Nothing
  errors: you get a flat plate and no reason for it. Ramps in `META` are part
  of the drawing, not bookkeeping.
- **The warm/cool rule runs both ways.** The knight's socket is the blue
  `defence` ground, so steel there is cool on cool, which is the hourglass
  lesson inverted. The shield's face went to leather and the steel went where
  steel belongs -- the rim, the studs, the boss's ring.
- **A domed top over a tapering body is a CUP,** and a gold disc near the top
  of it is the wine. Two fixes, one cause: the top edge went flat corner to
  corner, and the boss dropped to the middle of the face. A band down the
  centre is what a shield has and a cup does not.
- **Give a chain's wall in PIXELS, never as a fraction of the link.** Four
  drafts died on this -- a ribbon, a helix, a fish, a spanner -- because an
  ellipse ring sets its wall as a ratio of its radius, so the wall thickens
  with the link and the hole never wins. A capsule ring takes the wall as a
  number of pixels, and the hole stays wider than the metal round it, which is
  the whole read. The owner's word for the failure was that you could not see
  the links, and that is exactly the proportion he was measuring.
- **Barbs are strokes, not rays.** LIGHT FOOT's first two drafts stood single
  pixels off a straight rod and read as a mace, then as a thistle. The vane is
  SOLID, the notches are cut out of its outer edge, and the grain is one step
  of tone every third diagonal -- on the shadow side only, because run across
  the lit side too the stripes read as the object rather than as its surface.
- **A ramp that skips steps reads flat.** The old shield face ran four tones
  and no specular. Six steps or it is a plate of one colour.

## What the ten ultimates cost, at 48 px in a gold frame

Five drawers at once, one per hero, so the same eye judged each pair that had
to look unlike itself. Thirty-nine passes across the ten, and three sent back
after review. Everything above still holds; these are the ones that only
showed up at the larger size, on the violet ground, or with five people
working at once.

- **Judge it at the size it is SHOWN at, not the size it is drawn at.** ARROW
  RAIN was well composed and clearly built at 224, and at 48 its ring lost its
  far arc to the ground and its three shafts merged into one mass. The drawer's
  own reported worry -- four tones on a 4 px shaft instead of six -- was the
  smaller problem by a distance. Look at the 48 px column first and the 224 px
  one second.
- **The six-step rule names a PLACE, not just a tone.** ARROW RAIN's ring had
  all six steps and still read as a `C`, because its reflected light sat on the
  band's INNER pixel, facing the hole, where it does nothing. "One pixel of
  reflected light on the far edge" means the edge turned away from the key and
  toward the ground. A checklist that only counts the steps will pass an icon
  that has every one of them in the wrong place.
- **Give a wall its size in PIXELS, never as a fraction.** Second time, new
  costume: MORE LINKS learnt it on a chain, ARROW RAIN relearnt it on a ring.
  A true annulus sets its wall as a ratio of each radius, so the far arc comes
  out one pixel wide -- physically right and illegible. Stamp the band a fixed
  number of pixels inward along the curve's own normal.
- **"Make it metal" is a SATURATION change, not a material swap.** FULL AUTO
  read as a wooden crate; painting the same box in the `leather` ramp changed
  nothing, because leather's middle steps are muted browns and muted brown IS
  wood. The `gold` ramp, which tops out saturated, is what moved the category.
  Silhouette had to move with it: a rectangle with a gradient is a box in any
  material, so the mouth became a flange standing PROUD of the body and the
  near corner was chamfered. Machined parts have cut corners; crates do not.
- **Two parallel diagonals are a CREASE.** EARTHSHATTER sheared its slab one
  way and ran the crack the same way, and the whole thing read as folded paper
  rather than as two pieces. The slab leans one way and the crack the other.
- **Two dots flanking a dark seam are a FACE,** whatever the dots are meant to
  be. THE LEAP's ankle had a rivet either side of its seam and acquired an
  expression. One strap instead.
- **A lighting value is not a position value.** Reusing the across-a-rod stop
  table as the stops for a lighting value drops every dark pixel onto the last
  character -- the reflected-light step -- because lighting runs past 1.0 on
  the turned-away side. The surface comes out two-tone with a bright rim, and
  nothing errors. Keep the two tables separate and named.
- **`cyl_row` spends a fifth of the width on the specular.** On a 13 px form
  that is three columns of near-white and the thing reads as chalk. Narrow the
  specular by hand on anything that slim.
- **The rhyme that matters is WITHIN a pair.** Seen together, THE BEAM and
  HARPOON are the same shape -- a diagonal haft with a bright point leading
  upper right. They belong to different heroes and a player only ever sees the
  two icons for the character they are playing, so it never reaches a screen.
  Check the set anyway; the check is cheap and it is how you learn which
  rhymes are real.

### Working on these at the same time as someone else

`ultimates48.js` is generated and SHARED. `draw-ultimates.py --only <ids>`
narrows which modules are imported, so a neighbour's half-written file cannot
break your build -- but it does not narrow the output, and whoever ran last
owns the file.

`icon-png.mjs` is safe from this on its own: it exits with `no such icon` when
an id you asked for is not in what it loaded, so a neighbour's build gives you
an error rather than their art. What is NOT safe is re-opening the generated
file yourself afterwards to dump a grid or count a colour -- that reads
whoever ran last. Import your own module and read `iconkit.ICONS` instead,
which cannot race.

The 16x16 pass (`icons.js`, `build-artboards.py`, `preview.html`) is gone. It
was rejected twice and the artboard carries what it looked like.
