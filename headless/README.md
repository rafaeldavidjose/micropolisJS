# Headless runner

This folder runs the micropolisJS engine in Node without the browser UI. I
can create a city from a seed, a difficulty level and a disasters option,
advance it a number of months as fast as the CPU allows, and read back a
summary of its state. The same seed always gives the same result. A small
set of actions lets a program build, bulldoze and set the taxes and the
budget, the same things a player does in the browser.

The engine changes this needed are listed in `CHANGES.md`. The actions and
the budget handling needed none.

## Running

Run `npm install` once. It installs `tsx`, which runs the TypeScript files
directly.

```sh
npm run test:headless   # determinism, action and budget tests (node:test)
npm run bench:headless  # times 20 in-game years
```

The tests use `node:test` because the project's Jest setup only covers
`src/` and `test/`. `npm test` still runs the engine's own Jest tests.

## API

Creating, stepping, reading, saving and loading a city is in `runner.ts`.
The actions are in `actions.ts` and the budget log in `budget.ts`.

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
stops and waits for the player to answer the budget window. `stepMonths`
answers it and goes on, see "Budget window" below.

Two engine settings are fixed in headless.

The simulation speed is fixed at `Simulation.SPEED_MED`, the same default
as a new game in the browser. With `forceTick()` there is no wall clock, so
speed only decides how often the power, pollution, crime, population
density and fire scans run. The engine saves the speed with the city, so
`loadCity` sets it back to `SPEED_MED` after loading.

Auto bulldoze is fixed to on, also the browser default. With it, a
building tool clears its own site before it builds. It removes trees,
shore tiles, rubble and plain power lines, and adds $1 for every tile it
clears to the cost of the building. It does not remove roads, rails, water
or other buildings, those still make the site `occupied`. With it off,
every tile of the site would have to be bare land already. The setting is
one flag for the whole process in the engine, so `engine.ts` sets it
every time the tools are used. The road, rail and wire tools ignore the
setting. They always clear a tree, a shore tile or rubble on their one
tile, for the same $1. The park tool never clears anything.

The engine uses one random generator for the whole process. Two cities
stepped in turn would take numbers from the same sequence and change each
other's results. When comparing runs I finish one run before starting the
next. `createCity` and `loadCity` both reseed the generator.

## Actions

```ts
import { build, bulldoze, setTaxRate, setBudgetPercentages, setAutoBudget }
  from './actions.ts';

const result = build(city, 'residential', 58, 47);
// { success: true, cost: 100, reason: null }
```

- `build(city, tool, x, y)` uses one of the engine's tools. The names are
  the ones in `src/gameTools.js`, without the bulldozer and the query
  tool. They are `airport`, `coal`, `commercial`, `fire`, `industrial`,
  `nuclear`, `park`, `police`, `port`, `rail`, `residential`, `road`,
  `stadium` and `wire`. `BUILD_TOOLS` has the list.
- `bulldoze(city, x, y)` clears one tile, or a whole building.
- `setTaxRate(city, rate)` takes a whole number from 0 to 20.
- `setBudgetPercentages(city, { road, fire, police })` takes whole numbers
  from 0 to 100. The effect on roads, fire and police changes at once,
  the money is only spent at the next yearly budget.
- `setAutoBudget(city, enabled)` is the auto budget option of the
  settings window.

The limits are the ones of the sliders in the browser.

Every action returns `success`, `cost` and `reason`. The cost is what the
action really took from the funds, so it includes auto bulldoze and it is
0 when the action fails. A failed action changes nothing in the city. The
reason is `null` on success, otherwise one of these.

- `unknown-tool`: the name is not in `BUILD_TOOLS`
- `invalid-position`: the tile, or a part of the building, is off the map,
  or a coordinate is not a whole number
- `invalid-value`: a tax rate, percentage or option outside its limits
- `insufficient-funds`: the funds do not cover the full cost
- `occupied`: something is on the site that the tool cannot clear
- `blocked`: the engine refuses a road, rail or wire on that tile, for
  example a road on a road, a wire on a building, or water with nothing
  next to it to bridge from
- `nothing-to-bulldoze`: the bulldozer cannot clear that tile, for example
  bare land or open water

Positions are tiles, with 0, 0 in the top left corner of the 120 by 100
map. A building is placed by its centre tile, as in the engine. For every
building size that is the tile one to the right and one down from the top
left corner of the site. The sites are 3 by 3 tiles, 4 by 4 for the power
plants, the port and the stadium, and 6 by 6 for the airport.

