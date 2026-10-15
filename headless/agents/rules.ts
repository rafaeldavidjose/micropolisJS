import type {
  ActionResult,
  Agent,
  BlockMapView,
  BudgetWindowRecord,
  CityDate,
  CityState,
  CityView,
  GameAction,
  MapView,
  Position,
  RoutePlan,
  RouteTile,
  ZoneView,
} from '../types.ts';
import {
  AIRPORT,
  FIRESTATION,
  FULLSTADIUM,
  HBRDG0,
  HBRDG3,
  HTRFBASE,
  LASTRAIL,
  NUCLEAR,
  POLICESTATION,
  PORT,
  POWERBASE,
  POWERPLANT,
  RAILBASE,
  ROADBASE,
  STADIUM,
  VBRDG0,
  VBRDG3,
} from '../../src/tileValues.ts';
import {
  conducts,
  isBuilding,
  isFreeLand,
  isPowerPlant,
  isRoad,
  isWater,
  siteSize,
  zoneKind,
  zonePopulation,
} from './tiles.ts';
import type { ZoneKind } from './tiles.ts';
import {
  DIRECTIONS,
  centresTouching,
  cityCentre,
  closestTile,
  compareDistance,
  distanceSquared,
  edgeTiles,
  indexOf,
  isOnMap,
  mapCentre,
  positionOf,
  powerJoins,
  powerNetwork,
  roadTiles,
  siteTiles,
  sortByDistance,
  tilesPastRoadEnds,
  uniqueTiles,
} from './sites.ts';

/* Thresholds and margins, all provisional. They were tuned on seeds 1001
 * to 1020 only, so seeds 1 to 10 stay for reporting. */

// The reserve is the estimated yearly budget plus this share of it
const RESERVE_MARGIN: number = 0.25;

// Average crime above which the agent builds police stations
const CRIME_THRESHOLD: number = 50;

// A station counts as covering the blocks this many tiles from its centre
const COVERAGE_RADIUS: number = 12;

// A fire station is built where it covers at least this many blocks
const FIRE_MIN_BLOCKS: number = 80;

// Money above the reserve that counts as piling up
const PILE_UP_FUNDS: number = 10000;

// Taxes count as among the worst when in this many of the seven problems
const WORST_PROBLEMS: number = 3;

// The tax rate stays in this range and changes at most once a year
const TAX_MIN: number = 5;
const TAX_MAX: number = 9;
const TAX_CHANGE_MONTHS: number = 12;

/* An empty zone with power and a road is rezoned after this long. In the
 * greedy agent's 20 year games, 95% of the zones that developed did so
 * within 75 months. */
const EMPTY_ZONE_MONTHS: number = 75;

// Two sites count as next to each other with at most this many tiles between
const NEXT_TO_GAP: number = 1;

/* Fixed numbers of the engine. The census thresholds come from
 * _sendMessages in src/simulation.js, which caps the demand, and the costs
 * from src/budget.js and src/powerManager.js. */
const STADIUM_RESIDENTS: number = 500;
const AIRPORT_COMMERCE: number = 100;
const SEAPORT_INDUSTRY: number = 70;
const ROAD_COST_BY_LEVEL: readonly number[] = [0.7, 0.9, 1.2];
const TAX_INCOME_BY_LEVEL: readonly number[] = [1.4, 1.2, 0.8];
const STATION_COST: number = 100;
const COAL_POWER: number = 700;
const NUCLEAR_POWER: number = 2000;

const ZONE_TOOLS: readonly ZoneKind[] = [
  'residential',
  'commercial',
  'industrial',
];

const ZONE_SIZE: number = 3;
const PLANT_SIZE: number = 4;

// The first road runs this far over free land, room for two zones a side
const ROAD_LENGTH: number = 6;

// Route searches a turn may spend on new roads and on repairs
const ROAD_ENDS_TRIED: number = 20;
const REPAIRS_TRIED: number = 20;

// Uncovered blocks with the most crime that a police station is tried for
const CRIME_BLOCKS_TRIED: number = 10;

const POLLUTER_TOOLS: readonly string[] = [
  'industrial',
  'coal',
  'nuclear',
  'port',
  'airport',
];

/* What the agent keeps from turn to turn: the road tiles it has seen, when
 * each empty zone with power and a road was first seen like that, the
 * sites it bulldozed for another zone, and when it last changed the tax. */
interface Memory {
  roads: Set<number>;
  emptySince: Map<number, number>;
  rezone: Set<number>;
  lastTaxChange: number;
}

// A zone or building by its site, and whether it is a home or pollutes
interface Placed {
  centre: Position;
  size: number;
  residential: boolean;
  polluter: boolean;
}

/* The view stays as it was at the start of the turn, so the plan keeps
 * what earlier actions of the turn already promised: money, tiles, wired
 * zones, sites and the rules that run once a turn. Buildings stay off the
 * tile past the end of each road and off road tiles that fell apart. */
interface TurnPlan {
  month: number;
  funds: number;
  reserve: number;
  centre: Position;
  roads: Position[];
  roadSites: Map<number, Position[]>;
  taken: Set<number>;
  brokenRoads: Set<number>;
  roadEnds: Set<number>;
  wired: Set<number>;
  placed: Placed[];
  done: Set<string>;
  roadTries: number;
  outOfMoney: boolean;
  actions: GameAction[];
  rules: string[];
}

/* once names a group of rules that may act once a turn, rezoned a site the
 * agent cleared earlier and demolished one it clears now. */
interface Choice {
  rule: string;
  action: GameAction;
  cost: number;
  tiles: Position[];
  wiredZone: number | null;
  placed: Placed | null;
  once: string | null;
  rezoned: number | null;
  demolished: number | null;
}

interface Rule {
  free: boolean;
  run: () => Choice | null;
}

// The census counts the engine compares with its thresholds
interface Census {
  residential: number;
  commercial: number;
  industrial: number;
}

interface CoveredSite {
  centre: Position;
  covered: number;
}

