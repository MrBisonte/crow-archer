# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── HOLDFAST ────────────────────────────────────────────────────────────────
# An iron post with two round turns of the net's line on it, hauled taut. The
# rite does not catch anything -- WIDE NET does that -- it makes what is caught
# stay caught, so the object is the thing a line is made fast TO.
#
# Steel on the red `damage` ground, because steel is the only cool ramp in the
# set and this socket is the warm one. The line is the one warm thing on it and
# it is the same hemp the net's mesh is drawn in, which is what makes the two
# icons a pair rather than two drawings.
h = G()

STEEL = 'MPpsSX'          # specular, highlight, midtone, .., core shadow, edge
CAP_ROWS = ((6, 10, 22, -1),      # the top face, straight into the light
            (7, 9, 23, 0),        # the burr, where it has been hammered over
            (8, 9, 23, 1),
            (9, 10, 22, 2))       # and the shade under the overhang
SHAFT_X0, SHAFT_X1 = 11, 20
SHAFT_TOP, SHAFT_BOT = 10, 26


def barrel(x, x0, x1, shift=0):
    """One row across a cylinder lit from the upper left.

    Six steps, and the last of them is the point: `x1` is one pixel of bounce
    off the far side, NOT the darkest step. Run a cylinder straight down into
    its dark end and it reads as a stripe.
    """
    if x == x0:
        return 'X'
    if x == x1:
        return 'p'
    t = (x - x0) / float(max(1, x1 - x0))
    i = pick(t, [0.18, 0.34, 0.56, 0.78], (0, 1, 2, 3, 4))
    return STEEL[max(0, min(5, i + shift))]


for row, x0, x1, shift in CAP_ROWS:
    for x in range(x0, x1 + 1):
        h.px(x, row, barrel(x, x0, x1, shift))

for y in range(SHAFT_TOP, SHAFT_BOT + 1):
    # The post is driven, so the foot is not lit: it goes down out of the key
    # light rather than stopping at a base plate. A plate here made a chess rook.
    drop = 0 if y < 21 else (1 if y < 24 else 2)
    for x in range(SHAFT_X0, SHAFT_X1 + 1):
        h.px(x, y, barrel(x, SHAFT_X0, SHAFT_X1, drop))

# Two round turns, standing one pixel proud of the shaft on each side. Rope has
# three values and three read flat, so the crown of each turn takes a steel
# highlight -- a cord in cool light does glint, and it is the difference
# between a wrapping and a painted band.
ROPE = 'Nno'
for top in (13, 17):
    for x in range(SHAFT_X0 - 1, SHAFT_X1 + 2):
        t = (x - (SHAFT_X0 - 1)) / float(SHAFT_X1 + 1 - (SHAFT_X0 - 1))
        i = pick(t, [0.34, 0.68], (0, 1, 2))
        h.px(x, top, 'p' if t < 0.20 else ROPE[i])
        h.px(x, top + 1, ROPE[min(2, i + 1)])

# The standing part, running off to the left and DOWN: the load is on it. A
# slack line here would say the net had already let go.
STAND = ((10, 15), (9, 15), (8, 16), (7, 16), (6, 17), (5, 17), (4, 18))
for i, (x, y) in enumerate(STAND):
    h.px(x, y, 'p' if i == 2 else 'N')
    h.px(x, y + 1, 'n' if i % 2 else 'o')

# The bitter end hanging off the lower turn. Two turns and no tail is a band
# round a post; the tail is what says it was tied there.
for i, (x, y) in enumerate(((21, 19), (21, 20), (22, 21), (22, 22), (23, 23))):
    h.px(x, y, 'N' if i % 2 == 0 else 'n')
    h.px(x + 1, y, 'o')

register(
    'holdfast', label='HOLDFAST', hero='RANGER', kind='direct', cat='damage',
    why='an iron post, two turns roped',
    ramps=('steel', 'rope'),
    grid=h,
)
