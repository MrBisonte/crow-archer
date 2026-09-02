# -*- coding: utf-8 -*-
import math

from iconkit import G, N, pick, register

# ── MORE LINKS ──────────────────────────────────────────────────────────────
# Five links, alternately face-on and on edge. That alternation is the whole
# read: a chain is the one object you recognise by the fact that no two
# neighbours lie the same way. The first draft swept a diamond band per link
# and they fused into one zigzag ribbon -- a chain with no holes in it is a
# lightning bolt.
m = G()


def link(g, cx, cy, half_len, outer, wall, ang, ramp):
    """One link: a capsule ring, its wall a fixed number of pixels.

    An ellipse ring sets its wall as a FRACTION of the radius, so the wall
    thickens with the link and the hole never wins. Four drafts of this icon
    died on that -- a ribbon, a helix, a fish, a spanner. A capsule takes the
    wall in pixels, which is the thing being drawn and the thing the owner
    could see was wrong.
    """
    ux, uy = math.cos(ang), math.sin(ang)
    for y in range(N):
        for x in range(N):
            dx, dy = x - cx, y - cy
            t = max(-half_len, min(half_len, dx * ux + dy * uy))
            px, py = dx - t * ux, dy - t * uy    # out from the link's spine
            d = math.hypot(px, py)
            if d > outer or d < outer - wall:
                continue
            k = 2.0 * (d - (outer - wall)) / wall - 1.0   # across it, -1 .. 1
            dl = d or 1.0
            face = (px / dl) * -0.707 + (py / dl) * -0.707
            sh = 0.62 * math.sqrt(max(0.0, 1.0 - k * k)) + k * face
            g.px(x, y, pick(-sh, [-0.86, -0.46, -0.06, 0.34], ramp))


# Five links: three seen face-on with a hole you can see through, two seen on
# edge between them. The alternation is what a chain is, and the two on edge
# are drawn FIRST so the rings close over them and read as the near ones.
AXIS = -math.pi / 4
STEP = 5.9
START = (6.6, 25.4)
places = [(START[0] + i * STEP * 0.707, START[1] - i * STEP * 0.707) for i in range(5)]
for i, (cx, cy) in enumerate(places):
    if i % 2:
        link(m, cx, cy, 2.4, 1.9, 1.9, AXIS, 'PpsSX')       # on edge: solid
for i, (cx, cy) in enumerate(places):
    if not i % 2:
        link(m, cx, cy, 2.7, 4.5, 2.2, AXIS, 'MPpsX')       # face-on: a hole

register(
    'moreLinks', label='MORE LINKS', hero='SAPPER', kind='mechanic', cat='damage',
    why='five links of chain',
    ramps=('steel',),
    grid=m,
)
