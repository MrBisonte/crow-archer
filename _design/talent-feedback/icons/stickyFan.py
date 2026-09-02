# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── STICKY FAN ──────────────────────────────────────────────────────────────
# A bomb stuck to a palisade stake in the pitch that caught it, fuse still
# burning. The talent stops a barrage bomb where it lands and lets it keep its
# fuse, and the only way to draw "stopped" is to draw one somewhere it has no
# business staying: pressed against a post with nothing under it, and the pitch
# still running down the wood below.
#
# Two drafts hung it UNDER a beam and both read as a mushroom. The cause was
# not the beam -- it was that pitch on the crown covers the spout, and a sphere
# with no spout is a bell. The stake had to go on the SHADOW side for the same
# reason the fuse goes on top: the key light is up and to the left, so pitch
# anywhere on the left of the body swallows the specular with it.
#
# The body is STEEL. Steel is the one cool ramp in the set and this sits on the
# red `damage` ground, so a red bomb would be red on red. longThrow gets away
# with red dynamite by giving every stick a dark band and a lit rim; a single
# round body has no bands to give it, so the material has to do the separating.
s = G()

LX, LY, LZ = -0.50, -0.56, 0.66     # key light: up, left, and toward the viewer
SPOUT_W, SPOUT_H = 3, 2             # PIXELS, not a fraction of the body
CX, CY, R = 13.0, 18.6, 5.8
STAKE = 19                          # its left edge; 9 px across, cropped right
SPLAT = (18.6, 18.5, 3.6, 4.8)      # the pitch: centre and half-axes, in px

# Where the six steps fall, measured on the lambert term rather than on a
# distance. The middle of the body lands on `s` and everything past the
# terminator is X, so this is dark iron. Quantised evenly it came out a pearl,
# twice, and no amount of rim light rescues a body that is already white.
STEPS = [-0.98, -0.92, -0.82, -0.56, -0.20]
BOUNCE = 0.62                       # reflected light. d2 ** 7 keeps it ON the
#                                     rim -- spread over the shadow side it
#                                     lifts the dark half evenly and the sphere
#                                     goes back to reading as a disc.


def tar(x, y):
    """Pitch: near black, with only the faces turned up and left catching the
    key light. Drawn at the light end of the rope ramp it is a grey block, and
    a grey block the size of the body is a second object, not an adhesive."""
    return pick(math.hypot((x - 16.6) / 4.2, (y - 14.6) / 5.4),
                [0.42, 0.92], 'Nno')


for y in range(2, 30):                          # the stake, cropped both ends
    s.put(y, STAKE, 'uWWwwvvUu')                # a cylinder: six across, and
    if y % 6 in (0, 1, 2):                      # the last pixel is the bounce
        s.px(STAKE + 3, y, 'v')                 # grain: strokes, never dots
        s.px(STAKE + 6, y, 'U')

for y in range(int(CY - R) - 1, int(CY + R) + 2):
    for x in range(int(CX - R) - 1, int(CX + R) + 2):
        dx, dy = (x - CX) / R, (y - CY) / R
        d2 = dx * dx + dy * dy
        if d2 > 1.0:
            continue
        lam = dx * LX + dy * LY + math.sqrt(1.0 - d2) * LZ
        lam += BOUNCE * max(0.0, -(dx * LX + dy * LY)) * d2 ** 7
        s.px(x, y, pick(-lam, STEPS, 'MPpsSX'))

for i in range(SPOUT_W):                        # the spout: 3 px by 2 px
    for k in range(SPOUT_H):
        s.px(12 + i, 11 + k, 'PpsX'[min(3, i + k)])

# The pitch, squeezed out where the body met the wood and running on down it.
# It laps ONTO the body and onto the stake, which is what makes it an adhesive
# rather than a shadow between two things. Sized as half-axes in pixels: the
# draft that took it as a band across the whole contact was a wing.
sx, sy, sw, sh = SPLAT
for y in range(int(sy - sh), int(sy + sh) + 1):
    for x in range(int(sx - sw), STAKE + 5):
        if ((x - sx) / sw) ** 2 + ((y - sy) / sh) ** 2 > 1.0:
            continue
        dx, dy = (x - CX) / R, (y - CY) / R
        if dx * dx + dy * dy <= 1.0 and dx < 0.45:
            continue                            # never over the lit half
        s.px(x, y, tar(x, y))
for k in range(6):                              # the run down the wood
    s.px(STAKE + 1 + k // 3, 24 + k // 2, 'n' if k % 2 else 'o')
s.px(STAKE + 2, 27, 'o')

for i, (x, y) in enumerate(((11, 10), (10, 10), (9, 9))):
    s.px(x, y, 'N' if i % 2 == 0 else 'n')      # the twist: one lit strand in two
    s.px(x, y + 1, 'o')
s.put(5, 8, 'F')                                # the spark, still burning
s.put(6, 7, 'fYf')
s.put(7, 6, 'FYYYF')
s.put(8, 7, 'fYf')
s.put(9, 8, 'F')

register(
    'stickyFan', label='STICKY FAN', hero='SAPPER', kind='mechanic', cat='damage',
    why='a bomb, stuck in pitch',
    ramps=('steel', 'wood', 'rope', 'fire'),
    grid=s,
)
