# -*- coding: utf-8 -*-
from iconkit import G, ULT_N, pick, register

# ── FULL AUTO ───────────────────────────────────────────────────────────────
# The repeater's magazine -- a BRASS body, riveted, with a gold mouth -- and
# three quarrels leaving it at once, splayed and at three different reaches.
#
# Drawn to be the OPPOSITE object to HARPOON, because the ranger takes one of
# the two and never both. Its line-mate is one heavy thing on a diagonal with
# a line coming back; this is a squat horizontal mechanism with many light
# things leaving it. Silhouette, axis and count all disagree on purpose.
#
# THE BODY IS METAL, AND THAT IS THE WHOLE FIX. Four drafts drew it in wood
# banded with a strap and every one of them read as a packing crate with
# sticks in it -- an open channel of quarrels in the lid did not save it, and
# at 48 px that channel was mottling on the wood anyway. A wooden box is
# packaging; a riveted brass body with a gold mouth is a made thing, which is
# the category the rest of the set is in. Brass and not steel: the ground is
# deep violet and the knight's sabaton has the cool ramp, so a grey mass here
# would sit badly and read as his.
#
# The body is the GOLD ramp, not the leather one. Drawn in leather it was
# still a wooden box: leather's middle steps are muted browns, which is what
# wood is, and no amount of rivets argued with it. Gold's steps are saturated,
# and saturation is most of what separates worked metal from a board. The body
# tops out at `g` and the mouth plate is `G`, so the mouth stays the brightest
# edge on the object and the eye is sent out along the fan.
f = G(ULT_N)

# (dark edge, specular, highlight, midtone, core shadow, reflected light)
BRASS = ('B', 'g', 'k', 'K', 'L', 'h')
WOOD_UP = ('E', 'W', 'w', 'u')      # a round shaft, lit crown to shadowed belly
STEEL_UP = ('M', 'P', 'p', 'S')

FX0, FX1 = 6, 19                    # the front face
FY0, FY1 = 20, 33
DEPTH = 3                           # how far the body leans back, in pixels

# Each quarrel: (row at the mouth, rise per column, where its point lands).
# THREE, splayed hard, and no two reaching the same column. Four run parallel
# two pixels apart is a rake -- or worse, a wooden hand, which is what one
# draft drew. What reads as a burst is air between them that widens as they
# go, and reaches that disagree. They get more of the plate than the body
# does, because they are the message.
QUARRELS = ((23.0, -0.26, 40), (27.0, 0.0, 34), (31.0, 0.26, 38))
HEAD = 6                            # length of the steel head, in pixels


def shaft(yc0, rise, x_tip):
    """One quarrel, drawn column by column so the splay costs nothing.

    Half-thickness is a number of PIXELS at every column rather than a
    fraction of the length, so the short one is as fat as the long one and
    the three read as three of the same thing.

    Drawn last, cut into the gold END with its own slot -- but starting
    BEYOND the mouth plate on the face, which is four columns wide and the
    brightest thing on the object. Started a column earlier the three of them
    ate all but one column of it, and the object lost the edge the eye is
    supposed to leave by. The rise is measured from the MOUTH -- measured from the far side
    of the body it had a whole body length to accumulate over before the
    quarrel became visible, and every one entered the plate rows off the row
    it was given.
    """
    for x in range(FX1 + 1, x_tip + 1):
        yc = yc0 + rise * (x - FX1)
        into_head = x - (x_tip - HEAD)
        if into_head <= 0:
            half, ramp = 1.2, WOOD_UP
        else:
            half, ramp = 1.9 - 1.5 * (into_head / float(HEAD)), STEEL_UP
        y0, y1 = int(round(yc - half)), int(round(yc + half))
        if x <= FX1 + DEPTH:                            # the slot it runs in,
            for sy in (y0 - 1, y1 + 1):                 # clipped to the body
                if FY0 - 1 <= sy <= FY1 + 1:
                    f.px(x, sy, 'B')
        for y in range(y0, y1 + 1):
            t = (y - y0) / float(max(1, y1 - y0))
            f.px(x, y, pick(t, [0.22, 0.5, 0.78], ramp))


# The body: front face, then the top and end that turn it into a solid.
for y in range(FY0, FY1 + 1):
    for x in range(FX0, FX1 + 1):
        v = 0.35 * (x - FX0) / float(FX1 - FX0) + 0.65 * (y - FY0) / float(FY1 - FY0)
        # Stops crowded toward the light: the body reaches its dark half a
        # third of the way down instead of at the far corner. An even wash
        # from light to dark is how wood and card read; metal falls away
        # fast under a bright top.
        f.px(x, y, pick(v, [0.12, 0.34, 0.60], BRASS[1:5]))
for y in range(FY0, FY1 + 1):
    f.px(FX0, y, 'B')                                   # the form's dark edge
for x in range(FX0, FX1 + 1):
    f.px(x, FY1, 'h')                                   # one pixel of bounce

for j in range(1, DEPTH + 1):
    for x in range(FX0 + j, FX1 + j + 1):
        f.px(x, FY0 - j, 'G' if j == 1 else 'g')
    for y in range(FY0 - j, FY1 - j + 1):
        f.px(FX1 + j, y, 'k' if y < FY0 - j + 4 else 'K')
    f.px(FX1 + j, FY1 - j, 'B')

# The mouth: the brightest edge on the object, and the end the quarrels leave
# by. Gold over brass rather than gold over wood, so it reads as furniture on
# a mechanism instead of banding on a crate.
# It stands PROUD of the body, a row above and a row below. A rectangle with
# a gradient on it is a box whatever it is painted in -- the silhouette is
# what says machined, so the plate is a flange rather than a stripe.
for y in range(FY0 - 1, FY1 + 2):
    for dx, ch in ((-3, 'B'), (-2, 'G'), (-1, 'G'), (0, 'g')):
        f.px(FX1 + dx, y, ch)
for j in range(1, DEPTH + 1):
    f.px(FX1 - 2 + j, FY0 - j, 'G')
    f.px(FX1 - 1 + j, FY0 - j, 'g')
    f.px(FX1 + j, FY0 - j, 'G')
    for y in range(FY0 - j + 1, FY1 - j + 1):
        f.px(FX1 + j, y, 'k' if j < DEPTH else 'K')

# The corner nearest the viewer is chamfered off. Four pixels of cut corner
# is the other half of the machined read, and it costs a triangle.
for dy in range(5):
    for dx in range(5 - dy):
        f.px(FX0 + dx, FY1 - dy, '.')
for i in range(5):
    f.px(FX0 + i, FY1 - 4 + i, 'h')

# Rivets. Four on the face and two on the top, which is what says the body was
# made rather than nailed together.
for rx, ry in ((FX0 + 2, FY0 + 2), (FX0 + 5, FY1 - 2),
               (FX1 - 5, FY0 + 2), (FX1 - 5, FY1 - 2)):
    f.px(rx, ry, 'G')
    f.px(rx + 1, ry, 'K')
    f.px(rx, ry + 1, 'K')
    f.px(rx + 1, ry + 1, 'B')
for rx in (FX0 + 4, FX1 - 4):
    f.px(rx + 2, FY0 - 2, 'G')
    f.px(rx + 3, FY0 - 2, 'B')

for row in QUARRELS:
    shaft(*row)

register(
    'fullAuto', label='FULL AUTO', hero='ranger', kind='mechanic', cat='ultimate',
    why='a riveted magazine, three quarrels leaving its gold mouth at once',
    ramps=('leather', 'gold', 'wood', 'steel'),
    grid=f,
)
