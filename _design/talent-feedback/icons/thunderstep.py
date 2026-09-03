# -*- coding: utf-8 -*-
from iconkit import G, limb, register

# ── THUNDERSTEP ─────────────────────────────────────────────────────────────
# One bolt, not three. Three of anything is a diagram again, and what the
# capstone does -- each arrival harder than the last -- is carried by the fork
# WIDENING as it falls rather than by counting objects.
z = G()
limb(z, 19.5, 3.0, 13.0, 13.0, 5.0, 6.5, 'YFfe')
limb(z, 13.0, 13.0, 19.0, 14.5, 6.0, 6.5, 'YFfe')
limb(z, 19.0, 14.5, 11.5, 27.0, 6.5, 2.0, 'YFfe')
for (x, y) in ((18.6, 4), (17.4, 6), (16.2, 8), (15.0, 10), (13.8, 12),
               (15.0, 14), (17.5, 15), (16.0, 18), (14.6, 21), (13.2, 24)):
    z.px(int(round(x)), y, 'Y')                        # the core, white hot
for (x, y, ch) in ((9, 27, 'f'), (10, 28, 'F'), (13, 28, 'F'), (14, 27, 'f'),
                   (8, 28, 'e'), (15, 28, 'e')):
    z.px(x, y, ch)                                     # what the strike throws

register(
    'thunderstep', label='THUNDERSTEP', hero='WIZARD', kind='direct', cat='damage',
    why='a bolt, widening as it falls',
    ramps=('fire', 'gold'),
    grid=z,
)
