import { TILE_SIZE_PX } from './constants.js';
import { createDoorEntity, getTile } from './state-schema.js';

const key = (x, y) => `${x},${y}`;
const indexes = new WeakMap();
export const UPPER_ROUTE = '';
export const UNDERPASS_OPACITY = .5;
export const UNDERPASS_ASSETS = ['stairs-down-w-to-e', 'stairs-down-e-to-w', 'stairs-down-straight-1x1', 'stairs-down-straight-1x2', 'tunnel-below', 'tunnel-below-wall'];

function topology(state) {
  const routes = state.underpasses || [];
  const cached = indexes.get(state);
  if (cached?.routes === routes && cached.tiles === state.tiles) return cached;
  const lower = new Map(), upperBlocked = new Set(), byId = new Map(), entrances = new Map();
  for (const route of routes) {
    const cells = new Set(route.lowerCells.map(cell => key(cell.x, cell.y)));
    const crossings = new Set(route.upperCrossings.map(cell => key(cell.x, cell.y)));
    byId.set(route.id, { ...route, cells });
    for (const cell of cells) { lower.set(cell, route.id); if (!crossings.has(cell)) upperBlocked.add(cell); }
    for (const portal of route.portals) entrances.set(`${key(portal.upper.x, portal.upper.y)}>${key(portal.lower.x, portal.lower.y)}`, route.id);
  }
  const value = { routes, tiles: state.tiles, lower, upperBlocked, byId, entrances, lightSegments: new Map() };
  indexes.set(state, value); return value;
}

export function routeAt(state, x, y, preferred = null) {
  if (!state.underpasses?.length) return UPPER_ROUTE;
  const data = topology(state), cell = key(Math.round(x), Math.round(y));
  if (preferred && data.byId.get(preferred)?.cells.has(cell)) return preferred;
  return data.upperBlocked.has(cell) ? data.lower.get(cell) : UPPER_ROUTE;
}

export function routeOf(state, point) {
  if (!state.underpasses?.length) return UPPER_ROUTE;
  return typeof point?.routeId === 'string' ? point.routeId : routeAt(state, point?.x, point?.y);
}
export const sameRoute = (state, a, b) => routeOf(state, a) === routeOf(state, b);
export const routeKey = point => `${point.routeId || ''}|${point.x},${point.y}`;

export function routeExistsAt(state, x, y, routeId = UPPER_ROUTE) {
  if (!state.underpasses?.length) return !routeId;
  if (x < 0 || y < 0 || x >= state.map?.width || y >= state.map?.height) return false;
  const data = topology(state), cell = key(x, y);
  return routeId ? Boolean(data.byId.get(routeId)?.cells.has(cell)) : !data.upperBlocked.has(cell);
}

export function routeStep(state, from, to, { phase = from?.conditions?.incorporeal === true } = {}) {
  const routeId = routeOf(state, from);
  if (!state.underpasses?.length) return { ...to, routeId: UPPER_ROUTE };
  if (phase) return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) <= 1 &&
    to.x >= 0 && to.y >= 0 && to.x < state.map.width && to.y < state.map.height ? { ...to, routeId } : null;
  if (!routeExistsAt(state, from.x, from.y, routeId)) return null;
  const data = topology(state), dx = to.x - from.x, dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) return null;
  if (routeId) {
    const route = data.byId.get(routeId);
    if (route?.cells.has(key(to.x, to.y)) && (!dx || !dy || route.kind === 'pit-tunnel' &&
        route.cells.has(key(from.x, to.y)) && route.cells.has(key(to.x, from.y)))) return { ...to, routeId };
    if (route?.portals.some(portal => portal.lower.x === from.x && portal.lower.y === from.y && portal.upper.x === to.x && portal.upper.y === to.y)) return { ...to, routeId: UPPER_ROUTE };
    return null;
  }
  const entrance = data.entrances.get(`${key(from.x, from.y)}>${key(to.x, to.y)}`);
  if (entrance) return { ...to, routeId: entrance };
  return routeExistsAt(state, to.x, to.y) ? { ...to, routeId: UPPER_ROUTE } : null;
}

