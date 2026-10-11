# Headless runner

This folder runs the micropolisJS engine in Node without the browser UI. I
can create a city from a seed, a difficulty level and a disasters option,
advance it a number of months as fast as the CPU allows, and read back a
summary of its state. The same seed always gives the same result. A small
set of actions lets a program build, bulldoze and set the taxes and the
budget, the same things a player does in the browser. Roads, rails and
power lines can also be planned as routes between two tiles and built
once the price is known.

The fork is based on graememcc/micropolisJS at commit `f13a162` (13 July
2025). The engine changes this needed are listed in `CHANGES.md`. The
actions and the budget handling needed none.

The runner must behave like micropolisJS in the browser. `src/` is only
changed when something stops the game from running headless. Game bugs,
also porting bugs from the original Micropolis, are left as they are and
listed under "Known porting bugs" in `CHANGES.md`, with the original
lines.

## Running

Run `npm install` once. It installs `tsx`, which runs the TypeScript files
directly.

```sh
npm run test:headless   # all headless tests (node:test)
npm run bench:headless  # times 20 in-game years
npm run play:headless -- --agent random --seed 3 --level hard --disasters on --out run.json
npm run replay -- run.json  # opens the replay viewer on a run log
```

`play:headless` plays one game and writes its run log. The options are
`--agent` (`random`, `passive` or `demo`), `--seed` for the city, `--agent-seed`
(the city seed if left out), `--level` (`easy`, `medium` or `hard`),
`--disasters` (`on` or `off`), `--turns`, `--months` for the months per
turn, `--max-actions` and `--out`. Left out, they take the defaults of
`runGame`. It prints the final population and funds when it is done.

The tests use `node:test` because the project's Jest setup only covers
`src/` and `test/`. `npm test` still runs the engine's own Jest tests.

## API

Creating, stepping, reading, saving and loading a city is in `runner.ts`.
The actions are in `actions.ts`, the routes in `routes.ts` and the budget
log in `budget.ts`. The game loop is in `game.ts` and the agents are in
`agents/`. The replay viewer is in `viewer/`, and `replay.ts` opens it.

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

After every `forceTick()`, `stepMonths` also moves the sprites 3 times,
see "Sprites" below.

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

## Quotes

```ts
import { quoteBuild, quoteBulldoze } from './actions.ts';

quoteBuild(city, 'residential', 58, 47);
// { success: true, cost: 100, reason: null }, and the city is unchanged
```

Every action has a quote that says what it would do and cost, without
changing the city: `quoteBuild`, `quoteBulldoze`, `quoteSetTaxRate`,
`quoteSetBudgetPercentages` and `quoteSetAutoBudget`. A quote has the
same shape and the same failure reasons as the action. When only the
money is missing, the quote gives `insufficient-funds` with the price, so
the agent knows how much it needs. For any other failure the cost is 0.
Routes have `planRoute` instead, see "Routes".

`quoteBuild` and `quoteBulldoze` work like `planRoute`. They let the
engine's tool prepare the change in its buffer, read the cost and the
result, and clear the buffer. Two tools draw from the shared random
generator in `doTool`, so they are priced from their rules. The park tool
picks the kind of park at random. It only works on bare land and always
costs $10. The bulldozer picks the rubble at random when it clears a zone
or a big building, and it always charges $1 there. Elsewhere the bulldozer
draws nothing and goes through its buffer like the other tools. Quoting
never draws from the generator, so it cannot change a run.

## Routes

```ts
import { planRoute, buildRoute } from './routes.ts';

const plan = planRoute(city, 'road', { x: 58, y: 47 }, { x: 64, y: 47 });
// plan.cost is 72, plan.tiles starts with
// { x: 58, y: 47, cost: 11, kind: 'new' }, { x: 59, y: 47, cost: 11, kind: 'new' }
const result = buildRoute(city, plan);
// { success: true, cost: 72, reason: null }
```

(The numbers are for a new city with seed 12345 on hard.)

`planRoute(city, tool, from, to)` finds the cheapest route for a `road`,
`rail` or `wire` between two tiles, both included. It changes nothing in
the city. The agent decides which places to connect and whether to build.
A route can end on empty land.

