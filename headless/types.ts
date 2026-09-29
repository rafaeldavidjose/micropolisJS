/* headless/types.ts
 *
 * These are just the bits of Simulation that headless/ actually reads
 * or calls, since src/*.js has no TS types.
 */

interface CensusLike {
  crimeAverage: number;       // set by BlockMapUtils.crimeScan
  pollutionAverage: number;   // set by BlockMapUtils.pollutionTerrainLandValueScan
  landValueAverage: number;   // set by BlockMapUtils.pollutionTerrainLandValueScan
  trafficAverage: number | undefined; // set by Evaluation's getTrafficAverage (called once/year from doProblems)
  resPop: number;
  comPop: number;
  indPop: number;
  firePop: number;
  poweredZoneCount: number;
  unpoweredZoneCount: number;
}

interface BudgetLike {
  awaitingValues: boolean;
  totalFunds: number;
  cityTax: number;
}

interface EvaluationLike {
  cityPop: number;
  cityScore: number;
  cityClass: string;
  cityYes: number; // Mayor approval percent, 0 to 100
}

interface ValvesLike {
  resValve: number;
  comValve: number;
  indValve: number;
}

interface DisasterManagerLike {
  disastersEnabled: boolean;
}

interface SimulationLike {
  budget: BudgetLike;
  evaluation: EvaluationLike;
  disasterManager: DisasterManagerLike;
  // Underscore prefixed by convention only, JS doesn't enforce it
  _valves: ValvesLike;
  _census: CensusLike;
  _gameLevel: number;
  _map: unknown;
  blockMaps: unknown;
  getDate(): { year: number; month: number };
  forceTick(): void;
  setSpeed(speed: number): void;
  save(data: Record<string, unknown>): void;
}

// Engine save output plus the two fields saveCity adds
interface SaveData {
  _cityTime: number;
  _gameLevel: number;
  seed: number;
  disastersEnabled: boolean;
  [key: string]: unknown;
}

interface CreateCityOptions {
  seed: number;
  level: number; // Simulation.LEVEL_EASY | LEVEL_MED | LEVEL_HARD
  disasters?: boolean;
}

interface CityState {
  date: { year: number; month: number };
  funds: number;
  population: number;
  score: number;
  cityClass: string;
  approval: number;
  rci: {
    residential: number;
    commercial: number;
    industrial: number;
  };
  problems: {
    crime: number;
    pollution: number;
    housing: number;
    taxes: number;
    traffic: number;
    unemployment: number;
    fire: number;
  };
  poweredZoneCount: number;
  unpoweredZoneCount: number;
  taxRate: number;
}

export type {
  SimulationLike,
  CensusLike,
  BudgetLike,
  EvaluationLike,
  ValvesLike,
  SaveData,
  CreateCityOptions,
  CityState,
};
