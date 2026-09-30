/* The only file that reads private engine fields. The underscore is just a
 * naming convention in the engine and JS does not enforce it. Adding getters
 * to src/ only for headless/ seemed unnecessary. */

import { BaseTool } from '../src/baseTool.js';
import { GameTools } from '../src/gameTools.js';
import type {
  CensusLike,
  SimulationLike,
  ToolMap,
  ValvesLike,
} from './types.ts';

interface MapLike {
  width: number;
  height: number;
}

interface EnginePrivates {
  _map: MapLike;
  _census: CensusLike;
  _valves: ValvesLike;
}

const toolsByCity: WeakMap<SimulationLike, ToolMap> = new WeakMap();

function privates(city: SimulationLike): EnginePrivates {
  return city as unknown as EnginePrivates;
}

// Reads Simulation._map
function getMap(city: SimulationLike): MapLike {
  return privates(city)._map;
}

// Reads Simulation._census
function getCensus(city: SimulationLike): CensusLike {
  return privates(city)._census;
}

// Reads Simulation._valves
function getValves(city: SimulationLike): ValvesLike {
  return privates(city)._valves;
}

/* The tools hold the map, so there is one set per city. Auto bulldoze is a
 * flag shared by the whole process, so it is set on every call to keep it
 * the same in every run. */
function getTools(city: SimulationLike): ToolMap {
  BaseTool.setAutoBulldoze(true);

  const cachedTools: ToolMap | undefined = toolsByCity.get(city);

  if (cachedTools !== undefined) {
    return cachedTools;
  }

  const tools: ToolMap = GameTools(getMap(city)) as ToolMap;
  toolsByCity.set(city, tools);

  return tools;
}

export { getMap, getCensus, getValves, getTools };
