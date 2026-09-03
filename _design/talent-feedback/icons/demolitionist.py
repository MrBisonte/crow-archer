# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── DEMOLITIONIST ───────────────────────────────────────────────────────────
# The rite makes every blast in a chain wider than the last, so the object is
# the biggest charge the sapper carries: a hooped powder keg, not another bomb
# and certainly not a second row of rings.
#
# The staves are LEATHER. Wood on the red damage ground is brown on brown --
# the hourglass's lesson pointed at this socket -- and the ochre end of leather
# is the one warm ramp that still separates from it by hue. The hoops are
# steel, the only cool ramp, so the two bands cut the tan in half and stop it
# reading as a sack.
k = G()

CX = 15.5
TOP, BOT = 11, 27               # the head and the foot
HEAD_Y, HEAD_RX, HEAD_RY = 10.5, 6.6, 3.0
HOOPS = ((13, 14), (23, 24))    # rows, near each end the way a cooper sets them
STAVES = (0.20, 0.42, 0.66, 0.87)   # seams, given as a place ROUND the barrel

# Across a barrel, the six steps in order: dark edge, specular, highlight,
# midtone, core shadow, dark, and one pixel of reflected light on the far edge.
STOPS = (0.07, 0.18, 0.37, 0.63, 0.83, 0.94)
WOODEN = 'BECHhLh'
BANDED = 'XMPpsSp'
DARKER = {'B': 'B', 'E': 'C', 'C': 'H', 'H': 'h', 'h': 'L', 'L': 'B',
          'X': 'X', 'M': 'P', 'P': 'p', 'p': 's', 's': 'S', 'S': 'X'}


def half(y):
    """Half-width at row y. A keg bulges at the belly; a bucket does not."""
    return 7.0 + 2.0 * math.sin(math.pi * (y - TOP) / float(BOT - TOP))


# The head, seen from a little above: a lit disc the staves close over. Drawn
# first, so the body's top row eats its lower arc and what is left is the dome.
for y in range(6, TOP):            # row TOP and below is all staves anyway
    for x in range(8, 24):
        if ((x - CX) / HEAD_RX) ** 2 + ((y - HEAD_Y) / HEAD_RY) ** 2 > 1.0:
            continue
        k.px(x, y, pick(math.hypot((x - 12.6) / 5.2, (y - 8.8) / 3.0),
                        [0.42, 0.70, 1.00, 1.34], 'ECHhL'))

for y in range(TOP, BOT + 1):
    hw = half(y)
    x0, x1 = int(round(CX - hw)), int(round(CX + hw))
    hoop = any(lo <= y <= hi for lo, hi in HOOPS)
    for x in range(x0, x1 + 1):
        t = (x - (CX - hw)) / (2.0 * hw)
        ch = pick(t, STOPS, BANDED if hoop else WOODEN)
        if not hoop and any(abs(t - s) * 2.0 * hw < 0.5 for s in STAVES):
            ch = DARKER[ch]                     # a stave seam, one step down
        if y > BOT - 4:
            ch = DARKER[ch]                     # the foot, out of the light
        k.px(x, y, ch)

# The bung and its fuse, burning. Without fire this is a barrel of ale; the
# flame is what makes it powder. It stays short and stays over the head --
# LONG FUSE is the icon that owns a cord running the width of the socket.
#
# The cord changes value where its background does: a tan cord over the lit
# head is tan on tan and vanishes, which is how the first pass ended up with a
# flame floating on nothing. Dark across the lid, lit against the ground.
k.px(14, 10, 'B')                               # the bung, a hole in the head
k.px(15, 10, 'B')
for (x, y, ch) in ((15, 9, 'L'), (16, 9, 'B'),   # dark where it crosses the lid
                   (16, 8, 'L'), (17, 8, 'B'),
                   (17, 7, 'E'), (18, 7, 'L')):  # lit once it is against ground
    k.px(x, y, ch)
# The socket clips at row 4, so the flame cannot be tall. It is widened
# instead: at 48 px a three-pixel flame is one orange speck and the keg goes
# back to being a barrel of ale.
for (x, y, ch) in ((16, 6, 'f'), (17, 6, 'F'), (18, 6, 'e'),
                   (15, 5, 'e'), (16, 5, 'F'), (17, 5, 'Y'), (18, 5, 'F'),
                   (19, 5, 'f'),
                   (16, 4, 'F'), (17, 4, 'Y'), (18, 4, 'F'), (19, 4, 'f')):
    k.px(x, y, ch)

register(
    'demolitionist', label='DEMOLITIONIST', hero='SAPPER', kind='direct', cat='damage',
    why='a powder keg, hooped',
    ramps=('leather', 'steel', 'fire'),
    grid=k,
)
