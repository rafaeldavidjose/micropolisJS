import { GameMap } from '../src/gameMap.js';
import { MapGenerator } from '../src/mapGenerator.js';
import { Simulation } from '../src/simulation.js';
import { Random } from '../src/random.ts';
import { answerBudgetWindow } from './budget.ts';
import { getCensus, getValves, moveSprites } from './engine.ts';
import type {
  CensusLike,
  CityState,
  CreateCityOptions,
  SaveData,
  SimulationLike,
  ValvesLike,
} from './types.ts';

// Same defaults as MapGenerator and GameMap
const MAP_WIDTH: number = 120;
const MAP_HEIGHT: number = 100;

/* Speed only sets how often the power, pollution, crime, density and fire
 * scans run. Fixing it keeps that cadence the same in every run. SPEED_MED
 * is also what Game.js uses for a new city. */
const HEADLESS_SPEED: number = Simulation.SPEED_MED;

// One forceTick is one phase, 16 phases make a time unit, 4 units a month
const PHASES_PER_TIME_UNIT: number = 16;
const TIME_UNITS_PER_MONTH: number = 4;
const TICKS_PER_MONTH: number = PHASES_PER_TIME_UNIT * TIME_UNITS_PER_MONTH;

/* The original game calls MoveObjects on every pass of its loop and runs a
 * phase on every third pass at medium speed, so sprites move 3 times per
 * phase. The browser moves them once per animation frame instead, which
 * depends on the screen. */
const SPRITE_MOVES_PER_TICK: number = 3;

// The engine keeps no seed, saveCity needs it to make loads reproducible
const citySeeds: WeakMap<SimulationLike, number> = new WeakMap();

function createCity(options: CreateCityOptions): SimulationLike {
  Random.setSeed(options.seed);

  const map: unknown = MapGenerator(MAP_WIDTH, MAP_HEIGHT);
  const city: SimulationLike = new Simulation(map, options.level,
    HEADLESS_SPEED, null);
  city.disasterManager.disastersEnabled = !!options.disasters;
  citySeeds.set(city, options.seed);

  return city;
}

function stepMonths(city: SimulationLike, monthCount: number): void {
  const tickCount: number = monthCount * TICKS_PER_MONTH;

  for (let tick: number = 0; tick < tickCount; tick++) {
    // The engine turns auto budget off in the tick that opens the window
    const autoBudgetWasOn: boolean = city.budget.autoBudget;

    city.forceTick();

    // forceTick does nothing while this is set, so answer it right away
    if (city.budget.awaitingValues) {
      answerBudgetWindow(city, autoBudgetWasOn);
    }

    for (let move: number = 0; move < SPRITE_MOVES_PER_TICK; move++) {
      moveSprites(city);
    }
  }
}

// Mirrors Evaluation's private getUnemployment, nothing else exposes it
function getUnemployment(census: CensusLike): number {
  const workerCount: number = (census.comPop + census.indPop) * 8;

  if (workerCount === 0) {
    return 0;
  }

  const ratio: number = census.resPop / workerCount;
  return Math.min(Math.round((ratio - 1) * 255), 255);
}

// Mirrors Evaluation's private getFireSeverity
function getFireSeverity(census: CensusLike): number {
  return Math.min(census.firePop * 5, 255);
}

function getState(city: SimulationLike): CityState {
  const census: CensusLike = getCensus(city);
  const valves: ValvesLike = getValves(city);

  return {
    date: city.getDate(),
    funds: city.budget.totalFunds,
    population: city.evaluation.cityPop,
    score: city.evaluation.cityScore,
    cityClass: city.evaluation.cityClass,
    approval: city.evaluation.cityYes,
    rci: {
      residential: valves.resValve,
      commercial: valves.comValve,
      industrial: valves.indValve,
    },
    problems: {
      crime: census.crimeAverage,
      pollution: census.pollutionAverage,
      housing: (census.landValueAverage * 7) / 10,
      taxes: city.budget.cityTax * 10,
      // Only set by a yearly evaluation with population, and never saved
      traffic: census.trafficAverage ?? 0,
      unemployment: getUnemployment(census),
      fire: getFireSeverity(census),
    },
    poweredZoneCount: census.poweredZoneCount,
    unpoweredZoneCount: census.unpoweredZoneCount,
    taxRate: city.budget.cityTax,
  };
}

function saveCity(city: SimulationLike): SaveData {
  const seed: number | undefined = citySeeds.get(city);

  if (seed === undefined) {
    throw new Error('saveCity only works on cities from createCity ' +
      'or loadCity');
  }

  const data: SaveData = {} as SaveData;
  city.save(data);
  data.seed = seed;
  data.disastersEnabled = city.disasterManager.disastersEnabled;

  // Census saves its history arrays by reference, so copy them out
  return structuredClone(data);
}

function loadCity(data: SaveData): SimulationLike {
  /* The engine does not save the position of the random generator, so a
   * loaded city cannot continue the original sequence. Reseeding from the
   * seed and the city time makes every load of the same save reproducible.
   * It has to happen before the constructor, which already draws numbers. */
  Random.setSeed(data.seed + data._cityTime);

  const map: unknown = new GameMap(MAP_WIDTH, MAP_HEIGHT);
  const city: SimulationLike = new Simulation(map, data._gameLevel,
    HEADLESS_SPEED, structuredClone(data));

  // load() restores the saved speed, which can be anything, even paused
  city.setSpeed(HEADLESS_SPEED);
  city.disasterManager.disastersEnabled = data.disastersEnabled;
  citySeeds.set(city, data.seed);

  return city;
}

// Callers pass Simulation.LEVEL_* to createCity
export { Simulation };

export { createCity, stepMonths, getState, saveCity, loadCity };
