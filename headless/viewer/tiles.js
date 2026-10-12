/* Tile numbers and flags from src/tileValues.ts and src/tileFlags.ts. The
 * browser cannot load those TypeScript files without a build step, so the
 * numbers the viewer needs are copied here. test/replay.test.ts checks
 * them against the engine. */

/** @type {number} */
const TILE_SIZE = 16;
/** @type {number} */
const TILES_PER_ROW = 32;

/** @type {Record<string, number>} */
const FLAGS = {
  POWERBIT: 0x8000,
  CONDBIT: 0x4000,
  BURNBIT: 0x2000,
  BULLBIT: 0x1000,
  ANIMBIT: 0x0800,
  ZONEBIT: 0x0400,
  BIT_MASK: 0x03ff,
};

/** @type {Record<string, number>} */
const TILES = {
  DIRT: 0,
  RIVER: 2,
  FIRSTRIVEDGE: 5,
  LASTRIVEDGE: 20,
  TREEBASE: 21,
  RUBBLE: 44,
  FLOOD: 48,
  RADTILE: 52,
  FIRE: 56,
  ROADBASE: 64,
  HROADPOWER: 77,
  VROADPOWER: 78,
  LTRFBASE: 80,
  HTRFBASE: 144,
  LASTROAD: 206,
  POWERBASE: 208,
  HPOWER: 208,
  VPOWER: 209,
  RAILHPOWERV: 221,
  RAILVPOWERH: 222,
  RAILBASE: 224,
  HRAIL: 224,
  VRAIL: 225,
  HRAILROAD: 237,
  VRAILROAD: 238,
  RESBASE: 240,
  HOUSE: 249,
  HHTHR: 260,
  HOSPITALBASE: 405,
  CHURCHBASE: 414,
  COMBASE: 423,
  INDBASE: 612,
  LASTIND: 620,
  PORTBASE: 693,
  AIRPORTBASE: 709,
  COALBASE: 745,
  FIRESTBASE: 761,
  POLICESTBASE: 770,
  STADIUMBASE: 779,
  NUCLEARBASE: 811,
  LIGHTNINGBOLT: 827,
  HBRDG0: 828,
  RADAR0: 832,
  FOUNTAIN: 840,
  INDBASE2: 844,
  TINYEXP: 860,
  TINYEXPLAST: 883,
  COALSMOKE1: 916,
  FOOTBALLGAME1: 932,
  VBRDG0: 948,
  NUKESWIRL1: 952,
  CHURCH1BASE: 956,
  CHURCH7LAST: 1018,
  TILE_COUNT: 1024,
};

/**
 * The ranges of classifyZone in src/queryTool.js, with its names from
 * src/text.js. Each kind runs up to the next one.
 * @type {[number, string][]}
 */
const KINDS = [
  [TILES.DIRT, 'Clear'],
  [TILES.RIVER, 'Water'],
  [TILES.TREEBASE, 'Trees'],
  [TILES.RUBBLE, 'Rubble'],
  [TILES.FLOOD, 'Flood'],
  [TILES.RADTILE, 'Radioactive Waste'],
  [TILES.FIRE, 'Fire'],
  [TILES.ROADBASE, 'Road'],
  [TILES.POWERBASE, 'Power'],
  [TILES.RAILBASE, 'Rail'],
  [TILES.RESBASE, 'Residential'],
  [TILES.COMBASE, 'Commercial'],
  [TILES.INDBASE, 'Industrial'],
  [TILES.PORTBASE, 'Seaport'],
  [TILES.AIRPORTBASE, 'Airport'],
  [TILES.COALBASE, 'Coal Power'],
  [TILES.FIRESTBASE, 'Fire Department'],
  [TILES.POLICESTBASE, 'Police Department'],
  [TILES.STADIUMBASE, 'Stadium'],
  [TILES.NUCLEARBASE, 'Nuclear Power'],
  [TILES.HBRDG0, 'Draw Bridge'],
  [TILES.RADAR0, 'Radar Dish'],
  [TILES.FOUNTAIN, 'Fountain'],
  [TILES.INDBASE2, 'Industrial'],
  [TILES.FOOTBALLGAME1, 'Stadium'],
  [TILES.VBRDG0, 'Draw Bridge'],
  [TILES.NUKESWIRL1, 'Nuclear Power'],
];

