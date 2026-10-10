import { BUILD_TOOLS } from '../actions.ts';
import { ROUTE_TOOLS } from '../routes.ts';
import { makeRng } from '../rng.ts';
import type { Rng } from '../rng.ts';
import type {
  ActionResult,
  Agent,
  CityView,
  GameAction,
  Position,
} from '../types.ts';

type Category =
  | 'building'
  | 'route'
  | 'bulldoze'
  | 'tax'
  | 'budget'
  | 'autoBudget'
  | 'nothing';

const CATEGORIES: readonly Category[] = [
  'building',
  'route',
  'bulldoze',
  'tax',
  'budget',
  'autoBudget',
  'nothing',
];

// Roads, rails and power lines are built as routes
const BUILDING_TOOLS: readonly string[] = BUILD_TOOLS.filter(
  (tool: string): boolean => !ROUTE_TOOLS.includes(tool));

const MAX_TAX_RATE: number = 20;
const MAX_PERCENT: number = 100;

interface RandomAgentOptions {
  seed: number;
  weights?: Partial<Record<Category, number>>;
  maxRouteDistance?: number;
  maxTries?: number;
}

// What happened to the agent's draws in one turn
interface TurnReport {
  slots: number;
  nothing: number;
  draws: number;
  rejected: number;
  reasons: Record<string, number>;
  gaveUp: number;
}

function pickWeighted(rng: Rng, weights: Record<Category, number>): Category {
  const total: number = CATEGORIES.reduce(
    (sum: number, category: Category): number => sum + weights[category], 0);
  let left: number = rng.next() * total;

  for (const category of CATEGORIES) {
    left -= weights[category];

    if (left < 0) {
      return category;
    }
  }

  return CATEGORIES[CATEGORIES.length - 1];
}

function randomTile(rng: Rng, view: CityView): Position {
  return { x: rng.int(view.map.width), y: rng.int(view.map.height) };
}

// Uniform over the tiles on the map at most distance away, Manhattan
function nearbyTile(rng: Rng, view: CityView, from: Position,
    distance: number): Position {
  for (;;) {
    const dx: number = rng.int(2 * distance + 1) - distance;
    const dy: number = rng.int(2 * distance + 1) - distance;
    const x: number = from.x + dx;
    const y: number = from.y + dy;

    if (Math.abs(dx) + Math.abs(dy) <= distance && x >= 0 && y >= 0 &&
        x < view.map.width && y < view.map.height) {
      return { x: x, y: y };
    }
  }
}

function drawAction(rng: Rng, view: CityView, category: Category,
    maxRouteDistance: number): GameAction {
  switch (category) {
    case 'building': {
      const tool: string = BUILDING_TOOLS[rng.int(BUILDING_TOOLS.length)];
      const tile: Position = randomTile(rng, view);
      return { type: 'build', tool: tool, x: tile.x, y: tile.y };
    }
    case 'route': {
      const tool: string = ROUTE_TOOLS[rng.int(ROUTE_TOOLS.length)];
      const from: Position = randomTile(rng, view);
      const to: Position = nearbyTile(rng, view, from, maxRouteDistance);
      return { type: 'route', tool: tool, from: from, to: to };
    }
    case 'bulldoze': {
      const tile: Position = randomTile(rng, view);
      return { type: 'bulldoze', x: tile.x, y: tile.y };
    }
    case 'tax':
      return { type: 'setTaxRate', rate: rng.int(MAX_TAX_RATE + 1) };
    case 'budget':
      return {
        type: 'setBudgetPercentages',
        road: rng.int(MAX_PERCENT + 1),
        fire: rng.int(MAX_PERCENT + 1),
        police: rng.int(MAX_PERCENT + 1),
      };
    default:
      return { type: 'setAutoBudget', enabled: rng.int(2) === 1 };
  }
}

/* Plays random valid actions. Each turn it takes 0 to maxActions slots.
 * Each slot picks a category by weight, then draws the parameters and
 * quotes the action. A failing draw is rejected and drawn again, up to
 * maxTries times. The money its earlier actions of the turn will spend is
 * kept aside, so it does not pick more than the city can pay. */
function createRandomAgent(options: RandomAgentOptions): Agent {
  const rng: Rng = makeRng(options.seed);
  const weights: Record<Category, number> = {
    building: 1, route: 1, bulldoze: 1, tax: 1, budget: 1, autoBudget: 1,
    nothing: 1, ...options.weights,
  };
  const maxRouteDistance: number = options.maxRouteDistance ?? 20;
  const maxTries: number = options.maxTries ?? 20;
  let report: TurnReport | null = null;

  return {
    name: 'random',
    settings: (): Record<string, unknown> => ({
      seed: options.seed,
      weights: weights,
      maxRouteDistance: maxRouteDistance,
      maxTries: maxTries,
    }),
    report: (): Record<string, unknown> => ({ ...report }),
    decide: (view: CityView): GameAction[] => {
      const actions: GameAction[] = [];
      let funds: number = view.state.funds;
      const turn: TurnReport = {
        slots: rng.int(view.maxActions + 1),
        nothing: 0,
        draws: 0,
        rejected: 0,
        reasons: {},
        gaveUp: 0,
      };

      for (let slot: number = 0; slot < turn.slots; slot++) {
        const category: Category = pickWeighted(rng, weights);

        if (category === 'nothing') {
          turn.nothing++;
          continue;
        }

        let found: boolean = false;

        for (let attempt: number = 0; attempt < maxTries && !found;
             attempt++) {
          const action: GameAction = drawAction(rng, view, category,
            maxRouteDistance);
          const quote: ActionResult = view.quote(action);
          const reason: string | null = !quote.success ? quote.reason :
            quote.cost > funds ? 'insufficient-funds' : null;

          turn.draws++;

          if (reason === null) {
            actions.push(action);
            funds -= quote.cost;
            found = true;
          } else {
            turn.rejected++;
            turn.reasons[reason] = (turn.reasons[reason] ?? 0) + 1;
          }
        }

        if (!found) {
          turn.gaveUp++;
        }
      }

      report = turn;
      return actions;
    },
  };
}

export type { Category, RandomAgentOptions };
export { CATEGORIES, createRandomAgent };
