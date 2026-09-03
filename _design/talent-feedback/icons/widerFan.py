# -*- coding: utf-8 -*-
import math

from iconkit import G, N, pick, register

# ── WIDER FAN ───────────────────────────────────────────────────────────────
# Four bombs on one arc, each bigger than the one behind it, and the outermost
# one lit. The talent adds a bomb to the barrage, so the arc IS the object: the
# bodies touch along it, which is what makes four spheres one thing rather than
# four things floating in a socket.
#
# Sizes are radii in PIXELS and the spout is 2 px by 2 px on every one of them.
# Taken as a fraction of the body the spout would grow with the bomb and the
# smallest would be all collar -- the mistake MORE LINKS made four times over
# with a link's wall.
w = G()

LX, LY, LZ = -0.50, -0.56, 0.66     # key light: up, left, and toward the viewer
SPOUT_W, SPOUT_H = 2, 2
STEPS = [-0.98, -0.92, -0.82, -0.56, -0.20]
BOUNCE = 0.62

# Centre, radius. Walked up the arc with each gap set to the two radii less
# 0.5 px, so neighbours just bite into each other. The radii double across the
# four: a gentler progression gave four near-identical bodies in a row, which
# at 48 px is a caterpillar. Growth has to be the loudest thing about the arc,
# because growth is what the talent does.
BOMBS = ((8.2, 24.6, 2.0), (10.8, 21.3, 2.7), (15.4, 18.2, 3.4),
         (22.1, 16.3, 4.1))


def orb(g, cx, cy, r, ramp):
    """A sphere in six steps, with reflected light on the rim turned away.

    The bounce term is confined to the rim by d2 ** 7. Spread across the whole
    shadow side it lifts the dark half evenly and the sphere reads as a disc,
    which is the same failure as a ramp that skips steps.
    """
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            dx, dy = (x - cx) / r, (y - cy) / r
            d2 = dx * dx + dy * dy
            if d2 > 1.0:
                continue
            lam = dx * LX + dy * LY + math.sqrt(1.0 - d2) * LZ
            lam += BOUNCE * max(0.0, -(dx * LX + dy * LY)) * d2 ** 7
            g.px(x, y, pick(-lam, STEPS, ramp))


def cut_in(g, cx, cy, r):
    """A dark ring one pixel outside the body, painted only over what is
    already drawn. compose.mjs seams the OUTSIDE of an object, so two touching
    spheres get no seam between them and fuse into one long blob -- which is
    exactly what the first draft of this icon was."""
    for y in range(max(0, int(cy - r) - 2), min(N, int(cy + r) + 3)):
        for x in range(max(0, int(cx - r) - 2), min(N, int(cx + r) + 3)):
            dx, dy = (x - cx) / r, (y - cy) / r
            d2 = dx * dx + dy * dy
            if 1.0 < d2 <= 1.0 + 2.4 / r and g.g[y][x] != '.':
                g.px(x, y, 'X')


def bomb(g, cx, cy, r):
    """One body with its spout, and where the cord leaves it."""
    cut_in(g, cx, cy, r)
    orb(g, cx, cy, r, 'MPpsSX')
    ax, ay = int(round(cx)) - 1, int(round(cy - r)) - 1
    for i in range(SPOUT_W):
        for k in range(SPOUT_H):
            g.px(ax + i, ay + k, 'PpsX'[min(3, i + k)])
    return ax, ay


def fuse(g, cells):
    """A cord: one lit strand in two, with its shadow under it."""
    for i, (x, y) in enumerate(cells):
        g.px(x, y, 'N' if i % 2 == 0 else 'n')
        g.px(x, y + 1, 'o')


# Back to front, smallest first: the nearer bodies close over the ones behind
# and the arc gains a depth a row of discs has not. Cords lead up and away from
# the arc, which is the one direction that is empty in all four places.
for (cx, cy, r) in BOMBS[:3]:
    ax, ay = bomb(w, cx, cy, r)
    fuse(w, ((ax - 1, ay - 1),))
ax, ay = bomb(w, *BOMBS[3])
fuse(w, ((ax - 1, ay - 1), (ax - 2, ay - 2), (ax - 3, ay - 3)))

# One flame, not four. Four sparks on one arc is confetti, and the one that
# burns is the bomb this talent just added.
w.put(4, 17, 'F')
w.put(5, 16, 'fYf')
w.put(6, 15, 'FYYYF')
w.put(7, 16, 'fYf')
w.put(8, 17, 'F')

register(
    'widerFan', label='WIDER FAN', hero='SAPPER', kind='direct', cat='damage',
    why='four bombs on a widening arc',
    ramps=('steel', 'rope', 'fire'),
    grid=w,
)
