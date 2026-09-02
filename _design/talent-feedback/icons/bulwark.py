# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── BULWARK ─────────────────────────────────────────────────────────────────
# The other shield in the knight's line, and the whole problem is that TOWER
# GUARD is already a shield on this same blue ground. Kin, not a copy: three
# things are different and every one of them survives being scaled to 48 px.
#
#   silhouette  a ROUND board, not a kite -- a circle against a long taper
#   material    planked WOOD, not a leather face
#   device      a blood drop where the gold boss sits on the other one
#
# The drop is the talent: BULWARK spends a Bloodlust stack to bring the guard
# back, and a stack is a blood drop. It is painted ON the boards as a charge
# rather than falling past them, because a drop hanging in the air floats
# unattached and reads as a bead of solder.
b = G()

CX, CY = 15.5, 15.0
R_OUT, R_FACE = 10.2, 8.8                       # iron rim outside, boards in
# Three boards, not five. Four seams struck a stripe every four pixels and the
# face read as a keg -- at 48 px the stripes won and the drop lost.
SEAMS = (10, 21)


def face_tone(x, y):
    """The boards, domed. Not a flat wash: the light POOLS up and left."""
    d = math.hypot((x - 12.2) / 12.0, (y - 11.4) / 13.0)
    return pick(d, [0.34, 0.66, 0.95, 1.20], 'WwvuU')


for y in range(32):
    for x in range(32):
        r = math.hypot(x - CX, y - CY)
        if r > R_OUT:
            continue
        if r <= R_FACE:
            b.px(x, y, face_tone(x, y))
            continue
        # The rim, a band of iron. Tone by which way it faces, so the ring is
        # lit at the upper left and turns away at the lower right. It runs the
        # DARK half of the steel ramp: the first draft opened at 'M' all round
        # the upper arc and the icon became a chrome ring with a shield inside
        # it -- the rim is the frame of the object, never the subject.
        f = ((x - CX) + (y - CY)) / (r * 1.41421356)
        ch = pick(f, [-0.78, -0.35, 0.15, 0.60], 'PpsSX')
        if f > 0.42 and r > R_OUT - 1.15:
            ch = 'p'                            # the bounce round the far edge
        b.px(x, y, ch)
b.px(12, 6, 'M')                                # the rim's specular, one pixel

# A plank seam is a dark groove AND the lit edge of the next board over. The
# groove on its own read as a scratch.
BRIGHTER = {'W': 'W', 'w': 'W', 'v': 'w', 'u': 'v', 'U': 'u'}
for sx in SEAMS:
    for y in range(32):
        if math.hypot(sx - CX, y - CY) <= R_FACE:
            b.px(sx, y, 'U')
        if math.hypot(sx + 1 - CX, y - CY) <= R_FACE:
            b.px(sx + 1, y, BRIGHTER[face_tone(sx + 1, y)])

def on_rim(x, y):
    return R_FACE < math.hypot(x - CX, y - CY) <= R_OUT


for i in range(6):                              # rivets pinning the rim on
    a = -math.pi / 2 + i * math.pi / 3
    rx = int(round(CX + 9.2 * math.cos(a)))
    ry = int(round(CY + 9.2 * math.sin(a)))
    # The bead's own shadow is optional; its bright pixel is not. Guarding the
    # two separately dropped the highlight of the top rivet and left the shadow
    # behind, which is one dark speck on the rim and no rivet anywhere.
    if not on_rim(rx, ry):
        continue
    b.px(rx, ry, 'M')
    if on_rim(rx + 1, ry + 1):
        b.px(rx + 1, ry + 1, 'X')

# The drop, in PIXELS: a circle of radius 3.35 with a tip drawn 6.3 rows up out
# of it, so 9.7 tall by 6.7 across. Two drafts read as a chilli and then as a
# red kite, both times because the bottom was a fraction of the HEIGHT instead
# of a circle of its own -- a bottom four rows deep and three wide comes to a
# point, and a drop with two points is a diamond.
TIP_Y, BOWL_Y, BOWL_R = 11.0, 17.3, 3.35


def drop_half(y):
    if y < TIP_Y or y > BOWL_Y + BOWL_R:
        return None
    if y >= BOWL_Y:
        return BOWL_R * math.sqrt(max(0.0, 1.0 - ((y - BOWL_Y) / BOWL_R) ** 2))
    k = (BOWL_Y - y) / (BOWL_Y - TIP_Y)
    return max(BOWL_R * (1.0 - k ** 2.2), 0.5)               # the drawn-up tip


DROP = {(x, y)
        for y in range(32) if drop_half(y) is not None
        for x in range(int(round(CX - drop_half(y))),
                       int(round(CX + drop_half(y))) + 1)}

# A charge painted on boards has no seam pass round it -- compose.mjs outlines
# the object against the socket and nothing inside it -- so the drop abutted
# the wood directly and came out mottled rather than drawn. One ring of the
# darkest red, laid outside the shape, is what makes it a device on a shield.
for (x, y) in DROP:
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if (x + dx, y + dy) not in DROP and math.hypot(
                    x + dx - CX, y + dy - CY) <= R_FACE:
                b.px(x + dx, y + dy, 'Q')

for (x, y) in DROP:
    # An ellipse of light, elongated the way the drop is, so the tip stays in
    # the light and only the lower right falls away. A round falloff put the
    # highlight in the belly and the dark at the point, which is a flame.
    n = math.hypot(x - 14.2, (y - 15.6) / 1.90)
    ch = pick(n, [1.45, 2.75, 3.95], 'RrqQ')
    if y >= 16 and x - CX >= drop_half(y) - 1.0:
        ch = 'r'                                # reflected light, far side
    b.px(x, y, ch)
b.px(14, 15, 'P')                               # the catchlight: blood is wet

register(
    'bulwark', label='BULWARK', hero='KNIGHT', kind='mechanic', cat='defence',
    why='a round shield, blood drop',
    ramps=('wood', 'steel', 'cloth'),
    grid=b,
)
