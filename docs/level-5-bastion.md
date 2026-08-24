# Level 5: the bastion

The fifth map and the campaign's last stage: a finite ten-wave siege of two
towers, fought beside a retinue that grows.

Written after the code, unlike [Level 3: the maze](level-3-maze.md), which was
written before it. What follows is a record of what was built and why, not a
proposal. Where a decision could have gone another way, the rejected option is
named.

- [What the map is](#what-the-map-is)
- [The one rule everything gates on](#the-one-rule-everything-gates-on)
- [The ground](#the-ground)
- [The ladder](#the-ladder)
- [The retinue](#the-retinue)
- [The towers](#the-towers)
- [How it ends](#how-it-ends)
- [What it cost elsewhere](#what-it-cost-elsewhere)

## What the map is

Two towers behind two courses of stone, at the west end of the arena. The
corridor at the east end is where ten waves come from. The player and a
retinue of allied guards hold the ground between.

It is reachable two ways:

| Route | How |
|---|---|
| **Siege mode** | **S** on the title screen. A standalone run of the ladder. |
| **The campaign** | Through the maze door, which used to end the game. |

Both are the same map running the same rules. That is not a coincidence, it is
the constraint the whole feature was built around.

## The one rule everything gates on

**The siege runs when `mapPopulation() === 'siege'`. Never when
`gameMode === 'siege'`.**

This is the single most load-bearing decision in the feature, and it exists
because the codebase already paid for getting it wrong once in the other
direction. The escalation timer used to bail out on `mapKind === 'castle'`,
keyed on the map when it should have keyed on the mode; picking Castle in Waves
mode then returned every tick and the run never spawned another crow past the
opening batch. `MODE_RULES.runsCastleGauntlet` is that lesson, held as one
field read by both sites so they cannot drift apart.

The bastion is the same mistake available in mirror image. A brawl that walks
through the maze door arrives on the bastion with `gameMode` still `'brawl'` —
correctly, because it *is* still a brawl. Gate the siege on the mode and the
campaign's last stage is an empty map with two towers on it and nothing to
defend against. Gate it on the map and both routes work without either knowing
about the other.

`MapPopulation` gained `'siege'` rather than reusing `'scripted'`. Both keep a
map off the Waves map-select screen, and folding them together would have been
tempting for exactly that reason — but a scripted map has no wave count at all
while a siege has exactly ten, and one value answering two questions is the
mistake `crows: boolean` made before it became `population`.

## The ground

`BastionTerrain`, in `src/sim/bastion-terrain.ts`.

The layout is fixed and the scatter is seeded. Towers at columns 2-3, one above
and one below centre; the barrier two columns in front of them, with a passable
gap at each flank; open middle ground with sparse cover; the corridor clear.

**Reachability is guaranteed by construction, not by repair.** The generator
reserves a skeleton the scatter may never touch — a walkway behind the towers,
one lane through each flank gap, and the ring of tiles around each tower — so
"can the siege reach a tower" is answered by "is the skeleton intact" and never
by a probability. The rejected alternative was the cavern's approach: scatter
freely, then repair the result with a `joinRegions`-style pass. Repair has to
carve, and carving through a barrier whose entire purpose is to be walked
around defeats the map.

The invariant is checked over 200 seeds twice — once with a noise field and
once without, 400 grids — and it was shown to be *capable* of failing before it
was trusted: hand-walling a tower's ring makes the same flood fill return
false.

There is no water. A siege ground with a pond in it is a different picture, and
`TILE.WATER` stops a body, so a pool across a flank lane would narrow or close
one of the two ways round the barrier.

A tower is `TILE.HUT` rather than a new tile id. A tower is already what a hut
is to the renderer — one solid tile with a roof — and a new id would have meant
a row in every theme that has no tower in it.

## The ladder

`src/sim/siege-waves.ts`. Ten waves, drawn from the whole bestiary.

| Waves | Shape |
|---|---|
| 1-3 | One kind each: bats, then crows, then rats |
| 4-6 | Pairs, each putting a known kind beside a new one |
| 7-9 | Combinations with a boss folded in |
| 10 | Everything, behind two bosses |

A test asserts that every `EnemyKind` and every `BossKind` appears at least once
across the ten, driven off the kind lists rather than a hand-written one — so
"every existing critter comes" is checked rather than intended.

Two facts about the bestiary are worth having written down, because both are
surprising and both were verified against `game.js` rather than assumed:

- **A bat is a white crow.** `spawnBossBats()` pushes into the `crows` array
  with `white: true`, and until now only the Crow King ever called it.
- **`walksIn` is per kind, not per roster.** The rat is placed inside the map
  by `openTileAwayFrom`, while the three castle skeletons it shares an array
  with march in from the right edge. On this map that is the difference between
  a siege coming down the corridor and one appearing behind the walls.

Crows spawned by a siege wave are aggro'd on arrival. A passive crow drifts
left and recycles off the edge forever, which on a finite ladder means a wave
that can never be cleared.

## The retinue

`src/sim/guards.ts` for the rules, `src/render/guard-grids.ts` for the art,
`src/sim/siege-run.ts` for who is in it.

Two guards at the start, one recruit after every wave survived, rolled on a
weighted table.

| Guard | HP | Damage | Roll |
|---|---|---|---|
| Archer | 1 | 1x | 40% |
| Foot soldier | 3 | 1x | 40% |
| Knight | 2 | 2x | 20% |

Survive a wave and gain a rank, to a maximum of three: +1 hp, +1 hp, then +1
damage. A senior foot soldier is 5 hp and 2 damage, which is a knight's damage
on more than twice a knight's body, and is meant to be worth protecting.

The knight is `promotable: false`. It is the rare roll and already doubled on
both axes, so it does not also climb. That is a design call kept as a table row
precisely so that reversing it is one word rather than a code change.

Guards read apart from the cavern's enemy garrison by palette — pale bodies
against its three dark ones, in a violet livery, violet being the one hue the
cavern uses nowhere. This is asserted as *zero colours in common* rather than
as "guards are lighter", because the first version of that rule was false: the
foot soldier's violet is darker than the enemy spearman's bronze.

Rank shows as a ladder of gold pips with a blank row between them. Counting
discrete marks is a categorical read; scaling one shape is a magnitude read and
needs a second sprite beside it to compare against, which a bastion rarely
offers. The blank row is the device — three touching pips are a three-pixel bar
and nothing is countable.

**Movement is direct, not A\*.** `PathScheduler.serve` takes one goal for the
whole frame and the crows already own it, so a guard asking for a path would be
asking for a path to the player. Over the bastion's open middle that costs
nothing — it is the one map deliberately built without corridors — and the note
is in the source so the next map does not inherit the assumption silently.

## The towers

`src/sim/towers.ts`. 20 hit points each, and **they are cover, not
objectives.**

The number is tuned against the ladder rather than by feel: it fields 75 bodies
across ten waves and the ordinary hit is worth 1, so both towers together are
40 points of masonry against 75 bodies. "Finished having lost one" is the
expected outcome and "lost neither" is having played well.

A fallen tower does not block. `towerAt` answers with standing towers only, so
its tile is as open as one that never had a tower, for arrows and bodies alike.
If the cover did not actually go away, losing a tower would cost a sprite and
nothing else, and the map's one piece of attrition would be inert. The rejected
alternative — rubble as low cover, blocking bodies but not shots — is a
legibility problem rather than a taste one: a player cannot read that
distinction mid-wave with a dozen bodies on screen.

## How it ends

**Lost only when the hero dies. Won when wave ten is cleared.**

Towers and guards are protection. A fallen tower is a loss of shelter, a fallen
guard is a loss of help, and neither ends the run. This is deliberate and is
stated in `siege-run.ts`'s module doc, because the obvious reading of "tower
defence" is that losing the towers loses the run and it is not that here.

Winning the siege wins the campaign. The maze door, which used to call
`transitionTo('win')`, now hands off to the bastion the same way the Crow
King's death hands off to the castle and the Dark Knight's to the maze —
assigning `appState` directly rather than going through `transitionTo`, because
that path runs `initGame()` and would wipe the run that just earned its way
there.

## What it cost elsewhere

Three things outside the map had to change, and all three were pre-existing
gaps the feature exposed rather than damage it did:

- **`gameMode` became a table.** It was a bare string compared in eleven places
  inside a file `tsc` does not check, and no test had ever set it, so the Waves
  side of every one of those comparisons was unexecuted. See
  [Architecture](architecture.md).
- **Arrows carry their shooter's damage, for guards.** The collision hardcoded
  1. An archer never swings, so a senior archer's +1 damage was a badge with
  nothing behind it. Player arrows still count as exactly one hit, because the
  quiver is balanced around that.
- **`boss` had to hold two.** Wave 10 fields the minotaur and the commander at
  once, and `boss` is a single slot read in dozens of places that each assume
  one object or null. Extras ride in `siegeExtraBosses` and are ticked
  alongside, so the slot keeps its meaning as "the boss the health bar is
  about" — which is what every existing reader already wanted of it.
