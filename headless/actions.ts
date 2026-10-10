import { getMap, getPendingCost, getTools } from './engine.ts';
import { ZoneUtils } from '../src/zoneUtils.js';
import { DIRT } from '../src/tileValues.ts';
import type {
  ActionFailure,
  ActionResult,
  BudgetPercentages,
  SimulationLike,
  TileLike,
  ToolLike,
} from './types.ts';

// Every tool in src/gameTools.js except the bulldozer and the query tool
const BUILD_TOOLS: readonly string[] = [
  'airport',
  'coal',
  'commercial',
  'fire',
  'industrial',
  'nuclear',
  'park',
  'police',
  'port',
  'rail',
  'residential',
  'road',
  'stadium',
  'wire',
];

// Same limits as the sliders in index.html
const MAX_TAX_RATE: number = 20;
const MAX_PERCENT: number = 100;

function succeed(cost: number): ActionResult {
  return { success: true, cost: cost, reason: null };
}

function fail(reason: ActionFailure): ActionResult {
  return { success: false, cost: 0, reason: reason };
}

function isWholeNumberUpTo(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

/* Buildings are placed by their centre tile, which is one tile right and
 * down of the top left corner for every size. The whole site has to be on
 * the map. Other tools use a single tile. */
function isSiteOnMap(city: SimulationLike, tool: ToolLike, x: number,
    y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return false;
  }

  const size: number = tool.size ?? 1;
  const left: number = size > 1 ? x - 1 : x;
  const top: number = size > 1 ? y - 1 : y;

  return left >= 0 && top >= 0 &&
    left + size <= getMap(city).width &&
    top + size <= getMap(city).height;
}

/* doTool only prepares the change. modifyIfEnoughFunding applies it and
 * charges for it, or drops it when the tool failed or the funds are too
 * low. The engine reports one failure for everything it cannot do that is
 * not an occupied site, so the caller says what that means for its tool. */
function useTool(city: SimulationLike, tool: ToolLike, x: number, y: number,
    failedReason: ActionFailure): ActionResult {
  const fundsBefore: number = city.budget.totalFunds;

  try {
    tool.doTool(x, y, city.blockMaps);

    if (tool.modifyIfEnoughFunding(city.budget)) {
      return succeed(fundsBefore - city.budget.totalFunds);
    }

    if (tool.result === tool.TOOLRESULT_NO_MONEY) {
      return fail('insufficient-funds');
    }

    if (tool.result === tool.TOOLRESULT_NEEDS_BULLDOZE) {
      return fail('occupied');
    }

    return fail(failedReason);
  } finally {
    tool.clear();
  }
}

/* What useTool would answer for a tool result and its price. A quote keeps
 * the price when only the money is missing, so the agent knows how much it
 * needs. */
function priceResult(city: SimulationLike, tool: ToolLike, result: number,
    cost: number, failedReason: ActionFailure): ActionResult {
  if (result === tool.TOOLRESULT_NEEDS_BULLDOZE) {
    return fail('occupied');
  }

  if (result !== tool.TOOLRESULT_OK) {
    return fail(failedReason);
  }

  if (city.budget.totalFunds < cost) {
    return { success: false, cost: cost, reason: 'insufficient-funds' };
  }

  return succeed(cost);
}

// useTool without applying: the tool fills its buffer, then it is cleared
function quoteTool(city: SimulationLike, tool: ToolLike, x: number,
    y: number, failedReason: ActionFailure): ActionResult {
  try {
    tool.doTool(x, y, city.blockMaps);
    return priceResult(city, tool, tool.result as number,
      getPendingCost(tool), failedReason);
  } finally {
    tool.clear();
  }
}

// The size doTool in src/bulldozerTool.js finds, 0 for anything but a zone
function zoneSizeAt(city: SimulationLike, x: number, y: number): number {
  const tile: TileLike = getMap(city).getTile(x, y);

  return tile.isZone() ? ZoneUtils.checkZoneSize(tile.getValue()) :
    ZoneUtils.checkBigZone(tile.getValue()).zoneSize;
}

/* What build would do and cost, without changing the city. The park tool
 * draws a random number in doTool to pick the kind of park, so it is
 * priced from its rule: bare land costs toolCost, anything else is
 * occupied. */
