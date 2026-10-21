import {
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
} from './replay.js';
import {
  TILES,
  TILES_PER_ROW,
  TILE_SIZE,
  describeTile,
  isUnpoweredZone,
  tileIndex,
} from './tiles.js';
import { HELP, REPORT_HELP } from './help.js';

/**
 * @import { ActionResult, AppliedAction, CityDate, CityState, GameAction,
 *   GameOptions, MapHistory, Position, RunLog, SpriteRecord,
 *   TurnLog } from '../types.ts'
 * @import { Shape } from './replay.js'
 */

/**
 * The log on screen, with the map image and the series of the tracks. The
 * map fields are null for a log written with recordMap off.
 * @typedef {object} Run
 * @property {RunLog} log
 * @property {string} name
 * @property {number} count
 * @property {MapHistory | null} history
 * @property {Uint16Array | null} tiles
 * @property {Int32Array | null} painted
 * @property {HTMLCanvasElement | null} image
 * @property {number[]} population
 * @property {number[]} funds
 * @property {LoweredFunding[]} lowered
 */

/**
 * For each funding share at one position of the log, the date of the
 * budget window that lowered it, or null when no window did or a budget
 * action set the share again since.
 * @typedef {object} LoweredFunding
 * @property {CityDate | null} road
 * @property {CityDate | null} fire
 * @property {CityDate | null} police
 */

/**
 * An action of the turn that has a place on the map.
 * @typedef {object} PlacedAction
 * @property {number} index
 * @property {AppliedAction} applied
 * @property {Shape} shape
 */

/**
 * A point on the map canvas, in CSS pixels.
 * @typedef {object} ScreenPoint
 * @property {number} screenX
 * @property {number} screenY
 */

/**
 * A drag on the map: where the pointer and the camera were when it began,
 * and whether it went far enough to pan.
 * @typedef {object} Drag
 * @property {number} startX
 * @property {number} startY
 * @property {number} cameraX
 * @property {number} cameraY
 * @property {boolean} moved
 */

/**
 * @typedef {object} Lane
 * @property {number} top
 * @property {number} height
 */

/** @type {string[]} */
const LEVELS = ['Easy', 'Medium', 'Hard'];
/** @type {string[]} */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
  'Sep', 'Oct', 'Nov', 'Dec'];
/** @type {[keyof CityState['problems'], string][]} */
const PROBLEMS = [
  ['crime', 'Crime'],
  ['pollution', 'Pollution'],
  ['housing', 'Housing'],
  ['taxes', 'Taxes'],
  ['traffic', 'Traffic'],
  ['unemployment', 'Unemployment'],
  ['fire', 'Fire'],
];
/**
 * The agent report fields that are amounts of money.
 * @type {string[]}
 */
const MONEY_FIELDS = ['reserve'];
/** @type {('road' | 'fire' | 'police')[]} */
const SERVICES = ['road', 'fire', 'police'];
/**
 * The building whose lack makes the engine cap each demand.
 * @type {Record<'residential' | 'commercial' | 'industrial', string>}
 */
const CAP_BUILDINGS = {
  residential: 'stadium',
  commercial: 'airport',
  industrial: 'seaport',
};
/** @type {number} */
const MIN_ZOOM = 0.2;
/** @type {number} */
const MAX_ZOOM = 8;
/** @type {number} */
const ZOOM_STEP = 1.5;

/**
 * The tracks under the slider use the same x axis: they start and end at
 * the centre of the thumb, which is --thumb wide in style.css.
 * @type {number}
 */
const THUMB = 14;
/** @type {number} */
const TRACK_PAD = THUMB / 2;
/** @type {Record<string, Lane>} */
const LANES = {
  actions: { top: 0, height: 28 },
  population: { top: 32, height: 34 },
  funds: { top: 70, height: 34 },
};
/** @type {number} */
const AXIS_TOP = 106;

/**
 * @template {HTMLElement} Element
 * @param {string} id
 * @returns {Element}
 */
function byId(id) {
  return /** @type {Element} */ (document.getElementById(id));
}

/** @type {HTMLCanvasElement} */
const canvas = byId('map');
/** @type {CanvasRenderingContext2D} */
const mapContext = canvas.getContext('2d');
/** @type {HTMLInputElement} */
const slider = byId('slider');
/** @type {HTMLCanvasElement} */
const tracks = byId('tracks');
/** @type {HTMLElement} */
const workspace = byId('workspace');
/** @type {HTMLInputElement} */
const fileInput = byId('file');
/** @type {HTMLElement} */
const helpTip = byId('help-tip');
/**
 * The help targets over the names of the three tracks, which are drawn on
 * the canvas.
 * @type {[string, Lane, HTMLElement][]}
 */
const LANE_HELP = [
  ['ACTIONS', LANES.actions, byId('help-actions')],
  ['POPULATION', LANES.population, byId('help-population')],
  ['FUNDS', LANES.funds, byId('help-funds')],
];
/** @type {MediaQueryList} */
const narrow = window.matchMedia('(max-width: 1199px)');
/** @type {MediaQueryList} */
const coarse = window.matchMedia('(pointer: coarse)');

/** @type {CSSStyleDeclaration} */
const styles = getComputedStyle(document.documentElement);

/**
 * @param {string} name
 * @returns {string}
 */
function token(name) {
  return styles.getPropertyValue(name).trim();
}

/** @type {Record<string, string>} */
const COLORS = {
  ok: token('--ok'),
  fail: token('--fail'),
  pick: token('--pick'),
  fg: token('--fg'),
  muted: token('--fg-muted'),
  bg: token('--bg'),
  lane: token('--surface'),
  bar: token('--track-bar'),
  window: token('--window'),
  population: token('--population'),
  funds: token('--funds'),
};
/** @type {string} */
const FONT_UI = token('--font-ui');
/** @type {string} */
const FONT_MONO = token('--font-mono');

/** @type {HTMLImageElement} */
const sheet = new Image();
/** @type {Promise<Event>} */
const sheetLoaded = new Promise(
  /**
   * @param {(event: Event) => void} resolve
   * @param {(error: Error) => void} reject
   * @returns {void}
   */
  (resolve, reject) => {
    sheet.onload = resolve;
    sheet.onerror = /** @returns {void} */ () =>
      reject(new Error('Could not load tiles.png.'));
  });
sheet.src = 'tiles.png';

/**
 * The game's sprite sheet. Without it the map still works, with no sprites.
 * @type {HTMLImageElement}
 */
const spriteSheet = new Image();
/** @type {boolean} */
let spritesReady = false;
spriteSheet.onload = /** @returns {void} */ () => {
  spritesReady = true;
  render();
};
spriteSheet.src = 'sprites.png';

/**
 * A map pixel p is drawn at p * zoom + x on screen, in CSS pixels. While
 * fitted, the map is fitted again when the window changes size.
 * @type {{ zoom: number, x: number, y: number, fitted: boolean }}
 */
const camera = { zoom: 1, x: 0, y: 0, fitted: true };

/** @type {Run | null} */
let run = null;
/** @type {number} */
let position = 0;
/** @type {number} */
let selected = -1;
/** @type {ScreenPoint | null} */
let hover = null;
/** @type {Drag | null} */
let drag = null;
/** @type {boolean} */
let scrubbing = false;
/** @type {number | null} */
let trackHover = null;
/** @type {number | null} */
let frameRequest = null;
/** @type {number} */
let playStart = 0;
/** @type {number | null} */
let sample = null;
/** @type {boolean} */
let showAfter = false;
/** @type {boolean} */
let markPower = true;
/** @type {boolean} */
let showSprites = true;
/** @type {HTMLElement | null} */
let helpTarget = null;

/**
 * @param {string} tag
 * @param {string} text
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function element(tag, text, className) {
  /** @type {HTMLElement} */
  const node = document.createElement(tag);
  node.textContent = text;

  if (className) {
    node.className = className;
  }

  return node;
}

/**
 * A small stroke icon, a check for success and a cross for failure.
 * @param {boolean} ok
 * @returns {SVGSVGElement}
 */
