// Entry point. Route to lobby or legacy game based on URL.
// Lobby: http://localhost:8081/lobby.html or ?lobby=true
// Game: everything else (legacy behavior)

const path = location.pathname;
const isLobbySite = path.endsWith('/lobby.html') || new URLSearchParams(location.search).has('lobby');

if (!isLobbySite) {
  // Legacy single-player game
  import('./legacy/game.js');
}
// If lobby, the page itself (lobby.html) handles initialization
