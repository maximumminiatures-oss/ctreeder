import { blindDungeonView } from "./viewer-perception.js";
import { TILE_SIZE_PX, TILE_TYPES } from "./constants.js";
import { tileKey } from "./state-schema.js";
import { collectLightSources, computeLightPolygon } from "./light-geometry.js";
import {
  getOrganicTileData,
  isOrganicMovementBlockingTile,
  isOrganicPillarTile,
} from "./organic-tiles.js";
import {
  getInnerWallTileData,
  getInnerWallOpaqueBounds,
} from "./inner-walls.js";
import {
  isAngledWallLightBlockingTile,
  isAngledWallMovementBlockingTile,
} from "./angled-walls.js";
import { getReviewedTileRule } from "./reviewed-tile-rules.js";
import { isClosedSecretDoor, isDoorPassable } from "./door-geometry.js";
import { suppressionZones } from "./wizard-mishaps.js";
import { visualTilePoint } from "./tile-positions.js";
import { routeExistsAt } from "./underpasses.js";
import {
  EXPLORATION_CHUNK_TILES,
  explorationChunks,
  LEGACY_EXPLORATION_ROUTE,
  mergeExplorationShapes,
} from "./exploration-memory.js";
const EXPLORED_FOG_ALPHA = 0.45;
const UNEXPLORED_FOG_ALPHA = 1;
const PILLAR_SHADOW_SIZE_PX = TILE_SIZE_PX / 3;
const PILLAR_SHADOW_INSET_PX = (TILE_SIZE_PX - PILLAR_SHADOW_SIZE_PX) / 2;
const getTileAt = (state, x, y) =>
  x >= 0 && y >= 0 && x < state.map.width && y < state.map.height
    ? state.tiles[y * state.map.width + x]
    : null;
function getRoomOpenings(room) {
  const openings =
    Array.isArray(room?.rotundaOpenings) && room.rotundaOpenings.length
      ? room.rotundaOpenings
      : [room?.rotundaOpening || room?.opening || "south"];
  return [
    ...new Set(openings.map((opening) => String(opening).toLowerCase())),
  ].filter(Boolean);
}
function getRotundaArtFootprint(room) {
  const size =
    Number(room.rotundaSize || room.width || room.height || 7) === 5 ? 5 : 7;
  if (size === 5) {
    return {
      size,
      x: Number(room.x),
      y: Number(room.y),
      drawSize: 5,
    };
  }
  return {
    size,
    x: Number(room.x) - 1,
    y: Number(room.y) - 1,
    drawSize: 9,
  };
}
export function drawFog(
  state,
  ctx,
  widthPx,
  heightPx,
  forceBlackout,
  bounds = null,
) {
  if (blindDungeonView(state)) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.save();
    clipToFloorTiles(ctx, state, () => true);
    drawExplorationMemory(state, ctx, bounds, 0.82);
    ctx.restore();
    return;
  }
  if (forceBlackout && !state.visibility.darkvisionNow?.size) {
    if (state.visibility.explorationMemory) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, widthPx, heightPx);
      ctx.save();
      clipToFloorTiles(ctx, state, () => true);
      drawExplorationMemory(state, ctx, bounds, 0.82);
      ctx.restore();
      return;
    }
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
  drawExploredFog(state, ctx, bounds);
  drawAngledShadowWedges(state, ctx);
  drawVisibleBlockingDecorFogCutouts(state, ctx);
  if (!state.visibility.explorationMemory)
    drawClosedDoorFogBisectors(state, ctx);
  for (const zone of suppressionZones(state)) {
    const [cx, cy] = visualTilePoint(state, zone.x, zone.y).map(
      (value) => value * TILE_SIZE_PX,
    );
    ctx.save();
    if (state.underpasses?.length)
      clipToFloorTiles(
        ctx,
        state,
        (tile) =>
          routeExistsAt(state, tile.x, tile.y, zone.routeId) &&
          !Object.entries(state.visibility.routeVisible || {}).some(
            ([id, cells]) =>
              id !== zone.routeId && cells.has(tileKey(tile.x, tile.y)),
          ),
      );
    ctx.beginPath();
    ctx.arc(cx, cy, (zone.radius + 0.5) * TILE_SIZE_PX, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, widthPx, heightPx);
    drawExploredFog(state, ctx, bounds);
    ctx.restore();
  }
}

