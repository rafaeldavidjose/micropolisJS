// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, stepMonths } from '../runner.ts';
import { getMap } from '../engine.ts';
import { hashCity } from '../hash.ts';
import { applyAction, runGame } from '../game.ts';
import { createDemoAgent } from '../agents/demo.ts';
import {
  actionShape,
  createMapHistory,
  positionCount,
  spriteAt,
  spritesAt,
} from '../viewer/replay.js';
import { FLAGS, TILES, describeTile } from '../viewer/tiles.js';
import * as TileValues from '../../src/tileValues.ts';
import * as TileFlags from '../../src/tileFlags.ts';
import type {
  ActionResult,
  MapHistory,
  MapLike,
  RunLog,
  SimulationLike,
  SpriteRecord,
  TurnLog,
} from '../types.ts';

const SEED: number = 20260926;
const OK: ActionResult = { success: true, cost: 0, reason: null };

function readTiles(map: MapLike): number[] {
  const tiles: number[] = [];

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      tiles.push(map.getTile(x, y).getRawValue());
    }
  }

  return tiles;
}

/* The demo town grows on this seed. The city is played again from the
 * actions in the log, and its map read at the start of every turn and at
 * the end. The positions are checked from both ends towards the middle,
 * so most of them start from a copy made for an earlier position. */
test('replay: the map rebuilt for every turn matches the city',
  async (): Promise<void> => {
  const log: RunLog = await runGame(createDemoAgent(),
    { seed: SEED, turns: 40 });
  const city: SimulationLike = createCity({
    seed: SEED, level: log.options.level, disasters: log.options.disasters,
  });
  const real: number[][] = [];

  for (const turn of log.turns) {
    real.push(readTiles(getMap(city)));

    for (const applied of turn.actions) {
      applyAction(city, applied.action);
    }

    stepMonths(city, log.options.monthsPerTurn);
  }

  real.push(readTiles(getMap(city)));

  assert.equal(hashCity(city), log.final.hash);
  assert.ok(log.final.state.population > 2000);

  const history: MapHistory = createMapHistory(log);
  const count: number = positionCount(log);

  for (let index: number = 0; index < count; index++) {
    const position: number = index % 2 === 0 ? count - 1 - index / 2 :
      (index - 1) / 2;
    assert.deepEqual(Array.from(history.tilesAt(position)), real[position],
      'position ' + position);
  }
});

test('replay: the viewer has the engine tile numbers and flags', (): void => {
  const values: Record<string, unknown> = TileValues;
  const flags: Record<string, unknown> = TileFlags;

  for (const [name, value] of Object.entries(TILES)) {
    assert.equal(value, values[name], name);
  }

  for (const [name, value] of Object.entries(FLAGS)) {
    assert.equal(value, flags[name], name);
  }

  assert.equal(describeTile(TileValues.FREEZ | TileFlags.ZONEBIT |
    TileFlags.CONDBIT | TileFlags.POWERBIT),
    'Residential, empty zone, zone centre, powered');
  assert.equal(describeTile(TileValues.HTRFBASE + 2 | TileFlags.BULLBIT),
    'Road, heavy traffic');
  assert.equal(describeTile(TileValues.RIVER), 'Water');
  assert.equal(describeTile(TileValues.LHPOWER | TileFlags.CONDBIT),
    'Power, no power');
  assert.equal(describeTile(TileValues.COALSMOKE2), 'Coal Power');
});

test('replay: buildings sit on their centre tile, routes on their tiles',
  (): void => {
  assert.deepEqual(actionShape({
    action: { type: 'build', tool: 'coal', x: 10, y: 20 }, result: OK,
  }), { kind: 'area', x: 9, y: 19, width: 4, height: 4 });
  assert.deepEqual(actionShape({
    action: { type: 'build', tool: 'road', x: 10, y: 20 }, result: OK,
  }), { kind: 'area', x: 10, y: 20, width: 1, height: 1 });
  assert.deepEqual(actionShape({
    action: { type: 'route', tool: 'road', from: { x: 1, y: 1 },
      to: { x: 2, y: 2 } },
    result: OK,
    tiles: [[1, 1], [2, 1], [2, 2]],
  }), { kind: 'path', tiles: [[1, 1], [2, 1], [2, 2]], planned: true });
  assert.deepEqual(actionShape({
    action: { type: 'route', tool: 'road', from: { x: 1, y: 1 },
      to: { x: 5, y: 1 } },
    result: { success: false, cost: 0, reason: 'no-route' },
  }), { kind: 'path', tiles: [[1, 1], [5, 1]], planned: false });
  assert.equal(actionShape({
    action: { type: 'setTaxRate', rate: 9 }, result: OK,
  }), null);
  assert.equal(actionShape({ action: null, result: OK }), null);
});

/* A turn's sprites are sampled while the city runs after the actions, so
 * the start of a turn shows the last sample of the turn before. */
test('replay: sprites at rest, inside a turn and in old logs', (): void => {
  const tornado: SpriteRecord = [6, 2, 100, 60];
  const train: SpriteRecord = [1, 3, 300, 200];
  const log: Pick<RunLog, 'spriteSampling'> & {
    turns: Pick<TurnLog, 'sprites'>[];
  } = {
    spriteSampling: { ticksPerSample: 4, samplesPerTurn: 48 },
    turns: [
      { sprites: [[10, [tornado]], [48, [tornado, train]]] },
      { sprites: [[1, [train]]] },
    ],
  };

  assert.deepEqual(spritesAt(log, 0), []);
  assert.deepEqual(spritesAt(log, 1), [tornado, train]);
  assert.deepEqual(spritesAt(log, 2), []);
  assert.deepEqual(spritesAt(log, 0, 10), [tornado]);
  assert.deepEqual(spritesAt(log, 0, 11), []);
  assert.deepEqual(spritesAt(log, 1, 1), [train]);
  assert.deepEqual(spritesAt({ turns: [{}, {}] }, 1), []);

  // A tornado is 48 pixels square and a train 32
  assert.deepEqual(spriteAt([tornado, train], 147, 107), tornado);
  assert.equal(spriteAt([tornado, train], 148, 60), null);
  assert.deepEqual(spriteAt([tornado, train], 331, 231), train);
  assert.equal(spriteAt([tornado, train], 332, 200), null);
});
