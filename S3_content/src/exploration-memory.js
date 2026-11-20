import {organicExplorationArea} from './organic-exploration.js';
import clipping from "./vendor/polygon-clipping.js";
import { TILE_SIZE_PX, TILE_TYPES } from "./constants.js";
import {
  getInnerWallTileData,
  getInnerWallOpaqueBounds,
} from "./inner-walls.js";
import { isOrganicMovementBlockingTile } from "./organic-tiles.js";
import { doorExplorationSides, isDoorPassable } from "./door-geometry.js";
import { routeExistsAt, routeOf } from "./underpasses.js";

export const EXPLORATION_VERSION = 1;
export const EXPLORATION_LIGHT_VERSION = 13;
export const EXPLORATION_CHUNK_TILES = 8;
// Old saves did not attach a route to their polygons. Keep their already-known
// terrain in a render-only plane; never use this as current sight or targeting.
export const LEGACY_EXPLORATION_ROUTE = "@legacy";
const indexes = new WeakMap();
const regionIndexes = new WeakMap();
const processing = new WeakMap();
// Immutable partial shapes may survive many light passes. Do not repeat an exact
// completion test unless either the shape or the tile's required geometry changes.
const coverageChecks = new WeakMap();
const orientedPieces = new WeakMap();
const pieceIndexes = new WeakMap();
const own = (object, key) => Object.hasOwn(object, key);
const cellKey = (x, y) => x + "," + y;
export const explorationChunkKey = (x, y) =>
  Math.floor(x / EXPLORATION_CHUNK_TILES) +
  "," +
  Math.floor(y / EXPLORATION_CHUNK_TILES);
const square = (x, y) => [
  [
    [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ],
  ],
];
const emptyRoute = () => ({ complete: {}, partial: {}, rooms: {}, halls: {} });

export function createExplorationMemory() {
  return { version: EXPLORATION_VERSION, routes: {} };
}

function legacyCoarseFloor(state, legacyVisibility) {
  const explored = new Set(legacyVisibility.exploredEver || []),
    visited = new Set(legacyVisibility.visitedRoomIds || []);
  const interiors = new Set(legacyVisibility.exploredInnerWallInteriors || []);
  const closed = new Set(
    (state.entities || [])
      .filter((e) => e.subtype === "door" && !isDoorPassable(e))
      .map((e) => cellKey(e.x, e.y)),
  );
  const legacy = emptyRoute();
  for (const tile of state.tiles) {
    const key = cellKey(tile.x, tile.y);
    const wasCoarse =
      explored.has(key) &&
      !getInnerWallTileData(tile)?.blocksMovement &&
      !isOrganicMovementBlockingTile(tile) &&
      !closed.has(key) &&
      (!tile.roomId || visited.has(tile.roomId));
    if (
      tile.type === TILE_TYPES.FLOOR &&
      !tile.meta?.neverExplore &&
      (wasCoarse ||
        (interiors.has(key) && getInnerWallTileData(tile)?.blocksMovement))
    )
      legacy.complete[key] = true;
  }

  return legacy;
}