export function routeLineClear(state, from, to) {
  if (!state.underpasses?.length) return true;
  if (!sameRoute(state, from, to)) return false;
  const route = routeOf(state, from), count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 4));
  for (let step = 0; step <= count; step++) {
    const x = Math.floor(from.x + .5 + (to.x - from.x) * step / count), y = Math.floor(from.y + .5 + (to.y - from.y) * step / count);
    if (!routeExistsAt(state, x, y, route)) return false;
  }
  return true;
}

export function routeLightSegments(state, source) {
  if (!state.underpasses?.length) return [];
  const data = topology(state), routeId = routeOf(state, source);
  if (data.lightSegments.has(routeId)) return data.lightSegments.get(routeId);
  const cells = routeId ? data.byId.get(routeId)?.cells || new Set() : data.upperBlocked;
  const segments = [];
  for (const cell of cells) {
    const [x, y] = cell.split(',').map(Number);
    for (const [dx, dy, a, b] of [[0, -1, [x, y], [x + 1, y]], [1, 0, [x + 1, y], [x + 1, y + 1]],
      [0, 1, [x + 1, y + 1], [x, y + 1]], [-1, 0, [x, y + 1], [x, y]]]) {
      if (!cells.has(key(x + dx, y + dy))) segments.push([a, b].map(point => point.map(value => value * TILE_SIZE_PX)));
    }
  }
  data.lightSegments.set(routeId, segments); return segments;
}

export function normalizeUnderpassPositions(state) {
  if (!state.underpasses?.length) return;
  if (state.underpasses.some(route => route.artVersion !== 2)) state.underpasses = state.underpasses.map(route => {
    if (route.artVersion === 2 || route.kind === 'pit-tunnel') return route;
    const crossing = route.upperCrossings[0], endpoints = route.portals.map(portal => portal.upper);
    const wallCrossings = route.wallCrossings || preservedUpperWalls(state, route.lowerCells, crossing, route.axis);
    return { ...route, ...makeUnderpass(route.id, route.lowerCells, crossing, endpoints, route.axis, { wallCrossings }) };
  });
  for (const point of [state.player, ...(state.characters || []), ...(state.entities || [])].filter(Boolean)) {
    const route = routeOf(state, point);
    if (point.conditions?.incorporeal) continue;
    point.routeId = routeExistsAt(state, point.x, point.y, route) ? route : routeAt(state, point.x, point.y);
  }
}

export function reachableRoutes(state, start, canStep) {
  const first = { x: start.x, y: start.y, routeId: routeOf(state, start) }, queue = [first], reached = new Set([routeKey(first)]);
  for (let i = 0; i < queue.length; i++) {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const next = routeStep(state, queue[i], { x: queue[i].x + dx, y: queue[i].y + dy });
      if (!next || reached.has(routeKey(next)) || !canStep(queue[i], next)) continue;
      reached.add(routeKey(next)); queue.push(next);
    }
    // Physical reachability includes deliberate climbing, never an ordinary movement shortcut.
    for (const next of pitTraversalNeighbors(state, queue[i])) if (!reached.has(routeKey(next))) {
      reached.add(routeKey(next)); queue.push(next);
    }
  }
  return reached;
}

export function pitTraversalNeighbors(state, point) {
  const result = [];
  for (const pit of state.entities || []) {
    if (!pit.lowerRouteId) continue;
    const cells = pit.cells || [{ x: pit.x, y: pit.y }], contains = item => cells.some(cell => cell.x === item.x && cell.y === item.y);
    if (point.routeId === pit.lowerRouteId && contains(point)) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const next = { x: point.x + dx, y: point.y + dy, routeId: pit.routeId || '' };
        if (!contains(next) && getTile(state, next.x, next.y)?.type === 'floor') result.push(next);
      }
    } else if (point.routeId === (pit.routeId || '') && !contains(point)) {
      for (const cell of cells) if (Math.abs(cell.x - point.x) + Math.abs(cell.y - point.y) === 1) result.push({ ...cell, routeId: pit.lowerRouteId });
    }
  }
  return result;
}

