import { DOOR_STATES, ENTITY_TYPES, TILE_SIZE_PX, TILE_TYPES } from "./constants.js";
import { loadLocalJson } from './data-loader.js';
import { collectLightSources, computeLightPolygon, withLightPolygonCache } from "./light-geometry.js";
import { tileKey } from "./state-schema.js";
import { getOrganicTileData, isOrganicMovementBlockingTile, isOrganicPillarTile } from "./organic-tiles.js";
import { getInnerWallTileData } from "./inner-walls.js";
import {
  getAngledWallTileData,
  isAngledWallLightBlockingTile,
  isAngledWallMovementBlockingTile
} from "./angled-walls.js";
import { CRYPT_ASSET_KEYS } from "./crypts.js";
import { REVIEWED_ASSET_KEYS } from "./reviewed-layouts.js";
import { visualTilePoint } from "./tile-positions.js";
import { getReviewedTileRule, STATUE_ASSET_KEYS } from "./reviewed-tile-rules.js";
import { doorRotationAngle, isClosedSecretDoor, secretFoundMarkerRect } from './door-geometry.js';
import { canMoveBetweenTiles } from './interactions.js';
import { hasWizardEffect, suppressionZones } from './wizard-mishaps.js';
import { shredZones } from './arcane-effects.js';
import { rangeRadius, canTargetAtRange } from './targeting.js';
import { isSlowWaterTile } from './terrain-movement.js';
import { protectionAuras } from './faith-spells.js';
import { isInvisible } from './concealment.js';
import { isIncorporeal } from './conditions.js';
import { FLOATING_DISC_COLOR, isFloatingDisc } from './floating-disc.js';
import { pitIsOpen, pitArt, PIT_ASSET_KEYS } from './pits.js';
import { isMonsterCurrentlyVisible } from './monster-perception.js';
import { restTourFrame } from './rest-scene.js';
import { routeOf, routeExistsAt, UNDERPASS_ASSETS, UNDERPASS_OPACITY } from './underpasses.js';

const USE_WATABOU_INK_OVERLAY = true;
const INK_WALL_COLOR = "#111111";
const HATCH_COLOR = "rgba(17, 17, 17, 0.72)";
const HATCH_SPACING_PX = 11;
const HATCH_LENGTH_PX = 15;
const ORGANIC_ALPHA_THRESHOLD = 16;
const ORGANIC_CORNER_ZONE_PX = 6;
const ASSET_PATHS = Object.freeze({
  floor: "./assets/room_grid_backgroung.jpg"
});
const ROTUNDA_VARIANTS = Object.freeze({
  7: Object.freeze([
    "rotunda7x7.png",
    "rotunda7x7-n-s.png",
    "rotunda7x7-e-s.png",
    "rotunda7x7-w-s.png",
    "rotunda7x7-n-e-s-w.png",
    "rotunda7x7-n-e-s.png",
    "rotunda7x7-n-w-s.png"
  ]),
  5: Object.freeze([
    "rotunda5x5-s.png",
    "rotunda5x5-s2.png",
    "rotunda5x5-s3.png",
    "rotunda5x5-s4.png",
    "rotunda5x5-n-s.png",
    "rotunda5x5-s-e.png",
    "rotunda5x5-s-w.png",
    "rotunda5x5-n-s-e.png",
    "rotunda5x5-n-s-w.png",
    "rotunda5x5-s-e-w.png"
  ])
});
const CORNER_VARIANTS = Object.freeze({
  4: Object.freeze([
    "black-round-corner-4x4-nw.png",
    "black-round-corner-4x4-ne.png",
    "black-round-corner-4x4-se.png",
    "black-round-corner-4x4-sw.png"
  ]),
  3: Object.freeze([
    "black-round-corner-3x3-nw.png",
    "black-round-corner-3x3-ne.png",
    "black-round-corner-3x3-se.png",
    "black-round-corner-3x3-sw.png"
  ]),
  2: Object.freeze([]),
  1: Object.freeze([
    "b-round-corner-1x1-nw.png",
    "b-round-corner-1x1-ne.png",
    "b-round-corner-1x1-se.png",
    "b-round-corner-1x1-sw.png"
  ])
});
const ANGLED_WALL_VARIANTS = Object.freeze([
  "1x1-wall-angle-ne-1.png",
  "1x1-wall-angle-ne-2.png",
  "1x1-wall-angle-ne-3.png",
  "1x1-wall-angle-ne-4.png",
  "1x1-wall-angle-ne-pillar1.png",
  "1x1-wall-angle-ne-pillar2.png",
  "1x1-wall-angle-ne-pillar3.png",
  "1x1-wall-angle-sw-1.png",
  "1x1-wall-angle-sw-2.png",
  "1x1-wall-angle-sw-pillar1.png",
  "1x1-wall-angle-sw-pillar2.png",
  "1x1-wall-angle-sw-pillar3.png",
  "1-black.png"
]);
const NEW_DOOR_KEYS = Object.freeze([
  "door-closed",
  "door-gone",
  "door-open",
  "door-portcullis",
  "door-portculis",
  "door-secret-1",
  "door-secret-1-open",
  "door-secret-2",
  "door-secret-2-open",
  "door-secret-3",
  "door-secret-3-open",
  "door-secret-found"
]);
const WATER_FLAT_KEYS = Object.freeze([
  "water-nn-1", "water-nn-2", "water-nn-3", "water-nn-4", "water-nn-5", "water-nn-6",
  "water-nn-7", "water-nn-8", "water-nn-9", "water-nn-10", "water-nn-12"
]);
const WATER_DIAGONAL_KEYS = Object.freeze(Array.from({ length: 13 }, (_, index) => `water-nw-${index + 1}`));
const WATER_ALL_KEYS = Object.freeze(["water-c", ...WATER_FLAT_KEYS, ...WATER_DIAGONAL_KEYS]);
const CANAL_KEYS = Object.freeze([
  "canal-center-piece",
  "canal-1x1-NWbNEbSEbSWwNbEbSwWw1",
  "canal-1x1-NWbNEbSEwSWbNbEwSbWb1",
  "canal-1x1-NWbNEbSEwSWbNbEwSbWb2",
  "canal-1x1-NWbNEbSEwSWwNbEwSwWw1",
  "canal-1x1-NWbNEbSEwSWwNbEwSwWw2",
  "canal-1x1-NWbNEwSEwSWbNbEwSbWb1",
  "canal-1x1-NWwNEbSEwSWwNwEwSwWw1",
  "canal-1x1-NWwNEwSEwSWbNwEwSbWb1",
  "canal-1x1-NWwNEwSEwSWbNwEwSwWb1",
  "canal-2x1-NWbNEwSEwSWbNbEwSbWb1",
  "canal-2x1-NWbNEwSEwSWbNbEwSbWb2",
  "canal-bridge-4x4-ns",
  "canal-bridge-cap-4x4-N"
]);
const JUNK_KEYS = Object.freeze([
  "junk-1x1-1",
  "junk-1x1-2",
  "junk-1x1-3",
  "junk-1x1-4",
  "junk-1x1-5",
  "junk-1x1-6",
  "junk-1x1-7",
  "junk-1x1-8",
  "junk-1x1-9",
  "junk-1x1-10",
  "junk-1x1-11",
  "junk-1x1-e",
  "junk-1x1-sw",
  "junk-1x1-w",
  "junk-2x1-2",
  "junk-2x1-E",
  "junk-2x1-ew",
  "junk-2x1-n",
  "junk-2x1-ns",
  "junk-2x1-nw",
  "junk-2x1-w",
  "junk-4x4-nesw",
  "junk-4x4-sw",
  "junk-4x4-w"
]);
const WELL_KEYS = Object.freeze(["well-1x1", "well-3x3", "well-3x3-2"]);
const ROUND_CORNERS_ENABLED = true;
const EXPLORED_FOG_ALPHA = 0.45;
const UNEXPLORED_FOG_ALPHA = 1;
const PILLAR_SHADOW_SIZE_PX = TILE_SIZE_PX / 3;
const PILLAR_SHADOW_INSET_PX = (TILE_SIZE_PX - PILLAR_SHADOW_SIZE_PX) / 2;
const STAIR_DOWN_KEYS = Object.freeze(["d-stair-1", "d-stair-2", "d-stair-3", "d-stair-4"]);
const STAIR_UP_KEYS = Object.freeze(["u-stair-n", "u-stair-e", "u-stair-s", "u-stair-w"]);
const FLOOR_TRAP_KEYS = Object.freeze(["floor-trap1"]);
const PILLAR_KEYS = Object.freeze(["plr-1", "plr-2", "plr-3", "plr-4", "plr-5", "plr-6", "plr-7", "plr-8"]);
const PILLAR_BLOCK_KEYS = Object.freeze(["plr-b-1", "plr-b-2", "plr-b-3", "plr-b-4", "plr-b-5", "plr-b-6", "plr-b-7", "plr-b-8", "plr-b-9", "plr-b-10"]);

const rendererAssets = {
  ready: false,
  images: {},
  doors: {},
  decor: {
    pillars: [],
    blockPillars: [],
    floorTraps: [],
    stairsDown: [],
    stairsUp: {},
    waterCenter: null,
    waterByKey: {},
    waterFlat: [],
    waterDiagonal: [],
    rotundas: {
      5: [],
      7: []
    },
    corners: {
      1: [],
      2: [],
      3: [],
      4: []
    },
    organic: {},
    innerWalls: {},
    angledWalls: {},
    canals: {},
    junk: {},
    wells: {},
    crypts: {},
    stealth: null,
    campfire: null,
    alarm: null
  }
};
const organicShellUnderlayCache = new Map();
const terrainFrames = new WeakMap();
const objectFrames = new WeakMap();
const imageLoads = new Map();
const imageLoadQueue = [];
let activeImageLoads = 0;

function loadImage(src) {
  if (imageLoads.has(src)) return imageLoads.get(src);
  const pending = new Promise((resolve, reject) => {
    imageLoadQueue.push(() => loadImageNow(src).then(resolve, reject));
    drainImageLoadQueue();
  });
  imageLoads.set(src, pending);
  return pending;
}

function drainImageLoadQueue() {
  while (activeImageLoads < 8 && imageLoadQueue.length) {
    activeImageLoads += 1;
    imageLoadQueue.shift()().finally(() => {
      activeImageLoads -= 1;
      drainImageLoadQueue();
    });
  }
}

function loadImageNow(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const deadline = setTimeout(() => {
      image.onload = image.onerror = null;
      image.src = "";
      reject(new Error(`Renderer asset timed out: ${src}`));
    }, 15000);
    image.onload = () => { clearTimeout(deadline); resolve(image); };
    image.onerror = () => { clearTimeout(deadline); reject(new Error(`Unable to load renderer asset: ${src}`)); };
    image.src = src;
  });
}

async function loadOptionalImage(src, options = {}) {
  try {
    return await loadImage(src);
  } catch (error) {
    if (options.quiet !== true) {
      console.warn(error.message);
    }
    return null;
  }
}

async function loadOptionalImageList(paths) {
  const images = await Promise.all(paths.map(async (path) => {
    const image = await loadOptionalImage(`./assets/${path}`, { quiet: true });
    return image ? { key: path.replace(/\.png$/i, ""), image } : null;
  }));
  return images.filter(Boolean);
}

async function resolveAssetGroups(groups) {
  return Object.fromEntries(await Promise.all(Object.entries(groups).map(async ([key, value]) => [key, await value])));
}

async function loadAssetImageMap(keys) {
  const entries = await Promise.all(keys.map(async (key) => [
    key,
    await loadOptionalImage(`./assets/${key}.png`, { quiet: true })
  ]));
  return Object.fromEntries(entries.filter(([, image]) => image));
}

async function loadOptionalJson(src, fallback = []) {
  try {
    return await loadLocalJson(src);
  } catch (error) {
    return fallback;
  }
}

async function loadOrganicImageMap() {
  const paths = await loadOptionalJson("./data/organic-assets.json", []);
  const entries = await Promise.all(paths.map(async (path) => {
    const image = await loadOptionalImage(`./assets/${path}`, { quiet: true });
    return [String(path).replace(/\.png$/i, ""), image];
  }));
  return Object.fromEntries(entries.filter(([, image]) => image));
}

async function loadInnerWallImageMap() {
  const paths = await loadOptionalJson("./data/inner-wall-assets.json", []);
  const entries = await Promise.all(paths.map(async (path) => {
    const image = await loadOptionalImage(`./assets/${path}`, { quiet: true });
    return [String(path).replace(/\.png$/i, ""), image];
  }));
  return Object.fromEntries(entries.filter(([, image]) => image));
}

