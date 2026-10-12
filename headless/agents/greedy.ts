import type {
  ActionResult,
  Agent,
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
  conducts,
  isBuilding,
  isFreeLand,
  isPowerPlant,
  isRoad,
  siteSize,
} from './tiles.ts';

type ZoneTool = 'residential' | 'commercial' | 'industrial';

const ZONE_TOOLS: readonly ZoneTool[] = [
  'residential',
  'commercial',
  'industrial',
];

const ZONE_SIZE: number = 3;
const PLANT_SIZE: number = 4;

// The first road runs this far over free land, room for two zones a side
const ROAD_LENGTH: number = 6;

// How many road ends are tried in a turn, each one a full route search
const ROAD_ENDS_TRIED: number = 20;

// East, south, west, north: the order directions are tried in
const DIRECTIONS: readonly Position[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/* The view stays as it was at the start of the turn, so the plan keeps
 * what earlier actions of the turn already promised: money, tiles, wired
 * zones, a new plant and a new road, and how many road ends it tried.
 * Buildings also stay off the tile past the end of each road. */
interface TurnPlan {
  funds: number;
  taken: Set<number>;
  roadEnds: Set<number>;
  wired: Set<number>;
  plantBuilt: boolean;
  roadBuilt: boolean;
  roadTries: number;
  outOfMoney: boolean;
  actions: GameAction[];
  rules: number[];
}

interface Choice {
  rule: number;
  action: GameAction;
  cost: number;
  tiles: Position[];
  wiredZone: number | null;
}

function indexOf(map: MapView, x: number, y: number): number {
  return y * map.width + x;
}

function isOnMap(map: MapView, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

function distanceSquared(from: Position, to: Position): number {
  return (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
}

/* Orders tiles by straight-line distance to a target, the closest first.
 * Ties go to the tile higher up the map, then to the one further left. */
function compareDistance(first: Position, second: Position,
    target: Position): number {
  return distanceSquared(first, target) - distanceSquared(second, target) ||
    first.y - second.y || first.x - second.x;
}

function sortByDistance<Tile extends Position>(tiles: Tile[],
    target: Position): Tile[] {
  return tiles.sort((first: Tile, second: Tile): number =>
    compareDistance(first, second, target));
}

function closestTile(tiles: Position[], target: Position): Position {
  return tiles.reduce((best: Position, tile: Position): Position =>
    compareDistance(tile, best, target) < 0 ? tile : best);
}

// A site is placed by its centre tile, one right of and below its corner
function siteTiles(centre: Position, size: number): Position[] {
  const tiles: Position[] = [];

  for (let dy: number = -1; dy < size - 1; dy++) {
    for (let dx: number = -1; dx < size - 1; dx++) {
      tiles.push({ x: centre.x + dx, y: centre.y + dy });
    }
  }

  return tiles;
}

// The tiles that share an edge with a site, without its corners
function edgeTiles(centre: Position, size: number): Position[] {
  const left: number = centre.x - 1;
  const top: number = centre.y - 1;
  const tiles: Position[] = [];

  for (let offset: number = 0; offset < size; offset++) {
    tiles.push({ x: left + offset, y: top - 1 });
    tiles.push({ x: left + offset, y: top + size });
    tiles.push({ x: left - 1, y: top + offset });
    tiles.push({ x: left + size, y: top + offset });
  }

  return tiles;
}

// The centres of the sites of a size that have the tile along an edge
function centresTouching(tile: Position, size: number): Position[] {
  const centres: Position[] = [];

  for (let offset: number = -size + 2; offset <= 1; offset++) {
    centres.push({ x: tile.x + 2, y: tile.y + offset });
    centres.push({ x: tile.x - size + 1, y: tile.y + offset });
    centres.push({ x: tile.x + offset, y: tile.y + 2 });
    centres.push({ x: tile.x + offset, y: tile.y - size + 1 });
  }

  return centres;
}

function uniqueTiles(map: MapView, tiles: Position[]): Position[] {
  const seen: Set<number> = new Set();

  return tiles.filter((tile: Position): boolean => {
    const index: number = indexOf(map, tile.x, tile.y);

    if (!isOnMap(map, tile.x, tile.y) || seen.has(index)) {
      return false;
    }

    seen.add(index);
    return true;
  });
}

function isOpenLand(view: CityView, plan: TurnPlan, tile: Position): boolean {
  return isOnMap(view.map, tile.x, tile.y) &&
    !plan.taken.has(indexOf(view.map, tile.x, tile.y)) &&
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

// The tile straight past every road tile that has a single road neighbour
function tilesPastRoadEnds(map: MapView): Set<number> {
  const past: Set<number> = new Set();

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      if (!isRoad(map.getTileValue(x, y))) {
        continue;
      }

      const neighbours: Position[] = DIRECTIONS.filter(
        (direction: Position): boolean =>
          isOnMap(map, x + direction.x, y + direction.y) &&
          isRoad(map.getTileValue(x + direction.x, y + direction.y)));

      if (neighbours.length === 1 &&
          isOnMap(map, x - neighbours[0].x, y - neighbours[0].y)) {
        past.add(indexOf(map, x - neighbours[0].x, y - neighbours[0].y));
      }
    }
  }

  return past;
}

// The centre of the zones and buildings, or of the map before there are any
function cityCentre(view: CityView): Position {
  if (view.zones.length === 0) {
    return { x: (view.map.width - 1) / 2, y: (view.map.height - 1) / 2 };
  }

  const total: Position = view.zones.reduce(
    (sum: Position, zone: ZoneView): Position =>
      ({ x: sum.x + zone.x, y: sum.y + zone.y }), { x: 0, y: 0 });

  return {
    x: total.x / view.zones.length,
    y: total.y / view.zones.length,
  };
}

/* The tiles power can reach from the plants: their sites and every
 * conducting tile joined to them, as in the power scan but without its
 * limit on how many tiles a plant can feed. */
function powerNetwork(view: CityView): Set<number> {
  const map: MapView = view.map;
  const reached: Set<number> = new Set();
  const queue: Position[] = [];

  for (const zone of view.zones) {
    if (!isPowerPlant(zone.tile)) {
      continue;
    }

    for (const tile of siteTiles(zone, siteSize(zone.tile))) {
      if (isOnMap(map, tile.x, tile.y)) {
        reached.add(indexOf(map, tile.x, tile.y));
        queue.push(tile);
      }
    }
  }

  while (queue.length > 0) {
    const tile: Position = queue.pop() as Position;

    for (const direction of DIRECTIONS) {
      const x: number = tile.x + direction.x;
      const y: number = tile.y + direction.y;

      if (isOnMap(map, x, y) && !reached.has(indexOf(map, x, y)) &&
          conducts(map.getTileValue(x, y))) {
        reached.add(indexOf(map, x, y));
        queue.push({ x: x, y: y });
      }
    }
  }

  return reached;
}

/* Where a new power line can take power from the network: on one of its
 * power lines, or on free land next to it. */
function powerJoins(view: CityView, network: Set<number>): Position[] {
  const map: MapView = view.map;
  const joins: Position[] = [];

  for (const index of network) {
    const tile: Position = { x: index % map.width,
      y: Math.floor(index / map.width) };

    if (!isBuilding(map.getTileValue(tile.x, tile.y))) {
      joins.push(tile);
    }

    for (const direction of DIRECTIONS) {
      const x: number = tile.x + direction.x;
      const y: number = tile.y + direction.y;

      if (isOnMap(map, x, y) && !network.has(indexOf(map, x, y)) &&
          isFreeLand(map.getTileValue(x, y))) {
        joins.push({ x: x, y: y });
      }
    }
  }

  return uniqueTiles(map, joins);
}

function zoneIndex(map: MapView, zone: ZoneView): number {
  return indexOf(map, zone.x, zone.y);
}

/* The quote of an action the turn can still pay for, or null. When the
 * money is short the turn ends: the agent waits until it can pay. */
function payable(view: CityView, plan: TurnPlan,
    action: GameAction): ActionResult | null {
  const quote: ActionResult = view.quote(action);

  if (quote.success && quote.cost <= plan.funds) {
    return quote;
  }

  if (quote.success || quote.reason === 'insufficient-funds') {
    plan.outOfMoney = true;
  }

  return null;
}

// The first free site from the centres, taken by distance to the target
function buildNear(view: CityView, plan: TurnPlan, rule: number,
    tool: string, size: number, centres: Position[],
    target: Position): Choice | null {
  for (const centre of sortByDistance(centres, target)) {
    if (!isOpenSite(view, plan, centre, size)) {
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
        rule: rule,
        action: action,
        cost: quote.cost,
        tiles: siteTiles(centre, size),
        wiredZone: null,
      };
    }
  }

  return null;
}

function routeChoice(view: CityView, plan: TurnPlan, rule: number,
    tool: string, from: Position, to: Position): Choice | null {
  const action: GameAction = { type: 'route', tool: tool, from: from, to: to };
  const quote: ActionResult | null = payable(view, plan, action);

  if (quote === null) {
    return null;
  }

  const route: RoutePlan = view.planRoute(tool, from, to);

  return {
    rule: rule,
    action: action,
    cost: quote.cost,
    tiles: route.tiles.map((tile: RouteTile): Position =>
      ({ x: tile.x, y: tile.y })),
    wiredZone: null,
  };
}

// Rule 1: with no power plant, a coal plant closest to the centre of the map
function buildFirstPlant(view: CityView, plan: TurnPlan): Choice | null {
  if (plan.plantBuilt ||
      view.zones.some((zone: ZoneView): boolean => isPowerPlant(zone.tile))) {
    return null;
  }

  const centres: Position[] = [];

  for (let y: number = 1; y <= view.map.height - PLANT_SIZE + 1; y++) {
    for (let x: number = 1; x <= view.map.width - PLANT_SIZE + 1; x++) {
      centres.push({ x: x, y: y });
    }
  }

  const mapCentre: Position = {
    x: (view.map.width - 1) / 2,
    y: (view.map.height - 1) / 2,
  };

  return buildNear(view, plan, 1, 'coal', PLANT_SIZE, centres, mapCentre);
}

/* Rule 2: a power line to the zone without power closest to the city
 * centre, among those the network does not reach. It runs from the join
 * closest to the zone to the tile next to the zone closest to that join. */
function connectZone(view: CityView, plan: TurnPlan, network: Set<number>,
    joins: Position[], centre: Position): Choice | null {
  const map: MapView = view.map;
  const unconnected: ZoneView[] = view.zones.filter(
    (zone: ZoneView): boolean => !zone.powered && !isPowerPlant(zone.tile) &&
      !network.has(zoneIndex(map, zone)) &&
      !plan.wired.has(zoneIndex(map, zone)));
  const isKept: (tile: Position) => boolean = (tile: Position): boolean =>
    plan.taken.has(indexOf(map, tile.x, tile.y)) ||
    plan.roadEnds.has(indexOf(map, tile.x, tile.y));
  const openJoins: Position[] = joins.filter((tile: Position): boolean =>
    !isKept(tile));

  if (openJoins.length === 0) {
    return null;
  }

  for (const zone of sortByDistance(unconnected, centre)) {
    const from: Position = sortByDistance([...openJoins], zone)[0];
    const ends: Position[] = edgeTiles(zone, siteSize(zone.tile))
      .filter((tile: Position): boolean => isOnMap(map, tile.x, tile.y) &&
        !isKept(tile) && !isBuilding(map.getTileValue(tile.x, tile.y)));

    for (const to of sortByDistance(ends, from)) {
      const choice: Choice | null = routeChoice(view, plan, 2, 'wire', from,
        to);

      if (plan.outOfMoney) {
        return null;
      }

      if (choice !== null) {
        return { ...choice, wiredZone: zoneIndex(map, zone) };
      }
    }
  }

  return null;
}

/* Rule 3: zones the network reaches still have no power, so its plants
 * cannot feed them all. Another coal plant goes next to the network,
 * before any growth, since new zones would only share the same power. */
function buildExtraPlant(view: CityView, plan: TurnPlan,
    network: Set<number>, centre: Position): Choice | null {
  const map: MapView = view.map;
  const starved: boolean = view.zones.some((zone: ZoneView): boolean =>
    !zone.powered && !isPowerPlant(zone.tile) &&
    network.has(zoneIndex(map, zone)));

  if (plan.plantBuilt || !starved) {
    return null;
  }

  const centres: Position[] = [];

  for (const index of network) {
    const tile: Position = { x: index % map.width,
      y: Math.floor(index / map.width) };
    centres.push(...centresTouching(tile, PLANT_SIZE));
  }

  return buildNear(view, plan, 3, 'coal', PLANT_SIZE,
    uniqueTiles(map, centres), centre);
}

// The zone with the highest positive demand, residential first on a tie
function demandedZone(state: CityState): ZoneTool | null {
  let best: ZoneTool | null = null;
  let bestDemand: number = 0;

  for (const tool of ZONE_TOOLS) {
    if (state.rci[tool] > bestDemand) {
      best = tool;
      bestDemand = state.rci[tool];
    }
  }

  return best;
}

function zoneNextToRoad(view: CityView, plan: TurnPlan, tool: ZoneTool,
    centre: Position): Choice | null {
  const map: MapView = view.map;
  const centres: Position[] = [];

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      if (isRoad(map.getTileValue(x, y))) {
        centres.push(...centresTouching({ x: x, y: y }, ZONE_SIZE));
      }
    }
  }

  return buildNear(view, plan, 4, tool, ZONE_SIZE, uniqueTiles(map, centres),
    centre);
}