export function makeUnderpass(id, cells, crossing, endpoints, axis = 'horizontal', { wallCrossings = [] } = {}) {
  const turn = axis === 'horizontal' ? 0 : 1, first = cells[0], last = cells.at(-1);
  const firstArt = { x: first.x, y: first.y, asset: 'stairs-down-w-to-e', turn, w: 2, h: 1 };
  const lastArt = { x: axis === 'horizontal' ? last.x - 1 : last.x, y: axis === 'horizontal' ? last.y : last.y - 1,
    asset: 'stairs-down-e-to-w', turn, w: 2, h: 1 };
  const art = [firstArt, lastArt];
  const walls = new Set(wallCrossings.map(cell => key(cell.x, cell.y))), middle = cells.slice(2, -2);
  const special = cell => cell.x === crossing.x && cell.y === crossing.y || walls.has(key(cell.x, cell.y));
  for (let i = 0; i < middle.length; i++) {
    const cell = middle[i];
    if (special(cell)) {
      art.push({ ...cell, asset: walls.has(key(cell.x, cell.y)) ? 'tunnel-below-wall' : 'tunnel-below', turn: 1 - turn, w: 1, h: 1 });
    } else {
      const pair = middle[i + 1] && !special(middle[i + 1]);
      art.push({ ...cell, asset: `stairs-down-straight-1x${pair ? 2 : 1}`, turn, w: pair ? 2 : 1, h: 1 });
      if (pair) i++;
    }
  }
  return { id, axis, artVersion: 2, wallCrossings: wallCrossings.map(cell => ({ x: cell.x, y: cell.y })),
    lowerCells: cells.map(cell => ({ ...cell })), upperCrossings: [{ ...crossing }],
    portals: [{ upper: { ...endpoints[0] }, lower: { ...first } }, { upper: { ...endpoints[1] }, lower: { ...last } }], art };
}

function preservedUpperWalls(state, cells, crossing, axis) {
  const offsets = axis === 'horizontal' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
  return cells.slice(2, -2).filter(cell => cell.x !== crossing.x || cell.y !== crossing.y).filter(cell =>
    offsets.some(([dx, dy]) => Boolean(getTile(state, cell.x + dx, cell.y + dy)?.roomId)));
}

