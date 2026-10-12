import { DOOR_STATES, TILE_TYPES } from './constants.js';
import { createDoorEntity, getTile } from './state-schema.js';
import { SeededRng } from './rng.js';
import { clearOrganicTileMeta, isOrganicMovementBlockingTile } from './organic-tiles.js';
import { clearInnerWallTileMeta, isInnerWallBlockingTile } from './inner-walls.js';
import { clearAngledWallTileMeta, isAngledWallMovementBlockingTile } from './angled-walls.js';

export const CRYPT_RULES = Object.freeze({ dungeonChance: .2, hallwayRatio: .5,
  deadEndRatio: .5, doorTrapChance: .02 });
export const CRYPT_ASSET_KEYS = Object.freeze(Array.from({ length: 8 }, (_, index) => `crypt ${index + 1}`));
const DIRECTIONS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const SIDES = ['north', 'east', 'south', 'west'];
const key = point => `${point.x},${point.y}`;
const step = (point, [dx, dy], distance = 1) => ({ x: point.x + dx * distance, y: point.y + dy * distance });
const shuffled = (list, rng) => {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export function isUndeadMonster(monster) {
  return Array.isArray(monster?.tags) && monster.tags.some(tag => String(tag).trim().toLowerCase() === 'undead');
}

function passable(tile) {
  return tile?.type === TILE_TYPES.FLOOR && !isOrganicMovementBlockingTile(tile) &&
    !isInnerWallBlockingTile(tile) && !isAngledWallMovementBlockingTile(tile);
}

function unusedWall(tile) {
  return tile && !tile.roomId && !tile.hallId && !tile.meta?.cryptWall && !tile.meta?.reviewed &&
    (tile.type === TILE_TYPES.WALL || (tile.meta?.organicShell === true && isOrganicMovementBlockingTile(tile))) &&
    !tile.meta?.innerWall && !tile.meta?.angledWall;
}

// The latest export counts the threshold in each chamber: 2 cells, or 3 for crypts 7/8.
function chamber(anchor, direction, assetKey) {
  const turn = DIRECTIONS.findIndex(([dx, dy]) => dx === direction[0] && dy === direction[1]);
  const length = ['crypt 7','crypt 8'].includes(assetKey) ? 3 : 2;
  const cells = Array.from({length},(_,index)=>step(anchor,direction,index+1));
  const artCells = cells.slice(-2);
  const door = step(anchor, direction), tangent = [-direction[1], direction[0]], walls = [];
  for (let depth = 1; depth <= length+1; depth++) for (let side = -1; side <= 1; side++) {
    if (side === 0 && depth <= length) continue;
    walls.push(step(step(anchor, direction, depth), tangent, side));
  }
  return { cells, artCells, assetKey, length, door, walls, turn, opening: SIDES[turn] };
}

function pair(anchor, tangent, rng) {
  const perpendicular = [-tangent[1], tangent[0]];
  const pool=rng.nextFloat()<.25 ? CRYPT_ASSET_KEYS.slice(6) : CRYPT_ASSET_KEYS.slice(0,6);
  return [chamber(anchor, perpendicular, rng.pick(pool)), chamber(anchor, perpendicular.map(value => -value), rng.pick(pool))];
}

function planFits(state, plan) {
  const floors = new Set([...plan.path, ...plan.chambers.flatMap(room => [...room.cells, room.door])].map(key));
  const points = [...plan.path, ...plan.chambers.flatMap(room => [...room.cells, room.door, ...room.walls]), ...(plan.walls || [])];
  for (const point of points) {
    const tile = getTile(state, point.x, point.y);
    if (!tile || point.x < 1 || point.y < 1 || point.x >= state.map.width - 1 || point.y >= state.map.height - 1) return false;
    if (key(point) === key(plan.anchor)) continue;
    if (!unusedWall(tile)) return false;
  }
  for (const point of [...plan.path, ...plan.chambers.flatMap(room => [...room.cells, room.door])]) {
    for (const direction of DIRECTIONS) {
      const neighbor = step(point, direction), tile = getTile(state, neighbor.x, neighbor.y);
      if (key(neighbor) !== key(plan.anchor) && !floors.has(key(neighbor)) && passable(tile)) return false;
    }
  }
  return true;
}

function clearGeometry(tile) {
  clearOrganicTileMeta(tile); clearInnerWallTileMeta(tile); clearAngledWallTileMeta(tile);
  delete tile.meta.organicShell; delete tile.meta.organicOpenSides;
  delete tile.meta.neverExplore;
}

function carveFloor(state, point, roomId, hallId) {
  const tile = getTile(state, point.x, point.y);
  clearGeometry(tile);
  Object.assign(tile, { type: TILE_TYPES.FLOOR, roomId, hallId });
  tile.meta.crypt = true;
}

function commitPlan(state, plan, rng, hall, terminal = false) {
  clearGeometry(getTile(state, plan.anchor.x, plan.anchor.y));
  for (const point of plan.path) carveFloor(state, point, null, hall.id);
  const roomIds = [];
  for (const [index, spec] of plan.chambers.entries()) {
    const x = Math.min(...spec.cells.map(point => point.x)), y = Math.min(...spec.cells.map(point => point.y));
    const room = { id: `crypt-room-${state.rooms.length}`, x, y,
      width: spec.turn % 2 ? spec.length : 1, height: spec.turn % 2 ? 1 : spec.length,
      crypt: true, role: 'crypt', renderer: 'crypt', discovered: false, explored: false,
      opening: spec.opening, cryptHallId: hall.id, cryptAsset: spec.assetKey, doorCellIncluded: true,
      terminalCrypt: terminal && index === plan.chambers.length - 1,
      graphDepth: Math.max(1, ...state.rooms.filter(room => [hall.fromRoomId, hall.toRoomId].includes(room.id)).map(room => room.graphDepth || 0)) + 1 };
    state.rooms.push(room); roomIds.push(room.id);
    for (const point of spec.cells) carveFloor(state, point, room.id, null);
    const door = createDoorEntity(spec.door.x, spec.door.y, room.id, hall.id, rng,
      spec.turn % 2 ? 'vertical' : 'horizontal', spec.opening, spec.opening);
    door.crypt = true; door.connectedHallIds = [hall.id];
    door.doorState = rng.nextFloat() < .1 ? DOOR_STATES.LOCKED : DOOR_STATES.CLOSED;
    state.entities.push(door); (hall.doors ||= []).push(door.id);
    state.decor.crypts.push({ assetKey: room.cryptAsset, x:Math.min(...spec.artCells.map(point=>point.x)),
      y:Math.min(...spec.artCells.map(point=>point.y)), rotationTurns: spec.turn,
      roomId: room.id, widthTiles: spec.turn%2?2:1, heightTiles: spec.turn%2?1:2 });
    state.generation.architecture.roles ||= {};
    state.generation.architecture.roles[room.id] = 'crypt';
  }
  const floors = new Set([...plan.path, ...plan.chambers.flatMap(room => [...room.cells, room.door])].map(key));
  for (const point of [...plan.chambers.flatMap(room => room.walls), ...(plan.walls || [])]) {
    if (floors.has(key(point))) continue;
    const tile = getTile(state, point.x, point.y);
    clearGeometry(tile); tile.type = TILE_TYPES.WALL; tile.meta.cryptWall = true;
  }
  hall.crypt = true; hall.cryptRoomIds = [...(hall.cryptRoomIds || []), ...roomIds];
  return roomIds;
}

function hallAnchors(state, hall, canAnchor = passable) {
  const doors = new Set(state.entities.filter(entity => entity.subtype === 'door').map(key));
  const points = hall.tiles?.length ? hall.tiles : state.tiles.filter(tile => tile.hallId === hall.id);
  const result = [];
  for (const point of points) {
    const tile = getTile(state, point.x, point.y);
    if (!canAnchor(tile) || tile.roomId || doors.has(key(point))) continue;
    for (const tangent of [[1, 0], [0, 1]]) {
      if ([-1, 1].every(distance => {
        const neighbor = step(point, tangent, distance), next = getTile(state, neighbor.x, neighbor.y);
        return passable(next) && !next.roomId && next.hallId === hall.id;
      })) result.push({ anchor: point, tangent });
    }
  }
  return result;
}

function throughPlan(state, hall, rng, canAnchor) {
  for (const { anchor, tangent } of shuffled(hallAnchors(state, hall, canAnchor), rng)) {
    const plan = { anchor, path: [], chambers: pair(anchor, tangent, rng) };
    if (planFits(state, plan)) return plan;
  }
  return null;
}

function deadEndPlans(state, rng, canAnchor) {
  const candidates = [];
  for (const hall of state.halls.filter(hall => !hall.entrance && !hall.crypt)) {
    for (const { anchor, tangent } of hallAnchors(state, hall, canAnchor)) {
      for (const direction of [[-tangent[1], tangent[0]], [tangent[1], -tangent[0]]]) {
        candidates.push({ anchor, direction, parent: hall });
      }
    }
  }
  // Room boundaries offer fallback space when an existing corridor has no room for a branch.
  for (const room of state.rooms.filter(room => !room.crypt && room.id !== state.generation.entranceRoomId)) {
    for (const tile of state.tiles.filter(tile => tile.roomId === room.id && canAnchor(tile))) {
      for (const direction of DIRECTIONS) {
        const neighbor = step(tile, direction);
        if (unusedWall(getTile(state, neighbor.x, neighbor.y))) candidates.push({ anchor: tile, direction, room });
      }
    }
  }
  return shuffled(candidates, rng);
}

function tryDeadEnd(state, rng, canAnchor) {
  for (const candidate of deadEndPlans(state, rng, canAnchor)) for (const length of [4, 3, 2, 5, 6]) {
    const path = Array.from({ length }, (_, index) => step(candidate.anchor, candidate.direction, index + 1));
    const middle = path[1], end = path[path.length - 1];
    const walls = path.flatMap(point => [-1, 1].map(distance => step(point,
      [-candidate.direction[1], candidate.direction[0]], distance)));
    const plan = { anchor: candidate.anchor, path, walls,
      chambers: [...pair(middle, candidate.direction, rng), chamber(end, candidate.direction, rng.pick(CRYPT_ASSET_KEYS))] };
    if (!planFits(state, plan)) continue;
    const hall = { id: `crypt-hall-${state.halls.length}`, fromRoomId: candidate.room?.id || candidate.parent.fromRoomId,
      toRoomId: null, tiles: path.map(point => ({ ...point })), doors: [], deadEnd: true,
      parentHallId: candidate.parent?.id || null, style: 'crypt' };
    const rooms = commitPlan(state, plan, rng, hall, true);
    hall.toRoomId = rooms[rooms.length - 1]; state.halls.push(hall);
    return hall;
  }
  return null;
}

export function addCryptHallways(state, options = {}) {
  // Use an independent stream so dungeons that miss this roll retain their existing generation.
  const rng = new SeededRng((Number(state.seed) >>> 0) ^ 0x43525950);
  rng.next(); rng.next();
  const enabled = options.cryptHallways ?? (rng.nextFloat() < CRYPT_RULES.dungeonChance);
  const info = { enabled: Boolean(enabled), dungeonChance: CRYPT_RULES.dungeonChance,
    hallwayRatio: CRYPT_RULES.hallwayRatio, deadEndRatio: CRYPT_RULES.deadEndRatio,
    hallwayIds: [], deadEndHallwayIds: [], roomIds: [] };
  if (!enabled) { state.generation.crypts = info; return info; }
  state.decor.crypts ||= [];
  const base = state.halls.filter(hall => !hall.entrance && !hall.crypt), target = Math.max(1, Math.round(base.length / 3));
  const canAnchor = options.canAnchor || passable;
  const deadEnds = [];
  for (let i = 0; i < target; i++) {
    const hall = tryDeadEnd(state, rng, canAnchor);
    if (!hall) break;
    deadEnds.push(hall);
  }
  const through = [];
  for (const hall of shuffled(base, rng)) {
    if (through.length >= target) break;
    const plan = throughPlan(state, hall, rng, canAnchor);
    if (!plan) continue;
    commitPlan(state, plan, rng, hall); through.push(hall);
  }
  info.hallwayIds = [...through, ...deadEnds].map(hall => hall.id);
  info.deadEndHallwayIds = deadEnds.map(hall => hall.id);
  info.roomIds = state.rooms.filter(room => room.crypt).map(room => room.id);
  info.totalHallways = state.halls.filter(hall => !hall.entrance).length;
  info.actualHallwayRatio = info.hallwayIds.length / Math.max(1, info.totalHallways);
  info.actualDeadEndRatio = deadEnds.length / Math.max(1, info.hallwayIds.length);
  info.placementLimited = through.length < target || deadEnds.length < target;
  state.generation.crypts = info;
  return info;
}