function wasExploredBeforeCurrentLight(state, x, y) {
  const explored =
    state.visibility.exploredBeforeNow instanceof Set
      ? state.visibility.exploredBeforeNow
      : state.visibility.exploredEver;
  return explored.has(tileKey(x, y));
}

export function addShadowPolygonPath(ctx, points) {
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

export function clipToFloorTiles(ctx, state, predicate) {
  ctx.beginPath();
  for (const tile of state.tiles || []) {
    if (
      !predicate(tile) ||
      tile.type === TILE_TYPES.WALL ||
      tile.type === TILE_TYPES.VOID
    ) {
      continue;
    }
    ctx.rect(
      tile.x * TILE_SIZE_PX,
      tile.y * TILE_SIZE_PX,
      TILE_SIZE_PX,
      TILE_SIZE_PX,
    );
  }
  addRotundaClipPaths(ctx, state, predicate);
  ctx.clip();
}

function hasRotundaClipTile(state, room, predicate) {
  for (let y = Number(room.y); y < Number(room.y + room.height); y += 1) {
    for (let x = Number(room.x); x < Number(room.x + room.width); x += 1) {
      const tile = getTileAt(state, x, y);
      if (
        tile &&
        predicate(tile) &&
        tile.type !== TILE_TYPES.WALL &&
        tile.type !== TILE_TYPES.VOID
      ) {
        return true;
      }
    }
  }
  return false;
}

function addRotundaFiveClipPath(ctx, room, footprint) {
  const openings = new Set(
    getRoomOpenings(room).map((opening) => String(opening || "")[0]),
  );
  const rects = [[footprint.x + 1, footprint.y + 1, 3, 3]];
  if (openings.has("n")) rects.push([footprint.x + 2, footprint.y, 1, 1]);
  if (openings.has("s")) rects.push([footprint.x + 2, footprint.y + 4, 1, 1]);
  if (openings.has("w")) rects.push([footprint.x, footprint.y + 2, 1, 1]);
  if (openings.has("e")) rects.push([footprint.x + 4, footprint.y + 2, 1, 1]);
  for (const [x, y, width, height] of rects) {
    ctx.rect(
      x * TILE_SIZE_PX,
      y * TILE_SIZE_PX,
      width * TILE_SIZE_PX,
      height * TILE_SIZE_PX,
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
  return (
    isAngledWallLightBlockingTile(tile) ||
    isAngledWallMovementBlockingTile(tile)
  );
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
    if (
      !isBlockingDecorFogTile(tile) ||
      !state.visibility.visibleNow.has(tileKey(tile.x, tile.y))
    ) {
      continue;
    }
    const bounds = getInnerWallOpaqueBounds(tile, TILE_SIZE_PX);
    if (bounds) {
      clearFogRect(
        ctx,
        bounds.left * TILE_SIZE_PX,
        bounds.top * TILE_SIZE_PX,
        (bounds.right - bounds.left) * TILE_SIZE_PX,
        (bounds.bottom - bounds.top) * TILE_SIZE_PX,
      );
      continue;
    }
    clearFogRect(
      ctx,
      tile.x * TILE_SIZE_PX,
      tile.y * TILE_SIZE_PX,
      TILE_SIZE_PX,
      TILE_SIZE_PX,
    );
  }
}

function drawAdjacentInnerWallFogCutouts(state, ctx, lightSources) {
  for (const tile of state.tiles || []) {
    if (!isInnerWallAdjacentToLiveLightSource(tile, lightSources)) {
      continue;
    }
    const bounds = getInnerWallOpaqueBounds(tile, TILE_SIZE_PX);
    if (bounds) {
      clearFogRect(
        ctx,
        bounds.left * TILE_SIZE_PX,
        bounds.top * TILE_SIZE_PX,
        (bounds.right - bounds.left) * TILE_SIZE_PX,
        (bounds.bottom - bounds.top) * TILE_SIZE_PX,
      );
      continue;
    }
    clearFogRect(
      ctx,
      tile.x * TILE_SIZE_PX,
      tile.y * TILE_SIZE_PX,
      TILE_SIZE_PX,
      TILE_SIZE_PX,
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
  return (state.entities || []).some(
    (entity) =>
      entity.subtype === "door" &&
      !isDoorPassable(entity) &&
      entity.x === tile.x &&
      entity.y === tile.y,
  );
}

function canUseCoarseExploredTileFog(state, visitedRoomIds, tile) {
  if (
    getInnerWallTileData(tile)?.blocksMovement === true ||
    isOrganicMovementBlockingTile(tile)
  ) {
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
  const polygons = Array.isArray(
    state.visibility.exploredLightPolygonsBeforeNow,
  )
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
  if (
    !Number.isFinite(Number(column?.x)) ||
    !Number.isFinite(Number(column?.y))
  ) {
    return null;
  }
  const placement = String(column.placement || "center");
  const drawX =
    placement === "vertex" ? Number(column.x) - 0.5 : Number(column.x);
  const drawY =
    placement === "vertex" ? Number(column.y) - 0.5 : Number(column.y);
  const left = drawX * TILE_SIZE_PX + PILLAR_SHADOW_INSET_PX;
  const top = drawY * TILE_SIZE_PX + PILLAR_SHADOW_INSET_PX;
  return {
    left,
    top,
    right: left + PILLAR_SHADOW_SIZE_PX,
    bottom: top + PILLAR_SHADOW_SIZE_PX,
  };
}

function getColumnShadowPolygon(source, column, radiusPx) {
  const rect = getColumnShadowRect(column);
  if (!rect) {
    return null;
  }
  const sourcePoint = [
    (Number(source.x) + 0.5) * TILE_SIZE_PX,
    (Number(source.y) + 0.5) * TILE_SIZE_PX,
  ];
  if (
    sourcePoint[0] >= rect.left &&
    sourcePoint[0] <= rect.right &&
    sourcePoint[1] >= rect.top &&
    sourcePoint[1] <= rect.bottom
  ) {
    return null;
  }
  const center = [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];
  if (
    Math.hypot(center[0] - sourcePoint[0], center[1] - sourcePoint[1]) >
    radiusPx + PILLAR_SHADOW_SIZE_PX
  ) {
    return null;
  }
  const corners = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom],
  ]
    .map((point) => ({
      point,
      angle: Math.atan2(point[1] - sourcePoint[1], point[0] - sourcePoint[0]),
    }))
    .sort((a, b) => a.angle - b.angle);
  let largestGap = -Infinity;
  let gapIndex = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index].angle;
    const next =
      corners[(index + 1) % corners.length].angle +
      (index === corners.length - 1 ? Math.PI * 2 : 0);
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
    sourcePoint[1] + Math.sin(startAngle) * radiusPx,
  ];
  const farEnd = [
    sourcePoint[0] + Math.cos(endAngle) * radiusPx,
    sourcePoint[1] + Math.sin(endAngle) * radiusPx,
  ];
  return [start.point, farStart, farEnd, end.point];
}

function drawCurrentPillarShadowFog(state, ctx) {
  const legacyOrganicPillars = (state.tiles || []).filter(
    (tile) =>
      isOrganicPillarTile(tile) &&
      !getReviewedTileRule(getOrganicTileData(tile)?.asset),
  );
  const columns = [...(state.decor?.columns || []), ...legacyOrganicPillars];
  if (!columns.length) {
    return;
  }
  const lightSources = collectLightSources(state);
  if (!lightSources.length) {
    return;
  }
  for (const source of lightSources) {
    const radiusPx =
      (Math.max(1, Number(source.radius) || 6) + 0.5) * TILE_SIZE_PX;
    const unblockedByPillarsPolygon = computeLightPolygon(state, source, {
      ignorePillars: true,
    });
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
      EXPLORED_FOG_ALPHA,
    );
  }
}

