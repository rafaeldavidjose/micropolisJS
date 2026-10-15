# Changes outside headless/

This fork is based on graememcc/micropolisJS at commit `f13a162`
(13 July 2025). Each change is its own commit so I can cite it on its own.

## Rule

The headless runner must behave like micropolisJS in the browser. `src/`
is only changed when something stops the game from running headless, as
in changes 1 to 4 below. Game bugs, porting bugs from the original
Micropolis included, are documented under "Known porting bugs" at the end
and left as they are. The exception is a bug that removes part of what the
experiment measures, like the crime scan and the traffic in changes 5
and 6, and fire in changes 9 and 10.

## Engine changes

### 1. src/boatSprite.js: removed an unused, broken import

Commit `2de86a3`.

`boatSprite.js` imported `SpriteConstants` from `spriteConstants.ts`, but
that file has no such export. It only exports single constants like
`SPRITE_SHIP`. The import was never used. Webpack ignores it, but Node
refuses to load a module with a named import that does not exist, so
`Simulation` could not be created in Node at all. Removing the line
changes nothing in the browser build.

### 2. src/simulation.js: `budget` changed to `this.budget` in the census calls

Commit `75c8115`.

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
`cashFlow` from it, got `undefined`, and stored `NaN` in the money history.
I have not checked this in a browser.

Either way the fix does not change the simulation. `budget` is only used
for `moneyHist10`, which `take120Census` copies into `moneyHist120`.
Nothing in micropolisJS reads either array. They are saved with the city,
and in the original they feed the graphs, which micropolisJS never
implemented (`// TODO Graphs` in `simTick`).

### 3. src/random.ts: optional seeded generator

Commit `5535b57`.

I added a mulberry32 generator with `Random.setSeed(seed)`,
`Random.getSeed()` and `Random.clearSeed()`. When a seed is set,
`getRandom` uses it by default, otherwise it uses `Math` as before. The
default is evaluated on every call, and all other `Random` functions go
through `getRandom`, so they are all seeded without changes of their own.
With no seed set the behavior is the same as before. Calls that pass their
own generator, like the Jest tests in `test/random.ts`, are not affected,
and those tests still pass.

### 4. src/simulation.js: added `forceTick()`

Commit `7c23414`.

`_simFrame` only advances the simulation when enough real time has passed,
using `new Date()`. For headless runs I need to step without a clock.
`forceTick()` has the same checks as `_simFrame` for a paused game and for
a budget waiting for input, then calls `_simulate` and `_updateTime`
directly. It is a new method, so `simTick`, `_simFrame` and the browser
loop are unchanged.

### 5. src/blockMapUtils.js: the crime scan never ran

Commit `89b67ce`.

`crimeScan` looped to `crimeRateMap.mapWidth` and `crimeRateMap.mapHeight`.
`BlockMap` in `src/blockMap.ts` has no such fields. It has `gameMapWidth`
and `gameMapHeight`, so both limits were `undefined`, the loop never ran
and `census.crimeAverage` stayed 0. No city had any crime, police stations
did nothing, and crime never lowered land value. The loop now uses
`gameMapWidth` and `gameMapHeight`, as `getTrafficAverage` in
`src/evaluation.js` already does.

The same loop read the police map after two of its three smoothing passes.
`crimeScan` smooths `policeStationMap` into `policeStationEffectMap` and
back, three passes in all, so the result of the third is in
`policeStationEffectMap`. The loop now subtracts that one. The original
smooths `PoliceMap` in place three times and uses the result, `s_scan.c`
lines 307 to 320:

```c
  SmoothPSMap();
  SmoothPSMap();
  SmoothPSMap();
  totz = 0;
  numz = 0;
  cmax = 0;
  for (x = 0; x < HWLDX; x++)
    for (y = 0; y < HWLDY; y++) {
      if (z = LandValueMem[x][y]) {
	++numz;
	z = 128 - z;
	z += PopDensity[x][y];
	if (z > 300) z = 300;
	z -= PoliceMap[x >>2][y >>2];
```

`crimeScan` in MicropolisCore (`scan.cpp`) does the same. The original also
keeps the block with the most crime (`CrimeMaxX` and `CrimeMaxY`) and
draws a random number on ties. Nothing in the simulation reads it and the
port never had it, so I left it out.

In the developed test city crime is now 13 or 14 in the first two years,
and 11 with a police station on the site of one of its zones.
`headless/test/crime.test.ts` checks both.

