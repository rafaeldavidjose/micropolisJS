// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, stepMonths, Simulation } from '../runner.ts';
import { build } from '../actions.ts';
import { getMap } from '../engine.ts';
import { Tile } from '../../src/tile.ts';
import { TileUtils } from '../../src/tileUtils.js';
import { BLBNBIT } from '../../src/tileFlags.ts';
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