export function hydrateExplorationMemory(
  raw,
  state = null,
  legacyVisibility = null,
) {
  const memory = createExplorationMemory();
  if (
    raw == null &&
    state?.tiles &&
    legacyVisibility &&
    !legacyVisibility.exploredLightPolygons?.length
  ) {
    const legacy = legacyCoarseFloor(state, legacyVisibility);
    // Preserve only terrain the old coarse renderer already displayed. This plane
    // cannot certify completion of a new route-specific tile, room, or hall.
    if (Object.keys(legacy.complete).length)
      memory.routes[LEGACY_EXPLORATION_ROUTE] = legacy;
    return memory;
  }
  if (
    raw?.version !== EXPLORATION_VERSION ||
    !raw.routes ||
    typeof raw.routes !== "object"
  )
    return memory;
  for (const [id, data] of Object.entries(raw.routes)) {
    if (!data || typeof data !== "object") continue;
    const route = emptyRoute();
    for (const key of Object.keys(data.complete || {}))
      if (/^\d+,\d+$/.test(key) && data.complete[key] === true)
        route.complete[key] = true;
    for (const [key, shape] of Object.entries(data.partial || {})) {
      if (
        !/^\d+,\d+$/.test(key) ||
        own(route.complete, key) ||
        !Array.isArray(shape)
      )
        continue;
      const [x, y] = key.split(",").map(Number);
      const valid =
        shape.length &&
        shape.every(
          (polygon) =>
            Array.isArray(polygon) &&
            polygon.length &&
            polygon.every(
              (ring) =>
                Array.isArray(ring) &&
                ring.length >= 4 &&
                ring.every(
                  (point) =>
                    Array.isArray(point) &&
                    point.length === 2 &&
                    point.every(Number.isFinite) &&
                    point[0] >= x &&
                    point[0] <= x + 1 &&
                    point[1] >= y &&
                    point[1] <= y + 1,
                ),
            ),
        );
      if (valid) route.partial[key] = structuredClone(shape);
    }
    // Only the explicit compact encoding uses a region as permanent coverage evidence.
    // It expands against the same floor that accompanied that saved memory.
    if (raw.compactRegions === true && state?.tiles) {
      for (const tile of state.tiles) {
        if (
          tile.type !== TILE_TYPES.FLOOR ||
          tile.meta?.neverExplore ||
          !routeExistsAt(state, tile.x, tile.y, id)
        )
          continue;
        if (
          data.rooms?.[tile.roomId] === true ||
          data.halls?.[tile.hallId] === true
        ) {
          const key = cellKey(tile.x, tile.y);
          route.complete[key] = true;
          delete route.partial[key];
        }
      }
    }
    memory.routes[id] = route;
  }
  return memory;
}

export function serializeExplorationMemory(memory, state = null) {
  if (!memory || memory.version !== EXPLORATION_VERSION) return undefined;
  const saved = structuredClone(memory);
  if (!state?.tiles) return saved;
  saved.compactRegions = true;
  for (const [id, route] of Object.entries(saved.routes)) {
    const groups = { rooms: new Map(), halls: new Map() };
    for (const tile of state.tiles) {
      if (
        tile.type !== TILE_TYPES.FLOOR ||
        tile.meta?.neverExplore ||
        !routeExistsAt(state, tile.x, tile.y, id)
      )
        continue;
      for (const [field, name] of [
        ["rooms", tile.roomId],
        ["halls", tile.hallId],
      ]) {
        if (!name) continue;
        if (!groups[field].has(name)) groups[field].set(name, []);
        groups[field].get(name).push(cellKey(tile.x, tile.y));
      }
    }
    const covered = new Set();
    for (const field of ["rooms", "halls"]) {
      route[field] = {};
      for (const [name, keys] of groups[field])
        if (keys.every((key) => memory.routes[id].complete[key])) {
          route[field][name] = true;
          for (const key of keys) covered.add(key);
        }
    }
    for (const key of covered) delete route.complete[key];
  }
  return saved;
}

export function ensureExplorationMemory(state) {
  if (state.visibility.explorationMemory?.version !== EXPLORATION_VERSION) {
    state.visibility.explorationMemory = createExplorationMemory();
  }
  return state.visibility.explorationMemory;
}

export function explorationChunks(memory, routeId) {
  let routes = indexes.get(memory);
  if (!routes) {
    routes = new Map();
    indexes.set(memory, routes);
  }
  if (!routes.has(routeId)) {
    const chunks = new Map(),
      route = memory.routes[routeId];
    for (const key of new Set([
      ...Object.keys(route?.complete || {}),
      ...Object.keys(route?.partial || {}),
    ])) {
      const [x, y] = key.split(",").map(Number),
        chunkKey = explorationChunkKey(x, y);
      if (!chunks.has(chunkKey))
        chunks.set(chunkKey, { revision: 0, cells: new Set() });
      chunks.get(chunkKey).cells.add(key);
    }
    routes.set(routeId, chunks);
  }
  return routes.get(routeId);
}