The engine knows a 3 by 3 zone only by its centre tile, so `bulldoze` on
one of its other tiles gives `nothing-to-bulldoze`. The bigger buildings
can also be bulldozed from a few tiles around the centre. A bulldozed
building leaves rubble, which the next building clears for $1 a tile.

The bulldozer and the park tool take numbers from the shared random
generator (for the rubble and the kind of park). A run stays reproducible
as long as the same actions happen at the same points of the run.

The engine tools only print a warning when the position is off the map,
so `actions.ts` checks the position itself before it calls them.

## Budget window

The game has no bankruptcy. Once a year, in January, the engine collects
the taxes and pays for roads, fire and police. If the funds and the taxes
together do not cover that, it lowers the three percentages to what the
city can afford. Roads are paid first, then fire, then police. It then
turns auto budget off, shows "YOUR CITY HAS GONE BROKE" and opens the
budget window, and the simulation waits until the player answers. Funds
never go below 0, and tools refuse to build without money.

`stepMonths` answers that window the way a player does who presses OK
without changing anything. It calls the engine's `doBudgetWindow`, which
accepts the percentages the engine proposed, and goes on. It adds no rule
of its own and nothing ends the game.

The engine never turns auto budget back on by itself. With auto budget
off it opens the window every January, also in years with enough money.
`stepMonths` leaves that as it is and answers every window. An agent can
call `setAutoBudget(city, true)`, like a player in the settings window.
After that the window only opens again in a year the city cannot pay.

Every answered window is recorded. `getBudgetLog(city)` from `budget.ts`
returns the records.

```ts
{
  date: { year: 1902, month: 0 },
  funds: 512,        // when the window opened, before taxes and spending
  taxes: 19,         // collected that January
  fundsAfter: 0,
  road: 100,         // percent of full funding the city paid
  fire: 41,
  police: 0,
  autoBudgetWasOn: true,
}
```

`autoBudgetWasOn` is true for the window that the engine opened because
the money ran out while auto budget was on. For the yearly windows after
that it is false, and a shortage has to be read from the funds and the
percentages. The log is kept in memory for each city. It is not part of
the save data or of the hash, so a loaded city starts with an empty log.

In the browser the window shows the percentages as whole numbers, so a
player who presses OK accepts them rounded down. `stepMonths` accepts the
engine's own values, which have two significant digits.

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

`_valves`, `_census` and `_map` are private fields of the engine. The
underscore is only a naming convention there, and adding getters to the
engine just for this seemed unnecessary. `engine.ts` is the only file
that reads them, and it also keeps the engine's tools for each city.

## Determinism

The tests in `test/determinism.test.ts` check that:

- two runs with the same seed match at every year boundary for 20 years
  (hard, disasters on), using a hash of the full save data and `getState`
- two different seeds end in different states
- a small developed city gives the same run twice for 20 years
- a loaded city keeps its disasters option
- loading the same save twice gives the same run, even if other runs used
  the shared generator in between

The actions are tested in `test/actions.test.ts` and the budget window in
`test/budget.test.ts`. Both also check that the same actions give the same
city and the same budget log twice.

On an empty map only the disaster code uses random numbers. With the test
seed, only 41 of the 12,000 tiles change in 20 years. That is why the developed city test
exists. It places a coal plant, a road, zones on both sides and a power
line with `build`, so growth, traffic, power and the budget run as well. The test also checks that the
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

The budget code in `src/budget.js` has four things that are easy to miss.

After a year without enough money, services stay underfunded. The engine
writes the percentages the city could afford over the ones that were set,
and nothing raises them again. In the poor city of the budget tests, roads
stay at about 50 percent and fire and police at 0 while the funds grow
again. They only go back up when someone calls `setBudgetPercentages`.
Turning auto budget back on does not raise them either.

The window also opens when the money is exactly enough. The engine checks
that something is left after paying, not that the bill can be paid.

The yearly budget only runs for a city with population. An empty city
never pays for anything and never gets a budget window.

A city with population and no roads, rails, fire or police stations pays
$3 a year. With nothing to pay for, the function that works out the costs
returns the three percentages (1, 1 and 1) and the caller takes them for
amounts of money. I saw this in a run with a power plant and three zones.
