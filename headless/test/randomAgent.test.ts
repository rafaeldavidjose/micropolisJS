// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGame } from '../game.ts';
import { createCity, Simulation } from '../runner.ts';
import { build } from '../actions.ts';
import { getMap } from '../engine.ts';
import { ROUTE_TOOLS } from '../routes.ts';
import { passiveAgent } from '../agents/passive.ts';
import { createRandomAgent, routeStarts } from '../agents/random.ts';
import { createMapHistory } from '../viewer/replay.js';
import { Random } from '../../src/random.ts';
import type {
  Agent,
  AppliedAction,
  CityView,
  GameAction,
  GameOptions,
  MapView,
  Position,
  RunLog,
  SimulationLike,
  TurnLog,
} from '../types.ts';

const OPTIONS: Partial<GameOptions> & { seed: number } = {
  seed: 20260926,
  level: Simulation.LEVEL_HARD,
  disasters: true,
  turns: 12,
};

function allActions(log: RunLog): GameAction[] {
  return log.turns.flatMap((turn: TurnLog): GameAction[] =>
    turn.actions.map((applied: AppliedAction): GameAction =>
      applied.action as GameAction));
}

function totalDraws(log: RunLog): number {
  return log.turns.reduce((sum: number, turn: TurnLog): number =>
    sum + (turn.agent?.draws as number), 0);
}

test('random agent: the same seeds give the same run', async () => {
  const first: RunLog = await runGame(createRandomAgent({ seed: 7 }), OPTIONS);
  const second: RunLog = await runGame(createRandomAgent({ seed: 7 }),
    OPTIONS);

  assert.deepEqual(first, second);
  assert.ok(allActions(first).length > 0);
});

test('random agent: another agent seed gives another run', async () => {
  const first: RunLog = await runGame(createRandomAgent({ seed: 7 }), OPTIONS);
  const second: RunLog = await runGame(createRandomAgent({ seed: 8 }),
    OPTIONS);

  assert.notDeepEqual(allActions(first), allActions(second));
});

/* An agent that draws and quotes like the random agent but plays nothing,
 * against a passive run. On an empty map a moved generator can leave the
 * city the same for years, so the next number the game would draw is
 * compared too. */
test('random agent: its draws do not move the game generator', async () => {
  const random: Agent = createRandomAgent({ seed: 7 });
  const quiet: Agent = {
    name: 'quiet',
    decide: (view: CityView): GameAction[] => {
      random.decide(view);
      return [];
    },
    report: random.report,
  };

  const quietLog: RunLog = await runGame(quiet, OPTIONS);
  const quietNext: number = Random.getRandom(1000000);
  const passiveLog: RunLog = await runGame(passiveAgent, OPTIONS);
  const passiveNext: number = Random.getRandom(1000000);

  assert.ok(totalDraws(quietLog) > 0);
  assert.equal(quietNext, passiveNext);
  assert.equal(quietLog.final.hash, passiveLog.final.hash);
  assert.deepEqual(
    quietLog.turns.map((turn: TurnLog): unknown => turn.state),
    passiveLog.turns.map((turn: TurnLog): unknown => turn.state));
});

test('random agent: it keeps to the limits and the weights', async () => {
  const routes: RunLog = await runGame(createRandomAgent({
    seed: 3,
    weights: { building: 0, bulldoze: 0, tax: 0, budget: 0, autoBudget: 0,
      nothing: 0 },
    maxRouteDistance: 6,
  }), { ...OPTIONS, maxActionsPerTurn: 3 });

  for (const turn of routes.turns) {
    assert.ok(turn.actions.length <= 3);
  }

  const routeActions: GameAction[] = allActions(routes);
  assert.ok(routeActions.length > 0);

  for (const action of routeActions) {
    assert.equal(action.type, 'route');

    if (action.type === 'route') {
      assert.ok(ROUTE_TOOLS.includes(action.tool));
      assert.ok(Math.abs(action.from.x - action.to.x) +
        Math.abs(action.from.y - action.to.y) <= 6);
    }
  }

  const buildings: RunLog = await runGame(createRandomAgent({
    seed: 3,
    weights: { route: 0, bulldoze: 0, tax: 0, budget: 0, autoBudget: 0,
      nothing: 0 },
  }), OPTIONS);

  for (const action of allActions(buildings)) {
    assert.ok(action.type === 'build' && !ROUTE_TOOLS.includes(action.tool));
  }

  const idle: RunLog = await runGame(createRandomAgent({
    seed: 3,
    weights: { building: 0, route: 0, bulldoze: 0, tax: 0, budget: 0,
      autoBudget: 0 },
  }), OPTIONS);

  assert.equal(allActions(idle).length, 0);
});

function hasTile(tiles: Position[], x: number, y: number): boolean {
  return tiles.some((tile: Position): boolean => tile.x === x && tile.y === y);
}

// With this seed the land around 58, 47 is clear, see actions.test.ts
test('random agent: routes start on their kind or next to a building',
  () => {
  const city: SimulationLike = createCity({
    seed: 20260926, level: Simulation.LEVEL_EASY, disasters: false,
  });

  assert.equal(routeStarts(getMap(city), 'road').length, 0);

  build(city, 'residential', 58, 47);
  build(city, 'road', 64, 50);
  build(city, 'rail', 66, 50);
  build(city, 'wire', 68, 50);

  const roads: Position[] = routeStarts(getMap(city), 'road');
  const rails: Position[] = routeStarts(getMap(city), 'rail');
  const wires: Position[] = routeStarts(getMap(city), 'wire');

  assert.ok(hasTile(roads, 64, 50));
  assert.ok(!hasTile(roads, 66, 50));
  assert.ok(hasTile(rails, 66, 50));
  assert.ok(hasTile(wires, 68, 50));

  // Next to the zone on all four sides, never on it
  for (const [x, y] of [[56, 47], [60, 47], [58, 45], [58, 49]]) {
    assert.ok(hasTile(roads, x, y) && hasTile(rails, x, y) &&
      hasTile(wires, x, y), x + ', ' + y);
  }

  assert.ok(!hasTile(roads, 58, 47));
  assert.ok(!hasTile(roads, 57, 46));
  assert.ok(!hasTile(roads, 56, 45));
  assert.equal(roads.length, 12 + 1);
});

/* Every route checked against the map of its turn, rebuilt from the log.
 * Routes from the first turns, before anything is built, start anywhere. */
test('random agent: every route it plays starts on a valid tile', async () => {
  const log: RunLog = await runGame(createRandomAgent({
    seed: 11,
    weights: { route: 3, building: 2, bulldoze: 0, tax: 0, budget: 0,
      autoBudget: 0, nothing: 0 },
  }), { ...OPTIONS, turns: 24 });
  const history = createMapHistory(log);
  let checked: number = 0;

  for (const turn of log.turns) {
    const tiles: Uint16Array = history.tilesAt(turn.turn);
    const map: MapView = {
      width: history.width,
      height: history.height,
      getTileValue: (x: number, y: number): number =>
        tiles[y * history.width + x] & 0x3ff,
    };

    for (const applied of turn.actions) {
      const action: GameAction = applied.action as GameAction;

      if (action.type !== 'route') {
        continue;
      }

      const starts: Position[] = routeStarts(map, action.tool);

      if (starts.length > 0) {
        assert.ok(hasTile(starts, action.from.x, action.from.y),
          'turn ' + turn.turn + ': ' + JSON.stringify(action));
        checked++;
      }
    }
  }

  assert.ok(checked > 10);
});
