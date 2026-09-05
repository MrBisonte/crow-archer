# -*- coding: utf-8 -*-
import math

from iconkit import G, ULT_N, cyl_row, pick, register

# ── CARPET BOMB ─────────────────────────────────────────────────────────────
# ONE object: a charge line, laid. A single cord run out from the sapper's own
# feet at the bottom of the plate, swelling into a cased charge at an even
# interval along its length, and already burning at the near end.
#
# Two drafts were a BELT -- a strap across the socket with charges hung under
# it -- and both failed on silhouette before anything else: a shape that runs
# edge to edge horizontally is a bar, and five identical bodies under it are
# teeth. The line is the fix. It snakes, so the outline is irregular at every
# scale; it leaves the socket at the bottom, so it comes from somewhere; and
# the charges are swellings of the ONE cord rather than five separate objects
# arranged in a row, which is the diagram the brief warns about.
#
# THE BIG ONE is a single mass that fills its plate. Nothing here is bigger
# than seven pixels across, and the difference is structural.
c = G(ULT_N)

LX, LY = -0.46, -0.60                   # the key light, flattened to the plane
# (dark edge, specular, highlight, midtone, core shadow, reflected light)
CORD = (('B', 'E', 'C', 'H', 'L', 'h'), 3)
CASE = (('Q', 'E', 'R', 'r', 'q', 'r'), 7)
BAND = (('X', 'P', 'p', 's', 'S', 's'), 7)
CURVE = (((12.0, 45.0), (6.0, 34.0), (26.0, 36.0), (27.0, 26.0)),
         ((27.0, 26.0), (28.0, 16.0), (13.0, 15.0), (18.0, 6.0)))
FIRST, GAP, HALF, LIP = 6.0, 9.6, 2.7, 0.9    # the charges' places, in PIXELS


def bez(t, p):
    """One point on the cubic Bezier over p, which is four (x, y) pairs."""
    u = 1.0 - t
    w = (u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t)
    return (sum(wi * pi[0] for wi, pi in zip(w, p)),
            sum(wi * pi[1] for wi, pi in zip(w, p)))


# Resampled to a fixed step in PIXELS rather than in curve parameter: a Bezier
# runs fast through its middle, so charges placed by parameter come out
# bunched at the ends, and the gap between two of them is the one measurement
# that has to be even for the line to read as laid rather than as scattered.
STEP = 0.3
raw = [bez(i / 400.0, seg) for seg in CURVE for i in range(401)]
spine, walked = [raw[0]], 0.0
for (px_, py), (qx, qy) in zip(raw, raw[1:]):
    walked += math.hypot(qx - px_, qy - py)
    if walked >= STEP:
        spine.append((qx, qy))
        walked = 0.0


def kind(d):
    """Cord, case or end cap, at distance d along the line. The profile is a
    STEP, never a swell: a cord that eases into its charges is a string of
    sausages, and a steel cap at each end is what says the case was made
    rather than grown. Both are seven wide -- the draft where the caps flanged
    out past the case read as a spine with vertebrae in it."""
    off = (d - FIRST) % GAP
    off = min(off, GAP - off)
    if off > HALF:
        return CORD
    return CASE if off < HALF - LIP else BAND


for i, (x, y) in enumerate(spine):
    ax, ay = spine[max(i - 1, 0)]
    bx, by = spine[min(i + 1, len(spine) - 1)]
    tx, ty = bx - ax, by - ay
    tlen = math.hypot(tx, ty) or 1.0
    nx, ny = -ty / tlen, tx / tlen              # across the line
    chars, w = kind(i * STEP)
    # cyl_row lays the six steps from the DARK EDGE inward, so the row has to
    # start on whichever side the light is on. Without the flip the lit side
    # swaps every time the line turns back, and a tube lit from both sides at
    # once is the flattest thing in the set.
    row = cyl_row(w, chars)
    if nx * LX + ny * LY > 0.0:
        row = row[::-1]
    for k, ch in enumerate(row):
        u = k - (w - 1) / 2.0
        c.px(int(round(x + nx * u)), int(round(y + ny * u)), ch)

# The near charge has already gone and the ones behind it have not. That is
# the whole talent -- a line that goes off in order, running away from him --
# carried by ONE blown seat rather than by drawing seven of them at seven
# stages, which is a strip cartoon and not an object.
BX, BY = spine[int(FIRST / STEP)]
for y in range(int(BY) - 8, int(BY) + 9):
    for x in range(int(BX) - 8, int(BX) + 9):
        a = math.atan2(y - BY, x - BX)
        d = math.hypot((x - BX) * 0.96, y - BY) + 0.45 * math.sin(a * 3.0 + 1.1)
        if d > 6.4:
            continue
        c.px(x, y, pick(d, [2.0, 3.4, 4.9], 'YFfe'))

for (x, y, ch) in ((BX - 4, BY - 7, 'n'), (BX - 5, BY - 8, 'N'),
                   (BX - 5, BY - 9, 'n'), (BX - 6, BY - 10, 'o')):
    c.px(int(round(x)), int(round(y)), ch)

register(
    'carpetBomb', label='CARPET BOMB', hero='sapper', kind='direct',
    cat='ultimate',
    why='a charge line, laid and lit at the near end',
    ramps=('leather', 'cloth', 'steel', 'rope', 'fire'),
    grid=c,
)
