import { writeFileSync } from 'node:fs';
import {
  TICKS_PER_MONTH,
  createCity,
  getState,
  stepMonths,
  Simulation,
} from './runner.ts';
import {
  build,
  bulldoze,
  quoteBuild,
  quoteBulldoze,
  quoteSetAutoBudget,
  quoteSetBudgetPercentages,
  quoteSetTaxRate,
  setAutoBudget,
  setBudgetPercentages,
  setTaxRate,
} from './actions.ts';
import { getBudgetLog } from './budget.ts';
import { getMap } from './engine.ts';
import { hashCity } from './hash.ts';
import { buildRoute, planRoute } from './routes.ts';
import type {
  ActionFailure,
  ActionResult,
  Agent,
  AppliedAction,
  BlockMapLike,
  BlockMapView,
  BudgetWindowRecord,
  CityBlockMaps,
  CityView,
  GameAction,
  GameOptions,
  MapLike,
  MapView,
  Position,
  RoutePlan,
  RouteTile,
  RunLog,
  SimulationLike,
  SpriteLike,
  SpriteRecord,
  SpriteSample,
  TileLike,
  TurnLog,
  ZoneView,
} from './types.ts';

const LOG_VERSION: number = 5;
const JSON_INDENT: string = '  ';

/* Sprites move 3 times per tick. A tornado moves about 2 pixels a move
 * and a train 4, so with a sample every time unit (16 ticks) a tornado
 * would jump 6 tiles between samples and a train 12. Every 4 ticks they
 * move about 1.5 and 3 tiles. */
const SPRITE_SAMPLE_TICKS: number = 4;

/* Provisional until the experiment is designed. Level and disasters are
 * what a new game starts with in the browser. 80 turns of 3 months are 20
 * years. */
const DEFAULT_OPTIONS: Omit<GameOptions, 'seed'> = {
  level: Simulation.LEVEL_EASY,
  disasters: false,
  turns: 80,
  monthsPerTurn: 3,
  maxActionsPerTurn: 5,
  recordMap: true,
  recordSprites: true,
};

function fail(reason: ActionFailure): ActionResult {
  return { success: false, cost: 0, reason: reason };
}

function isPosition(value: unknown): value is Position {
  return typeof value === 'object' && value !== null &&
    typeof (value as Position).x === 'number' &&
    typeof (value as Position).y === 'number';
}

// A route quote is its plan, priced against the funds like the other quotes
function quoteRoute(city: SimulationLike, tool: string, from: unknown,
    to: unknown): ActionResult {
  if (!isPosition(from) || !isPosition(to)) {
    return fail('invalid-position');
  }

  const plan: RoutePlan = planRoute(city, tool, from, to);

  if (!plan.success) {
    return fail(plan.reason ?? 'no-route');
  }

  if (city.budget.totalFunds < plan.cost) {
    return { success: false, cost: plan.cost, reason: 'insufficient-funds' };
  }

  return { success: true, cost: plan.cost, reason: null };
}

/* The actions come from agents, later as JSON from a language model, so
 * anything can arrive. Fields of the wrong type fail in the action itself,
 * with invalid-position or invalid-value. */
function quoteAction(city: SimulationLike, action: unknown): ActionResult {
  if (typeof action !== 'object' || action === null) {
    return fail('unknown-action');
  }

  const gameAction: GameAction = action as GameAction;

  switch (gameAction.type) {
    case 'build':
      return quoteBuild(city, gameAction.tool, gameAction.x, gameAction.y);
    case 'route':
      return quoteRoute(city, gameAction.tool, gameAction.from, gameAction.to);
    case 'bulldoze':
      return quoteBulldoze(city, gameAction.x, gameAction.y);
    case 'setTaxRate':
      return quoteSetTaxRate(city, gameAction.rate);
    case 'setBudgetPercentages':
      return quoteSetBudgetPercentages(city,
        {
          road: gameAction.road,
          fire: gameAction.fire,
          police: gameAction.police,
        });
    case 'setAutoBudget':
      return quoteSetAutoBudget(city, gameAction.enabled);
    default:
      return fail('unknown-action');
  }
}

function applyAction(city: SimulationLike, action: unknown): ActionResult {
  if (typeof action !== 'object' || action === null) {
    return fail('unknown-action');
  }

  const gameAction: GameAction = action as GameAction;

  switch (gameAction.type) {
    case 'build':
      return build(city, gameAction.tool, gameAction.x, gameAction.y);
    case 'route': {
      if (!isPosition(gameAction.from) || !isPosition(gameAction.to)) {
        return fail('invalid-position');
      }

      const plan: RoutePlan = planRoute(city, gameAction.tool,
        gameAction.from, gameAction.to);

      return buildRoute(city, plan);
    }
    case 'bulldoze':
      return bulldoze(city, gameAction.x, gameAction.y);
    case 'setTaxRate':
      return setTaxRate(city, gameAction.rate);
    case 'setBudgetPercentages':
      return setBudgetPercentages(city,
        {
          road: gameAction.road,
          fire: gameAction.fire,
          police: gameAction.police,
        });
    case 'setAutoBudget':
      return setAutoBudget(city, gameAction.enabled);
    default:
      return fail('unknown-action');
  }
}

