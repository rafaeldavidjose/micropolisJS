// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, stepMonths, getState, saveCity, loadCity, Simulation } from '../runner.ts';
import { hashCity } from '../hash.ts';
import type { CityState, SaveData, SimulationLike } from '../types.ts';

interface YearRecord {
  hash: string;
  state: CityState;
}

const YEARS: number = 20;
const SEED_A: number = 20260926;
const SEED_B: number = 197001;

function createHardCity(seed: number): SimulationLike {
  return createCity({ seed: seed, level: Simulation.LEVEL_HARD, disasters: true });
}

function recordYears(city: SimulationLike, years: number): YearRecord[] {
  const records: YearRecord[] = [];

  for (let year: number = 0; year < years; year++) {
    stepMonths(city, 12);
    records.push({ hash: hashCity(city), state: getState(city) });
  }

  return records;
}

function continueFromSave(saved: SaveData): YearRecord[] {
  return recordYears(loadCity(saved), YEARS / 2);
}

test('same seed: two runs match at every year for 20 years', () => {
  const firstRun: YearRecord[] = recordYears(createHardCity(SEED_A), YEARS);
  const secondRun: YearRecord[] = recordYears(createHardCity(SEED_A), YEARS);

  assert.deepEqual(firstRun, secondRun);
});

test('different seeds: final state differs', () => {
  const firstRun: YearRecord[] = recordYears(createHardCity(SEED_A), YEARS);
  const secondRun: YearRecord[] = recordYears(createHardCity(SEED_B), YEARS);

  assert.notEqual(firstRun[YEARS - 1].hash, secondRun[YEARS - 1].hash);
});

test('save/load: a loaded city keeps the disasters option', () => {
  for (const disasters of [true, false]) {
    const city: SimulationLike = createCity({ seed: SEED_A, level: Simulation.LEVEL_HARD, disasters: disasters });
    const loaded: SimulationLike = loadCity(saveCity(city));

    assert.equal(loaded.disasterManager.disastersEnabled, disasters);
  }
});

test('save/load: loading the same save twice gives the same run', () => {
  const city: SimulationLike = createHardCity(SEED_A);
  stepMonths(city, 12 * (YEARS / 2));
  const saved: SaveData = saveCity(city);

  const firstRun: YearRecord[] = continueFromSave(saved);

  // Moves the shared generator, which a reproducible load must not depend on
  recordYears(createHardCity(SEED_B), 1);

  const secondRun: YearRecord[] = continueFromSave(saved);

  assert.deepEqual(firstRun, secondRun);
});

test('save/load: a loaded city continues like an uninterrupted run', { todo: 'needs engine changes, see CHANGES.md' }, () => {
  const uninterrupted: SimulationLike = createHardCity(SEED_A);
  stepMonths(uninterrupted, 12 * YEARS);

  const city: SimulationLike = createHardCity(SEED_A);
  stepMonths(city, 12 * (YEARS / 2));
  const loaded: SimulationLike = loadCity(saveCity(city));
  stepMonths(loaded, 12 * (YEARS / 2));

  assert.equal(hashCity(loaded), hashCity(uninterrupted));
});
