// Entry point. The legacy monolith exports boot() rather than running on
// import, so the module can also be loaded headlessly by its tests; this is the
// one place that binds it to a browser. Extracted modules are wired in as the
// sim/render split progresses. Multiplayer is reached from the title screen,
// not from a separate page.
import { keepCanvasFitted } from './render/fit-canvas';
import { boot } from './legacy/game.js';

boot();

// After boot, which is what sizes the canvas. Without this the element lays
// out at its buffer size and a smaller window crops the map instead of
// scaling it — the HUD first, then whole columns, with nothing to say so.
const canvas = document.getElementById('game');
if (canvas) keepCanvasFitted(canvas, window);
