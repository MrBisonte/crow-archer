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

The 16x16 pass (`icons.js`, `build-artboards.py`, `preview.html`) is gone. It
was rejected twice and the artboard carries what it looked like.