function statusIcon(ok) {
  /** @type {SVGSVGElement} */
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  /** @type {SVGPathElement} */
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon status');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', ok ? 'M20 6 9 17l-5-5' : 'M18 6 6 18M6 6l12 12');
  svg.append(path);
  return svg;
}

/**
 * @param {CityDate} date
 * @returns {string}
 */
function formatDate(date) {
  return `${MONTHS[date.month]} ${date.year}`;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatMoney(value) {
  return '$' + formatNumber(value);
}

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/**
 * The message over the map: empty state, loading, errors and logs with no
 * map.
 * @param {string} text
 * @param {{ isError?: boolean, canOpen?: boolean }} [options]
 * @returns {void}
 */
function showMessage(text, { isError = false, canOpen = false } = {}) {
  byId('message').hidden = text === '';
  byId('message').classList.toggle('error', isError);
  byId('message-text').textContent = text;
  byId('message-open').hidden = !canOpen;
}

/**
 * @param {Error} error
 * @returns {void}
 */
function showError(error) {
  showMessage(error.message, { isError: true, canOpen: true });
}

/**
 * @param {number} index
 * @returns {CityState}
 */
function stateAt(index) {
  return index < run.log.turns.length ?
    run.log.turns[index].state : run.log.final.state;
}

/**
 * @param {number} index
 * @returns {TurnLog | null}
 */
function turnAt(index) {
  return index < run.log.turns.length ? run.log.turns[index] : null;
}

/**
 * Follows the funding shares through the log. A budget action sets them,
 * and a budget window lowers one when it pays less than the share set, as
 * the window would show that share. An agent can set a low share itself,
 * so only a window counts as lowering. Logs before version 4 have no
 * shares in the state.
 * @param {RunLog} log
 * @returns {LoweredFunding[]}
 */
function findLoweredFunding(log) {
  /** @type {CityState} */
  const first = log.turns.length > 0 ? log.turns[0].state : log.final.state;
  /** @type {LoweredFunding} */
  const current = { road: null, fire: null, police: null };
  /** @type {LoweredFunding[]} */
  const lowered = [];

  if (first.funding === undefined) {
    return Array.from({ length: log.turns.length + 1 }, () => current);
  }

  /** @type {Record<string, number>} */
  const shares = { ...first.funding };

  for (const turn of log.turns) {
    lowered.push({ ...current });

    for (const applied of turn.actions) {
      /** @type {GameAction} */
      const action = /** @type {GameAction} */ (applied.action);

      if (applied.result.success && action.type === 'setBudgetPercentages') {
        for (const service of SERVICES) {
          shares[service] = action[service];
          current[service] = null;
        }
      }
    }

    for (const record of turn.budgetWindows) {
      for (const service of SERVICES) {
        if (record[service] < Math.floor(shares[service] / 100 * 100)) {
          current[service] = record.date;
        }

        shares[service] = record[service];
      }
    }
  }

  lowered.push({ ...current });
  return lowered;
}

/**
 * @param {TurnLog} turn
 * @returns {number}
 */
function failedCount(turn) {
  return turn.actions.filter(
    /** @param {AppliedAction} applied @returns {boolean} */
    (applied) => !applied.result.success).length;
}

/**
 * @returns {number}
 */
function mapPosition() {
  return showAfter ? Math.min(position + 1, run.count - 1) : position;
}

/**
 * @param {RunLog} log
 * @param {string} name
 * @returns {Promise<void>}
 */
async function start(log, name) {
  if (typeof log !== 'object' || log === null || !Array.isArray(log.turns) ||
      typeof log.final !== 'object') {
    throw new Error('This file is not a run log from runGame.');
  }

  stop();
  await sheetLoaded;

  /** @type {MapHistory | null} */
  const history = log.map ? createMapHistory(log) : null;
  /** @type {number} */
  const size = history ? history.width * history.height : 0;

  run = {
    log: log,
    name: name,
    count: positionCount(log),
    history: history,
    tiles: history ? new Uint16Array(size) : null,
    painted: history ? new Int32Array(size).fill(-1) : null,
    image: null,
    population: [],
    funds: [],
    lowered: findLoweredFunding(log),
  };

  for (let index = 0; index < run.count; index++) {
    run.population.push(stateAt(index).population);
    run.funds.push(stateAt(index).funds);
  }

  if (history) {
    run.image = document.createElement('canvas');
    run.image.width = history.width * TILE_SIZE;
    run.image.height = history.height * TILE_SIZE;
  }

  slider.max = String(run.count - 1);
  showSettings();
  showMessage(history ? '' : 'This log has no map, it was written with ' +
    'recordMap off.');
  fit();
  setPosition(0);
}

/**
 * @returns {void}
 */
function showSettings() {
  /** @type {GameOptions} */
  const options = run.log.options;
  /** @type {RunLog['agent']} */
  const agent = run.log.agent;
  /** @type {unknown} */
  const agentSeed = agent.settings && agent.settings.seed !== undefined ?
    agent.settings.seed : 'none';
  /** @type {[string, unknown][]} */
  const settings = [
    ['agent', agent.name],
    ['seed', options.seed],
    ['agent seed', agentSeed],
    ['level', LEVELS[options.level] ?? options.level],
    ['disasters', options.disasters ? 'on' : 'off'],
    ['months/turn', options.monthsPerTurn],
    ['turns', run.log.turns.length],
    ['max actions', options.maxActionsPerTurn],
  ];

  byId('file-name').textContent = run.name;
  byId('file-name').title = run.name;
  byId('run').replaceChildren(...settings.map(
    /** @param {[string, unknown]} setting @returns {HTMLElement} */
    ([name, value]) => {
      /** @type {HTMLElement} */
      const item = element('li', name + ' ');
      item.append(element('span', String(value), 'value'));
      return item;
    }));
  document.title = `Replay: ${agent.name}, seed ${options.seed}`;
}

/**
 * @param {number} target
 * @returns {void}
 */
function setPosition(target) {
  if (run === null) {
    return;
  }

  position = clamp(Math.round(target), 0, run.count - 1);
  selected = -1;
  sample = null;
  slider.value = String(position);

  // An error from a file that did not load stays until the next step
  if (run.history !== null) {
    showMessage('');
  }

  /** @type {{ key: string, focused: boolean } | null} */
  const help = openHelp();

  showActions();
  showState();
  refreshMap();
  drawTracks();
  reopenHelp(help);
}

/**
 * @returns {void}
 */
function showPosition() {
  /** @type {string} */
  const date = formatDate(stateAt(position).date);
  /** @type {boolean} */
  const ended = position >= run.log.turns.length;
  /** @type {number} */
  const shown = mapPosition();
  /** @type {string} */
  const mapNote = shown === position ? '' :
    ` · map of ${formatDate(stateAt(shown).date)}`;

  byId('position').textContent = (ended ? 'End' :
    `Turn ${position} of ${run.log.turns.length}`) + ` · ${date}`;
  byId('viewport-turn').textContent = (ended ? 'End' : `Turn ${position}`) +
    ` · ${date}${mapNote}`;
}

/**
 * @returns {void}
 */
function refreshMap() {
  if (run.history) {
    run.history.tilesAt(mapPosition(), run.tiles);
    paintTiles();
  }

  showPosition();
  render();
  showHover();
}

/**
 * Draws the tiles that changed since the last call onto the map image.
 * @returns {void}
 */
function paintTiles() {
  /** @type {CanvasRenderingContext2D} */
  const image = run.image.getContext('2d');
  /** @type {number} */
  const width = run.history.width;

  for (let index = 0; index < run.tiles.length; index++) {
    /** @type {number} */
    const value = run.tiles[index];
    /** @type {number} */
    const tile = markPower && isUnpoweredZone(value) ?
      TILES.LIGHTNINGBOLT : tileIndex(value);

    if (run.painted[index] === tile) {
      continue;
    }

    run.painted[index] = tile;
    image.drawImage(sheet,
      (tile % TILES_PER_ROW) * TILE_SIZE,
      Math.floor(tile / TILES_PER_ROW) * TILE_SIZE, TILE_SIZE, TILE_SIZE,
      (index % width) * TILE_SIZE, Math.floor(index / width) * TILE_SIZE,
      TILE_SIZE, TILE_SIZE);
  }
}

/**
 * The actions of this turn that have a place on the map, selected last.
 * @returns {PlacedAction[]}
 */
function currentShapes() {
  /** @type {TurnLog | null} */
  const turn = turnAt(position);

  if (turn === null) {
    return [];
  }

  return turn.actions
    .map(
      /**
       * @param {AppliedAction} applied
       * @param {number} index
       * @returns {PlacedAction}
       */
      (applied, index) => ({
        index: index,
        applied: applied,
        shape: actionShape(applied),
      }))
    .filter(
      /** @param {PlacedAction} item @returns {boolean} */
      (item) => item.shape !== null)
    .sort(
      /**
       * @param {PlacedAction} first
       * @param {PlacedAction} second
       * @returns {number}
       */
      (first, second) => Number(first.index === selected) -
        Number(second.index === selected));
}

/**
 * @returns {void}
 */
function render() {
  /** @type {number} */
  const ratio = window.devicePixelRatio || 1;

  mapContext.setTransform(1, 0, 0, 1, 0, 0);
  mapContext.clearRect(0, 0, canvas.width, canvas.height);

  if (run === null || run.image === null) {
    byId('zoom').textContent = '';
    return;
  }

  mapContext.setTransform(ratio * camera.zoom, 0, 0, ratio * camera.zoom,
    ratio * camera.x, ratio * camera.y);
  mapContext.imageSmoothingEnabled = camera.zoom < 1;
  mapContext.drawImage(run.image, 0, 0);
  drawSprites(currentSprites());

  /** @type {PlacedAction[]} */
  const shapes = currentShapes();
  shapes.forEach(drawShape);
  drawHoverTile();

  mapContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  shapes.forEach(drawLabel);
  byId('zoom').textContent = Math.round(camera.zoom * 100) + '%';
}

/**
 * At rest the sprites of the start of the turn, or of its end with After
 * turn. While playing, the sample of the turn that the time has reached.
 * @returns {SpriteRecord[]}
 */
function currentSprites() {
  if (!showSprites || run === null) {
    return [];
  }

  return sample === null ? spritesAt(run.log, mapPosition()) :
    spritesAt(run.log, position, sample);
}

/**
 * @param {SpriteRecord[]} sprites
 * @returns {void}
 */
function drawSprites(sprites) {
  if (!spritesReady) {
    return;
  }

  for (const [type, frame, left, top] of sprites) {
    /** @type {number} */
    const size = spriteSize(type);
    mapContext.drawImage(spriteSheet, (frame - 1) * SPRITE_CELL,
      (type - 1) * SPRITE_CELL, size, size, left, top, size, size);
  }
}

/**
 * @param {[number, number][]} points
 * @returns {void}
 */
function trace(points) {
  mapContext.beginPath();
  points.forEach(
    /**
     * @param {[number, number]} point
     * @param {number} index
     * @returns {void}
     */
    ([x, y], index) => index === 0 ? mapContext.moveTo(x, y) :
      mapContext.lineTo(x, y));
}

/**
 * Successful actions are solid green, failed ones dashed red with their
 * reason, and the selected one amber. The others fade while one is
 * selected.
 * @param {PlacedAction} item
 * @returns {void}
 */
function drawShape(item) {
  /** @type {boolean} */
  const ok = item.applied.result.success;
  /** @type {boolean} */
  const picked = item.index === selected;
  /** @type {string} */
  const color = picked ? COLORS.pick : ok ? COLORS.ok : COLORS.fail;
  /** @type {number} */
  const unit = 1 / camera.zoom;
  /** @type {Shape} */
  const shape = item.shape;

  mapContext.save();
  mapContext.globalAlpha = selected >= 0 && !picked ? 0.35 : 1;
  mapContext.strokeStyle = color;
  mapContext.fillStyle = color;
  mapContext.lineWidth = (picked ? 3 : 2) * unit;
  mapContext.lineJoin = 'round';
  mapContext.lineCap = 'round';
  mapContext.setLineDash(ok ? [] : [6 * unit, 4 * unit]);

  if (shape.kind === 'area') {
    /** @type {number} */
    const x = shape.x * TILE_SIZE;
    /** @type {number} */
    const y = shape.y * TILE_SIZE;
    /** @type {number} */
    const width = shape.width * TILE_SIZE;
    /** @type {number} */
    const height = shape.height * TILE_SIZE;
    /** @type {number} */
    const inset = mapContext.lineWidth / 2;

    mapContext.save();
    mapContext.globalAlpha *= 0.2;
    mapContext.fillRect(x, y, width, height);
    mapContext.restore();
    mapContext.strokeRect(x + inset, y + inset, width - 2 * inset,
      height - 2 * inset);

    if (/** @type {GameAction} */ (item.applied.action).type === 'bulldoze') {
      mapContext.beginPath();
      mapContext.moveTo(x + 3, y + 3);
      mapContext.lineTo(x + width - 3, y + height - 3);
      mapContext.moveTo(x + width - 3, y + 3);
      mapContext.lineTo(x + 3, y + height - 3);
      mapContext.stroke();
    }
  } else {
    /** @type {[number, number][]} */
    const points = shape.tiles.map(
      /** @param {[number, number]} tile @returns {[number, number]} */
      ([x, y]) => [(x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE]);

    if (shape.planned) {
      mapContext.save();
      mapContext.globalAlpha *= 0.3;
      mapContext.lineWidth = TILE_SIZE * 0.7;
      mapContext.setLineDash([]);
      trace(points);
      mapContext.stroke();
      mapContext.restore();
    }

    trace(points);
    mapContext.stroke();

    for (const [x, y] of [points[0], points[points.length - 1]]) {
      mapContext.beginPath();
      mapContext.arc(x, y, 3.5 * unit, 0, 2 * Math.PI);
      mapContext.fill();
    }
  }

  mapContext.restore();
}

/**
 * The number of the action, and the reason when it failed, in screen
 * space.
 * @param {PlacedAction} item
 * @returns {void}
 */
function drawLabel(item) {
  /** @type {Shape} */
  const shape = item.shape;
  /** @type {[number, number]} */
  const tile = shape.kind === 'area' ? [shape.x, shape.y] :
    [shape.tiles[0][0] + 0.5, shape.tiles[0][1] + 0.5];
  /** @type {number} */
  const x = tile[0] * TILE_SIZE * camera.zoom + camera.x;
  /** @type {number} */
  const y = tile[1] * TILE_SIZE * camera.zoom + camera.y;
  /** @type {ActionResult} */
  const result = item.applied.result;
  /** @type {string} */
  const text = String(item.index + 1) +
    (result.success ? '' : ' ' + describeResult(result));
  /** @type {boolean} */
  const picked = item.index === selected;

  mapContext.save();
  mapContext.globalAlpha = selected >= 0 && !picked ? 0.35 : 1;
  mapContext.font = `600 11px ${FONT_UI}`;

  /** @type {number} */
  const width = mapContext.measureText(text).width + 8;

  mapContext.fillStyle = picked ? COLORS.pick : result.success ? COLORS.ok :
    COLORS.fail;
  mapContext.fillRect(x, y - 15, width, 15);
  mapContext.fillStyle = COLORS.bg;
  mapContext.fillText(text, x + 4, y - 4);
  mapContext.restore();
}

/**
 * @returns {void}
 */
function drawHoverTile() {
  /** @type {Position | null} */
  const tile = hoverTile();

  if (tile === null) {
    return;
  }

  mapContext.save();
  mapContext.strokeStyle = COLORS.fg;
  mapContext.lineWidth = 1 / camera.zoom;
  mapContext.setLineDash([]);
  mapContext.strokeRect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE,
    TILE_SIZE);
  mapContext.restore();
}

/**
 * @param {number} screenX
 * @param {number} screenY
 * @returns {Position | null}
 */
function screenToTile(screenX, screenY) {
  if (run === null || run.history === null) {
    return null;
  }

  /** @type {number} */
  const x = Math.floor((screenX - camera.x) / camera.zoom / TILE_SIZE);
  /** @type {number} */
  const y = Math.floor((screenY - camera.y) / camera.zoom / TILE_SIZE);

  if (x < 0 || y < 0 || x >= run.history.width || y >= run.history.height) {
    return null;
  }

  return { x: x, y: y };
}

/**
 * The tile under the pointer, also after the map moved under it.
 * @returns {Position | null}
 */
function hoverTile() {
  return hover === null ? null : screenToTile(hover.screenX, hover.screenY);
}

/**
 * The status bar says what the tile under the pointer, or the tapped one,
 * is.
 * @returns {void}
 */
function showHover() {
  /** @type {Position | null} */
  const tile = hoverTile();

  if (tile === null || run === null || run.tiles === null) {
    byId('hover').textContent = run === null ? 'No log loaded' :
      coarse.matches ? 'Tap a tile to see what it is' :
      'Point at a tile to see what it is';
    return;
  }

  /** @type {number} */
  const value = run.tiles[tile.y * run.history.width + tile.x];
  /** @type {SpriteRecord | null} */
  const sprite = spriteAt(currentSprites(),
    (hover.screenX - camera.x) / camera.zoom,
    (hover.screenY - camera.y) / camera.zoom);
  byId('hover').textContent = (sprite === null ? '' :
    spriteName(sprite[0]) + ' over ') + `${tile.x}, ${tile.y} · ` +
    `${describeTile(value)} · tile ${tileIndex(value)}`;
}

/**
 * @returns {void}
 */
function fit() {
  if (run === null || run.history === null) {
    return;
  }

  /** @type {number} */
  const width = run.history.width * TILE_SIZE;
  /** @type {number} */
  const height = run.history.height * TILE_SIZE;

  camera.zoom = clamp(Math.min(canvas.clientWidth / width,
    canvas.clientHeight / height), MIN_ZOOM, MAX_ZOOM);
  camera.x = (canvas.clientWidth - width * camera.zoom) / 2;
  camera.y = (canvas.clientHeight - height * camera.zoom) / 2;
  camera.fitted = true;
  render();
}

/**
 * @param {number} screenX
 * @param {number} screenY
 * @param {number} zoom
 * @returns {void}
 */
function zoomAt(screenX, screenY, zoom) {
  /** @type {number} */
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  /** @type {number} */
  const mapX = (screenX - camera.x) / camera.zoom;
  /** @type {number} */
  const mapY = (screenY - camera.y) / camera.zoom;

  camera.zoom = next;
  camera.x = screenX - mapX * next;
  camera.y = screenY - mapY * next;
  camera.fitted = false;
  render();
}

/**
 * @param {number} factor
 * @returns {void}
 */
function zoomBy(factor) {
  if (run !== null) {
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2,
      camera.zoom * factor);
    showHover();
  }
}

