# -*- coding: utf-8 -*-
from iconkit import G, pick, register

# ── BERSERKER ───────────────────────────────────────────────────────────────
# A great helm, visor down. The talent keeps the Bloodlust stacks a miss would
# otherwise empty, so the object is the one a knight does not take off.
#
# Steel, because `damage` tints the socket red and steel is the only cool ramp
# in the set -- the helm separates from its ground by hue before it separates
# by value. Its two line-mates are warm (a blade, a phial), so the tier reads
# as the same idea hardening.
h = G()


def half(y):
    """Half-width of the helm at row y: crown, barrel, then the chin taper."""
    if y < 9:
        return 5.0 + 3.0 * (y - 5) / 4.0
    if y < 22:
        return 8.0
    return 8.0 - 4.2 * (y - 21) / 6.0


MID = 15.5

for y in range(5, 28):
    w = half(y)
    x0, x1 = int(round(MID - w)), int(round(MID + w))
    span = max(1, x1 - x0)
    for x in range(x0, x1 + 1):
        f = (x - x0) / float(span)
        if x == x0:
            ch = 'X'                       # dark edge, the near side of the form
        elif x == x1:
            ch = 's'                       # one pixel of reflected light
        else:
            ch = pick(f, [0.16, 0.34, 0.56, 0.80], 'MPpsS')
        h.px(x, y, ch)

# The reinforce: a cross of raised steel, one step brighter than the plate it
# sits on, with its own shadow on the low side so it reads as standing off.
for y in range(6, 24):
    h.px(15, y, 'P')
    h.px(16, y, 'p')
    h.px(17, y, 'S')
for x in range(9, 23):
    h.px(x, 11, 'P')
    h.px(x, 12, 'p')
    h.px(x, 13, 'S')

# The slit. Cut through the reinforce as well -- a bar that crosses an opening
# unbroken reads as painted on.
for x in range(9, 15):
    h.px(x, 15, 'X')
    h.px(x, 16, 'X')
for x in range(17, 23):
    h.px(x, 15, 'X')
    h.px(x, 16, 'X')
h.px(8, 15, 'S')
h.px(23, 15, 'S')

# Breath holes, and gold rivets at the four corners of the reinforce.
for x in (11, 13, 19, 21):
    h.px(x, 20, 'X')
    h.px(x, 21, 'X')
for x, y in ((9, 8), (22, 8), (9, 22), (22, 22)):
    h.px(x, y, 'G')
    h.px(x, y + 1, 'k')

register(
    'berserker', label='BERSERKER', hero='KNIGHT', kind='indirect', cat='damage',
    why='a great helm, visor down',
    ramps=('steel', 'gold'),
    grid=h,
)
