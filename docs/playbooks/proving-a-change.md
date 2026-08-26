# Proving a change

Making a test, a probe or a measurement mean what you think it means. The
mechanics of the harness are in `CLAUDE.md`; this is about the ways a green
suite or a confident number has turned out to be saying nothing.

## Tests

- **Fixed a bug?** Revert the specific line and watch the test fail. This is in
  `CLAUDE.md` and it is worth repeating because of what it catches when it
  *does not* fail, below.
- **Mutation did not fail?** Delete the code, do not weaken the test. The frame
  tracer had an `if (level === 'off') return` at the top of `mark()`; mutating
  it away left every test green. The instinct is to go write a test that pins
  it. The truth was that `beginFrame` already leaves `inFrame` false when
  tracing is off, so the second check could never fire: the mutation survived
  because the code was dead. A guard that cannot be made to matter is not a
  guard.
- **Test that will not go red?** Ask which of the two it is before writing more
  test: the code under it is unreachable, or the fixture is not the one you
  think. Both look identical from the outside.
- **Asserting a set?** Compare the whole set, not its size. `toHaveLength(4)`
  passes for four wrong keys.

## Probes and one-off harnesses

- **Writing a probe to settle an argument?** Run it. Twenty-four scripted runs
  killed a hypothesis in this repo that discussion had kept alive for an hour,
  and the number that came back was not close to what either side expected.
- **Then check the probe runs the same fixture the suite does.** Mine did not
  call `setSiegeRng`, so it drew a different roster than every test in the file
  it was supposedly reproducing, and the 42%-versus-12% split I reported was a
  property of my harness rather than of the game. A probe that skips the
  fixture is measuring a different program. The rule is not "do not probe", it
  is: copy the `beforeEach` before you trust the output.
- **Seeding an RNG?** Check the call site actually reaches it. `setSiegeRng`
  cannot reach the three bare `Math.random()` calls at `src/legacy/game.js`
  6425 to 6428, which seed a spawning guard's `routeTimer`, `walkPhase` and
  `shotCD`. A seeded test that spawns a guard is still random, and a
  `walkPhase` that starts anywhere will make an animation test flaky in a way
  that reads like an art bug.

## Measurements

- **Timing a render?** Count operations, not milliseconds, wherever the
  question allows it. `fillRect` calls and pixels touched are identical run to
  run; wall-clock on the same frame varies enough to hide a regression the size
  of the thing you are looking for. Keep timings for the cases where only
  duration answers the question, and take the minimum of several batches rather
  than the mean.
- **Instrumenting to find a cost?** Wrap once, at one seam. Turning tracing on
  double-wrapped the canvas context and the pixel counts grew across maps that
  should have been flat, which looked exactly like the map-dependent cost being
  hunted. One `applyTraceLevel` over a stored raw context fixed it.
- **A number that confirms what you expected?** That is when to check the
  harness, not when to stop. Three of the wrong numbers in this session were
  wrong in the direction of the hypothesis.
- **Reproducing a baseline?** Do it with the new instrument before trusting it.
  The tracer was believable because it independently landed on 1872 `fillRect`
  against a hand-counted 1870, not because the code looked right.
