# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── CHARGE THROUGH ──────────────────────────────────────────────────────────
# A rowel: the toothed wheel off the back of a spur, off its neck and lying
# face up. The talent is the charge cutting on EVERY side of him rather than
# only ahead, and a rowel is the one object that already means both halves of
# that -- it is what a charge is started with, and its edge is teeth the whole
# way round. An arrow, a chevron or a fan of speed lines would be a diagram of
# the motion; this is the thing that makes it.
#
# Steel on the red `damage` ground, which is the hourglass's lesson: steel is
# the only cool ramp in the set, so the object separates from a warm socket by
# hue and not only by value. The gold is the collar round the bore, one
# accent, sized as a collar -- TOWER GUARD's boss is the subject of that icon
# and at that size here it ate the wheel's own middle.
#
# SIX drafts, and five of them were the whole spur. Teeth as long thin points
# off a 3 px hub is a starburst, not a wheel, and slung off a neck between two
# round ends it read as a SPANNER, then an antler, then a daisy; closing the
# heel band into a loop only made it a RING spanner. The band is the part that
# will not draw at 24 px: at any size that reads as a band it is the same
# weight as the rowel, and two equal round forms joined by a bar is a tool in
# every arrangement there is. So the band is gone, and what is left is one
# object with the whole talent in it.
#
# The wheel is then what a wheel is and a star is not: it has a BORE through
# it and it has THICKNESS. Its rim shows below the face because the wheel lies
# tipped away from you -- without those two the same eight teeth are a compass
# rose.
w = G()

CX, CY = 16.0, 14.2
SQ = 0.92                           # tipped back, so the face is an ellipse
R_TIP, R_HUB = 9.6, 5.9             # tooth tip and the flat of the face
R_BOSS = 2.2                        # the gold rivet the wheel turns on
RIM = 2.2                           # how much of the wheel's edge shows
TEETH = 8
PHASE = math.radians(22.0)          # off the axes: square on, it is a rose
TOOTH = 0.70                        # of the pitch. The rest is flat face, and
#                                     that flat is what makes a tooth a tooth:
#                                     teeth filling the whole pitch left an
#                                     outline of shallow bumps, a bottle cap

LX, LY = -0.64, -0.77               # unit vector towards the key light
STEEL = 'MPpsSX'
# Six steps over 0..1 brightness. One mapping for every surface here: a set of
# stops per surface is how a ramp quietly loses a step and the shape flattens.
STOPS = [0.12, 0.28, 0.45, 0.64, 0.84]
STEP = 2.0 * math.pi / TEETH


def tone(v, ramp=STEEL):
    """Brightness in 0..1 (1 = specular) onto a six-step ramp."""
    return pick(1.0 - min(1.0, max(0.0, v)), STOPS, ramp)


def wrap(a):
    return math.atan2(math.sin(a), math.cos(a))


def star_r(ang):
    """Outer radius here, in face units: R_HUB on the flat between teeth,
    R_TIP on a tooth. Straight sides, so a tooth is a cut edge, not a lobe."""
    k = ((ang - PHASE) / STEP) % 1.0
    return R_HUB + (R_TIP - R_HUB) * max(0.0, 1.0 - abs(k - 0.5) / (TOOTH / 2.0))


def face(x, y, cy):
    """Position on the tipped face: offset, un-squashed radius and angle."""
    dx, dy = x - CX, (y - cy) / SQ
    return dx, dy, math.hypot(dx, dy), math.atan2(dy, dx)


# ── the rim ─────────────────────────────────────────────────────────────────
# The same outline, dropped by the wheel's thickness and painted dark. The
# face covers all but the near edge of it, and what is left is the band of
# metal you are looking at the side of.
for y in range(6, 28):
    for x in range(4, 28):
        dx, dy, d, ang = face(x, y, CY + RIM)
        if d > star_r(ang):
            continue
        w.px(x, y, tone(0.10 + 0.30 * (0.5 - 0.5 * dx / max(d, 0.01))))

# ── the face ────────────────────────────────────────────────────────────────
for y in range(4, 26):
    for x in range(4, 28):
        dx, dy, d, ang = face(x, y, CY)
        if d > star_r(ang):
            continue
        key = (dx * LX + dy * LY) / R_HUB           # +1 towards the light
        if d <= R_HUB:
            ch = tone(1.16 - math.hypot(dx + 2.3, dy + 2.5) / 7.2)
            if d > R_HUB - 1.3 and key < -0.45:
                ch = 'p'                            # reflected light, far edge
            w.px(x, y, ch)
        else:
            # Each tooth is two facets pitched off a ridge, so the edge reads
            # as bevelled metal rather than as a cut-out star. The key term is
            # kept weak out here: at the strength the face takes, the whole
            # lower-right quarter fell to the darkest step and those teeth
            # vanished into the socket -- which on a talent about cutting on
            # EVERY side is the one thing this drawing may not do.
            axis = PHASE + (math.floor((ang - PHASE) / STEP) + 0.5) * STEP
            off = wrap(ang - axis)
            ridge = min(1.0, abs(off) / (STEP / 2.0))
            tilt = axis + (STEP if off >= 0 else -STEP)
            facet = math.cos(tilt) * LX + math.sin(tilt) * LY
            w.px(x, y, tone(0.50 + 0.34 * ridge * facet + 0.20 * key))

# The rivet the wheel turns on, seated the way TOWER GUARD's boss is: dark
# where it sits down into the face, bright where the face bounces back into
# it. Small -- that icon's boss is its subject, and at that size here it took
# the wheel's own middle away from it.
for y in range(int(CY) - 4, int(CY) + 5):
    for x in range(int(CX) - 4, int(CX) + 5):
        dx, dy, d, _ = face(x, y, CY)
        if d > R_BOSS + 0.7:
            continue
        if d > R_BOSS:
            w.px(x, y, 'g' if dx + dy > 1.4 else 'K')
            continue
        w.px(x, y, pick(math.hypot(dx + 1.0, dy + 1.1), [0.9, 1.9, 3.0],
                        'GgkK'))

register(
    'chargeThrough', label='CHARGE THROUGH', hero='KNIGHT', kind='direct',
    cat='damage',
    why='a rowel, eight teeth',
    ramps=('steel', 'gold'),
    grid=w,
)
