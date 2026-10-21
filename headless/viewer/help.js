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

  /* The budget fields. budget.js: collectTax sets the full costs every
   * January, _calculateBestPercentages lowers the shares, doBudgetNow
   * turns auto budget off, updateFundEffects sets the effects. */
  autoBudget: 'Whether the yearly budget pays by itself. With it on, ' +
    'January pays roads, fire and police when some money is left after ' +
    'paying. Otherwise the engine turns it off and opens the budget ' +
    'window, and while it is off the window opens every January. Only a ' +
    'player or an agent turns it back on.',
  roadFunding: 'The share of full road and rail maintenance the city ' +
    'pays, 0 to 100%, floored as the budget window shows it. Full ' +
    'maintenance is $1 a road tile, $5 a bridge, $1 more for heavy ' +
    'traffic and $2 a rail tile, times 0.7, 0.9 or 1.2 by level. After a ' +
    'year without enough money the engine lowers it to what the city ' +
    'could pay, and it stays there until someone raises it.',
  fireFunding: 'The share of full fire station maintenance the city pays, ' +
    '$100 a station a year, 0 to 100%. The engine lowers it like the road ' +
    'share, and pays roads first, then fire, then police.',
  policeFunding: 'The share of full police station maintenance the city ' +
    'pays, $100 a station a year, 0 to 100%. The engine lowers it like ' +
    'the road share, and police are paid last.',
  roadEffect: 'How well roads are kept, 0 to 32: 32 × paid / full ' +
    'maintenance, set when the budget is paid or the shares change. ' +
    'Below 30, about 94% funding, road and rail tiles start to turn into ' +
    'rubble and bridges into water. The score loses 32 minus this. A city ' +
    'without population keeps 32.',
  // emergencyServices.js, crimeScan and fireAnalysis in blockMapUtils.js
  policeEffect: 'The strength of each police station, 0 to 1,000: 1,000 × ' +
    'paid / full police maintenance. A station adds it to its block of 8 ' +
    'by 8 tiles, halved without power and halved again without a road ' +
    'next to it. Smoothed over the blocks around, it is taken off the ' +
    'crime there.',
  // miscTiles.js fireFound
  fireEffect: 'The strength of each fire station, 0 to 1,000, worked out ' +
    'like the police effect. Where the smoothed value is above 100, a ' +
    'fire goes out with a chance of 1 in 2 on the one scan in four that ' +
    'checks it, against 1 in 11 with no station near.',
  budgetMissing: 'Logs written before version 4 have no funding shares, ' +
    'auto budget or effects in the state.',

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

/**
 * The fields of each agent's report, by the agent's name in the log.
 * @type {Record<string, Record<string, string>>}
 */
const REPORT_HELP = {
  // random.ts TurnReport
  random: {
    slots: 'How many actions the random agent tried to play this turn, ' +
      'drawn from 0 to the action limit.',
    nothing: 'Slots in which it drew the category "nothing".',
    draws: 'Actions it drew and quoted this turn, the rejected ones ' +
      'included.',
    rejected: 'Draws it dropped because the quote failed or the money ' +
      'left was not enough.',
    reasons: 'Why the rejected draws failed, with a count for each reason.',
    gaveUp: 'Slots left empty after too many rejected draws, 20 by default.',
  },

  // rules.ts
  rules: {
    rules: 'The rule behind each action of this turn, in order. Fire: ' +
      'firebreak, emergency-station. Power: ' +
      'first-plant, connect-zone, extra-plant. Budget: funding, ' +
      'auto-budget. Maintenance: repair-road. Then stadium, airport or ' +
      'port for a capped demand, police, fire-station, raise-tax or ' +
      'lower-tax, rezone, demolish-empty and demolish-polluter, and for ' +
      'growth zone and road.',
    reserve: 'The money the agent kept this turn for the next yearly ' +
      'budget: its full cost by the formula of the engine, $1 a road tile, ' +
      '$5 a bridge, $1 more under heavy traffic and $2 a rail tile, times ' +
      'the level, and $100 a police or fire station, plus 25%. Actions ' +
      'that cost money only use what is above it.',
    waiting: 'What the agent is saving up for: a rule fitted, but its ' +
      'action cost more than the money above the reserve. It shows the ' +
      'action, its price, the funds left and the money kept. The rest of ' +
      'the turn the agent only fights fires and sets the budget and the ' +
      'taxes. None means it did not wait.',
    waitingForMoney: 'Older logs: yes when a rule fitted but its action ' +
      'cost more than the money above the reserve. The agent then waits: ' +
      'the rest of the turn only sets the budget and the taxes.',
  },

  // demo.ts
  demo: {
    next: 'The number of the next step in the demo town plan.',
    skipped: 'Steps of the plan the demo agent skipped, because the engine ' +
      'refused them for a reason other than money.',
  },
};

export { HELP, REPORT_HELP };
