import { getMap, getTools } from './engine.ts';
import type {
  ActionFailure,
  ActionResult,
  BudgetPercentages,
  SimulationLike,
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

function bulldoze(city: SimulationLike, x: number, y: number): ActionResult {
  const tool: ToolLike = getTools(city).bulldozer;

  if (!isSiteOnMap(city, tool, x, y)) {
    return fail('invalid-position');
  }

  return useTool(city, tool, x, y, 'nothing-to-bulldoze');
}

function setTaxRate(city: SimulationLike, rate: number): ActionResult {
  if (!isWholeNumberUpTo(rate, MAX_TAX_RATE)) {
    return fail('invalid-value');
  }

  city.budget.setTax(rate);

  return succeed(0);
}

/* Same as closing the budget window outside of a budget year. The effect
 * on roads, fire and police changes now, the money is only spent at the
 * next yearly budget. */
function setBudgetPercentages(city: SimulationLike,
    percentages: BudgetPercentages): ActionResult {
  if (!isWholeNumberUpTo(percentages.road, MAX_PERCENT) ||
      !isWholeNumberUpTo(percentages.fire, MAX_PERCENT) ||
      !isWholeNumberUpTo(percentages.police, MAX_PERCENT)) {
    return fail('invalid-value');
  }

  city.budget.roadPercent = percentages.road / 100;
  city.budget.firePercent = percentages.fire / 100;
  city.budget.policePercent = percentages.police / 100;
  city.budget.updateFundEffects();

  return succeed(0);
}

// Same as the auto budget option in the settings window
function setAutoBudget(city: SimulationLike, enabled: boolean): ActionResult {
  if (typeof enabled !== 'boolean') {
    return fail('invalid-value');
  }

  city.budget.setAutoBudget(enabled);

  return succeed(0);
}

export {
  BUILD_TOOLS,
  build,
  bulldoze,
  setTaxRate,
  setBudgetPercentages,
  setAutoBudget,
};
