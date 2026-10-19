import { routeOf, routeStep, routeKey, sameRoute } from './underpasses.js';
import { isIncorporeal } from './conditions.js';
const directions = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];

export function planFiringPosition(state, creature, target, { movement, canStep, canAttackFrom, stepCost = () => 1,
  preferRange = false, isHidden = () => false, maxNodes = 2048 } = {}) {
  const start = { x: Number(creature.x), y: Number(creature.y), routeId: routeOf(state, creature), cost: 0, steps: [] };
  const queue = [start], cheapest = new Map([[routeKey(start), 0]]);
  let best = null;
  for (let visited = 0; queue.length && visited < maxNodes; visited++) {
    queue.sort((a, b) => a.cost - b.cost);
    const point = queue.shift();
    if (point.cost !== cheapest.get(routeKey(point))) continue;
    if (sameRoute(state, point, target) && canAttackFrom(point.x, point.y, point)) {
      if (!preferRange) return point;
      const distance = Math.hypot(point.x - target.x, point.y - target.y);
      const hidden = isHidden(point.x, point.y, point);
      if (!best || distance > best.distance + 1e-6 || Math.abs(distance - best.distance) < 1e-6 &&
          (hidden && !best.hidden || hidden === best.hidden && point.cost < best.cost)) best = { ...point, distance, hidden };
    }
    const cost = point.cost + stepCost(point.x, point.y);
    if (cost > movement) continue;
    for (const [dx, dy] of directions) {
      const x = point.x + dx, y = point.y + dy, next = routeStep(state, point, { x, y }, { phase: isIncorporeal(creature) });
      if (!next) continue;
      const key = routeKey(next);
      if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height ||
          (cheapest.get(key) ?? Infinity) <= cost || !canStep(point.x, point.y, x, y, point)) continue;
      cheapest.set(key, cost);
      queue.push({ ...next, cost, steps: [...point.steps, next] });
    }
  }
  return best;
}

export function findPursuitStep(state, creature, target, { canStep, canAttackFrom, maxNodes = 8192 } = {}) {
  const start = { x: Number(creature.x), y: Number(creature.y), routeId: routeOf(state, creature), first: null };
  const queue = [start], seen = new Set([routeKey(start)]);
  for (let index = 0; index < queue.length && index < maxNodes; index++) {
    const point = queue[index];
    if (point.first && sameRoute(state, point, target) && canAttackFrom(point.x, point.y, target, point)) return point.first;
    const ordered = directions.slice().sort(([ax,ay],[bx,by]) =>
      Math.hypot(point.x+ax-target.x,point.y+ay-target.y)-Math.hypot(point.x+bx-target.x,point.y+by-target.y));
    for (const [dx,dy] of ordered) {
      const x=point.x+dx,y=point.y+dy,next=routeStep(state,point,{x,y},{phase:isIncorporeal(creature)});
      if(!next)continue;
      const key=routeKey(next);
      if(seen.has(key)||x<0||y<0||x>=state.map.width||y>=state.map.height||!canStep(point.x,point.y,x,y,point))continue;
      seen.add(key);queue.push({...next,first:point.first||next});
    }
  }
  return null;
}