export function addUnderpasses(state, rng, { canStand, canStep, maxCount = 1 } = {}) {
  if (!maxCount) return;
  const baseline = reachableRoutes(state, state.player, canStep), candidates = [];
  const protectedCell = (x, y) => {
    const tile = getTile(state, x, y);
    return !tile || Object.keys(tile.meta || {}).some(name => /organic|innerWall|angledWall|reviewed|layout|crypt|water|canal/i.test(name)) ||
      (state.entities || []).some(entity => entity.x === x && entity.y === y) ||
      Object.values(state.decor || {}).flatMap(value => Array.isArray(value) ? value : []).some(item =>
        Number.isFinite(item?.x) && Number.isFinite(item?.y) && x >= item.x && y >= item.y &&
        x < item.x + (item.gridWidthTiles || item.width || 1) && y < item.y + (item.gridHeightTiles || item.height || 1));
  };
  for (const tile of state.tiles) {
    if (tile.type !== 'floor' || tile.roomId || !canStand(tile) || protectedCell(tile.x, tile.y)) continue;
    for (const axis of ['horizontal', 'vertical']) {
      const [dx, dy] = axis === 'horizontal' ? [1, 0] : [0, 1];
      if (![[-dy, dx], [dy, -dx]].every(([x, y]) => getTile(state, tile.x + x, tile.y + y)?.type === 'floor')) continue;
      const distances = [-1, 1].map(sign => {
        for (let n = 1; n <= 12; n++) {
          const x = tile.x + dx * n * sign, y = tile.y + dy * n * sign, current = getTile(state, x, y);
          if (!current) return 0;
          if (current.type === 'floor') {
            if (current.roomId) {
              const room = state.rooms.find(item => item.id === current.roomId);
              if (!room || room.crypt || room.organic || room.reviewedTemplate) return 0;
              const position = dx ? y : x, start = dx ? room.y : room.x, size = dx ? room.height : room.width;
              if (size > 2 && (position <= start || position >= start + size - 1)) return 0;
            }
            return n >= (current.roomId ? 4 : 3) && baseline.has(`|${x},${y}`) && canStand(current) ? n : 0;
          }
          if (protectedCell(x, y)) return 0;
        }
        return 0;
      });
      if (distances.some(value => !value)) continue;
      let cells = Array.from({ length: distances[0] + distances[1] - 1 }, (_, index) => ({
        x: tile.x + dx * (index - distances[0] + 1), y: tile.y + dy * (index - distances[0] + 1) }));
      const endpoints = [{ x: tile.x - dx * distances[0], y: tile.y - dy * distances[0] },
        { x: tile.x + dx * distances[1], y: tile.y + dy * distances[1] }];
      const roomIds = endpoints.map(point => getTile(state, point.x, point.y).roomId), doors = [];
      // Keep a normal doorway outside each room before the descending stair art.
      if (roomIds[0]) { endpoints[0] = cells[0]; cells = cells.slice(1); doors.push({ ...endpoints[0], roomId: roomIds[0], side: dx ? 'east' : 'south' }); }
      if (roomIds[1]) { endpoints[1] = cells.at(-1); cells = cells.slice(0, -1); doors.push({ ...endpoints[1], roomId: roomIds[1], side: dx ? 'west' : 'north' }); }
      const wallCrossings = preservedUpperWalls(state, cells, tile, axis);
      candidates.push({ route: makeUnderpass(`underpass-${state.seed}-${candidates.length}`, cells, tile, endpoints, axis, { wallCrossings }), doors, roomIds,
        wallCount: wallCrossings.length });
    }
  }
  state.underpasses ||= [];
  while (candidates.length && state.underpasses.length < maxCount) {
    const minimumWalls = Math.min(...candidates.map(candidate => candidate.wallCount));
    const choices = candidates.map((candidate, index) => candidate.wallCount === minimumWalls ? index : -1).filter(index => index >= 0);
    const [{ route, doors, roomIds }] = candidates.splice(choices[rng.nextInt(0, choices.length - 1)], 1);
    if (route.lowerCells.some(cell => state.underpasses.some(other => other.lowerCells.some(point => Math.max(Math.abs(point.x - cell.x), Math.abs(point.y - cell.y)) <= 1)))) continue;
    const old = [...route.lowerCells, ...doors].map(cell => ({ tile: getTile(state, cell.x, cell.y), data: structuredClone(getTile(state, cell.x, cell.y)) }));
    for (const { tile } of old) { tile.type = 'floor'; tile.hallId ||= route.id; }
    state.underpasses = [...state.underpasses, route];
    const reached = reachableRoutes(state, state.player, canStep);
    const valid = [...baseline].every(cell => reached.has(cell)) && route.lowerCells.every(cell => reached.has(routeKey({ ...cell, routeId: route.id })));
    if (!valid) {
      state.underpasses = state.underpasses.filter(item => item !== route);
      for (const { tile, data } of old) { for (const field of Object.keys(tile)) delete tile[field]; Object.assign(tile, data); }
      continue;
    }
    const doorIds = doors.map(point => {
      const orientation = ['east', 'west'].includes(point.side) ? 'vertical' : 'horizontal';
      const door = createDoorEntity(point.x, point.y, point.roomId, route.id, rng, orientation, point.side, point.side,
        orientation === 'vertical' ? 'north' : 'west', 'room');
      Object.assign(door, { routeId: UPPER_ROUTE, connectedHallIds: [route.id] });
      state.entities.push(door); return door.id;
    });
    state.halls ||= [];
    state.halls.push({ id: route.id, fromRoomId: roomIds[0] || null, toRoomId: roomIds[1] || null, doors: doorIds, underpass: true });
  }
  state.generation.underpasses = { count: state.underpasses.length, connectivityValid: true };
}
