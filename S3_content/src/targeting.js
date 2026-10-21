import { hasLineOfSightFrom, isTileVisible, isTilePerceived } from './visibility.js';
import { canMoveBetweenTiles } from './interactions.js';
import { characterOccupant } from './combat-rules.js';
import { movementStepCost } from './terrain-movement.js';
import { canDirectlyTarget } from './concealment.js';
import { isMonsterCurrentlyVisible } from './monster-perception.js';
import { sameRoute, routeOf, routeAt, routeStep, routeKey } from './underpasses.js';
import { getTile } from './state-schema.js';
import { isDarkvisionCharacter } from './darkvision.js';

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
    (!directAttack || canDirectlyTarget(target, range, character) && (target.type !== 'monster' || isMonsterCurrentlyVisible(state, target))) &&
    (!requireLight || isTilePerceived(state, Number(target.x), Number(target.y), target) ||
      target.type === 'monster' && isMonsterCurrentlyVisible(state, target)) &&
    hasLineOfSightFrom(state, Number(character.x), Number(character.y), Number(target.x), Number(target.y), { source: character, target }));
}

// Aiming at a location is not identifying its occupant: darkness and stealth do not reject the square.
export function canAimAtSquare(state, character, square, range) {
  if (!character || !square || ![character.x, character.y, square.x, square.y].every(Number.isInteger) ||
      !Number.isFinite(Number(range)) || Number(range) <= 0 || !getTile(state, character.x, character.y) || !getTile(state, square.x, square.y)) return false;
  const routeId = routeOf(state, character);
  if (square.routeId != null && square.routeId !== routeId) return false;
  const target = { x: square.x, y: square.y, routeId };
  return withinTargetRange(character, target, range) && sameRoute(state, character, target) &&
    hasLineOfSightFrom(state, character.x, character.y, target.x, target.y, { source: character, target });
}

export function hasReadyOffensiveSpell(character) {
  return (OFFENSIVE_SPELLS.has(character?.pendingSpell?.spell) || ['light','holy weapon','invisibility','charm person','hold portal','sleep','acid arrow','detect thoughts','hold person','alter self','levitate','misty step','fixed object','silence','web'].includes(character?.pendingSpell?.spell)) && ['targeting','placement'].includes(character.pendingSpell.phase);
}

export function pendingSpellAllowsCommand(character, type, spellName = '') {
  if (!character?.pendingSpell) return true;
  if (['resolve_spell', 'normalize', 'tick', 'fall_response', 'luck'].includes(type)) return true;
  return hasReadyOffensiveSpell(character) && (['move', 'move_batch', 'end_turn', 'ancestry_invisibility', 'drink_potion'].includes(type) ||
    (type === 'spell' && String(spellName).trim().toLowerCase() === character.pendingSpell.spell));
}

export function planClickMovement(state, character, x, y, maxSteps) {
  const goalRoute = routeAt(state, x, y, routeOf(state, character));
  const perceived = isDarkvisionCharacter(character) ? isTilePerceived : isTileVisible;
  if (![x, y].every(Number.isInteger) || maxSteps < 1 || characterOccupant(state, x, y, character.id, { routeId: goalRoute }) ||
      !perceived(state, x, y, { routeId: goalRoute })) return [];
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
    const cost = current.cost + movementStepCost(state, current.x, current.y, character);
    if (cost > maxSteps) continue;
    for (const [dx, dy] of directions) {
      const nx = current.x + dx, ny = current.y + dy, next = routeStep(state, current, { x: nx, y: ny });
      if (!next) continue;
      const key = routeKey(next);
      if ((cheapest.get(key) ?? Infinity) <= cost || monsters.has(key) || !perceived(state, nx, ny, next) ||
          !canMoveBetweenTiles(state, current.x, current.y, nx, ny, { routeId: current.routeId, creature: character }).ok) continue;
      cheapest.set(key, cost);
      queue.push({ ...next, cost, path: [...current.path, { dx, dy }] });
    }
  }
  return [];
}
