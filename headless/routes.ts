import { getMap, getPendingCost, getTools } from './engine.ts';
import { TileUtils } from '../src/tileUtils.js';
import * as TileValues from '../src/tileValues.ts';
import type {
  ActionFailure,
  ActionResult,
  MapLike,
  Position,
  RoutePlan,
  RouteTile,
  RouteTileKind,
  SimulationLike,
  TileLike,
  ToolLike,
} from './types.ts';

// A tile as a bridge sees it when it looks at its neighbours
interface Piece {
  value: number;
  conductive: boolean;
}

type Side = 'east' | 'west' | 'south' | 'north';

/* What one tool does to a tile, copied from layRoad, layRail and layWire in
 * src/roadTool.js, src/railTool.js and src/wireTool.js. Values are
 * normalized with TileUtils.normalizeRoad, as the tools do. */
interface ToolRules {
  landCost: number;
  bridgeCost: number;
  // The piece laid on bare land or across an existing line
  onLand: Map<number, number>;
  // The tile already has this kind, so the route uses it for free
  hasKind(value: number): boolean;
  // A neighbour on this side lets the tool lay a bridge
  bridgesFrom(side: Side, piece: Piece): boolean;
  horizontalBridge: number;
  verticalBridge: number;
}

// The result of laying one route tile
interface Step {
  cost: number;
  kind: RouteTileKind;
  piece: Piece;
  axis: number;
}

interface PathTile {
  x: number;
  y: number;
  state: number;
  step: Step;
}

interface QueueEntry {
  cost: number;
  length: number;
  order: number;
  state: number;
}

interface LaidRoute {
  costs: number[];
  failedAt: number | null;
}

// A bridge runs one way, everything else connects in all four directions
const NO_AXIS: number = 0;
const HORIZONTAL: number = 1;
const VERTICAL: number = 2;
const STATES_PER_TILE: number = 3;

// A path the engine refuses is banned and searched again, this many times
const MAX_ATTEMPTS: number = 20;

// The order layRoad, layRail and layWire check the neighbours of water
const SIDES: readonly [Side, number, number][] = [
  ['east', 1, 0],
  ['west', -1, 0],
  ['south', 0, 1],
  ['north', 0, -1],
];

function normalize(value: number): number {
  return TileUtils.normalizeRoad(value);
}

function carriesPower(value: number): boolean {
  return (value >= TileValues.HPOWER && value <= TileValues.RAILVPOWERH) ||
    value === TileValues.HROADPOWER || value === TileValues.VROADPOWER;
}

const ROAD_RULES: ToolRules = {
  landCost: 10,
  bridgeCost: 50,
  onLand: new Map([
    [TileValues.DIRT, TileValues.ROADS],
    [TileValues.LHPOWER, TileValues.VROADPOWER],
    [TileValues.LVPOWER, TileValues.HROADPOWER],
    [TileValues.LHRAIL, TileValues.HRAILROAD],
    [TileValues.LVRAIL, TileValues.VRAILROAD],
  ]),
  hasKind: (value: number): boolean =>
    (value >= TileValues.HBRIDGE && value <= TileValues.VROADPOWER) ||
    value === TileValues.HRAILROAD || value === TileValues.VRAILROAD,
  // The east side also takes HROADPOWER and the west side does not
  bridgesFrom: (side: Side, piece: Piece): boolean => {
    const value: number = normalize(piece.value);

    if (side === 'east') {
      return value === TileValues.VRAILROAD || value === TileValues.HBRIDGE ||
        (value >= TileValues.ROADS && value <= TileValues.HROADPOWER);
    }

    if (side === 'west') {
      return value === TileValues.VRAILROAD || value === TileValues.HBRIDGE ||
        (value >= TileValues.ROADS && value <= TileValues.INTERSECTION);
    }

    return value === TileValues.HRAILROAD ||
      value === TileValues.VROADPOWER ||
      (value >= TileValues.VBRIDGE && value <= TileValues.INTERSECTION);
  },
  horizontalBridge: TileValues.HBRIDGE,
  verticalBridge: TileValues.VBRIDGE,
};

