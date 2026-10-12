/* Rebuilds the map of any turn from a run log, and says where each action
 * goes on the map and which sprites are where. Plain JavaScript without
 * the DOM, so the viewer and test/replay.test.ts both use it.
 *
 * Position p is the start of turn p, the map the agent saw. The last
 * position, turns.length, is the end of the game. The map of a position is
 * the first map with the changes of every turn up to it. A full copy is
 * kept every SNAPSHOT_INTERVAL positions, so a jump only replays the
 * changes since the nearest copy. */

/**
 * @import { ActionResult, AppliedAction, GameAction, MapHistory, Position,
 *   RunLog, SpriteRecord, SpriteSample, TurnLog } from '../types.ts'
 */

/** @typedef {NonNullable<RunLog['map']>} LogMap */

/**
 * A building's site, or a bulldozed tile.
 * @typedef {object} AreaShape
 * @property {'area'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * A route, along the tiles of its plan or straight between its ends.
 * @typedef {object} PathShape
 * @property {'path'} kind
 * @property {[number, number][]} tiles
 * @property {boolean} planned
 */

/** @typedef {AreaShape | PathShape} Shape */

/** @type {number} */
const SNAPSHOT_INTERVAL = 16;

/**
 * Site sizes from src/gameTools.js, the rest are one tile.
 * @type {Record<string, number>}
 */
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

/** @type {Record<string, string>} */
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

/**
 * Sprite types from src/spriteConstants.ts. The browser draws them from
 * images/sprites.png, a row of 48 pixel cells per type, at the size the
 * sprite has in its constructor: 32 for trains and helicopters.
 * @type {Record<number, string>}
 */
const SPRITE_NAMES = {
  1: 'Train',
  2: 'Helicopter',
  3: 'Airplane',
  4: 'Ship',
  5: 'Monster',
  6: 'Tornado',
  7: 'Explosion',
};
/** @type {number} */
const SPRITE_CELL = 48;

/**
 * @param {number} type
 * @returns {number}
 */
function spriteSize(type) {
  return type === 1 || type === 2 ? 32 : SPRITE_CELL;
}

/**
 * @param {number} type
 * @returns {string}
 */
function spriteName(type) {
  return SPRITE_NAMES[type] ?? 'Sprite ' + type;
}

/**
 * The sprites at a position, as [type, frame, left, top]. Without a
 * sample it is the start of the turn, which is the last sample of the turn
 * before. With a sample from 1 to samplesPerTurn it is that moment inside
 * the turn. Logs before version 3 have no sprites.
 * @param {RunLog} log
 * @param {number} position
 * @param {number | null} [sample]
 * @returns {SpriteRecord[]}
 */
function spritesAt(log, position, sample = null) {
  if (!log.spriteSampling) {
    return [];
  }

  /** @type {TurnLog | undefined} */
  const turn = log.turns[sample === null ? position - 1 : position];
  /** @type {number} */
  const index = sample === null ? log.spriteSampling.samplesPerTurn : sample;
  /** @type {SpriteSample | undefined} */
  const found = turn?.sprites?.find(
    /** @param {SpriteSample} entry @returns {boolean} */
    (entry) => entry[0] === index);
  return found ? found[1] : [];
}

/**
 * The last sprite drawn over a point in map pixels, or null.
 * @param {SpriteRecord[]} sprites
 * @param {number} x
 * @param {number} y
 * @returns {SpriteRecord | null}
 */
function spriteAt(sprites, x, y) {
  for (let index = sprites.length - 1; index >= 0; index--) {
    /** @type {SpriteRecord} */
    const [type, , left, top] = sprites[index];
    /** @type {number} */
    const size = spriteSize(type);

    if (x >= left && x < left + size && y >= top && y < top + size) {
      return sprites[index];
    }
  }

  return null;
}

/**
 * @param {RunLog} log
 * @returns {number}
 */
function positionCount(log) {
  return log.turns.length + 1;
}

/**
 * @param {RunLog} log
 * @param {number} position
 * @returns {[number, number][]}
 */
function changesAt(log, position) {
  return position < log.turns.length ?
    log.turns[position].mapChanges : log.final.mapChanges;
}