### 6. src/traffic.js: no trip ever reached its destination

Commit `3d78124`.

`Traffic.tryDrive` had three errors from an upstream refactor in 2018
(commit `d8fb7ce`, "Stop using bounds-checked positions"). It made its
first position with `new Position(startPos)`, but the constructor takes
`x` and `y`, so `x` was the start object and `y` was `undefined`. Every
neighbour of that position was off the map, `tryGo` found no road, and the
trip ended at once as `NO_ROUTE_FOUND`. Had a road been found,
`Position.move(pos, dir)` would have thrown, since that function has no
`pos`. And the positions saved along the way, `new Position(drivePos)`,
had the first error again, so `addToTrafficDensityMap` would have skipped
them all as off the map. So the traffic density map stayed empty, road
tiles never showed traffic, and the traffic problem was always 0.
`tryDrive` now copies the start's `x` and `y`, moves from `drivePos`, and
saves `drivePos` itself, since a `Position` never changes once made.

Two more differences in the same code kept trips from working like the
original.

Since upstream commit `a301c41` (2018), `tryGo` picked among the open
directions with equal chances. The original starts at a random direction
and takes the first open one clockwise from it, `s_traf.c` lines 224 to
245:

```c
  rdir = Rand16() & 3;
#endif
  for (x = rdir; x < (rdir + 4); x++) {	/* for the 4 directions */
    realdir = x & 3;
    if (realdir == LDir) continue;	/* skip last direction */
    if (RoadTest(GetFromMap(realdir))) {
      MoveMapSim(realdir);
      LDir = (realdir + 2) & 3;
      if (z & 1)			/* save pos every other move */
	PushPos();
      return (TRUE);
    }
  }
  return (FALSE);
```

The first version of the port did the same, and so does `tryGo` in
MicropolisCore (`traffic.cpp`), which draws no random number when only
one direction is open. `tryGo` does that again now.

The zones also passed narrower destinations than the original. A trip
from a residential zone could only end next to a commercial tile, one
from a commercial zone next to an industrial tile, and one from an
industrial zone next to a residential tile, empty zone tiles included. The
original takes ranges of tile numbers, `s_traf.c` lines 277 and 278:

```c
  static short TARGL[3] = {COMBASE, LHTHR, LHTHR};
  static short TARGH[3] = {NUCLEAR, PORT, COMBASE};	/* for destinations */
```

indexed by `MakeTraf(0)` for a residential zone, `MakeTraf(1)` for a
commercial one and `MakeTraf(2)` for an industrial one (`s_zone.c` lines
239, 200 and 169). A residential trip ends at shops, industry and every
building up to the nuclear plant. A commercial trip ends at houses,
hospitals, churches, shops, industry and the port. An industrial trip
ends at houses, hospitals and churches. MicropolisCore has the same
ranges. `Traffic.endsResidentialTrip`, `endsCommercialTrip` and
`endsIndustrialTrip` hold them now, and `src/residential.js`,
`src/commercial.js` and `src/industrial.js` pass them.

`addToTrafficDensityMap` follows MicropolisCore and is unchanged. It caps
the density at 240 every time and sends the helicopter in one case out of
five. The original only caps it in that one case and lets it go past 240
otherwise, which overflows its byte map.

A zone still treats only "no road" as a failed trip, as in the original,
so the fix does not change growth directly. It acts through the density.
Busy road tiles show light and heavy traffic, heavy traffic counts double
for road maintenance, traffic tiles add pollution, and the traffic problem
is above 0. In the demo town on seed 1, 16 of its 44 road tiles show
traffic after 10 years and the traffic problem is 26.
`headless/test/traffic.test.ts` checks a trip and the density.

### 9. src/miscTiles.js: fire never spread

Commit `fe8c6f6`.

A burning tile tries to set each of its four neighbours on fire.
`fireFound` read the tile at `x, y`, the burning tile itself, instead of
the neighbour at `xTem, yTem`. A fire tile has no burn flag, so the check
always failed and fire never spread: a fire set in the middle of a forest
burnt out as a single tile. The rest of that block was never reached and
had three more bugs. `fireZone` was called with `x, y`.
`map.setTo(tileUtils.randomFire())` had no coordinates, and `tileUtils` is
not defined in the file, whose import is `TileUtils`, so the line would
have thrown. And `makeExplosionAt`, which takes pixels, got tile
coordinates.