Every tile in `plan.tiles` has its cost and a kind. `new` is a tile the
tool lays, `bridge` is a new tile over water, and `existing` already has
a road, rail or power line. Existing tiles cost nothing and are left as
they are. `plan.cost` is the sum.

The prices come from `layRoad`, `layRail` and `layWire` in
`src/roadTool.js`, `src/railTool.js` and `src/wireTool.js`. A tile costs
$10 for road, $20 for rail and $5 for wire, plus $1 where the tool first
clears a tree, rubble or a shore tile. A bridge costs $50, $100 or $25.

A tool can cross a straight line of another kind for the normal price. A
road crosses a straight power line or rail, a rail crosses a straight
road or power line, and a wire crosses a straight road or rail. The
engine always lays the crossing piece at a right angle to the line it
crosses. Traffic and power go through it in all four directions
(`TileUtils.isDriveable` and the power scan), so a route may pass it
either way. Curves, T pieces and intersections of another kind cannot be
crossed. Neither can zones, buildings, fire, flood or radioactive tiles.

A bridge needs a piece next to it that the tool accepts. The engine looks
east, west, south and north in that order, and the first match decides
which way the bridge runs. A route therefore crosses water in a straight
line, cannot turn on water, and can only start on water next to a
matching piece. The sides are not all the same: a road bridge accepts a
horizontal road and power crossing to its east but not to its west. The
original Micropolis has the same rule (`_LayRoad` in `w_con.c`).

The search is Dijkstra on the tile grid, 4-connected. Ties go to the
shorter route, then to the first one found, with the neighbours in a
fixed order, so the same city and endpoints always give the same route.
Existing pieces cost nothing, so a route may follow an existing road if
that is cheaper.

The search knows the rules above, but the cost of a plan comes from the
engine. The tools collect their changes in a buffer and only write them to
the map and take the money in `modifyIfEnoughFunding`. `planRoute` lays
the route into that buffer and clears it again. When the search decides a
bridge it only knows the previous route tile. If an earlier route tile
next to the water turns the bridge the other way, the engine refuses the
next tile. `planRoute` then bans that step and searches again.

`buildRoute(city, plan)` lays the same tiles with the same tool as one
change and pays for it. It builds everything or nothing. The plan keeps
the tiles it depends on: the route tiles, and for a bridge also its four
neighbours. Road tiles are compared without their traffic. If any of them
changed, or the engine now asks a different price, `buildRoute` refuses
the plan as `stale-plan`. The planned cost is exactly what it takes from
the funds.

`planRoute` fails with `unknown-tool` for any other tool,
`invalid-position` for an endpoint off the map, `blocked` when the tool
can never use one of the endpoints, and `no-route` when no route exists.
`buildRoute` fails with `insufficient-funds`, `stale-plan`, or the reason
of a failed plan. A failed `buildRoute` changes nothing.

## Agents and the game loop

```ts
import { runGame, writeRunLog } from './game.ts';
import { passiveAgent } from './agents/passive.ts';

const log = await runGame(passiveAgent, { seed: 1, turns: 8 });
writeRunLog('run.json', log);
```

An agent has a name and a `decide(view)` method. Once per turn it gets a
view of the city and returns a list of actions. An empty list means do
nothing. `decide` may return a promise, so an agent can wait for a
language model. Optional `settings()` and `report()` methods add the
agent's settings to the log, and something of its own to every turn.

The view has `turn`, `maxActions`, `state` (from `getState`), `map` with
`width`, `height` and `getTileValue(x, y)`, the budget log so far,
`quote(action)` and `planRoute(tool, from, to)`. Quotes and plans are
made against the city at the start of the turn, before any of the
agent's own actions.

Actions are plain data, so an agent can write them as JSON:

```ts
{ type: 'build', tool: 'residential', x: 58, y: 47 }
{ type: 'route', tool: 'road', from: { x: 55, y: 49 }, to: { x: 62, y: 49 } }
{ type: 'bulldoze', x: 58, y: 47 }
{ type: 'setTaxRate', rate: 9 }
{ type: 'setBudgetPercentages', road: 100, fire: 80, police: 60 }
{ type: 'setAutoBudget', enabled: false }
```

