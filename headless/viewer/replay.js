/* Rebuilds the map of any turn from a run log, and says where each action
 * goes on the map. Plain JavaScript without the DOM, so the viewer and
 * test/replay.test.ts both use it.
 *
 * Position p is the start of turn p, the map the agent saw. The last
 * position, turns.length, is the end of the game. The map of a position is
 * the first map with the changes of every turn up to it. A full copy is
 * kept every SNAPSHOT_INTERVAL positions, so a jump only replays the
 * changes since the nearest copy. */

const SNAPSHOT_INTERVAL = 16;

// Site sizes from src/gameTools.js, the rest are one tile
const SIZES = {
  residential: 3,
  commercial: 3,
  industrial: 3,
  police: 3,
  fire: 3,
  coal: 4,
  nuclear: 4,
  port: 4,
  stadium: 4,
  airport: 6,
};

const NAMES = {
  residential: 'Residential zone',
  commercial: 'Commercial zone',
  industrial: 'Industrial zone',
  police: 'Police station',
  fire: 'Fire station',
  coal: 'Coal power plant',
  nuclear: 'Nuclear power plant',
  port: 'Seaport',
  stadium: 'Stadium',
  airport: 'Airport',
  park: 'Park',
  road: 'Road',
  rail: 'Rail',
  wire: 'Power line',
};

function positionCount(log) {
  return log.turns.length + 1;
}

function changesAt(log, position) {
  return position < log.turns.length ?
    log.turns[position].mapChanges : log.final.mapChanges;
}

function applyChanges(tiles, changes) {
  for (const [index, value] of changes) {
    tiles[index] = value;
  }
}

// Needs a log with its map, see recordMap in game.ts
function createMapHistory(log, interval = SNAPSHOT_INTERVAL) {
  const count = positionCount(log);
  const tiles = Uint16Array.from(log.map.tiles);
  const snapshots = [];

  for (let position = 0; position < count; position++) {
    applyChanges(tiles, changesAt(log, position));

    if (position % interval === 0) {
      snapshots.push(tiles.slice());
    }
  }

  // Fills target, or a new array, with the raw tile values of a position
  function tilesAt(position, target = new Uint16Array(tiles.length)) {
    const base = Math.floor(position / interval);
    target.set(snapshots[base]);

    for (let p = base * interval + 1; p <= position; p++) {
      applyChanges(target, changesAt(log, p));
    }

    return target;
  }

  return {
    width: log.map.width,
    height: log.map.height,
    count: count,
    tilesAt: tilesAt,
  };
}

function isWhole(value) {
  return Number.isInteger(value);
}

function isPoint(value) {
  return typeof value === 'object' && value !== null &&
    isWhole(value.x) && isWhole(value.y);
}

/* Where an applied action shows on the map, in tiles. A building covers
 * its site, placed by its centre tile like in the engine. A route follows
 * the tiles in the log, or a straight line between its ends when it had
 * no plan. Tax and budget actions have no place, so they give null. */
function actionShape(applied) {
  const action = applied.action;

  if (typeof action !== 'object' || action === null) {
    return null;
  }

  if (action.type === 'build' && isWhole(action.x) && isWhole(action.y)) {
    const size = SIZES[action.tool] ?? 1;
    const offset = size > 1 ? 1 : 0;

    return {
      kind: 'area',
      x: action.x - offset,
      y: action.y - offset,
      width: size,
      height: size,
    };
  }

  if (action.type === 'bulldoze' && isWhole(action.x) && isWhole(action.y)) {
    return { kind: 'area', x: action.x, y: action.y, width: 1, height: 1 };
  }

  if (action.type === 'route') {
    if (Array.isArray(applied.tiles) && applied.tiles.length > 0) {
      return { kind: 'path', tiles: applied.tiles, planned: true };
    }

    if (isPoint(action.from) && isPoint(action.to)) {
      return {
        kind: 'path',
        tiles: [[action.from.x, action.from.y], [action.to.x, action.to.y]],
        planned: false,
      };
    }
  }

  return null;
}

function shapeContains(shape, x, y) {
  if (shape.kind === 'area') {
    return x >= shape.x && x < shape.x + shape.width &&
      y >= shape.y && y < shape.y + shape.height;
  }

  return shape.tiles.some((tile) => tile[0] === x && tile[1] === y);
}

function describeAction(action) {
  if (typeof action !== 'object' || action === null) {
    return 'Unknown action ' + JSON.stringify(action);
  }

  const name = NAMES[action.tool] ?? String(action.tool);

  switch (action.type) {
    case 'build':
      return `${name} at ${action.x}, ${action.y}`;
    case 'route':
      return `${name} from ${action.from?.x}, ${action.from?.y} ` +
        `to ${action.to?.x}, ${action.to?.y}`;
    case 'bulldoze':
      return `Bulldoze ${action.x}, ${action.y}`;
    case 'setTaxRate':
      return `Tax rate ${action.rate}%`;
    case 'setBudgetPercentages':
      return `Budget: roads ${action.road}%, fire ${action.fire}%, ` +
        `police ${action.police}%`;
    case 'setAutoBudget':
      return `Auto budget ${action.enabled ? 'on' : 'off'}`;
    default:
      return 'Unknown action ' + JSON.stringify(action).slice(0, 60);
  }
}

function describeResult(result) {
  if (!result.success) {
    return result.reason ?? 'failed';
  }

  return result.cost > 0 ? '$' + result.cost.toLocaleString('en-US') : 'done';
}

export {
  SNAPSHOT_INTERVAL,
  actionShape,
  createMapHistory,
  describeAction,
  describeResult,
  positionCount,
  shapeContains,
};
