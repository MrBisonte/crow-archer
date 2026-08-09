// Entry point. The legacy monolith self-initializes on import; extracted
// modules are wired in as the sim/render split progresses. Multiplayer is
// reached from the title screen, not from a separate page.
import './legacy/game.js';
