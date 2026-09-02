/** Renders every icon, and one empty socket per category, to SVG. */
import { writeFileSync } from 'node:fs';
import { ICONS, RAMPS } from './icons32.js';
import { CATS, svg, svgSheen } from './compose.mjs';

// The ramps and the category list ride along so the artboard build reads
// them here instead of keeping its own copy. Its copy of the ramp hexes had
// already drifted: CLOTH was three colours that are in no ramp at all.
const out = { icons: {}, swatches: {}, ramps: RAMPS, cats: CATS };
for (const i of ICONS) {
  out.icons[i.id] = {
    name: i.name, hero: i.hero, kind: i.kind, cat: i.cat, why: i.why,
    svg48: svg(i, 48), svg64: svg(i, 64), svg112: svg(i, 112),
    sheen48: svgSheen(i, 48), sheen64: svgSheen(i, 64), sheen112: svgSheen(i, 112),
  };
}
// An empty socket is the honest swatch: it is exactly what a talent of that
// category looks like before anything is drawn in it.
const BLANK = Array.from({ length: 32 }, () => '.'.repeat(32));
for (const cat of CATS) {
  out.swatches[cat] = svg({ id: `blank-${cat}`, cat, legend: {}, rows: BLANK }, 56);
}
writeFileSync('icons32.rendered.json', JSON.stringify(out, null, 1));
console.log(`rendered ${Object.keys(out.icons).length} icons, ${Object.keys(out.swatches).length} swatches`);
