# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── TOWER GUARD ─────────────────────────────────────────────────────────────
# Steel on the blue defence ground is cool on cool, which is the hourglass's
# lesson pointing the other way: the face is LEATHER, so the warm object sits
# off its cold socket, and the steel is spent where steel belongs -- the rim,
# the studs and the boss's ring.
#
# The old face ran four tones and no specular. Six steps or it reads as a
# plate of one colour: dark edge, specular, highlight, midtone, core shadow,
# and the reflected pixel down the right rim.
t = G()


def shield_span(y):
    """The kite outline: rounded shoulders, straight flanks, a long taper."""
    if y < 4 or y > 28:
        return None
    if y <= 6:
        half = (9.2, 10.0, 10.4)[y - 4]         # corners, not shoulders
    elif y <= 15:
        half = 10.4
    else:
        half = 10.4 * (1.0 - (y - 15) / 13.6) ** 0.80
    if half < 0.6:
        return None
    return (int(round(15.5 - half)), int(round(15.5 + half)))


for y in range(4, 29):
    sp = shield_span(y)
    if not sp:
        continue
    x0, x1 = sp
    for x in range(x0, x1 + 1):
        # A domed face, not a flat one: the light pools up and left of centre
        # and falls off as a distance rather than as a diagonal band.
        d = math.hypot((x - 11.6) / 12.6, (y - 10.8) / 13.8)
        t.px(x, y, pick(d, [0.30, 0.56, 0.84, 1.10], 'ECHhL'))
    t.px(x0, y, 'S')                            # the rim, in steel
    t.px(x0 + 1, y, 'P')                        # lit on the near bevel
    t.px(x1 - 1, y, 'S')
    t.px(x1, y, 'p')                            # and the bounce down the far one
sp = shield_span(4)
for x in range(sp[0], sp[1] + 1):
    t.px(x, 4, 'M' if x < 15 else 'P')          # the top edge takes the light
    t.px(x, 5, 'p' if x < 17 else 's')
for y in range(23, 29):                         # the point, out of the light
    sp = shield_span(y)
    if not sp:
        continue
    for x in range(sp[0], sp[1] + 1):
        t.px(x, y, pick((y - 23) / 5.0, [0.3, 0.7], 'HhL'))
    t.px(sp[0], y, 'S')
    t.px(sp[1], y, 'S')

# The band down the middle. A face of one leather is a panel; the band is what
# a shield has and a cup does not, and it gives the boss something to sit on.
for y in range(6, 27):
    sp = shield_span(y)
    if not sp or sp[1] - sp[0] < 5:
        continue
    for x in range(14, 18):
        if sp[0] + 1 < x < sp[1] - 1:
            t.px(x, y, 'C' if x == 14 else ('H' if x < 17 else 'h'))
    for edge in (13, 18):                       # the band stands proud of the face
        if sp[0] + 1 < edge < sp[1] - 1:
            t.px(edge, y, 'L')

for y in range(9, 22):                          # the domed boss, mid-face
    for x in range(11, 21):
        dd = math.hypot(x - 15.5, (y - 15.0) * 1.04)
        if dd > 4.2:
            continue
        if dd > 3.4:
            # The boss sits IN the face, so its ring is dark on the lit side
            # and bright where the face bounces back into it.
            t.px(x, y, 'g' if (x - 15.5) + (y - 15.0) > 2.4 else 'K')
            continue
        n = math.hypot(x - 14.3, (y - 13.7) * 1.04)
        t.px(x, y, pick(n, [1.2, 2.4, 3.9], 'GgkK'))
t.px(14, 14, 'G')                               # the specular, one pixel

for (sx, sy) in ((7, 8), (24, 8), (7, 14), (24, 14), (10, 21), (20, 21)):
    t.px(sx, sy, 'P')                           # studs, each a bead of its own
    t.px(sx + 1, sy, 's')
    t.px(sx, sy + 1, 's')
    t.px(sx + 1, sy + 1, 'X')

register(
    'towerGuard', label='TOWER GUARD', hero='KNIGHT', kind='indirect', cat='defence',
    why='a kite shield, gold boss',
    ramps=('leather', 'steel', 'gold'),
    grid=t,
)
