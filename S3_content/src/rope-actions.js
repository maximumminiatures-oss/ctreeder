import { abilityScoreModifier } from './characters.js';
import { isRaving } from './arcane-effects.js';
import { hasGrit } from './class-progression.js';
import { isIncorporeal, isSleeping } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { escapePit, pitAtBottom, pitCells, pitContains, pitIsOpen, safePitRim } from './pits.js';
import { getTile } from './state-schema.js';
import { routeExistsAt, routeOf, sameRoute } from './underpasses.js';

export const DEFAULT_ROPE_FEET = 60;
export const GRAPPLING_ESCAPE_MOVEMENT = 3;
export const ROPE_BRIDGE_ASSET = 'rope-horizontal';
const adjacent = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
const creatures = state => [...(state.characters || []), ...(state.entities || []).filter(item => item.type === 'monster')];
const living = actor => actor && Number(actor.hp) > 0 && !actor.dead && !actor.slain && !actor.defeated && !actor.leftPeacefully;
const units = item => {
  const count = Number(item?.totalUnits ?? item?.quantity ?? 1);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
};
const thief = actor => /\bthief\b/i.test(actor?.className || actor?.class || '');
const modifier = (actor, stat) => actor.stats?.[stat] != null ? abilityScoreModifier(actor.stats[stat]) : Number(actor[stat === 'STR' ? 'S' : 'D']) || 0;
export const isTied = actor => Boolean(actor?.conditions?.tied);