function quoteBuild(city: SimulationLike, toolName: string, x: number,
    y: number): ActionResult {
  if (!BUILD_TOOLS.includes(toolName)) {
    return fail('unknown-tool');
  }

  const tool: ToolLike = getTools(city)[toolName];

  if (!isSiteOnMap(city, tool, x, y)) {
    return fail('invalid-position');
  }

  if (toolName === 'park') {
    const result: number = getMap(city).getTileValue(x, y) === DIRT ?
      tool.TOOLRESULT_OK : tool.TOOLRESULT_NEEDS_BULLDOZE;

    return priceResult(city, tool, result, tool.toolCost, 'blocked');
  }

  return quoteTool(city, tool, x, y, 'blocked');
}

function build(city: SimulationLike, toolName: string, x: number,
    y: number): ActionResult {
  if (!BUILD_TOOLS.includes(toolName)) {
    return fail('unknown-tool');
  }

  const tool: ToolLike = getTools(city)[toolName];

  if (!isSiteOnMap(city, tool, x, y)) {
    return fail('invalid-position');
  }

  return useTool(city, tool, x, y, 'blocked');
}

/* What bulldoze would do and cost, without changing the city. On a zone the
 * bulldozer draws random numbers for the rubble, and it always charges
 * bulldozerCost there, so that case is priced without the tool. */
function quoteBulldoze(city: SimulationLike, x: number,
    y: number): ActionResult {
  const tool: ToolLike = getTools(city).bulldozer;

  if (!isSiteOnMap(city, tool, x, y)) {
    return fail('invalid-position');
  }

  if (zoneSizeAt(city, x, y) > 0) {
    return priceResult(city, tool, tool.TOOLRESULT_OK, tool.bulldozerCost,
      'nothing-to-bulldoze');
  }

  return quoteTool(city, tool, x, y, 'nothing-to-bulldoze');
}

function bulldoze(city: SimulationLike, x: number, y: number): ActionResult {
  const tool: ToolLike = getTools(city).bulldozer;

  if (!isSiteOnMap(city, tool, x, y)) {
    return fail('invalid-position');
  }

  return useTool(city, tool, x, y, 'nothing-to-bulldoze');
}

function quoteSetTaxRate(city: SimulationLike, rate: number): ActionResult {
  return isWholeNumberUpTo(rate, MAX_TAX_RATE) ? succeed(0) :
    fail('invalid-value');
}

function setTaxRate(city: SimulationLike, rate: number): ActionResult {
  const quote: ActionResult = quoteSetTaxRate(city, rate);

  if (quote.success) {
    city.budget.setTax(rate);
  }

  return quote;
}

function quoteSetBudgetPercentages(city: SimulationLike,
    percentages: BudgetPercentages): ActionResult {
  return isWholeNumberUpTo(percentages.road, MAX_PERCENT) &&
    isWholeNumberUpTo(percentages.fire, MAX_PERCENT) &&
    isWholeNumberUpTo(percentages.police, MAX_PERCENT) ?
    succeed(0) : fail('invalid-value');
}

/* Same as closing the budget window outside of a budget year. The effect
 * on roads, fire and police changes now, the money is only spent at the
 * next yearly budget. */
function setBudgetPercentages(city: SimulationLike,
    percentages: BudgetPercentages): ActionResult {
  const quote: ActionResult = quoteSetBudgetPercentages(city, percentages);

  if (quote.success) {
    city.budget.roadPercent = percentages.road / 100;
    city.budget.firePercent = percentages.fire / 100;
    city.budget.policePercent = percentages.police / 100;
    city.budget.updateFundEffects();
  }

  return quote;
}

function quoteSetAutoBudget(city: SimulationLike,
    enabled: boolean): ActionResult {
  return typeof enabled === 'boolean' ? succeed(0) : fail('invalid-value');
}

// Same as the auto budget option in the settings window
function setAutoBudget(city: SimulationLike, enabled: boolean): ActionResult {
  const quote: ActionResult = quoteSetAutoBudget(city, enabled);

  if (quote.success) {
    city.budget.setAutoBudget(enabled);
  }

  return quote;
}

export {
  BUILD_TOOLS,
  build,
  bulldoze,
  setTaxRate,
  setBudgetPercentages,
  setAutoBudget,
  quoteBuild,
  quoteBulldoze,
  quoteSetTaxRate,
  quoteSetBudgetPercentages,
  quoteSetAutoBudget,
};
