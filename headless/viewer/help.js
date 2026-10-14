/* The explanations the viewer shows for each metric, on hover, keyboard
 * focus or tap. All of them are here, so they are easy to correct. Each
 * fact comes from src/ or from headless/README.md, and the comments say
 * where to check it. */

/** @type {Record<string, string>} */
const HELP = {
  date: 'The in-game month at the start of this turn, which is the moment ' +
    'the agent saw. The last position is the end of the game.',

  // budget.js: setFunds clamps at 0, collectTax only with population
  funds: 'Money in the city account, never below $0. Building and ' +
    'bulldozing take from it at once, and in January the yearly budget ' +
    'adds the taxes and pays for roads, fire and police. That budget only ' +
    'runs for a city with population.',

  // evaluation.js getPopulation, called monthly by _checkGrowth
  population: 'People in the city, from the census: (residential + 8 × ' +
    '(commercial + industrial)) × 20. It is recomputed every month.',

  // evaluation.js getScore and doVotes, and the porting bugs in CHANGES.md
  score: 'The city score of micropolisJS, 0 to 1,000, higher is better. ' +
    'It changes once a year, in January, and only moves half way to the ' +
    'new value. Any drop in population in the month before January halves ' +
    'it, and police and fire funding do not change it (porting bugs).',
  cityClass: 'Village up to 2,000 people, then town, city above 10,000, ' +
    'capital above 50,000, metropolis above 100,000 and megalopolis above ' +
    '500,000. It follows the population every month.',
  approval: 'The share of 100 voters who approve, 0 to 100%. A voter ' +
    'approves when the score beats a random number up to 1,000, so it is ' +
    'about the score divided by 10 plus noise. It changes once a year, in ' +
    'January, and is 50% while the city has no population.',

  // budget.js cityTax, valves.js taxTable
  taxRate: 'The city tax, 0 to 20%, 7% in a new city. The taxes come in ' +
    'once a year, in January. A higher rate lowers the demand for all ' +
    'three zone types.',

  // mapScanner.js counts them, evaluation.js getScore uses the share
  poweredZones: 'Zones and buildings with power, out of all of them, ' +
    'counted on every pass of the map scan. The score is multiplied by ' +
    'the share with power.',

  // valves.js clamps the valves, simulation.js sets them and the caps
  residential: 'Demand for homes, from -2,000 to 2,000. Above 0 the city ' +
    'wants more. It changes twice a month. Without a stadium it stays at ' +
    '0 or below once the census counts more than 500 residents, about ' +
    '10,000 people.',
  commercial: 'Demand for shops and offices, from -1,500 to 1,500. Above ' +
    '0 the city wants more. It changes twice a month. Without an airport ' +
    'it stays at 0 or below once commercial population passes 100, about ' +
    '16,000 people.',
  industrial: 'Demand for industry, from -1,500 to 1,500. Above 0 the ' +
    'city wants more. It changes twice a month. Without a seaport it ' +
    'stays at 0 or below once industrial population passes 70, about ' +
    '11,200 people.',

  /* The problems, higher is worse for all seven. runner.ts getState
   * recomputes them from the census, so they move during the year, while
   * the score and the vote use the value of the January evaluation.
   * Formulas from evaluation.js and blockMapUtils.js. */
  crime: 'Average crime over the land with value, 0 to 250, higher is ' +
    'worse. Low land value and dense population raise it, and a police ' +
    'station nearby lowers it. It moves during the year. Logs from before ' +
    'the crime fix show 0.',
  pollution: 'Average pollution over the polluted land, 0 to 255, higher ' +
    'is worse. Industry, coal plants, the seaport and airport, busy ' +
    'roads, fire and radiation raise it. It moves during the year.',
  housing: 'The land value average times 7/10, 0 to 175. Expensive land ' +
    'counts as a problem here, so higher is worse. It moves during the ' +
    'year.',
  taxes: 'Ten times the tax rate, 0 to 200, higher is worse.',
  traffic: 'Average traffic density over the land with value, times 2.4, ' +
    'from 0 to about 570, higher is worse. It comes from the last January ' +
    'evaluation. Logs from before the traffic fix show 0.',
  unemployment: 'Residents for each job: (residential / (8 × jobs) - 1) ' +
    '× 255, at most 255, higher is worse. It is negative, down to -255, ' +
    'when there are more jobs than residents, and the bar is then empty. ' +
    'It moves during the year.',
  fire: 'Five times the number of burning tiles, at most 255, higher is ' +
    'worse. It moves during the year.',

  // budget.js doBudgetNow and the budget log of headless/budget.ts
  budgetWindows: 'Budget windows answered while the city ran this turn: ' +
    'the funds before the budget, the taxes collected, and the share of ' +
    'full funding paid for roads, fire and police. One opens when the ' +
    'money runs out, and every January once auto budget is off. The paid ' +
    'shares stay until someone raises them.',

  report: 'What the agent reported about this turn. Each agent reports ' +
    'its own fields, and the passive agent none.',

  // drawTracks and drawSeries in viewer.js
  actionsTrack: 'The actions of every turn. A bar is the share of the ' +
    'action limit played, its red part the share that failed, and a blue ' +
    'mark a turn in which a budget window opened.',
  populationTrack: 'The population at the start of every turn, scaled to ' +
    'the highest value of the game. The dot is the current turn.',
  fundsTrack: 'The funds at the start of every turn, scaled to the highest ' +
    'value of the game. The dot is the current turn.',
};

/** @type {Record<string, string>} */
const REPORT_HELP = {
  // random.ts TurnReport
  slots: 'How many actions the random agent tried to play this turn, ' +
    'drawn from 0 to the action limit.',
  nothing: 'Slots in which it drew the category "nothing".',
  draws: 'Actions it drew and quoted this turn, the rejected ones included.',
  rejected: 'Draws it dropped because the quote failed or the money left ' +
    'was not enough.',
  reasons: 'Why the rejected draws failed, with a count for each reason.',
  gaveUp: 'Slots left empty after too many rejected draws, 20 by default.',

  // greedy.ts
  rules: 'The rules the greedy agent played this turn, in order: 1 a first ' +
    'power plant, 2 a power line to a zone the network does not reach, 3 ' +
    'another plant for an overloaded network, 4 a zone or a new road for ' +
    'the highest demand.',
  waitingForMoney: 'True when the greedy agent stopped because the next ' +
    'action cost more than the money left.',

  // demo.ts
  next: 'The number of the next step in the demo town plan.',
  skipped: 'Steps of the plan the demo agent skipped, because the engine ' +
    'refused them for a reason other than money.',
};

export { HELP, REPORT_HELP };
