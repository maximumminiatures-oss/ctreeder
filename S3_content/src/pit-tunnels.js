import { getTile } from './state-schema.js';
import { pitCells } from './pits.js';
import { reachableRoutes, routeKey } from './underpasses.js';

const key = point => `${point.x},${point.y}`;
const inside = (room, point) => point.x >= room.x && point.y >= room.y && point.x < room.x + room.width && point.y < room.y + room.height;
function shuffled(values, rng) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = rng.nextInt(0, i); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

export function makePitTunnel(state, id, pits, passage) {
  const cells = [...new Map([...passage, ...pits.flatMap(pit => pitCells(state, pit))].map(point => [key(point), { x: point.x, y: point.y }])).values()];
  const upperCrossings = cells.filter(point => getTile(state, point.x, point.y)?.type === 'floor');
  const pitSet = new Set(pits.flatMap(pit => pitCells(state, pit)).map(key));
  const art = passage.filter(point => !pitSet.has(key(point))).map((point, index, path) => {
    const neighbor = path[index + 1] || path[index - 1] || point;
    const horizontal = neighbor.x !== point.x;
    const tile = getTile(state, point.x, point.y);
    const wall = tile?.type !== 'floor' && [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => getTile(state, point.x + dx, point.y + dy)?.roomId);
    return { ...point, asset: wall ? 'tunnel-below-wall' : tile?.type === 'floor' ? 'tunnel-below' : 'stairs-down-straight-1x1',
      turn: wall || tile?.type === 'floor' ? Number(horizontal) : Number(!horizontal), w: 1, h: 1 };
  });
  for (const pit of pits) pit.lowerRouteId = id;
  return { id, kind: 'pit-tunnel', axis: 'free', artVersion: 2, lowerCells: cells, upperCrossings, portals: [], pitIds: pits.map(pit => pit.id), art };
}

function roomPit(state, room, rng, id) {
  const width = rng.nextInt(1, Math.min(5, room.width - 2)), height = rng.nextInt(1, Math.min(5, room.height - 2));
  const x = room.x + Math.floor((room.width - width) / 2), y = room.y + Math.floor((room.height - height) / 2);
  const cells = Array.from({ length: width * height }, (_, i) => ({ x: x + i % width, y: y + Math.floor(i / width) }));
  if (cells.some(point => getTile(state, point.x, point.y)?.type !== 'floor' ||
      Object.keys(getTile(state, point.x, point.y)?.meta || {}).length ||
      state.entities.some(entity => entity.x === point.x && entity.y === point.y))) return null;
  return { id, type: 'feature', subtype: 'pit', name: 'Pit', x, y, width, height, cells, roomId: room.id,
    routeId: '', visible: true, revealed: true, depthFeet: 30 };
}

