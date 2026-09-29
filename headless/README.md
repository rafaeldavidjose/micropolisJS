# Headless runner

This folder runs the micropolisJS engine in Node without the browser UI. I
can create a city from a seed, a difficulty level and a disasters option,
advance it a number of months as fast as the CPU allows, and read back a
summary of its state. The same seed always gives the same result. There is
no action API yet, so the runner itself never builds anything.

The engine changes this needed are listed in `CHANGES.md`.

## Running

Run `npm install` once. It installs `tsx`, which runs the TypeScript files
directly.

```sh
npm run test:headless   # determinism tests (node:test)
npm run bench:headless  # times 20 in-game years
```

The tests use `node:test` because the project's Jest setup only covers
`src/` and `test/`. `npm test` still runs the engine's own Jest tests.

## API

Everything is in `runner.ts`.

```ts
import { createCity, stepMonths, getState, saveCity, loadCity, Simulation }
  from './runner.ts';

const city = createCity({ seed: 12345, level: Simulation.LEVEL_HARD, disasters: true });
stepMonths(city, 12);
const state = getState(city);
const saved = saveCity(city);
const loaded = loadCity(saved);
```

`createCity` takes the level as `Simulation.LEVEL_EASY`, `LEVEL_MED` or
`LEVEL_HARD`, which `runner.ts` re-exports from the engine. It seeds the
random generator before the map is generated, so the map depends on the
seed too.

`stepMonths` calls `forceTick()` 64 times per month. One `forceTick()` runs
one phase of the engine's cycle. 16 phases make one time unit and 4 time
units make one month. If the city cannot pay for its services, the engine
stops and waits for the player to answer the budget window. There is no
UI to do that, so `stepMonths` throws an error instead of silently not
advancing.

The simulation speed is fixed at `Simulation.SPEED_MED`, the same default
as a new game in the browser. With `forceTick()` there is no wall clock, so
speed only decides how often the power, pollution, crime, population
density and fire scans run. The engine saves the speed with the city, so
`loadCity` sets it back to `SPEED_MED` after loading.

The engine uses one random generator for the whole process. Two cities
stepped in turn would take numbers from the same sequence and change each
other's results. When comparing runs I finish one run before starting the
next. `createCity` and `loadCity` both reseed the generator.

## State

`getState(city)` returns these fields and reads them from:

- `date`: `getDate()`, with month 0 as January
- `funds`: `budget.totalFunds`
- `population`: `evaluation.cityPop`
- `score`: `evaluation.cityScore`
- `cityClass`: `evaluation.cityClass`
- `approval`: `evaluation.cityYes`, from 0 to 100
- `rci`: `_valves.resValve`, `comValve` and `indValve`
- `problems`: the seven problem values, see below
- `poweredZoneCount` and `unpoweredZoneCount`: from `_census`
- `taxRate`: `budget.cityTax`

The engine computes its seven problem values only during the yearly
evaluation and keeps them in a private array in `src/evaluation.js`.
`getState` recomputes them from the current census with the same formulas.
Crime, pollution, housing and taxes come straight from census and budget
fields. Unemployment and fire severity are copies of two private one line
functions in `evaluation.js`. Traffic is the exception. It is the value
from the last yearly evaluation of a city with population, and it is not
saved. For an empty city, and after a load until the next such
evaluation, it reads 0.

Approval and population are not saved either. Right after `loadCity` they
read 0 until the first tick. For a city with no population the yearly
evaluation only resets itself, so the score stays at 500 and approval at
50.

`runner.ts` reads `_valves` and `_census` directly. The underscore is only
a naming convention in the engine, and adding getters to the engine just
for this seemed unnecessary.

## Determinism

The tests in `test/determinism.test.ts` check that:

- two runs with the same seed match at every year boundary for 20 years
  (hard, disasters on), using a hash of the full save data and `getState`
- two different seeds end in different states
- a small developed city gives the same run twice for 20 years
- a loaded city keeps its disasters option
- loading the same save twice gives the same run, even if other runs used
  the shared generator in between

On an empty map only the disaster code uses random numbers. With the test
seed, only 41 of the 12,000 tiles change in 20 years. That is why the developed city test
exists. It places a coal plant, a road, zones on both sides and a power
line with the engine's own tools from `src/gameTools.js`, so growth,
traffic, power and the budget run as well. The test also checks that the
population grew, otherwise it would prove nothing.

I also checked by hand that the same seed gives the same hash in two
separate Node processes.

## Save and load

`saveCity` returns the engine's save data plus two fields: the seed and the
disasters option. The engine does not save either. It also returns a copy,
because the census saves its history arrays by reference and the saved
data would otherwise keep changing while the city runs.

The engine does not save where the random generator is in its sequence.
`loadCity` therefore reseeds it from the saved seed plus the city time.
Loading the same save always gives the same run, in any process.

A loaded city does not continue exactly like a city that was never saved.
The reasons are in the engine and are listed in `CHANGES.md`. The last test
asserts that both runs match and is marked as todo, so it shows up in the
output without failing the suite.

## Performance

`npm run bench:headless` advances a hard city with disasters on for 20
years. Over five runs it took between 110 and 112 ms, about 5.5 ms per
year. I measured this with Node 24.15.0 on an Intel Core Ultra 7 258V on
Windows 11. The map is empty, so a developed city does more work per tick
and will be slower.

## Things to keep in mind

Tornado and monster disasters create a sprite, but sprites only move when
`SpriteManager.moveObjects()` runs. In the browser that happens in
`Game.js`'s animation loop, never in the simulation tick, and the runner
does not call it either. A tornado therefore stays where it appears and
does no further damage. A monster needs average pollution above 60, so it
never appears on an empty map. I left this as it is because calling
`moveObjects()` would mean choosing a number of calls per tick that the
engine does not define.

In `src/evaluation.js`, every yearly evaluation of a city with population
adds 7 entries to a module level array that is never cleared. The array is
shared by every city in the process. It does not change any result, but
memory grows a little with every simulated year and is only freed when the
process ends. This matters for long batch runs in one process.
