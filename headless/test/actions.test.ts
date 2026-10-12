// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, getState, Simulation } from '../runner.ts';
import {
  build,
  bulldoze,
  setTaxRate,
  setBudgetPercentages,
  setAutoBudget,
} from '../actions.ts';
import { hashCity } from '../hash.ts';
import type {
  ActionFailure,
  ActionResult,
  SimulationLike,
} from '../types.ts';

const SEED: number = 20260926;
const START_FUNDS: number = 20000;

// With this seed the land around here is clear, and 10, 31 has four trees
const CLEAR_X: number = 58;
const CLEAR_Y: number = 47;
const TREES_X: number = 10;
const TREES_Y: number = 31;

function createTestCity(): SimulationLike {
  return createCity({
    seed: SEED,
    level: Simulation.LEVEL_EASY,
    disasters: false,
  });
}

function assertSuccess(result: ActionResult, cost: number): void {
  assert.deepEqual(result, { success: true, cost: cost, reason: null });
}

// A failed action must not cost anything or change the city
function assertFailure(city: SimulationLike, reason: ActionFailure,
    action: () => ActionResult): void {
  const hashBefore: string = hashCity(city);

  assert.deepEqual(action(), { success: false, cost: 0, reason: reason });
  assert.equal(hashCity(city), hashBefore);
}

test('build: a success costs the tool price and takes it from the funds',
  (): void => {
  const city: SimulationLike = createTestCity();

  assertSuccess(build(city, 'residential', CLEAR_X, CLEAR_Y), 100);
  assertSuccess(build(city, 'road', CLEAR_X, CLEAR_Y + 2), 10);
  assertSuccess(build(city, 'wire', CLEAR_X, CLEAR_Y - 2), 5);

  assert.equal(getState(city).funds, START_FUNDS - 115);
});

test('build: clearing trees is added to the cost', (): void => {
  const city: SimulationLike = createTestCity();

  assertSuccess(build(city, 'fire', TREES_X, TREES_Y), 504);
});

test('build: unknown tools are refused', (): void => {
  const city: SimulationLike = createTestCity();
  const names: string[] = ['query', 'bulldozer', 'house', ''];

  for (const name of names) {
    assertFailure(city, 'unknown-tool',
      (): ActionResult => build(city, name, CLEAR_X, CLEAR_Y));
  }
});

test('build: positions off the map are refused', (): void => {
  const city: SimulationLike = createTestCity();

  assertFailure(city, 'invalid-position',
    (): ActionResult => build(city, 'road', -1, 5));
  assertFailure(city, 'invalid-position',
    (): ActionResult => build(city, 'road', 120, 5));
  assertFailure(city, 'invalid-position',
    (): ActionResult => build(city, 'road', 5, 100));
  assertFailure(city, 'invalid-position',
    (): ActionResult => build(city, 'road', 1.5, 2));

  // The centre is on the map but the site is not
  assertFailure(city, 'invalid-position',
    (): ActionResult => build(city, 'residential', 0, 0));
  assertFailure(city, 'invalid-position',
    (): ActionResult => build(city, 'airport', 118, 50));
});

test('build: a site that is in use is occupied', (): void => {
  const city: SimulationLike = createTestCity();

  build(city, 'residential', CLEAR_X, CLEAR_Y);

  assertFailure(city, 'occupied',
    (): ActionResult => build(city, 'residential', CLEAR_X, CLEAR_Y));
  assertFailure(city, 'occupied',
    (): ActionResult => build(city, 'commercial', CLEAR_X + 2, CLEAR_Y));
  assertFailure(city, 'occupied',
    (): ActionResult => build(city, 'park', CLEAR_X, CLEAR_Y));
});

test('build: a road or wire that cannot go there is blocked', (): void => {
  const city: SimulationLike = createTestCity();

  build(city, 'residential', CLEAR_X, CLEAR_Y);
  build(city, 'road', CLEAR_X, CLEAR_Y + 2);

  assertFailure(city, 'blocked',
    (): ActionResult => build(city, 'road', CLEAR_X, CLEAR_Y + 2));
  assertFailure(city, 'blocked',
    (): ActionResult => build(city, 'wire', CLEAR_X, CLEAR_Y));

  // Open water with no road next to it to bridge from
  assertFailure(city, 'blocked',
    (): ActionResult => build(city, 'road', 50, 50));
});

test('build: too little money is refused', (): void => {
  const city: SimulationLike = createTestCity();

  city.budget.setFunds(99);

  assertFailure(city, 'insufficient-funds',
    (): ActionResult => build(city, 'residential', CLEAR_X, CLEAR_Y));

  city.budget.setFunds(100);

  assertSuccess(build(city, 'residential', CLEAR_X, CLEAR_Y), 100);
  assert.equal(getState(city).funds, 0);
});

