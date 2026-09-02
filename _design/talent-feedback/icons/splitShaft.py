# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── SPLIT SHAFT ─────────────────────────────────────────────────────────────
# A whole arrow, not a head. The forked tip was legible on its own but nobody
# could say what the object WAS -- the shaft and the fletching are what name
# it, so the head gives up two thirds of the socket to make room for them.
s = G()
# Straight edges, and a notch deep enough to be a fork rather than a dent: a
# rounded head with a nick in it read as a goblet.
# Straight edges, and two prongs that each come to a POINT. A notch cut into a
# rounded head read as a goblet; flat-topped prongs read as a spanner. The tip
# of each prong is one pixel wide, and it widens from there.
CENTRE = 15.5

# What separates an arrowhead from a spanner is not the tips, it is the
# proportion and the barbs: TALL and NARROW, widest at the base where the barbs
# flare, then an abrupt step in to the ferrule. A wide short head with a notch
# read as an axe, then as a goblet, then as a spanner -- all three times
# because the silhouette was as broad as it was long.
def head_outer(y):
    k = (y - 4) / 13.0
    return 1.6 + k * 2.4 + (0.35 if y >= 16 else 0.0)      # the barb flare


def head_inner(y):
    return max(0.0, 1.05 * (1.0 - (y - 4) / 7.0))


for y in range(4, 18):
    outer, inner = head_outer(y), head_inner(y)
    for x in range(int(round(CENTRE - outer)), int(round(CENTRE + outer)) + 1):
        if inner and abs(x - CENTRE) <= inner:
            continue
        if inner:
            lo, hi = (CENTRE - outer, CENTRE - inner) if x < CENTRE                 else (CENTRE + inner, CENTRE + outer)
        else:
            lo, hi = CENTRE - outer, CENTRE + outer
        n = abs(x - (lo + hi) / 2.0) * (1.9 if inner else 1.15) + (x - CENTRE) * 0.34
        s.px(x, y, pick(n, [1.0, 2.6, 4.4, 6.4], 'MPpsS'))
for y in (18, 19):                            # the ferrule the head socks into
    s.put(y, 14, 'PMPs')
FLETCH = [(21, 14, 'R'), (22, 13, 'Rr'), (23, 12, 'RRr'), (24, 12, 'RRr'),
          (25, 13, 'Rr'), (26, 14, 'R'),
          (21, 18, 'r'), (22, 18, 'rq'), (23, 18, 'rqq'), (24, 18, 'rqq'),
          (25, 18, 'rq'), (26, 18, 'r')]
for y, x, band in FLETCH:
    s.put(y, x, band)
for y in range(20, 27):                       # the shaft, laid OVER the vanes
    s.put(y, 15, 'Wwv')                       # so it reads through them
s.put(27, 14, 'PMPp')                         # the nock

register(
    'splitShaft', label='SPLIT SHAFT', hero='ARCHER', kind='direct', cat='damage',
    why='an arrow, head forked',
    ramps=('steel', 'wood', 'cloth'),
    grid=s,
)
