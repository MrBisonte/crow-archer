# -*- coding: utf-8 -*-
import math

from iconkit import G, ULT_N, pick, register

# ── EARTHSHATTER ────────────────────────────────────────────────────────────
# One slab of ground, seen from above and in front, snapped through by a
# fissure that is one pixel wide where it starts at the near edge and eleven
# where it leaves at the far one. The object is the GROUND, not the spear that
# broke it: this ultimate's shape is force leaving him ALONG the floor, so the
# icon is low, wide and horizontal, and its partner THE LEAP is tall, cool and
# vertical.
#
# Two drafts died before this one, both for the same reason. A band of earth
# run off both sides of the socket is SCENERY -- it reads as a hillside, and a
# hillside is a place, not an object. The slab has its own four corners inside
# the plate, and the crack takes a bite out of them.
#
# Leather over wood: warm earth on the violet ultimate socket, and the two
# ramps split the read. Leather is the lit crust and the earth wall under it;
# wood is the inside of the crack, where nothing is lit.
e = G(ULT_N)

BACK_Y, FRONT_Y = 15, 29          # the top face, far edge to near edge
BACK_L, BACK_R = 6, 35            # the far edge's two ends
SHEAR = 6                         # how far RIGHT the near edge slides
DEPTH = FRONT_Y - BACK_Y
# The key, up and left of the plate's own pool. Sat at compose.mjs's centre it
# lands INSIDE the crack, which lights both lobes from their inner edges and
# reads as a vignette rather than as a light.
LIGHT = (14.0, 19.0)

# The slab leans one way and the crack runs the other. A draft with both going
# up-right read as a folded sheet of paper: two parallel diagonals is a crease,
# and a crease is the one thing a break must not look like.

# The wall's thickness, read every fifth column so the bottom breaks in lumps.
# One-pixel-frequency jitter is not texture, it is grain: a draft that wobbled
# every edge per column came out as static and ate the shape whole.
THICK = (6, 6, 7, 5, 6, 7, 6, 5)
# The near and far edges are chewed on the same slow beat, so the slab reads as
# a piece torn out of the floor and not as a flagstone.
CHEW_FAR = (0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0)
CHEW_NEAR = (0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1)
# The lips, jogged ONE pixel each and on their own beat. A draft that zigzagged
# them together by two came out as a lightning bolt -- which is the wizard's
# THUNDERSTEP, and the one shape this icon may not be mistaken for. The
# widening carries the read on its own; the roughness only has to stop the
# edges looking sawn.
LIP_NEAR = (0, 0, 1, 0, 0)
LIP_FAR = (0, 1, 0, 0, 1, 0, 0)


def rnd(v):
    return int(math.floor(v + 0.5))


def col_rows(x):
    """First and last row of the top face in column x, or None off the slab."""
    lo = max(0.0, (x - BACK_R) / float(SHEAR))
    hi = min(1.0, (x - BACK_L) / float(SHEAR))
    if lo > hi:
        return None
    return (rnd(BACK_Y + lo * DEPTH) + CHEW_FAR[(x // 4) % len(CHEW_FAR)],
            rnd(BACK_Y + hi * DEPTH) - CHEW_NEAR[(x // 4) % len(CHEW_NEAR)])


def gap(y):
    """The fissure's left and right column on row y. In PIXELS, not a ratio of
    the slab: the read is a slit at one end and a hole at the other, and a
    ratio would have widened the slab along with it."""
    s = (FRONT_Y - y) / float(DEPTH)                  # 0 near, 1 far
    cx = 17.0 + 7.0 * s
    half = 0.2 + 5.2 * s
    return (rnd(cx - half) + LIP_NEAR[y % len(LIP_NEAR)],
            rnd(cx + half) - LIP_FAR[y % len(LIP_FAR)])


for x in range(BACK_L, BACK_R + SHEAR + 1):
    rows = col_rows(x)
    if not rows:
        continue
    ytop, ybot = rows
    if ytop > ybot:                        # chewed away to nothing at a corner
        continue
    for y in range(ytop, ybot + 1):
        g0, g1 = gap(y)
        # The piece past the crack has tipped away from the key, so it runs one
        # step of the ramp darker the whole way. That is what says TWO pieces
        # rather than one piece with a line drawn on it.
        crust = 'CHhL' if x > g1 else 'ECHh'
        if g0 <= x <= g1:
            # Black, with a pixel of wall either side once it is wide enough to
            # have walls: the one facing the key is lit, the one behind is not.
            wide = g1 - g0 >= 3
            ch = 'v' if wide and x == g1 else ('u' if wide and x == g0 else 'U')
        elif x == g1 + 1:
            ch = 'E'                       # the far lip, a broken edge catching it
        elif x == g0 - 1:
            ch = 'B'                       # the near lip, turned away from it
        elif y == ybot:
            ch = crust[0]                  # specular where the plane turns down
        else:
            d = math.hypot(x - LIGHT[0], y - LIGHT[1])
            ch = pick(d, [5.0, 11.0, 18.0], crust)
        e.px(x, y, ch)
    # The earth wall under the crust: shade, body, dark, then back UP to a row
    # of reflected light on the bottom edge -- the pixel that stops a slab
    # reading as a stripe.
    thick = THICK[(x // 5) % len(THICK)]
    for j in range(thick):
        e.px(x, ybot + 1 + j, pick(j / float(thick - 1), [0.18, 0.55, 0.85], 'LBLh'))

# Where the crack is still a hairline it carries on DOWN the near wall, so the
# split reads as going through the ground rather than scratched on top of it.
for y in range(FRONT_Y + 1, 36):
    if e.g[y][18] in 'LBh':
        e.px(18, y, 'U')
        if y < FRONT_Y + 5:
            e.px(19, y, 'v')

# Strata: strokes, never single pixels. One pixel alone in earth is dirt on the
# lens; four in a row is a seam of rock.
for sx, sy, w in ((9, 24, 4), (13, 28, 5), (24, 32, 4), (33, 34, 4), (28, 35, 3)):
    for x in range(sx, sx + w):
        if e.g[sy][x] in 'LB':
            e.px(x, sy, 'h')

# Grit on the crust, and two lumps of rubble beside the break. compose.mjs
# casts their shadow for us, which is what makes them sit ON the slab rather
# than in it. Clusters, never lone pixels -- one pixel is dirt on the lens.
for cx, cy, w, h in ((11, 23, 3, 2), (34, 24, 4, 2)):
    for j in range(h):
        for i in range(w):
            if e.g[cy + j][cx + i] in 'ECHh':
                e.px(cx + i, cy + j, 'E' if j == 0 else ('h' if i == w - 1 else 'C'))
for px, py in ((14, 27), (15, 27), (23, 26), (24, 26), (30, 21), (31, 21),
               (37, 27), (38, 27), (20, 22), (21, 22)):
    if e.g[py][px] in 'ECH':
        e.px(px, py, 'h')

register(
    'earthshatter', label='EARTHSHATTER', hero='knight', kind='direct',
    cat='ultimate',
    why='a slab of ground snapped by a widening fissure',
    ramps=('leather', 'wood'),
    grid=e,
)