function drawExploredFog(state, ctx, bounds) {
  ctx.save();
  clipToFloorTiles(ctx, state, () => true);
  const compact = drawExplorationMemory(state, ctx, bounds);
  ctx.restore();
  if (!compact) drawExploredTileFog(state, ctx);
  drawExploredLightPolygonFog(state, ctx);
  drawCurrentPillarShadowFog(state, ctx);
  if (!compact) drawExploredInnerWallInteriorFog(state, ctx);
  drawDarkvisionFog(state, ctx);
}

export function drawDarkvisionFog(state, ctx) {
  const drawn = new Set();
  for (const [route, cells] of Object.entries(
    state.visibility.routeDarkvisionExplored || {},
  )) {
    for (const key of cells instanceof Set || Array.isArray(cells)
      ? cells
      : []) {
      if (drawn.has(key)) continue;
      const [x, y] = key.split(",").map(Number),
        tile = getTileAt(state, x, y);
      if (
        !tile ||
        tile.type === TILE_TYPES.WALL ||
        tile.type === TILE_TYPES.VOID ||
        tile.meta?.neverExplore ||
        !routeExistsAt(state, x, y, route)
      )
        continue;
      drawn.add(key);
      drawFogRect(
        ctx,
        x * TILE_SIZE_PX,
        y * TILE_SIZE_PX,
        TILE_SIZE_PX,
        TILE_SIZE_PX,
        EXPLORED_FOG_ALPHA,
      );
    }
  }
}