The block now reads the neighbour, passes it to `fireZone`, sets it on fire
with `map.setTo(xTem, yTem, TileUtils.randomFire())`, and puts the
explosion at `(xTem << 4) + 8, (yTem << 4) + 8`. That is the original,
`s_sim.c` lines 927 to 944:

```c
  for (z = 0; z < 4; z++) {
    if (!(Rand16() & 7)) {
      Xtem = SMapX + DX[z];
      Ytem = SMapY + DY[z];
      if (TestBounds(Xtem, Ytem)) {
	c = Map[Xtem][Ytem];
	if (c & BURNBIT) {
	  if (c & ZONEBIT) {
	    FireZone(Xtem, Ytem, c);
	    if ((c & LOMASK) > IZB)  { /*  Explode  */
	      MakeExplosionAt((Xtem <<4) + 8, (Ytem <<4) + 8);
	    }
	  }
	  Map[Xtem][Ytem] = FIRE + (Rand16() & 3) + ANIMBIT;
	}
      }
    }
  }
```

`doFire` in MicropolisCore (`simulate.cpp`) is the same. The rest of
`fireFound` already matched both: it runs one time in four (`s_sim.c`
line 709), and the fire goes out with a chance that depends on the fire
station map, 1 in 2 above 100, 1 in 3 above 20, 1 in 4 above 0 and 1 in
11 with no station near (lines 945 to 953). The four bugs are in the same
few lines and only make sense fixed together, so they are one change.

Fire stations did almost nothing without it, since a fire went out on its
own before it could grow, so this falls under the same exception as
changes 5 and 6. `headless/test/fire.test.ts` lights the middle of a
forest on five maps. A year later 102 tiles have burnt in all, and 13 with
a powered fire station north of the forest. Before the fix it was one tile
for each fire in both cases.

### 10. src/zoneUtils.js: a burning zone marked the wrong tiles

When a fire, a flood, a tornado or a monster reaches the centre of a zone
or a building, `fireZone` lowers the growth rate there and marks the other
tiles of the zone bulldozable, so the ruin can be cleared. Its check
`map.getTileValue(xTem, yTem >= TileValues.ROADBASE)` had a misplaced
parenthesis. It passed a boolean as `y`, read a tile in the top row of the
map, and marked a tile of the zone only when that far tile was not bare
land. In the test city none of them was marked, and the ruin of a burnt
zone could not be bulldozed. The check now compares the tile itself, as in
the original, `s_sim.c` lines 981 and 982:

```c
      if ((short)(Map[Xtem][Ytem] & LOMASK) >= ROADBASE) /* post release */
	Map[Xtem][Ytem] |= BULLBIT;
```

The port also used a zone size of 3 for the seaport, the power plants and
the other buildings of 4 by 4 tiles, where the original uses 4, lines 965
to 972:

```c
  ch = ch & LOMASK;
  if (ch < PORTBASE)
    XYmax = 2;
  else
    if (ch == AIRPORT)
      XYmax = 5;
    else
      XYmax = 4;
```

The loop runs from -1 to below that size. 2 covers a zone of 3 by 3 tiles
and 5 an airport of 6 by 6, but 4 covers the 4 by 4 building and one more
column and row. That only matters where another zone or building stands
there, since roads, rails, power lines and parks can be bulldozed anyway.
The port's 3 matched the building exactly. Both now follow the original
and `fireZone` in MicropolisCore (`simulate.cpp`). MicropolisCore clamps
the growth rate to -200 and 200 like the port, where the original does
not, and the clamp stays.

With fire spreading since change 9, fires reach zones and buildings, so
this falls under the same exception. In `headless/test/fire.test.ts` a
zone set on fire with `fireZone` can be bulldozed on all of its tiles, and
a burning coal plant marks its own 16 tiles and the edge of the zone next
to it. Before the fix neither held.

## Configuration changes

### 7. tsconfig.json: `include` limited to src/ and test/

Commit `3120301`.

`tsconfig.json` had no `include`, so TypeScript picked up every `.ts` file
in the project, including `headless/`. `ts-loader` type checks the whole
program, even files that webpack never bundles. The `.ts` extensions in
the headless imports need `allowImportingTsExtensions`, which the project
does not enable, so `npm run build` failed with `TS5097`. With `headless/`
moved away the build worked, with only the bundle size warnings it already
had. Limiting `include` to `src/` and `test/` fixed it without affecting
the build or Jest.

### 8. jest.config.js renamed to jest.config.cjs

