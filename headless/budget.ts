import type { BudgetWindowRecord, SimulationLike } from './types.ts';

// Not part of the save data, so a loaded city starts with an empty log
const budgetLogs: WeakMap<SimulationLike, BudgetWindowRecord[]> =
  new WeakMap();

// Two decimals, otherwise 0.29 would come out as 28.999999999999996
function toPercent(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

/* The engine opens the budget window when the city cannot pay for its
 * services, and every January while auto budget is off. It has already
 * lowered the percentages to what the city can afford, in the order
 * roads, fire, police. doBudgetWindow accepts them, like pressing OK in
 * the browser. The game has no bankruptcy, so nothing ends here. */
function answerBudgetWindow(city: SimulationLike,
    autoBudgetWasOn: boolean): void {
  const funds: number = city.budget.totalFunds;

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
