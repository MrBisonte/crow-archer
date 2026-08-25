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

The layout is fixed and the scatter is seeded. Towers at columns 3-4, each a
2x2 block, one above and one below centre; the barrier two columns in front of them, with a passable
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
| 10 | Everything, behind two bosses on one shared bar |

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

Three bodies on the field at wave 1: two recruits rolled from a weighted table,
plus the priest, which is seated rather than rolled. One more recruit walks in
after every wave held.

Those are two separate constants — `STARTING_RECRUITS` for what the roll draws,
`OPENING_RETINUE` derived from it plus `UNIQUE_GUARD_KINDS.length` for how many
turn up. `STARTING_GUARDS` was the old name and answered both questions at once,
which stopped being true the moment the priest was seated on top of the roll.

| Guard | HP | Damage | Heal | Roll | Promotion track |
|---|---|---|---|---|---|
| Archer | 1 | 1 | — | 40% | `combat` |
| Foot soldier | 3 | 1 | — | 40% | `combat` |
| Knight | 2 | 2 | — | 20% | `none` |
| **Priest** | 2 | **0** | 1 | **never** | `ministry` |

Survive a wave and gain a rank, to a maximum of three. The `combat` ladder is
+1 hp, +1 hp, then +1 damage; a senior foot soldier ends at 5 hp and 2 damage,
which is a knight's damage on more than twice a knight's body, and is meant to
be worth protecting.

The knight's track is `none`. It is the rare roll and already doubled on both
axes, so it does not also climb — a design call kept as a table row precisely so
reversing it is one word rather than a code change.

### The priest, and the two rules it forced

One priest, seated when the siege opens, and **never replaced**. If it dies the
run continues without it. It has no attack at any rank — `baseDamage: 0` is the
row, not an omission — so an enemy that walks onto it takes nothing. Its primary
is a +1 heal on the hurt ally nearest it; its ward is a +3 sweep over everyone
it reaches, itself included, once per wave, recharged only by `completeWave` —
which is what makes it once per *wave* rather than once per some number of
seconds. A cooldown would have been worth more on a wave that took longer to
clear.

The ward fires at two hurt allies within reach, counted over who the sweep would
actually land on rather than over the whole retinue — otherwise it goes off
because two guards are bleeding on the far side of the bastion where it cannot
help them. Two is also where the sweep first beats the primary outright: 6
health against 1. Waiting for a third is how a priest dies with the charge
unspent.

**It cannot be recruited, and that is enforced by the compiler rather than by a
zero.** `weight: 0` would have been the obvious shape and the wrong one: it
leaves a priest sitting in a weighted table as a row that must never be rolled,
one careless edit away from being rolled. Instead the roster is two unions —
`RecruitableGuardKind` and `UniqueGuardKind` — `GuardKind` is their union with
no members of its own, and `RECRUIT_WEIGHTS` is keyed on the recruitable half.
Giving the priest a weight does not compile; nor does returning one from
`rollGuardKind`. A fifth guard has to be added to one union or the other, which
is where the author is made to say which group it is in.

**A rank that granted nothing would be a badge that lies**, and the combat
ladder's last step is +1 damage the priest has none of. So `promotable: boolean`
became `promotion: PromotionTrack`, and the `ministry` ladder keeps the two hp
steps and pays the third in +1 heal. A senior priest is 4 hp, 0 damage, heals 2.
`none` is a `null` ladder rather than a ladder of empty steps, because "does not
promote" and "promotes into nothing" are different statements.

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

**Each guard solves its own A\*, and does not join the crows' scheduler.**
Direct movement was the first call, on the grounds that the bastion's middle is
open. That held only while a guard never had to go anywhere: it fought whatever
was already beside it. The moment the retinue had to follow the hero, the
barrier it was standing behind became a wall it walked into and stayed at, and a
playtest found the retinue left at the towers with the hero across the map.

`PathScheduler` was still the wrong home for the fix. It serves one destination
for the whole frame and the crows own it — every agent on that queue is going to
the player. A guard is going to a *different* moving point near the player, one
per guard. So `walkGuardTo` calls `computeAStarPath` itself and caches the
route, re-solving on `guardRouteInterval` or as soon as the goal has drifted
more than a tile from what the route was computed for. Without that drift check
a guard chasing a body followed the path to where that body used to be for up to
half a second, which on a map with a wall through the middle is the difference
between going round the barrier and walking into it. The cost is bounded by the
recompute interval rather than by the frame.

### The ground a guard answers for

Two anchors, not one: the gate it holds, **and** the hero. With the gate alone,
anything that got past the barrier stopped being any guard's business the moment
it was more than a leash from the post — and the hero stands further from the
nearest gate than the leash is long. A headless run measured the failure
exactly: three bodies stacked on the hero, nearest post 190px away, leash 170.
The retinue stood on its gates and watched, each guard correctly concluding
there was nothing within its remit.

The union of two discs rather than one wider one, because they are two different
jobs and one radius cannot express both — widening the leash until it covered
the hero would also let a guard chase a crow most of the way to the corridor.
Overlapping is what keeps the region connected, so a guard can walk from its
gate to the hero without ever being outside it. Eligibility is measured from the
ground and the choice from the guard, which is the difference between a
bodyguard and a skirmisher: a guard already drawn out to the edge must not find
something further out and keep going.

## The towers

`src/sim/towers.ts`. 20 hit points each, a 2x2 footprint, and **they are cover
that shoots back, not objectives.**

Each standing tower picks the nearest enemy inside its reach and looses a bolt
on a cooldown. It outranges every guard on the field and reloads faster, and
its bolt is worth 2 where a guard's arrow is worth 1. That trade is the tower's
whole argument for existing: a guard walks, is healed by the priest and is
replaced by a recruit every wave, while a tower cannot be repaired, cannot be
moved off a wave camping on it, and is gone for the rest of the run once it
falls. Covering fire stops in the same frame the cover does — a fallen tower
does not shoot.

They occupy four tiles, not one. At 32px a tower was the same size as the hero
and smaller than most of what walks at it, which reads as a bollard rather than
as the thing the map is named for; at 64px it is the largest thing on the map
that is not a boss. `TOWER_SPAN` is the one place that says so, and the
generator, the renderer and the contact pass all derive the footprint from it.

The number is tuned against the ladder rather than by feel: it fields 75 bodies
across ten waves and the ordinary hit is worth 1, so both towers together are
40 points of masonry against 75 bodies. "Finished having lost one" is the
expected outcome and "lost neither" is having played well.

A fallen tower does not block. `towerAt` answers with standing towers only, so
its tiles are as open as ground that never had a tower, for arrows and bodies
alike — all four of them are cleared when it comes down.
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
  alongside, so the slot keeps its meaning for every existing reader.
- **The pair share one bar and one life.** Wave 10's two are drawn as a single
  bar carrying the sum of both pools — an even split, because the siege keeper
  is given the commander's HP row — and when either goes down the other goes
  with it. Two bars for two bosses was the other option and it is worse: the
  slot only ever had one bar, so the second was invisible, and finishing one
  left the player fighting a boss with no readout at all.
- **The keeper had to be killable here.** `bossHpFor` gave the minotaur
  `Infinity`, because the maze's keeper is the level's pressure rather than its
  objective. Wave 10 fields him as one enemy inside a wave, and
  `siegeWaveCleared` waits on every boss being dead — so the last wave of the
  bastion could not be cleared by fighting it at all. His on-hit arm only
  stunned, too, so even a pool would not have drained. Both are now conditional
  on `siegeRun`: in the maze nothing changes, in a siege he has a pool and takes
  damage, and he keeps the stun in both.
