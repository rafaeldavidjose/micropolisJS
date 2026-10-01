// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepMonths } from '../runner.ts';
import { getMap } from '../engine.ts';
import { hashCity } from '../hash.ts';
import { createDevelopedCity } from './helpers/cities.ts';
import { SPRITE_TORNADO } from '../../src/spriteConstants.ts';
import { LASTROAD, ROADBASE } from '../../src/tileValues.ts';
import type { MapLike, SimulationLike, SpriteLike } from '../types.ts';

interface MonthRecord {
  hash: string;
  x: number;
  y: number;
  alive: boolean;
}

const SEED: number = 20260926;
const MONTHS: number = 6;

// On the road of the developed city
const START_X: number = 60;
const START_Y: number = 50;

/* makeTornado puts it at a random place. Moving it onto the city makes
 * sure it hits something. */
function addTornado(city: SimulationLike): SpriteLike {
  city.spriteManager.makeTornado();

  const tornado: SpriteLike | null =
    city.spriteManager.getSprite(SPRITE_TORNADO);
  assert.ok(tornado !== null);

  tornado.worldX = START_X;
  tornado.worldY = START_Y;

  return tornado;
}

// A tornado turns road into water, nothing else removes road here
function countRoadTiles(city: SimulationLike): number {
  const map: MapLike = getMap(city);
  let count: number = 0;

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      const tileValue: number = map.getTileValue(x, y);

      if (tileValue >= ROADBASE && tileValue <= LASTROAD) {
        count++;
      }
    }
  }

  return count;
}

function recordTornado(): MonthRecord[] {
  const city: SimulationLike = createDevelopedCity(SEED);
  const tornado: SpriteLike = addTornado(city);
  const records: MonthRecord[] = [];

  for (let month: number = 0; month < MONTHS; month++) {
    stepMonths(city, 1);
    records.push({
      hash: hashCity(city),
      x: tornado.worldX,
      y: tornado.worldY,
      alive: tornado.frame !== 0,
    });
  }

  return records;
}

test('tornado: stepMonths moves it', () => {
  const city: SimulationLike = createDevelopedCity(SEED);
  const tornado: SpriteLike = addTornado(city);

  stepMonths(city, 1);

  assert.notDeepEqual([tornado.worldX, tornado.worldY], [START_X, START_Y]);
});

test('tornado: it destroys road on its way', () => {
  const city: SimulationLike = createDevelopedCity(SEED);
  const roadsBefore: number = countRoadTiles(city);

  addTornado(city);
  stepMonths(city, 1);

  assert.ok(countRoadTiles(city) < roadsBefore);
});

test('tornado: the same run twice gives the same city', () => {
  const firstRun: MonthRecord[] = recordTornado();
  const secondRun: MonthRecord[] = recordTornado();

  assert.deepEqual(firstRun, secondRun);

  // It left the map at some point, otherwise the run proves less
  assert.equal(firstRun[MONTHS - 1].alive, false);
});
