# -*- coding: utf-8 -*-
import math

from iconkit import G, ULT_N, pick, register

# ── THE BEAM ────────────────────────────────────────────────────────────────
# A glass lance: a bound oak haft on an iron spike, a gold socket, and a long
# ground-glass blade. He plants his feet and sweeps it, so the object is the
# one committed line -- corner to corner of the plate, against the vortex's
# compact standing whorl.
#
# Three drafts died on the head. A warm blob on a thin stick is a MATCH; a gold
# ring round a round lens is a mace with a pearl in it; a flared muzzle with
# gold bands down the haft is a club, because eight fittings on one shaft read
# as decoration rather than as a tool. A lance is four things -- spike, grip,
# haft, blade -- and the blade is longer than any of them.
#
# The glass is the only cool thing in the pair, and it is the emitter. Steel on
# a violet ground is cool on cool at mid value; this blade sits at the top of
# the ramp, so it separates by value where it cannot separate by hue.
b = G(ULT_N)

BUTT = (11.5, 40.0)
TIP = (37.0, 9.0)

WOOD6 = 'uEWwvw'      # dark edge, specular, highlight, midtone, core shadow, reflect
GRIP6 = 'BHhLBL'      # darker than the haft, or the binding is invisible on it
GOLD6 = 'BGgkKk'      # gold runs four steps; its dark end borrows leather's
IRON6 = 'XPpsSs'
ACROSS = [0.001, 0.26, 0.50, 0.76, 0.999]

AX = math.hypot(TIP[0] - BUTT[0], TIP[1] - BUTT[1])
UX, UY = (TIP[0] - BUTT[0]) / AX, (TIP[1] - BUTT[1]) / AX
NX, NY = UY, -UX                              # across the haft, toward the light


def at(t):
    return BUTT[0] + UX * AX * t, BUTT[1] + UY * AX * t


def rod(t0, t1, w0, w1, chars):
    """A tapering rod stamped ACROSS its own axis, so the six steps land in
    order however it leans. Stepped finely enough that a diagonal has no holes.
    """
    x0, y0 = at(t0)
    length = (t1 - t0) * AX
    d = 0.0
    while d <= length:
        n = max(1, int(round(w0 + (w1 - w0) * (d / length))))
        cx, cy = x0 + UX * d, y0 + UY * d
        for k in range(n):
            o = (n - 1) / 2.0 - k
            ch = chars[2] if n < 3 else pick(k / float(n - 1), ACROSS, chars)
            b.px(int(round(cx + NX * o)), int(round(cy + NY * o)), ch)
        d += 0.3


# ── the haft ────────────────────────────────────────────────────────────────
rod(0.03, 0.70, 6, 6, WOOD6)

# Grain: one step of tone, one stroke every fourth row, on the SHADOW side
# only. Run it across the lit side too and the stripes read as the object
# rather than as its surface -- half of what made draft 1 a matchstick.
d = 5.0
while d < AX * 0.68:
    cx, cy = BUTT[0] + UX * d, BUTT[1] + UY * d
    b.px(int(round(cx + NX * -1.5)), int(round(cy + NY * -1.5)), 'v')
    d += 4.0

# ── the iron spike he plants, and its ferrule ───────────────────────────────
rod(0.02, 0.10, 8, 7, GOLD6)
rod(-0.09, 0.03, 2, 5, IRON6)

# ── the grip: one bound length, ringed at each end ──────────────────────────
rod(0.16, 0.44, 7, 7, GRIP6)
rod(0.16, 0.20, 9, 9, GOLD6)
rod(0.40, 0.44, 9, 9, GOLD6)
# The binding itself: two strokes lying across the grip, one step of tone.
for lo in (0.25, 0.33):
    for j in range(7):
        cx, cy = at(lo + j * 0.011)
        b.px(int(round(cx + NX * (2.5 - j))), int(round(cy + NY * (2.5 - j))), 'H')

# ── the socket the blade is set into ────────────────────────────────────────
rod(0.62, 0.72, 8, 7, GOLD6)

# ── the blade ───────────────────────────────────────────────────────────────
# A leaf on a midrib: two bevels meeting at a bright line, not a flat stripe.
# The rib is what stops a long shape reading as a painted stroke.
def blade_row(n):
    if n <= 2:
        return 'M' * n
    rib = max(1, int(round(n * 0.42)))
    out = []
    for k in range(n):
        if k == 0:
            out.append('X')
        elif k < rib:
            out.append('P')
        elif k == rib:
            out.append('M')
        elif k == n - 1:
            out.append('p')
        elif k <= rib + max(1, (n - rib) // 2):
            out.append('s')
        else:
            out.append('S')
    return ''.join(out)


bx, by = at(0.68)
blen = AX * 0.32
d = 0.0
while d <= blen:
    s = d / blen
    n = max(1, int(round(2.0 * 3.8 * math.sin(math.pi * (0.30 + 0.70 * s)))))
    row = blade_row(n)
    cx, cy = bx + UX * d, by + UY * d
    for k in range(n):
        o = (n - 1) / 2.0 - k
        b.px(int(round(cx + NX * o)), int(round(cy + NY * o)), row[k])
    d += 0.3

register(
    'theBeam', label='THE BEAM', hero='wizard', kind='direct', cat='ultimate',
    why='a glass lance, planted on its spike',
    ramps=('wood', 'leather', 'gold', 'steel'),
    grid=b,
)