function changed(memory, routeId, key) {
  const [x, y] = key.split(",").map(Number),
    chunks = explorationChunks(memory, routeId),
    chunkKey = explorationChunkKey(x, y);
  if (!chunks.has(chunkKey))
    chunks.set(chunkKey, { revision: 0, cells: new Set() });
  const chunk = chunks.get(chunkKey);
  chunk.cells.add(key);
  chunk.revision++;
}

function getRegionIndex(state, routeId) {
  let cached = regionIndexes.get(state);
  if (
    !cached ||
    cached.tiles !== state.tiles ||
    cached.routes !== state.underpasses
  ) {
    cached = {
      tiles: state.tiles,
      routes: state.underpasses,
      byRoute: new Map(),
    };
    regionIndexes.set(state, cached);
  }
  if (cached.byRoute.has(routeId)) return cached.byRoute.get(routeId);
  const rooms = new Map(),
    halls = new Map();
  for (const tile of state.tiles || []) {
    if (
      tile.type !== TILE_TYPES.FLOOR ||
      tile.meta?.neverExplore ||
      !routeExistsAt(state, tile.x, tile.y, routeId)
    )
      continue;
    for (const [id, groups] of [
      [tile.roomId, rooms],
      [tile.hallId, halls],
    ]) {
      if (!id) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(cellKey(tile.x, tile.y));
    }
  }
  const result = { rooms, halls };
  cached.byRoute.set(routeId, result);
  return result;
}

export function updateExplorationSummaries(state) {
  const memory = ensureExplorationMemory(state);
  for (const [id, route] of Object.entries(memory.routes)) {
    const groups = getRegionIndex(state, id);
    for (const field of ["rooms", "halls"]) {
      for (const [name, keys] of groups[field]) {
        if (
          !route[field][name] &&
          keys.length &&
          keys.every((key) => own(route.complete, key))
        )
          route[field][name] = true;
      }
    }
  }
}

export function isTileFullyExplored(state, x, y, routeId = "") {
  return (
    ensureExplorationMemory(state).routes[routeId]?.complete[cellKey(x, y)] ===
    true
  );
}

export function isPointExplored(state, x, y, routeId = "") {
  const memory = ensureExplorationMemory(state),
    key = cellKey(Math.floor(x), Math.floor(y)),
    route = memory.routes[routeId];
  if (route?.complete[key]) return true;
  const shape = route?.partial[key];
  if (!shape) return false;
  const inside = (ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a[1] > y !== b[1] > y &&
        x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
      )
        hit = !hit;
    }
    return hit;
  };
  return shape.some(
    (polygon) => inside(polygon[0]) && !polygon.slice(1).some(inside),
  );
}

function requiredTileArea(tile, state) {
  const organic=state && organicExplorationArea(state,tile);
  if(organic!==null && organic!==undefined)return organic;
  const inner = getInnerWallTileData(tile);
  if (!inner?.blocksMovement) return square(tile.x, tile.y);
  const {
    left: l,
    top: t,
    right: r,
    bottom: b,
  } = getInnerWallOpaqueBounds(tile, TILE_SIZE_PX);
  return clipping.difference(square(tile.x, tile.y), [
    [
      [
        [l, t],
        [r, t],
        [r, b],
        [l, b],
        [l, t],
      ],
    ],
  ]);
}

function completeTile(state, memory, routeId, route, tile) {
  const key = cellKey(tile.x, tile.y);
  if (route.complete[key]) return;
  route.complete[key] = true;
  delete route.partial[key];
  changed(memory, routeId, key);
  if (getInnerWallTileData(tile)?.blocksMovement)
    state.visibility.exploredInnerWallInteriors?.add(key);
}