function monthOf(date: CityDate): number {
  return date.year * 12 + date.month;
}

function choiceOf(rule: string, action: GameAction, cost: number,
    tiles: Position[]): Choice {
  return {
    rule: rule,
    action: action,
    cost: cost,
    tiles: tiles,
    wiredZone: null,
    placed: null,
    once: null,
    rezoned: null,
    demolished: null,
  };
}

function census(view: CityView): Census {
  const counts: Census = { residential: 0, commercial: 0, industrial: 0 };

  for (const zone of view.zones) {
    const kind: ZoneKind | null = zoneKind(zone.tile);

    if (kind !== null) {
      counts[kind] += zonePopulation(view.map, zone);
    }
  }

  return counts;
}

/* The full yearly cost with the formulas of collectTax in src/budget.js:
 * $1 a road tile, $5 a bridge, $1 more under heavy traffic and $2 a rail
 * tile, times the level, and $100 a police or fire station. */
function yearlyCost(view: CityView): number {
  const map: MapView = view.map;
  let roadUnits: number = 0;
  let railTiles: number = 0;

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      const value: number = map.getTileValue(x, y);

      if (value >= ROADBASE && value < POWERBASE) {
        roadUnits += ((value - ROADBASE) & 15) < 2 ? 5 : 1;
        roadUnits += value >= HTRFBASE ? 1 : 0;
      } else if (value >= RAILBASE && value <= LASTRAIL) {
        railTiles++;
      }
    }
  }

  const stations: number = view.zones.filter((zone: ZoneView): boolean =>
    zone.tile === POLICESTATION || zone.tile === FIRESTATION).length;

  return Math.floor((roadUnits + railTiles * 2) *
    ROAD_COST_BY_LEVEL[view.level]) + stations * STATION_COST;
}

/* The taxes of the next January with the formula of collectTax. The land
 * value average is the housing problem times 10 / 7. */
function expectedTaxes(view: CityView, counts: Census): number {
  const people: number = Math.round(counts.residential / 8 +
    counts.commercial + counts.industrial);
  const landValue: number = Math.round(view.state.problems.housing * 10 / 7);

  return Math.floor(Math.floor(people * landValue / 120) *
    view.state.taxRate * TAX_INCOME_BY_LEVEL[view.level]);
}

function hasRoadNext(map: MapView, zone: ZoneView): boolean {
  return edgeTiles(zone, siteSize(zone.tile)).some((tile: Position): boolean =>
    isOnMap(map, tile.x, tile.y) && isRoad(map.getTileValue(tile.x, tile.y)));
}

/* Brings the memory up to date with the view: the road tiles, and the
 * empty zones with power and a road. A road tile under a building now is
 * forgotten. */
function remember(view: CityView, memory: Memory, month: number): void {
  const map: MapView = view.map;

  for (const road of roadTiles(map)) {
    memory.roads.add(indexOf(map, road.x, road.y));
  }

  for (const index of memory.roads) {
    const tile: Position = positionOf(map, index);

    if (isBuilding(map.getTileValue(tile.x, tile.y))) {
      memory.roads.delete(index);
    }
  }

  const zones: Set<number> = new Set();

  for (const zone of view.zones) {
    const index: number = indexOf(map, zone.x, zone.y);
    const waiting: boolean = zoneKind(zone.tile) !== null && zone.powered &&
      zonePopulation(map, zone) === 0 && hasRoadNext(map, zone);

    if (!waiting) {
      continue;
    }

    zones.add(index);

    if (!memory.emptySince.has(index)) {
      memory.emptySince.set(index, month);
    }
  }

  for (const index of memory.emptySince.keys()) {
    if (!zones.has(index)) {
      memory.emptySince.delete(index);
    }
  }
}

/* A drawbridge opens for a ship and leaves water where its road was, with
 * the raised halves at most two tiles away (doBridge in src/road.js). */
function isNearOpenBridge(map: MapView, tile: Position): boolean {
  for (let dy: number = -2; dy <= 2; dy++) {
    for (let dx: number = -2; dx <= 2; dx++) {
      const x: number = tile.x + dx;
      const y: number = tile.y + dy;
      const value: number = isOnMap(map, x, y) ? map.getTileValue(x, y) : 0;

      if ((value >= HBRDG0 && value <= HBRDG3) ||
          (value >= VBRDG0 && value <= VBRDG3)) {
        return true;
      }
    }
  }

  return false;
}

/* The road tiles seen before that turned to land a tool clears, and the
 * bridge tiles that fell back to water, but not an open drawbridge. */
function brokenRoads(view: CityView, memory: Memory): Set<number> {
  const broken: Set<number> = new Set();

  for (const index of memory.roads) {
    const tile: Position = positionOf(view.map, index);
    const value: number = view.map.getTileValue(tile.x, tile.y);

    if (isFreeLand(value) ||
        (isWater(value) && !isNearOpenBridge(view.map, tile))) {
      broken.add(index);
    }
  }

  return broken;
}

function isOpenLand(view: CityView, plan: TurnPlan, tile: Position): boolean {
  if (!isOnMap(view.map, tile.x, tile.y)) {
    return false;
  }

  const index: number = indexOf(view.map, tile.x, tile.y);

  return !plan.taken.has(index) && !plan.brokenRoads.has(index) &&
    isFreeLand(view.map.getTileValue(tile.x, tile.y));
}

// Free land, or a power line that a road may cross if it runs straight
function isPassable(view: CityView, plan: TurnPlan, tile: Position): boolean {
  if (isOpenLand(view, plan, tile)) {
    return true;
  }

  if (!isOnMap(view.map, tile.x, tile.y) ||
      plan.taken.has(indexOf(view.map, tile.x, tile.y))) {
    return false;
  }

  const value: number = view.map.getTileValue(tile.x, tile.y);

  return conducts(value) && !isBuilding(value) && !isRoad(value);
}

