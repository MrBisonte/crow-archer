# -*- coding: utf-8 -*-
from iconkit import G, limb, pick, register

# ── SLIPSTREAM ──────────────────────────────────────────────────────────────
# A threaded needle. At full Momentum she runs through bodies unharmed, and a
# needle is the object that goes through a thing without tearing it.
#
# Two failures. A holed stone at 48 px is a pale lump with a dent in it. Then
# the needle was drawn at its true proportions -- four pixels at the eye down
# to one -- and a four-pixel diagonal with specks beside it is a scratch. The
# eye end is deliberately overweight now, the hole is three pixels of open
# socket rather than two, and the thread is two pixels thick so the loop can
# carry the silhouette the needle is too thin to carry alone.
m = G()

limb(m, 6.0, 26.0, 27.0, 5.0, 7.0, 1.2, 'MPpS')

# The eye. It is a HOLE, so it shows the socket, and it is ringed dark all the
# way round or it reads as a scratch on the metal instead of a way through it.
EYE = ((8, 24), (9, 23), (10, 22))
for x, y in EYE:
    m.px(x, y, '.')
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1)):
        if (x + dx, y + dy) not in EYE:
            m.px(x + dx, y + dy, 'X')

# The thread: out of the eye, round a full loop, and back over the shaft.
THREAD = [(7, 27), (9, 28), (12, 29), (15, 29), (18, 28), (20, 26), (20, 24),
          (19, 22), (17, 21), (14, 21), (12, 22), (11, 24), (12, 26), (14, 27),
          (17, 27), (19, 26), (21, 24), (23, 22)]
for i, (x, y) in enumerate(THREAD):
    ch = pick(i / float(len(THREAD) - 1), [0.30, 0.66], 'GgK')
    for dx in (0, 1):
        m.px(x + dx, y, ch)
        m.px(x + dx, y + 1, 'K')

register(
    'slipstream', label='SLIPSTREAM', hero='RANGER', kind='mechanic', cat='movement',
    why='a needle, threaded',
    ramps=('steel', 'gold'),
    grid=m,
)