async function loadAngledWallImageMap() {
  const entries = await Promise.all(ANGLED_WALL_VARIANTS.map(async (path) => {
    const image = await loadOptionalImage(`./assets/${path}`, { quiet: true });
    return [String(path).replace(/\.png$/i, ""), image];
  }));
  return Object.fromEntries(entries.filter(([, image]) => image));
}

export async function preloadRendererAssets() {
  const images = Promise.all(
    Object.entries(ASSET_PATHS).map(async ([key, src]) => [key, await loadImage(src)])
  ).then(Object.fromEntries);
  const doors = loadAssetImageMap(NEW_DOOR_KEYS);
  const decor = resolveAssetGroups({
    pillars: Promise.all(PILLAR_KEYS.map((key) => loadOptionalImage(`./assets/${key}.png`))),
    blockPillars: Promise.all(PILLAR_BLOCK_KEYS.map((key) => loadOptionalImage(`./assets/${key}.png`))),
    floorTraps: Promise.all(FLOOR_TRAP_KEYS.map((key) => loadOptionalImage(`./assets/${key}.png`, { quiet: true }))),
    pits: loadAssetImageMap(PIT_ASSET_KEYS),
    underpasses: loadAssetImageMap(UNDERPASS_ASSETS),
    stairsDown: Promise.all(STAIR_DOWN_KEYS.map((key) => loadOptionalImage(`./assets/${key}.png`))),
    stairsUp: resolveAssetGroups(Object.fromEntries(["n", "e", "s", "w"].map((side) => [side, loadOptionalImage(`./assets/u-stair-${side}.png`)]))),
    waterCenter: loadOptionalImage("./assets/water-c.png"),
    waterByKey: loadAssetImageMap(WATER_ALL_KEYS),
    waterFlat: Promise.all(WATER_FLAT_KEYS.map((key) => loadOptionalImage(`./assets/${key}.png`, { quiet: true }))),
    waterDiagonal: Promise.all(WATER_DIAGONAL_KEYS.map((key) => loadOptionalImage(`./assets/${key}.png`, { quiet: true }))),
    rotundas: resolveAssetGroups(Object.fromEntries(Object.entries(ROTUNDA_VARIANTS).map(([size, paths]) => [size, loadOptionalImageList(paths)]))),
    corners: resolveAssetGroups(Object.fromEntries(Object.entries(CORNER_VARIANTS).map(([size, paths]) => [size, loadOptionalImageList(paths)]))),
    organic: loadOrganicImageMap(),
    innerWalls: loadInnerWallImageMap(),
    angledWalls: loadAngledWallImageMap(),
    canals: loadAssetImageMap(CANAL_KEYS),
    junk: loadAssetImageMap(JUNK_KEYS),
    wells: loadAssetImageMap(WELL_KEYS),
    crypts: loadAssetImageMap(CRYPT_ASSET_KEYS),
    reviewed: loadAssetImageMap([...REVIEWED_ASSET_KEYS, ...STATUE_ASSET_KEYS]),
    stealth: loadOptionalImage("./assets/stealth.png", { quiet: true }),
    campfire: loadOptionalImage('./assets/campfire.png', { quiet: true }),
    alarm: loadOptionalImage('./assets/alarm.png', { quiet: true })
  });
  Object.assign(rendererAssets, await resolveAssetGroups({ images, doors, decor }));
  rendererAssets.ready = true;
}


function drawTiledImage(ctx, image, widthPx, heightPx) {
  for (let y = 0; y < heightPx; y += image.height) {
    for (let x = 0; x < widthPx; x += image.width) {
      const sw = Math.min(image.width, widthPx - x);
      const sh = Math.min(image.height, heightPx - y);
      ctx.drawImage(image, 0, 0, sw, sh, x, y, sw, sh);
    }
  }
}

function drawHandDrawnBackground(ctx, widthPx, heightPx) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, widthPx, heightPx);
}

function getTileAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) {
    return null;
  }
  return state.tiles[y * state.map.width + x] || null;
}

function isWalkableTile(tile) {
  return tile?.type === TILE_TYPES.FLOOR;
}

function isOrganicDungeon(state) {
  const architecture = state?.generation?.architecture || {};
  return architecture.renderer === "organic" || architecture.pattern === "organic";
}

function isDoorOnRoomSide(state, room, side, offset) {
  return state.entities.some((entity) => {
    if (entity.subtype !== "door" || entity.roomId !== room.id) {
      return false;
    }
    if (side === "north") return entity.wallSide === side && entity.x === room.x + offset && entity.y === room.y - 1;
    if (side === "south") return entity.wallSide === side && entity.x === room.x + offset && entity.y === room.y + room.height;
    if (side === "west") return entity.wallSide === side && entity.x === room.x - 1 && entity.y === room.y + offset;
    return entity.wallSide === side && entity.x === room.x + room.width && entity.y === room.y + offset;
  });
}

function isRoomSideOpening(state, room, side, offset) {
  const x = side === 'west' ? room.x - 1 : side === 'east' ? room.x + room.width : room.x + offset;
  const y = side === 'north' ? room.y - 1 : side === 'south' ? room.y + room.height : room.y + offset;
  if (state.entities.some(door => door.subtype === 'door' && door.x === x && door.y === y && isClosedSecretDoor(door))) return false;
  if (isDoorOnRoomSide(state, room, side, offset)) {
    return true;
  }
  if (!routeExistsAt(state, x, y, '')) return false;
  let outside = null;
  if (side === "north") outside = getTileAt(state, room.x + offset, room.y - 1);
  if (side === "south") outside = getTileAt(state, room.x + offset, room.y + room.height);
  if (side === "west") outside = getTileAt(state, room.x - 1, room.y + offset);
  if (side === "east") outside = getTileAt(state, room.x + room.width, room.y + offset);
  return outside?.hallId && isWalkableTile(outside);
}

function collectSideRuns(state, room, side) {
  const count = side === "north" || side === "south" ? room.width : room.height;
  const runs = [];
  let runStart = null;

  for (let offset = 0; offset < count; offset += 1) {
    if (isRoomSideOpening(state, room, side, offset)) {
      if (runStart !== null) {
        runs.push({ side, start: runStart, length: offset - runStart });
        runStart = null;
      }
      continue;
    }
    if (runStart === null) {
      runStart = offset;
    }
  }

  if (runStart !== null) {
    runs.push({ side, start: runStart, length: count - runStart });
  }
  return runs;
}

function collectWallRuns(state) {
  return state.rooms.filter((room) => room.rotunda !== true && room.organic !== true && room.renderer !== "organic" && room.crypt !== true && !room.reviewedTemplate).flatMap((room) => (
    ["north", "south", "west", "east"].flatMap((side) => (
      collectSideRuns(state, room, side).map((run) => ({ ...run, room }))
    ))
  ));
}

function isOrganicHall(state, hallId) {
  return (state.halls || []).some((hall) => hall.id === hallId && (hall.organic === true || hall.style === "organic"));
}

function isHallFloorTile(state, tile) {
  return tile?.hallId && !tile.meta?.reviewed && tile.type === TILE_TYPES.FLOOR && tile.roomId === null && !isOrganicHall(state, tile.hallId);
}

function isHallPerimeterSide(state, tile, side) {
  const deltas = {
    north: [0, -1],
    south: [0, 1],
    west: [-1, 0],
    east: [1, 0]
  };
  const [dx, dy] = deltas[side];
  const neighbor = getTileAt(state, tile.x + dx, tile.y + dy);
  return !isWalkableTile(neighbor);
}

function getHallEdgeStart(tile, side) {
  if (side === "north") return { axis: "horizontal", x: tile.x, y: tile.y };
  if (side === "south") return { axis: "horizontal", x: tile.x, y: tile.y + 1 };
  if (side === "west") return { axis: "vertical", x: tile.x, y: tile.y };
  return { axis: "vertical", x: tile.x + 1, y: tile.y };
}

function compareHallEdges(a, b) {
  if (a.side !== b.side) return a.side.localeCompare(b.side);
  if (a.hallId !== b.hallId) return a.hallId.localeCompare(b.hallId);
  if (a.axis !== b.axis) return a.axis.localeCompare(b.axis);
  if (a.axis === "horizontal") {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  }
  if (a.x !== b.x) return a.x - b.x;
  return a.y - b.y;
}

function collectHallWallRuns(state) {
  const edges = [];
  for (const tile of state.tiles) {
    if (!isHallFloorTile(state, tile)) {
      continue;
    }
    for (const side of ["north", "south", "west", "east"]) {
      if (!isHallPerimeterSide(state, tile, side)) {
        continue;
      }
      edges.push({
        ...getHallEdgeStart(tile, side),
        side,
        hallId: tile.hallId
      });
    }
  }

  edges.sort(compareHallEdges);
  const runs = [];
  for (const edge of edges) {
    const previous = runs[runs.length - 1];
    const nextStart = edge.axis === "horizontal"
      ? previous?.x + previous?.length
      : previous?.y + previous?.length;
    const sameRun = previous &&
      previous.side === edge.side &&
      previous.hallId === edge.hallId &&
      previous.axis === edge.axis &&
      (
        edge.axis === "horizontal"
          ? previous.y === edge.y && nextStart === edge.x
          : previous.x === edge.x && nextStart === edge.y
      );

    if (sameRun) {
      previous.length += 1;
    } else {
      runs.push({ ...edge, length: 1, kind: "hall" });
    }
  }
  return runs;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sideToVector(side) {
  if (side === "north" || side === "n") return { x: 0, y: -1 };
  if (side === "east" || side === "e") return { x: 1, y: 0 };
  if (side === "south" || side === "s") return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function vectorToSide(x, y) {
  if (Math.abs(x) > Math.abs(y)) {
    return x >= 0 ? "e" : "w";
  }
  return y >= 0 ? "s" : "n";
}

function transformSideLabel(side, rotationTurns = 0, flipX = false, flipY = false) {
  let vector = sideToVector(side);
  if (flipX) {
    vector = { x: -vector.x, y: vector.y };
  }
  if (flipY) {
    vector = { x: vector.x, y: -vector.y };
  }
  let { x, y } = vector;
  for (let i = 0; i < ((rotationTurns % 4) + 4) % 4; i += 1) {
    const nextX = -y;
    const nextY = x;
    x = nextX;
    y = nextY;
  }
  return vectorToSide(x, y);
}

function parseExitKey(key) {
  const match = String(key || "").match(/rotunda\d+x\d+(?:-([nesw-]+))?(?:\.png)?$/i);
  if (!match) {
    return ["s"];
  }
  if (!match[1]) {
    return ["s"];
  }
  return match[1].split("-").filter(Boolean);
}

function parseCornerKey(key) {
  const match = String(key || "").match(/(?:b-)?round-corner-\d+x\d+-([nesw]{2})(?:\.png)?$/i);
  return [match ? match[1] : "sw"];
}

function transformCornerLabel(label, rotationTurns = 0, flipX = false, flipY = false) {
  const corners = {
    nw: { x: -1, y: -1 },
    ne: { x: 1, y: -1 },
    se: { x: 1, y: 1 },
    sw: { x: -1, y: 1 }
  };
  let vector = corners[label] || corners.sw;
  if (flipX) {
    vector = { x: -vector.x, y: vector.y };
  }
  if (flipY) {
    vector = { x: vector.x, y: -vector.y };
  }
  let { x, y } = vector;
  for (let i = 0; i < ((rotationTurns % 4) + 4) % 4; i += 1) {
    const nextX = -y;
    const nextY = x;
    x = nextX;
    y = nextY;
  }
  for (const [name, candidate] of Object.entries(corners)) {
    if (candidate.x === x && candidate.y === y) {
      return name;
    }
  }
  return "sw";
}

function pickSeededIndex(seedValue, length) {
  if (!length) {
    return 0;
  }
  return hashString(seedValue) % length;
}

function transformLabelList(labels, rotationTurns = 0, flipX = false, flipY = false, transformLabel = transformSideLabel) {
  return [...new Set((labels || []).map((label) => transformLabel(label, rotationTurns, flipX, flipY)))];
}

function chooseTransformedVariant(variants, targetLabels, seedValue, parseLabel, transformLabel = transformSideLabel, options = {}) {
  const target = [...new Set((targetLabels || []).filter(Boolean))].sort().join("-");
  const candidates = [];
  for (const variant of variants || []) {
    const sourceKey = variant?.key || variant?.sourceKey || "";
    const sourceLabels = [...new Set(parseLabel(sourceKey))].sort().join("-");
    for (const rotationTurns of [0, 1, 2, 3]) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const transformed = transformLabelList(parseLabel(sourceKey), rotationTurns, flipX, flipY, transformLabel)
            .sort()
            .join("-");
          if (transformed === target) {
            const transformCost = (rotationTurns === 0 ? 0 : 1) + (flipX ? 1 : 0) + (flipY ? 1 : 0);
            candidates.push({ variant, rotationTurns, flipX, flipY, sourceLabels, transformCost });
          }
        }
      }
    }
  }
  if (!candidates.length) {
    if (options.allowFallback === false) {
      return null;
    }
    const variant = variants?.[pickSeededIndex(seedValue, variants.length)] || null;
    return variant ? { variant, rotationTurns: 0, flipX: false, flipY: false } : null;
  }
  const ranked = options.preferSimpleTransforms === true
    ? candidates.filter((candidate) => candidate.transformCost === Math.min(...candidates.map((entry) => entry.transformCost)))
    : candidates;
  return ranked[pickSeededIndex(seedValue, ranked.length)];
}


