import { hasLineOfSightFrom, isTileVisible } from './visibility.js';
import { canMoveBetweenTiles } from './interactions.js';
import { characterOccupant } from './combat-rules.js';
import { movementStepCost } from './terrain-movement.js';
import { canDirectlyTarget } from './concealment.js';
import { isMonsterCurrentlyVisible } from './monster-perception.js';
import { sameRoute, routeOf, routeAt, routeStep, routeKey } from './underpasses.js';

export const ATTACK_RANGES = Object.freeze({ close: 1, near: 6, far: 12 });
export const OFFENSIVE_SPELLS = new Set(['magic missile', 'burning hands']);
export const rangeRadius = range => Number(range) === 1 ? Math.SQRT2 : Number(range);

export function withinTargetRange(origin, target, range) {
  return Math.hypot(Number(target.x) - Number(origin.x), Number(target.y) - Number(origin.y)) <= rangeRadius(range) + 0.000001;
}

export function canTargetAtRange(state, character, target, range, { requireLight = true, directAttack = false } = {}) {
  return Boolean(target && Number.isFinite(Number(target.x)) && Number.isFinite(Number(target.y)) &&
    sameRoute(state, character, target) &&
    withinTargetRange(character, target, range) &&
    (!directAttack || canDirectlyTarget(target, range, character) && (target.type !== 'monster' || isMonsterCurrentlyVisible(state, target, { viewer: character }))) &&
    (!requireLight || isTileVisible(state, Number(target.x), Number(target.y), target)) &&
    hasLineOfSightFrom(state, Number(character.x), Number(character.y), Number(target.x), Number(target.y), { source: character, target }));
}

export function hasReadyOffensiveSpell(character) {
  return (OFFENSIVE_SPELLS.has(character?.pendingSpell?.spell) || ['holy weapon','invisibility','charm person','hold portal','sleep'].includes(character?.pendingSpell?.spell)) && character.pendingSpell.phase === 'targeting';
}

export function pendingSpellAllowsCommand(character, type, spellName = '') {
  if (!character?.pendingSpell) return true;
  if (['resolve_spell', 'normalize', 'tick', 'fall_response'].includes(type)) return true;
  return hasReadyOffensiveSpell(character) && (['move', 'move_batch', 'end_turn', 'ancestry_invisibility', 'drink_potion'].includes(type) ||
    (type === 'spell' && String(spellName).trim().toLowerCase() === character.pendingSpell.spell));
}

export function planClickMovement(state, character, x, y, maxSteps) {
  const goalRoute = routeAt(state, x, y, routeOf(state, character));
  if (![x, y].every(Number.isInteger) || maxSteps < 1 || characterOccupant(state, x, y, character.id, { routeId: goalRoute }) ||
      !isTileVisible(state, x, y, { routeId: goalRoute })) return [];
  const monsters = new Set((state.entities || []).filter(entity => (entity.type === 'monster' && !entity.defeated && !entity.leftPeacefully) ||
      (entity.type === 'trap' && entity.revealed && !entity.disarmed && !entity.triggered))
    .map(entity => routeKey({ ...entity, routeId: routeOf(state, entity) })));
  if (monsters.has(routeKey({ x, y, routeId: goalRoute }))) return [];
  const start = { x: Number(character.x), y: Number(character.y), routeId: routeOf(state, character), path: [], cost: 0 };
  const queue = [start], cheapest = new Map([[routeKey(start), 0]]);
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  // Weighted search charges terrain on departure, not entry.
  while (queue.length) {
    queue.sort((a,b) => a.cost-b.cost);
    const current = queue.shift();
    if (current.cost > cheapest.get(routeKey(current))) continue;
    if (current.x === x && current.y === y && current.routeId === goalRoute) return current.path;
    const cost = current.cost + movementStepCost(state, current.x, current.y);
    if (cost > maxSteps) continue;
    for (const [dx, dy] of directions) {
      const nx = current.x + dx, ny = current.y + dy, next = routeStep(state, current, { x: nx, y: ny });
      if (!next) continue;
      const key = routeKey(next);
      if ((cheapest.get(key) ?? Infinity) <= cost || monsters.has(key) || !isTileVisible(state, nx, ny, next) ||
          !canMoveBetweenTiles(state, current.x, current.y, nx, ny, { routeId: current.routeId }).ok) continue;
      cheapest.set(key, cost);
      queue.push({ ...next, cost, path: [...current.path, { dx, dy }] });
    }
  }
  return [];
}
