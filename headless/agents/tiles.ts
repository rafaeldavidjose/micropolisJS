import {
  AIRPORTBASE,
  CHANNEL,
  CHURCH7LAST,
  COALBASE,
  COMBASE,
  COMCLR,
  CZB,
  DIRT,
  FIRSTRIVEDGE,
  FOUNTAIN,
  FREEZ,
  HBRDG0,
  HBRDG3,
  HHTHR,
  HOSPITALBASE,
  HPOWER,
  HRAILROAD,
  HROADPOWER,
  INDBASE,
  INDBASE2,
  INDCLR,
  IZB,
  LASTPORT,
  LASTPOWERPLANT,
  LASTROAD,
  LASTRUBBLE,
  LASTZONE,
  LHTHR,
  LIGHTNINGBOLT,
  NUCLEAR,
  PORTBASE,
  POWERPLANT,
  RAILVPOWERH,
  REDGE,
  RESBASE,
  RIVER,
  ROADBASE,
  RZB,
  STADIUMBASE,
  TINYEXP,
  TINYEXPLAST,
  VBRDG0,
  VBRDG3,
  VRAILROAD,
  VROADPOWER,
} from '../../src/tileValues.ts';
import type { MapView, ZoneView } from '../types.ts';

// What the agents read from tile numbers, which is all their view gives

type ZoneKind = 'residential' | 'commercial' | 'industrial';

/* A tile of a zone or building. Zones and buildings run from RESBASE to
 * the last church, with a park fountain, the draw bridges, the lightning
 * bolt and the explosions in between. */
function isBuilding(value: number): boolean {
  return value >= RESBASE && value <= CHURCH7LAST &&
    value !== LIGHTNINGBOLT &&
    !(value >= HBRDG0 && value <= HBRDG3) &&
    !(value >= FOUNTAIN && value < INDBASE2) &&
    !(value >= TINYEXP && value <= TINYEXPLAST) &&
    !(value >= VBRDG0 && value <= VBRDG3);
}

function isRoad(value: number): boolean {
  return (value >= ROADBASE && value <= LASTROAD) ||
    value === HRAILROAD || value === VRAILROAD;
}

// Bare land, or a shore, tree or rubble tile, which the tools clear for $1
function isFreeLand(value: number): boolean {
  return value === DIRT || (value >= FIRSTRIVEDGE && value <= LASTRUBBLE);
}

// Open water, where a fallen bridge goes back to
function isWater(value: number): boolean {
  return value === RIVER || value === REDGE || value === CHANNEL;
}

/* Power lines, the road and rail crossings that carry them, and zones and
 * buildings: the tiles the power scan goes through. */
function conducts(value: number): boolean {
  return (value >= HPOWER && value <= RAILVPOWERH) ||
    value === HROADPOWER || value === VROADPOWER || isBuilding(value);
}

function isPowerPlant(centre: number): boolean {
  return centre === POWERPLANT || centre === NUCLEAR;
}

// The width of a site from the tile at its centre, as in src/gameTools.js
function siteSize(centre: number): number {
  if (centre >= AIRPORTBASE && centre < COALBASE) {
    return 6;
  }

  if ((centre >= PORTBASE && centre <= LASTPORT) ||
      (centre >= COALBASE && centre <= LASTPOWERPLANT) ||
      (centre >= STADIUMBASE && centre <= LASTZONE)) {
    return 4;
  }

  return 3;
}

/* The kind of a zone from its centre tile, or null for anything else. The
 * hospital and the church sit in the residential range but are no zones of
 * it, as in TileUtils.isResidential. */
function zoneKind(centre: number): ZoneKind | null {
  if (centre >= RESBASE && centre < HOSPITALBASE) {
    return 'residential';
  }

  if (centre >= COMBASE && centre < INDBASE) {
    return 'commercial';
  }

  if (centre >= INDBASE && centre < PORTBASE) {
    return 'industrial';
  }

  return null;
}

/* What a zone adds to the census, from getZonePopulation in
 * src/residential.js, commercial.js and industrial.js. An empty
 * residential zone counts the houses around its centre. */
function zonePopulation(map: MapView, zone: ZoneView): number {
  const kind: ZoneKind | null = zoneKind(zone.tile);

  if (kind === 'residential' && zone.tile === FREEZ) {
    let houses: number = 0;

    for (let dy: number = -1; dy <= 1; dy++) {
      for (let dx: number = -1; dx <= 1; dx++) {
        const value: number = map.getTileValue(zone.x + dx, zone.y + dy);
        houses += (dx !== 0 || dy !== 0) && value >= LHTHR &&
          value <= HHTHR ? 1 : 0;
      }
    }

    return houses;
  }

  if (kind === 'residential') {
    return (Math.floor((zone.tile - RZB) / 9) % 4 + 1) * 8 + 16;
  }

  if (kind === 'commercial') {
    return zone.tile === COMCLR ? 0 :
      Math.floor((zone.tile - CZB) / 9) % 5 + 1;
  }

  if (kind === 'industrial') {
    return zone.tile === INDCLR ? 0 :
      Math.floor((zone.tile - IZB) / 9) % 4 + 1;
  }

  return 0;
}

export {
  conducts,
  isBuilding,
  isFreeLand,
  isPowerPlant,
  isRoad,
  isWater,
  siteSize,
  zoneKind,
  zonePopulation,
};

export type { ZoneKind };
