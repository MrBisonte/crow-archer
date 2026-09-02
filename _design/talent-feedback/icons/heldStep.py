# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── HELD STEP ───────────────────────────────────────────────────────────────
# An hourglass. The talent buys TIME -- the window a chained hop has to be
# taken in -- and time is the one idea in the set with an object everybody
# already owns.
#
# Third drawing, and the two failures were different.
#
# First it was two lit walls around a dark interior, on the theory that seeing
# through it is what makes glass read as glass. On the socket an outline has
# nothing to be lit, so it read as a wireframe.
#
# Then the frame was WOOD, and wood on this icon's ground is brown on brown:
# `movement` tints the socket golden, and the dark end of the wood ramp
# (#5A3F1D, #33230E) sits right on top of the ground's lit pool (#6E5522,
# #493716). The silhouette dissolved into the field it was standing on. The
# frame is steel now, which is the one ramp in the set that is COOL -- it
# separates from a warm socket by hue as well as by value, and no amount of
# re-lighting a brown frame would have done that.
#
# The three materials are then read apart by value: frame at the light end of
# steel, glass at the dark end of it, sand in gold and brightest of all,
# because the sand is the thing the icon is actually about.
t = G()


def bulb_half(y):
    """Half-width of the glass at row y: 1.6 at the waist, 7.5 at the caps."""
    k = (15 - y) / 8.0 if y <= 15 else (y - 16) / 8.0
    return 1.6 + 5.9 * k


WAIST = 15.5

for y in range(7, 25):
    half = bulb_half(y)
    x0, x1 = int(round(WAIST - half)), int(round(WAIST + half))
    span = max(1, x1 - x0)
    for x in range(x0, x1 + 1):
        f = (x - x0) / float(span)
        if x == x0:
            ch = 'P'                       # the near wall, catching the key light
        elif x == x1:
            ch = 's'                       # reflected light on the far wall
        else:
            ch = pick(f, [0.24, 0.58, 0.86], 'ppsS')
        t.px(x, y, ch)

# The sand: what is left above, the thread of it falling, and the heap below.
# Mounded rather than level -- a flat top reads as liquid, and the whole point
# of the object is that it is running out.
for y in range(11, 16):
    half = max(0.0, bulb_half(y) - 2.0)
    if half < 0.6:
        continue
    x0 = int(round(WAIST - half))
    w = max(1, int(round(half * 2)))
    t.put(y, x0, 'G' + 'g' * max(0, w - 2) + 'k')
for y in range(16, 21):
    t.px(15, y, 'G')
    t.px(16, y, 'k')
for y in range(20, 25):
    half = max(0.0, bulb_half(y) - 2.0)
    mound = half * (1.0 - 0.5 * (24 - y) / 4.0)
    if mound < 0.6:
        continue
    x0 = int(round(WAIST - mound))
    w = max(1, int(round(mound * 2)))
    t.put(y, x0, 'G' + 'g' * max(0, w - 2) + 'k')

# Frame: two caps and nothing else. It carried side posts as well, and they
# were two steel rails running the full height a bare pixel outside the glass
# -- at 48 px they closed up against the bulb and the whole object read as one
# slab. Caps alone leave the bulb's own curve to draw the sides, which is what
# an hourglass is recognised by anyway.
for y, ch in ((3, 'P'), (4, 'M'), (5, 'p'), (26, 'p'), (27, 'P'), (28, 's')):
    t.put(y, 6, ch * 20)
t.put(5, 6, 'p' * 20)
t.put(6, 7, 'S' * 18)                          # shadow under the top cap
t.put(25, 7, 'S' * 18)                         # and over the bottom one

register(
    'heldStep', label='HELD STEP', hero='WIZARD', kind='mechanic', cat='movement',
    why='an hourglass, running',
    ramps=('steel', 'gold'),
    grid=t,
)
