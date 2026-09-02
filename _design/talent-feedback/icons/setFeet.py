# -*- coding: utf-8 -*-
from iconkit import G, register

# ── SET FEET ────────────────────────────────────────────────────────────────
# A cylinder lit from the upper left runs six steps across: dark edge,
# specular, highlight, midtone, core shadow, and one pixel of reflected light
# on the far edge. That last pixel is what stops it reading as a stripe.
b = G()
SHAFT = 'LECCHHhLh'             # 9 wide
CUFF = 'LEECCHHhhLh'            # 11 wide
b.put(5, 8, 'L' * 11)
b.put(6, 8, CUFF)
b.put(7, 8, CUFF)
b.put(8, 8, 'LLECCHHhhLL')
for y in range(9, 13):
    b.put(y, 9, SHAFT)
b.put(13, 9, 'SPMMPppsX')
b.put(14, 9, 'sPMgGgpsX')
b.put(15, 9, 'XSsssssSX')
for y in range(16, 20):
    b.put(y, 9, SHAFT)
b.put(20, 9, 'LECCHHhhLh')
b.put(21, 9, 'LECCHHhhhhLh')
b.put(22, 9, 'LECCHHhhhhhhhLh')
b.put(23, 8, 'LEECCHHhhhhhhhhLh')
b.put(24, 8, 'LEECCHHhhhhhhhhhL')
b.put(25, 8, 'B' * 17)
b.put(26, 8, 'BBBBB......BBBBBB')

register(
    'setFeet', label='SET FEET', hero='ARCHER', kind='indirect', cat='speed',
    why='a braced boot, buckled',
    ramps=('leather', 'steel', 'gold'),
    grid=b,
)