const RAIL_RULES: ToolRules = {
  landCost: 20,
  bridgeCost: 100,
  onLand: new Map([
    [TileValues.DIRT, TileValues.LHRAIL],
    [TileValues.LHPOWER, TileValues.RAILVPOWERH],
    [TileValues.LVPOWER, TileValues.RAILHPOWERV],
    [TileValues.ROADS, TileValues.VRAILROAD],
    [TileValues.ROADS2, TileValues.HRAILROAD],
  ]),
  hasKind: (value: number): boolean =>
    value === TileValues.RAILHPOWERV || value === TileValues.RAILVPOWERH ||
    (value >= TileValues.HRAIL && value <= TileValues.VRAILROAD),
  bridgesFrom: (side: Side, piece: Piece): boolean => {
    const value: number = normalize(piece.value);

    if (side === 'east') {
      return value === TileValues.RAILHPOWERV || value === TileValues.HRAIL ||
        (value >= TileValues.LHRAIL && value <= TileValues.HRAILROAD);
    }

    if (side === 'west') {
      return value === TileValues.RAILHPOWERV || value === TileValues.HRAIL ||
        (value > TileValues.VRAIL && value < TileValues.VRAILROAD);
    }

    return value === TileValues.RAILVPOWERH ||
      value === TileValues.VRAILROAD ||
      (value > TileValues.HRAIL && value < TileValues.HRAILROAD);
  },
  horizontalBridge: TileValues.HRAIL,
  verticalBridge: TileValues.VRAIL,
};

// Under water, VPOWER runs east to west and HPOWER north to south
const WIRE_RULES: ToolRules = {
  landCost: 5,
  bridgeCost: 25,
  onLand: new Map([
    [TileValues.DIRT, TileValues.LHPOWER],
    [TileValues.ROADS, TileValues.HROADPOWER],
    [TileValues.ROADS2, TileValues.VROADPOWER],
    [TileValues.LHRAIL, TileValues.RAILHPOWERV],
    [TileValues.LVRAIL, TileValues.RAILVPOWERH],
  ]),
  hasKind: carriesPower,
  bridgesFrom: (side: Side, piece: Piece): boolean => {
    const value: number = normalize(piece.value);

    if (!piece.conductive) {
      return false;
    }

    if (side === 'east' || side === 'west') {
      return value !== TileValues.HROADPOWER &&
        value !== TileValues.RAILHPOWERV && value !== TileValues.HPOWER;
    }

    return value !== TileValues.VROADPOWER &&
      value !== TileValues.RAILVPOWERH && value !== TileValues.VPOWER;
  },
  horizontalBridge: TileValues.VPOWER,
  verticalBridge: TileValues.HPOWER,
};

const RULES: Record<string, ToolRules> = {
  road: ROAD_RULES,
  rail: RAIL_RULES,
  wire: WIRE_RULES,
};

const ROUTE_TOOLS: readonly string[] = Object.keys(RULES);

// The tile has a piece of the tool's kind, which a route takes as it is
function hasPiece(toolName: string, value: number): boolean {
  const rules: ToolRules | undefined = RULES[toolName];

  return rules !== undefined && rules.hasKind(normalize(value));
}

function failedPlan(tool: string, reason: ActionFailure): RoutePlan {
  return {
    success: false,
    cost: 0,
    reason: reason,
    tool: tool,
    tiles: [],
    fingerprint: [],
  };
}

function succeed(cost: number): ActionResult {
  return { success: true, cost: cost, reason: null };
}

function fail(reason: ActionFailure): ActionResult {
  return { success: false, cost: 0, reason: reason };
}

function isOnMap(map: MapLike, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) &&
    x >= 0 && y >= 0 && x < map.width && y < map.height;
}

function pieceOf(tile: TileLike): Piece {
  return { value: tile.getValue(), conductive: tile.isConductive() };
}

// doAutoBulldoze in src/baseTool.js, which the three tools always call
function autoBulldozes(tile: TileLike): boolean {
  const value: number = normalize(tile.getValue());

  return tile.isBulldozable() &&
    ((value >= TileValues.TINYEXP && value <= TileValues.LASTTINYEXP) ||
     (value < TileValues.HBRIDGE && value !== TileValues.DIRT));
}

function isWater(value: number): boolean {
  return value === TileValues.RIVER || value === TileValues.REDGE ||
    value === TileValues.CHANNEL;
}

/* A bridge needs a piece next to it. The first side that qualifies decides
 * which way it runs. The previous route tile counts as laid already. */
