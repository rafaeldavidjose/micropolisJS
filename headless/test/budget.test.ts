// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepMonths, getState } from '../runner.ts';
import { setAutoBudget } from '../actions.ts';
import { getBudgetLog } from '../budget.ts';
import { createDevelopedCity, createPoorCity } from './helpers/cities.ts';
import type {
  BudgetWindowRecord,
  CityState,
  SimulationLike,
} from '../types.ts';

const SEED: number = 20260926;

test('budget window: stepMonths answers it and time goes on', () => {
  const city: SimulationLike = createPoorCity(SEED);

  for (let year: number = 1901; year <= 1906; year++) {
    stepMonths(city, 12);

    const state: CityState = getState(city);

    assert.deepEqual(state.date, { year: year, month: 0 });
    assert.ok(state.funds >= 0);
    assert.equal(city.budget.awaitingValues, false);
  }

  // The first year is still paid for, then one window every January
  assert.equal(getBudgetLog(city).length, 5);
});

test('budget window: the record has what the city could pay', () => {
  const city: SimulationLike = createPoorCity(SEED);

  stepMonths(city, 12 * 3);

  const log: BudgetWindowRecord[] = getBudgetLog(city);

  // Roads are paid first, then fire, then police
  assert.deepEqual(log[0], {
    date: { year: 1902, month: 0 },
    funds: 512,
    taxes: 19,
    fundsAfter: 0,
    road: 100,
    fire: 41,
    police: 0,
    autoBudgetWasOn: true,
  });
  assert.deepEqual(log[1], {
    date: { year: 1903, month: 0 },
    funds: 0,
    taxes: 19,
    fundsAfter: 0,
    road: 49,
    fire: 0,
    police: 0,
    autoBudgetWasOn: false,
  });
});

test('budget window: the engine leaves auto budget off afterwards', () => {
  const city: SimulationLike = createPoorCity(SEED);

  assert.equal(city.budget.autoBudget, true);

  stepMonths(city, 12 * 2);

  assert.equal(city.budget.autoBudget, false);
});

test('budget window: a city that can pay never gets one', () => {
  const city: SimulationLike = createDevelopedCity(SEED);

  stepMonths(city, 12 * 5);

  assert.deepEqual(getBudgetLog(city), []);
  assert.equal(city.budget.autoBudget, true);
  assert.ok(getState(city).population > 0);
});

test('budget window: with auto budget off it opens every January', () => {
  const city: SimulationLike = createDevelopedCity(SEED);

  setAutoBudget(city, false);
  stepMonths(city, 12 * 3);

  const log: BudgetWindowRecord[] = getBudgetLog(city);

  assert.equal(log.length, 3);

  for (const record of log) {
    assert.equal(record.road, 100);
    assert.equal(record.fire, 100);
    assert.equal(record.police, 100);
    assert.equal(record.autoBudgetWasOn, false);
  }

  // Turned back on, a city with enough money gets no more windows
  setAutoBudget(city, true);
  stepMonths(city, 12 * 3);

  assert.equal(getBudgetLog(city).length, 3);
});

test('budget window: the log is the same in two runs', () => {
  function runPoorCity(): BudgetWindowRecord[] {
    const city: SimulationLike = createPoorCity(SEED);

    stepMonths(city, 12 * 10);

    return getBudgetLog(city);
  }

  assert.deepEqual(runPoorCity(), runPoorCity());
});

test('budget window: getBudgetLog returns a copy', () => {
  const city: SimulationLike = createPoorCity(SEED);

  stepMonths(city, 12 * 2);
  getBudgetLog(city).pop();

  assert.equal(getBudgetLog(city).length, 1);
});