/* Free land or plain power lines, which the tools clear. A building
 * conducts, so one built over a power line still passes the power on.
 * Whether the site is free in the end is up to the quote. */
function isOpenSite(view: CityView, plan: TurnPlan, centre: Position,
    size: number): boolean {
  return siteTiles(centre, size).every((tile: Position): boolean =>
    isPassable(view, plan, tile) &&
    !plan.roadEnds.has(indexOf(view.map, tile.x, tile.y)));
}

function placedOf(zone: ZoneView): Placed {
  const kind: ZoneKind | null = zoneKind(zone.tile);

  return {
    centre: zone,
    size: siteSize(zone.tile),
    residential: kind === 'residential',
    polluter: kind === 'industrial' || isPowerPlant(zone.tile) ||
      zone.tile === PORT || zone.tile === AIRPORT,
  };
}

// The tiles between two sites, the larger of the two directions
function gapBetween(first: Placed, second: Placed): number {
  const firstLeft: number = first.centre.x - 1;
  const firstTop: number = first.centre.y - 1;
  const secondLeft: number = second.centre.x - 1;
  const secondTop: number = second.centre.y - 1;
  const gapX: number = Math.max(secondLeft - (firstLeft + first.size),
    firstLeft - (secondLeft + second.size));
  const gapY: number = Math.max(secondTop - (firstTop + first.size),
    firstTop - (secondTop + second.size));

  return Math.max(gapX, gapY);
}

function isNextTo(first: Placed, second: Placed): boolean {
  return gapBetween(first, second) <= NEXT_TO_GAP;
}

function allSites(view: CityView, plan: TurnPlan): Placed[] {
  return [...view.zones.map(placedOf), ...plan.placed];
}

/* Homes never go next to industry, plants, the seaport or the airport,
 * and those never go next to homes, so the demolition rule has nothing to
 * undo in the agent's own city. */
function placedFor(view: CityView, plan: TurnPlan, tool: string,
    centre: Position, size: number): Placed | null {
  const site: Placed = {
    centre: centre,
    size: size,
    residential: tool === 'residential',
    polluter: POLLUTER_TOOLS.includes(tool),
  };
  const clash: boolean = allSites(view, plan).some((other: Placed): boolean =>
    ((site.residential && other.polluter) ||
      (site.polluter && other.residential)) && isNextTo(site, other));

  return clash ? null : site;
}

/* The quote of an action the turn can still pay for, keeping the reserve,
 * or null. When the money is short the agent waits for it: the turn plays
 * no more actions that cost money. */
function payable(view: CityView, plan: TurnPlan,
    action: GameAction): ActionResult | null {
  const quote: ActionResult = view.quote(action);

  if (quote.success &&
      (quote.cost === 0 || quote.cost <= plan.funds - plan.reserve)) {
    return quote;
  }

  if (quote.success || quote.reason === 'insufficient-funds') {
    plan.outOfMoney = true;
  }

  return null;
}

// The first free site from the centres, taken by distance to the target
function buildNear(view: CityView, plan: TurnPlan, rule: string,
    tool: string, size: number, centres: Position[],
    target: Position): Choice | null {
  for (const centre of sortByDistance([...centres], target)) {
    if (!isOpenSite(view, plan, centre, size)) {
      continue;
    }

    const placed: Placed | null = placedFor(view, plan, tool, centre, size);

    if (placed === null) {
      continue;
    }

    const action: GameAction = {
      type: 'build', tool: tool, x: centre.x, y: centre.y,
    };
    const quote: ActionResult | null = payable(view, plan, action);

    if (plan.outOfMoney) {
      return null;
    }

    if (quote !== null) {
      return {
        ...choiceOf(rule, action, quote.cost, siteTiles(centre, size)),
        placed: placed,
      };
    }
  }

  return null;
}

function routeChoice(view: CityView, plan: TurnPlan, rule: string,
    tool: string, from: Position, to: Position): Choice | null {
  const action: GameAction = { type: 'route', tool: tool, from: from, to: to };
  const quote: ActionResult | null = payable(view, plan, action);

  if (quote === null) {
    return null;
  }

  const route: RoutePlan = view.planRoute(tool, from, to);

  return choiceOf(rule, action, quote.cost,
    route.tiles.map((tile: RouteTile): Position => ({ x: tile.x, y: tile.y })));
}

// The centres of the sites of a size that touch a road, once a turn
function roadSites(view: CityView, plan: TurnPlan, size: number): Position[] {
  const cached: Position[] | undefined = plan.roadSites.get(size);

  if (cached !== undefined) {
    return cached;
  }

  const centres: Position[] = uniqueTiles(view.map, plan.roads.flatMap(
    (road: Position): Position[] => centresTouching(road, size)));
  plan.roadSites.set(size, centres);

  return centres;
}

// Rule 1a: with no power plant, a coal plant closest to the centre of the map
function buildFirstPlant(view: CityView, plan: TurnPlan): Choice | null {
  if (plan.done.has('plant') ||
      view.zones.some((zone: ZoneView): boolean => isPowerPlant(zone.tile))) {
    return null;
  }

  const centres: Position[] = [];

  for (let y: number = 1; y <= view.map.height - PLANT_SIZE + 1; y++) {
    for (let x: number = 1; x <= view.map.width - PLANT_SIZE + 1; x++) {
      centres.push({ x: x, y: y });
    }
  }

  const choice: Choice | null = buildNear(view, plan, 'first-plant', 'coal',
    PLANT_SIZE, centres, mapCentre(view.map));

  return choice === null ? null : { ...choice, once: 'plant' };
}

/* Rule 1b: a power line to the zone without power closest to the city
 * centre, among those the network does not reach. It runs from the join
 * closest to the zone to the tile next to the zone closest to that join. */
