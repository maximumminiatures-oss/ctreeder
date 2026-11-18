import { routeKey, routeOf, routeStep, sameRoute } from './underpasses.js';
import { withinTargetRange } from './targeting.js';

const directions = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];

export function commandMovementPath(state, creature, order, canStep) {
  const fleeing = order.orders.includes('flee');
  if (!fleeing && !order.orders.includes('approach')) return [];
  const origin = { x: creature.x, y: creature.y, routeId: routeOf(state, creature) };
  const start = order.start || origin;
  const vector = order.direction?.x || order.direction?.y ? order.direction : { x: 1, y: 0 };
  const queue = [origin], parents = new Map([[routeKey(origin), null]]);
  const distance = point => Math.hypot(point.x - order.caster.x, point.y - order.caster.y);
  const forward = point => (point.x - start.x) * vector.x + (point.y - start.y) * vector.y;
  let best = origin;
  for (let index = 0; index < queue.length && index < 8192; index++) {
    const point = queue[index];
    if (!fleeing && sameRoute(state, point, order.caster) && withinTargetRange(point, order.caster, 1)) {
      best = point; break;
    }
    if (fleeing && forward(point) >= 0 && distance(point) > distance(best)) best = point;
    for (const [dx, dy] of directions) {
      const next = routeStep(state, point, { x: point.x + dx, y: point.y + dy });
      if (!next || parents.has(routeKey(next)) || !canStep(point, next)) continue;
      parents.set(routeKey(next), point);
      queue.push(next);
    }
  }
  const path = [];
  for (let point = best; parents.get(routeKey(point)); point = parents.get(routeKey(point))) path.push(point);
  return path.reverse();
}

export function resistsHarmfulCommand(order, target, check) {
  if (check.total < order.focus.castingTotal) return false;
  delete order.focus.ordersByTarget[target.id];
  if (!Object.keys(order.focus.ordersByTarget).length) order.caster.focusSpell = null;
  return true;
}