/* Like applyAction, but a route also keeps the tiles of its plan, so a
 * replay can draw it. A route that failed for lack of money keeps the
 * tiles it would have taken. */
function playAction(city: SimulationLike, action: unknown): AppliedAction {
  const gameAction: GameAction = action as GameAction;

  if (typeof action !== 'object' || action === null ||
      gameAction.type !== 'route' || !isPosition(gameAction.from) ||
      !isPosition(gameAction.to)) {
    return { action: action, result: applyAction(city, action) };
  }

  const plan: RoutePlan = planRoute(city, gameAction.tool, gameAction.from,
    gameAction.to);
  const result: ActionResult = buildRoute(city, plan);

  if (!plan.success) {
    return { action: action, result: result };
  }

  return {
    action: action,
    result: result,
    tiles: plan.tiles.map((tile: RouteTile): [number, number] =>
      [tile.x, tile.y]),
  };
}

// Raw values, so the log keeps the flags too, for example the power bit
function readTiles(map: MapLike): number[] {
  const tiles: number[] = [];

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      tiles.push(map.getTile(x, y).getRawValue());
    }
  }

  return tiles;
}

// Tile index and new value for every tile that changed, in map order
function diffTiles(before: number[], after: number[]): [number, number][] {
  const changes: [number, number][] = [];

  for (let index: number = 0; index < after.length; index++) {
    if (after[index] !== before[index]) {
      changes.push([index, after[index]]);
    }
  }

  return changes;
}

function readZones(map: MapLike): ZoneView[] {
  const zones: ZoneView[] = [];

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      const tile: TileLike = map.getTile(x, y);

      if (tile.isZone()) {
        zones.push({
          x: x,
          y: y,
          tile: tile.getValue(),
          powered: tile.isPowered(),
        });
      }
    }
  }

  return zones;
}

/* A copy, so the agent can neither change the engine's map nor see it
 * change after the turn. Off the grid it throws, like getTileValue. */
function copyBlockMap(blockMap: BlockMapLike): BlockMapView {
  const values: number[] = [];

  for (let blockY: number = 0; blockY < blockMap.height; blockY++) {
    for (let blockX: number = 0; blockX < blockMap.width; blockX++) {
      values.push(blockMap.get(blockX, blockY));
    }
  }

  return {
    blockSize: blockMap.blockSize,
    width: blockMap.width,
    height: blockMap.height,
    get: (blockX: number, blockY: number): number => {
      if (!Number.isInteger(blockX) || !Number.isInteger(blockY) ||
          blockX < 0 || blockY < 0 || blockX >= blockMap.width ||
          blockY >= blockMap.height) {
        throw new Error('Block ' + blockX + ', ' + blockY +
          ' is off the map');
      }

      return values[blockY * blockMap.width + blockX];
    },
  };
}

// What the query tool reads for a tile (src/queryTool.js)
function readBlockMaps(city: SimulationLike): CityBlockMaps {
  return {
    populationDensity: copyBlockMap(city.blockMaps.populationDensityMap),
    landValue: copyBlockMap(city.blockMaps.landValueMap),
    crime: copyBlockMap(city.blockMaps.crimeRateMap),
    pollution: copyBlockMap(city.blockMaps.pollutionDensityMap),
    growth: copyBlockMap(city.blockMaps.rateOfGrowthMap),
  };
}

// Only reads the sprite list, so it draws no random number
function readSprites(city: SimulationLike): SpriteRecord[] {
  return city.spriteManager.getSpriteList()
    .filter((sprite: SpriteLike): boolean => sprite.frame !== 0)
    .map((sprite: SpriteLike): SpriteRecord => [sprite.type, sprite.frame,
      sprite.x + sprite.xOffset, sprite.y + sprite.yOffset]);
}

function makeView(city: SimulationLike, settings: GameOptions,
    turn: number): CityView {
  const map: MapLike = getMap(city);
  const mapView: MapView = {
    width: map.width,
    height: map.height,
    getTileValue: (x: number, y: number): number => map.getTileValue(x, y),
  };

  return {
    turn: turn,
    maxActions: settings.maxActionsPerTurn,
    level: settings.level,
    state: getState(city),
    map: mapView,
    zones: readZones(map),
    blockMaps: readBlockMaps(city),
    budgetLog: getBudgetLog(city),
    quote: (action: GameAction): ActionResult => quoteAction(city, action),
    planRoute: (tool: string, from: Position, to: Position): RoutePlan =>
      planRoute(city, tool, from, to),
  };
}

/* Plays one game. Each turn the agent sees the city and returns actions,
 * the actions are applied in order, and the city runs for monthsPerTurn
 * months. Actions past maxActionsPerTurn are dropped and counted. */