The build tools are the ones in `BUILD_TOOLS`, so a single road, rail or
wire tile can also be built. A route is planned again when it is applied,
so earlier actions of the same turn count. Anything else fails with
`unknown-action`, and fields of the wrong type fail in the action itself.

`runGame(agent, options)` creates the city from `seed`, `level` and
`disasters`. Each turn it asks the agent, applies the actions in order,
and steps the city `monthsPerTurn` months. Actions past
`maxActionsPerTurn` are dropped and counted. The defaults are provisional
until the experiment is designed:

- `level`: easy, and `disasters`: off, as a new game in the browser
- `turns`: 80 and `monthsPerTurn`: 3, so 20 years
- `maxActionsPerTurn`: 5

The run log has the options, the agent's name and settings, the map at
the start, one entry per turn and the final state with the city hash.
Each turn has the date and the state the agent saw, the map changes since
the turn before, the actions with their results, the number of dropped
actions, the budget windows answered while the city ran, and the agent's
report. A route action also has `tiles`, the `[x, y]` tiles of its plan.
A route that failed for lack of money keeps them too.

The map is stored row by row as raw tile values, with the flag bits of
`src/tileFlags.ts`, for example power and zone centre. Every turn stores
a list of `[index, value]` changes, so a replay can rebuild the map of
any turn. The agent's view gives the tile number without the flags, like
`getTileValue` in the engine. A 20 year log is about 70 kB for the
passive agent and 95 to 120 kB for the random and the demo agent.
`recordMap: false` leaves the map out.

The log has a `version`, now 2. Version 1 logs had tile numbers without
the flags and no route tiles.

`agents/passive.ts` has the passive agent, which does nothing.

## Random agent

```ts
import { createRandomAgent } from './agents/random.ts';

const log = await runGame(createRandomAgent({ seed: 7 }), { seed: 1 });
```

Each turn the random agent takes a random number of slots, from 0 to the
maximum number of actions. For each slot it first picks a category: a
building or zone (any build tool except road, rail and wire), a route
(road, rail or wire), bulldozing, the tax rate, the budget percentages,
auto budget, or nothing. The weights are equal unless `weights` says
otherwise. Then it draws the parameters, all uniform: a tile anywhere on
the map for a building or for bulldozing, a tax rate from 0 to 20, and
percentages from 0 to 100.

A route starts where it can connect to something: on a piece of the same
kind (road for a road, rail for a rail, a power line for a wire), or on a
tile next to a zone or building. `routeStarts` lists those tiles, and the
start is drawn uniformly from the list. While the city has none for that
tool, as in the first turns, the start can be any tile. The end is any
tile at most `maxRouteDistance` from the start (Manhattan distance, 20 by
default), empty land included.

The rule belongs to the random agent only. `planRoute` and the route
action accept any two tiles for every agent. A road that connects to
nothing stays a mistake another agent can make, and the experiment can
count it.

It only plays valid actions. It quotes every draw, or plans it for a
route, and draws again when the quote fails, up to `maxTries` times (20
by default). It also keeps aside the money its earlier actions of the
turn will spend. Its report in every turn of the log has the number of
slots, the slots that picked nothing, the draws, the rejected draws by
reason, and the slots where it gave up. Actions are quoted against the
city at the start of the turn, so one can still fail when it is applied
after another, for example two buildings on the same site.

It has its own random generator in `rng.ts`, seeded with `seed`. It is
the same mulberry32 as the game's, with its own state, so the agent's
draws never move the game's sequence. The park tool and the bulldozer
still draw from the game's generator when one of their actions is
applied. A run stays reproducible, since the same seeds give the same
actions at the same points.

## Demo agent

```ts
import { createDemoAgent } from './agents/demo.ts';

const log = await runGame(createDemoAgent(), { seed: 1 });
```

The demo agent builds the same small town on every map, so the replay
viewer has a city that grows. It is not one of the baselines and takes no
part in the experiments.

On its first turn it picks a site of 31 by 14 tiles of bare land, shore,
trees or rubble, the one closest to the centre of the map. The plan is
fixed, in tiles from the corner of the site. In the first year it builds
a coal plant, a power line, a street and eight zones. A police and a fire
station follow in year 3 and six more zones in year 4. A second street
with eight zones comes in year 6, and six more zones with a second police
and fire station in year 8. It builds up to the action limit of the turn,
waits while money is short, and skips a step the engine refuses.

