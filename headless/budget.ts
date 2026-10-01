import type { BudgetWindowRecord, SimulationLike } from './types.ts';

// Not part of the save data, so a loaded city starts with an empty log
const budgetLogs: WeakMap<SimulationLike, BudgetWindowRecord[]> =
  new WeakMap();

// Two decimals, otherwise 0.29 would come out as 28.999999999999996
function toPercent(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

/* Does what the browser does when the player presses OK without changing
 * anything. The window shows each percentage floored to a whole number
 * (handleBudgetRequest in src/game.js), and OK writes those numbers back
 * divided by 100 before calling doBudgetWindow (handleBudgetWindowClosure). */
function answerBudgetWindow(city: SimulationLike,
    autoBudgetWasOn: boolean): void {
  const funds: number = city.budget.totalFunds;

  city.budget.roadPercent = Math.floor(city.budget.roadPercent * 100) / 100;
  city.budget.firePercent = Math.floor(city.budget.firePercent * 100) / 100;
  city.budget.policePercent =
    Math.floor(city.budget.policePercent * 100) / 100;
  city.budget.doBudgetWindow();

  const record: BudgetWindowRecord = {
    date: city.getDate(),
    funds: funds,
    taxes: city.budget.taxFund,
    fundsAfter: city.budget.totalFunds,
    road: toPercent(city.budget.roadPercent),
    fire: toPercent(city.budget.firePercent),
    police: toPercent(city.budget.policePercent),
    autoBudgetWasOn: autoBudgetWasOn,
  };

  const log: BudgetWindowRecord[] | undefined = budgetLogs.get(city);

  if (log === undefined) {
    budgetLogs.set(city, [record]);
  } else {
    log.push(record);
  }
}

function getBudgetLog(city: SimulationLike): BudgetWindowRecord[] {
  return structuredClone(budgetLogs.get(city) ?? []);
}

export { answerBudgetWindow, getBudgetLog };
