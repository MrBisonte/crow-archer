# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── SPLINTER ────────────────────────────────────────────────────────────────
# ONE stick of dynamite, snapped into three lengths that have just begun to
# kick apart, with the blast breaking out of both cuts. Three separate sticks
# is LONG THROW and it is also a diagram -- the count has to be a feature of a
# single object, the way DEEP ROOTS counts roots, or the icon stops being a
# painting of a thing.
#
# The three lengths are UNEQUAL and each leans a little further than the last.
# Even blocks on one axis read as a stack of bricks; what says one stick came
# apart is that the pieces still line up while no two of them match.
#
# The fire is kept INSIDE the two cuts. Run wide it swallows the paper and the
# icon reads as molten rock -- the second draft did exactly that, and the
# tongues thrown clear of it floated with nothing holding them on.
#
# Cloth carries four tones, one short of a cylinder. Fire's `e` sits between R
# and r, so the paper takes it as its fourth step and the cuts take the rest of
# that ramp: the wrap is lit by what is coming out of it.
s = G()

PAPER = 'QRReerqqQr'          # 10 across: edge, specular, highlight, midtone,
CUT = 'QqeerqqqQq'            # core shadow, edge, and the far reflected pixel
END = 'RReerqqQ'              # the crimped paper end, inset from the wrap

#          top  bottom   x at top  lean per row
PIECES = ((6, 10, 11.8, 0.30), (14, 19, 15.3, 0.16), (23, 26, 19.0, 0.26))
BREAKS = ((13.4, 12.0), (17.4, 21.0))               # where it came apart
FUSE = ((10, 5), (11, 4), (12, 4), (13, 5))


def left(cx, lean, top, y):
    return int(round(cx + (y - top) * lean - len(PAPER) / 2.0))


for top, bottom, cx, lean in PIECES:
    for y in range(top, bottom + 1):
        s.put(y, left(cx, lean, top, y), CUT if y in (top, bottom) else PAPER)
TOP, _, TOP_X, _LEAN = PIECES[0]
s.put(TOP, left(TOP_X, _LEAN, TOP, TOP) + 1, END)

for i, (x, y) in enumerate(FUSE):                   # the fuse, burnt to a stub
    s.px(x, y, 'N' if i % 2 == 0 else 'n')          # -- one pixel of cord, not
s.px(FUSE[-1][0] + 1, FUSE[-1][1] + 1, 'o')         # two: two is a knob

for (bx, by) in BREAKS:
    for y in range(int(by) - 1, int(by) + 2):
        for x in range(int(bx) - 7, int(bx) + 8):
            if math.hypot((x - bx) / 5.6, (y - by) / 1.7) > 1.0:
                continue
            # The core sits up and left of the cut, the way the key light does.
            s.px(x, y, pick(math.hypot((x - bx + 1.1) / 3.4, (y - by + 0.4) / 1.2),
                            [0.44, 0.80, 1.15], 'YFfe'))

register(
    'splinter', label='SPLINTER', hero='ARCHER', kind='direct', cat='damage',
    why='a stick, broken in three',
    ramps=('cloth', 'fire', 'rope'),
    grid=s,
)