/* The first road, while there is none: from the free tile closest to the
 * city centre, ROAD_LENGTH tiles in the first direction where the next tile
 * is free and the end is free land, once in a turn. */
function buildFirstRoad(view: CityView, plan: TurnPlan,
    centre: Position): Choice | null {
  const map: MapView = view.map;
  const land: Position[] = [];

  if (plan.roadBuilt) {
    return null;
  }

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      if (isOpenLand(view, plan, { x: x, y: y })) {
        land.push({ x: x, y: y });
      }
    }
  }

  for (const from of sortByDistance(land, centre)) {
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
      const choice: Choice | null = routeChoice(view, plan, 4, 'road', from,
        to);

      if (plan.outOfMoney || choice !== null) {
        return choice;
      }
    }
  }

  return null;
}

/* Free tiles next to an open zone site that no road touches yet, the
 * closest to the city centre first. A road that ends on one of them opens
 * that site for a zone. */
function roadTargets(view: CityView, plan: TurnPlan,
    centre: Position): Position[] {
  const map: MapView = view.map;
  const ends: Position[] = [];

  for (let y: number = 1; y < map.height - 1; y++) {
    for (let x: number = 1; x < map.width - 1; x++) {
      const site: Position = { x: x, y: y };

      if (!isOpenSite(view, plan, site, ZONE_SIZE)) {
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

  return sortByDistance(uniqueTiles(map, ends), centre);
}

/* A new road towards land the agent can build on, when no zone site
 * touches a road. It ends on the first tile from roadTargets and starts on
 * the road tile closest to that end, and planRoute finds the way, bridges
 * included. When the route or its quote fails for a reason other than
 * money, the next end is tried, up to ROAD_ENDS_TRIED in a turn. */
function extendRoad(view: CityView, plan: TurnPlan,
    centre: Position): Choice | null {
  const map: MapView = view.map;
  const roads: Position[] = [];

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      if (isRoad(map.getTileValue(x, y))) {
        roads.push({ x: x, y: y });
      }
    }
  }

  if (roads.length === 0) {
    return buildFirstRoad(view, plan, centre);
  }

  for (const to of roadTargets(view, plan, centre)) {
    if (plan.roadTries >= ROAD_ENDS_TRIED) {
      return null;
    }

    plan.roadTries++;
    const choice: Choice | null = routeChoice(view, plan, 4, 'road',
      closestTile(roads, to), to);

    if (plan.outOfMoney || choice !== null) {
      return choice;
    }
  }

  return null;
}

/* Rule 4: the zone with the highest positive demand, on the free site next
 * to a road closest to the city centre, or a new road when there is none. */
function grow(view: CityView, plan: TurnPlan,
    centre: Position): Choice | null {
  const tool: ZoneTool | null = demandedZone(view.state);

  if (tool === null) {
    return null;
  }

  const zone: Choice | null = zoneNextToRoad(view, plan, tool, centre);

  if (zone !== null || plan.outOfMoney) {
    return zone;
  }

  return extendRoad(view, plan, centre);
}

function commit(view: CityView, plan: TurnPlan, choice: Choice): void {
  plan.actions.push(choice.action);
  plan.rules.push(choice.rule);
  plan.funds -= choice.cost;

  for (const tile of choice.tiles) {
    plan.taken.add(indexOf(view.map, tile.x, tile.y));
  }

  if (choice.wiredZone !== null) {
    plan.wired.add(choice.wiredZone);
  }

  if (choice.action.type === 'build' && choice.action.tool === 'coal') {
    plan.plantBuilt = true;
  }

  if (choice.action.type === 'route' && choice.action.tool === 'road') {
    plan.roadBuilt = true;
  }
}

/* A greedy baseline. Each turn, up to the action limit and while the money
 * lasts, it plays the first of four rules that fits, then checks them
 * again: a first power plant, power for an unconnected zone, another plant
 * when the network is overloaded, and a zone for the highest demand.
 * It ignores crime, fire, pollution, taxes and the budget, and draws no
 * random numbers. Routes only get their two ends from it, the route
 * itself comes from planRoute. */
function createGreedyAgent(): Agent {
  let report: Record<string, unknown> = {};

  return {
    name: 'greedy',
    settings: (): Record<string, unknown> => ({
      firstRoadLength: ROAD_LENGTH,
      roadEndsTried: ROAD_ENDS_TRIED,
    }),
    report: (): Record<string, unknown> => report,
    decide: (view: CityView): GameAction[] => {
      const plan: TurnPlan = {
        funds: view.state.funds,
        taken: new Set(),
        roadEnds: tilesPastRoadEnds(view.map),
        wired: new Set(),
        plantBuilt: false,
        roadBuilt: false,
        roadTries: 0,
        outOfMoney: false,
        actions: [],
        rules: [],
      };
      const network: Set<number> = powerNetwork(view);
      const joins: Position[] = powerJoins(view, network);
      const centre: Position = cityCentre(view);
      const rules: (() => Choice | null)[] = [
        (): Choice | null => buildFirstPlant(view, plan),
        (): Choice | null => connectZone(view, plan, network, joins, centre),
        (): Choice | null => buildExtraPlant(view, plan, network, centre),
        (): Choice | null => grow(view, plan, centre),
      ];

      while (plan.actions.length < view.maxActions && !plan.outOfMoney) {
        let choice: Choice | null = null;

        for (const rule of rules) {
          choice = rule();

          if (choice !== null || plan.outOfMoney) {
            break;
          }
        }

        if (choice === null) {
          break;
        }

        commit(view, plan, choice);
      }

      report = { rules: plan.rules, waitingForMoney: plan.outOfMoney };
      return plan.actions;
    },
  };
}

export { createGreedyAgent };
