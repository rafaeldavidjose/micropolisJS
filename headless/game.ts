import { writeFileSync } from 'node:fs';
import { createCity, getState, stepMonths, Simulation } from './runner.ts';
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
  BudgetWindowRecord,
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
  TurnLog,
} from './types.ts';

const LOG_VERSION: number = 2;

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

  const a: GameAction = action as GameAction;

  switch (a.type) {
    case 'build':
      return quoteBuild(city, a.tool, a.x, a.y);
    case 'route':
      return quoteRoute(city, a.tool, a.from, a.to);
    case 'bulldoze':
      return quoteBulldoze(city, a.x, a.y);
    case 'setTaxRate':
      return quoteSetTaxRate(city, a.rate);
    case 'setBudgetPercentages':
      return quoteSetBudgetPercentages(city,
        { road: a.road, fire: a.fire, police: a.police });
    case 'setAutoBudget':
      return quoteSetAutoBudget(city, a.enabled);
    default:
      return fail('unknown-action');
  }
}

function applyAction(city: SimulationLike, action: unknown): ActionResult {
  if (typeof action !== 'object' || action === null) {
    return fail('unknown-action');
  }

  const a: GameAction = action as GameAction;

  switch (a.type) {
    case 'build':
      return build(city, a.tool, a.x, a.y);
    case 'route': {
      if (!isPosition(a.from) || !isPosition(a.to)) {
        return fail('invalid-position');
      }

      const plan: RoutePlan = planRoute(city, a.tool, a.from, a.to);
      return buildRoute(city, plan);
    }
    case 'bulldoze':
      return bulldoze(city, a.x, a.y);
    case 'setTaxRate':
      return setTaxRate(city, a.rate);
    case 'setBudgetPercentages':
      return setBudgetPercentages(city,
        { road: a.road, fire: a.fire, police: a.police });
    case 'setAutoBudget':
      return setAutoBudget(city, a.enabled);
    default:
      return fail('unknown-action');
  }
}

/* Like applyAction, but a route also keeps the tiles of its plan, so a
 * replay can draw it. A route that failed for lack of money keeps the
 * tiles it would have taken. */
function playAction(city: SimulationLike, action: unknown): AppliedAction {
  const a: GameAction = action as GameAction;

  if (typeof action !== 'object' || action === null || a.type !== 'route' ||
      !isPosition(a.from) || !isPosition(a.to)) {
    return { action: action, result: applyAction(city, action) };
  }

  const plan: RoutePlan = planRoute(city, a.tool, a.from, a.to);
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

  for (let i: number = 0; i < after.length; i++) {
    if (after[i] !== before[i]) {
      changes.push([i, after[i]]);
    }
  }

  return changes;
}

function makeView(city: SimulationLike, turn: number,
    maxActions: number): CityView {
  const map: MapLike = getMap(city);
  const mapView: MapView = {
    width: map.width,
    height: map.height,
    getTileValue: (x: number, y: number): number => map.getTileValue(x, y),
  };

  return {
    turn: turn,
    maxActions: maxActions,
    state: getState(city),
    map: mapView,
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
    const view: CityView = makeView(city, turn, settings.maxActionsPerTurn);
    const chosen: GameAction[] = await agent.decide(view);
    const actions: unknown[] = Array.isArray(chosen) ? chosen : [];
    const applied: AppliedAction[] = actions
      .slice(0, settings.maxActionsPerTurn)
      .map((action: unknown): AppliedAction => playAction(city, action));
    const windowsBefore: number = getBudgetLog(city).length;

    stepMonths(city, settings.monthsPerTurn);

    turns.push({
      turn: turn,
      date: view.state.date,
      state: view.state,
      mapChanges: settings.recordMap ? diffTiles(lastTiles, tiles) : [],
      actions: applied,
      dropped: Math.max(0, actions.length - settings.maxActionsPerTurn),
      budgetWindows: getBudgetLog(city).slice(windowsBefore),
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
    turns: turns,
    final: {
      date: city.getDate(),
      state: getState(city),
      mapChanges: settings.recordMap ? diffTiles(lastTiles, finalTiles) : [],
      hash: hashCity(city),
    },
  };
}

function writeRunLog(path: string, log: RunLog): void {
  writeFileSync(path, JSON.stringify(log));
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
  quoteAction,
  runGame,
  writeRunLog,
};