function layBridge(rules: ToolRules, map: MapLike, x: number, y: number,
    previous: PathTile | null): Step | null {
  for (const [side, dx, dy] of SIDES) {
    const neighbourX: number = x + dx;
    const neighbourY: number = y + dy;

    if (!isOnMap(map, neighbourX, neighbourY)) {
      continue;
    }

    const piece: Piece = previous !== null && previous.x === neighbourX &&
      previous.y === neighbourY ? previous.step.piece :
      pieceOf(map.getTile(neighbourX, neighbourY));

    if (rules.bridgesFrom(side, piece)) {
      const horizontal: boolean = side === 'east' || side === 'west';
      const value: number = horizontal ? rules.horizontalBridge :
        rules.verticalBridge;

      return {
        cost: rules.bridgeCost,
        kind: 'bridge',
        piece: { value: value, conductive: carriesPower(value) },
        axis: horizontal ? HORIZONTAL : VERTICAL,
      };
    }
  }

  return null;
}

// What laying one tile costs and leaves behind, or null if the tool refuses
function layStep(rules: ToolRules, map: MapLike, x: number, y: number,
    previous: PathTile | null): Step | null {
  const tile: TileLike = map.getTile(x, y);
  const value: number = normalize(tile.getValue());

  if (rules.hasKind(value)) {
    return { cost: 0, kind: 'existing', piece: pieceOf(tile), axis: NO_AXIS };
  }

  const bulldozed: boolean = autoBulldozes(tile);
  const ground: number = bulldozed ? TileValues.DIRT : value;

  if (isWater(ground)) {
    return layBridge(rules, map, x, y, previous);
  }

  const laid: number | undefined = rules.onLand.get(ground);

  if (laid === undefined) {
    return null;
  }

  return {
    cost: rules.landCost + (bulldozed ? 1 : 0),
    kind: 'new',
    piece: { value: laid, conductive: carriesPower(laid) },
    axis: NO_AXIS,
  };
}

// The tool could use the tile with the right neighbour, ignoring the route
function canEverUse(rules: ToolRules, map: MapLike, x: number,
    y: number): boolean {
  const tile: TileLike = map.getTile(x, y);
  const value: number = normalize(tile.getValue());
  const ground: number = autoBulldozes(tile) ? TileValues.DIRT : value;

  return rules.hasKind(value) || isWater(ground) || rules.onLand.has(ground);
}

function comesFirst(first: QueueEntry, second: QueueEntry): boolean {
  if (first.cost !== second.cost) {
    return first.cost < second.cost;
  }

  if (first.length !== second.length) {
    return first.length < second.length;
  }

  return first.order < second.order;
}

