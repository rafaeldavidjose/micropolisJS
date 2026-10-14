// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getState, stepMonths } from '../runner.ts';
import { build, bulldoze } from '../actions.ts';
import { createDevelopedCity } from './helpers/cities.ts';
import type { SimulationLike } from '../types.ts';

const SEED: number = 20260926;
const MONTHS: number = 12;

// A residential zone in the middle of the north row of the developed city
const SITE_X: number = 58;
const SITE_Y: number = 48;

/* The same city with that zone bulldozed, and a police station on its site
 * if asked. Bulldozing it in both runs keeps the zones the same. */
function crimeAfterAYear(withPolice: boolean): number {
  const city: SimulationLike = createDevelopedCity(SEED);

  assert.equal(bulldoze(city, SITE_X, SITE_Y).success, true);

  if (withPolice) {
    assert.equal(build(city, 'police', SITE_X, SITE_Y).success, true);
  }

  stepMonths(city, MONTHS);

  return getState(city).problems.crime;
}

// crimeScan looped to fields BlockMap does not have, see CHANGES.md
test('crime: a developed city without police has crime', (): void => {
  const city: SimulationLike = createDevelopedCity(SEED);

  stepMonths(city, MONTHS);

  assert.ok(getState(city).problems.crime > 0);
});

test('crime: a police station among the zones lowers it', (): void => {
  const without: number = crimeAfterAYear(false);
  const withPolice: number = crimeAfterAYear(true);

  assert.ok(withPolice < without, withPolice + ' < ' + without);
});
