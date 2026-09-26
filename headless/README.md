# Headless micropolisJS runner

A headless, deterministic wrapper around the micropolisJS engine. Create a
city from a seed, level and disasters option, advance it N months as fast
as possible with no wall clock dependency, and read back a plain object
snapshot of its state. No agents, no LLMs, no action API. This only proves
the engine itself runs headless and reproducibly in Node.

See `CHANGES.md` for the engine changes this required, and one genuine
limitation that was found and documented instead of fixed.

## Running

Requires `npm install` once (adds `tsx` and the rest of the project's dev
dependencies).

```sh
npm run test:headless   # node:test reproducibility suite
npm run bench:headless  # times 20 in-game years
```

Or run either file directly with `npx tsx <path>`.

## API (`runner.ts`)

```ts
import { createCity, stepMonths, getState, saveCity, loadCity, Simulation } from './runner.ts';

const sim = createCity({ seed: 12345, level: Simulation.LEVEL_HARD, disasters: true });
stepMonths(sim, 12); // advance one year
const state = getState(sim);
const saved = saveCity(sim);
const reloaded = loadCity(saved); // see CHANGES.md's known limitation first
```

`createCity({ seed, level, disasters })` takes `level` as one of
`Simulation.LEVEL_EASY`, `LEVEL_MED` or `LEVEL_HARD` (re-exported here, not
reinvented). It seeds the engine's RNG (`Random.setSeed`, `src/random.ts`)
before generating the map, so map generation itself is reproducible.

`stepMonths(sim, n)` advances exactly `n` months via
`Simulation.prototype.forceTick()` (`src/simulation.js`), which steps one
phase cycle with no wall clock dependency. `TICKS_PER_MONTH` (64) comes
directly from the engine's own constants, 16 phase cycles per time unit and
4 time units per month.

`getState(sim)` returns the shape below.

`saveCity(sim)` and `loadCity(data)` are thin wrappers around
`Simulation.prototype.save()` and the `Simulation` constructor's existing
saved game path (`src/simulation.js`), the same way `Game.js` loads a saved
game in the browser. No engine changes were needed for this.

### Simulation speed is fixed

`HEADLESS_SPEED = Simulation.SPEED_MED` matches `Game.js`'s own default
speed for a new browser game. Speed no longer paces wall clock ticking here
(`forceTick` has none), it only controls how often secondary block map
scans (power, pollution and land value, crime, population density, fire)
refresh relative to sim ticks (`src/simulation.js`'s `speedPowerScan` and
friends). It's fixed as a constant so every headless run refreshes these at
the same rate.

### `Random` is a process wide singleton

`Random.setSeed`, `getSeed` and `clearSeed` (`src/random.ts`) are module
level, not per `Simulation`. Never advance two `Simulation` instances in an
interleaved way while comparing them. Each one's `forceTick()` consumes
from the same shared generator, so interleaving corrupts both branches'
streams relative to running them in isolation. Let one full run (or one
full create, step, save, reload, step sequence) complete before starting
the next comparison run, and reset the seed at the start of each.

### `getState(sim)` shape

```ts
{
  date: { year, month },                 // sim.getDate()
  funds: number,                          // sim.budget.totalFunds
  population: number,                     // sim.evaluation.cityPop
  score: number,                          // sim.evaluation.cityScore
  cityClass: string,                      // sim.evaluation.cityClass
  approval: number,                       // sim.evaluation.cityYes, 0 to 100
  rci: { residential, commercial, industrial },  // sim._valves.{res,com,ind}Valve, signed
  problems: { crime, pollution, housing, taxes, traffic, unemployment, fire },
  poweredZoneCount: number,
  unpoweredZoneCount: number,
  taxRate: number,
}
```

`crime`, `pollution`, `housing`, `taxes` and `traffic` are read straight
from public fields (`census.crimeAverage`, `census.pollutionAverage`,
`census.landValueAverage`, `budget.cityTax`, `census.trafficAverage`).
`unemployment` and `fire` are recomputed in `runner.ts` using the same one
line formulas as `Evaluation`'s private `getUnemployment` and
`getFireSeverity` (`src/evaluation.js`). Those two are never stored
anywhere on the instance, so there's nothing to read. The alternative was
a small additive engine change, and duplicating two one line pure formulas
was chosen instead to keep the engine change list to exactly the four in
`CHANGES.md`.

`census.trafficAverage` specifically is a side effect of the private,
once a year evaluation pass, and it's not part of `Census`'s saved fields.
It reads as `undefined` until the first `cityEvaluation()` call on a given
instance, whether that's a brand new city or transiently right after
`loadCity()`, before the very next `forceTick()`. `getState()` defaults it
to `0` rather than leaking `undefined`.

Reading `sim._valves` and `sim._census` from outside `Simulation` is
deliberate. JS doesn't enforce the underscore prefix convention, and
adding getters nothing else needs would be more engine surface than this
needed.

## Determinism, as actually measured

See `headless/test/determinism.test.ts` for the full suite (`npm run
test:headless`). Summary:

* Same seed, 20 years, hard difficulty, disasters on. Two independent runs
  produce identical hashes and `getState()` at every year boundary and at
  the end. Passes.
* Different seeds. Final state diverges. Passes.
* Save at year 10, reload, continue 10 more years, twice. Both reloads
  produce identical results to each other, so reload then continue is
  itself deterministic and reproducible. Passes.
* Save at year 10, reload, continue 10 more years, against an
  uninterrupted 20 year run. This does not match. It's a real, diagnosed,
  pre-existing engine limitation (see `CHANGES.md`'s known limitation
  section), not a bug in headless/ code and not introduced by any of the
  engine changes above. The test documents and locks in this behavior
  instead of silently asserting it away.

## What "disasters: true" actually does right now

No action API exists yet, so a headless city never has roads or zones and
population stays at 0 for the whole run. `disasterManager.doDisasters()`
still rolls its dice every simulated time unit on schedule, and
fire, flood and meltdown disasters (which mutate the map tiles directly)
work fully. Monster and tornado disasters spawn a sprite (consuming their
RNG draws on schedule, so they don't affect reproducibility), but
`SpriteManager.moveObjects()`, which is what makes sprites wander, cause
further damage and eventually expire, is only ever called from `Game.js`'s
`requestAnimationFrame` loop in the browser, never from `simTick()`.
Headless doesn't call it either, so a spawned monster or tornado sits
inert forever. This is a deliberate phase 1 choice (calling it would mean
inventing an arbitrary calls per tick constant with no basis in the
engine's own code). Worth revisiting once an action API exists and city
development is actually happening.
