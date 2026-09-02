# -*- coding: utf-8 -*-
from iconkit import G, N, register

# ── LONG THROW ──────────────────────────────────────────────────────────────
# A cylinder with a black fuse rope, not a canister: a fat body and a thin
# dark-wood fuse read as a fire extinguisher. Two paper wraps and a rope you
# can see the twist in are what make it a stick of dynamite.
d = G()
STICK = 'QRRrrqQ'              # 7 wide
BRIGHT = 'QRRRrqQ'             # the middle one stands in front


def stick(g, x, top, band):
    g.put(top, x + 1, band[1:-1].replace('r', 'R'))   # the cut paper end
    for y in range(top + 1, 27):
        g.put(y, x, band)
    g.put(27, x + 1, 'QqqqqQ'[:5])


stick(d, 6, 9, STICK)
stick(d, 18, 9, STICK)
stick(d, 12, 7, BRIGHT)        # drawn last, so it reads as the near one
for y in (15, 16, 17):                        # the cord binding the three
    d.put(y, 6, {15: 'uWWWwwwwwwwwwwvvvvu',
                 16: 'uWwwwwwwvvvvvvvvuuu',
                 17: 'uwwvvvvvvvvuuuuuuuu'}[y])
FUSE = [(15, 5), (16, 4), (17, 4), (18, 5), (19, 6)]
for i, (x, y) in enumerate(FUSE):
    d.px(x, y, 'N' if i % 2 == 0 else 'n')    # the twist: one lit strand in two
    d.px(x, y + 1, 'o')
d.put(5, 21, 'F')
d.put(6, 20, 'fYf')
d.put(7, 19, 'FYYYF')
d.put(8, 20, 'fYf')
d.put(9, 21, 'F')

register(
    'longThrow', label='LONG THROW', hero='ARCHER', kind='direct', cat='damage',
    why='a stick, fuse lit',
    ramps=('cloth', 'wood', 'fire', 'rope'),
    grid=d,
)