function pushEntry(heap: QueueEntry[], entry: QueueEntry): void {
  heap.push(entry);
  let index: number = heap.length - 1;

  while (index > 0) {
    const parent: number = (index - 1) >> 1;

    if (!comesFirst(heap[index], heap[parent])) {
      break;
    }

    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function popEntry(heap: QueueEntry[]): QueueEntry {
  const top: QueueEntry = heap[0];
  const last: QueueEntry = heap.pop() as QueueEntry;

  if (heap.length > 0) {
    heap[0] = last;
    let index: number = 0;

    for (;;) {
      const left: number = 2 * index + 1;
      const right: number = left + 1;
      let first: number = index;

      if (left < heap.length && comesFirst(heap[left], heap[first])) {
        first = left;
      }

      if (right < heap.length && comesFirst(heap[right], heap[first])) {
        first = right;
      }

      if (first === index) {
        break;
      }

      [heap[index], heap[first]] = [heap[first], heap[index]];
      index = first;
    }
  }

  return top;
}

function edgeKey(fromState: number, toTile: number): string {
  return fromState + '>' + toTile;
}

/* Dijkstra over tiles, 4-connected. The state is a tile plus the way a
 * bridge on it runs, because the next tile depends on that. Ties go to the
 * shorter path, then to the first one found, so the result is always the
 * same for the same city. */
function search(rules: ToolRules, map: MapLike, from: Position,
    to: Position, banned: Set<string>): PathTile[] | null {
  const tileCount: number = map.width * map.height;
  const stateCount: number = tileCount * STATES_PER_TILE;
  const costs: Float64Array = new Float64Array(stateCount).fill(Infinity);
  const lengths: Int32Array = new Int32Array(stateCount);
  const previous: Int32Array = new Int32Array(stateCount).fill(-1);
  const steps: (Step | null)[] = new Array(stateCount).fill(null);
  const heap: QueueEntry[] = [];
  let order: number = 0;

  const start: Step | null = layStep(rules, map, from.x, from.y, null);

  if (start === null) {
    return null;
  }

  const startState: number =
    (from.y * map.width + from.x) * STATES_PER_TILE + start.axis;
  costs[startState] = start.cost;
  lengths[startState] = 1;
  steps[startState] = start;
  pushEntry(heap, {
    cost: start.cost, length: 1, order: order++, state: startState,
  });

  const goal: number = to.y * map.width + to.x;
  let endState: number = -1;

  while (heap.length > 0) {
    const entry: QueueEntry = popEntry(heap);

    if (entry.cost !== costs[entry.state] ||
        entry.length !== lengths[entry.state]) {
      continue;
    }

    const tileIndex: number = Math.floor(entry.state / STATES_PER_TILE);

    if (tileIndex === goal) {
      endState = entry.state;
      break;
    }

    const here: PathTile = {
      x: tileIndex % map.width,
      y: Math.floor(tileIndex / map.width),
      state: entry.state,
      step: steps[entry.state] as Step,
    };

    for (const [, dx, dy] of SIDES) {
      const nextX: number = here.x + dx;
      const nextY: number = here.y + dy;

      if (!isOnMap(map, nextX, nextY)) {
        continue;
      }

      const nextTile: number = nextY * map.width + nextX;

      if (banned.has(edgeKey(entry.state, nextTile))) {
        continue;
      }

      const step: Step | null = layStep(rules, map, nextX, nextY, here);

      if (step === null) {
        continue;
      }

      const nextState: number = nextTile * STATES_PER_TILE + step.axis;
      const cost: number = entry.cost + step.cost;
      const length: number = entry.length + 1;

      if (cost < costs[nextState] ||
          (cost === costs[nextState] && length < lengths[nextState])) {
        costs[nextState] = cost;
        lengths[nextState] = length;
        previous[nextState] = entry.state;
        steps[nextState] = step;
        pushEntry(heap, {
          cost: cost, length: length, order: order++, state: nextState,
        });
      }
    }
  }

  if (endState === -1) {
    return null;
  }

  const path: PathTile[] = [];

  for (let state: number = endState; state !== -1;
       state = previous[state]) {
    const tileIndex: number = Math.floor(state / STATES_PER_TILE);
    path.push({
      x: tileIndex % map.width,
      y: Math.floor(tileIndex / map.width),
      state: state,
      step: steps[state] as Step,
    });
  }

  return path.reverse();
}

/* Lays the route with the engine's own tool, as one pending change. Tiles
 * that already have the kind are skipped, the tool would refuse them.
 * Nothing reaches the map until modifyIfEnoughFunding, so the caller either
 * applies the change or clears it. */
function layWithTool(city: SimulationLike, tool: ToolLike,
    tiles: RouteTile[]): LaidRoute {
  const costs: number[] = [];
  tool.clear();

  for (let index: number = 0; index < tiles.length; index++) {
    if (tiles[index].kind === 'existing') {
      costs.push(0);
      continue;
    }

    const before: number = getPendingCost(tool);
    tool.doTool(tiles[index].x, tiles[index].y, city.blockMaps);

    if (tool.result !== tool.TOOLRESULT_OK) {
      tool.clear();
      return { costs: costs, failedAt: index };
    }

    costs.push(getPendingCost(tool) - before);
  }

  return { costs: costs, failedAt: null };
}

// Road tiles change their value with the traffic on them, so normalize those
function tileKey(map: MapLike, x: number, y: number): number {
  if (!isOnMap(map, x, y)) {
    return -1;
  }

  const tile: TileLike = map.getTile(x, y);
  const value: number = tile.getValue();

  return value >= TileValues.ROADBASE && value <= TileValues.LASTROAD ?
    normalize(value) : tile.getRawValue();
}

/* The engine's result depends on the route tiles and, for a bridge, on the
 * tiles around it. Nothing else can change what buildRoute does. */
function fingerprint(map: MapLike, tiles: RouteTile[]): number[] {
  const keys: number[] = [];

  for (const tile of tiles) {
    keys.push(tileKey(map, tile.x, tile.y));

    if (tile.kind === 'bridge') {
      for (const [, dx, dy] of SIDES) {
        keys.push(tileKey(map, tile.x + dx, tile.y + dy));
      }
    }
  }

  return keys;
}

function toRouteTiles(path: PathTile[]): RouteTile[] {
  return path.map((tile: PathTile): RouteTile => ({
    x: tile.x,
    y: tile.y,
    cost: tile.step.cost,
    kind: tile.step.kind,
  }));
}

/* Finds the cheapest route for a road, rail or wire from one tile to
 * another, both included. The cost comes from laying the route with the
 * engine's tool without applying it, so the city does not change. */
function planRoute(city: SimulationLike, toolName: string, from: Position,
    to: Position): RoutePlan {
  if (!ROUTE_TOOLS.includes(toolName)) {
    return failedPlan(toolName, 'unknown-tool');
  }

  const map: MapLike = getMap(city);

  if (!isOnMap(map, from.x, from.y) || !isOnMap(map, to.x, to.y)) {
    return failedPlan(toolName, 'invalid-position');
  }

  const rules: ToolRules = RULES[toolName];

  if (layStep(rules, map, from.x, from.y, null) === null ||
      !canEverUse(rules, map, to.x, to.y)) {
    return failedPlan(toolName, 'blocked');
  }

  const tool: ToolLike = getTools(city)[toolName];
  const banned: Set<string> = new Set();

  try {
    for (let attempt: number = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const path: PathTile[] | null = search(rules, map, from, to, banned);

      if (path === null) {
        return failedPlan(toolName, 'no-route');
      }

      const tiles: RouteTile[] = toRouteTiles(path);
      const laid: LaidRoute = layWithTool(city, tool, tiles);

      /* The search only sees the previous route tile next to a bridge. An
       * earlier one can turn the bridge the other way, and then the engine
       * refuses the next tile. Ban that step and search again. */
      if (laid.failedAt !== null) {
        if (laid.failedAt === 0) {
          return failedPlan(toolName, 'blocked');
        }

        banned.add(edgeKey(path[laid.failedAt - 1].state,
          path[laid.failedAt].y * map.width + path[laid.failedAt].x));
        continue;
      }

      for (let index: number = 0; index < tiles.length; index++) {
        if (laid.costs[index] !== tiles[index].cost) {
          throw new Error('Route cost differs from the engine at ' +
            tiles[index].x + ', ' + tiles[index].y);
        }
      }

      return {
        success: true,
        cost: getPendingCost(tool),
        reason: null,
        tool: toolName,
        tiles: tiles,
        fingerprint: fingerprint(map, tiles),
      };
    }
  } finally {
    tool.clear();
  }

  return failedPlan(toolName, 'no-route');
}

function sameNumbers(first: number[], second: number[]): boolean {
  return first.length === second.length &&
    first.every((value: number, index: number): boolean =>
      value === second[index]);
}

/* Builds a plan from planRoute, all or nothing. A plan whose tiles changed
 * since it was made is refused as stale, and so is one where the engine now
 * asks a different price. */
function buildRoute(city: SimulationLike, plan: RoutePlan): ActionResult {
  if (!plan.success) {
    return fail(plan.reason ?? 'no-route');
  }

  if (!ROUTE_TOOLS.includes(plan.tool)) {
    return fail('unknown-tool');
  }

  const map: MapLike = getMap(city);

  if (!plan.tiles.every((tile: RouteTile): boolean =>
      isOnMap(map, tile.x, tile.y)) ||
      !sameNumbers(fingerprint(map, plan.tiles), plan.fingerprint)) {
    return fail('stale-plan');
  }

  // Everything is there already. The tool would refuse an empty change
  if (plan.cost === 0) {
    return succeed(0);
  }

  const tool: ToolLike = getTools(city)[plan.tool];
  const fundsBefore: number = city.budget.totalFunds;

  try {
    const laid: LaidRoute = layWithTool(city, tool, plan.tiles);

    if (laid.failedAt !== null || getPendingCost(tool) !== plan.cost) {
      return fail('stale-plan');
    }

    if (!tool.modifyIfEnoughFunding(city.budget)) {
      return fail('insufficient-funds');
    }
  } finally {
    tool.clear();
  }

  return succeed(fundsBefore - city.budget.totalFunds);
}

export { ROUTE_TOOLS, hasPiece, planRoute, buildRoute };
