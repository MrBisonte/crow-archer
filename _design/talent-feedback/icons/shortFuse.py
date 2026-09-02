# -*- coding: utf-8 -*-
import math

from iconkit import G, pick, register

# ── SHORT FUSE ──────────────────────────────────────────────────────────────
# The sapper's own powder charge, drawn with the fuse burnt down to a stub.
#
# The talent buys TIME and the set already spends its hourglass on HELD STEP,
# so this one draws the noun in its own label instead. Not the archer's
# dynamite either -- LONG THROW is three red paper cylinders and five pixels
# of cord you can count the twist in -- but the ball `paintHeldCharge` puts in
# the sapper's hand: a dark case, a bright collar, and fire already at the
# metal.
d = G()

CX, CY, R = 15.4, 19.8, 7.2
LX, LY = 12.4, 15.6                # the key light, up and left of the centre

# The case. A sphere is the plainest six-step exercise in the set and it has
# nowhere to hide, and the stops are what the first two drafts got wrong: with
# the light only four pixels off the centre, an even ramp leaves two thirds of
# the ball at the pale end of leather and the thing reads as a clay gourd.
# They are tight at the lit end and open at the dark one, so the specular
# stays a pool and the case stays a case.
for y in range(int(CY - R) - 1, int(CY + R) + 2):
    for x in range(int(CX - R) - 1, int(CX + R) + 2):
        dx, dy = x - CX, y - CY
        r = math.hypot(dx, dy)
        if r > R:
            continue
        ch = pick(math.hypot(x - LX, y - LY) / R,
                  [0.08, 0.18, 0.34, 0.60, 0.95], 'ECHhLB')
        if dx + dy > 3.4 and r > R - 1.05:
            ch = 'H'                       # the bounce, one pixel wide
        d.px(x, y, ch)

# STEEL, not gold: it is the one cool ramp in the set, so the collar parts
# from a warm case by hue the way TOWER GUARD's rim parts from its leather
# face -- and the case, not the collar, is what answers the green socket. A
# straight ferrule with one row of lip: the first draft flared it over four
# rows and that is a bottle, not a charge.
for y, x0, band in ((10, 12, 'MPPppsX'),
                    (11, 13, 'MPpsX'),
                    (12, 13, 'PppsX'),
                    (13, 13, 'ppssX'),
                    (14, 13, 'psSXX')):
    d.put(y, x0, band)
d.put(10, 14, 'XXS')                       # the mouth the cord comes out of

# The fuse: two pixels of cord and then fire, straight up out of the collar.
d.px(15, 9, 'N')
d.px(16, 9, 'o')

for y, x0, band in ((4, 16, 'F'),
                    (5, 15, 'fYF'),
                    (6, 14, 'eFYYF'),
                    (7, 13, 'efFYYFe'),
                    (8, 14, 'efYFe')):
    d.put(y, x0, band)

register(
    'shortFuse', label='SHORT FUSE', hero='SAPPER', kind='mechanic', cat='speed',
    why='a charge, fuse burnt short',
    ramps=('leather', 'steel', 'rope', 'fire'),
    grid=d,
)
