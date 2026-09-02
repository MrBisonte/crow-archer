# -*- coding: utf-8 -*-
from iconkit import G, limb, register

# ── DEEP ROOTS ──────────────────────────────────────────────────────────────
# Four buttress roots, thick where they leave the trunk. Three thin ones
# splayed off a narrow stump read as chicken feet -- the mass has to be at the
# top and spreading, the way a root actually carries a tree.
r = G()
limb(r, 12.0, 16, 5.5, 22, 8.0, 3.0, 'WwvU')
limb(r, 13.5, 17, 10.0, 26, 7.0, 3.0, 'WwvU')
limb(r, 18.0, 17, 21.5, 26, 7.0, 3.0, 'WwvU')
limb(r, 19.5, 16, 26.0, 21, 8.0, 3.0, 'WwvU')
for y in range(7, 18):                        # the trunk over the roots
    r.put(y, 11, 'uWWwwwvvu')
r.put(5, 13, 'WWWWW')                         # the cut end, catching the light
r.put(6, 12, 'WWWWWWW')
r.px(19, 6, 'w')
for (cx, cy) in ((14, 5), (16, 6)):           # two growth rings on the cut
    r.px(cx, cy, 'v')

register(
    'deepRoots', label='DEEP ROOTS', hero='ARCHER', kind='indirect', cat='speed',
    why='a stump, four roots',
    ramps=('wood',),
    grid=r,
)