test('bulldoze: clears a road so the land can be used again', (): void => {
  const city: SimulationLike = createTestCity();

  build(city, 'road', CLEAR_X, CLEAR_Y);

  assertSuccess(bulldoze(city, CLEAR_X, CLEAR_Y), 1);
  assertSuccess(build(city, 'residential', CLEAR_X, CLEAR_Y), 100);
});

test('bulldoze: a building turns into rubble', (): void => {
  const city: SimulationLike = createTestCity();

  build(city, 'residential', CLEAR_X, CLEAR_Y);

  // The engine only knows a 3x3 zone by its centre tile
  assertFailure(city, 'nothing-to-bulldoze',
    (): ActionResult => bulldoze(city, CLEAR_X - 1, CLEAR_Y - 1));
  assertSuccess(bulldoze(city, CLEAR_X, CLEAR_Y), 1);

  // Rubble is cleared by the next building, for 1 per tile
  assertSuccess(build(city, 'residential', CLEAR_X, CLEAR_Y), 109);
});

test('bulldoze: failures', (): void => {
  const city: SimulationLike = createTestCity();

  assertFailure(city, 'nothing-to-bulldoze',
    (): ActionResult => bulldoze(city, CLEAR_X, CLEAR_Y));
  assertFailure(city, 'invalid-position',
    (): ActionResult => bulldoze(city, 200, 5));
  assertFailure(city, 'invalid-position',
    (): ActionResult => bulldoze(city, 5, -1));

  build(city, 'road', CLEAR_X, CLEAR_Y);
  city.budget.setFunds(0);

  assertFailure(city, 'insufficient-funds',
    (): ActionResult => bulldoze(city, CLEAR_X, CLEAR_Y));
});

test('setTaxRate: accepts whole numbers from 0 to 20', (): void => {
  const city: SimulationLike = createTestCity();

  assertSuccess(setTaxRate(city, 9), 0);
  assert.equal(getState(city).taxRate, 9);

  assertSuccess(setTaxRate(city, 0), 0);
  assertSuccess(setTaxRate(city, 20), 0);

  const badRates: number[] = [-1, 21, 7.5, NaN];

  for (const rate of badRates) {
    assertFailure(city, 'invalid-value',
      (): ActionResult => setTaxRate(city, rate));
  }

  assert.equal(getState(city).taxRate, 20);
});

test('setBudgetPercentages: accepts whole numbers from 0 to 100', (): void => {
  const city: SimulationLike = createTestCity();

  assertSuccess(
    setBudgetPercentages(city, { road: 50, fire: 80, police: 0 }), 0);
  assert.equal(city.budget.roadPercent, 0.5);
  assert.equal(city.budget.firePercent, 0.8);
  assert.equal(city.budget.policePercent, 0);

  assertFailure(city, 'invalid-value', (): ActionResult =>
    setBudgetPercentages(city, { road: 101, fire: 80, police: 0 }));
  assertFailure(city, 'invalid-value', (): ActionResult =>
    setBudgetPercentages(city, { road: 50, fire: -1, police: 0 }));
  assertFailure(city, 'invalid-value', (): ActionResult =>
    setBudgetPercentages(city, { road: 50, fire: 80, police: 0.5 }));

  // A refused call changes none of the three
  assert.equal(city.budget.roadPercent, 0.5);
});

test('setAutoBudget: turns the engine option on and off', (): void => {
  const city: SimulationLike = createTestCity();

  assert.equal(city.budget.autoBudget, true);

  assertSuccess(setAutoBudget(city, false), 0);
  assert.equal(city.budget.autoBudget, false);

  assertSuccess(setAutoBudget(city, true), 0);
  assert.equal(city.budget.autoBudget, true);

  assertFailure(city, 'invalid-value',
    (): ActionResult => setAutoBudget(city, 'yes' as unknown as boolean));
});

test('actions: the same actions give the same city', (): void => {
  function runActions(): string {
    const city: SimulationLike = createTestCity();

    build(city, 'coal', CLEAR_X, CLEAR_Y);
    build(city, 'park', CLEAR_X + 4, CLEAR_Y);
    build(city, 'residential', CLEAR_X + 4, CLEAR_Y - 3);
    bulldoze(city, CLEAR_X + 4, CLEAR_Y - 3);
    setTaxRate(city, 5);

    return hashCity(city);
  }

  assert.equal(runActions(), runActions());
});
