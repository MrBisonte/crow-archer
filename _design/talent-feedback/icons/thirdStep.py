# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── THIRD STEP ──────────────────────────────────────────────────────────────
# Three cut steps climbing away from the viewer, and the third one gold: the
# set has no other way to say "this is the one you just bought" without
# printing a number on the icon.
#
# Third drawing. Flat risers read as a bar chart; treads and risers alone --
# two planes, seen straight on -- read as a zigzag line. A step only reads as
# a step when you can see the TOP of it, so each one is a box in oblique
# projection with three faces catching three different amounts of light: the
# tread into the key light, the riser facing the viewer, and the right end
# turned away from it. The nosing is one line of shadow under each front edge,
# which is what separates a stack of boxes from a folded ribbon.
q = G()

STEP_W = 10          # how wide a step is, in pixels
STEP_H = 5           # the riser
TREAD_ROWS = 3       # how much of the top face is seen
TREAD_DX = 5         # how far it recedes to the right over those rows
END_W = 2            # the right end, turned away from the light


def riser(g, x0, y0, ramp, end):
    """The face turned toward the viewer, with its nosing shadow on top."""
    for k in range(STEP_H):
        f = k / float(STEP_H - 1)
        # Reflected light on the bottom row, the same last step every surface
        # in this set runs. Without it the foot of a riser goes to black and
        # the step below stops being a separate object.
        g.put(y0 + k, x0, pick(f, [0.28, 0.66, 0.92], ramp) * STEP_W)
        g.put(y0 + k, x0 + STEP_W, end * END_W)
    g.put(y0, x0, 'X' * STEP_W)                 # the nosing
    g.px(x0, y0, ramp[0])                       # except at the lit corner


def tread(g, x0, y0, ramp, end):
    """The top face, swept back and to the right off the front edge."""
    for r in range(TREAD_ROWS):
        f = r / float(TREAD_ROWS - 1)
        x = int(round(x0 + TREAD_DX * f))
        g.put(y0 - r, x, pick(f, [0.34, 0.7], ramp) * STEP_W)
        g.put(y0 - r, x + STEP_W, end * END_W)


# Each step stands on the back edge of the one in front, which is what makes
# it a flight rather than three blocks in a row.
for i, (x0, y0) in enumerate(((2, 24), (7, 16), (12, 8))):
    gold = i == 2
    riser(q, x0, y0, 'gkKk' if gold else 'psSs', 'K' if gold else 'X')
    tread(q, x0, y0 - 1, 'Ggk' if gold else 'MPp', 'k' if gold else 'S')

register(
    'thirdStep', label='THIRD STEP', hero='WIZARD', kind='mechanic', cat='movement',
    why='three steps, the third gold',
    ramps=('steel', 'gold'),
    grid=q,
)
