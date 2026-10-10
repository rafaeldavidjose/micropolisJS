import { DIRT, FIRSTRIVEDGE, LASTRUBBLE } from '../../src/tileValues.ts';
import type {
  ActionResult,
  Agent,
  CityView,
  GameAction,
  Position,
} from '../types.ts';

/* Builds the same small town on every map, so the replay viewer has a city
 * that grows. It is not one of the baselines.
 *
 * The plan is in tiles from the top left corner of the site. A coal plant
 * sits in the top left corner, with a power line down column 5. Zones are
 * in rows of 3 by 3 from column 6. The street on row 3 serves the rows
 * above and below it, and the one on row 10 the next two rows. Zones next
 * to each other pass the power on, so each pair of rows only needs the
 * line at its west end. */

interface Step {
  turn: number;
  action: GameAction;
}

const SITE_WIDTH: number = 31;
const SITE_HEIGHT: number = 14;

function zone(turn: number, tool: string, x: number, y: number): Step {
  return { turn: turn, action: { type: 'build', tool: tool, x: x, y: y } };
}

function line(turn: number, tool: string, from: Position,
    to: Position): Step {
  return {
    turn: turn,
    action: { type: 'route', tool: tool, from: from, to: to },
  };
}

// Built in this order, each step from its turn on
const TOWN: readonly Step[] = [
  zone(0, 'coal', 1, 1),
  line(0, 'wire', { x: 4, y: 1 }, { x: 5, y: 1 }),
  line(0, 'wire', { x: 5, y: 1 }, { x: 5, y: 6 }),
  line(0, 'road', { x: 6, y: 3 }, { x: 29, y: 3 }),
  zone(0, 'residential', 7, 1),
  zone(0, 'residential', 7, 5),
  zone(0, 'commercial', 10, 1),
  zone(0, 'industrial', 10, 5),
  zone(0, 'residential', 13, 1),
  zone(0, 'residential', 13, 5),
  zone(0, 'commercial', 16, 1),
  zone(0, 'industrial', 16, 5),
  zone(8, 'police', 19, 1),
  zone(8, 'fire', 19, 5),
  zone(12, 'residential', 22, 1),
  zone(12, 'residential', 22, 5),
  zone(12, 'commercial', 25, 1),
  zone(12, 'industrial', 25, 5),
  zone(12, 'residential', 28, 1),
  zone(12, 'residential', 28, 5),
  line(20, 'road', { x: 30, y: 3 }, { x: 30, y: 10 }),
  line(20, 'road', { x: 6, y: 10 }, { x: 29, y: 10 }),
  line(20, 'wire', { x: 5, y: 6 }, { x: 5, y: 12 }),
  zone(20, 'residential', 7, 8),
  zone(20, 'residential', 7, 12),
  zone(20, 'commercial', 10, 8),
  zone(20, 'industrial', 10, 12),
  zone(20, 'residential', 13, 8),
  zone(20, 'residential', 13, 12),
  zone(20, 'commercial', 16, 8),
  zone(20, 'residential', 16, 12),
  zone(28, 'residential', 19, 8),
  zone(28, 'industrial', 19, 12),
  zone(28, 'police', 22, 8),
  zone(28, 'fire', 22, 12),
  zone(28, 'residential', 25, 8),
  zone(28, 'residential', 25, 12),
  zone(28, 'commercial', 28, 8),
  zone(28, 'residential', 28, 12),
];

/* Bare land, or a shore, tree or rubble tile, which the tools clear for $1
 * (canBulldoze in src/tileUtils.js) */
function isBuildable(value: number): boolean {
  return value === DIRT || (value >= FIRSTRIVEDGE && value <= LASTRUBBLE);
}

/* The site with the fewest tiles that are not buildable, none on most
 * maps, and then the one nearest the centre of the map. A table of running
 * counts gives the number of those tiles in any rectangle at once, so
 * every position is checked. */
function findSite(view: CityView): Position {
  const width: number = view.map.width;
  const height: number = view.map.height;
  const stride: number = width + 1;
  const counts: number[] = new Array(stride * (height + 1)).fill(0);

  for (let y: number = 0; y < height; y++) {
    for (let x: number = 0; x < width; x++) {
      const other: number = isBuildable(view.map.getTileValue(x, y)) ? 0 : 1;
      counts[(y + 1) * stride + x + 1] = other + counts[y * stride + x + 1] +
        counts[(y + 1) * stride + x] - counts[y * stride + x];
    }
  }

  let best: Position = { x: 0, y: 0 };
  let bestOthers: number = Infinity;
  let bestDistance: number = Infinity;

  for (let y: number = 0; y + SITE_HEIGHT <= height; y++) {
    for (let x: number = 0; x + SITE_WIDTH <= width; x++) {
      const others: number =
        counts[(y + SITE_HEIGHT) * stride + x + SITE_WIDTH] -
        counts[(y + SITE_HEIGHT) * stride + x] -
        counts[y * stride + x + SITE_WIDTH] + counts[y * stride + x];
      const distance: number =
        Math.abs(x + SITE_WIDTH / 2 - width / 2) +
        Math.abs(y + SITE_HEIGHT / 2 - height / 2);

      if (others < bestOthers ||
          (others === bestOthers && distance < bestDistance)) {
        best = { x: x, y: y };
        bestOthers = others;
        bestDistance = distance;
      }
    }
  }

  return best;
}

function placeAt(action: GameAction, site: Position): GameAction {
  switch (action.type) {
    case 'build':
      return { ...action, x: action.x + site.x, y: action.y + site.y };
    case 'route':
      return {
        ...action,
        from: { x: action.from.x + site.x, y: action.from.y + site.y },
        to: { x: action.to.x + site.x, y: action.to.y + site.y },
      };
    default:
      return action;
  }
}

/* Each turn it builds the next steps whose turn has come, up to the
 * maximum number of actions. It waits while the money is short, and skips
 * a step the engine refuses for any other reason. */
function createDemoAgent(): Agent {
  let site: Position | null = null;
  let next: number = 0;
  let skipped: number = 0;

  return {
    name: 'demo',
    settings: (): Record<string, unknown> => ({ site: site }),
    report: (): Record<string, unknown> => ({ next: next, skipped: skipped }),
    decide: (view: CityView): GameAction[] => {
      site = site ?? findSite(view);

      const actions: GameAction[] = [];
      let funds: number = view.state.funds;

      while (next < TOWN.length && actions.length < view.maxActions &&
             TOWN[next].turn <= view.turn) {
        const action: GameAction = placeAt(TOWN[next].action, site);
        const quote: ActionResult = view.quote(action);

        if (quote.success && quote.cost <= funds) {
          actions.push(action);
          funds -= quote.cost;
        } else if (quote.success || quote.reason === 'insufficient-funds') {
          break;
        } else {
          skipped++;
        }

        next++;
      }

      return actions;
    },
  };
}

export { createDemoAgent };