/**
 * @param {number} value
 * @returns {number}
 */
function tileIndex(value) {
  return value & FLAGS.BIT_MASK;
}

/**
 * The query tool counts the coal plant's smoke as the plant. It has no
 * range for the explosions and the churches added after tile 955, so
 * those are named here.
 * @param {number} index
 * @returns {string}
 */
function tileKind(index) {
  if (index >= TILES.COALSMOKE1 && index < TILES.FOOTBALLGAME1) {
    return 'Coal Power';
  }

  if (index >= TILES.TINYEXP && index <= TILES.TINYEXPLAST) {
    return 'Explosion';
  }

  if (index >= TILES.CHURCH1BASE && index <= TILES.CHURCH7LAST) {
    return 'Residential';
  }

  /** @type {string} */
  let kind = KINDS[0][1];

  for (const [first, name] of KINDS) {
    if (index < first) {
      break;
    }

    kind = name;
  }

  return kind;
}

/**
 * What the tile is within its kind, where the tile number says more.
 * @param {number} index
 * @returns {string}
 */
function tileDetail(index) {
  if (index >= TILES.FIRSTRIVEDGE && index <= TILES.LASTRIVEDGE) {
    return 'shore';
  }

  if (index >= TILES.ROADBASE && index <= TILES.LASTROAD) {
    /** @type {number} */
    const piece = (index - TILES.ROADBASE) % 16;
    /** @type {string} */
    const traffic = index >= TILES.HTRFBASE ? 'heavy traffic' :
      index >= TILES.LTRFBASE ? 'light traffic' : '';
    /** @type {string[]} */
    const parts = [];

    if (piece === 0 || piece === 1) {
      parts.push('bridge');
    } else if (piece === TILES.HROADPOWER - TILES.ROADBASE ||
               piece === TILES.VROADPOWER - TILES.ROADBASE) {
      parts.push('crossing a power line');
    }

    if (traffic !== '') {
      parts.push(traffic);
    }

    return parts.join(', ');
  }

  if (index === TILES.HPOWER || index === TILES.VPOWER ||
      index === TILES.HRAIL || index === TILES.VRAIL) {
    return 'over water';
  }

  if (index === TILES.RAILHPOWERV || index === TILES.RAILVPOWERH) {
    return 'crossing a rail';
  }

  if (index === TILES.HRAILROAD || index === TILES.VRAILROAD) {
    return 'crossing a road';
  }

  if (index >= TILES.RESBASE && index < TILES.HOUSE) {
    return 'empty zone';
  }

  if (index >= TILES.HOUSE && index <= TILES.HHTHR) {
    return 'house';
  }

  if (index >= TILES.HOSPITALBASE && index < TILES.CHURCHBASE) {
    return 'hospital';
  }

  if ((index >= TILES.CHURCHBASE && index < TILES.COMBASE) ||
      (index >= TILES.CHURCH1BASE && index <= TILES.CHURCH7LAST)) {
    return 'church';
  }

  if ((index >= TILES.COMBASE && index < TILES.COMBASE + 9) ||
      (index >= TILES.INDBASE && index <= TILES.LASTIND)) {
    return 'empty zone';
  }

  return '';
}

/**
 * One line for a raw map value: kind, detail and the flags that matter.
 * @param {number} value
 * @returns {string}
 */
function describeTile(value) {
  /** @type {number} */
  const index = tileIndex(value);
  /** @type {string[]} */
  const parts = [tileKind(index)];
  /** @type {string} */
  const detail = tileDetail(index);

  if (detail !== '') {
    parts.push(detail);
  }

  if (value & FLAGS.ZONEBIT) {
    parts.push('zone centre');
  }

  if (value & (FLAGS.CONDBIT | FLAGS.ZONEBIT)) {
    parts.push(value & FLAGS.POWERBIT ? 'powered' : 'no power');
  }

  return parts.join(', ');
}

/**
 * The browser blinks a lightning bolt on these (src/animationManager.js).
 * @param {number} value
 * @returns {boolean}
 */
function isUnpoweredZone(value) {
  return (value & FLAGS.ZONEBIT) !== 0 && (value & FLAGS.POWERBIT) === 0;
}

export {
  FLAGS,
  TILES,
  TILES_PER_ROW,
  TILE_SIZE,
  describeTile,
  isUnpoweredZone,
  tileIndex,
};
