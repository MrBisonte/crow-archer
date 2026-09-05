# -*- coding: utf-8 -*-
"""The ten ultimates, in the order the pick screen shows them.

THE ONE HOME for that order, for now. The talent icons read their order out of
`src/sim/talents.ts`, because the game's own table is the authority; the
ultimates cannot do that yet -- five of them are built and five are only
decided, so half of them exist in COORDINATION.md and nowhere in the code.
When the second five are built and a pick mechanism names them, this list
should be replaced by a read of that table the way `talent_order()` reads
talents.ts, and not before: a second hand-written order beside a real one is
exactly the drift the icon set is written to avoid.

`slot` is which of the hero's two it is. Every hero has exactly one 'first' and
one 'second', and draw-ultimates.py checks that rather than trusting it.
"""

ULTIMATES = [
    # archer
    ('headshot', 'HEADSHOT', 'archer', 'first',
     'One arrow down the line, always critical'),
    ('arrowRain', 'ARROW RAIN', 'archer', 'second',
     'Arrows fall over a marked circle'),
    # wizard
    ('vortex', 'VORTEX', 'wizard', 'first',
     'Drags a field to one point, then collapses'),
    ('theBeam', 'THE BEAM', 'wizard', 'second',
     'A lance he stands still to sweep'),
    # knight
    ('earthshatter', 'EARTHSHATTER', 'knight', 'first',
     'A crack runs out and splits the ground'),
    ('theLeap', 'THE LEAP', 'knight', 'second',
     'He jumps the wall and lands heavy'),
    # ranger
    ('harpoon', 'HARPOON', 'ranger', 'first',
     'A line that reels him to what it catches'),
    ('fullAuto', 'FULL AUTO', 'ranger', 'second',
     'Volleys for as long as he keeps running'),
    # sapper
    ('carpetBomb', 'CARPET BOMB', 'sapper', 'first',
     'A line of charges going off outward'),
    ('theBigOne', 'THE BIG ONE', 'sapper', 'second',
     'One enormous charge on a long fuse'),
]

ORDER = [u[0] for u in ULTIMATES]
BY_ID = {u[0]: u for u in ULTIMATES}