async function runGame(agent: Agent,
    options: Partial<GameOptions> & { seed: number }): Promise<RunLog> {
  const settings: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  const city: SimulationLike = createCity({
    seed: settings.seed,
    level: settings.level,
    disasters: settings.disasters,
  });
  const map: MapLike = getMap(city);
  const firstTiles: number[] = readTiles(map);
  let lastTiles: number[] = firstTiles;
  const turns: TurnLog[] = [];

  for (let turn: number = 0; turn < settings.turns; turn++) {
    const tiles: number[] = settings.recordMap ? readTiles(map) : [];
    const view: CityView = makeView(city, settings, turn);
    const chosen: GameAction[] = await agent.decide(view);
    const actions: unknown[] = Array.isArray(chosen) ? chosen : [];
    const applied: AppliedAction[] = actions
      .slice(0, settings.maxActionsPerTurn)
      .map((action: unknown): AppliedAction => playAction(city, action));
    const windowsBefore: number = getBudgetLog(city).length;
    const sprites: SpriteSample[] = [];

    stepMonths(city, settings.monthsPerTurn, (tick: number): void => {
      if (!settings.recordSprites || (tick + 1) % SPRITE_SAMPLE_TICKS !== 0) {
        return;
      }

      const seen: SpriteRecord[] = readSprites(city);

      if (seen.length > 0) {
        sprites.push([(tick + 1) / SPRITE_SAMPLE_TICKS, seen]);
      }
    });

    turns.push({
      turn: turn,
      date: view.state.date,
      state: view.state,
      mapChanges: settings.recordMap ? diffTiles(lastTiles, tiles) : [],
      actions: applied,
      dropped: Math.max(0, actions.length - settings.maxActionsPerTurn),
      budgetWindows: getBudgetLog(city).slice(windowsBefore),
      sprites: sprites,
      agent: agent.report ? agent.report() : null,
    });
    lastTiles = settings.recordMap ? tiles : lastTiles;
  }

  const finalTiles: number[] = settings.recordMap ? readTiles(map) : [];

  return {
    version: LOG_VERSION,
    options: settings,
    agent: {
      name: agent.name,
      settings: agent.settings ? agent.settings() : null,
    },
    map: settings.recordMap ?
      { width: map.width, height: map.height, tiles: firstTiles } : null,
    spriteSampling: settings.recordSprites ? {
      ticksPerSample: SPRITE_SAMPLE_TICKS,
      samplesPerTurn: settings.monthsPerTurn * TICKS_PER_MONTH /
        SPRITE_SAMPLE_TICKS,
    } : null,
    turns: turns,
    final: {
      date: city.getDate(),
      state: getState(city),
      mapChanges: settings.recordMap ? diffTiles(lastTiles, finalTiles) : [],
      hash: hashCity(city),
    },
  };
}

// A number, or an array of nothing but numbers and such arrays
function isNumeric(value: unknown): boolean {
  return typeof value === 'number' ||
    (Array.isArray(value) && value.every(isNumeric));
}

/* JSON indented by two spaces, with arrays of numbers on one line: a
 * turn's map changes, a route's tiles and each sprite sample take a line,
 * and the first map a line per row. Indenting those too makes a log of
 * 1,000 turns about three times as big. rowLength is the map width for the
 * tiles of the first map. */
function formatJson(value: unknown, indent: string, key: string,
    rowLength: number): string {
  const inner: string = indent + JSON_INDENT;

  if (Array.isArray(value)) {
    if (value.length === 0 ||
        (rowLength === 0 && key !== 'sprites' && isNumeric(value))) {
      return JSON.stringify(value);
    }

    const lines: string[] = [];

    if (rowLength > 0) {
      for (let start: number = 0; start < value.length; start += rowLength) {
        lines.push(inner +
          JSON.stringify(value.slice(start, start + rowLength)).slice(1, -1));
      }
    } else {
      for (const item of value) {
        lines.push(inner + (key === 'sprites' ? JSON.stringify(item) :
          formatJson(item, inner, '', 0)));
      }
    }

    return '[\n' + lines.join(',\n') + '\n' + indent + ']';
  }

  if (typeof value === 'object' && value !== null) {
    const entries: [string, unknown][] = Object.entries(value);
    const width: number = key === 'map' ?
      (value as NonNullable<RunLog['map']>).width : 0;

    if (entries.length === 0) {
      return '{}';
    }

    return '{\n' + entries.map(([name, item]: [string, unknown]): string =>
      inner + JSON.stringify(name) + ': ' +
      formatJson(item, inner, name, name === 'tiles' ? width : 0))
      .join(',\n') + '\n' + indent + '}';
  }

  return JSON.stringify(value);
}

/* The round trip through JSON.stringify drops what JSON drops, like fields
 * left undefined, so the file reads back as the same log. */
function writeRunLog(path: string, log: RunLog): void {
  writeFileSync(path,
    formatJson(JSON.parse(JSON.stringify(log)), '', '', 0) + '\n');
}

// Collects every budget window of a run, for counting shortages
function allBudgetWindows(log: RunLog): BudgetWindowRecord[] {
  return log.turns.flatMap(
    (turn: TurnLog): BudgetWindowRecord[] => turn.budgetWindows);
}

export {
  DEFAULT_OPTIONS,
  allBudgetWindows,
  applyAction,
  makeView,
  runGame,
  writeRunLog,
};
