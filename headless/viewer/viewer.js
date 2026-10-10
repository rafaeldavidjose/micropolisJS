import {
  actionShape,
  createMapHistory,
  describeAction,
  describeResult,
  positionCount,
  shapeContains,
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
const COLORS = { ok: '#3fd46b', fail: '#ff5a5f', pick: '#ffd23f' };
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const CHART_PAD = 4;

const $ = (id) => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');
const slider = $('slider');

const sheet = new Image();
const sheetLoaded = new Promise((resolve, reject) => {
  sheet.onload = resolve;
  sheet.onerror = () => reject(new Error('Could not load tiles.png.'));
});
sheet.src = 'tiles.png';

/* A map pixel p is drawn at p * zoom + x on screen, in CSS pixels. While
 * fitted, the map is fitted again when the window changes size. */
const camera = { zoom: 1, x: 0, y: 0, fitted: true };

let run = null;
let position = 0;
let selected = -1;
let hover = null;
let drag = null;
let timer = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;

  if (className) {
    node.className = className;
  }

  return node;
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

function showMessage(text, isError = false) {
  $('message').textContent = text;
  $('message').hidden = text === '';
  $('message').classList.toggle('error', isError);
}

function showError(error) {
  showMessage(error.message, true);
}

function stateAt(p) {
  return p < run.log.turns.length ?
    run.log.turns[p].state : run.log.final.state;
}

function turnAt(p) {
  return p < run.log.turns.length ? run.log.turns[p] : null;
}

function mapPosition() {
  return $('after').checked ? Math.min(position + 1, run.count - 1) :
    position;
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

  $('settings').textContent = [
    run.name,
    `agent ${agent.name}`,
    `seed ${options.seed}`,
    `agent seed ${agentSeed}`,
    LEVELS[options.level] ?? `level ${options.level}`,
    `disasters ${options.disasters ? 'on' : 'off'}`,
    `${options.monthsPerTurn} months per turn`,
    `${run.log.turns.length} turns`,
    `up to ${options.maxActionsPerTurn} actions per turn`,
  ].join(' · ');
  document.title = `Replay: ${agent.name}, seed ${options.seed}`;
}

function setPosition(p) {
  if (run === null) {
    return;
  }

  position = clamp(Math.round(p), 0, run.count - 1);
  selected = -1;
  slider.value = String(position);

  // An error from a file that did not load stays until the next step
  if (run.history !== null) {
    showMessage('');
  }

  showActions();
  showState();
  drawCharts();
  refreshMap();
}

function showPosition() {
  const label = (position < run.log.turns.length ? `Turn ${position}` :
    'End') + ` · ${formatDate(stateAt(position).date)}`;
  const shown = mapPosition();

  $('position').textContent = shown === position ? label :
    label + `, map of ${formatDate(stateAt(shown).date)}`;
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
  const markPower = $('power').checked;

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
    return;
  }

  ctx.setTransform(ratio * camera.zoom, 0, 0, ratio * camera.zoom,
    ratio * camera.x, ratio * camera.y);
  ctx.imageSmoothingEnabled = camera.zoom < 1;
  ctx.drawImage(run.image, 0, 0);

  const shapes = currentShapes();
  shapes.forEach(drawShape);
  drawHoverTile();

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  shapes.forEach(drawLabel);
}

function trace(points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
}

/* Successful actions are solid green, failed ones dashed red, and the
 * selected one yellow. The others fade while one is selected. */
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
  ctx.font = '600 11px system-ui, sans-serif';

  const width = ctx.measureText(text).width + 8;

  ctx.fillStyle = picked ? COLORS.pick : result.success ? COLORS.ok :
    COLORS.fail;
  ctx.fillRect(x, y - 15, width, 15);
  ctx.fillStyle = '#111';
  ctx.fillText(text, x + 4, y - 4);
  ctx.restore();
}