function connectZone(view: CityView, plan: TurnPlan, network: Set<number>,
    joins: Position[]): Choice | null {
  const map: MapView = view.map;
  const unconnected: ZoneView[] = view.zones.filter(
    (zone: ZoneView): boolean => !zone.powered && !isPowerPlant(zone.tile) &&
      !network.has(indexOf(map, zone.x, zone.y)) &&
      !plan.wired.has(indexOf(map, zone.x, zone.y)));
  const isKept: (tile: Position) => boolean = (tile: Position): boolean =>
    plan.taken.has(indexOf(map, tile.x, tile.y)) ||
    plan.roadEnds.has(indexOf(map, tile.x, tile.y)) ||
    plan.brokenRoads.has(indexOf(map, tile.x, tile.y));
  const openJoins: Position[] = joins.filter((tile: Position): boolean =>
    !isKept(tile));

  if (openJoins.length === 0) {
    return null;
  }

  for (const zone of sortByDistance(unconnected, plan.centre)) {
    const from: Position = sortByDistance([...openJoins], zone)[0];
    const ends: Position[] = edgeTiles(zone, siteSize(zone.tile))
      .filter((tile: Position): boolean => isOnMap(map, tile.x, tile.y) &&
        !isKept(tile) && !isBuilding(map.getTileValue(tile.x, tile.y)));

    for (const to of sortByDistance(ends, from)) {
      const choice: Choice | null = routeChoice(view, plan, 'connect-zone',
        'wire', from, to);

      if (plan.outOfMoney) {
        return null;
      }

      if (choice !== null) {
        return { ...choice, wiredZone: indexOf(map, zone.x, zone.y) };
      }
    }
  }

  return null;
}

/* Rule 1c: zones the network reaches still have no power, so its plants
 * cannot feed them all. Another coal plant goes next to the network,
 * before any growth, since new zones would only share the same power. */
function buildExtraPlant(view: CityView, plan: TurnPlan,
    network: Set<number>): Choice | null {
  const map: MapView = view.map;
  const starved: boolean = view.zones.some((zone: ZoneView): boolean =>
    !zone.powered && !isPowerPlant(zone.tile) &&
    network.has(indexOf(map, zone.x, zone.y)));

  if (plan.done.has('plant') || !starved) {
    return null;
  }

  const centres: Position[] = [];

  for (const index of network) {
    centres.push(...centresTouching(positionOf(map, index), PLANT_SIZE));
  }

  const choice: Choice | null = buildNear(view, plan, 'extra-plant', 'coal',
    PLANT_SIZE, uniqueTiles(map, centres), plan.centre);

  return choice === null ? null : { ...choice, once: 'plant' };
}

/* Rule 2a: funding back to 100% for all three services, when the city can
 * pay that in full and keep its reserve. The reserve is worked out for
 * full funding. */
function restoreFunding(view: CityView, plan: TurnPlan): Choice | null {
  const funding: CityState['funding'] = view.state.funding;

  if (plan.done.has('funding') || plan.funds < plan.reserve ||
      Math.min(funding.road, funding.fire, funding.police) >= 100) {
    return null;
  }

  const action: GameAction = {
    type: 'setBudgetPercentages', road: 100, fire: 100, police: 100,
  };
  const quote: ActionResult | null = payable(view, plan, action);

  return quote === null ? null :
    { ...choiceOf('funding', action, 0, []), once: 'funding' };
}

// Rule 2b: auto budget back on, under the same condition
function restoreAutoBudget(view: CityView, plan: TurnPlan): Choice | null {
  if (plan.done.has('auto-budget') || view.state.autoBudget ||
      plan.funds < plan.reserve) {
    return null;
  }

  const action: GameAction = { type: 'setAutoBudget', enabled: true };
  const quote: ActionResult | null = payable(view, plan, action);

  return quote === null ? null :
    { ...choiceOf('auto-budget', action, 0, []), once: 'auto-budget' };
}

/* The broken road tiles in a straight line from the first one, to the east
 * or else to the south. */
function brokenRun(first: Position,
    isBroken: (tile: Position) => boolean): Position[] {
  for (const direction of DIRECTIONS.slice(0, 2)) {
    const run: Position[] = [first];
    let next: Position = { x: first.x + direction.x, y: first.y + direction.y };

    while (isBroken(next)) {
      run.push(next);
      next = { x: next.x + direction.x, y: next.y + direction.y };
    }

    if (run.length > 1) {
      return run;
    }
  }

  return [first];
}

/* Rule 3: rebuilds road tiles that turned to rubble and bridges that fell
 * back to water, from the road tiles the agent has seen. A straight run of
 * them is one route when planRoute lays exactly those tiles, otherwise
 * each tile is a route of its own. The tiles are taken from the top row
 * down and from left to right. */
function repairRoad(view: CityView, plan: TurnPlan): Choice | null {
  const map: MapView = view.map;
  const isBroken: (tile: Position) => boolean = (tile: Position): boolean =>
    isOnMap(map, tile.x, tile.y) &&
    plan.brokenRoads.has(indexOf(map, tile.x, tile.y)) &&
    !plan.taken.has(indexOf(map, tile.x, tile.y));
  const broken: number[] = [...plan.brokenRoads]
    .sort((first: number, second: number): number => first - second);
  let tries: number = 0;

  for (const index of broken) {
    const first: Position = positionOf(map, index);

    if (!isBroken(first) || tries >= REPAIRS_TRIED) {
      continue;
    }

    tries++;
    const run: Position[] = brokenRun(first, isBroken);
    const last: Position = run[run.length - 1];
    let to: Position = first;

    if (run.length > 1) {
      const route: RoutePlan = view.planRoute('road', first, last);

      if (route.success && route.tiles.length === run.length &&
          route.tiles.every((tile: RouteTile): boolean => isBroken(tile))) {
        to = last;
      }
    }

    const choice: Choice | null = routeChoice(view, plan, 'repair-road',
      'road', first, to);

    if (plan.outOfMoney || choice !== null) {
      return choice;
    }
  }

  return null;
}

// The tile at the middle of a block
function blockCentre(blockMap: BlockMapView, blockX: number,
    blockY: number): Position {
  return {
    x: blockX * blockMap.blockSize + (blockMap.blockSize - 1) / 2,
    y: blockY * blockMap.blockSize + (blockMap.blockSize - 1) / 2,
  };
}