Commit `9fa0f34`.

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
- Sprites are not in the save data. A tornado, monster, train, plane,
  helicopter, ship or explosion that exists when the city is saved is gone
  after loading. The browser loses them in the same way.

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

## Known porting bugs

These differ from the original Micropolis C code, the
`micropolis-activity/src/sim` folder of
https://github.com/SimHacker/micropolis (line numbers are from commit
`c98f6b0`). Under the rule at the top they are left as they are, so the
headless runner behaves like micropolisJS in the browser.

### Score: police and fire funding have no effect

`getScore` in `src/evaluation.js` reads `budget.MAX_POLICE_STATION_EFFECT`
and `budget.MAX_FIRE_STATION_EFFECT`, the names MicropolisCore uses, but
`Budget` defines `MAX_POLICESTATION_EFFECT` and `MAX_FIRESTATION_EFFECT`.
A comparison with `undefined` is always false, so the penalty for
underfunded police and fire is never applied. The "fire department needs
funding" and "police department needs funding" messages in
`_sendMessages` in `src/simulation.js` use the same names and never
appear.

The original applies both, `s_eval.c` lines 298 and 299:

```c
  if (PoliceEffect < 1000) z = z * (.9 + (PoliceEffect / 10000.1));
  if (FireEffect < 1000) z = z * (.9 + (FireEffect / 10000.1));
```

and sends both messages, `s_msg.c` lines 172 to 178:

```c
  case 57:
    if ((FireEffect < 700) && (TotalPop > 20))
      SendMes(18);
    break;
  case 60:
    if ((PoliceEffect < 700) && (TotalPop > 20))
      SendMes(19);
```

A developed city with one police and one fire station has the same score
every year for 20 years with both funded at 0% and at 100%. With the
penalty applied as in the original, the 0% city scores 5 to 20% lower.
Funding still acts on the score indirectly, through crime and fires.

### Score: a drop in population halves it

Two bugs in how the score reacts to a change in population.

`getScore` scales a shrinking city by
`0.95 + Math.floor(delta / (pop - delta))`. The fraction is between -1 and
0, so `Math.floor` always gives -1, the factor is -0.05 and the computed
score is clamped to 0. The stored score, the average of the old score and
the new one, is halved.

The change is measured over one month. The monthly growth check in
`_checkGrowth` calls `evaluation.getPopulation`, and that function also
sets `cityPopDelta`. So the yearly evaluation sees the change since the
last growth check, not since the last evaluation. Any drop in the last
month before January halves the score.

The original has no floor, `s_eval.c` lines 304 to 313:

```c
  SM = 1.0;
  if ((CityPop == 0) || (deltaCityPop == 0))
    SM = 1.0;
  else if (deltaCityPop == CityPop)
    SM = 1.0;
  else if (deltaCityPop > 0)
    SM = ((float)deltaCityPop/CityPop) + 1.0;
  else if (deltaCityPop < 0)
    SM = .95 + ((float) deltaCityPop/(CityPop - deltaCityPop));
  z = z * SM;
```

and only the evaluation sets the change, in `DoPopNum`, `s_eval.c` lines
146 to 151, called from `CityEvaluation` at line 87:

```c
  OldCityPop = CityPop;
  CityPop = ((ResPop) + (ComPop * 8L) + (IndPop *8L)) * 20L;
  if (OldCityPop == -1) {
    OldCityPop = CityPop;
  }
  deltaCityPop = CityPop - OldCityPop;
```

The growth check keeps its own variable, `s_msg.c` lines 196 and 209:

```c
    ThisCityPop = ((ResPop) + (ComPop * 8L) + (IndPop * 8L)) * 20L;
    ...
    LastCityPop = ThisCityPop;
```

Over 10 seeds and 30 years, the evaluation saw a drop in 55 of 203
Januaries of the developed test city and 50 of 232 of a larger grid city.
The score halved exactly in 103 of the 105 cases. In the other 2 the
census population, which counts residents in eighths, was 0, so the
evaluation reset the score to 500. A drop of 20 people in 6,940 is enough
to halve it.

### Score: rounding and the 250 cap

The original keeps the score in an `int` and the problem values in
`short ProblemTable[PROBNUM]` (`s_eval.c` line 70), so every step cuts the
result toward zero. The port rounds with `Math.round` and keeps housing
and traffic as fractions. It also caps the problem sum at 250 instead of
256, and divides the police and fire penalty by 10000 instead of 10000.1
(which only matters once that penalty works). The original, `s_eval.c`
lines 287 to 292:

