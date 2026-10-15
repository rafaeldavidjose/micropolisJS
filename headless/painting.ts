import { getMap } from './engine.ts';
import { TileUtils } from '../src/tileUtils.js';
import { ANIMBIT, BIT_MASK } from '../src/tileFlags.ts';
import { LASTTINYEXP, TINYEXP } from '../src/tileValues.ts';
import {
  SPRITE_MONSTER,
  SPRITE_SHIP,
  SPRITE_TORNADO,
} from '../src/spriteConstants.ts';
import type { MapLike, SimulationLike, SpriteLike } from './types.ts';

/* What the browser changes on the map while it paints. getTiles in
 * src/animationManager.js shows the next frame of every animated tile on
 * the screen once 50 ms have passed since the last change. All but one of
 * the animations only change what is painted. An explosion is the
 * exception: when its last frame has been shown, the map tile becomes
 * rubble. Nothing in the simulation does that, so without it a bulldozed
 * zone, or a tile a tornado destroyed, stays an explosion for good. */

/* The browser paints once per animation frame, and the frames come every
 * 16.7 ms on a 60 Hz screen. The animations only move on when more than
 * 50 ms have passed, so on every fourth frame. */
const FRAMES_PER_ANIMATION: number = 4;

// The sprites that leave explosions, through destroyMapTile
const WRECKERS: readonly number[] = [SPRITE_TORNADO, SPRITE_MONSTER,
  SPRITE_SHIP];

/* The frames painted so far, the frame each explosion showed last by the
 * index of its tile, and whether new explosions may be on the map. Like
 * the browser's paint history, none of it is saved with the city. */
interface Painter {
  frame: number;
  shown: Map<number, number>;
  rescan: boolean;
}

const painters: WeakMap<SimulationLike, Painter> = new WeakMap();

function painterOf(city: SimulationLike): Painter {
  const known: Painter | undefined = painters.get(city);

  if (known !== undefined) {
    return known;
  }

  const painter: Painter = { frame: 0, shown: new Map(), rescan: true };
  painters.set(city, painter);

  return painter;
}

function isWrecker(sprite: SpriteLike): boolean {
  return sprite.frame !== 0 && WRECKERS.includes(sprite.type);
}

/* One step of an explosion, as getTiles takes it. One with no frame shown
 * yet shows the one after its tile, and one that showed the last frame
 * becomes rubble, with a random rubble tile. */
function animateTile(map: MapLike, painter: Painter,
    shown: Map<number, number>, index: number): void {
  const x: number = index % map.width;
  const y: number = Math.floor(index / map.width);
  const raw: number = map.getTile(x, y).getRawValue();
  const value: number = raw & BIT_MASK;

  if ((raw & ANIMBIT) === 0 || value < TINYEXP || value >= LASTTINYEXP) {
    return;
  }

  const last: number | undefined = painter.shown.get(index);

  if (last === LASTTINYEXP) {
    map.setTo(x, y, TileUtils.randomRubble());
  } else if (last !== undefined && last > value) {
    shown.set(index, last + 1);
  } else {
    shown.set(index, value + 1);
  }
}

/* The browser only does this for the tiles on the screen, and here the
 * whole map counts. New explosions only come from the bulldozer and the
 * sprites in WRECKERS, so the map is only searched for them when one of
 * those may have left some, and otherwise the known ones move on. */
function animateExplosions(map: MapLike, painter: Painter): void {
  const shown: Map<number, number> = new Map();

  if (painter.rescan) {
    for (let index: number = 0; index < map.width * map.height; index++) {
      animateTile(map, painter, shown, index);
    }
  } else {
    for (const index of painter.shown.keys()) {
      animateTile(map, painter, shown, index);
    }
  }

  painter.shown = shown;
  painter.rescan = false;
}

/* The map changed outside the frames, for example by an action, which can
 * leave explosions. */
function markMapChanged(city: SimulationLike): void {
  painterOf(city).rescan = true;
}

// Called once per frame, after the sprites moved, as the browser paints
function paintFrame(city: SimulationLike): void {
  const painter: Painter = painterOf(city);

  painter.frame++;

  if (city.spriteManager.getSpriteList().some(isWrecker)) {
    painter.rescan = true;
  }

  if (painter.frame % FRAMES_PER_ANIMATION === 0) {
    animateExplosions(getMap(city), painter);
  }
}

export { markMapChanged, paintFrame };