/**
 * Centres the map on a shape that is not fully in view.
 * @param {Shape} shape
 * @returns {void}
 */
function reveal(shape) {
  /** @type {[number, number][]} */
  const tiles = shape.kind === 'area' ?
    [[shape.x, shape.y], [shape.x + shape.width, shape.y + shape.height]] :
    shape.tiles.map(
      /** @param {[number, number]} tile @returns {[number, number]} */
      ([x, y]) => [x, y]).concat(shape.tiles.map(
      /** @param {[number, number]} tile @returns {[number, number]} */
      ([x, y]) => [x + 1, y + 1]));
  /** @type {number[]} */
  const xs = tiles.map(
    /** @param {[number, number]} tile @returns {number} */
    (tile) => tile[0] * TILE_SIZE * camera.zoom + camera.x);
  /** @type {number[]} */
  const ys = tiles.map(
    /** @param {[number, number]} tile @returns {number} */
    (tile) => tile[1] * TILE_SIZE * camera.zoom + camera.y);
  /** @type {number} */
  const left = Math.min(...xs);
  /** @type {number} */
  const right = Math.max(...xs);
  /** @type {number} */
  const top = Math.min(...ys);
  /** @type {number} */
  const bottom = Math.max(...ys);

  if (left >= 0 && top >= 0 && right <= canvas.clientWidth &&
      bottom <= canvas.clientHeight) {
    return;
  }

  camera.x += canvas.clientWidth / 2 - (left + right) / 2;
  camera.y += canvas.clientHeight / 2 - (top + bottom) / 2;
  camera.fitted = false;
}

