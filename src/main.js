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

// A monitored playtest ships the diagnostic log to a server as it happens —
// src/dev/flight-recorder.ts is the how and the why. Opt-in everywhere, the
// published build included: the recorder used to be absent from a release, and
// now that it is not, "on unless you say otherwise" would mean recording every
// stranger who opens a public link. Nobody asked to be telemetry. `?rec=1` is
// the whole switch, and the import is dynamic so a page without it pays
// nothing but the bytes.
if (new URLSearchParams(location.search).get('rec') === '1') {
  void import('./dev/flight-recorder').then((m) => m.startFlightRecorder());
}
