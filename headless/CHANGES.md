# Engine changes made for the headless runner

Every change below is minimal, single purpose, and its own commit. This
file exists so each one can be cited and justified individually.

## 1. `src/boatSprite.js`, removed a dead broken import

Commit: `fix(boatSprite): remove dead broken SpriteConstants import`

`boatSprite.js` had `import { SpriteConstants } from './spriteConstants.ts';`,
but `spriteConstants.ts` has no `SpriteConstants` named export (it exports
individual consts like `SPRITE_SHIP`). The import was never referenced
anywhere in the file. Node's ESM loader refuses to load a module with an
unsatisfiable named import, which blocked constructing `Simulation` under
Node at all. Webpack's bundler tolerates it silently since it's dead code.

Safe because the import was unused. Deleting it changes nothing at
runtime in the browser build.

## 2. `src/simulation.js`, fixed a `ReferenceError` in the annual census

Commit: `fix(simulation): use this.budget in take10/120Census calls`

```js
this._census.take10Census(budget);   // was bare `budget`, not this.budget
this._census.take120Census(budget);
```

`budget` isn't declared anywhere in that function's scope. Every other
reference to the budget in this file uses `this.budget`. Since ES modules
are always strict mode, this threw a `ReferenceError` the first time
`_cityTime` reached a multiple of 4 while `_phaseCycle` was 9, roughly
once per simulated month, which unwinds the stack past the point where
the browser's `Game.tick()` loop reschedules itself. This almost
certainly already broke the browser build too, after about a month of
play. Confirmed pre-existing and unrelated to headless work: present on
`main` before any of these changes, and reproduced by running the
unmodified engine.

Safe because it restores the file's own established pattern
(`this.budget`, used everywhere else in `simulation.js`). It doesn't
change what the code was trying to do.

## 3. `src/random.ts`, added an optional seeded PRNG

Commit: `feat(random): add optional seeded PRNG via Random.setSeed/getSeed/clearSeed`

Added a mulberry32 PRNG behind `Random.setSeed(seed)`, `Random.getSeed()`
and `Random.clearSeed()`. `getRandom`'s default `mathGlobal` parameter now
resolves to the seeded generator when a seed is set, otherwise falls
through to `Math` exactly as before. The expression is re-evaluated on
every call, so every other `Random.*` function (all of which bottom out
through `getRandom`/`getRandom16`) picks up seeding automatically, with
no changes of their own.

Safe because with no seed ever set, behavior is unchanged and falls
through to `Math`, same as today. Calls that pass an explicit
`mathGlobal`/`rng` argument (as every existing `test/random.ts` Jest test
does) are unaffected either way.

## 4. `src/simulation.js`, added `forceTick()`

Commit: `feat(simulation): add forceTick() for wall-clock-independent stepping`

`Simulation.prototype._simFrame` throttles phase advancement to real time
via `new Date()`, which is the wrong behavior for headless stepping.
Added `forceTick()`, the same `awaitingValues`/paused guards as
`_simFrame`, but no `Date` threshold. It calls `_simulate(simData)` and
`_updateTime()` directly.

Safe because it's a purely additive method. `simTick`, `_simFrame` and
the browser's `Game.tick()` loop are untouched.

---

## Known limitation found, not fixed

`Simulation.prototype._simulate`'s bootstrap pattern is not save/load
safe.

`_simulate` starts out as a one time wrapper:

```js
Simulation.prototype._simulate = function(simData) {
  this.evaluation.cityEvaluation(simData);
  this._simulate = simulate;
  this._simulate(simData);
};
```

The first call runs an unconditional `cityEvaluation()`, then patches
`this._simulate` (an own property on the instance) to the real
phaseCycle dispatch function for every call after. That patch is a
function, not data, so it's never part of `save()`/`load()`'s output.
Every freshly constructed `Simulation`, including one built by
`loadCity()` from a saved game well into a run, starts with the wrapper
again. Its first `forceTick()` after a reload therefore always reruns
one genuinely extra, unscheduled `cityEvaluation()` (consuming
`doVotes()`'s fixed 100 `Random.getRandom(1000)` draws, plus
`voteProblems()`'s variable draws) that an uninterrupted run never
consumes at that exact point. That permanently shifts the RNG stream, so
every RNG driven outcome after a reload (disasters and so on) diverges
from what an uninterrupted run would have produced. This happens even on
an empty, undeveloped city and has nothing to do with zone building or
pollution.

Confirmed directly by tracing disaster events on both branches (hard,
disasters on, save at year 10 of 20). The uninterrupted run fires
disasters the reloaded branch does not, despite `_cityTime` and
`_phaseCycle` being provably identical at every checkpoint.

Not fixed here. Correcting this means changing `Simulation`'s core tick
dispatch self patching pattern, for example skipping the bootstrap
evaluation specifically when continuing a saved game rather than
starting a brand new city. That's not a minimal, single purpose change
and it deserves its own review. See `headless/test/determinism.test.ts`,
which documents and locks in the current, diverging behavior with a full
explanation instead of asserting it away or skipping it.
