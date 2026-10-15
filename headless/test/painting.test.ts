// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, stepMonths, Simulation } from '../runner.ts';
import { build, bulldoze } from '../actions.ts';
import { getMap } from '../engine.ts';
import { hashCity } from '../hash.ts';
import { createDevelopedCity } from './helpers/cities.ts';
import { SPRITE_TORNADO } from '../../src/spriteConstants.ts';
import {
  LASTRUBBLE,
  LASTTINYEXP,
  RUBBLE,
  TINYEXP,
} from '../../src/tileValues.ts';
import type { MapLike, SimulationLike, SpriteLike } from '../types.ts';

// With this seed the land around 70, 40 is clear
const SEED: number = 20260926;
const ONE_TICK: number = 1 / 64;

function siteValues(map: MapLike, x: number, y: number): number[] {
  const values: number[] = [];

  for (let dy: number = -1; dy <= 1; dy++) {
    for (let dx: number = -1; dx <= 1; dx++) {
      values.push(map.getTileValue(x + dx, y + dy));
    }
  }

  return values;
}

/* The bulldozer leaves explosion tiles from TINYEXP to two past it. The
 * browser shows the next frame every fourth frame of a 60 Hz screen, so
 * the last of the eight frames turns into rubble after 6 to 8 steps of
 * 66.7 ms, 400 to 533 ms. At medium speed a tick takes 50 ms, so that is 8
 * to 11 ticks. */
test('painting: a bulldozed zone turns to rubble as in the browser',
  (): void => {
  const city: SimulationLike = createCity({
    seed: SEED, level: Simulation.LEVEL_EASY, disasters: false,
  });
  const map: MapLike = getMap(city);

  assert.ok(build(city, 'industrial', 70, 40).success);
  stepMonths(city, 1);
  assert.ok(bulldoze(city, 70, 40).success);
  assert.ok(siteValues(map, 70, 40).every((value: number): boolean =>
    value >= TINYEXP && value <= LASTTINYEXP));

  stepMonths(city, 6 * ONE_TICK);
  assert.ok(siteValues(map, 70, 40).every((value: number): boolean =>
    value >= TINYEXP && value <= LASTTINYEXP));

  stepMonths(city, 6 * ONE_TICK);
  assert.ok(siteValues(map, 70, 40).every((value: number): boolean =>
    value >= RUBBLE && value <= LASTRUBBLE));
});

/* Rubble is a random tile, so the explosions draw from the shared
 * generator. A tornado over the developed city, and a zone bulldozed
 * every month, still give the same city twice. */
test('painting: two runs with explosions give the same city', (): void => {
  const hashesOf: () => string[] = (): string[] => {
    const city: SimulationLike = createDevelopedCity(SEED);
    const hashes: string[] = [];

    city.spriteManager.makeTornado();
    const tornado: SpriteLike | null =
      city.spriteManager.getSprite(SPRITE_TORNADO);
    assert.ok(tornado !== null);
    tornado.worldX = 60;
    tornado.worldY = 50;

    for (let month: number = 0; month < 6; month++) {
      bulldoze(city, 46 + 3 * month, 48);
      stepMonths(city, 1);
      hashes.push(hashCity(city));
    }

    return hashes;
  };

  assert.deepEqual(hashesOf(), hashesOf());
});
