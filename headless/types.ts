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

// The three percents are fractions from 0 to 1 in the engine
interface BudgetLike {
  awaitingValues: boolean;
  autoBudget: boolean;
  totalFunds: number;
  cityTax: number;
  roadPercent: number;
  firePercent: number;
  policePercent: number;
  taxFund: number;
  doBudgetWindow(): void;
  setTax(rate: number): void;
  setFunds(amount: number): void;
  setAutoBudget(enabled: boolean): void;
  updateFundEffects(): void;
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

interface MapLike {
  width: number;
  height: number;
  getTileValue(x: number, y: number): number;
}

// Only what the runner and the tornado test use
interface SpriteLike {
  type: number;
  frame: number;
  worldX: number;
  worldY: number;
}

interface SpriteManagerLike {
  moveObjects(simData: unknown): void;
  makeTornado(): void;
  getSprite(type: number): SpriteLike | null;
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
  spriteManager: SpriteManagerLike;
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

type ActionFailure =
  | 'unknown-tool'
  | 'invalid-position'
  | 'invalid-value'
  | 'insufficient-funds'
  | 'occupied'
  | 'blocked'
  | 'nothing-to-bulldoze';

// The cost is what was really spent, so it is 0 when the action fails
interface ActionResult {
  success: boolean;
  cost: number;
  reason: ActionFailure | null;
}

// Whole numbers from 0 to 100, like the sliders in the budget window
interface BudgetPercentages {
  road: number;
  fire: number;
  police: number;
}

/* One answered budget window. The funds are from before the yearly taxes
 * and spending, fundsAfter from after them. Road, fire and police are the
 * percent of full funding the city could pay. */
interface BudgetWindowRecord {
  date: CityDate;
  funds: number;
  taxes: number;
  fundsAfter: number;
  road: number;
  fire: number;
  police: number;
  autoBudgetWasOn: boolean;
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
  ActionFailure,
  ActionResult,
  BudgetLike,
  BudgetPercentages,
  BudgetWindowRecord,
  CensusLike,
  CityDate,
  CityState,
  CreateCityOptions,
  MapLike,
  SaveData,
  SimulationLike,
  SpriteLike,
  ToolLike,
  ToolMap,
  ValvesLike,
};
