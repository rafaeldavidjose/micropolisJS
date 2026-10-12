// Run with node:test, not Jest. See README.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILD_TOOLS,
  build,
  bulldoze,
  quoteBuild,
  quoteBulldoze,
  quoteSetAutoBudget,
  quoteSetBudgetPercentages,
  quoteSetTaxRate,
  setAutoBudget,
  setBudgetPercentages,
  setTaxRate,
} from '../actions.ts';
import { getMap } from '../engine.ts';
import { hashCity } from '../hash.ts';
import { createDevelopedCity } from './helpers/cities.ts';
import { Random } from '../../src/random.ts';
import { DIRT, WOODS_HIGH, WOODS_LOW } from '../../src/tileValues.ts';
import type {
  ActionResult,
  BudgetPercentages,
  MapLike,
  Position,
  SimulationLike,
} from '../types.ts';

const SEED: number = 20260926;

// The zone centres and the coal plant of the developed city
const ZONE_ROW_Y: number[] = [48, 52];
const COAL_PLANT: Position = { x: 40, y: 47 };

// mulberry32, kept apart from the game's generator
function makeRandom(seed: number): () => number {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6D2B79F5) | 0;
    let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function findTile(map: MapLike, matches: (value: number) => boolean,
    rawToo: boolean): Position {
  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      const value: number = rawToo ? map.getTile(x, y).getRawValue() :
        map.getTileValue(x, y);

      if (matches(value)) {
        return { x: x, y: y };
      }
    }
  }

  throw new Error('no such tile');
}

/* The quote must match the action. When only the money is missing the
 * quote keeps the price and the action spends nothing. */
function assertSame(quote: ActionResult, result: ActionResult): void {
  assert.equal(quote.success, result.success);
  assert.equal(quote.reason, result.reason);

  if (quote.reason === 'insufficient-funds') {
    assert.ok(quote.cost > 0);
    assert.equal(result.cost, 0);
  } else {
    assert.equal(quote.cost, result.cost);
  }
}

test('quotes: a park and a bulldozed zone cost what was quoted', (): void => {
  const city: SimulationLike = createDevelopedCity(SEED);
  const map: MapLike = getMap(city);
  const bare: Position = findTile(map,
    (raw: number): boolean => raw === DIRT, true);
  const tree: Position = findTile(map,
    (value: number): boolean => value >= WOODS_LOW && value <= WOODS_HIGH,
    false);

  assertSame(quoteBuild(city, 'park', bare.x, bare.y),
    build(city, 'park', bare.x, bare.y));
  assertSame(quoteBuild(city, 'park', tree.x, tree.y),
    build(city, 'park', tree.x, tree.y));

  const targets: Position[] = [COAL_PLANT];

  for (const y of ZONE_ROW_Y) {
    for (let x: number = 43; x <= 78; x += 3) {
      targets.push({ x: x, y: y });
    }
  }

  let zones: number = 0;

  for (const target of targets) {
    const quote: ActionResult = quoteBulldoze(city, target.x, target.y);
    assertSame(quote, bulldoze(city, target.x, target.y));

    if (quote.success) {
      zones++;
    }
  }

  // Otherwise no zone was there and the test proves nothing
  assert.ok(zones > 10);
});

test('quotes: random builds and bulldozing cost what was quoted', (): void => {
  const city: SimulationLike = createDevelopedCity(SEED);
  const random: () => number = makeRandom(SEED);
  const pick: (limit: number) => number = (limit: number): number =>
    Math.floor(random() * limit);
  const seen: Record<string, number> = {};

  for (let draw: number = 0; draw < 1500; draw++) {
    // Changing the funds now and then gives some insufficient-funds cases
    if (draw % 300 === 0) {
      city.budget.setFunds(pick(4000));
    }

    const x: number = pick(120);
    const y: number = pick(100);
    const tool: string = BUILD_TOOLS[pick(BUILD_TOOLS.length)];
    const dozing: boolean = random() < 0.3;
    const quote: ActionResult = dozing ? quoteBulldoze(city, x, y) :
      quoteBuild(city, tool, x, y);
    const result: ActionResult = dozing ? bulldoze(city, x, y) :
      build(city, tool, x, y);

    assertSame(quote, result);

    const key: string = result.reason ?? 'ok';
    seen[key] = (seen[key] ?? 0) + 1;
  }

  for (const reason of ['ok', 'occupied', 'insufficient-funds',
    'nothing-to-bulldoze']) {
    assert.ok((seen[reason] ?? 0) > 0, JSON.stringify(seen));
  }
});

test('quotes: settings cost nothing and match the actions', (): void => {
  const city: SimulationLike = createDevelopedCity(SEED);

  for (const rate of [0, 7, 20, -1, 21, 2.5]) {
    assertSame(quoteSetTaxRate(city, rate), setTaxRate(city, rate));
  }

  for (const road of [0, 50, 100, 101]) {
    const percentages: BudgetPercentages = {
      road: road, fire: 50, police: 50,
    };
    assertSame(quoteSetBudgetPercentages(city, percentages),
      setBudgetPercentages(city, percentages));
  }

  for (const enabled of [true, false, 'yes' as unknown as boolean]) {
    assertSame(quoteSetAutoBudget(city, enabled),
      setAutoBudget(city, enabled));
  }
});

/* createCity seeds the game's generator, so two cities made the same way
 * draw the same next number unless something in between drew one. */
test('quotes: quoting changes nothing and draws no random numbers',
  (): void => {
  const quoted: SimulationLike = createDevelopedCity(SEED);
  const map: MapLike = getMap(quoted);
  const bare: Position = findTile(map,
    (raw: number): boolean => raw === DIRT, true);
  const random: () => number = makeRandom(SEED);
  const pick: (limit: number) => number = (limit: number): number =>
    Math.floor(random() * limit);
  const hashBefore: string = hashCity(quoted);

  quoteBuild(quoted, 'park', bare.x, bare.y);

  for (let x: number = 43; x <= 78; x += 3) {
    quoteBulldoze(quoted, x, ZONE_ROW_Y[0]);
  }

  for (let draw: number = 0; draw < 500; draw++) {
    quoteBuild(quoted, BUILD_TOOLS[pick(BUILD_TOOLS.length)], pick(120),
      pick(100));
    quoteBulldoze(quoted, pick(120), pick(100));
  }

  assert.equal(hashCity(quoted), hashBefore);
  const nextAfterQuotes: number = Random.getRandom(1000000);

  createDevelopedCity(SEED);

  assert.equal(Random.getRandom(1000000), nextAfterQuotes);
});