/**
 * @param {number} index
 * @returns {void}
 */
function select(index) {
  selected = selected === index ? -1 : index;

  /** @type {HTMLCollectionOf<HTMLElement>} */
  const items = /** @type {HTMLCollectionOf<HTMLElement>} */ (
    byId('actions').children);

  for (const item of items) {
    /** @type {boolean} */
    const picked = Number(item.dataset.index) === selected;
    item.querySelector('.row').setAttribute('aria-pressed', String(picked));

    if (picked) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }

  /** @type {TurnLog | null} */
  const turn = turnAt(position);

  if (selected >= 0 && turn !== null) {
    /** @type {Shape | null} */
    const shape = actionShape(turn.actions[selected]);

    if (shape !== null) {
      reveal(shape);
    }
  }

  render();
  showHover();
}

/**
 * @param {number} screenX
 * @param {number} screenY
 * @returns {void}
 */
function clickAt(screenX, screenY) {
  /** @type {Position | null} */
  const tile = screenToTile(screenX, screenY);
  /** @type {PlacedAction | undefined} */
  const hit = tile === null ? undefined : currentShapes().reverse().find(
    /** @param {PlacedAction} item @returns {boolean} */
    (item) => shapeContains(item.shape, tile.x, tile.y));

  if (hit !== undefined) {
    // With the panels in tabs, show the list the selection belongs to
    if (narrow.matches) {
      showTab('actions');
    }

    select(hit.index);
  } else if (selected >= 0) {
    select(selected);
  }
}

/**
 * @returns {void}
 */
function showActions() {
  /** @type {HTMLElement} */
  const list = byId('actions');
  /** @type {TurnLog | null} */
  const turn = turnAt(position);

  list.replaceChildren();

  if (turn === null) {
    byId('actions-summary').textContent = 'end';
    byId('actions-note').textContent = 'The game is over.';
    return;
  }

  /** @type {number} */
  const failed = failedCount(turn);
  byId('actions-summary').textContent = `turn ${position} · ` +
    `${turn.actions.length} played` + (failed > 0 ? `, ${failed} failed` : '');

  turn.actions.forEach(
    /**
     * @param {AppliedAction} applied
     * @param {number} index
     * @returns {void}
     */
    (applied, index) => {
      /** @type {boolean} */
      const ok = applied.result.success;
      /** @type {HTMLLIElement} */
      const item = document.createElement('li');
      /** @type {HTMLButtonElement} */
      const row = document.createElement('button');

      item.dataset.index = String(index);
      item.className = ok ? 'ok' : 'failed';
      row.type = 'button';
      row.className = 'row';
      row.setAttribute('aria-pressed', 'false');
      row.append(
        element('span', String(index + 1), 'number'),
        statusIcon(ok),
        element('span', describeAction(applied.action), 'what'),
        element('span', (ok ? '' : 'failed: ') +
          describeResult(applied.result), 'result'));
      row.addEventListener('click',
        /** @returns {void} */ () => select(index));
      item.append(row);
      list.append(item);
    });

  /** @type {string[]} */
  const notes = [];

  if (turn.actions.length === 0) {
    notes.push('No actions this turn.');
  }

  if (turn.dropped > 0) {
    notes.push(`${turn.dropped} more were dropped past the limit.`);
  }

  byId('actions-note').textContent = notes.join(' ');
}

/**
 * A bar from the left, or from the middle for values that can be negative,
 * with a line under it when the engine holds the value for a reason.
 * @param {string} name
 * @param {number} value
 * @param {number} max
 * @param {string} color
 * @param {boolean} centred
 * @param {string} help
 * @param {string} [reason]
 * @returns {HTMLElement[]}
 */