export function addPitFeatures(state, rng, { networks = true, chance = .2, canStep = (from, to) => getTile(state, to.x, to.y)?.type === 'floor' } = {}) {
  const plainRooms = state.rooms.filter(room => room.width >= 3 && room.height >= 3 && !room.organic && !room.crypt && !room.reviewedTemplate);
  const occupied = point => state.underpasses?.some(route => route.lowerCells.some(cell => key(cell) === key(point)));
  if (networks && rng.nextFloat() < chance) {
    const baseline = reachableRoutes(state, state.player, canStep);
    const candidates = shuffled(plainRooms, rng).slice(0, 30);
    outer: for (const source of candidates) {
      const start = { x: source.x + Math.floor(source.width / 2), y: source.y + Math.floor(source.height / 2) };
      for (const [dx, dy] of shuffled([[1, 0], [-1, 0], [0, 1], [0, -1]], rng)) for (let length = 7; length <= 16; length++) {
        const end = { x: start.x + dx * length, y: start.y + dy * length };
        let target = plainRooms.find(room => room !== source && inside(room, end) &&
          end.x === room.x + Math.floor(room.width / 2) && end.y === room.y + Math.floor(room.height / 2));
        let bonus = false;
        if (!target) {
          target = { id: `pit-room-${state.seed}`, x: end.x - 2, y: end.y - 2, width: 5, height: 5, pitAccessOnly: true };
          const area = Array.from({ length: 49 }, (_, i) => ({ x: target.x - 1 + i % 7, y: target.y - 1 + Math.floor(i / 7) }));
          if (area.some(point => !getTile(state, point.x, point.y) || getTile(state, point.x, point.y).type !== 'wall' || occupied(point))) continue;
          bonus = true;
        }
        const passage = Array.from({ length: length + 1 }, (_, i) => ({ x: start.x + dx * i, y: start.y + dy * i }));
        if (passage.some(point => occupied(point) || state.entities.some(entity => entity.x === point.x && entity.y === point.y) ||
            getTile(state, point.x, point.y)?.roomId && !inside(source, point) && !inside(target, point) ||
            Object.keys(getTile(state, point.x, point.y)?.meta || {}).length)) continue;
        const first = roomPit(state, source, rng, `pit-${state.seed}-a`);
        if (!first || first.cells.some(occupied)) continue;
        const oldTiles = new Map(), previousRoutes = state.underpasses, entityCount = state.entities.length;
        const remember = tile => { if (!oldTiles.has(tile)) oldTiles.set(tile, structuredClone(tile)); return tile; };
        const rollback = () => {
          for (const [tile, old] of oldTiles) { for (const field of Object.keys(tile)) delete tile[field]; Object.assign(tile, old); }
          if (bonus) state.rooms = state.rooms.filter(room => room !== target);
          state.entities.length = entityCount; state.underpasses = previousRoutes;
        };
        if (bonus) {
          for (let y = target.y; y < target.y + target.height; y++) for (let x = target.x; x < target.x + target.width; x++)
            Object.assign(remember(getTile(state, x, y)), { type: 'floor', roomId: target.id, hallId: null });
          state.rooms.push(target);
        }
        const second = roomPit(state, target, rng, `pit-${state.seed}-b`);
        if (!second) { rollback(); continue; }
        const route = makePitTunnel(state, `pit-tunnel-${state.seed}`, [first, second], passage);
        for (const point of route.lowerCells) {
          const tile = getTile(state, point.x, point.y);
          if (tile.type !== 'floor') Object.assign(remember(tile), { type: 'floor', hallId: route.id });
        }
        state.entities.push(first, second); state.underpasses = [...(state.underpasses || []), route];
        const reached = reachableRoutes(state, state.player, canStep), holes = new Set([...first.cells, ...second.cells].map(cell => routeKey({ ...cell, routeId: '' })));
        if (!route.lowerCells.every(cell => reached.has(routeKey({ ...cell, routeId: route.id }))) ||
            [...baseline].some(cell => !holes.has(cell) && !reached.has(cell)) ||
            bonus && !reached.has(`|${target.x},${target.y}`)) { rollback(); continue; }
        state.generation.pitNetwork = { routeId: route.id, bonusRoomId: bonus ? target.id : null };
        break outer;
      }
    }
  }
  // Standalone room pits may be any room-fitting rectangle; hall pits stay 1x1.
  if (rng.nextFloat() < .25) {
    const room = rng.pick(plainRooms.filter(room => room.id !== state.generation.entranceRoomId));
    const pit = room && roomPit(state, room, rng, `pit-${state.seed}-standalone`);
    if (pit && !pit.cells.some(occupied)) state.entities.push(pit);
  }
  if (rng.nextFloat() < .08) {
    const tile = rng.pick(state.tiles.filter(tile => tile.type === 'floor' && tile.hallId && !tile.roomId && !occupied(tile) &&
      !Object.keys(tile.meta || {}).length && !state.entities.some(entity => entity.x === tile.x && entity.y === tile.y)));
    if (tile) state.entities.push({ id: `pit-${state.seed}-hall`, type: 'trap', name: 'Pit trap', targetType: 'tile',
      x: tile.x, y: tile.y, width: 1, height: 1, routeId: '', visible: false, revealed: false, effect: '3d6 falling damage', trigger: 'Step' });
  }
}