function covers(station: Position, tile: Position): boolean {
  return distanceSquared(station, tile) <= COVERAGE_RADIUS ** 2;
}

/* The developed blocks, those with a land value, that no station covers,
 * from the top row down and from left to right. */
function uncoveredBlocks(view: CityView, stations: Position[]): Position[] {
  const landValue: BlockMapView = view.blockMaps.landValue;
  const blocks: Position[] = [];

  for (let blockY: number = 0; blockY < landValue.height; blockY++) {
    for (let blockX: number = 0; blockX < landValue.width; blockX++) {
      const centre: Position = blockCentre(landValue, blockX, blockY);

      if (landValue.get(blockX, blockY) > 0 &&
          !stations.some((station: Position): boolean =>
            covers(station, centre))) {
        blocks.push({ x: blockX, y: blockY });
      }
    }
  }

  return blocks;
}

function stationsOf(view: CityView, tile: number): Position[] {
  return view.zones.filter((zone: ZoneView): boolean => zone.tile === tile);
}

/* Rule 4: with crime above the threshold, a police station next to a road
 * near the developed block with the most crime that no station covers. It
 * tries the CRIME_BLOCKS_TRIED worst blocks, the one higher up and then
 * further left first on a tie, and only sites that would cover the block. */
function buildPolice(view: CityView, plan: TurnPlan): Choice | null {
  if (plan.done.has('police') ||
      view.state.problems.crime <= CRIME_THRESHOLD) {
    return null;
  }

  const crime: BlockMapView = view.blockMaps.crime;
  const blocks: Position[] = uncoveredBlocks(view,
    stationsOf(view, POLICESTATION))
    .filter((block: Position): boolean => crime.get(block.x, block.y) > 0)
    .sort((first: Position, second: Position): number =>
      crime.get(second.x, second.y) - crime.get(first.x, first.y) ||
      first.y - second.y || first.x - second.x)
    .slice(0, CRIME_BLOCKS_TRIED);

  for (const block of blocks) {
    const target: Position = blockCentre(crime, block.x, block.y);
    const centres: Position[] = roadSites(view, plan, ZONE_SIZE).filter(
      (centre: Position): boolean => covers(centre, target));
    const choice: Choice | null = buildNear(view, plan, 'police', 'police',
      ZONE_SIZE, centres, target);

    if (plan.outOfMoney) {
      return null;
    }

    if (choice !== null) {
      return { ...choice, once: 'police' };
    }
  }

  return null;
}

/* Rule 5: a fire station next to a road where it covers the most developed
 * blocks that no station covers, if that is at least FIRE_MIN_BLOCKS. Ties
 * go to the site closer to the city centre. */
function buildFireStation(view: CityView, plan: TurnPlan): Choice | null {
  if (plan.done.has('fire')) {
    return null;
  }

  const landValue: BlockMapView = view.blockMaps.landValue;
  const uncovered: Position[] = uncoveredBlocks(view,
    stationsOf(view, FIRESTATION))
    .map((block: Position): Position =>
      blockCentre(landValue, block.x, block.y));

  if (uncovered.length < FIRE_MIN_BLOCKS) {
    return null;
  }

  const sites: CoveredSite[] = roadSites(view, plan, ZONE_SIZE)
    .filter((centre: Position): boolean =>
      isOpenSite(view, plan, centre, ZONE_SIZE))
    .map((centre: Position): CoveredSite => ({
      centre: centre,
      covered: uncovered.filter((block: Position): boolean =>
        covers(centre, block)).length,
    }))
    .filter((site: CoveredSite): boolean => site.covered >= FIRE_MIN_BLOCKS)
    .sort((first: CoveredSite, second: CoveredSite): number =>
      second.covered - first.covered ||
      compareDistance(first.centre, second.centre, plan.centre));

  for (const site of sites) {
    const choice: Choice | null = buildNear(view, plan, 'fire-station',
      'fire', ZONE_SIZE, [site.centre], site.centre);

    if (plan.outOfMoney) {
      return null;
    }

    if (choice !== null) {
      return { ...choice, once: 'fire' };
    }
  }

  return null;
}

/* Rule 6: the building that lifts a demand cap, when the census passes the
 * engine's threshold and the city has none: a stadium for residential, an
 * airport for commercial, a seaport for industrial, in that order. It goes
 * on the site next to a road closest to the city centre, and only when the
 * money is there. */
function liftDemandCap(view: CityView, plan: TurnPlan,
    counts: Census): Choice | null {
  if (plan.done.has('capped')) {
    return null;
  }

  const has: (tiles: number[]) => boolean = (tiles: number[]): boolean =>
    view.zones.some((zone: ZoneView): boolean => tiles.includes(zone.tile));
  const needs: { capped: boolean; tool: string; size: number }[] = [
    {
      capped: counts.residential > STADIUM_RESIDENTS &&
        !has([STADIUM, FULLSTADIUM]),
      tool: 'stadium',
      size: 4,
    },
    {
      capped: counts.commercial > AIRPORT_COMMERCE && !has([AIRPORT]),
      tool: 'airport',
      size: 6,
    },
    {
      capped: counts.industrial > SEAPORT_INDUSTRY && !has([PORT]),
      tool: 'port',
      size: 4,
    },
  ];

  for (const need of needs) {
    if (!need.capped) {
      continue;
    }

    const choice: Choice | null = buildNear(view, plan, need.tool, need.tool,
      need.size, roadSites(view, plan, need.size), plan.centre);

    // Saving for these held up all growth for years, so the rule never waits
    if (plan.outOfMoney) {
      plan.outOfMoney = false;
      return null;
    }

    if (choice !== null) {
      return { ...choice, once: 'capped' };
    }
  }

  return null;
}

/* The rank of taxes among the seven problems, 0 for the worst. Ties go to
 * the problem listed first in the state. */
