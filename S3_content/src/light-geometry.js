import { DOOR_STATES, TILE_SIZE_PX, TILE_TYPES } from "./constants.js";
import { doorLightSegments, isClosedSecretDoor, doorBoundaryCenter } from './door-geometry.js';
import { getOrganicBlockedSides, getOrganicTileData, isOrganicMovementBlockingTile, isOrganicPillarTile } from "./organic-tiles.js";
import { getInnerWallConnectedSides, getInnerWallTileData } from "./inner-walls.js";
import { isAngledWallLightBlockingTile, isAngledWallMovementBlockingTile } from "./angled-walls.js";
import { reviewedTileLightSegments, isStatueAsset } from "./reviewed-tile-rules.js";
import { visualTilePoint } from "./tile-positions.js";
import { isLightSuppressedAt } from './wizard-mishaps.js';
import { isSleeping } from './conditions.js';
import { routeOf, sameRoute, routeLightSegments } from './underpasses.js';
import { lightSpellSources } from './light-spell.js';
import { isTilePhysicallyIlluminated } from './darkvision.js';

const ANGLE_EPSILON = 0.00008;
const RADIUS_RAY_COUNT = 96;
const INNER_WALL_EDGE_INSET_PX = 5;
const PILLAR_SHADOW_SIZE_PX = TILE_SIZE_PX / 3;
const PILLAR_SHADOW_INSET_PX = (TILE_SIZE_PX - PILLAR_SHADOW_SIZE_PX) / 2;
const polygonBounds = new WeakMap();
const organicSegmentCache = new WeakMap();
const reviewedSegmentCache = new WeakMap();
const lightPolygonPasses = new WeakMap();
const TILE_SAMPLE_POINTS = Object.freeze([
  [0.5, 0.5],
  [0.16, 0.16],
  [0.84, 0.16],
  [0.84, 0.84],
  [0.16, 0.84]
]);

function getTileAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) {
    return null;
  }
  return state.tiles[y * state.map.width + x] || null;
}

function getRotundaLightBlock(state, x, y) {
  for (const room of state.rooms || []) {
    if (room.rotunda !== true) {
      continue;
    }
    const size = Number(room.rotundaSize || room.width || room.height || 7) === 5 ? 5 : 7;
    const drawSize = size === 5 ? 5 : 9;
    const artX = Number(room.x) - (size === 5 ? 0 : 1);
    const artY = Number(room.y) - (size === 5 ? 0 : 1);
    if (x < artX || y < artY || x >= artX + drawSize || y >= artY + drawSize) {
      continue;
    }
    if (size === 5) {
      const localX = x - artX;
      const localY = y - artY;
      const openings = new Set((Array.isArray(room.rotundaOpenings) && room.rotundaOpenings.length
        ? room.rotundaOpenings
        : [room.rotundaOpening || room.opening || "south"]
      ).map((opening) => String(opening || "")[0].toLowerCase()));
      const isInnerRotunda = localX >= 1 && localX <= 3 && localY >= 1 && localY <= 3;
      const isExit =
        (openings.has("n") && localX === 2 && localY === 0) ||
        (openings.has("s") && localX === 2 && localY === 4) ||
        (openings.has("w") && localX === 0 && localY === 2) ||
        (openings.has("e") && localX === 4 && localY === 2);
      return !(isInnerRotunda || isExit);
    }
    const centerX = artX + drawSize / 2;
    const centerY = artY + drawSize / 2;
    const dx = (x + 0.5) - centerX;
    const dy = (y + 0.5) - centerY;
    const radius = size / 2;
    return Math.sqrt(dx * dx + dy * dy) >= radius;
  }
  return null;
}

export function isLightBlockingTile(state, x, y) {
  const tile = getTileAt(state, x, y);
  if (!tile) {
    return true;
  }
  if (isOrganicMovementBlockingTile(tile)) {
    return true;
  }
  if (isAngledWallLightBlockingTile(tile) || isAngledWallMovementBlockingTile(tile)) {
    return true;
  }
  if (tile.type === TILE_TYPES.WALL || tile.type === TILE_TYPES.VOID) {
    const rotundaBlock = getRotundaLightBlock(state, x, y);
    if (rotundaBlock !== null) {
      return rotundaBlock;
    }
    return true;
  }
  return false;
}

