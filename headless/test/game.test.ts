// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCity, getState, stepMonths, Simulation } from '../runner.ts';
import { getMap, getValves } from '../engine.ts';
import { hashCity } from '../hash.ts';
import { applyAction, runGame, writeRunLog } from '../game.ts';
import { passiveAgent } from '../agents/passive.ts';
import { createDemoAgent } from '../agents/demo.ts';
import { Random } from '../../src/random.ts';
import { FREEZ, POWERPLANT } from '../../src/tileValues.ts';
import type {
  ActionResult,
  Agent,
  AppliedAction,
  BlockMapLike,
  BlockMapView,
  CityView,
  GameAction,
  GameOptions,
  MapLike,
  RunLog,
  SimulationLike,
  SpriteRecord,
  SpriteSample,
  TurnLog,
  ValvesLike,
  ZoneView,
} from '../types.ts';

const SEED: number = 20260926;

// With this seed the land around 58, 47 is clear, see actions.test.ts
const FIRST_TURN: GameAction[] = [
  { type: 'build', tool: 'residential', x: 58, y: 47 },
  { type: 'build', tool: 'coal', x: 50, y: 45 },
  { type: 'route', tool: 'wire', from: { x: 53, y: 46 },
    to: { x: 56, y: 47 } },
  { type: 'route', tool: 'road', from: { x: 55, y: 49 },
    to: { x: 62, y: 49 } },
  { type: 'setTaxRate', rate: 9 },
  { type: 'setBudgetPercentages', road: 100, fire: 80, police: 60 },
  { type: 'setAutoBudget', enabled: false },
  { type: 'bulldoze', x: 58, y: 47 },
];

const BROKEN: unknown[] = [
  { type: 'fly', x: 1, y: 1 },
  { type: 'build', tool: 'castle', x: 58, y: 47 },
  { type: 'route', tool: 'road', from: { x: 'a', y: 1 }, to: { x: 2, y: 2 } },
  { type: 'setTaxRate', rate: '9' },
  null,
];

// Plays the given actions on the first turn and nothing after
function scriptedAgent(actions: unknown[]): Agent {
  return {
    name: 'scripted',
    decide: (view: CityView): GameAction[] =>
      view.turn === 0 ? actions as GameAction[] : [],
  };
}

function readBlocks(blockMap: BlockMapLike | BlockMapView): number[] {
  const values: number[] = [];

  for (let blockY: number = 0; blockY < blockMap.height; blockY++) {
    for (let blockX: number = 0; blockX < blockMap.width; blockX++) {
      values.push(blockMap.get(blockX, blockY));
    }
  }

  return values;
}

function readTiles(map: MapLike): number[] {
  const tiles: number[] = [];

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      tiles.push(map.getTile(x, y).getRawValue());
    }
  }

  return tiles;
}

test('game: a passive run is the same as stepping the city',
  async (): Promise<void> => {
  const log: RunLog = await runGame(passiveAgent, {
    seed: SEED, level: Simulation.LEVEL_HARD, disasters: true,
    turns: 8, monthsPerTurn: 3,
  });

  const city: SimulationLike = createCity({
    seed: SEED, level: Simulation.LEVEL_HARD, disasters: true,
  });
  stepMonths(city, 24);

  assert.equal(log.final.hash, hashCity(city));
  assert.equal(log.turns.length, 8);
  assert.deepEqual(log.turns[1].date, { year: 1900, month: 3 });
  assert.deepEqual(log.final.date, { year: 1902, month: 0 });
});

test('game: actions are applied in order and their results kept',
  async (): Promise<void> => {
  const log: RunLog = await runGame(
    scriptedAgent([...FIRST_TURN, ...BROKEN]),
    { seed: SEED, turns: 2, actionCap: 20 });
  const results: ActionResult[] = log.turns[0].actions.map(
    (applied: { result: ActionResult }): ActionResult => applied.result);

  assert.deepEqual(results[0], { success: true, cost: 100, reason: null });
  assert.equal(results[4].success, true);
  assert.equal(log.turns[1].state.taxRate, 9);

  // Bulldozing the zone that was built first in the same turn
  assert.equal(results[7].success, true);

  assert.deepEqual(results.slice(8).map(
    (result: ActionResult): string | null => result.reason),
    ['unknown-action', 'unknown-tool', 'invalid-position', 'invalid-value',
      'unknown-action']);

  // Only the routes keep their tiles, from one endpoint to the other
  const road: AppliedAction = log.turns[0].actions[3];
  assert.equal(road.tiles?.length, 8);
  assert.deepEqual(road.tiles?.[0], [55, 49]);
  assert.deepEqual(road.tiles?.[7], [62, 49]);
  assert.ok(log.turns[0].actions[2].tiles !== undefined);
  assert.equal(log.turns[0].actions.filter(
    (applied: AppliedAction): boolean => applied.tiles !== undefined).length,
    2);
});

/* The cap is a safeguard of the runner, 100 unless set, and the log counts
 * what it cut. */
