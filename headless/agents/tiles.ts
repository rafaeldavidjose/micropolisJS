import {
  AIRPORTBASE,
  CHURCH7LAST,
  COALBASE,
  DIRT,
  FIRSTRIVEDGE,
  FOUNTAIN,
  HBRDG0,
  HBRDG3,
  HPOWER,
  HRAILROAD,
  HROADPOWER,
  INDBASE2,
  LASTPORT,
  LASTPOWERPLANT,
  LASTROAD,
  LASTRUBBLE,
  LASTZONE,
  LIGHTNINGBOLT,
  NUCLEAR,
  PORTBASE,
  POWERPLANT,
  RAILVPOWERH,
  RESBASE,
  ROADBASE,
  STADIUMBASE,
  TINYEXP,
  TINYEXPLAST,
  VBRDG0,
  VBRDG3,
  VRAILROAD,
  VROADPOWER,
} from '../../src/tileValues.ts';

// What the agents read from tile numbers, which is all their view gives

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

export { conducts, isBuilding, isFreeLand, isPowerPlant, isRoad, siteSize };
