// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepMonths } from '../runner.ts';
import { build } from '../actions.ts';
import { getMap } from '../engine.ts';
import { hashCity } from '../hash.ts';
import { buildRoute, planRoute, ROUTE_TOOLS } from '../routes.ts';
import { createDevelopedCity } from './helpers/cities.ts';
import { TileUtils } from '../../src/tileUtils.js';
import * as TileValues from '../../src/tileValues.ts';
import type {
  ActionResult,
  MapLike,
  Position,
  RoutePlan,
  RouteTile,
  SimulationLike,
} from '../types.ts';

interface RouteRequest {
  tool: string;
  from: Position;
  to: Position;
}

const SEED: number = 20260926;
const RICH: number = 1000000;

// The tool prices in src/roadTool.js, src/railTool.js and src/wireTool.js
const LAND_COST: Record<string, number> = { road: 10, rail: 20, wire: 5 };

// Lines of another kind each tool can cross
const CROSSES: Record<string, number[]> = {
  road: [TileValues.LHPOWER, TileValues.LVPOWER, TileValues.LHRAIL,
    TileValues.LVRAIL],
  rail: [TileValues.LHPOWER, TileValues.LVPOWER, TileValues.ROADS,
    TileValues.ROADS2],
  wire: [TileValues.ROADS, TileValues.ROADS2, TileValues.LHRAIL,
    TileValues.LVRAIL],
};

const BRIDGES: Record<string, number[]> = {
  road: [TileValues.HBRIDGE, TileValues.VBRIDGE],
  rail: [TileValues.HRAIL, TileValues.VRAIL],
  wire: [TileValues.HPOWER, TileValues.VPOWER],
};

// mulberry32, kept apart from the game's generator
function makeRandom(seed: number): () => number {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6D2B79F5) | 0;
    let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRequests(count: number, seed: number): RouteRequest[] {
  const random: () => number = makeRandom(seed);
  const pick: (limit: number) => number = (limit: number): number =>
    Math.floor(random() * limit);
  const requests: RouteRequest[] = [];

  for (let index: number = 0; index < count; index++) {
    requests.push({
      tool: ROUTE_TOOLS[pick(ROUTE_TOOLS.length)],
      from: { x: pick(120), y: pick(100) },
      to: { x: pick(120), y: pick(100) },
    });
  }

  return requests;
}

function plan(city: SimulationLike, request: RouteRequest): RoutePlan {
  return planRoute(city, request.tool, request.from, request.to);
}

function normalizedValue(map: MapLike, x: number, y: number): number {
  return TileUtils.normalizeRoad(map.getTileValue(x, y));
}

// Top left corner of a square of bare land with no flags
function findBareLand(map: MapLike, size: number): Position {
  for (let y: number = 5; y < map.height - size - 5; y++) {
    for (let x: number = 5; x < map.width - size - 5; x++) {
      let bare: boolean = true;

      for (let dy: number = 0; dy < size && bare; dy++) {
        for (let dx: number = 0; dx < size && bare; dx++) {
          bare = map.getTile(x + dx, y + dy).getRawValue() === TileValues.DIRT;
        }
      }

      if (bare) {
        return { x: x, y: y };
      }
    }
  }

  throw new Error('no bare land of that size');
}

function richCity(): SimulationLike {
  const city: SimulationLike = createDevelopedCity(SEED);
  city.budget.setFunds(RICH);
  return city;
}

test('routes: the planned cost is what buildRoute spends', () => {
  const city: SimulationLike = richCity();
  const map: MapLike = getMap(city);
  const seen: Record<string, number> = {
    built: 0, bridges: 0, crossings: 0, bulldozed: 0, existing: 0,
  };

  for (const request of randomRequests(150, SEED)) {
    const routePlan: RoutePlan = plan(city, request);

    if (!routePlan.success) {
      continue;
    }

    for (const tile of routePlan.tiles) {
      const value: number = normalizedValue(map, tile.x, tile.y);

      if (tile.kind === 'bridge') {
        seen.bridges++;
      } else if (tile.kind === 'existing') {
        seen.existing++;
      } else if (CROSSES[request.tool].includes(value)) {
        seen.crossings++;
      } else if (tile.cost === LAND_COST[request.tool] + 1) {
        seen.bulldozed++;
      }
    }

    const fundsBefore: number = city.budget.totalFunds;
    const result: ActionResult = buildRoute(city, routePlan);

    assert.deepEqual(result,
      { success: true, cost: routePlan.cost, reason: null });
    assert.equal(fundsBefore - city.budget.totalFunds, routePlan.cost);
    seen.built++;

    for (const tile of routePlan.tiles) {
      if (tile.kind === 'bridge') {
        assert.ok(BRIDGES[request.tool].includes(
          normalizedValue(map, tile.x, tile.y)));
      }
    }

    // Every tile has the kind now, so the same route costs nothing
    assert.equal(plan(city, request).cost, 0);
  }

  // Otherwise the routes never met water, lines or trees
  assert.ok(seen.built >= 100, JSON.stringify(seen));
  assert.ok(seen.bridges > 0, JSON.stringify(seen));
  assert.ok(seen.crossings > 0, JSON.stringify(seen));
  assert.ok(seen.bulldozed > 0, JSON.stringify(seen));
  assert.ok(seen.existing > 0, JSON.stringify(seen));
});