function drawAngledShadowWedges(state, ctx) {
  const width = Number(state.map?.width || 0);
  const height = Number(state.map?.height || 0);
  if (width < 2 || height < 2) {
    return;
  }
  const lightSources = collectLightSources(state);
  const secretThresholds = new Set(
    (state.entities || [])
      .filter(isClosedSecretDoor)
      .map((door) => tileKey(door.x, door.y)),
  );
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
    clipToFloorTiles(
      ctx,
      state,
      (tile) =>
        !secretThresholds.has(tileKey(tile.x, tile.y)) ||
        state.visibility.visibleNow.has(tileKey(tile.x, tile.y)),
    );
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
    if (
      door.secret === true &&
      door.secretFound !== true &&
      door.revealed !== true
    ) {
      continue;
    }
    const visibleSides =
      state.visibility.closedDoorVisibleSides?.get?.(door.id) || new Set();
    const exploredSides =
      state.visibility.closedDoorExploredSides?.get?.(door.id) || new Set();
    if (!visibleSides.size && !exploredSides.size) {
      continue;
    }
    const px = door.x * TILE_SIZE_PX;
    const py = door.y * TILE_SIZE_PX;
    const half = TILE_SIZE_PX / 2;
    if (door.orientation !== "horizontal") {
      const leftVisible = visibleSides.has("left");
      const rightVisible = visibleSides.has("right");
      applyDoorHalfFog(
        px,
        py,
        half,
        TILE_SIZE_PX,
        leftVisible,
        exploredSides.has("left"),
      );
      applyDoorHalfFog(
        px + half,
        py,
        half,
        TILE_SIZE_PX,
        rightVisible,
        exploredSides.has("right"),
      );
      continue;
    }
    const topVisible = visibleSides.has("top");
    const bottomVisible = visibleSides.has("bottom");
    applyDoorHalfFog(
      px,
      py,
      TILE_SIZE_PX,
      half,
      topVisible,
      exploredSides.has("top"),
    );
    applyDoorHalfFog(
      px,
      py + half,
      TILE_SIZE_PX,
      half,
      bottomVisible,
      exploredSides.has("bottom"),
    );
  }
}