function getWallDestination(run) {
  const { room, side, start, length } = run;
  const pixels = length * TILE_SIZE_PX;
  if (!room) {
    return {
      x: run.x * TILE_SIZE_PX,
      y: run.y * TILE_SIZE_PX,
      pixels,
      vertical: run.axis === "vertical",
      angle: run.axis === "vertical" ? Math.PI / 2 : 0
    };
  }
  if (side === "north") {
    return { x: (room.x + start) * TILE_SIZE_PX, y: room.y * TILE_SIZE_PX, pixels, vertical: false, angle: 0 };
  }
  if (side === "south") {
    return { x: (room.x + start) * TILE_SIZE_PX, y: (room.y + room.height) * TILE_SIZE_PX, pixels, vertical: false, angle: 0 };
  }
  if (side === "west") {
    return { x: room.x * TILE_SIZE_PX, y: (room.y + start) * TILE_SIZE_PX, pixels, vertical: true, angle: Math.PI / 2 };
  }
  return { x: (room.x + room.width) * TILE_SIZE_PX, y: (room.y + start) * TILE_SIZE_PX, pixels, vertical: true, angle: Math.PI / 2 };
}





function getRunNormal(run) {
  if (run.side === "north") return { x: 0, y: -1 };
  if (run.side === "south") return { x: 0, y: 1 };
  if (run.side === "west") return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function getRunEndpoints(run) {
  const dest = getWallDestination(run);
  if (dest.vertical) {
    return {
      start: { x: dest.x, y: dest.y },
      end: { x: dest.x, y: dest.y + dest.pixels },
      tangent: { x: 0, y: 1 },
      normal: getRunNormal(run),
      pixels: dest.pixels
    };
  }
  return {
    start: { x: dest.x, y: dest.y },
    end: { x: dest.x + dest.pixels, y: dest.y },
    tangent: { x: 1, y: 0 },
    normal: getRunNormal(run),
    pixels: dest.pixels
  };
}

function drawInkWallLine(ctx, run) {
  const edge = getRunEndpoints(run);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK_WALL_COLOR;
  ctx.lineWidth = Math.max(5, TILE_SIZE_PX * 0.13);
  ctx.beginPath();
  ctx.moveTo(edge.start.x, edge.start.y);
  ctx.lineTo(edge.end.x, edge.end.y);
  ctx.stroke();
  ctx.restore();
}

function drawWallHatching(ctx, state, run) {
  const edge = getRunEndpoints(run);
  if (edge.pixels <= HATCH_SPACING_PX) {
    return;
  }

  const runId = run.room?.id || run.hallId || "wall";
  const runStart = run.room ? run.start : `${run.x},${run.y}`;
  const jitterSeed = hashString(`${state.seed}:${runId}:${run.side}:${runStart}:hatch`);
  const direction = (jitterSeed % 2 === 0) ? 1 : -1;
  const strokeOffset = Math.max(4, TILE_SIZE_PX * 0.08);
  const hatchStart = Math.max(8, TILE_SIZE_PX * 0.16);
  const hatchLength = Math.max(10, Math.min(HATCH_LENGTH_PX, TILE_SIZE_PX * 0.35));
  const diagonal = {
    x: edge.normal.x * hatchLength + edge.tangent.x * hatchLength * 0.36 * direction,
    y: edge.normal.y * hatchLength + edge.tangent.y * hatchLength * 0.36 * direction
  };

  ctx.save();
  ctx.strokeStyle = HATCH_COLOR;
  ctx.lineWidth = Math.max(1.2, TILE_SIZE_PX * 0.035);
  ctx.lineCap = "round";
  for (let distance = HATCH_SPACING_PX; distance < edge.pixels; distance += HATCH_SPACING_PX) {
    const jitter = ((jitterSeed + distance * 17) % 5) - 2;
    const baseX = edge.start.x + edge.tangent.x * (distance + jitter) + edge.normal.x * hatchStart;
    const baseY = edge.start.y + edge.tangent.y * (distance + jitter) + edge.normal.y * hatchStart;
    ctx.beginPath();
    ctx.moveTo(baseX - edge.normal.x * strokeOffset, baseY - edge.normal.y * strokeOffset);
    ctx.lineTo(baseX + diagonal.x, baseY + diagonal.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWatabouInspiredWallOverlay(state, ctx, wallRuns) {
  for (const run of wallRuns) {
    if (run.length <= 0) {
      continue;
    }
    drawWallHatching(ctx, state, run);
  }
  for (const run of wallRuns) {
    if (run.length <= 0) {
      continue;
    }
    drawInkWallLine(ctx, run);
  }
}

function drawTileImage(
  ctx,
  image,
  x,
  y,
  rotationTurns = 0,
  widthTiles = 1,
  heightTiles = 1,
  offsetXPx = 0,
  offsetYPx = 0,
  flipX = false,
  flipY = false
) {
  if (!image) {
    return;
  }
  const width = widthTiles * TILE_SIZE_PX;
  const height = heightTiles * TILE_SIZE_PX;
  const px = x * TILE_SIZE_PX + offsetXPx;
  const py = y * TILE_SIZE_PX + offsetYPx;
  const turns = ((Number(rotationTurns) || 0) % 4 + 4) % 4;
  if (!turns && !flipX && !flipY) {
    ctx.drawImage(image, px, py, width, height);
    return;
  }
  ctx.save();
  ctx.translate(px + width / 2, py + height / 2);
  ctx.rotate(turns * Math.PI / 2);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawNativeTileImage(
  ctx,
  image,
  x,
  y,
  rotationTurns = 0,
  offsetXPx = 0,
  offsetYPx = 0,
  flipX = false,
  flipY = false
) {
  if (!image) {
    return;
  }
  const imageWidth = Number(image.naturalWidth || image.width || TILE_SIZE_PX) || TILE_SIZE_PX;
  const imageHeight = Number(image.naturalHeight || image.height || TILE_SIZE_PX) || TILE_SIZE_PX;
  const turns = ((Number(rotationTurns) || 0) % 4 + 4) % 4;
  const boundingWidth = turns % 2 === 1 ? imageHeight : imageWidth;
  const boundingHeight = turns % 2 === 1 ? imageWidth : imageHeight;
  const px = x * TILE_SIZE_PX + offsetXPx;
  const py = y * TILE_SIZE_PX + offsetYPx;
  if (!turns && !flipX && !flipY) {
    ctx.drawImage(image, px, py, imageWidth, imageHeight);
    return;
  }
  ctx.save();
  ctx.translate(px + boundingWidth / 2, py + boundingHeight / 2);
  ctx.rotate(turns * Math.PI / 2);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
  ctx.restore();
}

function drawSnappedWaterFlatTile(
  ctx,
  image,
  x,
  y,
  direction = "n",
  rotationTurns = 0,
  offsetXPx = 0,
  offsetYPx = 0,
  flipX = false,
  flipY = false
) {
  if (!image) {
    return;
  }
  const imageWidth = Number(image.naturalWidth || image.width || TILE_SIZE_PX) || TILE_SIZE_PX;
  const imageHeight = Number(image.naturalHeight || image.height || TILE_SIZE_PX * 1.5) || TILE_SIZE_PX * 1.5;
  const spillPx = Math.max(0, imageHeight - TILE_SIZE_PX);
  const tileX = Number(x) * TILE_SIZE_PX;
  const tileY = Number(y) * TILE_SIZE_PX;
  const normalizedDirection = String(direction || "n").toLowerCase();
  const turns = (cardinalToRotationTurns(normalizedDirection) + rotationTurns) % 4;

  let boxX = tileX;
  let boxY = tileY - spillPx;
  let boxWidth = imageWidth;
  let boxHeight = imageHeight;

  if (normalizedDirection === "s" || normalizedDirection === "south") {
    boxY = tileY;
  } else if (normalizedDirection === "e" || normalizedDirection === "east") {
    boxY = tileY;
    boxWidth = imageHeight;
    boxHeight = imageWidth;
  } else if (normalizedDirection === "w" || normalizedDirection === "west") {
    boxX = tileX - spillPx;
    boxY = tileY;
    boxWidth = imageHeight;
    boxHeight = imageWidth;
  }

  ctx.save();
  ctx.translate(boxX + offsetXPx + boxWidth / 2, boxY + offsetYPx + boxHeight / 2);
  ctx.rotate(turns * Math.PI / 2);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
  ctx.restore();
}

function cardinalToRotationTurns(cardinal) {
  if (cardinal === "e" || cardinal === "east") return 1;
  if (cardinal === "s" || cardinal === "south") return 2;
  if (cardinal === "w" || cardinal === "west") return 3;
  return 0;
}

function vectorToCardinal(vector, fallback = "n") {
  const x = Number(vector?.x) || 0;
  const y = Number(vector?.y) || 0;
  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? "e" : "w";
  }
  if (Math.abs(y) > 0) {
    return y > 0 ? "s" : "n";
  }
  return fallback;
}

function pickDeterministicImage(images, seedValue) {
  const usable = images.filter(Boolean);
  if (!usable.length) {
    return null;
  }
  return usable[hashString(seedValue) % usable.length];
}

function getImageTileSize(image) {
  if (!image) {
    return { widthTiles: 1, heightTiles: 1 };
  }
  const width = Number(image.naturalWidth || image.width || TILE_SIZE_PX) || TILE_SIZE_PX;
  const height = Number(image.naturalHeight || image.height || TILE_SIZE_PX) || TILE_SIZE_PX;
  return {
    widthTiles: width / TILE_SIZE_PX,
    heightTiles: height / TILE_SIZE_PX
  };
}

function getWaterImageAndRotation(tile, state) {
  const assetKey = String(tile?.assetKey || tile?.asset || tile?.key || "").toLowerCase();
  const exactImage = assetKey ? (rendererAssets.decor.waterByKey?.[assetKey] || null) : null;
  const variant = String(tile?.variant || tile?.shape || tile?.kind || "center").toLowerCase();
  const direction = String(tile?.direction || tile?.edge || tile?.corner || "n").toLowerCase();
  const seedValue = `${state.seed}:water:${tile.x},${tile.y}:${variant}`;
  const nudgeX = (Number(tile?.nudgeX) || 0) * TILE_SIZE_PX;
  const nudgeY = (Number(tile?.nudgeY) || 0) * TILE_SIZE_PX;
  const rotationTurns = Number(tile?.rotationTurns || tile?.rotation || 0) || 0;
  const flipX = tile?.flipX === true;
  const flipY = tile?.flipY === true;
  if (exactImage) {
    if (assetKey.startsWith("water-nw-")) {
      const rotationByCorner = { nw: 0, ne: 1, se: 2, sw: 3 };
      return {
        image: exactImage,
        rotationTurns: (rotationTurns + (rotationByCorner[direction] ?? 0)) % 4,
        offsetXPx: nudgeX,
        offsetYPx: nudgeY,
        flipX,
        flipY,
        ...getImageTileSize(exactImage)
      };
    }
    if (assetKey.startsWith("water-nn-")) {
      return {
        image: exactImage,
        rotationTurns,
        offsetXPx: nudgeX,
        offsetYPx: nudgeY,
        flipX,
        flipY,
        snappedFlat: true,
        direction,
        ...getImageTileSize(exactImage)
      };
    }
    return {
      image: exactImage,
      rotationTurns,
      offsetXPx: nudgeX,
      offsetYPx: nudgeY,
      flipX,
      flipY,
      ...getImageTileSize(exactImage)
    };
  }
  if (variant === "nw" || variant === "diagonal" || ["nw", "ne", "se", "sw"].includes(direction)) {
    const rotationByCorner = { nw: 0, ne: 1, se: 2, sw: 3 };
    const image = pickDeterministicImage(rendererAssets.decor.waterDiagonal, seedValue);
    return {
      image,
      rotationTurns: (rotationTurns + (rotationByCorner[direction] ?? 0)) % 4,
      offsetXPx: nudgeX,
      offsetYPx: nudgeY,
      flipX,
      flipY,
      ...getImageTileSize(image)
    };
  }
  if (variant === "nn" || variant === "edge" || variant === "flat" || ["n", "e", "s", "w"].includes(direction)) {
    const image = pickDeterministicImage(rendererAssets.decor.waterFlat, seedValue);
    return {
      image,
      rotationTurns,
      offsetXPx: nudgeX,
      offsetYPx: nudgeY,
      flipX,
      flipY: flipY || hashString(`${seedValue}:flip`) % 2 === 0,
      snappedFlat: true,
      direction,
      ...getImageTileSize(image)
    };
  }
  const image = rendererAssets.decor.waterCenter;
  return {
    image,
    rotationTurns,
    offsetXPx: nudgeX,
    offsetYPx: nudgeY,
    flipX,
    flipY,
    ...getImageTileSize(image)
  };
}

function drawWaterDecor(state, ctx) {
  const water = Array.isArray(state.decor?.water) ? state.decor.water : [];
  for (const tile of water) {
    if (!Number.isFinite(Number(tile?.x)) || !Number.isFinite(Number(tile?.y))) {
      continue;
    }
    const {
      image,
      rotationTurns,
      offsetXPx,
      offsetYPx,
      widthTiles,
      heightTiles,
      flipX,
      flipY,
      snappedFlat,
      direction
    } = getWaterImageAndRotation(tile, state);
    if (snappedFlat) {
      drawSnappedWaterFlatTile(
        ctx,
        image,
        Number(tile.x),
        Number(tile.y),
        direction,
        rotationTurns,
        offsetXPx,
        offsetYPx,
        flipX,
        flipY
      );
      continue;
    }
    drawTileImage(
      ctx,
      image,
      Number(tile.x),
      Number(tile.y),
      rotationTurns,
      widthTiles,
      heightTiles,
      offsetXPx,
      offsetYPx,
      flipX,
      flipY
    );
  }
}

function getRoomOpenings(room) {
  const openings = Array.isArray(room?.rotundaOpenings) && room.rotundaOpenings.length
    ? room.rotundaOpenings
    : [room?.rotundaOpening || room?.opening || "south"];
  return [...new Set(openings.map((opening) => String(opening).toLowerCase()))].filter(Boolean);
}

function getRotundaAssetSize(room) {
  const size = Number(room?.rotundaSize || room?.width || room?.height || 7);
  return size === 5 ? 5 : 7;
}

function getRotundaArtFootprint(room) {
  const size = getRotundaAssetSize(room);
  if (size === 5) {
    return {
      size,
      x: Number(room.x),
      y: Number(room.y),
      drawSize: 5
    };
  }
  return {
    size,
    x: Number(room.x) - 1,
    y: Number(room.y) - 1,
    drawSize: 9
  };
}

function drawRotundaDecor(state, ctx) {
  for (const room of state.rooms || []) {
    if (room.rotunda !== true) {
      continue;
    }
    const size = getRotundaAssetSize(room);
    const variants = rendererAssets.decor.rotundas[size]?.length
      ? rendererAssets.decor.rotundas[size]
      : rendererAssets.decor.rotundas[7];
    const openings = getRoomOpenings(room);
    const targetLabels = openings.map((opening) => {
      if (opening === "north" || opening === "n") return "n";
      if (opening === "east" || opening === "e") return "e";
      if (opening === "south" || opening === "s") return "s";
      return "w";
    });
    const chosen = chooseTransformedVariant(
      variants,
      targetLabels.length ? targetLabels : ["s"],
      `${state.seed}:rotunda:${room.id}:${openings.join("-")}`,
      parseExitKey,
      transformSideLabel,
      { allowFallback: false, preferSimpleTransforms: true }
    );
    if (!chosen?.variant?.image) {
      continue;
    }
    const footprint = getRotundaArtFootprint(room);
    drawTileImage(
      ctx,
      chosen.variant.image,
      footprint.x,
      footprint.y,
      chosen.rotationTurns,
      footprint.drawSize,
      footprint.drawSize,
      0,
      0,
      chosen.flipX,
      chosen.flipY
    );
  }
}

function drawRoundedCornerDecor(state, ctx) {
  if (!ROUND_CORNERS_ENABLED) {
    return;
  }
  for (const room of state.rooms || []) {
    const cornerSize = Number(room.cornerSize || 0);
    if (cornerSize !== 1 || room.rotunda === true) {
      continue;
    }
    const variants = rendererAssets.decor.corners[cornerSize] || rendererAssets.decor.corners[1] || [];
    if (!variants.length) {
      continue;
    }
    const placements = [
      { label: "nw", x: Number(room.x), y: Number(room.y) },
      { label: "ne", x: Number(room.x + room.width - cornerSize), y: Number(room.y) },
      { label: "se", x: Number(room.x + room.width - cornerSize), y: Number(room.y + room.height - cornerSize) },
      { label: "sw", x: Number(room.x), y: Number(room.y + room.height - cornerSize) }
    ];
    for (const placement of placements) {
      const exact = variants.find((variant) => parseCornerKey(variant.key)[0] === placement.label);
      if (!exact?.image) {
        continue;
      }
      drawTileImage(
        ctx,
        exact.image,
        placement.x,
        placement.y,
        0,
        cornerSize,
        cornerSize,
        0,
        0,
        false,
        false
      );
    }
  }
}

function drawColumnDecor(state, ctx) {
  const columns = Array.isArray(state.decor?.columns) ? state.decor.columns : [];
  for (const column of columns) {
    if (!Number.isFinite(Number(column?.x)) || !Number.isFinite(Number(column?.y))) {
      continue;
    }
    const style = String(column.style || column.type || "").toLowerCase();
    const pool = style === "b" || style === "block" ? rendererAssets.decor.blockPillars : rendererAssets.decor.pillars;
    const image = pickDeterministicImage(pool, `${state.seed}:pillar:${style}:${column.x},${column.y}`);
    const placement = String(column.placement || "center");
    const drawX = placement === "vertex" ? Number(column.x) - 0.5 : Number(column.x);
    const drawY = placement === "vertex" ? Number(column.y) - 0.5 : Number(column.y);
    drawTileImage(ctx, image, drawX, drawY, 0);
  }
}

function drawPlacedDecorList(state, ctx, placements, imageMap) {
  for (const placement of placements || []) {
    if (!Number.isFinite(Number(placement?.x)) || !Number.isFinite(Number(placement?.y))) {
      continue;
    }
    const key = String(placement.assetKey || placement.asset || "").replace(/\.png$/i, "");
    const image = imageMap?.[key];
    if (!image) {
      continue;
    }
    const size = getImageTileSize(image);
    drawTileImage(
      ctx,
      image,
      Number(placement.x),
      Number(placement.y),
      Number(placement.rotationTurns || 0) || 0,
      Number(placement.widthTiles || size.widthTiles || 1) || 1,
      Number(placement.heightTiles || size.heightTiles || 1) || 1,
      (Number(placement.nudgeX) || 0) * TILE_SIZE_PX,
      (Number(placement.nudgeY) || 0) * TILE_SIZE_PX,
      placement.flipX === true,
      placement.flipY === true
    );
  }
}

function drawNativePlacedDecorList(state, ctx, placements, imageMap) {
  for (const placement of placements || []) {
    if (!Number.isFinite(Number(placement?.x)) || !Number.isFinite(Number(placement?.y))) {
      continue;
    }
    const key = String(placement.assetKey || placement.asset || "").replace(/\.png$/i, "");
    const image = imageMap?.[key];
    if (!image) {
      continue;
    }
    if (placement.gridWidthTiles && placement.gridHeightTiles) {
      // Match the workbench's grid anchor, including art slightly wider than whole cells.
      const nativeWidth = placement.gridWidthTiles * TILE_SIZE_PX;
      const nativeHeight = placement.gridHeightTiles * TILE_SIZE_PX;
      const turns = Number(placement.rotationTurns || 0);
      const width = turns % 2 ? nativeHeight : nativeWidth;
      const height = turns % 2 ? nativeWidth : nativeHeight;
      ctx.save();
      ctx.translate(Number(placement.x) * TILE_SIZE_PX + width / 2, Number(placement.y) * TILE_SIZE_PX + height / 2);
      ctx.rotate(turns * Math.PI / 2);
      ctx.scale(placement.flipX ? -1 : 1, placement.flipY ? -1 : 1);
      ctx.drawImage(image, -nativeWidth / 2, -nativeHeight / 2);
      ctx.restore();
      continue;
    }
    drawNativeTileImage(
      ctx,
      image,
      Number(placement.x),
      Number(placement.y),
      Number(placement.rotationTurns || 0) || 0,
      (Number(placement.nudgeX) || 0) * TILE_SIZE_PX,
      (Number(placement.nudgeY) || 0) * TILE_SIZE_PX,
      placement.flipX === true,
      placement.flipY === true
    );
  }
}

function drawCanalDecor(state, ctx) {
  drawPlacedDecorList(state, ctx, state.decor?.canals, rendererAssets.decor.canals);
}

function drawJunkDecor(state, ctx) {
  drawNativePlacedDecorList(state, ctx, state.decor?.junk, rendererAssets.decor.junk);
}

function drawWellDecor(state, ctx) {
  drawPlacedDecorList(state, ctx, state.decor?.wells, rendererAssets.decor.wells);
}

function drawOrganicTileDecor(state, ctx) {
  for (const tile of state.tiles || []) {
    const organic = getOrganicTileData(tile);
    if (!organic?.asset) {
      continue;
    }
    const key = organic.asset.replace(/\.png$/i, "");
    const image = rendererAssets.decor.organic[key];
    if (!image) {
      continue;
    }
    drawTileImage(
      ctx,
      image,
      tile.x,
      tile.y,
      organic.rotationTurns,
      1,
      1,
      0,
      0,
      organic.flipX,
      organic.flipY
    );
  }
}

function drawOrganicHallDecor(state, ctx) {
  drawPlacedDecorList(state, ctx, state.decor?.organicHalls, rendererAssets.decor.organic);
}

function organicOpenMaskCacheKey(organic) {
  const sides = organic?.sides || {};
  const corners = organic?.corners || {};
  return [
    organic?.asset || "",
    Number(organic?.rotationTurns || 0) || 0,
    organic?.flipX === true ? "fx" : "nx",
    organic?.flipY === true ? "fy" : "ny",
    sides.north || "x",
    sides.east || "x",
    sides.south || "x",
    sides.west || "x",
    corners.nw || "x",
    corners.ne || "x",
    corners.se || "x",
    corners.sw || "x"
  ].join("|");
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createOrganicShellUnderlay(image, organic) {
  const key = organicOpenMaskCacheKey(organic);
  if (organicShellUnderlayCache.has(key)) {
    return organicShellUnderlayCache.get(key);
  }
  const source = createCanvas(TILE_SIZE_PX, TILE_SIZE_PX);
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  drawTileImage(
    sourceCtx,
    image,
    0,
    0,
    organic.rotationTurns,
    1,
    1,
    0,
    0,
    organic.flipX,
    organic.flipY
  );
  const sourceData = sourceCtx.getImageData(0, 0, TILE_SIZE_PX, TILE_SIZE_PX);
  const output = createCanvas(TILE_SIZE_PX, TILE_SIZE_PX);
  const outputCtx = output.getContext("2d");
  const outputData = outputCtx.createImageData(TILE_SIZE_PX, TILE_SIZE_PX);
  const totalPixels = TILE_SIZE_PX * TILE_SIZE_PX;
  const seen = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let head = 0;
  let tail = 0;
  const add = (x, y) => {
    if (x < 0 || y < 0 || x >= TILE_SIZE_PX || y >= TILE_SIZE_PX) {
      return;
    }
    const index = y * TILE_SIZE_PX + x;
    if (seen[index] || sourceData.data[index * 4 + 3] >= ORGANIC_ALPHA_THRESHOLD) {
      return;
    }
    seen[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  const sides = organic?.sides || {};
  const corners = organic?.corners || {};
  for (let x = 0; x < TILE_SIZE_PX; x += 1) {
    if (sides.north === "x") add(x, 0);
    if (sides.south === "x") add(x, TILE_SIZE_PX - 1);
  }
  for (let y = 0; y < TILE_SIZE_PX; y += 1) {
    if (sides.west === "x") add(0, y);
    if (sides.east === "x") add(TILE_SIZE_PX - 1, y);
  }
  const cornerLimit = Math.min(ORGANIC_CORNER_ZONE_PX, TILE_SIZE_PX);
  const cornerRanges = {
    nw: [0, cornerLimit, 0, cornerLimit],
    ne: [TILE_SIZE_PX - cornerLimit, TILE_SIZE_PX, 0, cornerLimit],
    se: [TILE_SIZE_PX - cornerLimit, TILE_SIZE_PX, TILE_SIZE_PX - cornerLimit, TILE_SIZE_PX],
    sw: [0, cornerLimit, TILE_SIZE_PX - cornerLimit, TILE_SIZE_PX]
  };
  for (const [corner, [startX, endX, startY, endY]] of Object.entries(cornerRanges)) {
    if (corners[corner] !== "x") {
      continue;
    }
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        add(x, y);
      }
    }
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % TILE_SIZE_PX;
    const y = Math.floor(index / TILE_SIZE_PX);
    add(x + 1, y);
    add(x - 1, y);
    add(x, y + 1);
    add(x, y - 1);
  }
  for (let index = 0; index < totalPixels; index += 1) {
    if (!seen[index]) {
      continue;
    }
    const outputIndex = index * 4;
    outputData.data[outputIndex] = 255;
    outputData.data[outputIndex + 1] = 255;
    outputData.data[outputIndex + 2] = 255;
    outputData.data[outputIndex + 3] = 255;
  }
  outputCtx.putImageData(outputData, 0, 0);
  organicShellUnderlayCache.set(key, output);
  return output;
}

function drawOrganicShellUnderlay(ctx, tile) {
  const organic = getOrganicTileData(tile);
  if (!organic?.asset) {
    return;
  }
  const key = organic.asset.replace(/\.png$/i, "");
  const image = rendererAssets.decor.organic[key];
  if (!image) {
    return;
  }
  const underlay = createOrganicShellUnderlay(image, organic);
  const paper = createCanvas(TILE_SIZE_PX, TILE_SIZE_PX);
  const paperCtx = paper.getContext("2d");
  const floor = rendererAssets.images.floor;
  const x = tile.x * TILE_SIZE_PX;
  const y = tile.y * TILE_SIZE_PX;
  paperCtx.drawImage(floor, x % floor.width, y % floor.height, TILE_SIZE_PX, TILE_SIZE_PX, 0, 0, TILE_SIZE_PX, TILE_SIZE_PX);
  paperCtx.globalCompositeOperation = "destination-in";
  paperCtx.drawImage(underlay, 0, 0);
  ctx.drawImage(paper, x, y);
}

function drawInnerWallTileDecor(state, ctx) {
  for (const tile of state.tiles || []) {
    const innerWall = getInnerWallTileData(tile);
    if (!innerWall?.asset) {
      continue;
    }
    const key = innerWall.asset.replace(/\.png$/i, "");
    const image = rendererAssets.decor.innerWalls[key];
    if (!image) {
      continue;
    }
    drawTileImage(
      ctx,
      image,
      tile.x,
      tile.y,
      innerWall.rotationTurns,
      1,
      1,
      0,
      0,
      innerWall.flipX,
      innerWall.flipY
    );
  }
}

function drawAngledWallTileDecor(state, ctx) {
  for (const tile of state.tiles || []) {
    const angledWall = getAngledWallTileData(tile);
    if (!angledWall?.asset) {
      continue;
    }
    const key = angledWall.asset.replace(/\.png$/i, "");
    const image = rendererAssets.decor.angledWalls[key];
    if (!image) {
      continue;
    }
    drawTileImage(
      ctx,
      image,
      tile.x,
      tile.y,
      angledWall.rotationTurns,
      1,
      1,
      0,
      0,
      angledWall.flipX,
      angledWall.flipY
    );
  }
}

function drawHandDrawnTopology(state, ctx) {
  const floorImage = rendererAssets.images.floor;
  const organicFloor = isOrganicDungeon(state);
  ctx.fillStyle = '#000000';
  for (const tile of state.tiles) if (tile.meta?.cryptWall || tile.meta?.reviewedWall ||
      (organicFloor && (tile.type===TILE_TYPES.WALL || tile.type===TILE_TYPES.VOID))) {
    ctx.fillRect(tile.x * TILE_SIZE_PX, tile.y * TILE_SIZE_PX, TILE_SIZE_PX, TILE_SIZE_PX);
  }
  for (const tile of state.tiles) {
    if (!isWalkableTile(tile)) {
      continue;
    }
    const dx = tile.x * TILE_SIZE_PX;
    const dy = tile.y * TILE_SIZE_PX;
    if (organicFloor && tile?.meta?.organicShell === true) {
      drawOrganicShellUnderlay(ctx, tile);
      continue;
    }
    const sx = (dx % floorImage.width);
    const sy = (dy % floorImage.height);
    ctx.drawImage(floorImage, sx, sy, TILE_SIZE_PX, TILE_SIZE_PX, dx, dy, TILE_SIZE_PX, TILE_SIZE_PX);
  }
  drawWaterDecor(state, ctx);
  drawCanalDecor(state, ctx);
  drawRotundaDecor(state, ctx);
  drawWellDecor(state, ctx);
  drawJunkDecor(state, ctx);
  drawOrganicTileDecor(state, ctx);
  drawOrganicHallDecor(state, ctx);
  drawNativePlacedDecorList(state, ctx, state.decor?.crypts, rendererAssets.decor.crypts);
  drawNativePlacedDecorList(state, ctx, state.decor?.reviewed, rendererAssets.decor.reviewed);
  drawInnerWallTileDecor(state, ctx);

  const wallRuns = [
    ...collectWallRuns(state),
    ...collectHallWallRuns(state)
  ];
  drawRoundedCornerDecor(state, ctx);
  drawAngledWallTileDecor(state, ctx);
  if (USE_WATABOU_INK_OVERLAY) {
    drawWatabouInspiredWallOverlay(state, ctx, wallRuns);
  }
  drawColumnDecor(state, ctx);
  drawNativePlacedDecorList(state, ctx, (state.underpasses || []).flatMap(route => route.art.map(item => ({
    ...item, rotationTurns: item.turn, gridWidthTiles: item.w, gridHeightTiles: item.h
  }))), rendererAssets.decor.underpasses);
}

function getDoorBoundaryCenter(entity) {
  const size = TILE_SIZE_PX;
  const verticalWall = entity.orientation !== "horizontal";

  if (verticalWall) {
    const boundaryX = entity.hallDirection === "east" ? entity.x * size : (entity.x + 1) * size;
    return {
      x: boundaryX,
      y: entity.y * size + size / 2
    };
  }

  const boundaryY = entity.hallDirection === "south" ? entity.y * size : (entity.y + 1) * size;
  return {
    x: entity.x * size + size / 2,
    y: boundaryY
  };
}

function getRoomSideInwardOffset(entity) {
  const half = TILE_SIZE_PX / 2;
  if (entity.wallSide === "east") return { x: -half, y: 0 };
  if (entity.wallSide === "west") return { x: half, y: 0 };
  if (entity.wallSide === "south") return { x: 0, y: -half };
  return { x: 0, y: half };
}

function getDoorTileCenter(entity) {
  const size = TILE_SIZE_PX;
  return {
    x: entity.x * size + size / 2,
    y: entity.y * size + size / 2
  };
}

function getDoorTrap(state, door) {
  return state.entities.find((entity) => (
    entity.type === ENTITY_TYPES.TRAP &&
    entity.targetType === "door" &&
    entity.targetEntityId === door.id &&
    !entity.disarmed
  )) || null;
}


function getDoorVisualKind(state, door) {
  const explicit = String(door.doorKind || door.visualKind || "").toLowerCase();
  if (explicit) {
    return explicit;
  }
  const watabouType = Number(door.watabouDoorType ?? door.type);
  if (watabouType === 3) return "stairs-up";
  if (watabouType === 8 || watabouType === 9) return "stairs-down";
  if (watabouType === 5) return "gate";
  const trap = getDoorTrap(state, door);
  if (trap?.wasSprung || trap?.revealed || trap?.visible) {
    return "trap";
  }
  if (door.secret === true || door.isSecret === true) {
    return "secret";
  }
  if (door.gone === true || door.destroyed === true || door.doorState === "gone") {
    return "gone";
  }
  if (door.portcullis === true || door.doorState === "portcullis") {
    return "portcullis";
  }
  if (door.doorState === DOOR_STATES.OPEN) {
    return "open";
  }
  return "closed";
}

function getDoorDirectionCardinal(door) {
  const explicit = String(door.highestStep || door.directionName || door.cardinal || "").toLowerCase();
  const value = explicit || vectorToCardinal(door.dir || door.direction, door.wallSide || door.hallDirection || "n");
  if (value === "north") return "n";
  if (value === "east") return "e";
  if (value === "south") return "s";
  if (value === "west") return "w";
  return value || "n";
}

function drawStairSprite(entity, ctx, kind) {
  const cardinal = getDoorDirectionCardinal(entity);
  const center = getDoorBoundaryCenter(entity);
  const inward = getRoomSideInwardOffset(entity);
  const size = TILE_SIZE_PX;
  let image = null;
  let rotationTurns = 0;
  if (kind === "stairs-up") {
    image = rendererAssets.decor.stairsUp[cardinal] || rendererAssets.decor.stairsUp.n;
  } else {
    image = pickDeterministicImage(rendererAssets.decor.stairsDown, `stairs:${entity.id || ""}:${entity.x},${entity.y}`);
    rotationTurns = cardinalToRotationTurns(cardinal);
  }
  if (!image) {
    return false;
  }
  ctx.save();
  ctx.translate(center.x + inward.x, center.y + inward.y);
  ctx.rotate(rotationTurns * Math.PI / 2);
  ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();
  return true;
}

function getNewDoorSpriteKey(state, door) {
  const kind = getDoorVisualKind(state, door);
  if (kind === "gate" || kind === "portcullis") {
    return "door-portcullis";
  }
  if (kind === "gone") {
    return "door-gone";
  }
  if (door.doorState === DOOR_STATES.OPEN || kind === "open") {
    return "door-open";
  }
  return "door-closed";
}

function getSecretDoorRotationAngle(door) {
  if (door.wallSide === "north") {
    return Math.PI;
  }
  if (door.wallSide === "east") {
    return -Math.PI / 2;
  }
  if (door.wallSide === "west") {
    return Math.PI / 2;
  }
  return 0;
}

function getSecretDoorSpriteKey(door) {
  const baseKey = /^door-secret-\d+$/i.test(String(door.doorSpriteId || ""))
    ? door.doorSpriteId
    : "door-secret-1";
  if (door.doorState === DOOR_STATES.OPEN && rendererAssets.doors[`${baseKey}-open`]) {
    return `${baseKey}-open`;
  }
  return baseKey;
}

function isSecretDoorFoundMarkVisible(state, door) {
  if (door.secretFound !== true && door.revealed !== true) {
    return false;
  }
  if (state.visibility.visibleNow?.has?.(tileKey(door.x, door.y))) {
    return true;
  }
  const roomTile = getSecretDoorRoomTile(door);
  if (state.visibility.visibleNow?.has?.(tileKey(roomTile.x, roomTile.y))) {
    return true;
  }
  const visibleSides = state.visibility.closedDoorVisibleSides?.get?.(door.id);
  return visibleSides instanceof Set && visibleSides.size > 0;
}

function getSecretDoorRoomTile(door) {
  if (door.wallSide === "east") {
    return { x: door.x - 1, y: door.y };
  }
  if (door.wallSide === "west") {
    return { x: door.x + 1, y: door.y };
  }
  if (door.wallSide === "south") {
    return { x: door.x, y: door.y - 1 };
  }
  return { x: door.x, y: door.y + 1 };
}

function drawSecretDoorSprite(state, entity, ctx) {
  if (entity.secretFound !== true && entity.revealed !== true) {
    return;
  }
  const image = rendererAssets.doors[getSecretDoorSpriteKey(entity)];
  if (!image) {
    drawDoorFallback(state, entity, ctx);
    return;
  }
  const center = getDoorBoundaryCenter(entity);
  if (entity.doorState === DOOR_STATES.OPEN) {
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(getSecretDoorRotationAngle(entity));
    ctx.drawImage(image, -image.width / 2, -image.height / 2, image.width, image.height);
    ctx.restore();
  }

  const foundImage = rendererAssets.doors["door-secret-found"];
  if (foundImage && isSecretDoorFoundMarkVisible(state, entity)) {
    const rect = secretFoundMarkerRect(entity, foundImage.width, foundImage.height);
    ctx.drawImage(foundImage, rect.x, rect.y, rect.width, rect.height);
  }
}

function drawDoorFallback(state, entity, ctx) {
  const center = getDoorBoundaryCenter(entity);
  const size = TILE_SIZE_PX;
  const thickness = Math.max(4, size * 0.12);
  const length = size * 0.72;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(doorRotationAngle(entity));
  ctx.fillStyle = entity.doorState === DOOR_STATES.OPEN ? "#c99a57" : "#2b160d";
  if (getDoorTrap(state, entity)?.revealed) {
    ctx.fillStyle = "#4b1a4f";
  }
  ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
  ctx.restore();
}

function drawDoorSprite(state, entity, ctx) {
  const visualKind = getDoorVisualKind(state, entity);
  if (visualKind === "stairs-up" || visualKind === "stairs-down") {
    if (drawStairSprite(entity, ctx, visualKind)) {
      return;
    }
  }
  if (entity.secret === true || entity.isSecret === true) {
    drawSecretDoorSprite(state, entity, ctx);
    return;
  }
  const newKey = getNewDoorSpriteKey(state, entity);
  const image = rendererAssets.doors[newKey];
  if (!image) {
    drawDoorFallback(state, entity, ctx);
    return;
  }

  const center = getDoorTileCenter(entity);
  const size = TILE_SIZE_PX;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(doorRotationAngle(entity));
  ctx.drawImage(image, -size / 2, -size / 2, size, size);
  ctx.restore();
}


function drawFloorTrapSprite(state, entity, ctx) {
  const image = pickDeterministicImage(
    rendererAssets.decor.floorTraps,
    `${state.seed}:floor-trap:${entity.id || ""}:${entity.x},${entity.y}`
  );
  if (!image) {
    return false;
  }
  drawTileImage(ctx, image, entity.x, entity.y, 0);
  return true;
}

function drawEntity(entity, ctx, state) {
  const [cx,cy]=visualTilePoint(state,entity.x,entity.y).map(value=>value*TILE_SIZE_PX);
  const radius = TILE_SIZE_PX * (entity.impersonatedCharacter ? 0.27 : 0.24);

  if (entity.subtype === "door") {
    if(entity.hiddenStairSprite)return;
    drawDoorSprite(state, entity, ctx);
    return;
  }

  if (entity.type === ENTITY_TYPES.TRAP && entity.targetType !== "door") {
    if (drawFloorTrapSprite(state, entity, ctx)) {
      return;
    }
  }

  if (entity.subtype === "dropped-equipment" && Number(entity.lightRadius) > 0) {
    ctx.save();
    const isLantern = entity.lightSource === "lantern";
    ctx.fillStyle = "rgba(255, 209, 78, 0.22)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.9, 0, Math.PI * 2);
    ctx.fill();
    if (isLantern) {
      ctx.fillStyle = "#9ea3aa";
      ctx.strokeStyle = "#ffd14e";
      ctx.lineWidth = Math.max(1, TILE_SIZE_PX * 0.05);
      ctx.fillRect(cx - radius * 0.65, cy - radius * 0.8, radius * 1.3, radius * 1.55);
      ctx.strokeRect(cx - radius * 0.65, cy - radius * 0.8, radius * 1.3, radius * 1.55);
      ctx.fillStyle = "#ffd14e";
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#6f2d16";
      ctx.lineWidth = Math.max(2, TILE_SIZE_PX * 0.08);
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.45, cy + radius * 0.85);
      ctx.lineTo(cx + radius * 0.35, cy - radius * 0.65);
      ctx.stroke();
      ctx.fillStyle = "#ffd14e";
      ctx.beginPath();
      ctx.arc(cx + radius * 0.42, cy - radius * 0.82, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c53320";
      ctx.beginPath();
      ctx.arc(cx + radius * 0.42, cy - radius * 0.82, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const isCorpseLoot = entity.corpseLoot === true || entity.gearItem?.corpseLoot === true || entity.subtype === "corpse-loot";
  const isWorthlessLoot = entity.worthlessLoot === true || entity.gearItem?.worthlessLoot === true || entity.subtype === "worthless-loot";

  if (isCorpseLoot) {
    ctx.save();
    ctx.fillStyle = "#3c3c3c";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b01515";
    ctx.lineWidth = Math.max(3, TILE_SIZE_PX * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.55, cy - radius * 0.55);
    ctx.lineTo(cx + radius * 0.55, cy + radius * 0.55);
    ctx.moveTo(cx + radius * 0.55, cy - radius * 0.55);
    ctx.lineTo(cx - radius * 0.55, cy + radius * 0.55);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (isWorthlessLoot) {
    ctx.fillStyle = "#82cfff";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  switch (entity.type) {
    case ENTITY_TYPES.MONSTER:
      ctx.fillStyle = entity.mimicDisguise && !entity.disguiseRevealed ? '#e0bc2f' :
        entity.impersonatedCharacter?.colorValue || (entity.hostile || ['combat','hostile'].includes(entity.attitude) ? '#be2d2d' : '#df9696');
      break;
    case ENTITY_TYPES.TREASURE:
      ctx.fillStyle = "#e0bc2f";
      break;
    case ENTITY_TYPES.TRAP:
      ctx.fillStyle = "#a22dcf";
      break;
    default:
      ctx.fillStyle = "#4db1a7";
      break;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  if (entity.type === ENTITY_TYPES.MONSTER && isInvisible(entity)) {
    ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=3;ctx.stroke();
  } else ctx.fill();
}

function drawObjects(state, ctx, options = {}) {
  for (const pit of state.entities.filter(pitIsOpen)) {
    for (const cell of pitArt(state, pit)) {
      const x = cell.x * TILE_SIZE_PX, y = cell.y * TILE_SIZE_PX, size = TILE_SIZE_PX;
      const image = cell.asset && rendererAssets.decor.pits?.[cell.asset];
      if (image) ctx.drawImage(image, x, y, size, size);
      else {
        ctx.fillStyle = '#000000'; ctx.fillRect(x, y, size, size);
        for (const side of cell.sides) {
          const edge = rendererAssets.decor.pits?.[`pit-${side}`];
          if (!edge) continue;
          ctx.save(); ctx.beginPath();
          ctx.rect(x + (side === 'e' ? size * .68 : 0), y + (side === 's' ? size * .68 : 0),
            ['e', 'w'].includes(side) ? size * .32 : size, ['n', 's'].includes(side) ? size * .32 : size);
          ctx.clip(); ctx.clearRect(x, y, size, size); ctx.drawImage(edge, x, y, size, size); ctx.restore();
        }
      }
    }
  }
  for (const entity of state.entities) {
    if (pitIsOpen(entity)) continue;
    if (entity.subtype === 'arcane-shred' || entity.closed && entity.subtype === 'arcane-gate') continue;
    if (entity.type === ENTITY_TYPES.MONSTER && (options.darkness === true || !options.visibleMonsterIds.has(entity.id))) continue;
    if (entity.visible === false) {
      continue;
    }
    if (
      options.darkness === true &&
      entity.type === ENTITY_TYPES.FEATURE &&
      entity.subtype !== "door" &&
      entity.darknessRevealed !== true
    ) {
      continue;
    }
    if (entity.type === ENTITY_TYPES.MONSTER && entity.defeated) {
      continue;
    }
    if (entity.type === ENTITY_TYPES.TREASURE && entity.collected) {
      continue;
    }
    if (entity.type === ENTITY_TYPES.FEATURE && entity.collected) {
      continue;
    }
    ctx.save();
    if (isIncorporeal(entity)) ctx.globalAlpha *= .5;
    if (routeOf(state, entity)) ctx.globalAlpha *= UNDERPASS_OPACITY;
    drawEntity(entity, ctx, state);
    ctx.restore();
  }
}

function drawPlayer(state, ctx) {
  ctx.save();
  if (routeOf(state, state.player)) ctx.globalAlpha *= UNDERPASS_OPACITY;
  const [cx,cy]=visualTilePoint(state,state.player.x,state.player.y).map(value=>value*TILE_SIZE_PX);
  const radius = TILE_SIZE_PX * 0.27;
  ctx.fillStyle = "#3a7bd5";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawCharacterDot(character, ctx, isActive, state) {
  ctx.save();
  if (isIncorporeal(character)) ctx.globalAlpha *= .5;
  if (character.visualRouteId ?? routeOf(state, character)) ctx.globalAlpha *= UNDERPASS_OPACITY;
  const [cx,cy]=visualTilePoint(state,character.visualX ?? character.x,character.visualY ?? character.y).map(value=>value*TILE_SIZE_PX);
  const radius = TILE_SIZE_PX * 0.27;
  ctx.fillStyle = character.colorValue || "#174a9c";
  if (isFloatingDisc(character)) {
    const caster = state.characters.find(member => member.id === character.summon.casterId);
    ctx.fillStyle = FLOATING_DISC_COLOR;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = isActive ? '#fff' : caster?.colorValue || '#fff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  if (isInvisible(character)) {
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, radius - 1.5, 0, Math.PI * 2); ctx.stroke();
  }
  else ctx.fill();

  if (hasWizardEffect(character, 'purple-glow')) {
    ctx.save();
    ctx.strokeStyle = '#d342f5';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (character.guarding && !isInvisible(character)) {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  if (isActive) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (character.stealthed === true && !isInvisible(character)) {
    const image = rendererAssets.decor.stealth;
    const size = TILE_SIZE_PX * 0.74;
    if (image) {
      ctx.save();
      ctx.globalAlpha *= 0.9;
      ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
    } else {
      ctx.strokeStyle = "#1f1f1f";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE_PX * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

function drawRestScene(state, ctx, options) {
  const rest = state.rest, scene = rest?.scene;
  if (!scene || !rest.suppliesPaid || !(['sleeping', 'interrupted', 'voting'].includes(rest.phase) || options.restSceneVisible)) return;
  if (options.restSceneVisible) {
    // Keep the camp visible even when every character is asleep, without
    // granting sleeping characters sight or revealing unexplored tiles.
    const polygon = computeLightPolygon(state, { x: scene.x, y: scene.y, radius: 6 });
    if (polygon.length) {
      ctx.save();
      clipToFloorTiles(ctx, state, tile => tile.roomId === rest.roomId && state.visibility.exploredEver.has(tileKey(tile.x, tile.y)));
      addShadowPolygonPath(ctx, polygon); ctx.clip();
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
  }
  const stamp = (image, point, rotation = 0) => {
    if (!image) return;
    ctx.save();
    ctx.translate((point.x + .5) * TILE_SIZE_PX, (point.y + .5) * TILE_SIZE_PX);
    ctx.rotate(rotation * Math.PI / 2);
    ctx.drawImage(image, -TILE_SIZE_PX / 2, -TILE_SIZE_PX / 2, TILE_SIZE_PX, TILE_SIZE_PX);
    ctx.restore();
  };
  stamp(rendererAssets.decor.campfire, scene);
  for (const marker of restTourFrame(scene, options.restNow).markers) stamp(rendererAssets.decor.alarm, marker, marker.rotation);
}

function drawCharacters(state, ctx) {
  const characters = (state.characters || []).filter((character) => (
    character.dead !== true &&
    character.slain !== true &&
    character.x !== null &&
    character.x !== undefined &&
    character.y !== null &&
    character.y !== undefined &&
    Number.isFinite(Number(character.x)) &&
    Number.isFinite(Number(character.y))
  ));
  if (!characters.length) {
    if (!state.sharedRoom) drawPlayer(state, ctx);
    return;
  }
  for (const character of characters) {
    if (state.underpasses?.length && state.viewerCharacterIds instanceof Set && !state.viewerCharacterIds.has(character.id) &&
        !state.visibility.routeVisible?.[routeOf(state, character)]?.has(tileKey(character.x, character.y))) continue;
    drawCharacterDot(character, ctx, character.id === state.activeCharacterId, state);
  }
}



function drawFog(state, ctx, widthPx, heightPx, forceBlackout) {
  if (forceBlackout) {
    for (const tile of state.tiles) {
      const key = tileKey(tile.x, tile.y);
      const px = tile.x * TILE_SIZE_PX;
      const py = tile.y * TILE_SIZE_PX;
      ctx.fillStyle = state.visibility.exploredEver.has(key)
        ? "rgba(0, 0, 0, 0.82)"
        : "rgba(0, 0, 0, 1)";
      ctx.fillRect(px, py, TILE_SIZE_PX, TILE_SIZE_PX);
    }
    return;
  }

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, widthPx, heightPx);
  drawExploredFog(state, ctx);
  drawAngledShadowWedges(state, ctx);
  drawVisibleBlockingDecorFogCutouts(state, ctx);
  drawClosedDoorFogBisectors(state, ctx);
  for (const zone of suppressionZones(state)) {
    const [cx, cy] = visualTilePoint(state, zone.x, zone.y).map(value => value * TILE_SIZE_PX);
    ctx.save();
    if (state.underpasses?.length) clipToFloorTiles(ctx, state, tile => routeExistsAt(state, tile.x, tile.y, zone.routeId) &&
      !Object.entries(state.visibility.routeVisible || {}).some(([id, cells]) => id !== zone.routeId && cells.has(tileKey(tile.x, tile.y))));
    ctx.beginPath();
    ctx.arc(cx, cy, (zone.radius + 0.5) * TILE_SIZE_PX, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, widthPx, heightPx);
    drawExploredFog(state, ctx);
    ctx.restore();
  }
}

function wasExploredBeforeCurrentLight(state, x, y) {
  const explored = state.visibility.exploredBeforeNow instanceof Set
    ? state.visibility.exploredBeforeNow
    : state.visibility.exploredEver;
  return explored.has(tileKey(x, y));
}

function addShadowPolygonPath(ctx, points) {
  if (!points.length) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index][0], points[index][1]);
  }
  ctx.closePath();
}

function drawShadowPolygon(ctx, points) {
  if (!points.length) {
    return;
  }
  addShadowPolygonPath(ctx, points);
  ctx.fill();
}

function clipToFloorTiles(ctx, state, predicate) {
  ctx.beginPath();
  for (const tile of state.tiles || []) {
    if (!predicate(tile) || tile.type === TILE_TYPES.WALL || tile.type === TILE_TYPES.VOID) {
      continue;
    }
    ctx.rect(tile.x * TILE_SIZE_PX, tile.y * TILE_SIZE_PX, TILE_SIZE_PX, TILE_SIZE_PX);
  }
  addRotundaClipPaths(ctx, state, predicate);
  ctx.clip();
}

function hasRotundaClipTile(state, room, predicate) {
  for (let y = Number(room.y); y < Number(room.y + room.height); y += 1) {
    for (let x = Number(room.x); x < Number(room.x + room.width); x += 1) {
      const tile = getTileAt(state, x, y);
      if (tile && predicate(tile) && tile.type !== TILE_TYPES.WALL && tile.type !== TILE_TYPES.VOID) {
        return true;
      }
    }
  }
  return false;
}

function addRotundaFiveClipPath(ctx, room, footprint) {
  const openings = new Set(getRoomOpenings(room).map((opening) => String(opening || "")[0]));
  const rects = [
    [footprint.x + 1, footprint.y + 1, 3, 3]
  ];
  if (openings.has("n")) rects.push([footprint.x + 2, footprint.y, 1, 1]);
  if (openings.has("s")) rects.push([footprint.x + 2, footprint.y + 4, 1, 1]);
  if (openings.has("w")) rects.push([footprint.x, footprint.y + 2, 1, 1]);
  if (openings.has("e")) rects.push([footprint.x + 4, footprint.y + 2, 1, 1]);
  for (const [x, y, width, height] of rects) {
    ctx.rect(
      x * TILE_SIZE_PX,
      y * TILE_SIZE_PX,
      width * TILE_SIZE_PX,
      height * TILE_SIZE_PX
    );
  }
}

function addRotundaClipPaths(ctx, state, predicate) {
  for (const room of state.rooms || []) {
    if (room.rotunda !== true || !hasRotundaClipTile(state, room, predicate)) {
      continue;
    }
    const footprint = getRotundaArtFootprint(room);
    if (footprint.size === 5) {
      addRotundaFiveClipPath(ctx, room, footprint);
      continue;
    }
    const centerX = (footprint.x + footprint.drawSize / 2) * TILE_SIZE_PX;
    const centerY = (footprint.y + footprint.drawSize / 2) * TILE_SIZE_PX;
    const radius = (footprint.size / 2) * TILE_SIZE_PX;
    ctx.moveTo(centerX + radius, centerY);
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  }
}

function drawCutoutPolygon(ctx, points) {
  drawShadowPolygon(ctx, points);
}

function drawFogRect(ctx, x, y, width, height, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, y, width, height);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function clearFogRect(ctx, x, y, width, height) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawFogPolygon(ctx, points, alpha) {
  if (!Array.isArray(points) || points.length < 3) {
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  drawShadowPolygon(ctx, points);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  drawShadowPolygon(ctx, points);
  ctx.restore();
}

function isBlockingDecorFogTile(tile) {
  // Organic floor visibility follows the contour, never the whole movement-blocking cell.
  if (tile?.meta?.neverExplore === true || getOrganicTileData(tile)) {
    return false;
  }
  const innerWall = getInnerWallTileData(tile);
  if (innerWall?.blocksMovement === true) {
    return false;
  }
  return isAngledWallLightBlockingTile(tile) ||
    isAngledWallMovementBlockingTile(tile);
}

function isInnerWallAdjacentToLiveLightSource(tile, lightSources) {
  if (!getInnerWallTileData(tile)?.blocksMovement) {
    return false;
  }
  return (lightSources || []).some((source) => {
    const dx = Math.abs(Number(source.x) - Number(tile.x));
    const dy = Math.abs(Number(source.y) - Number(tile.y));
    return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
  });
}

function drawVisibleBlockingDecorFogCutouts(state, ctx) {
  for (const tile of state.tiles || []) {
    if (!isBlockingDecorFogTile(tile) || !state.visibility.visibleNow.has(tileKey(tile.x, tile.y))) {
      continue;
    }
    clearFogRect(
      ctx,
      tile.x * TILE_SIZE_PX,
      tile.y * TILE_SIZE_PX,
      TILE_SIZE_PX,
      TILE_SIZE_PX
    );
  }
}

function drawAdjacentInnerWallFogCutouts(state, ctx, lightSources) {
  for (const tile of state.tiles || []) {
    if (!isInnerWallAdjacentToLiveLightSource(tile, lightSources)) {
      continue;
    }
    clearFogRect(
      ctx,
      tile.x * TILE_SIZE_PX,
      tile.y * TILE_SIZE_PX,
      TILE_SIZE_PX,
      TILE_SIZE_PX
    );
  }
}

function getExploredInnerWallInteriors(state) {
  if (state.visibility.exploredInnerWallInteriors instanceof Set) {
    return state.visibility.exploredInnerWallInteriors;
  }
  if (Array.isArray(state.visibility.exploredInnerWallInteriors)) {
    return new Set(state.visibility.exploredInnerWallInteriors);
  }
  return new Set();
}

function getVisitedRoomIds(state) {
  if (state.visibility.visitedRoomIds instanceof Set) {
    return state.visibility.visitedRoomIds;
  }
  if (Array.isArray(state.visibility.visitedRoomIds)) {
    return new Set(state.visibility.visitedRoomIds);
  }
  return new Set();
}

function isClosedDoorFogTile(state, tile) {
  return (state.entities || []).some((entity) => (
    entity.subtype === "door" &&
    entity.doorState !== DOOR_STATES.OPEN &&
    entity.x === tile.x &&
    entity.y === tile.y
  ));
}

function canUseCoarseExploredTileFog(state, visitedRoomIds, tile) {
  if (getInnerWallTileData(tile)?.blocksMovement === true || isOrganicMovementBlockingTile(tile)) {
    return false;
  }
  if (isClosedDoorFogTile(state, tile)) {
    return false;
  }
  if (!tile.roomId) {
    return true;
  }
  return visitedRoomIds.has(tile.roomId);
}

function drawExploredTileFog(state, ctx) {
  const visitedRoomIds = getVisitedRoomIds(state);
  for (const tile of state.tiles || []) {
    const key = tileKey(tile.x, tile.y);
    if (
      !wasExploredBeforeCurrentLight(state, tile.x, tile.y) ||
      state.visibility.visibleNow.has(key) ||
      !canUseCoarseExploredTileFog(state, visitedRoomIds, tile)
    ) {
      continue;
    }
    const px = tile.x * TILE_SIZE_PX;
    const py = tile.y * TILE_SIZE_PX;
    drawFogRect(ctx, px, py, TILE_SIZE_PX, TILE_SIZE_PX, EXPLORED_FOG_ALPHA);
  }
}

function drawExploredLightPolygonFog(state, ctx) {
  const polygons = Array.isArray(state.visibility.exploredLightPolygonsBeforeNow)
    ? state.visibility.exploredLightPolygonsBeforeNow
    : state.visibility.exploredLightPolygons;
  if (!Array.isArray(polygons) || !polygons.length) {
    return;
  }
  ctx.save();
  clipToFloorTiles(ctx, state, () => true);
  for (const polygon of polygons) {
    drawFogPolygon(ctx, polygon, EXPLORED_FOG_ALPHA);
  }
  ctx.restore();
}

function getColumnShadowRect(column) {
  if (!Number.isFinite(Number(column?.x)) || !Number.isFinite(Number(column?.y))) {
    return null;
  }
  const placement = String(column.placement || "center");
  const drawX = placement === "vertex" ? Number(column.x) - 0.5 : Number(column.x);
  const drawY = placement === "vertex" ? Number(column.y) - 0.5 : Number(column.y);
  const left = drawX * TILE_SIZE_PX + PILLAR_SHADOW_INSET_PX;
  const top = drawY * TILE_SIZE_PX + PILLAR_SHADOW_INSET_PX;
  return {
    left,
    top,
    right: left + PILLAR_SHADOW_SIZE_PX,
    bottom: top + PILLAR_SHADOW_SIZE_PX
  };
}

function getColumnShadowPolygon(source, column, radiusPx) {
  const rect = getColumnShadowRect(column);
  if (!rect) {
    return null;
  }
  const sourcePoint = [
    (Number(source.x) + 0.5) * TILE_SIZE_PX,
    (Number(source.y) + 0.5) * TILE_SIZE_PX
  ];
  if (
    sourcePoint[0] >= rect.left &&
    sourcePoint[0] <= rect.right &&
    sourcePoint[1] >= rect.top &&
    sourcePoint[1] <= rect.bottom
  ) {
    return null;
  }
  const center = [
    (rect.left + rect.right) / 2,
    (rect.top + rect.bottom) / 2
  ];
  if (Math.hypot(center[0] - sourcePoint[0], center[1] - sourcePoint[1]) > radiusPx + PILLAR_SHADOW_SIZE_PX) {
    return null;
  }
  const corners = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom]
  ].map((point) => ({
    point,
    angle: Math.atan2(point[1] - sourcePoint[1], point[0] - sourcePoint[0])
  })).sort((a, b) => a.angle - b.angle);
  let largestGap = -Infinity;
  let gapIndex = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index].angle;
    const next = corners[(index + 1) % corners.length].angle + (index === corners.length - 1 ? Math.PI * 2 : 0);
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = index;
    }
  }
  const start = corners[(gapIndex + 1) % corners.length];
  const end = corners[gapIndex];
  const startAngle = start.angle + (start.angle < end.angle ? Math.PI * 2 : 0);
  const endAngle = end.angle;
  const farStart = [
    sourcePoint[0] + Math.cos(startAngle) * radiusPx,
    sourcePoint[1] + Math.sin(startAngle) * radiusPx
  ];
  const farEnd = [
    sourcePoint[0] + Math.cos(endAngle) * radiusPx,
    sourcePoint[1] + Math.sin(endAngle) * radiusPx
  ];
  return [start.point, farStart, farEnd, end.point];
}

function drawCurrentPillarShadowFog(state, ctx) {
  const legacyOrganicPillars = (state.tiles || []).filter((tile) => (
    isOrganicPillarTile(tile) && !getReviewedTileRule(getOrganicTileData(tile)?.asset)
  ));
  const columns = [...(state.decor?.columns || []), ...legacyOrganicPillars];
  if (!columns.length) {
    return;
  }
  const lightSources = collectLightSources(state);
  if (!lightSources.length) {
    return;
  }
  for (const source of lightSources) {
    const radiusPx = (Math.max(1, Number(source.radius) || 6) + 0.5) * TILE_SIZE_PX;
    const unblockedByPillarsPolygon = computeLightPolygon(state, source, { ignorePillars: true });
    if (unblockedByPillarsPolygon.length < 3) {
      continue;
    }
    ctx.save();
    clipToFloorTiles(ctx, state, () => true);
    addShadowPolygonPath(ctx, unblockedByPillarsPolygon);
    ctx.clip();
    for (const column of columns) {
      const shadow = getColumnShadowPolygon(source, column, radiusPx);
      if (shadow?.length >= 3) {
        drawFogPolygon(ctx, shadow, EXPLORED_FOG_ALPHA);
      }
    }
    ctx.restore();
  }
}

function drawExploredInnerWallInteriorFog(state, ctx) {
  const exploredInnerWallInteriors = getExploredInnerWallInteriors(state);
  if (!exploredInnerWallInteriors.size) {
    return;
  }
  for (const tile of state.tiles || []) {
    if (!getInnerWallTileData(tile)?.blocksMovement) {
      continue;
    }
    if (!exploredInnerWallInteriors.has(tileKey(tile.x, tile.y))) {
      continue;
    }
    drawFogRect(
      ctx,
      tile.x * TILE_SIZE_PX,
      tile.y * TILE_SIZE_PX,
      TILE_SIZE_PX,
      TILE_SIZE_PX,
      EXPLORED_FOG_ALPHA
    );
  }
}

function drawExploredFog(state, ctx) {
  drawExploredTileFog(state, ctx);
  drawExploredLightPolygonFog(state, ctx);
  drawCurrentPillarShadowFog(state, ctx);
  drawExploredInnerWallInteriorFog(state, ctx);
}

function drawAngledShadowWedges(state, ctx) {
  const width = Number(state.map?.width || 0);
  const height = Number(state.map?.height || 0);
  if (width < 2 || height < 2) {
    return;
  }
  const lightSources = collectLightSources(state);
  const secretThresholds = new Set((state.entities || []).filter(isClosedSecretDoor).map(door => tileKey(door.x, door.y)));
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000000";
  ctx.globalAlpha = 1;
  for (const source of lightSources) {
    const polygon = computeLightPolygon(state, source);
    if (polygon.length < 3) {
      continue;
    }
    ctx.save();
    clipToFloorTiles(ctx, state, (tile) => (
      !secretThresholds.has(tileKey(tile.x, tile.y)) ||
      state.visibility.visibleNow.has(tileKey(tile.x, tile.y))
    ));
    drawCutoutPolygon(ctx, polygon);
    ctx.restore();
  }
  ctx.restore();
  drawAdjacentInnerWallFogCutouts(state, ctx, lightSources);
}

function drawClosedDoorFogBisectors(state, ctx) {
  const applyDoorHalfFog = (x, y, width, height, current, explored) => {
    if (current) {
      clearFogRect(ctx, x, y, width, height);
    } else if (explored) {
      drawFogRect(ctx, x, y, width, height, EXPLORED_FOG_ALPHA);
    } else {
      drawFogRect(ctx, x, y, width, height, UNEXPLORED_FOG_ALPHA);
    }
  };

  for (const door of state.entities || []) {
    // Ordinary doors use the exact reviewed light polygon, never rectangular half-tile fog.
    if (door.subtype !== "door" || !isClosedSecretDoor(door)) {
      continue;
    }
    if (door.secret === true && door.secretFound !== true && door.revealed !== true) {
      continue;
    }
    const visibleSides = state.visibility.closedDoorVisibleSides?.get?.(door.id) || new Set();
    const exploredSides = state.visibility.closedDoorExploredSides?.get?.(door.id) || new Set();
    if (!visibleSides.size && !exploredSides.size) {
      continue;
    }
    const px = door.x * TILE_SIZE_PX;
    const py = door.y * TILE_SIZE_PX;
    const half = TILE_SIZE_PX / 2;
    if (door.orientation !== "horizontal") {
      const leftVisible = visibleSides.has("left");
      const rightVisible = visibleSides.has("right");
      applyDoorHalfFog(px, py, half, TILE_SIZE_PX, leftVisible, exploredSides.has("left"));
      applyDoorHalfFog(px + half, py, half, TILE_SIZE_PX, rightVisible, exploredSides.has("right"));
      continue;
    }
    const topVisible = visibleSides.has("top");
    const bottomVisible = visibleSides.has("bottom");
    applyDoorHalfFog(px, py, TILE_SIZE_PX, half, topVisible, exploredSides.has("top"));
    applyDoorHalfFog(px, py + half, TILE_SIZE_PX, half, bottomVisible, exploredSides.has("bottom"));
  }
}

function drawCombatMovement(state, ctx, targeting = null) {
  const combat = state.combat;
  const entry = combat?.active ? combat.turnOrder?.[combat.turnIndex] : null;
  if (!targeting && (entry?.type !== 'character' || !(combat.movementRemaining > 0))) return;
  const actor = targeting?.actor || (targeting?.monsterId ? state.entities.find(entity => entity.id === targeting.monsterId) :
    state.characters.find(character => character.id === (targeting?.characterId || entry?.id)));
  if (!actor) return;
  const sources = collectLightSources(state);
  ctx.save();
  ctx.beginPath();
  for (const source of sources) {
    if (routeOf(state, source) !== routeOf(state, actor)) continue;
    const polygon = computeLightPolygon(state, source);
    if (!polygon.length) continue;
    ctx.moveTo(...polygon[0]);
    for (const point of polygon.slice(1)) ctx.lineTo(...point);
    ctx.closePath();
  }
  ctx.clip();
  const center = visualTilePoint(state, Number(actor.visualX ?? actor.x), Number(actor.visualY ?? actor.y));
  ctx.globalAlpha = .2;
  ctx.fillStyle = actor.colorValue || '#397ed9';
  for (const water of targeting ? [null] : [false, true]) {
    ctx.save();
    clipToFloorTiles(ctx, state, tile => routeExistsAt(state, tile.x, tile.y, routeOf(state, actor)) &&
      (state.underpasses?.length ? state.visibility.routeVisible?.[routeOf(state, actor)] : state.visibility.visibleNow)?.has(tileKey(tile.x, tile.y)) &&
      !isOrganicMovementBlockingTile(tile) && (!tile.meta?.layoutBlocks || isSlowWaterTile(state,tile.x,tile.y)) &&
      (water === null || isSlowWaterTile(state,tile.x,tile.y) === water) &&
      canMoveBetweenTiles(state, tile.x, tile.y, tile.x, tile.y, { routeId: routeOf(state, actor) }).ok);
    const radius = targeting ? rangeRadius(targeting.range) : combat.movementRemaining / (water ? 2 : 1);
    ctx.beginPath();
    ctx.arc(center[0] * TILE_SIZE_PX, center[1] * TILE_SIZE_PX, radius * TILE_SIZE_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  if (targeting) {
    ctx.save();
    ctx.strokeStyle = ['weapon','monster'].includes(targeting.kind) ? '#d62727' : targeting.kind === 'steal' ? '#777777' : '#fff4d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center[0] * TILE_SIZE_PX, center[1] * TILE_SIZE_PX, rangeRadius(targeting.range) * TILE_SIZE_PX, 0, Math.PI * 2);
    ctx.stroke();
    for (const monster of state.entities || []) {
      if (monster.type !== 'monster' || monster.visible === false || monster.defeated || monster.leftPeacefully ||
          !canTargetAtRange(state, actor, monster, targeting.range,{directAttack:targeting.kind==='weapon'||targeting.spellKey==='magic missile'})) continue;
      const point = visualTilePoint(state, monster.x, monster.y).map(value => value * TILE_SIZE_PX);
      ctx.beginPath();
      ctx.arc(point[0], point[1], TILE_SIZE_PX * .3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawProtectionAuras(state,ctx) {
  ctx.save(); ctx.strokeStyle='#b9e8ff'; ctx.lineWidth=1.5;
  for (const {center:target,radius} of protectionAuras(state)) {
    if (!state.visibility.visibleNow.has(tileKey(target.x,target.y))) continue;
    const center=visualTilePoint(state,Number(target.visualX??target.x),Number(target.visualY??target.y));
    ctx.beginPath();ctx.arc(center[0]*TILE_SIZE_PX,center[1]*TILE_SIZE_PX,rangeRadius(radius)*TILE_SIZE_PX,0,Math.PI*2);ctx.stroke();
  }
  ctx.strokeStyle = '#fff4d4'; ctx.lineWidth = 1;
  for (const caster of state.characters || []) if (caster.focusSpell?.spell === 'detect magic' && !caster.dead && !caster.slain) {
    const center = visualTilePoint(state, Number(caster.visualX ?? caster.x), Number(caster.visualY ?? caster.y));
    ctx.beginPath(); ctx.arc(center[0] * TILE_SIZE_PX, center[1] * TILE_SIZE_PX, caster.focusSpell.radius * TILE_SIZE_PX, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export function renderDungeon(state, layers, options = {}) {
  return withLightPolygonCache(state, () => drawDungeonFrame(state, layers, options), options.lightPolygons);
}

function drawDungeonFrame(state, layers, options) {
  const widthPx = state.map.width * TILE_SIZE_PX;
  const heightPx = state.map.height * TILE_SIZE_PX;
  const { backgroundCtx, topologyCtx, objectsCtx, fogCtx } = layers;
  if (!rendererAssets.ready && options.motionOnly !== true) {
    fogCtx.fillStyle = "#000000";
    fogCtx.fillRect(0, 0, widthPx, heightPx);
    return;
  }
  const now = options.now ?? performance.now();
  const secretWallKey = state.entities.filter(door => door.secret || door.isSecret).map(door => `${door.id}:${door.doorState}`).join('|');

  if (options.motionOnly !== true) {
    const previousTerrain = terrainFrames.get(topologyCtx);
    // Generated terrain stays fixed while tokens, doors, and fog use dynamic layers.
    if (!previousTerrain || previousTerrain.secretWallKey !== secretWallKey || previousTerrain.tiles !== state.tiles || previousTerrain.decor !== state.decor ||
        previousTerrain.rooms !== state.rooms || previousTerrain.ready !== rendererAssets.ready ||
        previousTerrain.entities !== state.entities || previousTerrain.seed !== state.seed ||
        previousTerrain.generation !== state.generation || previousTerrain.underpasses !== state.underpasses ||
        previousTerrain.width !== widthPx || previousTerrain.height !== heightPx) {
      drawHandDrawnBackground(backgroundCtx, widthPx, heightPx);
      topologyCtx.clearRect(0, 0, widthPx, heightPx);
      drawHandDrawnTopology(state, topologyCtx);
      terrainFrames.set(topologyCtx, { secretWallKey, tiles: state.tiles, decor: state.decor, rooms: state.rooms,
        entities: state.entities, seed: state.seed, generation: state.generation, underpasses: state.underpasses,
        ready: rendererAssets.ready, width: widthPx, height: heightPx });
    }
  }
  if (objectsCtx) {
    const monsters = options.forceBlackout ? [] : state.entities.filter(entity => entity.type === ENTITY_TYPES.MONSTER && isMonsterCurrentlyVisible(state, entity));
    const monsterKey = monsters.map(monster => `${monster.id}:${monster.x},${monster.y}`).join('|');
    const previousObjects = objectFrames.get(objectsCtx);
    if (options.motionOnly !== true || !previousObjects || previousObjects.monsterKey !== monsterKey ||
        previousObjects.entities !== state.entities || previousObjects.blackout !== Boolean(options.forceBlackout)) {
      objectsCtx.clearRect(0, 0, widthPx, heightPx);
      objectsCtx.__doorNow = now;
      drawObjects(state, objectsCtx, { darkness: options.forceBlackout === true, visibleMonsterIds: new Set(monsters.map(monster => monster.id)) });
      objectFrames.set(objectsCtx, { monsterKey, entities: state.entities, blackout: Boolean(options.forceBlackout) });
    }
  }
  fogCtx.clearRect(0, 0, widthPx, heightPx);
  drawFog(state, fogCtx, widthPx, heightPx, options.forceBlackout === true);
  if (!options.forceBlackout || options.targeting) drawCombatMovement(state, fogCtx, options.targeting);
  drawProtectionAuras(state,fogCtx);
  drawRestScene(state, fogCtx, options);
  fogCtx.save(); fogCtx.fillStyle = '#000';
  for (const shred of shredZones(state)) {
    fogCtx.save();
    if (state.underpasses?.length) clipToFloorTiles(fogCtx, state, tile => routeExistsAt(state, tile.x, tile.y, routeOf(state, shred)) &&
      !Object.entries(state.visibility.routeVisible || {}).some(([id, cells]) => id !== routeOf(state, shred) && cells.has(tileKey(tile.x, tile.y))));
    const center = visualTilePoint(state, shred.x, shred.y);
    fogCtx.beginPath(); fogCtx.arc(center[0] * TILE_SIZE_PX, center[1] * TILE_SIZE_PX, shred.radius * TILE_SIZE_PX, 0, Math.PI * 2); fogCtx.fill();
    fogCtx.restore();
  }
  fogCtx.restore();
  drawCharacters(state, fogCtx);
}
