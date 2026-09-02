# -*- coding: utf-8 -*-
"""Swaps the four inline icons in the hand-written Main artboard.

Main.dc.html is written by hand, so its icons have to be replaced in place
rather than generated. Run after `node render-svg.mjs`.
"""
import io
import json
import re

R = json.load(io.open('icons32.rendered.json', encoding='utf-8'))['icons']
src = io.open('Main.dc.html', encoding='utf-8').read()
found = re.findall(r'<svg viewBox="0 0 (?:16|32) (?:16|32)".*?</svg>', src, re.S)

# In document order: the row resting, armed and taken, then the rival it closed.
# The rival is a still -- a row you gave up should not catch the light.
ORDER = [('setFeet', 'sheen48'), ('setFeet', 'sheen48'),
         ('setFeet', 'sheen48'), ('deepRoots', 'svg48')]
assert len(found) == len(ORDER), 'expected %d icons, found %d' % (len(ORDER), len(found))
for old, (key, variant) in zip(found, ORDER):
    src = src.replace(old, R[key][variant], 1)
io.open('Main.dc.html', 'w', encoding='utf-8', newline='').write(src)
print('patched Main.dc.html (%d icons)' % len(ORDER))