const fogCaches = new WeakMap();
const FOG_CACHE_BYTES = 12 * 1024 * 1024;
function memoryCellAllowed(state, routeId, key) {
  if (routeId === LEGACY_EXPLORATION_ROUTE) return true;
  if (!state.underpasses?.length) return routeId === "";
  const [x, y] = key.split(",").map(Number);
  if (!routeExistsAt(state, x, y, routeId)) return false;
  return !Object.entries(state.visibility.routeVisible || {}).some(
    ([other, cells]) =>
      other !== routeId &&
      cells.has(key) &&
      ((routeId && !other) ||
        !state.visibility.routeVisible?.[routeId]?.has(key)),
  );
}
function paintMemoryCell(ctx, route, key, alpha) {
  const [x, y] = key.split(",").map(Number);
  if (route.complete[key]) {
    drawFogRect(
      ctx,
      x * TILE_SIZE_PX,
      y * TILE_SIZE_PX,
      TILE_SIZE_PX,
      TILE_SIZE_PX,
      alpha,
    );
    return;
  }
  const shape = route.partial[key];
  if (!shape) return;
  ctx.save();
  ctx.translate(x * TILE_SIZE_PX, y * TILE_SIZE_PX);
  ctx.beginPath();
  for (const polygon of shape)
    for (const ring of polygon) {
      ctx.moveTo(
        (ring[0][0] - x) * TILE_SIZE_PX,
        (ring[0][1] - y) * TILE_SIZE_PX,
      );
      for (let i = 1; i < ring.length; i++)
        ctx.lineTo(
          (ring[i][0] - x) * TILE_SIZE_PX,
          (ring[i][1] - y) * TILE_SIZE_PX,
        );
      ctx.closePath();
    }
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(0,0,0," + alpha + ")";
  ctx.fill();
  ctx.restore();
}
function canvasForFog(ctx, width, height) {
  const document = ctx.canvas?.ownerDocument;
  if (!document?.createElement) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d") ? canvas : null;
}
export function fogCacheStats(ctx) {
  const cache = fogCaches.get(ctx);
  return cache
    ? {
        entries: cache.entries.size,
        bytes: cache.bytes,
        rebuilds: cache.rebuilds,
        hits: cache.hits,
      }
    : { entries: 0, bytes: 0, rebuilds: 0, hits: 0 };
}