let geometryWarningShown = false;
function geometryFallback(error) {
  if (!geometryWarningShown) {
    console.warn('Exploration geometry retained as exact pieces after a boolean-operation failure.', error.message);
    geometryWarningShown = true;
  }
}
function localShape(shape, x, y, direction) {
  return shape.map(polygon => polygon.map(ring => ring.map(([px, py]) => [px + direction*x, py + direction*y])));
}
function orientedPiece(polygon) {
  let cached=orientedPieces.get(polygon);
  if(cached)return cached;
  const rings=polygon.map((ring,index)=>{
    const area=ring.reduce((sum,point,i)=>{
      const next=ring[(i+1)%ring.length];return sum+point[0]*next[1]-next[0]*point[1];
    },0);
    return (index===0 ? area<0 : area>0) ? [...ring].reverse() : ring;
  });
  const piece=rings.every((ring,i)=>ring===polygon[i])?polygon:rings;
  cached={piece,signature:JSON.stringify(piece)};
  orientedPieces.set(polygon,cached);orientedPieces.set(piece,cached);
  return cached;
}
function exactPieces(shapes) {
  const first=shapes[0];
  let index=pieceIndexes.get(first);
  if(!index){
    const signatures=new Set(),pieces=[];
    for(const polygon of first){const p=orientedPiece(polygon);if(!signatures.has(p.signature)){signatures.add(p.signature);pieces.push(p.piece);}}
    const shape=pieces.length===first.length&&pieces.every((p,i)=>p===first[i])?first:pieces;
    index={signatures,shape};pieceIndexes.set(first,index);pieceIndexes.set(shape,index);
  }
  let result=index.shape,signatures=index.signatures;
  for(const shape of shapes.slice(1))for(const polygon of shape){
    const p=orientedPiece(polygon);
    if(signatures.has(p.signature))continue;
    if(result===index.shape){result=[...result];signatures=new Set(signatures);}
    signatures.add(p.signature);result.push(p.piece);
  }
  if(result!==index.shape)pieceIndexes.set(result,{signatures,shape:result});
  return result;
}
function exactUnion(shapes, x = 0, y = 0) {
  const known=pieceIndexes.get(shapes[0]);
  if(known && shapes.length>1 && shapes.slice(1).every(shape=>shape.every(p=>known.signatures.has(orientedPiece(p).signature))))return known.shape;
  try {
    const merged = clipping.union(...shapes.map(shape => localShape(shape, x, y, -1)));
    return localShape(merged, x, y, 1);
  } catch (error) {
    geometryFallback(error);
    // Keep the original closed rings. Nonzero winding draws their union exactly;
    // completion remains conservative until a later successful boolean operation.
    return exactPieces(shapes);
  }
}
function shapeBounds(shape) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const polygon of shape) for (const ring of polygon) for (const [x,y] of ring) {
    minX=Math.min(minX,x);minY=Math.min(minY,y);
    maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  return {minX,minY,maxX,maxY};
}
function hasExactCoverage(required, merged, tile) {
  try {
    const signature = JSON.stringify(required);
    const cached = coverageChecks.get(merged);
    if (cached?.signature === signature) return cached.complete;
    const need=shapeBounds(required), have=shapeBounds(merged);
    // Missing an extreme proves incompleteness. Matching bounds proves nothing:
    // diagonal boundaries and even microscopic interior holes still use difference.
    const missingExtent=need.minX<have.minX || need.minY<have.minY ||
      need.maxX>have.maxX || need.maxY>have.maxY;
    const complete = !missingExtent && !clipping.difference(localShape(required,tile.x,tile.y,-1),localShape(merged,tile.x,tile.y,-1)).length;
    coverageChecks.set(merged, {signature, complete});
    return complete;
  } catch (error) {
    geometryFallback(error);
    return false;
  }
}

