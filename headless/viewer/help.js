/* The explanations the viewer shows for each metric, on hover, keyboard
 * focus or tap. All of them are here, so they are easy to correct. Each
 * says what the value means for the city, what a good and a bad value look
 * like, and the most common reason it is stuck, one line each. The facts
 * come from src/ or from headless/README.md, and the comments say where to
 * check them. */

/** @type {Record<string, string>} */
const HELP = {
  date: 'The month the agent saw at the start of this turn. The last ' +
    'position is the end of the game, after the last turn ran.',

  // budget.js: setFunds clamps at 0, collectTax only with population
  funds: 'The money the city has to build with. Building takes from it ' +
    'at once, and each January the taxes come in and roads, fire and ' +
    'police are paid.\n' +
    'Good: money left after January to keep building. Bad: close to $0, ' +
    'when nothing can be built.\n' +
    'Stuck low: the taxes barely cover the yearly upkeep, so only a small ' +
    'surplus comes in each January. An empty city pays no taxes.',

  // evaluation.js getPopulation, called monthly by _checkGrowth
  population: 'How many people live in the city, counted every month: ' +
    'homes count once and jobs in shops and industry eight times, all ' +
    'times 20.\n' +
    'Good: rising. Bad: falling, which also halves the score when it ' +
    'happens in the month before January.\n' +
    'Stuck: residential demand held at 0, often for want of a stadium, ' +
    'zones without power or a road, or no money to build.',

  // evaluation.js getScore and doVotes, and the porting bugs in CHANGES.md
  score: 'The micropolisJS city score, 0 to 1,000. It changes once a ' +
    'year, in January, half way to the new value, and the problems, the ' +
    'tax, zones without power and capped demand pull it down.\n' +
    'Good: above 500 and rising. Bad: a sudden drop to about half, which ' +
    'any fall in population in the month before January causes (a ' +
    'porting bug).\n' +
    'Stuck: an empty city is not evaluated and stays at 500. Police and ' +
    'fire funding never change it (a porting bug).',
  cityClass: 'The size of the city by its population: village up to ' +
    '2,000 people, then town, city above 10,000, capital above 50,000, ' +
    'metropolis above 100,000 and megalopolis above 500,000. It follows ' +
    'the population every month.',
  approval: 'How many of 100 voters approve of the mayor. It is about the ' +
    'score divided by 10, plus chance, and changes once a year, in ' +
    'January.\n' +
    'Good: above 50%. Bad: low, which follows a low score.\n' +
    'Stuck: an empty city stays at 50%.',

  // budget.js cityTax, valves.js taxTable
  taxRate: 'The city tax, 0 to 20%, 7% in a new city. A higher rate brings ' +
    'more money each January and less demand for homes, shops and ' +
    'industry, and the same rate costs more demand on a harder level.\n' +
    'Good: low enough that the city still wants to grow, high enough to ' +
    'pay its upkeep. Bad: high, when demand falls below 0.\n' +
    'It changes only when a player or an agent sets it.',

  /* The budget fields. budget.js: collectTax sets the full costs every
   * January, _calculateBestPercentages lowers the shares, doBudgetNow
   * turns auto budget off, updateFundEffects sets the effects. */
  autoBudget: 'Whether January pays the yearly budget by itself.\n' +
    'Good: on, so roads, fire and police are paid without a question. ' +
    'Bad: off, when the budget window opens every January.\n' +
    'Stuck off: the engine turns it off the first time the money runs ' +
    'out and never turns it back on. Only a player or an agent does.',
  roadFunding: 'The share of the full road and rail upkeep the city pays ' +
    'each January. The full upkeep is $1 a road tile, $5 a bridge and $2 ' +
    'a rail tile, more on harder levels.\n' +
    'Good: 100%. Bad: below about 94%, when roads and rails slowly turn ' +
    'into rubble and bridges fall into the water.\n' +
    'Stuck low: after a January without enough money the engine lowers it ' +
    'to what the city could pay, and it stays there until someone raises ' +
    'it.',
  fireFunding: 'The share of the full fire station upkeep the city pays, ' +
    '$100 a station a year.\n' +
    'Good: 100%, so fire stations put fires out fast. Bad: low, which ' +
    'weakens every station.\n' +
    'Stuck low: after a short budget the engine lowers it, after roads, ' +
    'and it stays there until someone raises it.',
  policeFunding: 'The share of the full police station upkeep the city ' +
    'pays, $100 a station a year.\n' +
    'Good: 100%, so police stations hold crime down. Bad: low, which ' +
    'weakens every station.\n' +
    'Stuck low: after a short budget the engine lowers it, police last, ' +
    'and it stays there until someone raises it.',
  roadEffect: 'How well the roads are kept, 0 to 32, from the road ' +
    'funding.\n' +
    'Good: 30 or more. Bad: below 30, when road and rail tiles turn into ' +
    'rubble and bridges into water, and the score loses up to 32 ' +
    'points.\n' +
    'Stuck low: the road funding stays low after a short budget. An ' +
    'empty city keeps 32.',
  // emergencyServices.js, crimeScan and fireAnalysis in blockMapUtils.js
  policeEffect: 'How strong each police station is, 0 to 1,000, from the ' +
    'police funding.\n' +
    'Good: 1,000. Bad: low, so the stations lower crime less. A station ' +
    'without power works at half strength, and without a road next to it ' +
    'at half of that.\n' +
    'Stuck low: the police funding stays low after a short budget.',
  // miscTiles.js fireFound
  fireEffect: 'How strong each fire station is, 0 to 1,000, from the fire ' +
    'funding.\n' +
    'Good: 1,000. Near a strong station a fire goes out with a chance of ' +
    '1 in 2 each time it is checked, against 1 in 11 with no station ' +
    'near. Bad: low.\n' +
    'Stuck low: the fire funding stays low after a short budget.',
  budgetMissing: 'Logs written before version 4 have no funding shares, ' +
    'auto budget or effects in the state.',

  // mapScanner.js counts them, evaluation.js getScore uses the share
  poweredZones: 'Zones and buildings with power, out of all of them.\n' +
    'Good: all of them. Bad: many without, since a zone without power ' +
    'does not grow, and the score is multiplied by the share with ' +
    'power.\n' +
    'Stuck: the zones are not joined to a power line, or the plants are ' +
    'overloaded. A coal plant powers only about 450 to 560 tiles in a ' +
    'real city.',

  /* valves.js clamps the valves and holds them at 0 while a cap is on,
   * simulation.js _sendMessages sets the caps with their messages */
  residential: 'How much the city wants new homes, from -2,000 to 2,000. ' +
    'Above 0 new homes fill up, below 0 homes empty. It changes twice a ' +
    'month.\n' +
    'Good: above 0 while there are homes to fill. Bad: far below 0.\n' +
    'Stuck at 0: more than 500 residents in the census, about 10,000 ' +
    'people, and no stadium. The engine holds it at 0 until one is ' +
    'built, and checks about every 16 months. A high tax pulls it down ' +
    'too.',
  commercial: 'How much the city wants new shops and offices, from -1,500 ' +
    'to 1,500. Above 0 new ones fill up, below 0 they empty. It changes ' +
    'twice a month.\n' +
    'Good: above 0. Bad: far below 0.\n' +
    'Stuck at 0: more than 100 commercial in the census, about 16,000 ' +
    'people, and no airport. The engine holds it at 0 until one is built.',
  industrial: 'How much the city wants new industry, from -1,500 to ' +
    '1,500. Above 0 new industry fills up, below 0 it empties. It changes ' +
    'twice a month.\n' +
    'Good: above 0. Bad: far below 0.\n' +
    'Stuck at 0: more than 70 industrial in the census, about 11,200 ' +
    'people, and no seaport. The engine holds it at 0 until one is built.',

  /* The problems, higher is worse for all seven. runner.ts getState
   * recomputes them from the census, so they move during the year, while
   * the score and the vote use the value of the January evaluation.
   * Formulas from evaluation.js and blockMapUtils.js. */
  crime: 'How much crime there is where the land has value, 0 to 250. It ' +
    'moves during the year.\n' +
    'Good: low, under about 50. Bad: high. Above 190 it takes value off ' +
    'the land.\n' +
    'Stuck high: poor, crowded land with no police station near, or the ' +
    'police funding cut. Logs from before the crime fix show 0.',
  pollution: 'How polluted the polluted land is, 0 to 255. It moves during ' +
    'the year.\n' +
    'Good: low. Bad: above 60, when a monster can come, and high ' +
    'pollution lowers the land value.\n' +
    'Stuck high: industry, coal plants, the seaport, the airport and busy ' +
    'roads. One coal plant can push a small town above 60.',
  housing: 'The land value average times 7/10, 0 to 175. The score counts ' +
    'expensive land as a problem, though valuable land also brings more ' +
    'taxes.\n' +
    'For the score lower is better. It moves during the year, and ' +
    'pollution and crime pull it down.',
  taxes: 'Ten times the tax rate, 0 to 200. For the score lower is ' +
    'better.\n' +
    'It moves only with the tax rate.',
  traffic: 'How busy the roads are where the land has value, times 2.4, ' +
    'from 0 to about 570.\n' +
    'Good: low. Bad: high, which adds pollution and doubles the upkeep of ' +
    'the busiest road tiles.\n' +
    'Stuck: it only changes at the January evaluation, so this is last ' +
    'January\'s value. Logs from before the traffic fix show 0.',
  unemployment: 'How many residents there are for each job, from -255 to ' +
    '255.\n' +
    'Good: 0 or below, a job for everyone. Bad: high, more residents than ' +
    'jobs. Below 0 there are more jobs than residents and the bar is ' +
    'empty.\n' +
    'Stuck high: too few shops and industry for the homes, often because ' +
    'their demand is capped or their zones have no power.',
  fire: 'Five times the number of burning tiles, at most 255.\n' +
    'Good: 0. Bad: above 0, something is burning.\n' +
    'Stuck: a fire with no fire station near spreads through trees and ' +
    'zones and can burn for years. A firebreak or a station stops it.',

  // budget.js doBudgetNow and the budget log of headless/budget.ts
  budgetWindows: 'Budget windows answered while the city ran this turn: ' +
    'the funds before the budget, the taxes collected, and the share of ' +
    'full upkeep paid for roads, fire and police.\n' +
    'Good: 100% for all three. Bad: less, and those shares stay until ' +
    'someone raises them.\n' +
    'One opens when the money runs out in January, and every January ' +
    'once auto budget is off.',

  report: 'What the agent reported about this turn. Each agent reports ' +
    'its own fields, and the passive agent none.',

  // drawTracks and drawSeries in viewer.js
  actionsTrack: 'The actions of every turn. A bar is the share of the ' +
    'action limit played, its red part the share that failed, and a blue ' +
    'mark a turn in which a budget window opened. Long gaps are turns in ' +
    'which the agent played nothing.',
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
      'left was not enough. Once the money is gone, most draws are.',
    reasons: 'Why the rejected draws failed, with a count for each reason.',
    gaveUp: 'Slots left empty after too many rejected draws, 20 by default.',
  },

  // rules.ts
  rules: {
    rules: 'The rule behind each action of this turn, in order. Fire: ' +
      'firebreak, emergency-station. Power: first-plant, connect-zone, ' +
      'extra-plant. Budget: funding, auto-budget. Maintenance: ' +
      'repair-road. Then stadium, airport or port for a capped demand, ' +
      'police, fire-station, raise-tax or lower-tax, rezone, ' +
      'demolish-empty and demolish-polluter, and for growth zone and ' +
      'road.\n' +
      'None: the agent played nothing, most often because it waited for ' +
      'money.',
    waiting: 'What the agent is saving up for: a rule fitted, but its ' +
      'action costs more than the money above the reserve. It shows the ' +
      'action, its price, the funds left and the money kept. The rest of ' +
      'the turn the agent only fights fires and sets the budget and the ' +
      'taxes.\n' +
      'None: it did not wait.\n' +
      'Often: the funds sit just under the reserve, so even a $100 zone ' +
      'waits for the January surplus.',
    reserve: 'The money the agent keeps for the next January: the full ' +
      'yearly upkeep of its roads, rails and stations by the engine\'s ' +
      'formula, plus 25%. It only spends what is above it, except to ' +
      'fight a fire.',
    waitingForMoney: 'Older logs: yes when the agent waited for money ' +
      'this turn, which newer logs say in "waiting".',
  },

  // demo.ts
  demo: {
    next: 'The number of the next step in the demo town plan.',
    skipped: 'Steps of the plan the demo agent skipped, because the engine ' +
      'refused them for a reason other than money.',
  },
};

export { HELP, REPORT_HELP };
