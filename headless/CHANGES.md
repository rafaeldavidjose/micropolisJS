# Changes outside headless/

Each change is its own commit so I can cite it on its own.

## Rule

The headless runner must behave like micropolisJS in the browser. `src/`
is only changed when something stops the game from running headless, as
in changes 1 to 4 below. Game bugs, porting bugs from the original
Micropolis included, are documented under "Known porting bugs" at the end
and left as they are.

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

### Disasters: fire never spreads

A burning tile should set its burnable neighbours on fire. `fireFound` in
`src/miscTiles.js` reads the tile at `x, y`, the burning tile itself,
instead of the neighbour at `xTem, yTem`. A fire tile has no burn flag, so
the check always fails and fire never spreads. A fire set in the middle of
a forest is still a single tile after 6 months. The rest of that block is
never reached and has three more bugs: `fireZone` is called with `x, y`,
`map.setTo(tileUtils.randomFire())` has no coordinates and `tileUtils` is
not defined in the file, and `makeExplosionAt`, which takes pixels, gets
tile coordinates.

The original, `s_sim.c` lines 927 to 944:

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

### Disasters: a burning zone

`fireZone` in `src/zoneUtils.js` differs from the original `FireZone`,
`s_sim.c` lines 958 to 984. The check
`map.getTileValue(xTem, yTem >= TileValues.ROADBASE)` has a misplaced
parenthesis, so it passes a boolean as `y` and marks the wrong tiles as
bulldozable. The original:

```c
      if ((short)(Map[Xtem][Ytem] & LOMASK) >= ROADBASE) /* post release */
	Map[Xtem][Ytem] |= BULLBIT;
```

The port also uses a zone size of 3 instead of 4 for ports and the other
large buildings, and clamps the growth rate where the original does not.
Spreading floods (`doFlood`) reach it, and tornadoes and monsters through
`destroyMapTile`. The call in `fireFound` is never reached, because fire
does not spread.