function bar(name, value, max, color, centred, help, reason = '') {
  /** @type {HTMLElement} */
  const track = element('div', '', 'bar' + (centred ? ' centred' : ''));
  /** @type {HTMLElement} */
  const fill = element('div', '', 'fill');
  /** @type {number} */
  const share = clamp(value / max, centred ? -1 : 0, 1);

  if (centred) {
    fill.style.left = (share >= 0 ? 50 : 50 + share * 50) + '%';
    fill.style.width = Math.abs(share) * 50 + '%';
  } else {
    fill.style.left = '0';
    fill.style.width = share * 100 + '%';
  }

  fill.style.background = color;
  track.append(fill);

  /** @type {HTMLElement[]} */
  const cells = [withHelp(element('span', name), help), track,
    element('span', formatNumber(value), 'value')];

  return reason === '' ? cells : [...cells, element('span', reason, 'reason')];
}

/**
 * @param {[string, string, string, string?][]} rows name, value, help key
 *   and the reason the engine holds the value, if it does
 * @returns {HTMLElement[]}
 */
function keyValues(rows) {
  return rows.flatMap(
    /**
     * @param {[string, string, string, string?]} row
     * @returns {HTMLElement[]}
     */
    ([name, value, help, reason]) => {
      /** @type {HTMLElement[]} */
      const cells = [withHelp(element('dt', name), help),
        element('dd', value)];

      return reason ? [...cells, element('dd', reason, 'reason')] : cells;
    });
}

/**
 * Gives an element the explanation in help.js under a key, and lets the
 * keyboard reach it.
 * @param {HTMLElement} node
 * @param {string} key
 * @returns {HTMLElement}
 */
function withHelp(node, key) {
  node.dataset.help = key;
  node.tabIndex = 0;
  return node;
}

/**
 * The fields of an agent report have keys like report.draws, explained for
 * the agent of the log. A field the help has no text for gets the general
 * one.
 * @param {string} key
 * @returns {string}
 */
function helpText(key) {
  if (key.startsWith('report.')) {
    return REPORT_HELP[run?.log.agent.name ?? '']
      ?.[key.slice('report.'.length)] ?? HELP.report;
  }

  return HELP[key] ?? '';
}

/**
 * @param {EventTarget | null} target
 * @returns {HTMLElement | null}
 */
function helpOwner(target) {
  return target instanceof Element ?
    /** @type {HTMLElement | null} */ (target.closest('[data-help]')) : null;
}

/**
 * Puts the tip under its target, or above it when there is no room below,
 * and keeps it inside the window.
 * @returns {void}
 */
function placeHelp() {
  /** @type {DOMRect} */
  const target = helpTarget.getBoundingClientRect();
  /** @type {number} */
  const width = document.documentElement.clientWidth;
  /** @type {number} */
  const height = document.documentElement.clientHeight;
  /** @type {number} */
  const below = target.bottom + 6;
  /** @type {number} */
  const above = target.top - helpTip.offsetHeight - 6;

  helpTip.style.left = clamp(target.left, 8,
    width - helpTip.offsetWidth - 8) + 'px';
  helpTip.style.top = (below + helpTip.offsetHeight <= height - 8 ||
    above < 8 ? below : above) + 'px';
}

/**
 * @param {HTMLElement} target
 * @returns {void}
 */
function showHelp(target) {
  if (helpTarget !== null && helpTarget !== target) {
    helpTarget.removeAttribute('aria-describedby');
  }

  helpTarget = target;
  helpTip.textContent = helpText(target.dataset.help);
  helpTip.hidden = false;
  target.setAttribute('aria-describedby', 'help-tip');
  placeHelp();
}

/**
 * @returns {void}
 */
function hideHelp() {
  if (helpTarget !== null) {
    helpTarget.removeAttribute('aria-describedby');
  }

  helpTarget = null;
  helpTip.hidden = true;
}

/**
 * The inspector is built again at every step. The open tip is noted
 * before, so reopenHelp can show it on the new element of the same metric
 * and give that element the focus back.
 * @returns {{ key: string, focused: boolean } | null}
 */
function openHelp() {
  return helpTarget === null ? null : {
    key: helpTarget.dataset.help,
    focused: helpTarget === document.activeElement,
  };
}

/**
 * @param {{ key: string, focused: boolean } | null} help
 * @returns {void}
 */
function reopenHelp(help) {
  if (help === null) {
    return;
  }

  /** @type {HTMLElement | null} */
  const replacement = document.querySelector(`[data-help="${help.key}"]`);

  if (replacement === null) {
    hideHelp();
    return;
  }

  if (help.focused && document.activeElement !== replacement) {
    replacement.focus({ preventScroll: true });
  }

  showHelp(replacement);
}

/**
 * Logs before version 4 have no funding, auto budget or effects.
 * @param {CityState} state
 * @returns {void}
 */
function showBudget(state) {
  if (state.funding === undefined) {
    byId('budget').replaceChildren(...keyValues([
      ['Budget', 'not in this log', 'budgetMissing'],
    ]));
    return;
  }

  /** @type {LoweredFunding} */
  const lowered = run.lowered[position];
  /**
   * @param {'road' | 'fire' | 'police'} service
   * @returns {string}
   */
  const loweredBy = (service) => lowered[service] === null ? '' :
    `lowered by the engine after a short budget in ` +
    formatDate(lowered[service]);

  byId('budget').replaceChildren(...keyValues([
    ['Auto budget', state.autoBudget ? 'On' : 'Off', 'autoBudget'],
    ['Road funding', state.funding.road + '%', 'roadFunding',
      loweredBy('road')],
    ['Fire funding', state.funding.fire + '%', 'fireFunding',
      loweredBy('fire')],
    ['Police funding', state.funding.police + '%', 'policeFunding',
      loweredBy('police')],
    ['Road effect', `${state.effects.road} of 32`, 'roadEffect',
      state.effects.road < 30 && state.population > 0 ?
        'below 30: roads decay' : ''],
    ['Police effect', `${formatNumber(state.effects.police)} of 1,000`,
      'policeEffect'],
    ['Fire effect', `${formatNumber(state.effects.fire)} of 1,000`,
      'fireEffect'],
  ]));
}

/**
 * @returns {void}
 */
function showState() {
  /** @type {CityState} */
  const state = stateAt(position);
  /** @type {TurnLog | null} */
  const turn = turnAt(position);
  /** @type {number} */
  const zones = state.poweredZoneCount + state.unpoweredZoneCount;
  /** @type {string} */
  const empty = state.population === 0 ? 'no people: does not change' : '';
  /**
   * Logs before version 5 have no caps.
   * @param {'residential' | 'commercial' | 'industrial'} kind
   * @returns {string}
   */
  const capped = (kind) => state.caps?.[kind] && state.rci[kind] === 0 ?
    'capped: no ' + CAP_BUILDINGS[kind] : '';

  byId('date').textContent = formatDate(state.date) +
    (position < run.log.turns.length ? ' · start of turn' : ' · end');
  byId('state').replaceChildren(...keyValues([
    ['Funds', formatMoney(state.funds), 'funds'],
    ['Population', formatNumber(state.population), 'population'],
    ['Score', formatNumber(state.score), 'score', empty],
    ['City class', state.cityClass.charAt(0) +
      state.cityClass.slice(1).toLowerCase(), 'cityClass'],
    ['Approval', state.approval + '%', 'approval', empty],
    ['Tax rate', state.taxRate + '%', 'taxRate'],
    ['Powered zones', `${state.poweredZoneCount} of ${zones}`,
      'poweredZones'],
  ]));
  showBudget(state);

  // The valves run from -2000 to 2000 for residential, 1500 for the others
  byId('rci').replaceChildren(
    ...bar('Residential', state.rci.residential, 2000, 'var(--res)', true,
      'residential', capped('residential')),
    ...bar('Commercial', state.rci.commercial, 1500, 'var(--com)', true,
      'commercial', capped('commercial')),
    ...bar('Industrial', state.rci.industrial, 1500, 'var(--ind)', true,
      'industrial', capped('industrial')));
  byId('problems').replaceChildren(...PROBLEMS.flatMap(
    /**
     * @param {[keyof CityState['problems'], string]} problem
     * @returns {HTMLElement[]}
     */
    ([key, name]) =>
      bar(name, state.problems[key], 255, 'var(--problem)', false, key)));

  /** @type {HTMLElement} */
  const windows = byId('windows');
  windows.replaceChildren();

  if (turn !== null && turn.budgetWindows.length > 0) {
    /** @type {HTMLDetailsElement} */
    const box = document.createElement('details');
    /** @type {HTMLElement} */
    const list = element('ul', '', 'windows');

    box.open = true;
    box.append(withHelp(element('summary',
      `Budget windows (${turn.budgetWindows.length})`), 'budgetWindows'),
      list);

    for (const record of turn.budgetWindows) {
      list.append(element('li', `${formatDate(record.date)}: funds ` +
        `${formatMoney(record.funds)}, taxes ${formatMoney(record.taxes)}, ` +
        `paid roads ${record.road}%, fire ${record.fire}%, ` +
        `police ${record.police}%`));
    }

    windows.append(box);
  }

  /** @type {[string, string, string][]} */
  const report = turn !== null && turn.agent !== null ?
    Object.entries(turn.agent).map(
      /**
       * @param {[string, unknown]} entry
       * @returns {[string, string, string]}
       */
      ([name, value]) => [reportLabel(name),
        formatReportValue(name, value), 'report.' + name]) :
    [['Report', 'none', 'report']];
  byId('report').replaceChildren(...keyValues(report));
}

