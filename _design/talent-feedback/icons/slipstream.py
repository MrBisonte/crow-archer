# -*- coding: utf-8 -*-
import math

from iconkit import G, N, register

# ── SLIPSTREAM ──────────────────────────────────────────────────────────────
# A holed stone. The rite is that at full Momentum she runs THROUGH a body, so
# the object is a body -- a solid mass with its own six steps -- with a way
# clean through it. A figure with a hole in it is a wound; a stone with a hole
# in it is a way through, and the socket's own gold shows down the bore, which
# is the read at 48 px.
#
# The mass is steel on the golden `movement` ground: cool on warm. Sandstone
# would have been the obvious colour and the wrong one -- brown on brown is
# what dissolved the hourglass's first frame into its own field.
m = G()

CX, CY = 15.4, 16.4
RX, RY = 10.1, 9.0
HOLE = (17.0, 17.6, 4.2)                    # a stone, not a washer: off centre
LX, LY = 10.6, 11.4                         # where the key light pools
STEEL = 'MPpsSX'                            # specular to dark edge
FALLOFF = (3.2, 6.2, 9.4, 12.8)


def tone(x, y):
    """Which step of the ramp the stone's face sits on at this pixel.

    A step rather than a character, so the pits can be cut RELATIVE to it. A
    pit written as a fixed dark and a fixed highlight put a white speck in the
    shadow side, which reads as a chip of quartz rather than as a hollow.
    """
    d = math.hypot(x - LX, y - LY)
    for i, s in enumerate(FALLOFF):
        if d < s:
            return i
    return 4


def edge(a, b):
    """How far out the outline sits at this bearing. A circle is a pebble."""
    th = math.atan2(b, a)
    return 1.0 + 0.075 * math.sin(3 * th + 0.7) + 0.05 * math.sin(5 * th + 2.2)


for y in range(N):
    for x in range(N):
        a, b = (x - CX) / RX, (y - CY) / RY
        d = math.hypot(a, b)
        rim = edge(a, b)
        if d > rim:
            continue
        hd = math.hypot(x - HOLE[0], y - HOLE[1])
        if hd < HOLE[2] - 1.05:
            continue                        # the bore, straight through
        if hd < HOLE[2]:
            # The wall of the bore. Light entering from the upper left lands on
            # the far inside, so the near inside is the darkest thing here --
            # that difference is the whole of why it reads as a hole and not a
            # painted spot.
            m.px(x, y, 's' if (x - HOLE[0]) + (y - HOLE[1]) > 0.8 else 'X')
            continue
        ch = STEEL[tone(x, y)]
        far = (x - CX) + (y - CY)
        if d > rim * 0.93:
            ch = 'p' if far > 3.0 else 'X'  # the bounce, and the dark edge
        elif d > rim * 0.85 and far > 3.0:
            ch = 'S'
        m.px(x, y, ch)

# Pits, cut as short strokes down the face: a stone with no pitting is a
# bearing, and single stray pixels are dirt rather than texture.
for (px, py, run) in ((9, 15, 3), (13, 22, 3), (19, 9, 2), (11, 10, 2)):
    for i in range(run):
        step = tone(px + i, py + i % 2)
        m.px(px + i, py + i % 2, STEEL[min(5, step + 2)])
        m.px(px + i, py + i % 2 + 1, STEEL[max(0, step - 1)])

register(
    'slipstream', label='SLIPSTREAM', hero='RANGER', kind='mechanic', cat='movement',
    why='a holed stone',
    ramps=('steel',),
    grid=m,
)
