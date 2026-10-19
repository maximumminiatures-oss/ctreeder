import { canMoveBetweenTiles, getDoorBetween } from './interactions.js';
import { doorApproachTiles } from './door-geometry.js';
import { isFloatingDisc } from './floating-disc.js';

const key = point => `${point.x},${point.y}`;
const directions = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];

function pathBetween(state, start, end, cells) {
  const queue = [{ ...start, path: [] }], seen = new Set([key(start)]);
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (point.x === end.x && point.y === end.y) return point.path;
    for (const [dx,dy] of directions) {
      const next = { x: point.x + dx, y: point.y + dy };
      if (seen.has(key(next)) || !cells.has(key(next)) || !canMoveBetweenTiles(state, point.x, point.y, next.x, next.y).ok) continue;
      seen.add(key(next)); queue.push({ ...next, path: [...point.path, next] });
    }
  }
  return null;
}

export function planRestScene(state, rest, now = Date.now()) {
  if (!state.tiles?.length) return null;
  const explored = new Set([...(state.visibility?.exploredEver || []), ...(state.visibility?.visibleNow || [])]);
  const traps = new Set((state.entities || []).filter(entity => entity.type === 'trap').map(key));
  const monsters = new Set((state.entities || []).filter(entity => entity.type === 'monster' && !entity.defeated && !entity.leftPeacefully).map(key));
  const cells = state.tiles.filter(tile => tile.roomId === rest.roomId && tile.type === 'floor' && explored.has(key(tile)) &&
    !traps.has(key(tile)) && !monsters.has(key(tile)) && canMoveBetweenTiles(state, tile.x, tile.y, tile.x, tile.y).ok);
  if (!cells.length) throw new Error('Explore a safe part of the room before setting up camp.');
  const safe = new Set(cells.map(key));
  const byKey = new Map(cells.map(tile => [key(tile), tile]));
  const components = new Map(), unseen = new Set(safe);
  while (unseen.size) {
    const points = [byKey.get(unseen.values().next().value)]; unseen.delete(key(points[0]));
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      for (const [dx,dy] of directions) {
        const next = byKey.get(`${point.x+dx},${point.y+dy}`);
        if (!next || !unseen.has(key(next)) || !canMoveBetweenTiles(state,point.x,point.y,next.x,next.y).ok) continue;
        unseen.delete(key(next)); points.push(next);
      }
    }
    for (const point of points) components.set(key(point), points);
  }
  const center = { x: cells.reduce((sum, tile) => sum + tile.x, 0) / cells.length, y: cells.reduce((sum, tile) => sum + tile.y, 0) / cells.length };
  const party = state.characters.filter(character => rest.participantIds.includes(character.id));
  const discs = state.characters.filter(character => isFloatingDisc(character) && character.roomId === rest.roomId);
  let best = null;
  for (const fire of cells) {
    const connected = components.get(key(fire)).filter(tile => key(tile) !== key(fire));
    if (connected.length < party.length + discs.length) continue;
    const adjacent = connected.filter(tile => Math.max(Math.abs(tile.x - fire.x), Math.abs(tile.y - fire.y)) === 1).length;
    const score = Math.hypot(fire.x - center.x, fire.y - center.y) + Math.max(0, Math.min(8, party.length) - adjacent) * 2;
    if (!best || score < best.score) best = { fire, connected, score };
  }
  if (!best) throw new Error('The explored room has no safe space for a campfire and the whole party.');
  const spaces = best.connected.sort((a,b) => Math.max(Math.abs(a.x-best.fire.x),Math.abs(a.y-best.fire.y)) -
    Math.max(Math.abs(b.x-best.fire.x),Math.abs(b.y-best.fire.y)) || Math.hypot(a.x-best.fire.x,a.y-best.fire.y)-Math.hypot(b.x-best.fire.x,b.y-best.fire.y) || a.y-b.y || a.x-b.x);
  const placements = [...party, ...discs].map((character, index) => ({ characterId: character.id, x: spaces[index].x, y: spaces[index].y }));
  const scene = { x: best.fire.x, y: best.fire.y, placements, startedAt: now, route: [], markers: [] };
  const caster = placements.find(place => place.characterId === rest.alarm?.casterId);
  if (!caster) return scene;
  const exits = [];
  for (const door of state.entities.filter(entity => entity.subtype === 'door')) {
    if ((door.secret || door.isSecret) && !door.secretFound) continue;
    const sides = doorApproachTiles(door);
    if (!sides || !explored.has(key(sides.hall)) && !door.everOpened && !door.secretFound) continue;
    const entry = cells.find(tile => tile.x === sides.room.x && tile.y === sides.room.y);
    if (!entry) continue;
    if (!exits.some(exit => exit.x === entry.x && exit.y === entry.y))
      exits.push({ x: entry.x, y: entry.y, rotation: { north: 0, east: 1, south: 2, west: 3 }[door.wallSide || door.hallDirection] || 0 });
  }
  for (const entry of cells) for (const [rotation, [dx,dy]] of directions.slice(0,4).entries()) {
    const x = entry.x + dx, y = entry.y + dy, next = state.tiles[y * state.map.width + x];
    if (!next || next.type !== 'floor' || next.roomId === rest.roomId || !next.hallId || !explored.has(`${x},${y}`)) continue;
    const door = getDoorBetween(state, entry.x, entry.y, x, y);
    if ((door?.secret || door?.isSecret) && !door.secretFound) continue;
    if (!canMoveBetweenTiles(state, entry.x, entry.y, x, y, { ignoreClosedDoors: true }).ok) continue;
    if (!exits.some(exit => exit.x === entry.x && exit.y === entry.y)) exits.push({ x: entry.x, y: entry.y, rotation });
  }
  let current = { x: caster.x, y: caster.y };
  scene.route.push(current);
  while (exits.length) {
    const routes = exits.map(exit => ({ exit, path: pathBetween(state, current, exit, safe) })).filter(option => option.path !== null)
      .sort((a,b) => a.path.length - b.path.length);
    if (!routes.length) break;
    const next = routes[0]; exits.splice(exits.indexOf(next.exit), 1);
    scene.route.push(...next.path); current = next.exit;
    scene.markers.push({ ...next.exit, step: scene.route.length - 1 });
  }
  const home = pathBetween(state, current, caster, safe);
  if (home) scene.route.push(...home);
  scene.casterId = rest.alarm.casterId;
  scene.durationMs = scene.markers.length ? Math.min(9000, Math.max(2500, (scene.route.length - 1) * 180)) : 0;
  return scene;
}

export function restTourFrame(scene, now = Date.now()) {
  if (!scene?.durationMs || !scene.route?.length) return { position: null, markers: scene?.markers || [], active: false };
  const progress = Math.max(0, Math.min(1, (now - scene.startedAt) / scene.durationMs));
  const step = progress * (scene.route.length - 1), index = Math.floor(step), fraction = step - index;
  const from = scene.route[index], to = scene.route[Math.min(index + 1, scene.route.length - 1)];
  return { active: progress < 1, position: { x: from.x + (to.x-from.x)*fraction, y: from.y + (to.y-from.y)*fraction },
    markers: scene.markers.filter(marker => marker.step <= step) };
}
