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

Survive the flock, kill the Crow King, then the two dark bosses waiting in his castle, then the warden of the labyrinth beneath it — and hold the bastion at the end of it all. A browser game on HTML5 Canvas and the Web Audio API, every sound synthesized at runtime, built to one self-contained HTML file: no engine, no account, no tracking.

![Gameplay: the Ranger fighting a crow swarm, a satchel blast, a multi-kill streak, the Crow King's entrance and fight](media/gameplay.gif)

- [The manual](#the-manual)
- [Play](#play)
- [Characters](#characters)
- [Multiplayer](#multiplayer)
- [Controls](#controls)
- [Docs](#docs)
- [License](#license)

## The manual

**[Read the manual](https://mrbisonte.github.io/crow-archer/manual.html)** — a paper manual for a live game, in the style of the ones that came in the box. It is the best way in: every kit, key and number in it is read off the real build, and it opens on a menu of what there is to play.

```
 © 2026 CROW ARCHER · MIT LICENCE · NO ENGINE, NO ACCOUNT, NO TRACKING

 CROW ARCHER
 SURVIVE THE FLOCK — GAME MANUAL

   B  BRAWL        hunt 10 crows · boss fight · scarce drops
   W  WAVES        survive escalating swarms · endless run
   S  SIEGE        hold the bastion · ten waves · a retinue that grows
   M  MULTIPLAYER  up to 4 players · co-op or 2v2 · needs a server
   C  CONTROLS
```

It is a live document, not a screenshot of one: the reticle figure follows your
pointer, and **§02 THE FIVE** is a picker — click a character's icon to read
that one's kit on its own, instead of scrolling five of them.

## Play

| How | What you need |
|---|---|
| **In the browser** | Nothing — [play here](https://mrbisonte.github.io/crow-archer/) |
| **Offline** | [`crow-archer.html`](https://github.com/MrBisonte/crow-archer/releases/latest/download/crow-archer.html) from the [latest release](https://github.com/MrBisonte/crow-archer/releases/latest). Every dependency is inlined, so it plays with the network off |
| **From source** | `npm install`, then `npm run dev` |
| **Multiplayer** | A server. See [Multiplayer](#multiplayer) |

`npm run dev` alone serves single-player. Multiplayer additionally needs `npm run server`, covered below.

`npm run build` writes `dist/index.html`, which is gitignored. Releases are built by CI from the tagged commit and attached as `crow-archer.html`, so what people download is never a stale local copy: tagging a version and pushing the tag is the whole publish step.

## Characters

| | weapon | body | rhythm |
|---|---|---|---|
| **Archer** | bow | middling health, quick | fastest shots, weakest hit: about seven to kill the Crow King |
| **Wizard** | staff | frailest, slow | hardest single hit, bolts that steer toward whoever is nearest |
| **Knight** | spear | most health, slowest | nothing at range; a thrust that lands twice per swing |
| **Ranger** | crossbow | frail, quickest | three smaller, weaker bolts per shot, each an independent hit; a net that pins a group |
| **Sapper** | powder charge | middling health, quick | slowest throw, thrown at a place: it bounces, fuses, and blasts an area |

The full kit of each — primary, special and pickups — is in [§02 of the manual](https://mrbisonte.github.io/crow-archer/manual.html#characters), one character at a time. The exact numbers are in [balance](docs/balance.md#character-stats).

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
| Shift | Per character: the archer draws a power shot, the knight winds up a charging sweep, the wizard blinks, the ranger throws a net, the sapper gets sniper mode. Tap again within 1.1 s to chain the knight's or the wizard's |
| Pause | Escape |
| Inventory | I (while paused) |

Move, Shoot, Sniper mode and Pause are remappable from the Controls screen.

## Docs

| Doc | For |
|---|---|
| [Game manual](docs/manual.md) | The same manual as plain markdown: character kits, systems, map, bosses, game loop, hosting and deploying |
| [Balance](docs/balance.md) | Character stats, boss health, and the one dial that relates them |
| [Architecture](docs/architecture.md) | Tech stack, dependencies, netcode, design patterns |
| [Playbooks](docs/playbooks/README.md) | What building this game has cost: one file per kind of work |
| [Working rules](CLAUDE.md) | Contributing: the traps this codebase has already fallen into, and what is mechanically enforced |
| [Coordination](COORDINATION.md) | Who is working on what, and the one branch that may push |

## License

[MIT](LICENSE)
