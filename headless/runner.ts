/* headless/runner.ts
 *
 * Seed a city, step it forward, read back its state. No action API yet,
 * so nothing builds roads or zones. See README.md.
 */

import { GameMap } from '../src/gameMap.js';
import { MapGenerator } from '../src/mapGenerator.js';
import { Simulation } from '../src/simulation.js';
import { Random } from '../src/random.ts';
import type { CensusLike, CityState, CreateCityOptions, SaveData, SimulationLike } from './types.ts';

// Same defaults as MapGenerator/GameMap
const MAP_WIDTH = 120;
const MAP_HEIGHT = 100;

// Fixed speed means a fixed cadence for the power/pollution/crime scans.
// SPEED_MED matches Game.js's own default for a new city.
const HEADLESS_SPEED = Simulation.SPEED_MED;

// The phaseCycle wraps every 16 forceTick() calls, 4 of those per month
const PHASES_PER_TIME_UNIT = 16;
const TIME_UNITS_PER_MONTH = 4;
const TICKS_PER_MONTH = PHASES_PER_TIME_UNIT * TIME_UNITS_PER_MONTH;

// The engine keeps no seed, saveCity needs it to make loads reproducible
const citySeeds = new WeakMap<SimulationLike, number>();

function createCity(options: CreateCityOptions): SimulationLike {
  Random.setSeed(options.seed);
  const map = MapGenerator(MAP_WIDTH, MAP_HEIGHT);
  const sim = new Simulation(map, options.level, HEADLESS_SPEED, null) as unknown as SimulationLike;
  sim.disasterManager.disastersEnabled = !!options.disasters;
  citySeeds.set(sim, options.seed);
  return sim;
}

function stepMonths(sim: SimulationLike, months: number): void {
  const ticks = months * TICKS_PER_MONTH;
  for (let i = 0; i < ticks; i++) {
    sim.forceTick();
  }
}

// Mirrors Evaluation's private getUnemployment, nothing else exposes this
function unemployment(census: CensusLike): number {
  const workers = (census.comPop + census.indPop) * 8;
  if (workers === 0) {
    return 0;
  }
  const ratio = census.resPop / workers;
  return Math.min(Math.round((ratio - 1) * 255), 255);
}

// Mirrors Evaluation's private getFireSeverity
function fireSeverity(census: CensusLike): number {
  return Math.min(census.firePop * 5, 255);
}

function getState(sim: SimulationLike): CityState {
  const census = sim._census;
  const budget = sim.budget;
  const evaluation = sim.evaluation;
  const valves = sim._valves;

  return {
    date: sim.getDate(),
    funds: budget.totalFunds,
    population: evaluation.cityPop,
    score: evaluation.cityScore,
    cityClass: evaluation.cityClass,
    approval: evaluation.cityYes,
    rci: {
      residential: valves.resValve,
      commercial: valves.comValve,
      industrial: valves.indValve,
    },
    problems: {
      crime: census.crimeAverage,
      pollution: census.pollutionAverage,
      housing: (census.landValueAverage * 7) / 10,
      taxes: budget.cityTax * 10,
      // Unset until the first cityEvaluation() call happens
      traffic: census.trafficAverage ?? 0,
      unemployment: unemployment(census),
      fire: fireSeverity(census),
    },
    poweredZoneCount: census.poweredZoneCount,
    unpoweredZoneCount: census.unpoweredZoneCount,
    taxRate: budget.cityTax,
  };
}

function saveCity(sim: SimulationLike): SaveData {
  const seed = citySeeds.get(sim);
  if (seed === undefined) {
    throw new Error('saveCity only works on cities from createCity or loadCity');
  }

  const data = {} as SaveData;
  sim.save(data);
  data.seed = seed;
  data.disastersEnabled = sim.disasterManager.disastersEnabled;
  return data;
}

function loadCity(data: SaveData): SimulationLike {
  /* The engine does not save the position of the random generator, so a
   * loaded city cannot continue the original sequence. Reseeding from the
   * seed and the city time makes every load of the same save reproducible.
   * It has to happen before the constructor, which already draws numbers. */
  Random.setSeed(data.seed + data._cityTime);

  const map = new GameMap(MAP_WIDTH, MAP_HEIGHT);
  const sim = new Simulation(map, data._gameLevel, HEADLESS_SPEED, data) as unknown as SimulationLike;

  // load() restores the saved speed, which can be anything, even paused
  sim.setSpeed(HEADLESS_SPEED);
  sim.disasterManager.disastersEnabled = data.disastersEnabled;
  citySeeds.set(sim, data.seed);
  return sim;
}

// So callers can pass Simulation.LEVEL_* without us reinventing it
export { Simulation };

export {
  MAP_WIDTH,
  MAP_HEIGHT,
  HEADLESS_SPEED,
  TICKS_PER_MONTH,
  createCity,
  stepMonths,
  getState,
  saveCity,
  loadCity,
};