// Length is per coil; imported plain "Rope" is a fresh 60-foot coil, not zero feet.
export function ropeFeet(item) {
  if (!item || !/\brope\b/i.test(item.name || '') || !units(item)) return 0;
  const match = /\b(\d+(?:\.\d+)?)\s*(?:['\u2032]|feet\b|foot\b|ft\b)/i.exec(item.name || '');
  const feet = Number(item.ropeFeet ?? (match ? match[1] : DEFAULT_ROPE_FEET));
  return Number.isSafeInteger(feet) && feet >= 0 ? feet : 0;
}

export const availableRopeFeet = actor => (actor?.gear || []).reduce((sum, item) => sum + ropeFeet(item) * units(item), 0);

export function planRopeUse(actor, feet, { gearIndex } = {}) {
  if (!Number.isSafeInteger(feet) || feet <= 0) throw new Error('Rope use must be a positive whole number of feet.');
  // A bridge or binding needs a continuous length: do not silently join short scraps.
  const index = gearIndex == null ? (actor?.gear || []).findIndex(item => ropeFeet(item) >= feet) : gearIndex;
  if (!Number.isSafeInteger(index) || index < 0 || ropeFeet(actor?.gear?.[index]) < feet)
    throw new Error(`A continuous ${feet}-foot length of rope is required.`);
  return { gearIndex: index, feet, remainingFeet: ropeFeet(actor.gear[index]) - feet };
}

export function consumeRope(actor, feet, options = {}) {
  const plan = planRopeUse(actor, feet, options), item = actor.gear[plan.gearIndex], count = units(item);
  const partial = { ...item, name: `${plan.remainingFeet}' rope`, ropeFeet: plan.remainingFeet, quantity: 1, totalUnits: 1 };
  if (Number.isFinite(Number(item.slots))) partial.slots = Number(item.slots) / count;
  if (count > 1) {
    item.quantity = item.totalUnits = count - 1;
    if (Number.isFinite(Number(item.slots))) item.slots = Number(item.slots) * (count - 1) / count;
    if (plan.remainingFeet) {
      // Split off the shortened coil without duplicating an inventory instance ID.
      delete partial.instanceId; delete partial.id;
      actor.gear.splice(plan.gearIndex + 1, 0, partial);
    }
  } else if (plan.remainingFeet) Object.assign(item, partial);
  else actor.gear.splice(plan.gearIndex, 1);
  return plan;
}

// Deliberately ownership-neutral. The command/UI boundary must authorize the actor.
export function ropeActionBlock(state, actor, { allowTied = false, action = false, movement = 0 } = {}) {
  if (!creatures(state).includes(actor) || !living(actor) || actor.dyingRounds > 0 || isFloatingDisc(actor) ||
      isSleeping(actor, state) || actor.conditions?.paralyzed || actor.conditions?.stunned || isRaving(actor) || isIncorporeal(actor))
    return 'This creature cannot use rope now.';
  if (isTied(actor) && !allowTied) return 'Tied creatures can only escape or break their rope.';
  if (state.combat?.active) {
    const entry = state.combat.turnOrder?.[state.combat.turnIndex];
    if (entry?.id !== actor.id) return 'It is not this creature\'s turn.';
    if (action && state.combat.actionUsed) return 'This creature has already used its action.';
    if (movement && !(Number(state.combat.movementRemaining) >= movement)) return `This requires ${movement} movement.`;
  }
  return '';
}

const requireEligible = (state, actor, options) => {
  const reason = ropeActionBlock(state, actor, options);
  if (reason) throw new Error(reason);
};
const hasHook = actor => (actor.gear || []).some(item => /\bgrappling[ -]hook\b/i.test(item.name || '') && units(item));

export function grapplingEscapeOption(state, actor, { canStep, toward } = {}) {
  if (ropeActionBlock(state, actor, { movement: GRAPPLING_ESCAPE_MOVEMENT }) || !hasHook(actor) || !availableRopeFeet(actor)) return null;
  const pit = pitAtBottom(state, actor);
  if (!pit || !pitContains(pit, actor.x, actor.y) ||
      (pit.lowerRouteId ? routeOf(state, actor) !== pit.lowerRouteId : !sameRoute(state, actor, pit))) return null;
  const destination = safePitRim(state, pit, actor, { canStep, prefer: toward || actor });
  return destination ? { pitId: pit.id, destination: { x: destination.x, y: destination.y, routeId: routeOf(state, pit) },
    movementCost: GRAPPLING_ESCAPE_MOVEMENT, prompt: 'Escape pit with grappling hook?' } : null;
}

export function escapePitWithGrapplingHook(state, actor, options = {}) {
  const option = grapplingEscapeOption(state, actor, options);
  if (!option) throw new Error('Escaping requires rope, a grappling hook, three movement, and a free safe pit rim.');
  const pit = (state.entities || []).find(item => item.id === option.pitId);
  const destination = escapePit(state, actor, pit, { canStep: options.canStep, prefer: option.destination });
  if (state.combat?.active) state.combat.movementRemaining -= option.movementCost;
  return { ...option, destination, escaped: true, ropeConsumedFeet: 0, actionCost: 0 };
}

function clearRim(state, point, actor, canStep) {
  return getTile(state, point.x, point.y)?.type === 'floor' && routeExistsAt(state, point.x, point.y, '') &&
    !(state.entities || []).some(pit => pitIsOpen(pit) && routeOf(state, pit) === '' && pitContains(pit, point.x, point.y)) &&
    !creatures(state).some(other => other !== actor && living(other) && !isFloatingDisc(other) && !isIncorporeal(other) &&
      !other.conditions?.sinkhole && routeOf(state, other) === '' && other.x === point.x && other.y === point.y) &&
    (!canStep || canStep(point.x, point.y, point.x, point.y, { ...actor, routeId: '' }));
}

export function ropeBridgeOptions(state, actor, { canStep, gearIndex } = {}) {
  if (ropeActionBlock(state, actor) || routeOf(state, actor) !== '' || actor.conditions?.sinkhole) return [];
  const options = [];
  for (const pit of state.entities || []) {
    if (!pitIsOpen(pit) || routeOf(state, pit) !== '' || pitContains(pit, actor.x, actor.y)) continue;
    const count = pitCells(state, pit).length;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cells = []; let x = actor.x + dx, y = actor.y + dy;
      while (cells.length <= count && pitContains(pit, x, y)) { cells.push({ x, y }); x += dx; y += dy; }
      if (!cells.length || cells.length > count) continue;
      const destination = { x, y, routeId: '' }, start = { x: actor.x, y: actor.y, routeId: '' };
      const feet = 15 + (cells.length - 1) * 5;
      if (!clearRim(state, start, actor, canStep) || !clearRim(state, destination, actor, canStep) ||
          cells.some(cell => !routeExistsAt(state, cell.x, cell.y, '')) ||
          canStep && [...cells, destination].some((cell, i) => {
            const from = i ? cells[i - 1] : start;
            return !canStep(from.x, from.y, cell.x, cell.y, { ...actor, routeId: '' });
          }) || (pit.ropeBridges || []).some(bridge => bridge.cells?.length === cells.length &&
            cells.every(cell => bridge.cells.some(other => other.x === cell.x && other.y === cell.y)))) continue;
      try { planRopeUse(actor, feet, { gearIndex }); } catch { continue; }
      options.push({ pitId: pit.id, start, destination, cells, axis: dx ? 'horizontal' : 'vertical', ropeFeet: feet });
    }
  }
  return options;
}

export function buildRopeBridge(state, actor, pitId, { direction, ...options } = {}) {
  const candidates = ropeBridgeOptions(state, actor, options).filter(option => option.pitId === pitId &&
    (!direction || Math.sign(option.destination.x - actor.x) === direction.dx && Math.sign(option.destination.y - actor.y) === direction.dy));
  if (candidates.length !== 1) throw new Error('Choose a reachable pit edge with enough rope and a free opposite rim.');
  const option = candidates[0], pit = state.entities.find(item => item.id === pitId);
  const supply = consumeRope(actor, option.ropeFeet, options);
  const bridge = { ...option, id: `${pit.id}-rope-${(pit.ropeBridges || []).length + 1}`, routeId: '', builtBy: actor.id };
  pit.ropeBridges = [...(pit.ropeBridges || []), bridge];
  return { bridge, supply, actionCost: 0 };
}

export function ropeBridgeArt(state) {
  return (state.entities || []).filter(pit => pitIsOpen(pit) && routeOf(state, pit) === '').flatMap(pit => (pit.ropeBridges || []).filter(bridge => bridge.routeId === '')
    .flatMap(bridge => (bridge.cells || []).filter(cell => pitContains(pit, cell.x, cell.y)).map(cell => ({
      ...cell, asset: ROPE_BRIDGE_ASSET, turn: bridge.axis === 'vertical' ? 1 : 0, routeId: ''
    }))));
}

export function tieTargets(state, actor, { canStep = () => true } = {}) {
  if (!state.combat?.active || ropeActionBlock(state, actor, { action: true })) return [];
  try { planRopeUse(actor, 15); } catch { return []; }
  return creatures(state).filter(target => target !== actor && living(target) && !target.dyingRounds && !isTied(target) &&
    !isIncorporeal(target) && !isFloatingDisc(target) && sameRoute(state, actor, target) &&
    Boolean(actor.conditions?.sinkhole) === Boolean(target.conditions?.sinkhole) &&
    (!actor.conditions?.sinkhole || actor.conditions.sinkhole === target.conditions.sinkhole) && adjacent(actor, target) &&
    (isSleeping(target, state) || target.conditions?.paralyzed) && canStep(actor.x, actor.y, target.x, target.y, actor));
}

function rollAbility(actor, stat, bonus, { check, random = Math.random } = {}) {
  const value = modifier(actor, stat) + bonus, doubleRoll = stat === 'DEX' && thief(actor) || hasGrit(actor, stat);
  if (check) return check(value, { doubleRoll });
  const die = () => {
    const n = random();
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error('Invalid random roll.');
    return 1 + Math.floor(n * 20);
  };
  const firstRoll = die(), secondaryRoll = doubleRoll ? die() : null, roll = doubleRoll ? Math.max(firstRoll, secondaryRoll) : firstRoll;
  return { roll, firstRoll, secondaryRoll, modifier: value, total: roll + value, checkMode: doubleRoll ? 'advantage' : 'normal' };
}

export function tieWithRope(state, actor, targetId, options = {}) {
  const target = tieTargets(state, actor, options).find(item => item.id === targetId);
  if (!target) throw new Error('Tie requires an adjacent sleeping or paralyzed creature on the same floor, rope, and an unused action.');
  planRopeUse(actor, 15, options);
  const roll = rollAbility(actor, 'DEX', 5, options);
  if (!Number.isFinite(roll.total)) throw new Error('Invalid tying check.');
  const supply = consumeRope(actor, 15, options);
  target.conditions ||= {};
  target.conditions.tied = { dc: roll.total, tiedBy: actor.id, ropeFeet: 15 };
  state.combat.actionUsed = true;
  return { targetId, dc: roll.total, check: roll, supply, actionCost: 1 };
}

export function escapeRope(state, actor, method = 'escape', options = {}) {
  if (!['escape', 'break'].includes(method)) throw new Error('Choose Escape (DEX) or Break Rope (STR).');
  requireEligible(state, actor, { action: true, allowTied: true });
  const dc = actor.conditions?.tied?.dc;
  if (!Number.isFinite(dc)) throw new Error('This creature is not tied with a valid rope DC.');
  const stat = method === 'escape' ? 'DEX' : 'STR', roll = rollAbility(actor, stat, 0, options);
  if (!Number.isFinite(roll.total)) throw new Error('Invalid escape check.');
  const escaped = roll.total >= dc;
  if (escaped) delete actor.conditions.tied;
  if (state.combat?.active) state.combat.actionUsed = true;
  return { escaped, check: roll, dc, stat, actionCost: state.combat?.active ? 1 : 0 };
}
