// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, getState, stepMonths } from '../runner.ts';
import { getMap } from '../engine.ts';
import { applyAction, runGame } from '../game.ts';
import { createDemoAgent } from '../agents/demo.ts';
import { createDevelopedCity } from './helpers/cities.ts';
import { Traffic } from '../../src/traffic.js';
import {
  HOSPITALBASE,
  LASTROAD,
  LTRFBASE,
  RESBASE,
  ROADBASE,
} from '../../src/tileValues.ts';
import type { MapLike, RunLog, SimulationLike, TileLike } from '../types.ts';

interface TripMaker {
  makeTraffic(x: number, y: number, blockMaps: unknown,
    destination: (tileValue: number) => boolean): number;
}

interface DensityMap {
  worldGet(x: number, y: number): number;
}

const SEED: number = 20260926;

// A residential zone in the south row of the developed city
const ZONE_X: number = 43;
const ZONE_Y: number = 52;

/* tryDrive copied its start from an object and moved from a variable that
 * did not exist, so no trip ever reached its destination (CHANGES.md). */
test('traffic: a trip from a residential zone reaches its destination',
  (): void => {
  const city: SimulationLike = createDevelopedCity(SEED);

  stepMonths(city, 6);

  const map: MapLike = getMap(city);
  const zone: TileLike = map.getTile(ZONE_X, ZONE_Y);
  const trips: TripMaker = new Traffic(map, city.spriteManager);

  assert.ok(zone.isZone() && zone.getValue() >= RESBASE &&
    zone.getValue() < HOSPITALBASE);
  assert.equal(trips.makeTraffic(ZONE_X, ZONE_Y, city.blockMaps,
    Traffic.endsResidentialTrip), Traffic.ROUTE_FOUND);
});

/* The demo town grows to about 5,000 people in 10 years on this seed. It
 * is played again from its log, as in replay.test.ts, to read the traffic
 * density map of the city. */
test('traffic: busy roads get a traffic density', async (): Promise<void> => {
  const log: RunLog = await runGame(createDemoAgent(),
    { seed: SEED, turns: 40 });
  const city: SimulationLike = createCity({
    seed: SEED, level: log.options.level, disasters: log.options.disasters,
  });

  for (const turn of log.turns) {
    for (const applied of turn.actions) {
      applyAction(city, applied.action);
    }

    stepMonths(city, log.options.monthsPerTurn);
  }

  const map: MapLike = getMap(city);
  const density: DensityMap =
    (city.blockMaps as { trafficDensityMap: DensityMap }).trafficDensityMap;
  let busyRoads: number = 0;
  let trafficTiles: number = 0;

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      const value: number = map.getTileValue(x, y);

      if (value < ROADBASE || value > LASTROAD) {
        continue;
      }

      busyRoads += density.worldGet(x, y) > 0 ? 1 : 0;
      trafficTiles += value >= LTRFBASE ? 1 : 0;
    }
  }

  assert.ok(busyRoads > 0, 'road tiles with traffic density');
  assert.ok(trafficTiles > 0, 'road tiles drawn with traffic');
  assert.ok(getState(city).problems.traffic > 0, 'traffic problem');
});
