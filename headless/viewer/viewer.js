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

const LEVELS = ['Easy', 'Medium', 'Hard'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
  'Sep', 'Oct', 'Nov', 'Dec'];
const PROBLEMS = [
  ['crime', 'Crime'],
  ['pollution', 'Pollution'],
  ['housing', 'Housing'],
  ['taxes', 'Taxes'],
  ['traffic', 'Traffic'],
  ['unemployment', 'Unemployment'],
  ['fire', 'Fire'],
];
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.5;

/* The tracks under the slider use the same x axis: they start and end at
 * the centre of the thumb, which is --thumb wide in style.css. */
const THUMB = 14;
const TRACK_PAD = THUMB / 2;
const LANES = {
  actions: { top: 0, height: 28 },
  population: { top: 32, height: 34 },
  funds: { top: 70, height: 34 },
};
const AXIS_TOP = 106;

const $ = (id) => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');
const slider = $('slider');
const tracks = $('tracks');
const workspace = $('workspace');
const narrow = window.matchMedia('(max-width: 1199px)');
const coarse = window.matchMedia('(pointer: coarse)');

const styles = getComputedStyle(document.documentElement);
const token = (name) => styles.getPropertyValue(name).trim();
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
const FONT_UI = token('--font-ui');
const FONT_MONO = token('--font-mono');

const sheet = new Image();
const sheetLoaded = new Promise((resolve, reject) => {
  sheet.onload = resolve;
  sheet.onerror = () => reject(new Error('Could not load tiles.png.'));
});
sheet.src = 'tiles.png';

// The game's sprite sheet. Without it the map still works, with no sprites
const spriteSheet = new Image();
let spritesReady = false;
spriteSheet.onload = () => {
  spritesReady = true;
  render();
};
spriteSheet.src = 'sprites.png';

/* A map pixel p is drawn at p * zoom + x on screen, in CSS pixels. While
 * fitted, the map is fitted again when the window changes size. */
const camera = { zoom: 1, x: 0, y: 0, fitted: true };

let run = null;
let position = 0;
let selected = -1;
let hover = null;
let drag = null;
let scrubbing = false;
let trackHover = null;
let frameRequest = null;
let playStart = 0;
let sample = null;
let showAfter = false;
let markPower = true;
let showSprites = true;

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;

  if (className) {
    node.className = className;
  }

  return node;
}

// A small stroke icon, a check for success and a cross for failure
function statusIcon(ok) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon status');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', ok ? 'M20 6 9 17l-5-5' : 'M18 6 6 18M6 6l12 12');
  svg.append(path);
  return svg;
}

