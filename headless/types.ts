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

/* The three percents are fractions from 0 to 1 in the engine. The effects
 * run up to 32 for roads and 1,000 for police and fire. */
interface BudgetLike {
  awaitingValues: boolean;
  autoBudget: boolean;
  totalFunds: number;
  cityTax: number;
  roadPercent: number;
  firePercent: number;
  policePercent: number;
  roadEffect: number;
  policeEffect: number;
  fireEffect: number;
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
  resCap: boolean;
  comCap: boolean;
  indCap: boolean;
}

interface DisasterManagerLike {
  disastersEnabled: boolean;
}

// One value for every blockSize by blockSize tiles, as in src/blockMap.ts
interface BlockMapLike {
  blockSize: number;
  width: number;
  height: number;
  get(blockX: number, blockY: number): number;
}

// The block maps the query tool reads, the only ones headless/ uses
interface BlockMapsLike {
  populationDensityMap: BlockMapLike;
  landValueMap: BlockMapLike;
  crimeRateMap: BlockMapLike;
  pollutionDensityMap: BlockMapLike;
  rateOfGrowthMap: BlockMapLike;
}

// The raw value holds the tile number and its flags together
interface TileLike {
  getValue(): number;
  getRawValue(): number;
  isBulldozable(): boolean;
  isConductive(): boolean;
  isPowered(): boolean;
  isZone(): boolean;
}

// setTo takes a Tile from src/tile.ts, which only the tests use
interface MapLike {
  width: number;
  height: number;
  getTile(x: number, y: number): TileLike;
  getTileValue(x: number, y: number): number;
  setTo(x: number, y: number, tile: unknown): void;
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
  blockMaps: BlockMapsLike;
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

/* A zone or building by its centre tile, with the power a player sees:
 * the browser blinks a lightning bolt on the centre of one without power. */
interface ZoneView {
  x: number;
  y: number;
  tile: number;
  powered: boolean;
}

/* A block map copied at the start of the turn. Blocks are counted from 0,
 * 0 in the top left, and one covers blockSize by blockSize tiles. */
interface BlockMapView {
  blockSize: number;
  width: number;
  height: number;
  get(blockX: number, blockY: number): number;
}

/* The five maps the query tool of the browser reads for a tile. It shows
 * them as four levels each, here they are the engine's values. */
interface CityBlockMaps {
  populationDensity: BlockMapView;
  landValue: BlockMapView;
  crime: BlockMapView;
  pollution: BlockMapView;
  growth: BlockMapView;
}

/* What an agent sees at the start of a turn. Quotes and plans are made
 * against the city as it is then, before any of the agent's actions. */
interface CityView {
  turn: number;
  maxActions: number;
  level: number;
  state: CityState;
  map: MapView;
  zones: ZoneView[];
  blockMaps: CityBlockMaps;
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

// What createMapHistory in viewer/replay.js returns
interface MapHistory {
  width: number;
  height: number;
  count: number;
  tilesAt(position: number, target?: Uint16Array): Uint16Array;
}

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
  /* Whether the engine holds each demand at 0 or below for want of a
   * stadium, an airport or a seaport, the condition of its "Residents
   * demand a Stadium" messages. It checks once every 64 time units. */
  caps: {
    residential: boolean;
    commercial: boolean;
    industrial: boolean;
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
  // Whole percents, floored as the budget window of the browser shows them
  funding: {
    road: number;
    fire: number;
    police: number;
  };
  autoBudget: boolean;
  effects: {
    road: number;
    police: number;
    fire: number;
  };
}

export type {
  ActionFailure,
  ActionResult,
  Agent,
  AppliedAction,
  BlockMapLike,
  BlockMapView,
  BudgetPercentages,
  BudgetWindowRecord,
  CensusLike,
  CityBlockMaps,
  CityDate,
  CityState,
  CityView,
  CreateCityOptions,
  GameAction,
  GameOptions,
  MapHistory,
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
  ZoneView,
};
