# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── ROOTED ──────────────────────────────────────────────────────────────────
# An anchor: ring, stock, two thin arms curving up, a fluke on the end of each.
#
# Two drafts of a driven stake went in the bin first. On the slant, a tapering
# tan bar with a band across it is the BOOT one tier below; upright, with its
# head burred over, it is a column on a plinth. Both failed on silhouette
# rather than on pixels, and both were a pale vertical body over a dark mass at
# its foot -- which is the STUMP one tier below.
#
# So the object became the one that holds a thing which is MOVING, and its
# silhouette is unlike anything else in the set. It is also the only archer
# icon in steel: the two under it are tan and brown on this same green socket,
# and a cold object is what tells the three apart at 48 px.
#
# The arms are 3 px thick and the flukes are 6 px across, both given in PIXELS.
# Drawn as fractions of each other they came out equally fat, filled the whole
# lower half and read as a boat -- an anchor is mostly the SPACE between the
# shank and its flukes. That is the chain-link lesson, one object over.
a = G()

CX, CY = 15.5, 15.5
RING_Y, RING_R, RING_HALF = 7.6, 3.1, 1.2       # a 4 px hole
ARM_R, ARM_HALF = 9.7, 1.6
SHANK_LIT = 'XMPPpsXp'                          # dark edge, specular, highlight,
SHANK_LOW = 'XPPppsXs'                          # midtone, core shadow, edge, and
STOCK = 'XMPps'                                 # the far reflected pixel
#         inner         outer-low     the point     the ridge it is folded on
FLUKES = (((9.6, 20.0), (5.4, 23.2), (3.8, 17.8), (7.1, 20.4)),
          ((21.4, 20.0), (25.6, 23.2), (27.2, 17.8), (23.9, 20.4)))


def steel(n):
    """Six steps of steel read off a lighting value."""
    return pick(n, [0.8, 1.7, 2.7, 3.7, 4.7], 'MPpsSX')


def near(px, py, qx, qy, x, y):
    """Distance from (x, y) to the segment pq -- a blade's ridge line."""
    dx, dy = qx - px, qy - py
    t = max(0.0, min(1.0, ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (px + dx * t), y - (py + dy * t))


def key(x, y, y0):
    """How far round the form the key light has travelled, up and left of it."""
    return ((x - CX) + (y - y0)) * 0.055


for y in range(4, 13):                          # the ring
    for x in range(10, 22):
        if abs(math.hypot(x - CX, y - RING_Y) - RING_R) > RING_HALF:
            continue
        a.px(x, y, steel(math.hypot(x - 12.6, y - 5.6) * 0.72))

for i, ch in enumerate(STOCK):                  # the stock, across the shank
    for x in range(6, 26):
        # Tapered: a bar of one thickness corner to corner is a crossbar, and
        # a crossbar over a shaft is a sword.
        t = abs(x - CX) / 10.0
        if (i == 0 and t > 0.76) or (i == len(STOCK) - 1 and t > 0.86):
            continue
        a.px(x, 13 + i, ch)
for x in list(range(8, 12)) + list(range(20, 24)):
    a.px(x, 18, 'p')                            # the light the ground bounces

for i in range(241):                            # the arms, thin and curving up
    th = math.radians(30.0 + i * 0.5)
    r = ARM_R - ARM_HALF
    while r <= ARM_R + ARM_HALF:
        x, y = CX + r * math.cos(th), CY + r * math.sin(th)
        a.px(int(round(x)), int(round(y)),
             steel(1.0 + (r - ARM_R) / ARM_HALF * 2.2 + key(x, y, CY)))
        r += 0.5

for tri in FLUKES:
    (rx, ry) = tri[3]
    for y in range(16, 25):
        for x in range(3, 29):
            side = [(x - p) * (s - q) - (y - q) * (r - p) for (p, q), (r, s)
                    in zip(tri[:3], tri[1:3] + tri[:1])]
            if not (all(v >= 0 for v in side) or all(v <= 0 for v in side)):
                continue
            # A fluke is a blade folded on a ridge, not a flat wedge: the tone
            # falls away from that ridge and again toward the dark corner.
            a.px(x, y, steel(0.8 + near(rx, ry, tri[2][0], tri[2][1], x, y)
                             + key(x, y, 19.0)))

for y in range(11, 26):                         # the shank, laid over the rest
    a.put(y, 12, SHANK_LIT if y < 19 else SHANK_LOW)

register(
    'rooted', label='ROOTED', hero='ARCHER', kind='indirect', cat='speed',
    why='an anchor, flukes and stock',
    ramps=('steel',),
    grid=a,
)