function formatDate(date) {
  return `${MONTHS[date.month]} ${date.year}`;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatMoney(value) {
  return '$' + formatNumber(value);
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// The message over the map: empty state, loading, errors and logs with no map
function showMessage(text, { isError = false, canOpen = false } = {}) {
  $('message').hidden = text === '';
  $('message').classList.toggle('error', isError);
  $('message-text').textContent = text;
  $('message-open').hidden = !canOpen;
}

function showError(error) {
  showMessage(error.message, { isError: true, canOpen: true });
}

function stateAt(p) {
  return p < run.log.turns.length ?
    run.log.turns[p].state : run.log.final.state;
}

function turnAt(p) {
  return p < run.log.turns.length ? run.log.turns[p] : null;
}

function failedCount(turn) {
  return turn.actions.filter((applied) => !applied.result.success).length;
}

function mapPosition() {
  return showAfter ? Math.min(position + 1, run.count - 1) : position;
}

async function start(log, name) {
  if (typeof log !== 'object' || log === null || !Array.isArray(log.turns) ||
      typeof log.final !== 'object') {
    throw new Error('This file is not a run log from runGame.');
  }

  stop();
  await sheetLoaded;

  const history = log.map ? createMapHistory(log) : null;
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
  };

  for (let p = 0; p < run.count; p++) {
    run.population.push(stateAt(p).population);
    run.funds.push(stateAt(p).funds);
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

function showSettings() {
  const options = run.log.options;
  const agent = run.log.agent;
  const agentSeed = agent.settings && agent.settings.seed !== undefined ?
    agent.settings.seed : 'none';
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

  $('file-name').textContent = run.name;
  $('file-name').title = run.name;
  $('run').replaceChildren(...settings.map(([name, value]) => {
    const item = element('li', name + ' ');
    item.append(element('span', String(value), 'value'));
    return item;
  }));
  document.title = `Replay: ${agent.name}, seed ${options.seed}`;
}

function setPosition(p) {
  if (run === null) {
    return;
  }

  position = clamp(Math.round(p), 0, run.count - 1);
  selected = -1;
  sample = null;
  slider.value = String(position);

  // An error from a file that did not load stays until the next step
  if (run.history !== null) {
    showMessage('');
  }

  showActions();
  showState();
  refreshMap();
  drawTracks();
}

function showPosition() {
  const date = formatDate(stateAt(position).date);
  const ended = position >= run.log.turns.length;
  const shown = mapPosition();
  const mapNote = shown === position ? '' :
    ` · map of ${formatDate(stateAt(shown).date)}`;

  $('position').textContent = (ended ? 'End' :
    `Turn ${position} of ${run.log.turns.length}`) + ` · ${date}`;
  $('viewport-turn').textContent = (ended ? 'End' : `Turn ${position}`) +
    ` · ${date}${mapNote}`;
}

function refreshMap() {
  if (run.history) {
    run.history.tilesAt(mapPosition(), run.tiles);
    paintTiles();
  }

  showPosition();
  render();
  showHover();
}

// Draws the tiles that changed since the last call onto the map image
function paintTiles() {
  const image = run.image.getContext('2d');
  const width = run.history.width;

  for (let i = 0; i < run.tiles.length; i++) {
    const value = run.tiles[i];
    const tile = markPower && isUnpoweredZone(value) ?
      TILES.LIGHTNINGBOLT : tileIndex(value);

    if (run.painted[i] === tile) {
      continue;
    }

    run.painted[i] = tile;
    image.drawImage(sheet,
      (tile % TILES_PER_ROW) * TILE_SIZE,
      Math.floor(tile / TILES_PER_ROW) * TILE_SIZE, TILE_SIZE, TILE_SIZE,
      (i % width) * TILE_SIZE, Math.floor(i / width) * TILE_SIZE,
      TILE_SIZE, TILE_SIZE);
  }
}

// The actions of this turn that have a place on the map, selected last
function currentShapes() {
  const turn = turnAt(position);

  if (turn === null) {
    return [];
  }

  return turn.actions
    .map((applied, index) => ({
      index: index,
      applied: applied,
      shape: actionShape(applied),
    }))
    .filter((item) => item.shape !== null)
    .sort((a, b) => Number(a.index === selected) - Number(b.index === selected));
}

function render() {
  const ratio = window.devicePixelRatio || 1;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (run === null || run.image === null) {
    $('zoom').textContent = '';
    return;
  }

  ctx.setTransform(ratio * camera.zoom, 0, 0, ratio * camera.zoom,
    ratio * camera.x, ratio * camera.y);
  ctx.imageSmoothingEnabled = camera.zoom < 1;
  ctx.drawImage(run.image, 0, 0);
  drawSprites(currentSprites());

  const shapes = currentShapes();
  shapes.forEach(drawShape);
  drawHoverTile();

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  shapes.forEach(drawLabel);
  $('zoom').textContent = Math.round(camera.zoom * 100) + '%';
}

/* At rest the sprites of the start of the turn, or of its end with After
 * turn. While playing, the sample of the turn that the time has reached. */
function currentSprites() {
  if (!showSprites || run === null) {
    return [];
  }

  return sample === null ? spritesAt(run.log, mapPosition()) :
    spritesAt(run.log, position, sample);
}

function drawSprites(sprites) {
  if (!spritesReady) {
    return;
  }

  for (const [type, frame, left, top] of sprites) {
    const size = spriteSize(type);
    ctx.drawImage(spriteSheet, (frame - 1) * SPRITE_CELL,
      (type - 1) * SPRITE_CELL, size, size, left, top, size, size);
  }
}

function trace(points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
}

/* Successful actions are solid green, failed ones dashed red with their
 * reason, and the selected one amber. The others fade while one is
 * selected. */
function drawShape(item) {
  const ok = item.applied.result.success;
  const picked = item.index === selected;
  const color = picked ? COLORS.pick : ok ? COLORS.ok : COLORS.fail;
  const unit = 1 / camera.zoom;
  const shape = item.shape;

  ctx.save();
  ctx.globalAlpha = selected >= 0 && !picked ? 0.35 : 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = (picked ? 3 : 2) * unit;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(ok ? [] : [6 * unit, 4 * unit]);

  if (shape.kind === 'area') {
    const x = shape.x * TILE_SIZE;
    const y = shape.y * TILE_SIZE;
    const width = shape.width * TILE_SIZE;
    const height = shape.height * TILE_SIZE;
    const inset = ctx.lineWidth / 2;

    ctx.save();
    ctx.globalAlpha *= 0.2;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    ctx.strokeRect(x + inset, y + inset, width - 2 * inset,
      height - 2 * inset);

    if (item.applied.action.type === 'bulldoze') {
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + width - 3, y + height - 3);
      ctx.moveTo(x + width - 3, y + 3);
      ctx.lineTo(x + 3, y + height - 3);
      ctx.stroke();
    }
  } else {
    const points = shape.tiles.map(([x, y]) =>
      [(x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE]);

    if (shape.planned) {
      ctx.save();
      ctx.globalAlpha *= 0.3;
      ctx.lineWidth = TILE_SIZE * 0.7;
      ctx.setLineDash([]);
      trace(points);
      ctx.stroke();
      ctx.restore();
    }

    trace(points);
    ctx.stroke();

    for (const [x, y] of [points[0], points[points.length - 1]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * unit, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  ctx.restore();
}

// The number of the action, and the reason when it failed, in screen space
function drawLabel(item) {
  const shape = item.shape;
  const tile = shape.kind === 'area' ? [shape.x, shape.y] :
    [shape.tiles[0][0] + 0.5, shape.tiles[0][1] + 0.5];
  const x = tile[0] * TILE_SIZE * camera.zoom + camera.x;
  const y = tile[1] * TILE_SIZE * camera.zoom + camera.y;
  const result = item.applied.result;
  const text = String(item.index + 1) +
    (result.success ? '' : ' ' + describeResult(result));
  const picked = item.index === selected;

  ctx.save();
  ctx.globalAlpha = selected >= 0 && !picked ? 0.35 : 1;
  ctx.font = `600 11px ${FONT_UI}`;

  const width = ctx.measureText(text).width + 8;

  ctx.fillStyle = picked ? COLORS.pick : result.success ? COLORS.ok :
    COLORS.fail;
  ctx.fillRect(x, y - 15, width, 15);
  ctx.fillStyle = COLORS.bg;
  ctx.fillText(text, x + 4, y - 4);
  ctx.restore();
}

function drawHoverTile() {
  const tile = hoverTile();

  if (tile === null) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = COLORS.fg;
  ctx.lineWidth = 1 / camera.zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE,
    TILE_SIZE);
  ctx.restore();
}

function screenToTile(sx, sy) {
  if (run === null || run.history === null) {
    return null;
  }

  const x = Math.floor((sx - camera.x) / camera.zoom / TILE_SIZE);
  const y = Math.floor((sy - camera.y) / camera.zoom / TILE_SIZE);

  if (x < 0 || y < 0 || x >= run.history.width || y >= run.history.height) {
    return null;
  }

  return { x: x, y: y };
}

// The tile under the pointer, also after the map moved under it
function hoverTile() {
  return hover === null ? null : screenToTile(hover.sx, hover.sy);
}

// The status bar says what the tile under the pointer, or the tapped one, is
function showHover() {
  const tile = hoverTile();

  if (tile === null || run === null || run.tiles === null) {
    $('hover').textContent = run === null ? 'No log loaded' :
      coarse.matches ? 'Tap a tile to see what it is' :
      'Point at a tile to see what it is';
    return;
  }

  const value = run.tiles[tile.y * run.history.width + tile.x];
  const sprite = spriteAt(currentSprites(),
    (hover.sx - camera.x) / camera.zoom, (hover.sy - camera.y) / camera.zoom);
  $('hover').textContent = (sprite === null ? '' :
    spriteName(sprite[0]) + ' over ') +
    `${tile.x}, ${tile.y} · ${describeTile(value)} · tile ${tileIndex(value)}`;
}

function fit() {
  if (run === null || run.history === null) {
    return;
  }

  const width = run.history.width * TILE_SIZE;
  const height = run.history.height * TILE_SIZE;

  camera.zoom = clamp(Math.min(canvas.clientWidth / width,
    canvas.clientHeight / height), MIN_ZOOM, MAX_ZOOM);
  camera.x = (canvas.clientWidth - width * camera.zoom) / 2;
  camera.y = (canvas.clientHeight - height * camera.zoom) / 2;
  camera.fitted = true;
  render();
}

function zoomAt(sx, sy, zoom) {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const mapX = (sx - camera.x) / camera.zoom;
  const mapY = (sy - camera.y) / camera.zoom;

  camera.zoom = next;
  camera.x = sx - mapX * next;
  camera.y = sy - mapY * next;
  camera.fitted = false;
  render();
}

function zoomBy(factor) {
  if (run !== null) {
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2,
      camera.zoom * factor);
    showHover();
  }
}

// Centres the map on a shape that is not fully in view
function reveal(shape) {
  const tiles = shape.kind === 'area' ?
    [[shape.x, shape.y], [shape.x + shape.width, shape.y + shape.height]] :
    shape.tiles.map(([x, y]) => [x, y]).concat(
      shape.tiles.map(([x, y]) => [x + 1, y + 1]));
  const xs = tiles.map((tile) => tile[0] * TILE_SIZE * camera.zoom + camera.x);
  const ys = tiles.map((tile) => tile[1] * TILE_SIZE * camera.zoom + camera.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  if (left >= 0 && top >= 0 && right <= canvas.clientWidth &&
      bottom <= canvas.clientHeight) {
    return;
  }

  camera.x += canvas.clientWidth / 2 - (left + right) / 2;
  camera.y += canvas.clientHeight / 2 - (top + bottom) / 2;
  camera.fitted = false;
}

function select(index) {
  selected = selected === index ? -1 : index;

  for (const item of $('actions').children) {
    const picked = Number(item.dataset.index) === selected;
    item.querySelector('.row').setAttribute('aria-pressed', String(picked));

    if (picked) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }

  const turn = turnAt(position);

  if (selected >= 0 && turn !== null) {
    const shape = actionShape(turn.actions[selected]);

    if (shape !== null) {
      reveal(shape);
    }
  }

  render();
  showHover();
}

function clickAt(sx, sy) {
  const tile = screenToTile(sx, sy);
  const hit = tile === null ? undefined : currentShapes().reverse().find(
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

function showActions() {
  const list = $('actions');
  const turn = turnAt(position);

  list.replaceChildren();

  if (turn === null) {
    $('actions-summary').textContent = 'end';
    $('actions-note').textContent = 'The game is over.';
    return;
  }

  const failed = failedCount(turn);
  $('actions-summary').textContent = `turn ${position} · ` +
    `${turn.actions.length} played` + (failed > 0 ? `, ${failed} failed` : '');

  turn.actions.forEach((applied, index) => {
    const ok = applied.result.success;
    const item = document.createElement('li');
    const row = document.createElement('button');

    item.dataset.index = String(index);
    item.className = ok ? 'ok' : 'failed';
    row.type = 'button';
    row.className = 'row';
    row.setAttribute('aria-pressed', 'false');
    row.append(
      element('span', String(index + 1), 'n'),
      statusIcon(ok),
      element('span', describeAction(applied.action), 'what'),
      element('span', (ok ? '' : 'failed: ') + describeResult(applied.result),
        'result'));
    row.addEventListener('click', () => select(index));
    item.append(row);
    list.append(item);
  });

  const notes = [];

  if (turn.actions.length === 0) {
    notes.push('No actions this turn.');
  }

  if (turn.dropped > 0) {
    notes.push(`${turn.dropped} more were dropped past the limit.`);
  }

  $('actions-note').textContent = notes.join(' ');
}

// A bar from the left, or from the middle for values that can be negative
function bar(name, value, max, color, centred) {
  const track = element('div', '', 'bar' + (centred ? ' centred' : ''));
  const fill = element('div', '', 'fill');
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
  return [element('span', name), track,
    element('span', formatNumber(value), 'value')];
}

function keyValues(rows) {
  return rows.flatMap(([name, value]) =>
    [element('dt', name), element('dd', value)]);
}

function showState() {
  const state = stateAt(position);
  const turn = turnAt(position);
  const zones = state.poweredZoneCount + state.unpoweredZoneCount;

  $('date').textContent = formatDate(state.date) +
    (position < run.log.turns.length ? ' · start of turn' : ' · end');
  $('state').replaceChildren(...keyValues([
    ['Funds', formatMoney(state.funds)],
    ['Population', formatNumber(state.population)],
    ['Score', formatNumber(state.score)],
    ['City class', state.cityClass.charAt(0) +
      state.cityClass.slice(1).toLowerCase()],
    ['Approval', state.approval + '%'],
    ['Tax rate', state.taxRate + '%'],
    ['Powered zones', `${state.poweredZoneCount} of ${zones}`],
  ]));

  // The valves run from -2000 to 2000 for residential, 1500 for the others
  $('rci').replaceChildren(
    ...bar('Residential', state.rci.residential, 2000, 'var(--res)', true),
    ...bar('Commercial', state.rci.commercial, 1500, 'var(--com)', true),
    ...bar('Industrial', state.rci.industrial, 1500, 'var(--ind)', true));
  $('problems').replaceChildren(...PROBLEMS.flatMap(([key, name]) =>
    bar(name, state.problems[key], 255, 'var(--problem)', false)));

  const windows = $('windows');
  windows.replaceChildren();

  if (turn !== null && turn.budgetWindows.length > 0) {
    const box = document.createElement('details');
    const list = element('ul', '', 'windows');

    box.open = true;
    box.append(element('summary',
      `Budget windows (${turn.budgetWindows.length})`), list);

    for (const record of turn.budgetWindows) {
      list.append(element('li', `${formatDate(record.date)}: funds ` +
        `${formatMoney(record.funds)}, taxes ${formatMoney(record.taxes)}, ` +
        `paid roads ${record.road}%, fire ${record.fire}%, ` +
        `police ${record.police}%`));
    }

    windows.append(box);
  }

  const report = turn !== null && turn.agent !== null ?
    Object.entries(turn.agent).map(([name, value]) => [name,
      typeof value === 'object' ? JSON.stringify(value) : String(value)]) :
    [['report', 'none']];
  $('report').replaceChildren(...keyValues(report));
}

function trackX(p, width) {
  return TRACK_PAD + (run.count > 1 ? p / (run.count - 1) : 0) *
    (width - 2 * TRACK_PAD);
}

function trackPosition(x, width) {
  return clamp(Math.round((x - TRACK_PAD) / (width - 2 * TRACK_PAD) *
    (run.count - 1)), 0, run.count - 1);
}

// A line with a light area under it, scaled to the largest value
function drawSeries(context, lane, values, color, width) {
  const max = Math.max(1, ...values);
  const bottom = lane.top + lane.height - 1;
  const y = (value) => bottom - Math.max(0, value) / max *
    (lane.height - 15);

  context.beginPath();
  values.forEach((value, i) => i === 0 ?
    context.moveTo(trackX(i, width), y(value)) :
    context.lineTo(trackX(i, width), y(value)));
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
  context.arc(trackX(position, width), y(values[position]), 3, 0,
    2 * Math.PI);
  context.fill();
  return max;
}

// The name and value on the left, and a note on the right if it fits
function laneLabel(context, lane, name, value, note, width) {
  const valueX = TRACK_PAD + 2 + context.measureText(name + ' ').width;
  const end = valueX + context.measureText(value).width;
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

/* Three lanes under the slider: the actions of each turn (failed ones in
 * red, a mark where a budget window opened), the population and the funds.
 * Then the January of every year, and the current turn across all. */
function drawTracks() {
  const ratio = window.devicePixelRatio || 1;
  const width = tracks.clientWidth;
  const height = tracks.clientHeight;
  const context = tracks.getContext('2d');

  tracks.width = Math.max(1, Math.round(width * ratio));
  tracks.height = Math.max(1, Math.round(height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (run === null) {
    return;
  }

  context.font = `11px ${FONT_MONO}`;
  context.textBaseline = 'top';

  for (const lane of Object.values(LANES)) {
    context.fillStyle = COLORS.lane;
    context.fillRect(0, lane.top, width, lane.height);
  }

  const lane = LANES.actions;
  const step = (width - 2 * TRACK_PAD) / Math.max(1, run.count - 1);
  const barWidth = clamp(step * 0.6, 1, 6);
  const room = lane.height - 15;
  const limit = Math.max(1, run.log.options.maxActionsPerTurn);
  const bottom = lane.top + lane.height - 1;

  run.log.turns.forEach((turn, p) => {
    const x = trackX(p, width) - barWidth / 2;
    const played = room * Math.min(1, turn.actions.length / limit);
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

  const turn = turnAt(position);
  laneLabel(context, lane, 'ACTIONS', turn === null ? 'end' :
    `${turn.actions.length} played, ${failedCount(turn)} failed`,
    'red: failed, blue: budget window', width);

  const population = drawSeries(context, LANES.population, run.population,
    COLORS.population, width);
  const funds = drawSeries(context, LANES.funds, run.funds, COLORS.funds,
    width);
  laneLabel(context, LANES.population, 'POPULATION',
    formatNumber(run.population[position]), 'max ' + formatNumber(population),
    width);
  laneLabel(context, LANES.funds, 'FUNDS', formatMoney(run.funds[position]),
    'max ' + formatMoney(funds), width);

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

// A tick at every January, with the year where there is room for it
function drawYears(context, width, height) {
  let lastLabel = -Infinity;

  context.fillStyle = COLORS.muted;
  context.strokeStyle = COLORS.muted;

  for (let p = 0; p < run.count; p++) {
    const date = stateAt(p).date;

    if (date.month !== 0) {
      continue;
    }

    const x = Math.round(trackX(p, width)) + 0.5;
    context.beginPath();
    context.moveTo(x, AXIS_TOP);
    context.lineTo(x, AXIS_TOP + 3);
    context.stroke();

    const label = String(date.year);
    const labelWidth = context.measureText(label).width;
    const left = clamp(x - labelWidth / 2, 0, width - labelWidth);

    if (left > lastLabel + 8 && AXIS_TOP + 4 + 11 <= height) {
      context.fillText(label, left, AXIS_TOP + 4);
      lastLabel = left + labelWidth;
    }
  }
}

function showTrackTip(x) {
  const tip = $('track-tip');

  if (trackHover === null) {
    tip.hidden = true;
    return;
  }

  const p = trackHover;
  const turn = turnAt(p);
  const lines = [
    (turn === null ? 'End' : `Turn ${p}`) + ` · ${formatDate(stateAt(p).date)}`,
    turn === null ? 'no actions' : `${turn.actions.length} played, ` +
      `${failedCount(turn)} failed` +
      (turn.budgetWindows.length > 0 ? ', budget window' : ''),
    `population ${formatNumber(run.population[p])}`,
    `funds ${formatMoney(run.funds[p])}`,
  ];

  tip.textContent = lines.join('\n');
  tip.hidden = false;

  const room = tip.parentElement.clientWidth;
  tip.style.left = clamp(x + 12, 0, room - tip.offsetWidth) + 'px';
  tip.style.top = (tracks.offsetTop - tip.offsetHeight - 4) + 'px';
}

function tracksEvent(event) {
  const rect = tracks.getBoundingClientRect();
  return { x: event.clientX - rect.left, width: rect.width };
}

function play() {
  if (run === null) {
    return;
  }

  if (position >= run.count - 1) {
    setPosition(0);
  }

  $('play').setAttribute('aria-pressed', 'true');
  $('play').setAttribute('aria-label', 'Pause');
  playStart = performance.now();
  frameRequest = requestAnimationFrame(step);
}

/* One frame of play. Each turn takes 1000 / speed milliseconds. Inside a
 * turn the sprites follow the samples of the turn, so a tornado or a
 * train moves over the map of the turn. */
function step(now) {
  const duration = 1000 / Number($('speed').value);

  if (now - playStart >= duration) {
    if (position >= run.count - 1) {
      stop();
      return;
    }

    playStart = now;
    setPosition(position + 1);
  } else if (run.log.spriteSampling && position < run.log.turns.length) {
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

function stop() {
  cancelAnimationFrame(frameRequest);
  frameRequest = null;
  sample = null;
  $('play').setAttribute('aria-pressed', 'false');
  $('play').setAttribute('aria-label', 'Play');

  if (run !== null) {
    render();
    showHover();
  }
}

function togglePlay() {
  if (frameRequest === null) {
    play();
  } else {
    stop();
  }
}

async function openFile(file) {
  try {
    await start(JSON.parse(await file.text()), file.name);
  } catch (error) {
    showError(error);
  }
}

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));

  if (camera.fitted) {
    fit();
  } else {
    render();
  }
}

function showTab(name) {
  workspace.dataset.tab = name;
  $('tab-actions').setAttribute('aria-selected', String(name === 'actions'));
  $('tab-inspector').setAttribute('aria-selected',
    String(name === 'inspector'));
}

function togglePanel(name, button) {
  const on = workspace.dataset[name] !== 'on';
  workspace.dataset[name] = on ? 'on' : 'off';
  button.setAttribute('aria-pressed', String(on));
}

// Buttons give the focus back, so Space stays play and pause
function onButton(id, action) {
  $(id).addEventListener('click', (event) => {
    event.currentTarget.blur();
    action(event.currentTarget);
  });
}

onButton('first', () => setPosition(0));
onButton('back', () => setPosition(position - 1));
onButton('play', togglePlay);
onButton('forward', () => setPosition(position + 1));
onButton('last', () => setPosition(run === null ? 0 : run.count - 1));
onButton('fit', fit);
onButton('zoom-in', () => zoomBy(ZOOM_STEP));
onButton('zoom-out', () => zoomBy(1 / ZOOM_STEP));
onButton('open', () => $('file').click());
onButton('message-open', () => $('file').click());
onButton('tab-actions', () => showTab('actions'));
onButton('tab-inspector', () => showTab('inspector'));
onButton('toggle-actions', (button) => togglePanel('actions', button));
onButton('toggle-inspector', (button) => togglePanel('inspector', button));
onButton('after', (button) => {
  showAfter = !showAfter;
  button.setAttribute('aria-pressed', String(showAfter));

  if (run !== null) {
    refreshMap();
  }
});
onButton('sprites', (button) => {
  showSprites = !showSprites;
  button.setAttribute('aria-pressed', String(showSprites));
  render();
  showHover();
});
onButton('power', (button) => {
  markPower = !markPower;
  button.setAttribute('aria-pressed', String(markPower));

  if (run !== null && run.history !== null) {
    paintTiles();
    render();
  }
});

slider.addEventListener('input', () => setPosition(Number(slider.value)));
$('file').addEventListener('change', (event) => {
  if (event.currentTarget.files.length > 0) {
    openFile(event.currentTarget.files[0]);
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;

  if (run === null || target instanceof HTMLSelectElement) {
    return;
  }

  // The slider steps by itself, and an action row selects itself
  const onSlider = target === slider;
  const onRow = target instanceof HTMLElement && target.classList.contains('row');

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

canvas.addEventListener('wheel', (event) => {
  if (run === null) {
    return;
  }

  event.preventDefault();
  zoomAt(event.offsetX, event.offsetY,
    camera.zoom * Math.exp(-event.deltaY * 0.0015));
  hover = { sx: event.offsetX, sy: event.offsetY };
  showHover();
  render();
}, { passive: false });

canvas.addEventListener('pointerdown', (event) => {
  if (run === null || event.button !== 0) {
    return;
  }

  drag = {
    sx: event.clientX,
    sy: event.clientY,
    x: camera.x,
    y: camera.y,
    moved: false,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (run === null) {
    return;
  }

  if (drag !== null) {
    const dx = event.clientX - drag.sx;
    const dy = event.clientY - drag.sy;

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true;
      canvas.classList.add('dragging');
    }

    if (drag.moved) {
      camera.x = drag.x + dx;
      camera.y = drag.y + dy;
      camera.fitted = false;
    }
  }

  if (event.pointerType === 'mouse' || drag !== null) {
    hover = { sx: event.offsetX, sy: event.offsetY };
  }

  showHover();
  render();
});

// A tap selects what is under it and shows the tile in the status bar
canvas.addEventListener('pointerup', (event) => {
  if (drag !== null && !drag.moved) {
    hover = { sx: event.offsetX, sy: event.offsetY };
    clickAt(event.offsetX, event.offsetY);
    showHover();
  }

  drag = null;
  canvas.classList.remove('dragging');
});

canvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'mouse') {
    hover = null;
    showHover();
    render();
  }
});

tracks.addEventListener('pointerdown', (event) => {
  if (run === null || event.button !== 0) {
    return;
  }

  scrubbing = true;
  tracks.setPointerCapture(event.pointerId);
  const point = tracksEvent(event);
  setPosition(trackPosition(point.x, point.width));
});

tracks.addEventListener('pointermove', (event) => {
  if (run === null) {
    return;
  }

  const point = tracksEvent(event);
  const p = trackPosition(point.x, point.width);

  if (scrubbing && p !== position) {
    setPosition(p);
  }

  trackHover = p;
  drawTracks();
  showTrackTip(point.x);
});

tracks.addEventListener('pointerup', () => {
  scrubbing = false;
});

tracks.addEventListener('pointerleave', () => {
  trackHover = null;
  scrubbing = false;

  if (run !== null) {
    drawTracks();
  }

  showTrackTip(0);
});

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  document.body.classList.add('dropping');
});

document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) {
    document.body.classList.remove('dropping');
  }
});

document.addEventListener('drop', (event) => {
  event.preventDefault();
  document.body.classList.remove('dropping');

  if (event.dataTransfer.files.length > 0) {
    openFile(event.dataTransfer.files[0]);
  }
});

new ResizeObserver(resize).observe(canvas);
new ResizeObserver(drawTracks).observe(tracks);
showHover();

const params = new URLSearchParams(window.location.search);
const logUrl = params.get('log');

if (logUrl !== null) {
  showMessage('Loading ' + (params.get('name') ?? logUrl));
  fetch(logUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${logUrl} (${response.status})`);
      }

      return response.json();
    })
    .then((log) => start(log, params.get('name') ?? logUrl))
    .catch(showError);
} else {
  showMessage('Drop a run log here, or open one.', { canOpen: true });
}