function taxRank(state: CityState): number {
  const values: number[] = Object.values(state.problems);
  const taxes: number = state.problems.taxes;
  const taxIndex: number = Object.keys(state.problems).indexOf('taxes');

  return values.filter((value: number, index: number): boolean =>
    value > taxes || (value === taxes && index < taxIndex)).length;
}

function lastWindow(view: CityView): BudgetWindowRecord | null {
  return view.budgetLog.length === 0 ? null :
    view.budgetLog[view.budgetLog.length - 1];
}

/* The city cannot pay its yearly budget when the last January paid less
 * than full funding, or when the funds and the next taxes fall short of
 * the yearly cost. */
function cannotPay(view: CityView, plan: TurnPlan, counts: Census): boolean {
  const window: BudgetWindowRecord | null = lastWindow(view);
  const shortage: boolean = window !== null &&
    plan.month - monthOf(window.date) < 12 &&
    Math.min(window.road, window.fire, window.police) < 100;

  return shortage ||
    plan.funds + expectedTaxes(view, counts) < yearlyCost(view);
}

/* Rule 7: the tax rate 1 lower when money piles up and taxes are among the
 * worst problems, 1 higher when the city cannot pay its yearly budget,
 * between TAX_MIN and TAX_MAX and at most once a year. */
function adjustTax(view: CityView, plan: TurnPlan, memory: Memory,
    counts: Census): Choice | null {
  const rate: number = view.state.taxRate;

  if (plan.done.has('tax') ||
      plan.month - memory.lastTaxChange < TAX_CHANGE_MONTHS) {
    return null;
  }

  let change: number = 0;

  if (rate < TAX_MIN || (rate < TAX_MAX && cannotPay(view, plan, counts))) {
    change = 1;
  } else if (rate > TAX_MAX || (rate > TAX_MIN &&
      plan.funds - plan.reserve >= PILE_UP_FUNDS &&
      taxRank(view.state) < WORST_PROBLEMS)) {
    change = -1;
  }

  if (change === 0) {
    return null;
  }

  const action: GameAction = { type: 'setTaxRate', rate: rate + change };
  const quote: ActionResult | null = payable(view, plan, action);

  return quote === null ? null : {
    ...choiceOf(change > 0 ? 'raise-tax' : 'lower-tax', action, 0, []),
    once: 'tax',
  };
}

// The zone type with the highest positive demand, residential first on a tie
function demandedZone(state: CityState): ZoneKind | null {
  let best: ZoneKind | null = null;
  let bestDemand: number = 0;

  for (const tool of ZONE_TOOLS) {
    if (state.rci[tool] > bestDemand) {
      best = tool;
      bestDemand = state.rci[tool];
    }
  }

  return best;
}

// The zone types with a positive demand, the highest first
function demandedZones(state: CityState): ZoneKind[] {
  return ZONE_TOOLS.filter((tool: ZoneKind): boolean => state.rci[tool] > 0)
    .sort((first: ZoneKind, second: ZoneKind): number =>
      state.rci[second] - state.rci[first]);
}

/* Rule 8a: a zone on a site the agent cleared in an earlier turn, of the
 * type with the highest demand that may go there. The site waits while no
 * such type is in demand, and is given up once something else is on it. */
function rezone(view: CityView, plan: TurnPlan, memory: Memory): Choice | null {
  for (const index of [...memory.rezone].sort(
    (first: number, second: number): number => first - second)) {
    const centre: Position = positionOf(view.map, index);

    if (plan.taken.has(index)) {
      continue;
    }

    if (!isOpenSite(view, plan, centre, ZONE_SIZE)) {
      memory.rezone.delete(index);
      continue;
    }

    for (const tool of demandedZones(view.state)) {
      const choice: Choice | null = buildNear(view, plan, 'rezone', tool,
        ZONE_SIZE, [centre], centre);

      if (plan.outOfMoney) {
        return null;
      }

      if (choice !== null) {
        return { ...choice, rezoned: index };
      }
    }
  }

  return null;
}

function bulldozeChoice(view: CityView, plan: TurnPlan, rule: string,
    zone: ZoneView): Choice | null {
  const action: GameAction = { type: 'bulldoze', x: zone.x, y: zone.y };
  const quote: ActionResult | null = payable(view, plan, action);

  return quote === null ? null : {
    ...choiceOf(rule, action, quote.cost,
      siteTiles(zone, siteSize(zone.tile))),
    once: 'demolition',
  };
}

/* Rule 8b: a zone that stayed empty with power and a road for
 * EMPTY_ZONE_MONTHS while its type has negative demand and another type
 * is in demand. It is bulldozed now and rezoned next turn, when the quote
 * can see the cleared site. The zone empty the longest goes first. */
function demolishEmptyZone(view: CityView, plan: TurnPlan,
    memory: Memory): Choice | null {
  if (plan.done.has('demolition') || demandedZone(view.state) === null) {
    return null;
  }

  const zones: ZoneView[] = view.zones.filter((zone: ZoneView): boolean => {
    const kind: ZoneKind | null = zoneKind(zone.tile);
    const since: number | undefined =
      memory.emptySince.get(indexOf(view.map, zone.x, zone.y));

    return kind !== null && since !== undefined &&
      plan.month - since >= EMPTY_ZONE_MONTHS && view.state.rci[kind] < 0;
  }).sort((first: ZoneView, second: ZoneView): number =>
    (memory.emptySince.get(indexOf(view.map, first.x, first.y)) ?? 0) -
    (memory.emptySince.get(indexOf(view.map, second.x, second.y)) ?? 0));

  for (const zone of zones) {
    const choice: Choice | null = bulldozeChoice(view, plan,
      'demolish-empty', zone);

    if (plan.outOfMoney) {
      return null;
    }

    if (choice !== null) {
      return { ...choice, demolished: indexOf(view.map, zone.x, zone.y) };
    }
  }

  return null;
}

