import { routeOf, routeAt, routeStep, routeKey, sameRoute } from './underpasses.js';
const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function nextStep(state, character, target, canStep, allowed) {
  const start = { x: Number(character.x), y: Number(character.y), routeId: routeOf(state, character), first: null };
  const queue = [start], seen = new Set([routeKey(start)]);
  const scoreAt = point => distance(point, target) + (sameRoute(state, point, target) ? 0 : 24);
  let best = start, score = scoreAt(start);
  const reverse = [...character.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 2;
  const directions = reverse ? [...DIRECTIONS].reverse() : DIRECTIONS;
  for (let index = 0; index < queue.length && index < 625; index += 1) {
    const current = queue[index];
    if (scoreAt(current) < score) { best = current; score = scoreAt(current); }
    if (!score) break;
    for (const [dx, dy] of directions) {
      const x = current.x + dx, y = current.y + dy, next = routeStep(state, current, { x, y });
      if (!next) continue;
      const id = routeKey(next);
      if (seen.has(id) || distance(start, { x, y }) > 12 || !allowed(x, y, next) || !canStep(current.x, current.y, x, y, current)) continue;
      seen.add(id);
      queue.push({ ...next, first: current.first || [dx, dy] });
    }
  }
  return best.first;
}

export function planMarchingSteps(state, anchorId, config, { canStep }) {
  if (state.combat?.active) return [];
  const characters = new Map((state.characters || []).filter(character => !character.dead && !character.slain && Number(character.hp) > 0).map(character => [character.id, character]));
  const order = [...new Set(config.order || [])].filter(id => characters.has(id));
  const anchor = characters.get(anchorId), rank = order.indexOf(anchorId);
  if (!anchor || rank < 0) return [];
  const following = new Set(config.followingIds || []);
  const direction = config.direction || [0, 1];
  const tile = state.tiles[Number(anchor.y) * state.map.width + Number(anchor.x)];
  const spacing = tile?.roomId ? 2 : 1;
  const occupied = new Set([...characters.values()].map(character => routeKey({ ...character, routeId: routeOf(state, character) })));
  for (const entity of state.entities || []) if ((entity.type === 'monster' && !entity.defeated) ||
      (entity.type === 'trap' && entity.revealed && !entity.disarmed && !entity.triggered)) occupied.add(routeKey({ ...entity, routeId: routeOf(state, entity) }));
  const result = [];
  for (let index = 0; index < order.length; index += 1) {
    const character = characters.get(order[index]);
    if (character.id === anchorId || !following.has(character.id)) continue;
    if(Math.hypot(character.x-anchor.x,character.y-anchor.y)>=12)continue;
    const offset = (rank - index) * spacing;
    const behind = index > rank;
    const trailIndex = (index - rank) * spacing;
    const trailPoint = behind && config.trail?.length ? config.trail[trailIndex] || {
      x: config.trail.at(-1).x - direction[0] * (trailIndex - config.trail.length + 1),
      y: config.trail.at(-1).y - direction[1] * (trailIndex - config.trail.length + 1)
    } : null;
    const target = trailPoint || { x: Number(anchor.x) + direction[0] * offset, y: Number(anchor.y) + direction[1] * offset };
    target.routeId ??= routeAt(state, target.x, target.y, routeOf(state, anchor));
    if (distance(character, target) === 0 && sameRoute(state, character, target)) continue;
    const currentKey = routeKey({ ...character, routeId: routeOf(state, character) });
    occupied.delete(currentKey);
    const step = nextStep(state, character, target, canStep, (x, y, point) => x>=0&&y>=0&&x<state.map.width&&y<state.map.height&&
      Math.hypot(x-anchor.x,y-anchor.y)<12&&!occupied.has(routeKey(point)));
    occupied.add(currentKey);
    if (!step) continue;
    occupied.delete(currentKey);
    occupied.add(routeKey(routeStep(state, character, { x: Number(character.x) + step[0], y: Number(character.y) + step[1] })));
    result.push({ characterId: character.id, dx: step[0], dy: step[1] });
  }
  return result;
}
