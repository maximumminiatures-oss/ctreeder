const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const key = (x, y) => `${x},${y}`;
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function nextStep(character, target, canStep, allowed) {
  const start = { x: Number(character.x), y: Number(character.y), first: null };
  const queue = [start], seen = new Set([key(start.x, start.y)]);
  let best = start, score = distance(start, target);
  const reverse = [...character.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 2;
  const directions = reverse ? [...DIRECTIONS].reverse() : DIRECTIONS;
  const direct = directions.map(([dx, dy]) => ({ dx, dy, x: start.x + dx, y: start.y + dy }))
    .filter(point => distance(point, target) < score && allowed(point.x, point.y) && canStep(start.x, start.y, point.x, point.y))
    .sort((a, b) => distance(a, target) - distance(b, target));
  if (direct.length) return [direct[0].dx, direct[0].dy];
  for (let index = 0; index < queue.length && index < 320; index += 1) {
    const current = queue[index];
    if (distance(current, target) < score) { best = current; score = distance(current, target); }
    if (!score) break;
    for (const [dx, dy] of directions) {
      const x = current.x + dx, y = current.y + dy, id = key(x, y);
      if (seen.has(id) || distance(start, { x, y }) > 12 || !allowed(x, y) || !canStep(current.x, current.y, x, y)) continue;
      seen.add(id);
      queue.push({ x, y, first: current.first || [dx, dy] });
    }
  }
  return best.first;
}

export function planMarchingSteps(state, anchorId, config, { canStep, isLit }) {
  if (state.combat?.active) return [];
  const characters = new Map((state.characters || []).filter(character => !character.dead && !character.slain && Number(character.hp) > 0).map(character => [character.id, character]));
  const order = [...new Set(config.order || [])].filter(id => characters.has(id));
  const anchor = characters.get(anchorId), rank = order.indexOf(anchorId);
  if (!anchor || rank < 0) return [];
  const following = new Set(config.followingIds || []);
  const direction = config.direction || [0, 1];
  const tile = state.tiles[Number(anchor.y) * state.map.width + Number(anchor.x)];
  const spacing = tile?.roomId ? 2 : 1;
  const occupied = new Set([...characters.values()].map(character => key(character.x, character.y)));
  for (const entity of state.entities || []) if ((entity.type === 'monster' && !entity.defeated) ||
      (entity.type === 'trap' && entity.revealed && !entity.disarmed && !entity.triggered)) occupied.add(key(entity.x, entity.y));
  const result = [];
  for (let index = 0; index < order.length; index += 1) {
    const character = characters.get(order[index]);
    if (character.id === anchorId || !following.has(character.id)) continue;
    const offset = (rank - index) * spacing;
    const behind = index > rank;
    const trailIndex = (index - rank) * spacing;
    const trailPoint = behind && config.trail?.length ? config.trail[trailIndex] || {
      x: config.trail.at(-1).x - direction[0] * (trailIndex - config.trail.length + 1),
      y: config.trail.at(-1).y - direction[1] * (trailIndex - config.trail.length + 1)
    } : null;
    const target = trailPoint || { x: Number(anchor.x) + direction[0] * offset, y: Number(anchor.y) + direction[1] * offset };
    if (distance(character, target) === 0) continue;
    occupied.delete(key(character.x, character.y));
    const step = nextStep(character, target, canStep, (x, y) => !occupied.has(key(x, y)) && isLit(x, y));
    occupied.add(key(character.x, character.y));
    if (!step) continue;
    occupied.delete(key(character.x, character.y));
    occupied.add(key(Number(character.x) + step[0], Number(character.y) + step[1]));
    result.push({ characterId: character.id, dx: step[0], dy: step[1] });
  }
  return result;
}