// The cities share one random generator, so one run ends before the next
test('routes: planning changes nothing and draws no random numbers', () => {
  const planned: SimulationLike = createDevelopedCity(SEED);
  const hashBefore: string = hashCity(planned);

  for (const request of randomRequests(20, SEED)) {
    plan(planned, request);
  }

  assert.equal(hashCity(planned), hashBefore);
  stepMonths(planned, 24);
  const plannedHash: string = hashCity(planned);

  const untouched: SimulationLike = createDevelopedCity(SEED);
  stepMonths(untouched, 24);

  assert.equal(plannedHash, hashCity(untouched));
});

test('routes: the same city and endpoints give the same route', () => {
  const requests: RouteRequest[] = randomRequests(30, SEED + 1);
  const first: RoutePlan[] = requests.map(
    (request: RouteRequest): RoutePlan => plan(createDevelopedCity(SEED),
      request));
  const city: SimulationLike = createDevelopedCity(SEED);
  const second: RoutePlan[] = requests.map(
    (request: RouteRequest): RoutePlan => plan(city, request));

  assert.deepEqual(first, second);
  assert.ok(first.some((routePlan: RoutePlan): boolean => routePlan.success));
});

test('routes: positions off the map and unknown tools are refused', () => {
  const city: SimulationLike = richCity();
  const inside: Position = { x: 10, y: 10 };

  assert.equal(planRoute(city, 'road', { x: -1, y: 5 }, inside).reason,
    'invalid-position');
  assert.equal(planRoute(city, 'rail', inside, { x: 120, y: 5 }).reason,
    'invalid-position');
  assert.equal(planRoute(city, 'wire', { x: 1.5, y: 2 }, inside).reason,
    'invalid-position');
  assert.equal(planRoute(city, 'residential', inside, inside).reason,
    'unknown-tool');
});

/* Four zones around one bare tile, so that tile has no free neighbour. The
 * tile itself can be reached by nothing, the zones are blocked. */
test('routes: a tile closed in by zones has no route', () => {
  const city: SimulationLike = richCity();
  const corner: Position = findBareLand(getMap(city), 7);
  const hole: Position = { x: corner.x + 3, y: corner.y + 3 };
  const zones: Position[] = [
    { x: hole.x - 1, y: hole.y - 2 },
    { x: hole.x + 2, y: hole.y - 1 },
    { x: hole.x + 1, y: hole.y + 2 },
    { x: hole.x - 2, y: hole.y + 1 },
  ];

  for (const zone of zones) {
    assert.equal(build(city, 'residential', zone.x, zone.y).success, true);
  }

  const outside: Position = { x: corner.x - 3, y: corner.y };

  assert.equal(planRoute(city, 'road', outside, hole).reason, 'no-route');
  assert.equal(planRoute(city, 'road', outside, zones[0]).reason, 'blocked');
});

test('routes: not enough money builds nothing', () => {
  const city: SimulationLike = richCity();
  const routePlan: RoutePlan = planRoute(city, 'road',
    { x: 10, y: 10 }, { x: 100, y: 90 });

  assert.ok(routePlan.cost > 0);

  city.budget.setFunds(routePlan.cost - 1);
  const hashBefore: string = hashCity(city);

  assert.deepEqual(buildRoute(city, routePlan),
    { success: false, cost: 0, reason: 'insufficient-funds' });
  assert.equal(hashCity(city), hashBefore);

  city.budget.setFunds(routePlan.cost);

  assert.equal(buildRoute(city, routePlan).success, true);
  assert.equal(city.budget.totalFunds, 0);
});

test('routes: a plan is refused once its tiles changed', () => {
  const city: SimulationLike = richCity();
  const routePlan: RoutePlan = planRoute(city, 'road',
    { x: 10, y: 10 }, { x: 100, y: 90 });
  const tile: RouteTile = routePlan.tiles.filter(
    (routeTile: RouteTile): boolean => routeTile.kind === 'new')[5];

  assert.equal(build(city, 'road', tile.x, tile.y).success, true);
  const hashBefore: string = hashCity(city);

  assert.deepEqual(buildRoute(city, routePlan),
    { success: false, cost: 0, reason: 'stale-plan' });
  assert.equal(hashCity(city), hashBefore);
});

test('routes: a failed plan builds nothing', () => {
  const city: SimulationLike = richCity();
  const routePlan: RoutePlan = planRoute(city, 'road',
    { x: -1, y: 0 }, { x: 0, y: 0 });
  const hashBefore: string = hashCity(city);

  assert.deepEqual(buildRoute(city, routePlan),
    { success: false, cost: 0, reason: 'invalid-position' });
  assert.equal(hashCity(city), hashBefore);
});
