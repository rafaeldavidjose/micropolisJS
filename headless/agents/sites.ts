import type { CityView, MapView, Position, ZoneView } from '../types.ts';
import { conducts, isBuilding, isFreeLand, isPowerPlant, isRoad, siteSize }
  from './tiles.ts';

/* What the agents work out from the map in their view: tiles and sites,
 * distances and their ties, road ends, the city centre and the power
 * network. */

// East, south, west, north: the order directions are tried in
const DIRECTIONS: readonly Position[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function indexOf(map: MapView, x: number, y: number): number {
  return y * map.width + x;
}

function positionOf(map: MapView, index: number): Position {
  return { x: index % map.width, y: Math.floor(index / map.width) };
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

// Every road tile, from the top row down and from left to right
function roadTiles(map: MapView): Position[] {
  const roads: Position[] = [];

  for (let y: number = 0; y < map.height; y++) {
    for (let x: number = 0; x < map.width; x++) {
      if (isRoad(map.getTileValue(x, y))) {
        roads.push({ x: x, y: y });
      }
    }
  }

  return roads;
}

// The tile straight past every road tile that has a single road neighbour
function tilesPastRoadEnds(map: MapView): Set<number> {
  const past: Set<number> = new Set();

  for (const road of roadTiles(map)) {
    const neighbours: Position[] = DIRECTIONS.filter(
      (direction: Position): boolean =>
        isOnMap(map, road.x + direction.x, road.y + direction.y) &&
        isRoad(map.getTileValue(road.x + direction.x,
          road.y + direction.y)));

    if (neighbours.length === 1 &&
        isOnMap(map, road.x - neighbours[0].x, road.y - neighbours[0].y)) {
      past.add(indexOf(map, road.x - neighbours[0].x,
        road.y - neighbours[0].y));
    }
  }

  return past;
}

function mapCentre(map: MapView): Position {
  return { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
}

// The centre of the zones and buildings, or of the map before there are any
function cityCentre(view: CityView): Position {
  if (view.zones.length === 0) {
    return mapCentre(view.map);
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
 * limit on how many tiles a plant can feed. Tiles in blocked conduct
 * nothing, which shows what a network would be without them. */
function powerNetwork(view: CityView,
    blocked: Set<number> = new Set()): Set<number> {
  const map: MapView = view.map;
  const reached: Set<number> = new Set();
  const queue: Position[] = [];

  for (const zone of view.zones) {
    if (!isPowerPlant(zone.tile)) {
      continue;
    }

    for (const tile of siteTiles(zone, siteSize(zone.tile))) {
      const index: number = indexOf(map, tile.x, tile.y);

      if (isOnMap(map, tile.x, tile.y) && !blocked.has(index)) {
        reached.add(index);
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
          !blocked.has(indexOf(map, x, y)) &&
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
    const tile: Position = positionOf(map, index);

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

export {
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
};
