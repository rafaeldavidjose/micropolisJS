// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, stepMonths, Simulation } from '../runner.ts';
import { build } from '../actions.ts';
import { getMap } from '../engine.ts';
import { Tile } from '../../src/tile.ts';
import { TileUtils } from '../../src/tileUtils.js';
import { ZoneUtils } from '../../src/zoneUtils.js';
import { BLBNBIT, BULLBIT } from '../../src/tileFlags.ts';
import {
  DIRT,
  FIREBASE,
  LASTFIRE,
  LASTRUBBLE,
  RUBBLE,
  WOODS,
} from '../../src/tileValues.ts';
import type { ActionResult, MapLike, SimulationLike } from '../types.ts';

const SEEDS: readonly number[] = [1, 2, 3, 4, 5];

// A map with clear land around 70, 40 and 80, 40
const TOWN_SEED: number = 20260926;

// The forest, with bare land north of it for a fire station
const LEFT: number = 46;
const RIGHT: number = 74;
const TOP: number = 36;
const FOREST_TOP: number = 46;
const BOTTOM: number = 64;
const FIRE_X: number = 60;
const FIRE_Y: number = 55;

function isBurnt(value: number): boolean {
  return (value >= FIREBASE && value <= LASTFIRE) ||
    (value >= RUBBLE && value <= LASTRUBBLE);
}

/* Lays the forest over whatever the map has there, lights its middle and
 * counts the burning and burnt tiles a year later. The station, with a
 * coal plant for power and a road, stands on the bare land north of the
 * forest, and the fire is in the block of 8 by 8 tiles south of its own. */
function burntTiles(seed: number, withStation: boolean): number {
  const city: SimulationLike = createCity({
    seed: seed, level: Simulation.LEVEL_EASY, disasters: false,
  });
  const map: MapLike = getMap(city);

  for (let y: number = TOP; y <= BOTTOM; y++) {
    for (let x: number = LEFT; x <= RIGHT; x++) {
      map.setTo(x, y, y >= FOREST_TOP ? new Tile(WOODS, BLBNBIT) :
        new Tile(DIRT, 0));
    }
  }

  if (withStation) {
    const results: ActionResult[] = [
      build(city, 'fire', FIRE_X, FIRE_Y - 14),
      build(city, 'coal', FIRE_X + 3, FIRE_Y - 14),
      build(city, 'road', FIRE_X - 2, FIRE_Y - 14),
    ];
    assert.ok(results.every((result: ActionResult): boolean =>
      result.success));
  }

  // The fire station map is only smoothed every few months
  stepMonths(city, 3);
  map.setTo(FIRE_X, FIRE_Y, TileUtils.randomFire());
  stepMonths(city, 12);

  let burnt: number = 0;

  for (let y: number = FOREST_TOP; y <= BOTTOM; y++) {
    for (let x: number = LEFT; x <= RIGHT; x++) {
      burnt += isBurnt(map.getTileValue(x, y)) ? 1 : 0;
    }
  }

  return burnt;
}

function isBulldozable(map: MapLike, x: number, y: number): boolean {
  return (map.getTile(x, y).getRawValue() & BULLBIT) !== 0;
}

function totalBurnt(withStation: boolean): number {
  return SEEDS.reduce((sum: number, seed: number): number =>
    sum + burntTiles(seed, withStation), 0);
}

// Before the fix a fire never left its tile, so each burnt only that one
test('fire: it spreads through a forest', (): void => {
  assert.ok(totalBurnt(false) > 5 * SEEDS.length);
});

/* A fire next to a station goes out with a chance of 1 in 2 each time it is
 * checked, against 1 in 11 with no station near, so it spreads less. */
test('fire: a fire station nearby keeps it smaller', (): void => {
  const without: number = totalBurnt(false);
  const withStation: number = totalBurnt(true);

  assert.ok(withStation * 2 < without, `${withStation} against ${without}`);
});

/* When a fire reaches the centre of a zone, the zone's other tiles become
 * bulldozable, so the ruin can be cleared. Before the fix the check read
 * the wrong tiles, and the ones of the zone stayed as they were. */
test('fire: the rest of a burning zone can be bulldozed', (): void => {
  const city: SimulationLike = createCity({
    seed: TOWN_SEED, level: Simulation.LEVEL_EASY, disasters: false,
  });
  const map: MapLike = getMap(city);

  assert.ok(build(city, 'industrial', 70, 40).success);
  ZoneUtils.fireZone(map, 70, 40, city.blockMaps);

  for (let dy: number = -1; dy <= 1; dy++) {
    for (let dx: number = -1; dx <= 1; dx++) {
      assert.ok(isBulldozable(map, 70 + dx, 40 + dy), `${dx}, ${dy}`);
    }
  }
});

/* For a building of 4 by 4 tiles the original marks every tile up to 3
 * past the centre, the building and one more column and row. Here that
 * column holds the edge of a zone next to the coal plant. */
test('fire: a burning 4 by 4 building marks one more row and column',
  (): void => {
  const city: SimulationLike = createCity({
    seed: TOWN_SEED, level: Simulation.LEVEL_EASY, disasters: false,
  });
  const map: MapLike = getMap(city);

  assert.ok(build(city, 'coal', 80, 40).success);
  assert.ok(build(city, 'industrial', 84, 40).success);
  ZoneUtils.fireZone(map, 80, 40, city.blockMaps);

  for (let y: number = 39; y <= 42; y++) {
    for (let x: number = 79; x <= 82; x++) {
      assert.ok(isBulldozable(map, x, y), `plant ${x}, ${y}`);
    }
  }

  for (let y: number = 39; y <= 41; y++) {
    assert.ok(isBulldozable(map, 83, y), `zone 83, ${y}`);
    assert.ok(!isBulldozable(map, 84, y), `zone 84, ${y}`);
  }
});