function drawExplorationMemory(state, ctx, bounds, alpha = EXPLORED_FOG_ALPHA) {
  const memory = state.visibility.explorationMemory;
  if (!memory) return false;
  let cache = fogCaches.get(ctx);
  if (!cache || cache.memory !== memory) {
    cache = {
      memory,
      entries: new Map(),
      chunks: new Map(),
      bytes: 0,
      frame: 0,
      rebuilds: 0,
      hits: 0,
    };
    fogCaches.set(ctx, cache);
  }
  cache.frame++;
  const size = EXPLORATION_CHUNK_TILES * TILE_SIZE_PX;
  const view = bounds || {
    x: 0,
    y: 0,
    width: state.map.width * TILE_SIZE_PX,
    height: state.map.height * TILE_SIZE_PX,
  };
  const visibleChunks = new Map();
  for (const [routeId, route] of Object.entries(memory.routes)) {
    for (const [key, chunk] of explorationChunks(memory, routeId)) {
      const [cx, cy] = key.split(",").map(Number),
        x = cx * size,
        y = cy * size;
      if (
        x >= view.x + view.width ||
        y >= view.y + view.height ||
        x + size <= view.x ||
        y + size <= view.y
      )
        continue;
      const cells = [...chunk.cells].filter((cell) =>
        memoryCellAllowed(state, routeId, cell),
      );
      if (!cells.length) continue;
      if (!visibleChunks.has(key)) visibleChunks.set(key, []);
      visibleChunks.get(key).push({ routeId, route, chunk, cells });
    }
  }
  for (const [chunkKey, planes] of visibleChunks) {
    const [cx, cy] = chunkKey.split(",").map(Number),
      x = cx * size,
      y = cy * size;
    const signature = planes
      .map(
        ({ routeId, chunk, cells }) =>
          routeId + ":" + chunk.revision + ":" + cells.join(";"),
      )
      .join("|");
    let geometry = cache.chunks.get(chunkKey);
    if (!geometry || geometry.signature !== signature) {
      const byCell = new Map();
      for (const { route, cells } of planes)
        for (const key of cells) {
          if (!byCell.has(key)) byCell.set(key, []);
          byCell.get(key).push(route);
        }
      const route = { complete: {}, partial: {} };
      for (const [key, candidates] of byCell) {
        if (candidates.some((candidate) => candidate.complete[key]))
          route.complete[key] = true;
        else
          route.partial[key] = mergeExplorationShapes(
            candidates
              .map((candidate) => candidate.partial[key])
              .filter(Boolean),
          );
      }
      geometry = { signature, route, cells: [...byCell.keys()] };
      cache.chunks.set(chunkKey, geometry);
    }
    const completeCells = geometry.cells.filter(
      (key) => geometry.route.complete[key],
    );
    const partialCells = geometry.cells.filter(
      (key) => geometry.route.partial[key],
    );
    const rasterSignature = completeCells.join(";");
    const id = chunkKey + "|" + alpha,
      hasComplete = completeCells.length > 0;
    let entry = cache.entries.get(id);
    if (entry && entry.signature !== rasterSignature) {
      cache.entries.delete(id);
      cache.bytes -= entry.bytes;
      entry = null;
    }
    if (!entry && hasComplete) {
      const width = Math.min(size, state.map.width * TILE_SIZE_PX - x),
        height = Math.min(size, state.map.height * TILE_SIZE_PX - y),
        bytes = width * height * 4;
      while (cache.bytes + bytes > FOG_CACHE_BYTES) {
        const oldest = [...cache.entries].find(
          ([, item]) => item.frame !== cache.frame,
        );
        if (!oldest) break;
        cache.entries.delete(oldest[0]);
        cache.bytes -= oldest[1].bytes;
      }
      if (cache.bytes + bytes <= FOG_CACHE_BYTES) {
        const canvas = canvasForFog(ctx, width, height);
        if (canvas) {
          const target = canvas.getContext("2d");
          target.fillStyle = "#000";
          target.fillRect(0, 0, width, height);
          target.translate(-x, -y);
          for (const key of completeCells)
            paintMemoryCell(target, geometry.route, key, alpha);
          entry = {
            canvas,
            signature: rasterSignature,
            bytes,
            frame: cache.frame,
          };
          cache.entries.set(id, entry);
          cache.bytes += bytes;
          cache.rebuilds++;
        }
      }
    } else if (entry) cache.hits++;
    if (entry) {
      entry.frame = cache.frame;
      cache.entries.delete(id);
      cache.entries.set(id, entry);
      ctx.save();
      ctx.beginPath();
      for (const key of completeCells) {
        const [tx, ty] = key.split(",").map(Number);
        ctx.rect(
          tx * TILE_SIZE_PX,
          ty * TILE_SIZE_PX,
          TILE_SIZE_PX,
          TILE_SIZE_PX,
        );
      }
      ctx.clip();
      ctx.clearRect(x, y, entry.canvas.width, entry.canvas.height);
      ctx.drawImage(entry.canvas, x, y);
      ctx.restore();
    } else
      for (const key of completeCells)
        paintMemoryCell(ctx, geometry.route, key, alpha);
    // Partial boundaries remain native vector paths, avoiding raster-transfer edge rounding.
    for (const key of partialCells)
      paintMemoryCell(ctx, geometry.route, key, alpha);
  }
  return true;
}
