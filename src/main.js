// Entry point. The legacy monolith exports boot() rather than running on
// import, so the module can also be loaded headlessly by its tests; this is the
// one place that binds it to a browser. Extracted modules are wired in as the
// sim/render split progresses. Multiplayer is reached from the title screen,
// not from a separate page.
import { boot } from './legacy/game.js';

boot();