/**
 * The name of a report field in words, waitingForMoney as "Waiting for
 * money".
 * @param {string} name
 * @returns {string}
 */
function reportLabel(name) {
  /** @type {string} */
  const words = name.replace(/[A-Z]/g, (letter) => ' ' + letter.toLowerCase());

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A field of an agent report as text: a list or a count per reason joined
 * with commas, nothing as "none", and the money fields in dollars.
 * @param {string} name
 * @param {unknown} value
 * @returns {string}
 */
function formatReportValue(name, value) {
  if (value === null || value === undefined) {
    return 'none';
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.join(', ');
  }

  if (typeof value === 'number') {
    return MONEY_FIELDS.includes(name) ? formatMoney(value) :
      formatNumber(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }

  if (typeof value === 'object') {
    /** @type {[string, unknown][]} */
    const entries = Object.entries(value);

    return entries.length === 0 ? 'none' : entries.map(
      /** @param {[string, unknown]} entry @returns {string} */
      ([key, count]) => `${key} ${count}`).join(', ');
  }

  return String(value);
}

/**
 * @param {number} index
 * @param {number} width
 * @returns {number}
 */
function trackX(index, width) {
  return TRACK_PAD + (run.count > 1 ? index / (run.count - 1) : 0) *
    (width - 2 * TRACK_PAD);
}

/**
 * @param {number} x
 * @param {number} width
 * @returns {number}
 */
function trackPosition(x, width) {
  return clamp(Math.round((x - TRACK_PAD) / (width - 2 * TRACK_PAD) *
    (run.count - 1)), 0, run.count - 1);
}

/**
 * A line with a light area under it, scaled to the largest value.
 * @param {CanvasRenderingContext2D} context
 * @param {Lane} lane
 * @param {number[]} values
 * @param {string} color
 * @param {number} width
 * @returns {number}
 */
function drawSeries(context, lane, values, color, width) {
  /** @type {number} */
  const max = Math.max(1, ...values);
  /** @type {number} */
  const bottom = lane.top + lane.height - 1;
  /** @type {(value: number) => number} */
  const valueToY = (value) => bottom - Math.max(0, value) / max *
    (lane.height - 15);

  context.beginPath();
  values.forEach(
    /** @param {number} value @param {number} index @returns {void} */
    (value, index) => index === 0 ?
      context.moveTo(trackX(index, width), valueToY(value)) :
      context.lineTo(trackX(index, width), valueToY(value)));
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();
  context.lineTo(trackX(values.length - 1, width), bottom);
  context.lineTo(trackX(0, width), bottom);
  context.closePath();
  context.globalAlpha = 0.2;
  context.fillStyle = color;
  context.fill();
  context.globalAlpha = 1;

  context.beginPath();
  context.arc(trackX(position, width), valueToY(values[position]), 3, 0,
    2 * Math.PI);
  context.fill();
  return max;
}

/**
 * The name and value on the left, and a note on the right if it fits.
 * @param {CanvasRenderingContext2D} context
 * @param {Lane} lane
 * @param {string} name
 * @param {string} value
 * @param {string} note
 * @param {number} width
 * @returns {void}
 */
function laneLabel(context, lane, name, value, note, width) {
  /** @type {number} */
  const valueX = TRACK_PAD + 2 + context.measureText(name + ' ').width;
  /** @type {number} */
  const end = valueX + context.measureText(value).width;
  /** @type {number} */
  const noteX = width - TRACK_PAD - 2 - context.measureText(note).width;

  context.fillStyle = COLORS.muted;
  context.fillText(name, TRACK_PAD + 2, lane.top + 2);
  context.fillStyle = COLORS.fg;
  context.fillText(value, valueX, lane.top + 2);

  if (note !== '' && noteX > end + 16) {
    context.fillStyle = COLORS.muted;
    context.fillText(note, noteX, lane.top + 2);
  }
}

/**
 * Three lanes under the slider: the actions of each turn (failed ones in
 * red, a mark where a budget window opened), the population and the funds.
 * Then the January of every year, and the current turn across all.
 * @returns {void}
 */
function drawTracks() {
  /** @type {number} */
  const ratio = window.devicePixelRatio || 1;
  /** @type {number} */
  const width = tracks.clientWidth;
  /** @type {number} */
  const height = tracks.clientHeight;
  /** @type {CanvasRenderingContext2D} */
  const context = tracks.getContext('2d');

  tracks.width = Math.max(1, Math.round(width * ratio));
  tracks.height = Math.max(1, Math.round(height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (run === null) {
    for (const [, , target] of LANE_HELP) {
      target.hidden = true;
    }

    return;
  }

  context.font = `11px ${FONT_MONO}`;
  context.textBaseline = 'top';

  for (const lane of Object.values(LANES)) {
    context.fillStyle = COLORS.lane;
    context.fillRect(0, lane.top, width, lane.height);
  }

  /** @type {Lane} */
  const lane = LANES.actions;
  /** @type {number} */
  const step = (width - 2 * TRACK_PAD) / Math.max(1, run.count - 1);
  /** @type {number} */
  const barWidth = clamp(step * 0.6, 1, 6);
  /** @type {number} */
  const room = lane.height - 15;
  /** @type {number} */
  const limit = Math.max(1, run.log.options.maxActionsPerTurn);
  /** @type {number} */
  const bottom = lane.top + lane.height - 1;

  run.log.turns.forEach(
    /** @param {TurnLog} turn @param {number} index @returns {void} */
    (turn, index) => {
      /** @type {number} */
      const x = trackX(index, width) - barWidth / 2;
      /** @type {number} */
      const played = room * Math.min(1, turn.actions.length / limit);
      /** @type {number} */
      const failed = room * Math.min(1, failedCount(turn) / limit);

      context.fillStyle = COLORS.bar;
      context.fillRect(x, bottom - played, barWidth, played);
      context.fillStyle = COLORS.fail;
      context.fillRect(x, bottom - failed, barWidth, failed);

      if (turn.budgetWindows.length > 0) {
        context.fillStyle = COLORS.window;
        context.fillRect(x, lane.top + 13, barWidth, 3);
      }
    });

  /** @type {TurnLog | null} */
  const turn = turnAt(position);
  laneLabel(context, lane, 'ACTIONS', turn === null ? 'end' :
    `${turn.actions.length} played, ${failedCount(turn)} failed`,
    'red: failed, blue: budget window', width);

  /** @type {number} */
  const population = drawSeries(context, LANES.population, run.population,
    COLORS.population, width);
  /** @type {number} */
  const funds = drawSeries(context, LANES.funds, run.funds, COLORS.funds,
    width);
  laneLabel(context, LANES.population, 'POPULATION',
    formatNumber(run.population[position]), 'max ' + formatNumber(population),
    width);
  laneLabel(context, LANES.funds, 'FUNDS', formatMoney(run.funds[position]),
    'max ' + formatMoney(funds), width);
  placeLaneHelp(context);

  drawYears(context, width, height);

  context.strokeStyle = COLORS.pick;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(Math.round(trackX(position, width)) + 0.5, 0);
  context.lineTo(Math.round(trackX(position, width)) + 0.5, AXIS_TOP);
  context.stroke();

  if (trackHover !== null && trackHover !== position) {
    context.strokeStyle = COLORS.muted;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(Math.round(trackX(trackHover, width)) + 0.5, 0);
    context.lineTo(Math.round(trackX(trackHover, width)) + 0.5, AXIS_TOP);
    context.stroke();
    context.setLineDash([]);
  }
}

/**
 * Puts the help targets of the three tracks over their names.
 * @param {CanvasRenderingContext2D} context
 * @returns {void}
 */
function placeLaneHelp(context) {
  for (const [name, lane, target] of LANE_HELP) {
    target.hidden = false;
    target.style.left = tracks.offsetLeft + TRACK_PAD + 'px';
    target.style.top = tracks.offsetTop + lane.top + 'px';
    target.style.width = Math.ceil(context.measureText(name).width) + 4 +
      'px';
  }
}

/**
 * A tick at every January, with the year where there is room for it.
 * @param {CanvasRenderingContext2D} context
 * @param {number} width
 * @param {number} height
 * @returns {void}
 */
function drawYears(context, width, height) {
  /** @type {number} */
  let lastLabel = -Infinity;

  context.fillStyle = COLORS.muted;
  context.strokeStyle = COLORS.muted;

  for (let index = 0; index < run.count; index++) {
    /** @type {CityDate} */
    const date = stateAt(index).date;

    if (date.month !== 0) {
      continue;
    }

    /** @type {number} */
    const x = Math.round(trackX(index, width)) + 0.5;
    context.beginPath();
    context.moveTo(x, AXIS_TOP);
    context.lineTo(x, AXIS_TOP + 3);
    context.stroke();

    /** @type {string} */
    const label = String(date.year);
    /** @type {number} */
    const labelWidth = context.measureText(label).width;
    /** @type {number} */
    const left = clamp(x - labelWidth / 2, 0, width - labelWidth);

    if (left > lastLabel + 8 && AXIS_TOP + 4 + 11 <= height) {
      context.fillText(label, left, AXIS_TOP + 4);
      lastLabel = left + labelWidth;
    }
  }
}

/**
 * @param {number} x
 * @returns {void}
 */
function showTrackTip(x) {
  /** @type {HTMLElement} */
  const tip = byId('track-tip');

  if (trackHover === null) {
    tip.hidden = true;
    return;
  }

  /** @type {number} */
  const hovered = trackHover;
  /** @type {TurnLog | null} */
  const turn = turnAt(hovered);
  /** @type {string[]} */
  const lines = [
    (turn === null ? 'End' : `Turn ${hovered}`) +
      ` · ${formatDate(stateAt(hovered).date)}`,
    turn === null ? 'no actions' : `${turn.actions.length} played, ` +
      `${failedCount(turn)} failed` +
      (turn.budgetWindows.length > 0 ? ', budget window' : ''),
    `population ${formatNumber(run.population[hovered])}`,
    `funds ${formatMoney(run.funds[hovered])}`,
  ];

  tip.textContent = lines.join('\n');
  tip.hidden = false;

  /** @type {number} */
  const room = tip.parentElement.clientWidth;
  tip.style.left = clamp(x + 12, 0, room - tip.offsetWidth) + 'px';
  tip.style.top = (tracks.offsetTop - tip.offsetHeight - 4) + 'px';
}

/**
 * @param {PointerEvent} event
 * @returns {{ x: number, width: number }}
 */
function tracksEvent(event) {
  /** @type {DOMRect} */
  const rect = tracks.getBoundingClientRect();
  return { x: event.clientX - rect.left, width: rect.width };
}

/**
 * @returns {void}
 */
function play() {
  if (run === null) {
    return;
  }

  if (position >= run.count - 1) {
    setPosition(0);
  }

  byId('play').setAttribute('aria-pressed', 'true');
  byId('play').setAttribute('aria-label', 'Pause');
  playStart = performance.now();
  frameRequest = requestAnimationFrame(step);
}

/**
 * One frame of play. Each turn takes 1000 / speed milliseconds. Inside a
 * turn the sprites follow the samples of the turn, so a tornado or a
 * train moves over the map of the turn.
 * @param {number} now
 * @returns {void}
 */
function step(now) {
  /** @type {HTMLSelectElement} */
  const speed = byId('speed');
  /** @type {number} */
  const duration = 1000 / Number(speed.value);

  if (now - playStart >= duration) {
    if (position >= run.count - 1) {
      stop();
      return;
    }

    playStart = now;
    setPosition(position + 1);
  } else if (run.log.spriteSampling && position < run.log.turns.length) {
    /** @type {SpriteRecord[]} */
    const before = currentSprites();
    sample = clamp(Math.ceil((now - playStart) / duration *
      run.log.spriteSampling.samplesPerTurn), 1,
      run.log.spriteSampling.samplesPerTurn);

    if (before.length > 0 || currentSprites().length > 0) {
      render();
      showHover();
    }
  }

  frameRequest = requestAnimationFrame(step);
}

/**
 * @returns {void}
 */
function stop() {
  cancelAnimationFrame(frameRequest);
  frameRequest = null;
  sample = null;
  byId('play').setAttribute('aria-pressed', 'false');
  byId('play').setAttribute('aria-label', 'Play');

  if (run !== null) {
    render();
    showHover();
  }
}

/**
 * @returns {void}
 */
function togglePlay() {
  if (frameRequest === null) {
    play();
  } else {
    stop();
  }
}

/**
 * @param {File} file
 * @returns {Promise<void>}
 */
async function openFile(file) {
  try {
    await start(JSON.parse(await file.text()), file.name);
  } catch (error) {
    showError(/** @type {Error} */ (error));
  }
}

/**
 * @returns {void}
 */
function resize() {
  /** @type {number} */
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));

  if (camera.fitted) {
    fit();
  } else {
    render();
  }
}

/**
 * @param {string} name
 * @returns {void}
 */
function showTab(name) {
  workspace.dataset.tab = name;
  byId('tab-actions').setAttribute('aria-selected',
    String(name === 'actions'));
  byId('tab-inspector').setAttribute('aria-selected',
    String(name === 'inspector'));
}

/**
 * @param {string} name
 * @param {HTMLElement} button
 * @returns {void}
 */
function togglePanel(name, button) {
  /** @type {boolean} */
  const on = workspace.dataset[name] !== 'on';
  workspace.dataset[name] = on ? 'on' : 'off';
  button.setAttribute('aria-pressed', String(on));
}

/**
 * Buttons give the focus back, so Space stays play and pause.
 * @param {string} id
 * @param {(button: HTMLElement) => void} action
 * @returns {void}
 */
function onButton(id, action) {
  /** @type {HTMLElement} */
  const button = byId(id);

  button.addEventListener('click', /** @returns {void} */ () => {
    button.blur();
    action(button);
  });
}

onButton('first', /** @returns {void} */ () => setPosition(0));
onButton('back', /** @returns {void} */ () => setPosition(position - 1));
onButton('play', togglePlay);
onButton('forward', /** @returns {void} */ () => setPosition(position + 1));
onButton('last', /** @returns {void} */ () =>
  setPosition(run === null ? 0 : run.count - 1));
onButton('fit', fit);
onButton('zoom-in', /** @returns {void} */ () => zoomBy(ZOOM_STEP));
onButton('zoom-out', /** @returns {void} */ () => zoomBy(1 / ZOOM_STEP));
onButton('open', /** @returns {void} */ () => fileInput.click());
onButton('message-open', /** @returns {void} */ () => fileInput.click());
onButton('tab-actions', /** @returns {void} */ () => showTab('actions'));
onButton('tab-inspector', /** @returns {void} */ () => showTab('inspector'));
onButton('toggle-actions',
  /** @param {HTMLElement} button @returns {void} */
  (button) => togglePanel('actions', button));
onButton('toggle-inspector',
  /** @param {HTMLElement} button @returns {void} */
  (button) => togglePanel('inspector', button));
onButton('after',
  /** @param {HTMLElement} button @returns {void} */ (button) => {
  showAfter = !showAfter;
  button.setAttribute('aria-pressed', String(showAfter));

  if (run !== null) {
    refreshMap();
  }
});
onButton('sprites',
  /** @param {HTMLElement} button @returns {void} */ (button) => {
  showSprites = !showSprites;
  button.setAttribute('aria-pressed', String(showSprites));
  render();
  showHover();
});
onButton('power',
  /** @param {HTMLElement} button @returns {void} */ (button) => {
  markPower = !markPower;
  button.setAttribute('aria-pressed', String(markPower));

  if (run !== null && run.history !== null) {
    paintTiles();
    render();
  }
});

slider.addEventListener('input',
  /** @returns {void} */ () => setPosition(Number(slider.value)));
fileInput.addEventListener('change', /** @returns {void} */ () => {
  if (fileInput.files.length > 0) {
    openFile(fileInput.files[0]);
  }
});

document.addEventListener('keydown',
  /** @param {KeyboardEvent} event @returns {void} */ (event) => {
  /** @type {EventTarget} */
  const target = event.target;

  if (run === null || target instanceof HTMLSelectElement) {
    return;
  }

  // The slider steps by itself, and an action row selects itself
  /** @type {boolean} */
  const onSlider = target === slider;
  /** @type {boolean} */
  const onRow = target instanceof HTMLElement &&
    target.classList.contains('row');

  if (event.key === 'ArrowLeft' && !onSlider) {
    setPosition(position - 1);
  } else if (event.key === 'ArrowRight' && !onSlider) {
    setPosition(position + 1);
  } else if (event.key === 'Home' && !onSlider) {
    setPosition(0);
  } else if (event.key === 'End' && !onSlider) {
    setPosition(run.count - 1);
  } else if (event.key === ' ' && !onRow) {
    togglePlay();
  } else if (event.key === '+' || event.key === '=') {
    zoomBy(ZOOM_STEP);
  } else if (event.key === '-') {
    zoomBy(1 / ZOOM_STEP);
  } else if (event.key === 'f' || event.key === 'F') {
    fit();
  } else {
    return;
  }

  event.preventDefault();
});

canvas.addEventListener('wheel',
  /** @param {WheelEvent} event @returns {void} */ (event) => {
  if (run === null) {
    return;
  }

  event.preventDefault();
  zoomAt(event.offsetX, event.offsetY,
    camera.zoom * Math.exp(-event.deltaY * 0.0015));
  hover = { screenX: event.offsetX, screenY: event.offsetY };
  showHover();
  render();
}, { passive: false });

canvas.addEventListener('pointerdown',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  if (run === null || event.button !== 0) {
    return;
  }

  drag = {
    startX: event.clientX,
    startY: event.clientY,
    cameraX: camera.x,
    cameraY: camera.y,
    moved: false,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  if (run === null) {
    return;
  }

  if (drag !== null) {
    /** @type {number} */
    const dx = event.clientX - drag.startX;
    /** @type {number} */
    const dy = event.clientY - drag.startY;

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true;
      canvas.classList.add('dragging');
    }

    if (drag.moved) {
      camera.x = drag.cameraX + dx;
      camera.y = drag.cameraY + dy;
      camera.fitted = false;
    }
  }

  if (event.pointerType === 'mouse' || drag !== null) {
    hover = { screenX: event.offsetX, screenY: event.offsetY };
  }

  showHover();
  render();
});

// A tap selects what is under it and shows the tile in the status bar
canvas.addEventListener('pointerup',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  if (drag !== null && !drag.moved) {
    hover = { screenX: event.offsetX, screenY: event.offsetY };
    clickAt(event.offsetX, event.offsetY);
    showHover();
  }

  drag = null;
  canvas.classList.remove('dragging');
});

