# CROW ARCHER

[![CI](https://github.com/MrBisonte/crow-archer/actions/workflows/ci.yml/badge.svg)](https://github.com/MrBisonte/crow-archer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/MrBisonte/crow-archer)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)

```
  ██████╗██████╗  ██████╗ ██╗    ██╗
 ██╔════╝██╔══██╗██╔═══██╗██║    ██║
 ██║     ██████╔╝██║   ██║██║ █╗ ██║
 ██║     ██╔══██╗██║   ██║██║███╗██║
 ╚██████╗██║  ██║╚██████╔╝╚███╔███╔╝
  ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝
        A R C H E R
```

Survive the flock, kill the Crow King, then the two dark bosses waiting in his castle. A browser game on HTML5 Canvas and the Web Audio API, every sound synthesized at runtime, built to one self-contained HTML file. [Play in the browser](https://mrbisonte.github.io/crow-archer/), or [download it](https://github.com/MrBisonte/crow-archer/releases/latest/download/crow-archer.html) and play offline, no install.

![Gameplay: the Ranger fighting a crow swarm, a satchel blast, a multi-kill streak, the Crow King's entrance and fight](media/gameplay.gif)

- [Play](#play)
- [Multiplayer](#multiplayer)
- [Controls](#controls)
- [Characters](#characters)
- [Docs](#docs)
- [License](#license)

## Play

**Single-player**, offline, no server: download [`crow-archer.html`](https://github.com/MrBisonte/crow-archer/releases/latest/download/crow-archer.html) from the [latest release](https://github.com/MrBisonte/crow-archer/releases/latest) and open it in any modern browser. Every dependency is inlined, so it plays with the network off.

**Multiplayer** needs a server. See [Multiplayer](#multiplayer).

To run either from source:

```
npm install
npm run dev
```

`npm run dev` alone serves single-player. Multiplayer additionally needs `npm run server`, covered below.

`npm run build` writes `dist/index.html`, which is gitignored. Releases are built by CI from the tagged commit and attached as `crow-archer.html`, so what people download is never a stale local copy: `git tag v0.1.0 && git push --tags` is the whole publish step.

## Multiplayer

Up to four players in a room, co-op or 2v2, on a fresh generated map every match.

1. Open the server's URL and press **M**.
2. One player presses **H** to host, which shows a four-letter code. Everyone else presses **J**, types the code, and hits **Enter**.
3. The host picks a map, a mode, and a win condition, everyone readies up with **R**, and the match starts.

To run it locally:

```
npm run server
npm run dev
```

See the [manual](docs/manual.md#multiplayer) for hosting others, deploying, and full mechanics.

## Controls

| Action | Default |
|--------|---------|
| Move | Arrow keys |
| Aim | Mouse |
| Shoot / Cast | Space |
| Charge special | Right-click hold (Archer) / Right-click (Wizard, Knight) / Right-click twice: throw, then arm (Ranger) / none (Sapper) |
| Sniper mode / Knight charge / Wizard blink | Shift (the knight winds up a charging sweep, the wizard blinks) |
| Pause | Escape |
| Inventory | I (while paused) |

Move, Shoot, Sniper mode and Pause are remappable from the Controls screen.

## Characters

| | weapon | rhythm |
|---|---|---|
| **Archer** | bow | fastest shots, weakest hit: about five to kill |
| **Wizard** | staff | slow, hard-hitting bolts that steer toward whoever is nearest |
| **Knight** | spear | nothing at range; a thrust that lands twice per swing |
| **Ranger** | crossbow | three smaller, weaker bolts per shot, each an independent hit |
| **Sapper** | powder charge | slowest throw, thrown at a place: it bounces, fuses, and blasts an area |

See the [manual](docs/manual.md#characters) for the full kit of each: primary, special, and pickups.

## Docs

| Doc | For |
|---|---|
| [Manual (retro page)](https://mrbisonte.github.io/crow-archer/manual.html) | The same manual, styled — start here if you just want to play |
| [Game manual](docs/manual.md) | Full character kits, systems, map, bosses, game loop, hosting and deploying |
| [Architecture](docs/architecture.md) | Tech stack, dependencies, netcode, design patterns |

## License

[MIT](LICENSE)
