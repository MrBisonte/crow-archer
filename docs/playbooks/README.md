# Playbooks

What building this game has actually cost, written down so it costs less the
next time. One file per kind of work.

These are not the architecture docs. Three questions sort a fact into the right
home:

| Question | Home |
|---|---|
| How is the game put together? | [architecture.md](../architecture.md) |
| What shape does code in this repo take? | [design-patterns.md](../design-patterns.md) |
| What do I have to get right to build this *kind of thing*? | here |

Rules that hold everywhere, not just for one kind of work, belong in
`CLAUDE.md` instead. If a fact already lives in one of those, link it, never
restate it.

## The files

- [screens.md](screens.md) — character select, HUD, menus: anything laid out in
  canvas coordinates and clicked.
- [proving-a-change.md](proving-a-change.md) — making a test, a probe or a
  measurement mean what you think it means.

Pending: the character-art playbook is `docs/character-rebuild-playbook.md` on
`feat/char-redesign`. Whoever merges that branch moves it in here as
`character-rebuild.md` and adds its row above.

## The shape

Trigger, then the action it requires, the way `CLAUDE.md` writes them:

> **About to call something a performance bug?** Measure it first.

A trigger is something you will actually notice yourself doing. "Be careful
with caches" is not a trigger; "adding a second size to a sprite" is.

Living documents. Anything that cost more than ten minutes to work out a second
time belongs in one of them.
