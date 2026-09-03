# -*- coding: utf-8 -*-
from iconkit import G, cyl_row, register

# ── SPLINTER ────────────────────────────────────────────────────────────────
# Three charges in one tie, carried across the body. The stick bursts into
# three, so the object is the three.
#
# Three failures, each a different lesson. Red cloth like LONG THROW's bundle
# is red on the red damage socket: it smeared and read as flame. In steel,
# splayed from a point at the base, three shapes converging read as a fan of
# KNIVES. Stood upright and parallel behind a full-width tie, they read as a
# fence -- vertical bars of equal length with a rail across them are a gate
# whatever they are made of. Diagonal fixes both: nothing in a fence leans, and
# the tie is now a short wrap round the middle rather than a rail.
s = G()

STEEL = 'XMPpSs'
W = 7


def charge(x0, y0, x1, y1):
    """One case, low left to high right, with a cap at each end and a fuse."""
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    for i in range(n):
        t = i / float(n - 1)
        cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        s.put(int(round(cy)), int(round(cx - W / 2.0)), cyl_row(W, STEEL))
    s.put(int(round(y0)), int(round(x0 - W / 2.0)), 'XXSSSSS')
    s.put(int(round(y1)), int(round(x1 - W / 2.0)), 'SSSSSSS')
    wx, wy = int(round(x1)), int(round(y1))
    s.put(wy - 1, wx - 1, 'nno')
    s.put(wy - 3, wx, 'ef')
    s.put(wy - 4, wx, 'fF')


charge(6.0, 24.0, 20.0, 10.0)
charge(9.0, 28.0, 25.0, 14.0)
charge(4.0, 19.0, 17.0, 6.0)

# The tie: three turns across the middle only, so it binds rather than rails.
for i, ch in enumerate('NnnO'.replace('O', 'o')):
    for k in range(9):
        s.px(11 + i + k, 21 - k, ch)

register(
    'splinter', label='SPLINTER', hero='ARCHER', kind='direct', cat='damage',
    why='three charges, one tie',
    ramps=('steel', 'fire', 'rope'),
    grid=s,
)