/**
 * @param {Uint16Array} tiles
 * @param {[number, number][]} changes
 * @returns {void}
 */
function applyChanges(tiles, changes) {
  for (const [index, value] of changes) {
    tiles[index] = value;
  }
}

/**
 * Needs a log with its map, see recordMap in game.ts.
 * @param {RunLog} log
 * @param {number} [interval]
 * @returns {MapHistory}
 */
function createMapHistory(log, interval = SNAPSHOT_INTERVAL) {
  /** @type {LogMap} */
  const map = /** @type {LogMap} */ (log.map);
  /** @type {number} */
  const count = positionCount(log);
  /** @type {Uint16Array} */
  const tiles = Uint16Array.from(map.tiles);
  /** @type {Uint16Array[]} */
  const snapshots = [];

  for (let position = 0; position < count; position++) {
    applyChanges(tiles, changesAt(log, position));

    if (position % interval === 0) {
      snapshots.push(tiles.slice());
    }
  }

  /**
   * Fills target, or a new array, with the raw tile values of a position.
   * @param {number} position
   * @param {Uint16Array} [target]
   * @returns {Uint16Array}
   */
  function tilesAt(position, target = new Uint16Array(tiles.length)) {
    /** @type {number} */
    const base = Math.floor(position / interval);
    target.set(snapshots[base]);

    for (let index = base * interval + 1; index <= position; index++) {
      applyChanges(target, changesAt(log, index));
    }

    return target;
  }

  return {
    width: map.width,
    height: map.height,
    count: count,
    tilesAt: tilesAt,
  };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isWhole(value) {
  return Number.isInteger(value);
}

/**
 * @param {unknown} value
 * @returns {value is Position}
 */
function isPoint(value) {
  return typeof value === 'object' && value !== null &&
    isWhole(/** @type {Position} */ (value).x) &&
    isWhole(/** @type {Position} */ (value).y);
}

/**
 * Where an applied action shows on the map, in tiles. A building covers
 * its site, placed by its centre tile like in the engine. A route follows
 * the tiles in the log, or a straight line between its ends when it had
 * no plan. Tax and budget actions have no place, so they give null.
 * @param {AppliedAction} applied
 * @returns {Shape | null}
 */
function actionShape(applied) {
  /** @type {GameAction} */
  const action = /** @type {GameAction} */ (applied.action);

  if (typeof action !== 'object' || action === null) {
    return null;
  }

  if (action.type === 'build' && isWhole(action.x) && isWhole(action.y)) {
    /** @type {number} */
    const size = SIZES[action.tool] ?? 1;
    /** @type {number} */
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

/**
 * @param {Shape} shape
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function shapeContains(shape, x, y) {
  if (shape.kind === 'area') {
    return x >= shape.x && x < shape.x + shape.width &&
      y >= shape.y && y < shape.y + shape.height;
  }

  return shape.tiles.some(
    /** @param {[number, number]} tile @returns {boolean} */
    (tile) => tile[0] === x && tile[1] === y);
}

/**
 * @param {string} tool
 * @returns {string}
 */
function toolName(tool) {
  return NAMES[tool] ?? String(tool);
}

/**
 * @param {unknown} logged
 * @returns {string}
 */
function describeAction(logged) {
  if (typeof logged !== 'object' || logged === null) {
    return 'Unknown action ' + JSON.stringify(logged);
  }

  /** @type {GameAction} */
  const action = /** @type {GameAction} */ (logged);

  switch (action.type) {
    case 'build':
      return `${toolName(action.tool)} at ${action.x}, ${action.y}`;
    case 'route':
      return `${toolName(action.tool)} from ${action.from?.x}, ` +
        `${action.from?.y} to ${action.to?.x}, ${action.to?.y}`;
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

/**
 * @param {ActionResult} result
 * @returns {string}
 */
function describeResult(result) {
  if (!result.success) {
    return result.reason ?? 'failed';
  }

  return result.cost > 0 ? '$' + result.cost.toLocaleString('en-US') : 'done';
}

export {
  SPRITE_CELL,
  actionShape,
  createMapHistory,
  describeAction,
  describeResult,
  positionCount,
  shapeContains,
  spriteAt,
  spriteName,
  spriteSize,
  spritesAt,
};