```c
  x = x / 3;			/* 7 + 2 average */
  if (x > 256) x = 256;

  z = (256 - x) * 4;
  if (z > 1000) z = 1000;
  if (z < 0 ) z = 0;
```

line 325:

```c
  CityScore = (CityScore + z) / 2;
```

and the problem values, lines 172, 174, 238 and 255:

```c
  ProblemTable[2] = LVAverage * .7;		/* Housing */
  ProblemTable[4] = AverageTrf();		/* Traffic */
  TrafficAverage = (TrfTotal / count) * 2.4;
  b = (r - 1) * 255;
```

With the 250 cap the base score is 24 points lower than the original for
the same problems, before the other steps. The first-year score of an
empty city is 701 here and 712 with the original rules.

### Disasters: where a flood can start

`makeFlood` in `src/disasterManager.js` checks the tiles next to water
with:

```js
if (tile === TileValues.DIRT || (tile.isBulldozable() && tile.isCombustible)) {
```

`tile` is a `Tile` object, so comparing it with the number `DIRT` is
always false. `tile.isCombustible` has no parentheses, so it is the
function itself and always true. A flood can therefore start on any
bulldozable tile next to water, and never on bare land without flags.

The original, `s_disast.c` lines 277 to 279, floods a tile that is bare
land with no flags, or both bulldozable and burnable:

```c
	  c = Map[xx][yy];
	  /* TILE_IS_FLOODABLE(c) */
	  if ((c == 0) || ((c & BULLBIT) && (c & BURNBIT))) {
```

On the map of the test seed, 7,615 of the 8,110 bare land tiles have no
flags, and so does a bulldozed tile. On the benchmark city, 31 tiles
change in 20 years. With the original rule floods start much more often
and 313 change.

### Disasters: planes never collide

The plane only checks for collisions when disasters are on, but
`src/airplaneSprite.js` reads `disasterManager.enableDisasters`. The field
is `disastersEnabled`, so the check reads `undefined` and planes never
collide with other planes or helicopters, in the browser too. The
original, `w_sprite.c` lines 811 to 828:

```c
  /* deh added test for !Disasters */
  if (!NoDisasters) {
    SimSprite *s;
    int explode = 0;

    for (s = sim->sprite; s != NULL; s = s->next) {
      if ((s->frame != 0) &&
	  ((s->type == COP) ||
	   ((sprite != s) &&
	    (s->type == AIR))) &&
	  CheckSpriteCollision(sprite, s)) {
	ExplodeSprite(s);
	explode = 1;
      }
    }
    if (explode)
      ExplodeSprite(sprite);
  }
```

### Disasters: an explosion lights only its own tile

When an explosion ends, `src/explosionSprite.js` calls `startFire` five
times with a position in pixels. `startFire` ignores its arguments and
uses the sprite's own tile (`x = this.worldX; y = this.worldY;`), so all
five calls light the same tile. The list of positions also has
`(x + 16, y + 16)` twice and no `(x + 16, y - 16)`.

The original lights the explosion's own tile and its four diagonal
neighbours, `w_sprite.c` lines 1131 to 1138:

```c
  if (sprite->frame > 6) {
    sprite->frame = 0;

    StartFire(sprite->x + 48 - 8, sprite->y + 16);
    StartFire(sprite->x + 48 - 24, sprite->y);
    StartFire(sprite->x + 48 + 8, sprite->y);
    StartFire(sprite->x + 48 - 24, sprite->y + 32);
    StartFire(sprite->x + 48 + 8, sprite->y + 32);
```

with the sprite placed 40 pixels left and 16 up from the explosion point
(`MakeExplosionAt`, lines 1637 to 1640) and `StartFire` turning pixels
into tiles (`x >>= 4; y >>= 4;`, lines 1487 and 1488).

### Disasters: ships wreck with disasters off

A ship that finds no water to sail on explodes and destroys the tile under
it. `src/boatSprite.js` does this whether disasters are on or off. The
original only does it with disasters on, `w_sprite.c` lines 897 to 909:

```c
  if (SpriteNotInBounds(sprite)) {
    sprite->frame = 0;
    return;
  }
  if (!NoDisasters) {
    for (z = 0; z < 8; z++) {
      if (t == BtClrTab[z]) break;
      if (z == 7) {
	ExplodeSprite(sprite);
	Destroy(sprite->x + 48, sprite->y);
      }
    }
  }
```
