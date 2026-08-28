# CROW ARCHER

[![CI](https://github.com/MrBisonte/crow-archer/actions/workflows/ci.yml/badge.svg)](https://github.com/MrBisonte/crow-archer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/MrBisonte/crow-archer)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)

```
              ,;;;;;;;,
            ;;;;;;;;;;;;;
           ;;;;;;N;;;;;;
          ;;;;;;;;;;;;;;;
         ;;;;;;;;;;;;;;;;;
        ;;;;;;ooooo;;;;;;;   ->---
       ;;;;;;;ooooo;;;;;;|      ~~~
      ;;;;;;;;ooooo;;;;;;o\
     ;;;;;;;;;;;;;;;;;;;;;o\
    ;;;;;;;;;;;;;;;;;;;;;;oo\
   ;;;;;;;;;;;;;;;;;;;;;;;ooo\
  ;;;;;;;;;;;;;;;;;;;;;;;;oooo\
   ;;;;;;;;;;.;;;;;;;;;;;oooo
    ;;;;;;.....;;;;;;;oooo
     ;;;;;.....;;;;;;;o
      ;;;;.....;;;;;;
       ;;;.....;;;;;
        ;;.....;;;;
         ;.....;;;
          .....;;
           ....;
            ...

       C R O W   A R C H E R
```

Survive the flock, kill the Crow King, then the two dark bosses waiting in his castle, then the warden of the labyrinth beneath it. Hold the bastion at the end of it all. A browser game on HTML5 Canvas and the Web Audio API, every sound synthesized at runtime, built to one self-contained HTML file.

![Gameplay: the Archer fighting a crow swarm, a dynamite blast, a multi-kill streak, the Crow King's entrance and fight](media/gameplay.gif)

- [The manual](#the-manual)
- [Play](#play)
- [Multiplayer](#multiplayer)
- [Controls](#controls)
- [Characters](#characters)
- [Docs](#docs)
- [License](#license)

## The manual

[The manual](https://mrbisonte.github.io/crow-archer/manual.html): the same manual, styled. Start here if you just want to play.

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

Section 02 shows one character at a time. Click an icon to read that kit.

## Play

[Play in the browser](https://mrbisonte.github.io/crow-archer/), or [download it](https://github.com/MrBisonte/crow-archer/releases/latest/download/crow-archer.html) and play offline, no install.

**Single-player**, offline, no server: download [`crow-archer.html`](https://github.com/MrBisonte/crow-archer/releases/latest/download/crow-archer.html) from the [latest release](https://github.com/MrBisonte/crow-archer/releases/latest) and open it in any modern browser. Every dependency is inlined, so it plays with the network off.

**Multiplayer** needs a server. See [Multiplayer](#multiplayer).

To run either from source:

```
npm install
npm run dev
```

`npm run dev` alone serves single-player. Multiplayer additionally needs `npm run server`, covered below.

`npm run build` writes `dist/index.html`, which is gitignored. Releases are built by CI from the tagged commit and attached as `crow-archer.html`, so what people download is never a stale local copy: `git tag v0.2.0 && git push --tags` is the whole publish step.

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

## Characters

| | weapon | body | rhythm |
|---|---|---|---|
| **Archer** | bow | middling health, quick | fastest shots, weakest hit: about seven to kill the Crow King |
| **Wizard** | staff | frailest, slow | hardest single hit, bolts that steer toward whoever is nearest |
| **Knight** | spear | most health, slowest | nothing at range; a thrust that lands twice per swing |
| **Ranger** | crossbow | frail, quickest | three smaller, weaker bolts per shot, each an independent hit; a net that pins a group |
| **Sapper** | powder charge | middling health, quick | slowest throw, thrown at a place: it bounces, fuses, and blasts an area |

See the [manual](docs/manual.md#characters) for the full kit of each: primary, special, and pickups, and [balance](docs/balance.md#character-stats) for the exact numbers.

## Docs

| Doc | For |
|---|---|
| [Game manual](docs/manual.md) | Full character kits, systems, map, bosses, game loop, hosting and deploying |
| [Balance](docs/balance.md) | Character stats, boss health, and the one dial that relates them |
| [Talents](docs/talents.md) | Per-character trees, mastery, and the run draft |
| [Architecture](docs/architecture.md) | Tech stack, dependencies, netcode, design patterns, the console verbs |
| [Playbooks](docs/playbooks/README.md) | What building this game has cost: one file per kind of work |
| [Working rules](CLAUDE.md) | Contributing: the traps this codebase has already fallen into, and what is mechanically enforced |

## License

[MIT](LICENSE)