function drawHoverTile() {
  const tile = hoverTile();

  if (tile === null) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = '#ffffff';
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

function showHover() {
  const box = $('hover');
  const tile = hoverTile();

  if (tile === null || run.tiles === null) {
    box.hidden = true;
    return;
  }

  const value = run.tiles[tile.y * run.history.width + tile.x];
  box.textContent = `${tile.x}, ${tile.y}: ` +
    `${describeTile(value)} (tile ${tileIndex(value)})`;
  box.hidden = false;

  const area = $('map-area');
  const left = hover.sx + 14 + box.offsetWidth > area.clientWidth ?
    hover.sx - 14 - box.offsetWidth : hover.sx + 14;
  box.style.left = Math.max(0, left) + 'px';
  box.style.top = Math.max(0, hover.sy - 30) + 'px';
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
    item.classList.toggle('selected', picked);

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
    select(hit.index);
  } else if (selected >= 0) {
    select(selected);
  }
}

function showActions() {
  const list = $('actions');
  const turn = turnAt(position);

  list.replaceChildren();
  $('turn-title').textContent = turn === null ? 'End of the game' :
    `Actions of turn ${position}`;

  if (turn === null) {
    $('actions-note').textContent = 'The game is over.';
    return;
  }

  turn.actions.forEach((applied, index) => {
    const item = document.createElement('li');
    item.dataset.index = String(index);
    item.className = applied.result.success ? '' : 'failed';
    item.append(
      element('span', String(index + 1), 'n'),
      element('span', describeAction(applied.action), 'what'),
      element('span', describeResult(applied.result), 'result'));
    item.addEventListener('click', () => select(index));
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
  const track = element('div', '', 'track' + (centred ? ' centred' : ''));
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

function showState() {
  const state = stateAt(position);
  const turn = turnAt(position);
  const zones = state.poweredZoneCount + state.unpoweredZoneCount;
  const rows = [
    ['Funds', formatMoney(state.funds)],
    ['Population', formatNumber(state.population)],
    ['Score', formatNumber(state.score)],
    ['City class', state.cityClass.charAt(0) +
      state.cityClass.slice(1).toLowerCase()],
    ['Approval', state.approval + '%'],
    ['Tax rate', state.taxRate + '%'],
    ['Powered zones', `${state.poweredZoneCount} of ${zones}`],
  ];

  $('date').textContent = formatDate(state.date) +
    (position < run.log.turns.length ? ', start of the turn' : ', end');
  $('state').replaceChildren(...rows.flatMap(([name, value]) =>
    [element('dt', name), element('dd', value)]));

  // The valves run from -2000 to 2000 for residential, 1500 for the others
  $('rci').replaceChildren(
    ...bar('Residential', state.rci.residential, 2000, 'var(--res)', true),
    ...bar('Commercial', state.rci.commercial, 1500, 'var(--com)', true),
    ...bar('Industrial', state.rci.industrial, 1500, 'var(--ind)', true));
  $('problems').replaceChildren(...PROBLEMS.flatMap(([key, name]) =>
    bar(name, state.problems[key], 255, '#c76b6b', false)));

  const windows = $('windows');
  windows.replaceChildren();

  if (turn !== null && turn.budgetWindows.length > 0) {
    const list = element('ul', '', 'windows');

    for (const record of turn.budgetWindows) {
      list.append(element('li', `${formatDate(record.date)}: funds ` +
        `${formatMoney(record.funds)}, taxes ${formatMoney(record.taxes)}, ` +
        `paid roads ${record.road}%, fire ${record.fire}%, ` +
        `police ${record.police}%`));
    }

    windows.append(element('h3', 'Budget windows in this turn'), list);
  }

  $('report').textContent = turn !== null && turn.agent !== null ?
    JSON.stringify(turn.agent) : 'none';
}

function chartX(index, count, width) {
  return CHART_PAD + (count > 1 ? index / (count - 1) : 0) *
    (width - 2 * CHART_PAD);
}

function drawChart(chart, values, color, title, label) {
  const ratio = window.devicePixelRatio || 1;
  const width = chart.clientWidth;
  const height = chart.clientHeight;
  const context = chart.getContext('2d');
  const max = Math.max(1, ...values);
  const y = (value) => height - CHART_PAD -
    Math.max(0, value) / max * (height - 2 * CHART_PAD - 12);

  chart.width = Math.max(1, Math.round(width * ratio));
  chart.height = Math.max(1, Math.round(height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#20252d';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.beginPath();
  values.forEach((value, i) => {
    const x = chartX(i, values.length, width);
    return i === 0 ? context.moveTo(x, y(value)) : context.lineTo(x, y(value));
  });
  context.stroke();

  context.fillStyle = '#9aa3ad';
  context.font = '10px system-ui, sans-serif';
  context.fillText('max ' + label(max), CHART_PAD + 2, 11);

  const x = chartX(position, values.length, width);
  context.strokeStyle = COLORS.pick;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.stroke();
  context.fillStyle = COLORS.pick;
  context.beginPath();
  context.arc(x, y(values[position]), 3, 0, 2 * Math.PI);
  context.fill();

  title.textContent = `${title.dataset.name}: ${label(values[position])}`;
}

function drawCharts() {
  if (run === null) {
    return;
  }

  drawChart($('population-chart'), run.population, '#6fc3ff',
    $('population-title'), formatNumber);
  drawChart($('funds-chart'), run.funds, '#7ee08a', $('funds-title'),
    formatMoney);
}

function chartClick(event) {
  if (run === null) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const share = (event.clientX - rect.left - CHART_PAD) /
    (rect.width - 2 * CHART_PAD);
  setPosition(clamp(share, 0, 1) * (run.count - 1));
}

function play() {
  if (run === null) {
    return;
  }

  if (position >= run.count - 1) {
    setPosition(0);
  }

  $('play').textContent = 'Pause';
  tick();
}

function tick() {
  timer = setTimeout(() => {
    if (position >= run.count - 1) {
      stop();
      return;
    }

    setPosition(position + 1);
    tick();
  }, 1000 / Number($('speed').value));
}

function stop() {
  clearTimeout(timer);
  timer = null;
  $('play').textContent = 'Play';
}

function togglePlay() {
  if (timer === null) {
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

  drawCharts();
}

// Buttons give the focus back, so Space stays play and pause
function onButton(id, action) {
  $(id).addEventListener('click', (event) => {
    event.currentTarget.blur();
    action();
  });
}

onButton('first', () => setPosition(0));
onButton('back', () => setPosition(position - 1));
onButton('play', togglePlay);
onButton('forward', () => setPosition(position + 1));
onButton('last', () => setPosition(run === null ? 0 : run.count - 1));
onButton('fit', fit);
onButton('open', () => $('file').click());

$('population-title').dataset.name = 'Population';
$('funds-title').dataset.name = 'Funds';
$('population-chart').addEventListener('click', chartClick);
$('funds-chart').addEventListener('click', chartClick);

slider.addEventListener('input', () => setPosition(Number(slider.value)));
$('after').addEventListener('change', (event) => {
  event.currentTarget.blur();

  if (run !== null) {
    refreshMap();
  }
});
$('power').addEventListener('change', (event) => {
  event.currentTarget.blur();

  if (run !== null && run.history !== null) {
    paintTiles();
    render();
  }
});
$('file').addEventListener('change', (event) => {
  if (event.currentTarget.files.length > 0) {
    openFile(event.currentTarget.files[0]);
  }
});

document.addEventListener('keydown', (event) => {
  if (run === null || event.target instanceof HTMLSelectElement) {
    return;
  }

  // The slider steps by itself when it has the focus
  const onSlider = event.target === slider;

  if (event.key === 'ArrowLeft' && !onSlider) {
    setPosition(position - 1);
  } else if (event.key === 'ArrowRight' && !onSlider) {
    setPosition(position + 1);
  } else if (event.key === 'Home' && !onSlider) {
    setPosition(0);
  } else if (event.key === 'End' && !onSlider) {
    setPosition(run.count - 1);
  } else if (event.key === ' ') {
    togglePlay();
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

  hover = { sx: event.offsetX, sy: event.offsetY };
  showHover();
  render();
});

canvas.addEventListener('pointerup', (event) => {
  if (drag !== null && !drag.moved) {
    clickAt(event.offsetX, event.offsetY);
  }

  drag = null;
  canvas.classList.remove('dragging');
});

canvas.addEventListener('pointerleave', () => {
  hover = null;
  showHover();
  render();
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
window.addEventListener('resize', drawCharts);

const params = new URLSearchParams(window.location.search);
const logUrl = params.get('log');

if (logUrl !== null) {
  showMessage('Loading ' + logUrl);
  fetch(logUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${logUrl} (${response.status})`);
      }

      return response.json();
    })
    .then((log) => start(log, params.get('name') ?? logUrl))
    .catch(showError);
}
