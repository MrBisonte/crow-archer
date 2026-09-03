# -*- coding: utf-8 -*-
from iconkit import G, cyl_row, register

# ── DEEPER CUT ──────────────────────────────────────────────────────────────
# A dagger, wet to the guard. Damage per Bloodlust stack, so the blood is on
# the blade rather than beside it.
#
# It read as a syringe: a thin parallel blade over a wide flat bar is a barrel
# over a plunger flange. The blade tapers now and carries two thirds of the
# icon, and the guard is short enough to be a guard.
c = G()

STEEL = 'XMPpSs'
MID = 15.5

# Blade: a long taper, widest at the guard.
for y in range(3, 20):
    w = int(round(2 + 6.0 * (y - 3) / 16.0))
    c.put(y, int(round(MID - w / 2.0)), cyl_row(w, STEEL))
for y in range(6, 20):
    c.px(15, y, 'M')                          # the ridge, catching the key light

# Guard: short, and thicker at the ends so it reads as forged.
c.put(20, 9, cyl_row(14, STEEL))
c.put(21, 10, cyl_row(12, STEEL))
c.put(22, 12, 'SSpSSSSS'[:8])

# Grip, wrapped, and a gold pommel to close the silhouette.
for y in range(22, 28):
    c.put(y, 13, cyl_row(6, 'BECHLh'))
for y in (23, 25, 27):
    c.put(y, 13, 'LLLLLL')
c.put(28, 12, cyl_row(8, 'KGgkKg'))
c.put(29, 13, cyl_row(6, 'KGgkKg'))

# The blood, run down to the guard and pooled on it.
for y, x in ((11, 17), (12, 17), (13, 18), (14, 18), (15, 18), (16, 19),
             (17, 19), (18, 19), (19, 19)):
    c.px(x, y, 'r')
c.px(17, 18, 'q')
c.put(19, 13, 'rqqr')

register(
    'deeperCut', label='DEEPER CUT', hero='KNIGHT', kind='direct', cat='damage',
    why='a dagger, wet to the guard',
    ramps=('steel', 'leather', 'gold', 'cloth'),
    grid=c,
)