canvas.addEventListener('pointerleave',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  if (event.pointerType === 'mouse') {
    hover = null;
    showHover();
    render();
  }
});

tracks.addEventListener('pointerdown',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  if (run === null || event.button !== 0) {
    return;
  }

  scrubbing = true;
  tracks.setPointerCapture(event.pointerId);
  /** @type {{ x: number, width: number }} */
  const point = tracksEvent(event);
  setPosition(trackPosition(point.x, point.width));
});

tracks.addEventListener('pointermove',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  if (run === null) {
    return;
  }

  /** @type {{ x: number, width: number }} */
  const point = tracksEvent(event);
  /** @type {number} */
  const hovered = trackPosition(point.x, point.width);

  if (scrubbing && hovered !== position) {
    setPosition(hovered);
  }

  trackHover = hovered;
  drawTracks();
  showTrackTip(point.x);
});

tracks.addEventListener('pointerup', /** @returns {void} */ () => {
  scrubbing = false;
});

tracks.addEventListener('pointerleave', /** @returns {void} */ () => {
  trackHover = null;
  scrubbing = false;

  if (run !== null) {
    drawTracks();
  }

  showTrackTip(0);
});

document.addEventListener('dragover',
  /** @param {DragEvent} event @returns {void} */ (event) => {
  event.preventDefault();
  document.body.classList.add('dropping');
});