test('game: actions past the cap are cut and counted',
  async (): Promise<void> => {
  const log: RunLog = await runGame(scriptedAgent(FIRST_TURN),
    { seed: SEED, turns: 1, actionCap: 3 });
  const uncapped: RunLog = await runGame(scriptedAgent(FIRST_TURN),
    { seed: SEED, turns: 1 });

  assert.equal(log.turns[0].actions.length, 3);
  assert.equal(log.turns[0].dropped, FIRST_TURN.length - 3);
  assert.equal(uncapped.options.actionCap, 100);
  assert.equal(uncapped.turns[0].actions.length, FIRST_TURN.length);
  assert.equal(uncapped.turns[0].dropped, 0);
});

test('game: a quote in the view matches the applied action',
  async (): Promise<void> => {
  let quote: ActionResult | null = null;
  const agent: Agent = {
    name: 'quoting',
    decide: (view: CityView): GameAction[] => {
      quote = view.quote(FIRST_TURN[0]);
      return view.turn === 0 ? [FIRST_TURN[0]] : [];
    },
  };

  const log: RunLog = await runGame(agent, { seed: SEED, turns: 1 });

  assert.deepEqual(quote, log.turns[0].actions[0].result);
});

/* The log keeps the first map and the changes of every turn, which a
 * replay needs. Replaying the same actions by hand gives the same city. */
test('game: the map changes in the log add up to the final map',
  async (): Promise<void> => {
  const log: RunLog = await runGame(scriptedAgent(FIRST_TURN),
    { seed: SEED, turns: 6, monthsPerTurn: 2, actionCap: 20 });

  assert.ok(log.map !== null);
  const tiles: number[] = [...log.map.tiles];
  const changes: [number, number][] = [
    ...log.turns.flatMap((turn: TurnLog): [number, number][] =>
      turn.mapChanges),
    ...log.final.mapChanges,
  ];

  for (const [index, value] of changes) {
    tiles[index] = value;
  }

  const city: SimulationLike = createCity({
    seed: SEED, level: Simulation.LEVEL_EASY, disasters: false,
  });

  for (const action of FIRST_TURN) {
    applyAction(city, action);
  }

  stepMonths(city, 12);

  assert.ok(changes.length > 0);
  assert.deepEqual(tiles, readTiles(getMap(city)));
  assert.equal(log.final.hash, hashCity(city));
});

test('game: the same agent and options give the same log',
  async (): Promise<void> => {
  const options: Partial<GameOptions> & { seed: number } =
    { seed: SEED, turns: 4, actionCap: 20 };
  const first: RunLog = await runGame(scriptedAgent(FIRST_TURN), options);
  const second: RunLog = await runGame(scriptedAgent(FIRST_TURN), options);

  assert.deepEqual(first, second);
});

test('game: an agent can answer with a promise', async (): Promise<void> => {
  const waiting: Agent = {
    name: 'scripted',
    decide: async (view: CityView): Promise<GameAction[]> =>
      view.turn === 0 ? FIRST_TURN : [],
  };
  const options: Partial<GameOptions> & { seed: number } =
    { seed: SEED, turns: 3, actionCap: 20 };

  assert.deepEqual(await runGame(waiting, options),
    await runGame(scriptedAgent(FIRST_TURN), options));
});

/* _sendMessages sets the flags in the branch that sends "Residents demand
 * a Stadium" and the like, so the state reads them as they are. */
test('game: the state has the demand caps of the engine', (): void => {
  const city: SimulationLike = createCity({
    seed: SEED, level: Simulation.LEVEL_EASY, disasters: false,
  });
  const valves: ValvesLike = getValves(city);

  assert.deepEqual(getState(city).caps,
    { residential: false, commercial: false, industrial: false });

  valves.resCap = true;
  valves.indCap = true;

  assert.deepEqual(getState(city).caps,
    { residential: true, commercial: false, industrial: true });
});

test('game: the log is written as JSON', async (): Promise<void> => {
  const log: RunLog = await runGame(passiveAgent, { seed: SEED, turns: 2 });
  const path: string = join(mkdtempSync(join(tmpdir(), 'run-')), 'log.json');

  writeRunLog(path, log);

  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), log);
});

/* Anything that reads a log with JSON.parse reads old logs on one line and
 * new indented ones alike, so the two must parse to the same log. */
test('game: the log is indented with number arrays on one line',
  async (): Promise<void> => {
  const log: RunLog = await runGame(scriptedAgent(FIRST_TURN),
    { seed: SEED, turns: 3 });
  const path: string = join(mkdtempSync(join(tmpdir(), 'run-')), 'log.json');

  writeRunLog(path, log);

  const text: string = readFileSync(path, 'utf8');
  const lines: string[] = text.split('\n');
  const mapStart: number = lines.indexOf('    "tiles": [');
  const rows: string[] = lines.slice(mapStart + 1,
    mapStart + 1 + log.map.height);

  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(log)));
  assert.ok(mapStart > 0);
  assert.ok(rows.every((row: string): boolean =>
    row.split(',').filter((cell: string): boolean => cell.trim() !== '')
      .length === log.map.width));
  assert.ok(lines.some((line: string): boolean =>
    /^ +"tiles": \[\[\d+,\d+\](,\[\d+,\d+\])*\],?$/.test(line)));
  assert.ok(lines.filter((line: string): boolean =>
    line.includes('"mapChanges"')).every((line: string): boolean =>
    /\],?$/.test(line)));
});

