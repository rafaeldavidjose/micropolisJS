// src/*.js has no types, so these describe only what headless/ uses

interface CensusLike {
  crimeAverage: number;
  pollutionAverage: number;
  landValueAverage: number;
  trafficAverage: number | undefined;
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
  cityYes: number;
}

interface ValvesLike {
  resValve: number;
  comValve: number;
  indValve: number;
}

interface DisasterManagerLike {
  disastersEnabled: boolean;
}

interface CityDate {
  year: number;
  month: number;
}

// A tool from src/gameTools.js. Only building tools have a size
interface ToolLike {
  result: number | null;
  size?: number;
  TOOLRESULT_OK: number;
  TOOLRESULT_FAILED: number;
  TOOLRESULT_NO_MONEY: number;
  TOOLRESULT_NEEDS_BULLDOZE: number;
  doTool(x: number, y: number, blockMaps: unknown): void;
  modifyIfEnoughFunding(budget: BudgetLike): boolean;
  clear(): void;
}

type ToolMap = Record<string, ToolLike>;

// The private fields are read in engine.ts only
interface SimulationLike {
  budget: BudgetLike;
  evaluation: EvaluationLike;
  disasterManager: DisasterManagerLike;
  blockMaps: unknown;
  getDate(): CityDate;
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
  level: number;
  disasters?: boolean;
}

interface CityState {
  date: CityDate;
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
  BudgetLike,
  CensusLike,
  CityDate,
  CityState,
  CreateCityOptions,
  SaveData,
  SimulationLike,
  ToolLike,
  ToolMap,
  ValvesLike,
};