document.addEventListener('dragleave',
  /** @param {DragEvent} event @returns {void} */ (event) => {
  if (event.relatedTarget === null) {
    document.body.classList.remove('dropping');
  }
});

document.addEventListener('drop',
  /** @param {DragEvent} event @returns {void} */ (event) => {
  event.preventDefault();
  document.body.classList.remove('dropping');

  if (event.dataTransfer.files.length > 0) {
    openFile(event.dataTransfer.files[0]);
  }
});

// A tip shows on hover, on keyboard focus and on a tap
document.addEventListener('pointerover',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  /** @type {HTMLElement | null} */
  const target = helpOwner(event.target);

  if (event.pointerType !== 'touch' && target !== null) {
    showHelp(target);
  }
});

document.addEventListener('pointerout',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  /** @type {HTMLElement | null} */
  const target = helpOwner(event.target);

  if (event.pointerType !== 'touch' && target !== null &&
      target === helpTarget && target !== document.activeElement &&
      helpOwner(event.relatedTarget) !== target) {
    hideHelp();
  }
});

document.addEventListener('pointerup',
  /** @param {PointerEvent} event @returns {void} */ (event) => {
  /** @type {HTMLElement | null} */
  const target = helpOwner(event.target);

  if (event.pointerType !== 'touch') {
    return;
  }

  if (target !== null) {
    showHelp(target);
  } else if (helpTarget !== null) {
    hideHelp();
  }
});

document.addEventListener('focusin',
  /** @param {FocusEvent} event @returns {void} */ (event) => {
  /** @type {HTMLElement | null} */
  const target = helpOwner(event.target);

  if (target !== null) {
    showHelp(target);
  }
});

// A step that rebuilds the inspector reopens the tip with reopenHelp
document.addEventListener('focusout',
  /** @param {FocusEvent} event @returns {void} */ (event) => {
  if (helpOwner(event.target) === helpTarget) {
    hideHelp();
  }
});

document.addEventListener('keydown',
  /** @param {KeyboardEvent} event @returns {void} */ (event) => {
  if (event.key === 'Escape') {
    hideHelp();
  }
});

// The panels scroll, so the tip follows its target
document.addEventListener('scroll', /** @returns {void} */ () => {
  if (helpTarget !== null) {
    placeHelp();
  }
}, true);

new ResizeObserver(resize).observe(canvas);
new ResizeObserver(drawTracks).observe(tracks);
showHover();

/** @type {URLSearchParams} */
const params = new URLSearchParams(window.location.search);
/** @type {string | null} */
const logUrl = params.get('log');

if (logUrl !== null) {
  showMessage('Loading ' + (params.get('name') ?? logUrl));
  fetch(logUrl)
    .then(
      /** @param {Response} response @returns {Promise<RunLog>} */
      (response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${logUrl} (${response.status})`);
        }

        return response.json();
      })
    .then(
      /** @param {RunLog} log @returns {Promise<void>} */
      (log) => start(log, params.get('name') ?? logUrl))
    .catch(showError);
} else {
  showMessage('Drop a run log here, or open one.', { canOpen: true });
}