With the default options the town has between 5,800 and 9,500 people
after 20 years on seeds 1 to 10, except seed 3. That map is islands, no
site fits, and the town never gets power.

## Replay viewer

```sh
npm run replay -- run.json  # a log from play:headless or writeRunLog
npm run replay              # plays a game with the demo agent and shows it
```

`replay.ts` starts a small server on 127.0.0.1 and opens the viewer in
the browser. It prints the address. `--port` picks the port and
`--no-open` leaves the browser closed. The log is read again on every
reload. The page is in `viewer/` and has no build step. It loads nothing
from the internet, so it works offline. Another log can be opened with
Open log or dropped on the page. The page needs the server, because
browsers do not load its JavaScript modules from a `file://` address.

The map is drawn with `images/tiles.png`, the tile sheet of the browser
game. Each raw value is masked with `BIT_MASK` to get the tile number, as
the engine does. A zone centre without power shows the lightning bolt the
browser blinks there, without the blinking. The Unpowered zones checkbox
turns it off. Nothing else is animated either.

The timeline has a slider, buttons to step one turn back and forward,
and Play with a speed from 0.5 to 16 turns per second. The arrow keys
step, Home and End jump to the start and the end, and Space plays and
pauses. The wheel zooms around the pointer, dragging pans, and Fit shows
the whole map again.

Each turn shows the map the agent saw at the start of the turn. With Map
after the turn it shows the map at the start of the next turn instead,
with the new buildings. The actions of the turn are marked on the map
with their number. A building or a bulldozed tile is outlined over its
site, and a route is drawn along its tiles. Successful actions are solid
green, failed ones dashed red with their reason. A route without a plan
is drawn as a straight line between its ends. The list on the left has
every action of the turn with its cost or its reason. Clicking an action
in the list or on the map selects it, fades the others and brings it
into view.

The panel on the right has the state at the start of the turn: date,
funds, population, score, city class, approval, tax rate, powered zones,
RCI demand and the seven problems, then the budget windows answered
during the turn and the agent's report. Two line charts show the
population and the funds over the whole game with a marker at the turn.
Clicking a chart jumps to that point. Hovering a tile shows its
coordinates and what it is. The kind comes from the tile ranges of the
query tool (`classifyZone` in `src/queryTool.js`). A detail is added
where the tile number says more, like shore, bridge, traffic, empty zone,
hospital or church, and the flags add the zone centre and the power. The
top bar has the agent, the seeds, the level, the disasters option, the
months per turn, the number of turns and the action limit.

Tornadoes, monsters, planes, helicopters, ships and trains are sprites,
and sprites are not in the log. The viewer cannot show them and says so
on the map. The damage they do is in the tiles.

`viewer/replay.js` rebuilds the map of a turn from the first map and the
changes. It keeps a full copy every 16 turns, so a jump replays at most
15 turns of changes. In Chrome a jump takes about 1.4 ms with the
drawing. `test/replay.test.ts` plays the demo town for 10 years, plays
the same city again from the actions in the log, and checks that the map
rebuilt for every turn matches the real map at that turn, flags
included. It takes the turns in an order that jumps around. The numbers
the viewer needs from `src/tileValues.ts` and `src/tileFlags.ts` are
copied into `viewer/tiles.js`, because the browser cannot load the
TypeScript files. The test checks them against the engine.

Version 1 logs open too. They have no flags, so no power is shown, and
their routes are straight lines between the ends.

## Budget window

The game has no bankruptcy. Once a year, in January, the engine collects
the taxes and pays for roads, fire and police. If the funds and the taxes
together do not cover that, it lowers the three percentages to what the
city can afford. Roads are paid first, then fire, then police. It then
turns auto budget off, shows "YOUR CITY HAS GONE BROKE" and opens the
budget window, and the simulation waits until the player answers. Funds
never go below 0, and tools refuse to build without money.

`stepMonths` answers that window the way a player does who presses OK
without changing anything. The browser shows each percentage floored to a
whole number (`handleBudgetRequest` in `src/game.js`), and OK writes those
numbers back divided by 100 before it calls the engine's `doBudgetWindow`
(`handleBudgetWindowClosure`). `stepMonths` does the same and goes on. It
adds no rule of its own and nothing ends the game.

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