function isLightFloorTile(state, x, y) {
  const tile = getTileAt(state, x, y);
  return tile &&
    tile.type !== TILE_TYPES.WALL &&
    tile.type !== TILE_TYPES.VOID &&
    !isOrganicMovementBlockingTile(tile) &&
    !isAngledWallLightBlockingTile(tile) &&
    !isAngledWallMovementBlockingTile(tile);
}

export function getDoorTiles(door) {
  const side = door.hallDirection || door.wallSide;
  if (side === "east") {
    return {
      hall: { x: door.x, y: door.y },
      room: { x: door.x - 1, y: door.y }
    };
  }
  if (side === "west") {
    return {
      hall: { x: door.x, y: door.y },
      room: { x: door.x + 1, y: door.y }
    };
  }
  if (side === "south") {
    return {
      hall: { x: door.x, y: door.y },
      room: { x: door.x, y: door.y - 1 }
    };
  }
  return {
    hall: { x: door.x, y: door.y },
    room: { x: door.x, y: door.y + 1 }
  };
}

function addLightSource(sources, seen, x, y, radius, routeId = '') {
  const source = {
    x: Number(x),
    y: Number(y),
    radius: Math.max(1, Number(radius) || 6), routeId
  };
  if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) {
    return;
  }
  const key = `${source.routeId}:${source.x},${source.y},${source.radius}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  sources.push(source);
}

function lightReachesViewer(state, source, viewers) {
  if (!viewers.length) {
    return false;
  }
  const polygon = computeLightPolygon(state, source);
  return viewers.some((character) => sameRoute(state, character, source) && isPointInPolygon(visualTilePoint(state,character.visualX ?? character.x,character.visualY ?? character.y)
    .map(value=>value*TILE_SIZE_PX),polygon));
}

export function collectLightSources(state) {
  const sources = [];
  const seen = new Set();
  const viewerIds = state.viewerCharacterIds instanceof Set ? state.viewerCharacterIds : null;
  const observers = (state.characters || []).filter(character => (!viewerIds || viewerIds.has(character.id)) && !character.dead && !character.slain && !character.conditions?.blind && !isSleeping(character, state));
  if ((state.characters || []).length && !observers.length) return [];
  const viewers = viewerIds
    ? (state.characters || []).filter((character) => (
      viewerIds.has(character.id) &&
      character.dead !== true &&
      character.slain !== true &&
      !character.conditions?.blind &&
      !isSleeping(character, state) &&
      Number.isFinite(Number(character.x)) &&
      Number.isFinite(Number(character.y))
    ))
    : [];
  for (const character of state.characters || []) {
    if (Number(character?.lightRadius) > 0) {
      const source = {
        x: Number(character.visualX ?? character.x),
        y: Number(character.visualY ?? character.y),
        radius: Number(character.lightRadius), routeId: character.visualRouteId ?? routeOf(state, character)
      };
      if (viewerIds && !viewerIds.has(character.id) && !lightReachesViewer(state, source, viewers)) {
        continue;
      }
      addLightSource(
        sources,
        seen,
        source.x,
        source.y,
        character.lightRadius, source.routeId
      );
    }
  }
  if (state.player?.torchLit && state.sharedRoom !== true) {
    addLightSource(sources, seen, state.player.x, state.player.y, state.player.lightRadius, routeOf(state, state.player));
  }
  for (const entity of state.entities || []) {
    if (
      entity.subtype === "dropped-equipment" &&
      entity.collected !== true &&
      entity.visible !== false &&
      Number(entity.lightRadius) > 0
    ) {
      const source = { x: entity.x, y: entity.y, radius: entity.lightRadius, routeId: routeOf(state, entity) };
      if (viewerIds && !lightReachesViewer(state, source, viewers)) {
        continue;
      }
      addLightSource(sources, seen, entity.x, entity.y, entity.lightRadius, source.routeId);
    }
  }
  const spellSources = lightSpellSources(state);
  if (spellSources.length) {
    const holders = new Map();
    for (const holder of [...(state.characters || []), ...(state.entities || [])]) {
      holders.set(holder.id, holder);
      for (const [index, item] of (holder.gear || []).entries()) holders.set(item.instanceId || `${holder.id}:gear:${index}`, holder);
    }
    for (const spellSource of spellSources) {
      const holder = holders.get(spellSource.sourceId);
      const source = { ...spellSource, x: Number(holder?.visualX ?? spellSource.x), y: Number(holder?.visualY ?? spellSource.y),
        routeId: holder?.visualRouteId ?? spellSource.routeId };
      const owned = viewerIds && (state.characters || []).includes(holder) && viewerIds.has(holder.id);
      if (viewerIds && !owned && !lightReachesViewer(state, source, viewers)) continue;
      if (sources.some(existing => existing.routeId === source.routeId && existing.x === source.x && existing.y === source.y && existing.radius >= source.radius)) continue;
      addLightSource(sources, seen, source.x, source.y, source.radius, source.routeId);
    }
  }
  if (state.rest?.suppliesPaid && ['sleeping', 'interrupted', 'voting'].includes(state.rest.phase)) {
    const source = { x: state.rest.x, y: state.rest.y, radius: 6, routeId: routeOf(state, state.rest) };
    if (!viewerIds || lightReachesViewer(state, source, viewers)) addLightSource(sources, seen, source.x, source.y, source.radius, source.routeId);
  }
  const visible = sources.filter(source => !isLightSuppressedAt(state, source.x, source.y, source));
  const transition = state.lightTransition;
  if (Number.isFinite(state.lightVisualTime) && transition) {
    const elapsed = state.lightVisualTime - transition.startedAt;
    if (elapsed >= 0 && elapsed < 1000) return [];
    if (elapsed >= 1000 && elapsed < 3000) {
      const character = state.characters?.find(member => member.id === transition.characterId);
      const growth = (elapsed - 1000) / 2000;
      return visible.map(source => character && Math.abs(source.x - (character.visualX ?? character.x)) < .01 && Math.abs(source.y - (character.visualY ?? character.y)) < .01
        ? { ...source, radius: .27 + (source.radius - .27) * growth } : source);
    }
  }
  return visible;
}

function tileEdgeSegment(x, y, side) {
  const left = x * TILE_SIZE_PX;
  const top = y * TILE_SIZE_PX;
  const right = left + TILE_SIZE_PX;
  const bottom = top + TILE_SIZE_PX;
  if (side === "north") return [[left, top], [right, top]];
  if (side === "south") return [[right, bottom], [left, bottom]];
  if (side === "west") return [[left, bottom], [left, top]];
  return [[right, top], [right, bottom]];
}

function innerWallBlockingSegments(tile) {
  const innerWall = getInnerWallTileData(tile);
  if (!innerWall?.blocksMovement) {
    return [];
  }
  const connectedSides = new Set(getInnerWallConnectedSides(innerWall));
  const left = tile.x * TILE_SIZE_PX + (connectedSides.has("west") ? 0 : INNER_WALL_EDGE_INSET_PX);
  const top = tile.y * TILE_SIZE_PX + (connectedSides.has("north") ? 0 : INNER_WALL_EDGE_INSET_PX);
  const right = (tile.x + 1) * TILE_SIZE_PX - (connectedSides.has("east") ? 0 : INNER_WALL_EDGE_INSET_PX);
  const bottom = (tile.y + 1) * TILE_SIZE_PX - (connectedSides.has("south") ? 0 : INNER_WALL_EDGE_INSET_PX);
  return [
    [[left, top], [right, top]],
    [[right, top], [right, bottom]],
    [[right, bottom], [left, bottom]],
    [[left, bottom], [left, top]]
  ];
}

function rectBlockingSegments(left, top, right, bottom) {
  return [
    [[left, top], [right, top]],
    [[right, top], [right, bottom]],
    [[right, bottom], [left, bottom]],
    [[left, bottom], [left, top]]
  ];
}

function columnBlockingSegments(column) {
  if (!Number.isFinite(Number(column?.x)) || !Number.isFinite(Number(column?.y))) {
    return [];
  }
  const placement = String(column.placement || "center");
  const drawX = placement === "vertex" ? Number(column.x) - 0.5 : Number(column.x);
  const drawY = placement === "vertex" ? Number(column.y) - 0.5 : Number(column.y);
  const left = drawX * TILE_SIZE_PX + PILLAR_SHADOW_INSET_PX;
  const top = drawY * TILE_SIZE_PX + PILLAR_SHADOW_INSET_PX;
  return rectBlockingSegments(
    left,
    top,
    left + PILLAR_SHADOW_SIZE_PX,
    top + PILLAR_SHADOW_SIZE_PX
  );
}

function isHorizontalDoor(door) {
  if (door.orientation === "horizontal") {
    return true;
  }
  if (door.orientation === "vertical") {
    return false;
  }
  const side = String(door.hallDirection || door.wallSide || "").toLowerCase();
  return side === "north" || side === "south";
}

export function isPortcullisDoor(door) {
  const explicit = String(door?.doorKind || door?.visualKind || "").toLowerCase();
  if (explicit === "gate" || explicit === "portcullis") {
    return true;
  }
  const watabouType = Number(door?.watabouDoorType ?? door?.type);
  return watabouType === 5 || door?.portcullis === true || door?.doorState === "portcullis";
}

export function getClosedDoorSegment(door) {
  if (isClosedSecretDoor(door)) {
    const center = doorBoundaryCenter(door), half = TILE_SIZE_PX / 2;
    return isHorizontalDoor(door) ? [[center.x - half, center.y], [center.x + half, center.y]]
      : [[center.x, center.y - half], [center.x, center.y + half]];
  }
  const left = door.x * TILE_SIZE_PX;
  const top = door.y * TILE_SIZE_PX;
  const right = left + TILE_SIZE_PX;
  const bottom = top + TILE_SIZE_PX;
  const half = TILE_SIZE_PX / 2;
  if (!isHorizontalDoor(door)) {
    const x = left + half;
    return [[x, top], [x, bottom]];
  }
  const y = top + half;
  return [[right, y], [left, y]];
}

function segmentNearSource(segment, sourcePoint, radiusPx) {
  const radiusWithPadding = radiusPx + TILE_SIZE_PX * 1.5;
  return segment.some(([x, y]) => Math.hypot(x - sourcePoint[0], y - sourcePoint[1]) <= radiusWithPadding);
}

function organicBlockingSegments(tile) {
  const data=getOrganicTileData(tile);
  if(data) {
    const cached=organicSegmentCache.get(tile);
    if(cached?.data===data && cached.x===tile.x && cached.y===tile.y) return cached.segments;
    const reviewed=reviewedTileLightSegments(data.asset,{x:tile.x,y:tile.y,w:1,h:1,turn:data.rotationTurns,flipX:data.flipX,flipY:data.flipY});
    if(reviewed!==null) {
      const segments=reviewed.map(segment=>segment.map(point=>point.map(value=>value*TILE_SIZE_PX)));
      organicSegmentCache.set(tile,{data,x:tile.x,y:tile.y,segments});
      return segments;
    }
  }
  if (isOrganicPillarTile(tile)) return columnBlockingSegments(tile);
  return getOrganicBlockedSides(tile).map((side) => tileEdgeSegment(tile.x, tile.y, side));
}

function collectBlockingSegments(state, source, sourcePoint, radiusPx, options = {}) {
  const segments = routeLightSegments(state, source).filter(segment => segmentNearSource(segment, sourcePoint, radiusPx));
  const radiusTiles = Math.ceil(Math.max(1, Number(source.radius) || 6)) + 2;
  const originX = Math.round(Number(source.x));
  const originY = Math.round(Number(source.y));
  const minX = Math.max(0, originX - radiusTiles);
  const maxX = Math.min(state.map.width - 1, originX + radiusTiles);
  const minY = Math.max(0, originY - radiusTiles);
  const maxY = Math.min(state.map.height - 1, originY + radiusTiles);
  const sides = [
    ["north", 0, -1],
    ["south", 0, 1],
    ["west", -1, 0],
    ["east", 1, 0]
  ];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tile = getTileAt(state, x, y);
      if(tile?.meta?.organicMacro) continue;
      if (getOrganicTileData(tile)) {
        if (!options.ignorePillars || !isOrganicPillarTile(tile)) segments.push(...organicBlockingSegments(tile));
        continue;
      }
      const innerWallSegments = innerWallBlockingSegments(tile);
      if (innerWallSegments.length) {
        segments.push(...innerWallSegments);
        continue;
      }
      if (!isLightBlockingTile(state, x, y)) {
        for (const side of getOrganicBlockedSides(tile)) {
          segments.push(tileEdgeSegment(x, y, side));
        }
        continue;
      }
      for (const [side, dx, dy] of sides) {
        if (isLightFloorTile(state, x + dx, y + dy)) {
          segments.push(tileEdgeSegment(x, y, side));
        }
      }
    }
  }

  for (const column of options.ignorePillars || routeOf(state, source) ? [] : state.decor?.columns || []) {
    for (const segment of columnBlockingSegments(column)) {
      if (segmentNearSource(segment, sourcePoint, radiusPx)) {
        segments.push(segment);
      }
    }
  }

  for (const entity of state.entities || []) {
    if (entity.subtype !== "door" || isPortcullisDoor(entity) || !sameRoute(state, source, entity)) {
      continue;
    }
    const reviewed = doorLightSegments(entity);
    const doorSegments = reviewed ?? (entity.doorState === DOOR_STATES.OPEN ? [] : [getClosedDoorSegment(entity)]);
    for (const segment of doorSegments) if (segmentNearSource(segment, sourcePoint, radiusPx)) {
      segments.push(segment);
    }
  }

  for (const placement of state.decor?.reviewed || []) if (isStatueAsset(placement.assetKey) && sameRoute(state, source, placement)) {
    for (const segment of columnBlockingSegments(placement)) if (segmentNearSource(segment, sourcePoint, radiusPx)) segments.push(segment);
  }
  for (const line of routeOf(state, source) ? [] : state.decor?.reviewedLight || []) {
    let segment=reviewedSegmentCache.get(line);
    if(!segment) { segment=line.map(point=>point.map(value=>value*TILE_SIZE_PX));reviewedSegmentCache.set(line,segment); }
    if(segmentNearSource(segment,sourcePoint,radiusPx))segments.push(segment);
  }
  return segments;
}

function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  const normalized = angle % twoPi;
  return normalized < 0 ? normalized + twoPi : normalized;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function raySegmentIntersection(origin, angle, segment, radiusPx) {
  const rayX = Math.cos(angle);
  const rayY = Math.sin(angle);
  const [a, b] = segment;
  const segX = b[0] - a[0];
  const segY = b[1] - a[1];
  const denom = cross(rayX, rayY, segX, segY);
  if (Math.abs(denom) < 0.000001) {
    return null;
  }
  const toSegmentX = a[0] - origin[0];
  const toSegmentY = a[1] - origin[1];
  const rayDistance = cross(toSegmentX, toSegmentY, segX, segY) / denom;
  const segmentDistance = cross(toSegmentX, toSegmentY, rayX, rayY) / denom;
  if (rayDistance < 0 || rayDistance > radiusPx || segmentDistance < -0.0001 || segmentDistance > 1.0001) {
    return null;
  }
  return {
    point: [origin[0] + rayX * rayDistance, origin[1] + rayY * rayDistance],
    distance: rayDistance
  };
}

function castRay(origin, angle, radiusPx, segments) {
  let closest = null;
  for (const segment of segments) {
    const hit = raySegmentIntersection(origin, angle, segment, radiusPx);
    if (!hit) {
      continue;
    }
    if (!closest || hit.distance < closest.distance) {
      closest = hit;
    }
  }
  if (closest) {
    return closest.point;
  }
  return [
    origin[0] + Math.cos(angle) * radiusPx,
    origin[1] + Math.sin(angle) * radiusPx
  ];
}

function collectRayAngles(sourcePoint, radiusPx, segments) {
  const angles = new Map();
  for (let index = 0; index < RADIUS_RAY_COUNT; index += 1) {
    const angle = (index / RADIUS_RAY_COUNT) * Math.PI * 2;
    angles.set(angle.toFixed(7), angle);
  }
  for (const segment of segments) {
    for (const point of segment) {
      if (Math.hypot(point[0] - sourcePoint[0], point[1] - sourcePoint[1]) > radiusPx + TILE_SIZE_PX) {
        continue;
      }
      const base = Math.atan2(point[1] - sourcePoint[1], point[0] - sourcePoint[0]);
      for (const offset of [-ANGLE_EPSILON, 0, ANGLE_EPSILON]) {
        const angle = normalizeAngle(base + offset);
        angles.set(angle.toFixed(7), angle);
      }
    }
  }
  return [...angles.values()].sort((a, b) => a - b);
}

export function organicTileBlocksLine(tile, from, to) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return organicBlockingSegments(tile).some((segment) => {
    const hit = raySegmentIntersection(from, angle, segment, distance);
    return hit && hit.distance < distance - 0.001;
  });
}

const lightPolygonKey = (source, options = {}) => `${source.routeId || ''}:${source.x},${source.y},${source.radius}:${options.ignorePillars === true}`;

export function withLightPolygonCache(state, draw, knownPolygons = []) {
  const previous = lightPolygonPasses.get(state);
  lightPolygonPasses.set(state, new Map(knownPolygons.map(({ source, polygon }) => [lightPolygonKey(source), polygon])));
  try { return draw(); }
  finally {
    if (previous) lightPolygonPasses.set(state, previous);
    else lightPolygonPasses.delete(state);
  }
}

export function computeLightPolygon(state, source, options = {}) {
  const cache = lightPolygonPasses.get(state);
  const key = lightPolygonKey(source, options);
  if (cache?.has(key)) return cache.get(key);
  const sourcePoint = visualTilePoint(state,source.x,source.y).map(value=>value*TILE_SIZE_PX);
  const radiusPx = (Math.max(1, Number(source.radius) || 6) + 0.5) * TILE_SIZE_PX;
  const segments = collectBlockingSegments(state, source, sourcePoint, radiusPx, options);
  const polygon = computeLightPolygonFromSegments(sourcePoint, radiusPx, segments);
  cache?.set(key, polygon);
  return polygon;
}

export function computeLightPolygonFromSegments(sourcePoint, radiusPx, segments) {
  const angles = collectRayAngles(sourcePoint, radiusPx, segments);
  return angles.map((angle) => castRay(sourcePoint, angle, radiusPx, segments));
}

export function isPointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }
  const [x, y] = point;
  let bounds = polygonBounds.get(polygon);
  if (!bounds) {
    bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [px, py] of polygon) {
      bounds.minX = Math.min(bounds.minX, px);
      bounds.minY = Math.min(bounds.minY, py);
      bounds.maxX = Math.max(bounds.maxX, px);
      bounds.maxY = Math.max(bounds.maxY, py);
    }
    polygonBounds.set(polygon, bounds);
  }
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.000001) + xi);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function isTileCenterInLightPolygon(tile, polygon) {
  if (!tile || tile.type === TILE_TYPES.WALL || tile.type === TILE_TYPES.VOID) {
    return false;
  }
  return isPointInPolygon([
    (tile.x + (tile.meta?.visualCenter?.[0] ?? 0.5)) * TILE_SIZE_PX,
    (tile.y + (tile.meta?.visualCenter?.[1] ?? 0.5)) * TILE_SIZE_PX
  ], polygon);
}

export function isTileTouchedByLightPolygon(tile, polygon) {
  if (!tile || tile.type === TILE_TYPES.WALL || tile.type === TILE_TYPES.VOID) {
    return false;
  }
  for (const [sampleX, sampleY] of TILE_SAMPLE_POINTS) {
    const point = [
      (tile.x + (sampleX===.5 ? tile.meta?.visualCenter?.[0] ?? sampleX : sampleX)) * TILE_SIZE_PX,
      (tile.y + (sampleY===.5 ? tile.meta?.visualCenter?.[1] ?? sampleY : sampleY)) * TILE_SIZE_PX
    ];
    if (isPointInPolygon(point, polygon)) {
      return true;
    }
  }
  return false;
}

export function isTileIlluminated(state, x, y, point = { x, y }) {
  const tile = getTileAt(state, x, y);
  if (!tile || tile.type === TILE_TYPES.WALL || tile.type === TILE_TYPES.VOID || isLightSuppressedAt(state, x, y, point)) return false;
  return isTilePhysicallyIlluminated(state, { ...tile, routeId: routeOf(state, point) }, {
    sources: collectLightSources(state), tileSize: TILE_SIZE_PX,
    polygonFor: source => computeLightPolygon(state, source)
  });
}