function plantPower(zone: ZoneView): number {
  if (zone.tile === POWERPLANT) {
    return COAL_POWER;
  }

  return zone.tile === NUCLEAR ? NUCLEAR_POWER : 0;
}

/* Without the plant, the other plants still reach every zone the network
 * reaches now, and they can feed every tile of their network, as the power
 * scan counts it. */
function canRemovePlant(view: CityView, plant: ZoneView,
    network: Set<number>): boolean {
  const others: ZoneView[] = view.zones.filter((zone: ZoneView): boolean =>
    isPowerPlant(zone.tile) && zone !== plant);
  const site: Set<number> = new Set(siteTiles(plant, PLANT_SIZE)
    .map((tile: Position): number => indexOf(view.map, tile.x, tile.y)));
  const without: Set<number> = powerNetwork(view, site);
  const capacity: number = others.reduce(
    (sum: number, zone: ZoneView): number => sum + plantPower(zone), 0);

  return others.some((zone: ZoneView): boolean => zone.powered) &&
    without.size <= capacity &&
    view.zones.every((zone: ZoneView): boolean =>
      zone === plant || isPowerPlant(zone.tile) ||
      !network.has(indexOf(view.map, zone.x, zone.y)) ||
      without.has(indexOf(view.map, zone.x, zone.y)));
}

/* Rule 8c: an industrial zone or a coal plant next to homes, when that
 * cuts neither jobs nor power. Industry goes only while the city keeps a
 * job for every resident without it, as unemployment counts them, and a
 * plant only while other plants have the capacity for the whole network.
 * Zones are taken from the top row down and from left to right. */
function demolishPolluter(view: CityView, plan: TurnPlan, counts: Census,
    network: Set<number>): Choice | null {
  if (plan.done.has('demolition')) {
    return null;
  }

  const homes: Placed[] = view.zones.map(placedOf)
    .filter((site: Placed): boolean => site.residential);

  for (const zone of view.zones) {
    const industry: boolean = zoneKind(zone.tile) === 'industrial';

    if ((!industry && zone.tile !== POWERPLANT) ||
        !homes.some((home: Placed): boolean =>
          isNextTo(placedOf(zone), home))) {
      continue;
    }

    const jobs: number = industry ? zonePopulation(view.map, zone) : 0;
    const allowed: boolean = industry ? jobs === 0 ||
      counts.residential <= 8 * (counts.commercial + counts.industrial - jobs) :
      canRemovePlant(view, zone, network);

    if (!allowed) {
      continue;
    }

    const choice: Choice | null = bulldozeChoice(view, plan,
      'demolish-polluter', zone);

    if (plan.outOfMoney || choice !== null) {
      return choice;
    }
  }

  return null;
}

function zoneNextToRoad(view: CityView, plan: TurnPlan,
    tool: ZoneKind): Choice | null {
  return buildNear(view, plan, 'zone', tool, ZONE_SIZE,
    roadSites(view, plan, ZONE_SIZE), plan.centre);
}

/* The first road, while there is none: from the free tile closest to the
 * city centre, ROAD_LENGTH tiles in the first direction where the next tile
 * is free and the end is free land, once in a turn. */
function buildFirstRoad(view: CityView, plan: TurnPlan): Choice | null {
  const map: MapView = view.map;
  const land: Position[] = [];

  if (plan.done.has('road')) {
    return null;
  }

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      if (isOpenLand(view, plan, { x: x, y: y })) {
        land.push({ x: x, y: y });
      }
    }
  }

  for (const from of sortByDistance(land, plan.centre)) {
    for (const direction of DIRECTIONS) {
      const next: Position = { x: from.x + direction.x,
        y: from.y + direction.y };
      const to: Position = { x: from.x + direction.x * ROAD_LENGTH,
        y: from.y + direction.y * ROAD_LENGTH };

      if (!isPassable(view, plan, next) || !isOpenLand(view, plan, to)) {
        continue;
      }

      if (plan.roadTries >= ROAD_ENDS_TRIED) {
        return null;
      }

      plan.roadTries++;
      const choice: Choice | null = routeChoice(view, plan, 'road', 'road',
        from, to);

      if (plan.outOfMoney || choice !== null) {
        return choice === null ? null : { ...choice, once: 'road' };
      }
    }
  }

  return null;
}

/* Free tiles next to an open zone site that no road touches yet and that
 * can take the zone, the closest to the city centre first. A road that
 * ends on one of them opens that site for the zone. */
function roadTargets(view: CityView, plan: TurnPlan,
    tool: ZoneKind): Position[] {
  const map: MapView = view.map;
  const ends: Position[] = [];

  for (let y: number = 1; y < map.height - 1; y++) {
    for (let x: number = 1; x < map.width - 1; x++) {
      const site: Position = { x: x, y: y };

      if (!isOpenSite(view, plan, site, ZONE_SIZE) ||
          placedFor(view, plan, tool, site, ZONE_SIZE) === null) {
        continue;
      }

      const edges: Position[] = edgeTiles(site, ZONE_SIZE).filter(
        (tile: Position): boolean => isOnMap(map, tile.x, tile.y));

      if (edges.some((tile: Position): boolean =>
          isRoad(map.getTileValue(tile.x, tile.y)))) {
        continue;
      }

      ends.push(...edges.filter((tile: Position): boolean =>
        isOpenLand(view, plan, tile)));
    }
  }

  return sortByDistance(uniqueTiles(map, ends), plan.centre);
}

/* A new road towards land the agent can build on, when no zone site
 * touches a road. It ends on the first tile from roadTargets and starts on
 * the road tile closest to that end, and planRoute finds the way, bridges
 * included. When the route or its quote fails for a reason other than
 * money, the next end is tried, up to ROAD_ENDS_TRIED in a turn. */