function noteCoverage(state, routeId, tile, coverage, door = null) {
  const memory = ensureExplorationMemory(state),
    route = (memory.routes[routeId] ||= emptyRoute()),
    key = cellKey(tile.x, tile.y);
  if (route.complete[key]) return;
  const previous = route.partial[key];
  const indexed = previous && pieceIndexes.has(previous);
  // A fresh observation may independently certify a formerly unmergeable tile.
  // Closed doors still require both remembered sides.
  if((indexed || tile.meta?.organic || tile.meta?.organicMacro) && !(door && !isDoorPassable(door)) && hasExactCoverage(requiredTileArea(tile,state),coverage,tile)) {
    completeTile(state,memory,routeId,route,tile);
    return;
  }
  const previousSignature = previous && !indexed && JSON.stringify(previous);
  let merged = previous && (indexed || previousSignature !== JSON.stringify(coverage))
    ? exactUnion([previous, coverage], tile.x, tile.y) : coverage;
  if (!merged.length) return;
  const unchanged = previous && (merged===previous ||
    (!(indexed && pieceIndexes.has(merged)) && JSON.stringify(merged)===(previousSignature || JSON.stringify(previous))));
  if (unchanged) merged = previous;
  const sides = door && state.visibility.closedDoorExploredSides?.get(door.id);
  const bothSides =
    door && doorExplorationSides(door).every((side) => sides?.has(side));
  const required = requiredTileArea(tile,state);
  // Difference, rather than area thresholds or corner samples, preserves even tiny unseen holes.
  if (
    door && !isDoorPassable(door)
      ? bothSides
      : hasExactCoverage(required, merged, tile)
  )
    completeTile(state, memory, routeId, route, tile);
  else if (!unchanged) {
    route.partial[key] = merged;
    changed(memory, routeId, key);
  }
}

function clipLightToTile(ring, x, y) {
  let points = ring;
  for (const [axis, edge, greater] of [
    [0, x, true],
    [0, x + 1, false],
    [1, y, true],
    [1, y + 1, false],
  ]) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const insideA = greater ? a[axis] >= edge : a[axis] <= edge,
        insideB = greater ? b[axis] >= edge : b[axis] <= edge;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const ratio = (edge - a[axis]) / (b[axis] - a[axis]);
        const hit = [
          a[0] + ratio * (b[0] - a[0]),
          a[1] + ratio * (b[1] - a[1]),
        ];
        hit[axis] = edge;
        result.push(hit);
      }
    }
    points = result;
    if (points.length < 3) return [];
  }
  // Bounds are exact after clipping; this also removes harmless round-off excursions.
  const closed = points.map(([px, py]) => [
    Math.max(x, Math.min(x + 1, px)),
    Math.max(y, Math.min(y + 1, py)),
  ]);
  if (closed[0][0] !== closed.at(-1)[0] || closed[0][1] !== closed.at(-1)[1])
    closed.push([...closed[0]]);
  return closed;
}

