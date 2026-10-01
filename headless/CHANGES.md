# Changes outside headless/

Each change is its own commit so I can cite it on its own.

## Engine changes

### 1. src/boatSprite.js: removed an unused, broken import

Commit `5d11c91`.

`boatSprite.js` imported `SpriteConstants` from `spriteConstants.ts`, but
that file has no such export. It only exports single constants like
`SPRITE_SHIP`. The import was never used. Webpack ignores it, but Node
refuses to load a module with a named import that does not exist, so
`Simulation` could not be created in Node at all. Removing the line
changes nothing in the browser build.

### 2. src/simulation.js: `budget` changed to `this.budget` in the census calls

Commit `642655e`.

```js
this._census.take10Census(this.budget);
this._census.take120Census(this.budget);
```

Both calls used a bare `budget`, which is not declared in that function.
Every other use in the file is `this.budget`. In Node this threw a
`ReferenceError` the first time the monthly census ran, so a headless run
stopped after about one month. The bug was already in upstream.

In the browser it most likely did not throw. `index.html` has an element
with `id="budget"`, and browsers make element ids available as global
variables, so `budget` pointed at that element. `take10Census` then read
`cashFlow` from it, got `undefined`, and stored `NaN` in the money history
used by the graphs. I have not checked this in a browser.

### 3. src/random.ts: optional seeded generator

Commit `97440e2`.

I added a mulberry32 generator with `Random.setSeed(seed)`,
`Random.getSeed()` and `Random.clearSeed()`. When a seed is set,
`getRandom` uses it by default, otherwise it uses `Math` as before. The
default is evaluated on every call, and all other `Random` functions go
through `getRandom`, so they are all seeded without changes of their own.
With no seed set the behavior is the same as before. Calls that pass their
own generator, like the Jest tests in `test/random.ts`, are not affected,
and those tests still pass.

### 4. src/simulation.js: added `forceTick()`

Commit `4341a1b`.

`_simFrame` only advances the simulation when enough real time has passed,
using `new Date()`. For headless runs I need to step without a clock.
`forceTick()` has the same checks as `_simFrame` for a paused game and for
a budget waiting for input, then calls `_simulate` and `_updateTime`
directly. It is a new method, so `simTick`, `_simFrame` and the browser
loop are unchanged.

## Configuration changes

### 5. tsconfig.json: `include` limited to src/ and test/

Commit `9872afd`.

`tsconfig.json` had no `include`, so TypeScript picked up every `.ts` file
in the project, including `headless/`. `ts-loader` type checks the whole
program, even files that webpack never bundles. The `.ts` extensions in
the headless imports need `allowImportingTsExtensions`, which the project
does not enable, so `npm run build` failed with `TS5097`. With `headless/`
moved away the build worked, with only the bundle size warnings it already
had. Limiting `include` to `src/` and `test/` fixed it without affecting
the build or Jest.

### 6. jest.config.js renamed to jest.config.cjs

Commit `96c9d70`.

`package.json` sets `"type": "module"`, which upstream added, so Node
treats every `.js` file as an ES module. `jest.config.js` uses
`module.exports`, so `npm test` failed before running any test. The `.cjs`
extension makes Node load it as CommonJS. Only the file name changed.

`npm test` now runs 162 tests and 160 pass. The 2 failures are in
`test/bounds.ts`. They expect `Bounds` to assert on a zero width or height,
but upstream commented those asserts out in commit `46b9d79`. I left them.

## Known limitation: a loaded city does not continue exactly

A city that is saved and loaded does not continue the same way as a city
that was never saved. Loading the same save twice does give the same run,
which is what I need, so I did not change the engine for this.

I measured the causes by saving a hard city at year 10 and comparing it
with an uninterrupted run. These come from the engine:

- `_simCycle` is not in the save data, so it restarts at 0 after a load.
  It decides when the pollution, population density and other scans run,
  so they happen on different ticks than in the uninterrupted run.
- The `Simulation` constructor always runs a full map scan in `init()`,
  also when loading. Fire and flood tiles draw random numbers and advance
  one extra step during that scan.
- The position of the random generator is not saved. `random.ts` has no
  way to read or restore the mulberry32 state.
- `_simulate` runs one extra `cityEvaluation()` on the first tick of every
  new `Simulation`, including a loaded one. For a city with population
  that draws random numbers in `doVotes` and `voteProblems`. For the empty
  test city it draws nothing, because the evaluation only resets when the
  population is 0.

An earlier version of this file named only the last point as the cause.
That was wrong for the tested city.

Three other causes were in `headless/` and are fixed now. `loadCity` lost
the disasters option, since the engine does not save it and turns
disasters off by default. It kept whatever speed was saved. And the saved
data shared the census history arrays with the running city.

After I restored the disasters option, `_simCycle`, the block maps and the
flood counter from outside and skipped the extra evaluation, the two runs
still differed. Fixing this fully would need engine changes: saving
`_simCycle` (with a default for older saves), a way to save and restore
the generator state, and skipping the scan and the evaluation side effects
when loading. The last test in `headless/test/determinism.test.ts`
describes the expected behavior and is marked as todo.

## Known upstream bug, not fixed

In `src/disasterManager.js`, `makeFlood` checks the tiles next to water
with:

```js
if (tile === TileValues.DIRT || (tile.isBulldozable() && tile.isCombustible)) {
```

`tile` is a `Tile` object, so comparing it with the number `DIRT` is
always false. `tile.isCombustible` has no parentheses, so it is the
function itself and always true. A flood can therefore start on any
bulldozable tile next to water. Fixing it would change how the game
behaves, so I left it and only note it here.