/* On hard with disasters on, a monster comes to the demo town on seed 10
 * in the fourth turn. Reading the sprites must not change the run, so the
 * city, the states and the game's next random number are the same. */
test('game: recording sprites does not change the run',
  async (): Promise<void> => {
  const options: Partial<GameOptions> & { seed: number } = {
    seed: 10, level: Simulation.LEVEL_HARD, disasters: true, turns: 6,
  };
  const recorded: RunLog = await runGame(createDemoAgent(), options);
  const recordedNext: number = Random.getRandom(1000000);
  const plain: RunLog = await runGame(createDemoAgent(),
    { ...options, recordSprites: false });
  const plainNext: number = Random.getRandom(1000000);
  const types: Set<number> = new Set(recorded.turns.flatMap(
    (turn: TurnLog): number[] => turn.sprites.flatMap(
      ([, sprites]: SpriteSample): number[] =>
        sprites.map((sprite: SpriteRecord): number => sprite[0]))));

  assert.ok(types.has(5));
  assert.deepEqual(recorded.spriteSampling,
    { ticksPerSample: 4, samplesPerTurn: 48 });
  assert.equal(plain.spriteSampling, null);
  assert.ok(plain.turns.every((turn: TurnLog): boolean =>
    turn.sprites.length === 0));
  assert.equal(recorded.final.hash, plain.final.hash);
  assert.equal(recordedNext, plainNext);
  assert.deepEqual(
    recorded.turns.map((turn: TurnLog): unknown => turn.state),
    plain.turns.map((turn: TurnLog): unknown => turn.state));
});

/* A residential zone with no plant has no power. In the demo town, once
 * its coal plant runs, the plant and the zones next to it have power. */
test('game: the view lists every zone with its power',
  async (): Promise<void> => {
  const seen: ZoneView[][] = [];
  const watched: (inner: Agent) => Agent = (inner: Agent): Agent => ({
    name: inner.name,
    decide: (view: CityView): GameAction[] | Promise<GameAction[]> => {
      seen.push(view.zones);
      return inner.decide(view);
    },
  });

  await runGame(watched(scriptedAgent([FIRST_TURN[0]])),
    { seed: SEED, turns: 2 });

  assert.deepEqual(seen, [[],
    [{ x: 58, y: 47, tile: FREEZ, powered: false }]]);

  seen.length = 0;
  await runGame(watched(createDemoAgent()), { seed: SEED, turns: 8 });
  const last: ZoneView[] = seen[seen.length - 1];

  assert.ok(last.some((zone: ZoneView): boolean =>
    zone.tile === POWERPLANT && zone.powered));
  assert.ok(last.filter((zone: ZoneView): boolean => zone.powered).length > 5);
});

/* The view has the five block maps the query tool reads, copied at the
 * start of the turn. Replaying the demo town to the start of its last turn
 * gives the same values in the engine, which a live map would not. */
test('game: the view has the block maps of the query tool',
  async (): Promise<void> => {
  const turns: number = 12;
  const views: CityView[] = [];
  const demo: Agent = createDemoAgent();
  const watched: Agent = {
    name: demo.name,
    decide: (view: CityView): GameAction[] | Promise<GameAction[]> => {
      views.push(view);
      return demo.decide(view);
    },
  };
  const log: RunLog = await runGame(watched, { seed: SEED, turns: turns });
  const city: SimulationLike = createCity({
    seed: SEED, level: log.options.level, disasters: log.options.disasters,
  });

  for (const turn of log.turns.slice(0, turns - 1)) {
    for (const applied of turn.actions) {
      applyAction(city, applied.action);
    }

    stepMonths(city, log.options.monthsPerTurn);
  }

  const view: CityView = views[turns - 1];
  const pairs: [BlockMapView, BlockMapLike, number][] = [
    [view.blockMaps.populationDensity, city.blockMaps.populationDensityMap,
      2],
    [view.blockMaps.landValue, city.blockMaps.landValueMap, 2],
    [view.blockMaps.crime, city.blockMaps.crimeRateMap, 2],
    [view.blockMaps.pollution, city.blockMaps.pollutionDensityMap, 2],
    [view.blockMaps.growth, city.blockMaps.rateOfGrowthMap, 8],
  ];

  for (const [copy, engine, blockSize] of pairs) {
    assert.equal(copy.blockSize, blockSize);
    assert.equal(copy.width, Math.ceil(120 / blockSize));
    assert.equal(copy.height, Math.ceil(100 / blockSize));
    assert.deepEqual(readBlocks(copy), readBlocks(engine));
    assert.ok(readBlocks(copy).some((value: number): boolean => value !== 0));
  }

  assert.equal(view.level, log.options.level);
  assert.throws((): number => view.blockMaps.crime.get(-1, 0));
  assert.throws((): number => view.blockMaps.growth.get(15, 0));
});