export function rememberLightPolygons(
  state,
  lightPolygons,
  { allowed = null, legacy = false, eligibilityKey = null } = {},
) {
  const memory = ensureExplorationMemory(state);
  let seen = processing.get(memory);
  if (!seen) {
    seen = new Map();
    processing.set(memory, seen);
  }
  const doors = new Map(
    (state.entities || [])
      .filter((e) => e.subtype === "door")
      .map((e) => [cellKey(e.x, e.y), e]),
  );
  for (const { source, polygon } of lightPolygons) {
    if (!Array.isArray(polygon) || polygon.length < 3) continue;
    const routeId = routeOf(state, source);
    const signature =
      routeId +
      "|" +
      JSON.stringify(polygon) +
      "|" +
      JSON.stringify(
        [...doors.values()].map((d) => [
          d.id,
          d.doorState,d.secretFound===true,d.revealed===true,
          [...(state.visibility.closedDoorExploredSides?.get(d.id) || [])],
        ]),
      );
    const computationKey=signature+'|'+String(eligibilityKey);
    const reusable=!allowed||eligibilityKey!==null;
    if (reusable && seen.has(computationKey)) continue;
    const route = (memory.routes[routeId] ||= emptyRoute());
    const ring = polygon.map(([x, y]) => [x / TILE_SIZE_PX, y / TILE_SIZE_PX]);
    const minX = Math.max(0, Math.floor(Math.min(...ring.map((p) => p[0])))),
      maxX = Math.min(
        state.map.width - 1,
        Math.floor(Math.max(...ring.map((p) => p[0]))),
      );
    const minY = Math.max(0, Math.floor(Math.min(...ring.map((p) => p[1])))),
      maxY = Math.min(
        state.map.height - 1,
        Math.floor(Math.max(...ring.map((p) => p[1]))),
      );
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const tile = state.tiles[y * state.map.width + x],
          key = cellKey(x, y),
          door = doors.get(key);
        if (
          !tile ||
          tile.type !== TILE_TYPES.FLOOR ||
          tile.meta?.neverExplore ||
          route.complete[key] ||
          (!legacy && !routeExistsAt(state, x, y, routeId)) ||
          (allowed && !allowed(tile, source)) ||
          (door?.secret &&
            door.doorState !== "open" &&
            !door.secretFound &&
            !door.revealed)
        )
          continue;
        const clipped = clipLightToTile(ring, x, y);
        if (clipped.length) {
          if(!door && !requiredTileArea(tile,state).length){completeTile(state,memory,routeId,route,tile);continue;}
          const coverage = exactUnion([[[clipped]]], x, y);
          if (coverage.length)
            noteCoverage(state, routeId, tile, coverage, door);
        }
      }
    if(reusable)seen.set(computationKey, true);
    // This only evicts computation keys, never exploration memory.
    if (seen.size > 256) seen.delete(seen.keys().next().value);
  }
  // Boundary-mounted secret doors may have no tile intersection from one side.
  // The two side observations still certify the door, regardless of visit order.
  for (const door of doors.values()) {
    const sides = state.visibility.closedDoorExploredSides?.get(door.id);
    if (!doorExplorationSides(door).every((side) => sides?.has(side))) continue;
    const tile = state.tiles[door.y * state.map.width + door.x];
    if (!tile || tile.type !== TILE_TYPES.FLOOR || tile.meta?.neverExplore)
      continue;
    const routeId = routeOf(state, door);
    const route = (memory.routes[routeId] ||= emptyRoute());
    completeTile(state, memory, routeId, route, tile);
  }
  updateExplorationSummaries(state);
}

export function migrateExplorationHistory(state) {
  const memory = ensureExplorationMemory(state);
  const history = state.visibility.exploredLightPolygons;
  if (!Array.isArray(history) || !history.length) return memory;
  const legacy = Boolean(state.underpasses?.length);
  const routeId = legacy ? LEGACY_EXPLORATION_ROUTE : "";
  rememberLightPolygons(
    state,
    history.map((polygon) => ({ source: { routeId }, polygon })),
    { legacy },
  );
  // Old polygon histories were capped. Retain older floor already shown by the
  // coarse renderer only where no surviving precise coverage can be recovered.
  const coarse = legacyCoarseFloor(state, state.visibility);
  for (const key of Object.keys(coarse.complete)) {
    if (
      Object.values(memory.routes).some(
        (route) => route.complete[key] || route.partial[key],
      )
    )
      continue;
    const route = (memory.routes[LEGACY_EXPLORATION_ROUTE] ||= emptyRoute());
    route.complete[key] = true;
    changed(memory, LEGACY_EXPLORATION_ROUTE, key);
  }
  state.visibility.exploredLightPolygons = [];
  state.visibility.exploredLightPolygonsBeforeNow = [];
  state.visibility.exploredLightPolygonKeys = new Set();
  return memory;
}

export function rememberExploredWall(state, tile, routeId = "") {
  const memory = ensureExplorationMemory(state),
    route = (memory.routes[routeId] ||= emptyRoute()),
    key = cellKey(tile.x, tile.y);
  // A cross has no transparent, reachable edge. Do not reveal it until observed.
  if (!route.complete[key] && !requiredTileArea(tile,state).length)
    completeTile(state, memory, routeId, route, tile);
}

// Rendering a legacy plane beside route-specific memory must never erase either.
export function mergeExplorationShapes(shapes) {
  if (!shapes.length) return [];
  return shapes.length === 1 ? shapes[0] : exactUnion(shapes);
}