The flooring only matters when a percentage has a fraction, like 0.052,
or falls just under a whole number in floating point, like 0.29, which
`Math.floor(0.29 * 100)` turns into 28. In the test cities it changed no
record of the log.

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
50. The first year of a new city is different: the constructor sets the
census population to 1, so the extra evaluation on the first tick runs in
full. With the test seed an empty city shows a score of 701 and approval
63 until the first January.

Score, approval and the problem values change once a year, at the
evaluation in January. Population changes every month, because the
monthly growth check recomputes it. That check also sets the change in
population that the score uses, so the score sees the change over the last
month, not over the year (see "Things to keep in mind").

`_valves`, `_census` and `_map` are private fields of the engine, and
`_constructSimData` is a private method. The underscore is only a naming
convention there, and adding getters to the engine just for this seemed
unnecessary. `engine.ts` is the only file that uses them, and it also
keeps the engine's tools for each city.

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
city and the same budget log twice. `test/sprites.test.ts` puts a tornado
on the developed city and checks that it moves, that it destroys road and
that the same run twice gives the same city every month.

On an empty map only the disaster code and the sprites use random
numbers. With the test seed, only 31 of the 12,000 tiles change in 20
years. That is why the developed city test exists. It places a coal plant,
a road, zones on both sides and a power line with `build`, so growth,
traffic, power and the budget run as well. The test also checks that the
population grew, otherwise it would prove nothing. The developed city has
disasters off. Its coal plant pushes average pollution above 60, and with
disasters on a monster appears in month 28 and destroys the power supply.

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

Sprites are not part of the save data. A tornado, monster, train, plane,
helicopter, ship or explosion that exists when the city is saved is gone
after loading. The browser loses them in the same way.

## Sprites

Tornadoes, monsters, trains, planes, helicopters, ships and explosions are
sprites. They only move in `SpriteManager.moveObjects()`, and they do all
their damage while moving: a tornado or monster destroys the tile under
it, and an explosion starts its fires when it ends. The browser calls
`moveObjects()` once per animation frame in `src/game.js`, never in the
simulation tick, so how often sprites move per phase depends on the
screen's frame rate.

`stepMonths` calls `moveObjects()` 3 times after every `forceTick()`,
through `moveSprites` in `engine.ts`. At the default medium speed the
browser runs a phase every 50 ms, and a 60 Hz screen draws a frame about
every 17 ms, so a player sees 3 moves per phase. The original game also
makes 3 at medium speed: it calls `MoveObjects()` on every pass of its
loop (`sim_loop` in `sim.c`), and `SimFrame()` in `s_sim.c` runs a phase
only on every third pass. The sprites take
numbers from the shared random generator, so the runs stay reproducible.

Without this, a tornado stayed where it appeared for good and changed no
tile. With it, a tornado placed on the developed city crossed it and left
the map within 5 months.

## Performance

`npm run bench:headless` advances a hard city with disasters on for 20
years. Over five runs it took between 123 and 131 ms, about 6.3 ms per
year, measured with Node 24.14.1 on an AMD Ryzen 9 7900X3D on Windows 11.
Before the sprites moved it took between 122 and 132 ms on the same
machine, so moving them costs nothing measurable. The map is empty, so a
developed city does more work per tick and will be slower.

## Things to keep in mind

The score has three porting bugs, left as they are and described in
`CHANGES.md` under "Known porting bugs". Police and fire funding never
change it: the penalty reads constant names that `Budget` does not
define. Any drop in population in the last month before January halves
it. And it rounds where the original cuts toward zero, and caps the
problems at 250 instead of 256. For an agent this means the score rewards
a population that does not dip just before January more than it rewards
good services, and it is noisy from year to year.

The disasters have six more, also described there. A flood can start on
any bulldozable tile next to water but never on bare land without flags.
Planes never collide. An explosion lights only its own tile instead of
that tile and the four diagonal neighbours. Ships wreck on land with
disasters off. Fire never spreads. And a burning or flooded zone marks
the wrong tiles bulldozable.

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
