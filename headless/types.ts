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

// The raw value holds the tile number and its flags together
interface TileLike {
  getValue(): number;
  getRawValue(): number;
  isBulldozable(): boolean;
  isConductive(): boolean;
  isZone(): boolean;
}

interface MapLike {
  width: number;
  height: number;
  getTile(x: number, y: number): TileLike;
  getTileValue(x: number, y: number): number;
}

// Only what the runner and the tornado test use
interface SpriteLike {
  type: number;
  frame: number;
  x: number;
  y: number;
  xOffset: number;
  yOffset: number;
  worldX: number;
  worldY: number;
}

interface SpriteManagerLike {
  moveObjects(simData: unknown): void;
  makeTornado(): void;
  getSprite(type: number): SpriteLike | null;
  getSpriteList(): SpriteLike[];
}

interface CityDate {
  year: number;
  month: number;
}

// A tool from src/gameTools.js. Only building tools have a size
interface ToolLike {
  result: number | null;
  size?: number;
  toolCost: number;
  bulldozerCost: number;
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
  | 'nothing-to-bulldoze'
  | 'no-route'
  | 'stale-plan'
  | 'unknown-action';

// The cost is what was really spent, so it is 0 when the action fails
interface ActionResult {
  success: boolean;
  cost: number;
  reason: ActionFailure | null;
}

interface Position {
  x: number;
  y: number;
}

// 'existing' already has the same kind and costs nothing
type RouteTileKind = 'new' | 'bridge' | 'existing';

interface RouteTile {
  x: number;
  y: number;
  cost: number;
  kind: RouteTileKind;
}

/* A planned route with the engine's cost. The fingerprint holds the tiles
 * the result depends on, as they were when the plan was made. */
interface RoutePlan {
  success: boolean;
  cost: number;
  reason: ActionFailure | null;
  tool: string;
  tiles: RouteTile[];
  fingerprint: number[];
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

/* Actions as plain data, so an agent can write them as JSON. A route is
 * planned again when it is applied, so earlier actions of the same turn
 * count. */
interface BuildAction {
  type: 'build';
  tool: string;
  x: number;
  y: number;
}

interface RouteAction {
  type: 'route';
  tool: string;
  from: Position;
  to: Position;
}

interface BulldozeAction {
  type: 'bulldoze';
  x: number;
  y: number;
}

interface TaxAction {
  type: 'setTaxRate';
  rate: number;
}

interface BudgetAction {
  type: 'setBudgetPercentages';
  road: number;
  fire: number;
  police: number;
}

interface AutoBudgetAction {
  type: 'setAutoBudget';
  enabled: boolean;
}

type GameAction =
  | BuildAction
  | RouteAction
  | BulldozeAction
  | TaxAction
  | BudgetAction
  | AutoBudgetAction;

interface MapView {
  width: number;
  height: number;
  getTileValue(x: number, y: number): number;
}

/* What an agent sees at the start of a turn. Quotes and plans are made
 * against the city as it is then, before any of the agent's actions. */
interface CityView {
  turn: number;
  maxActions: number;
  state: CityState;
  map: MapView;
  budgetLog: BudgetWindowRecord[];
  quote(action: GameAction): ActionResult;
  planRoute(tool: string, from: Position, to: Position): RoutePlan;
}

// decide may return a promise, so an agent can wait for a language model
interface Agent {
  name: string;
  decide(view: CityView): GameAction[] | Promise<GameAction[]>;
  settings?(): Record<string, unknown>;
  report?(): Record<string, unknown>;
}

interface GameOptions {
  seed: number;
  level: number;
  disasters: boolean;
  turns: number;
  monthsPerTurn: number;
  maxActionsPerTurn: number;
  recordMap: boolean;
  recordSprites: boolean;
}

// tiles is set for a route that had a plan, as [x, y] along the route
interface AppliedAction {
  action: unknown;
  result: ActionResult;
  tiles?: [number, number][];
}

/* One turn of a run. The state and the map changes are from the start of
 * the turn, when the agent decided. The budget windows were answered while
 * the city was stepped after the actions. */
interface TurnLog {
  turn: number;
  date: CityDate;
  state: CityState;
  mapChanges: [number, number][];
  actions: AppliedAction[];
  dropped: number;
  budgetWindows: BudgetWindowRecord[];
  sprites: SpriteSample[];
  agent: Record<string, unknown> | null;
}

/* A sprite as the browser draws it: type, frame, and the top left corner
 * of its image in map pixels. */
type SpriteRecord = [number, number, number, number];

/* The sprites after a number of samples into the turn, from 1 to
 * samplesPerTurn. Only samples with at least one sprite are kept. */
type SpriteSample = [number, SpriteRecord[]];

// Map tiles are raw values, with the flag bits of src/tileFlags.ts
interface RunLog {
  version: number;
  options: GameOptions;
  agent: { name: string; settings: Record<string, unknown> | null };
  map: { width: number; height: number; tiles: number[] } | null;
  spriteSampling: { ticksPerSample: number; samplesPerTurn: number } | null;
  turns: TurnLog[];
  final: {
    date: CityDate;
    state: CityState;
    mapChanges: [number, number][];
    hash: string;
  };
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
  Agent,
  AppliedAction,
  BudgetLike,
  BudgetPercentages,
  BudgetWindowRecord,
  CensusLike,
  CityDate,
  CityState,
  CityView,
  CreateCityOptions,
  GameAction,
  GameOptions,
  MapLike,
  MapView,
  Position,
  RoutePlan,
  RouteTile,
  RouteTileKind,
  RunLog,
  SaveData,
  SimulationLike,
  SpriteLike,
  SpriteRecord,
  SpriteSample,
  TileLike,
  ToolLike,
  ToolMap,
  TurnLog,
  ValvesLike,
};