function extendRoad(view: CityView, plan: TurnPlan,
    tool: ZoneKind): Choice | null {
  if (plan.roads.length === 0) {
    return buildFirstRoad(view, plan);
  }

  for (const to of roadTargets(view, plan, tool)) {
    if (plan.roadTries >= ROAD_ENDS_TRIED) {
      return null;
    }

    plan.roadTries++;
    const choice: Choice | null = routeChoice(view, plan, 'road', 'road',
      closestTile(plan.roads, to), to);

    if (plan.outOfMoney || choice !== null) {
      return choice;
    }
  }

  return null;
}

/* Rule 9: the zone with the highest positive demand, on the free site next
 * to a road closest to the city centre, or a new road when there is none.
 * Homes stay away from industry and plants, as placedFor says. */
function grow(view: CityView, plan: TurnPlan): Choice | null {
  const tool: ZoneKind | null = demandedZone(view.state);

  if (tool === null) {
    return null;
  }

  const zone: Choice | null = zoneNextToRoad(view, plan, tool);

  if (zone !== null || plan.outOfMoney) {
    return zone;
  }

  return extendRoad(view, plan, tool);
}

function commit(view: CityView, plan: TurnPlan, memory: Memory,
    choice: Choice): void {
  plan.actions.push(choice.action);
  plan.rules.push(choice.rule);
  plan.funds -= choice.cost;

  for (const tile of choice.tiles) {
    plan.taken.add(indexOf(view.map, tile.x, tile.y));
  }

  if (choice.wiredZone !== null) {
    plan.wired.add(choice.wiredZone);
  }

  if (choice.placed !== null) {
    plan.placed.push(choice.placed);
  }

  if (choice.once !== null) {
    plan.done.add(choice.once);
  }

  if (choice.rezoned !== null) {
    memory.rezone.delete(choice.rezoned);
  }

  if (choice.demolished !== null) {
    memory.rezone.add(choice.demolished);
    memory.emptySince.delete(choice.demolished);
  }

  if (choice.action.type === 'setTaxRate') {
    memory.lastTaxChange = plan.month;
  }
}

/* A rule-based agent. Each turn, up to the action limit and while the
 * money lasts, it plays the first of its rules that fits, then checks them
 * again: power, the budget, road repairs, police, fire stations, capped
 * demand, taxes, demolition and growth. It keeps a reserve for the next
 * yearly budget. A rule that fits but costs more than the money above the
 * reserve makes the agent wait: the rest of the turn plays only the free
 * rules, the budget and the taxes. It draws no random numbers, and routes
 * only get their two ends from it, the route itself comes from planRoute. */
function createRulesAgent(): Agent {
  const memory: Memory = {
    roads: new Set(),
    emptySince: new Map(),
    rezone: new Set(),
    lastTaxChange: -Infinity,
  };
  let report: Record<string, unknown> = {};

  return {
    name: 'rules',
    settings: (): Record<string, unknown> => ({
      reserveMargin: RESERVE_MARGIN,
      crimeThreshold: CRIME_THRESHOLD,
      coverageRadius: COVERAGE_RADIUS,
      fireMinBlocks: FIRE_MIN_BLOCKS,
      pileUpFunds: PILE_UP_FUNDS,
      worstProblems: WORST_PROBLEMS,
      taxMin: TAX_MIN,
      taxMax: TAX_MAX,
      emptyZoneMonths: EMPTY_ZONE_MONTHS,
      nextToGap: NEXT_TO_GAP,
    }),
    report: (): Record<string, unknown> => report,
    decide: (view: CityView): GameAction[] => {
      const month: number = monthOf(view.state.date);

      remember(view, memory, month);

      const reserve: number =
        Math.ceil(yearlyCost(view) * (1 + RESERVE_MARGIN));
      const plan: TurnPlan = {
        month: month,
        funds: view.state.funds,
        reserve: reserve,
        centre: cityCentre(view),
        roads: roadTiles(view.map),
        roadSites: new Map(),
        taken: new Set(),
        brokenRoads: brokenRoads(view, memory),
        roadEnds: tilesPastRoadEnds(view.map),
        wired: new Set(),
        placed: [],
        done: new Set(),
        roadTries: 0,
        outOfMoney: false,
        actions: [],
        rules: [],
      };
      const network: Set<number> = powerNetwork(view);
      const joins: Position[] = powerJoins(view, network);
      const counts: Census = census(view);
      const rules: Rule[] = [
        { free: false, run: (): Choice | null => buildFirstPlant(view, plan) },
        {
          free: false,
          run: (): Choice | null => connectZone(view, plan, network, joins),
        },
        {
          free: false,
          run: (): Choice | null => buildExtraPlant(view, plan, network),
        },
        { free: true, run: (): Choice | null => restoreFunding(view, plan) },
        { free: true, run: (): Choice | null => restoreAutoBudget(view, plan) },
        { free: false, run: (): Choice | null => repairRoad(view, plan) },
        { free: false, run: (): Choice | null => buildPolice(view, plan) },
        { free: false, run: (): Choice | null => buildFireStation(view, plan) },
        {
          free: false,
          run: (): Choice | null => liftDemandCap(view, plan, counts),
        },
        {
          free: true,
          run: (): Choice | null => adjustTax(view, plan, memory, counts),
        },
        { free: false, run: (): Choice | null => rezone(view, plan, memory) },
        {
          free: false,
          run: (): Choice | null => demolishEmptyZone(view, plan, memory),
        },
        {
          free: false,
          run: (): Choice | null =>
            demolishPolluter(view, plan, counts, network),
        },
        { free: false, run: (): Choice | null => grow(view, plan) },
      ];

      while (plan.actions.length < view.maxActions) {
        let choice: Choice | null = null;

        for (const rule of rules) {
          if (plan.outOfMoney && !rule.free) {
            continue;
          }

          choice = rule.run();

          if (choice !== null) {
            break;
          }
        }

        if (choice === null) {
          break;
        }

        commit(view, plan, memory, choice);
      }

      report = {
        rules: plan.rules,
        reserve: reserve,
        waitingForMoney: plan.outOfMoney,
      };
      return plan.actions;
    },
  };
}

export { createRulesAgent };
