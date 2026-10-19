import { abilityScoreModifier } from './characters.js';
import { canTargetAtRange } from './targeting.js';
import { isLivingCreature, putToSleep } from './conditions.js';

export const portalHeld = door => Number(door?.holdPortal?.rounds) > 0;

export function holdDoor(state, caster, door, pending) {
  if (!door || door.subtype !== 'door' || door.destroyed || door.gone || door.doorState === 'gone') throw new Error('Choose an intact door.');
  if (door.secret && !door.secretFound && !door.revealed) throw new Error('Discover that secret door before targeting it.');
  if (!canTargetAtRange(state, caster, door, pending.radius, { requireLight: false })) throw new Error('That door is outside range or line of sight.');
  if (pending.usedTargetIds.includes(door.id)) throw new Error('Choose a different door.');
  door.doorState = 'closed';
  delete door.transition;
  door.holdPortal = { casterId: caster.id, dc: pending.castingTotal, rounds: pending.rounds };
  pending.usedTargetIds.push(door.id);
  if (--pending.remaining <= 0) caster.pendingSpell = null;
  return { message: `${caster.name} holds the door closed for ${pending.rounds} rounds (STR DC ${pending.castingTotal}).` };
}

export function forceHeldDoor(door, creature, checkRoll) {
  if (!portalHeld(door)) return { held: false, opened: false };
  const result = checkRoll(abilityScoreModifier(creature?.stats?.STR ?? creature?.str ?? creature?.S ?? 10));
  const dc = door.holdPortal.dc;
  const opened = result.total >= dc;
  if (opened) { delete door.holdPortal; door.doorState = 'open'; door.everOpened = true; delete door.transition; }
  return { held: true, opened, result, message: `${creature?.name || 'Creature'} ${opened ? 'forces the held door open' : 'cannot force the held door'}: ${result.total} vs STR DC ${dc}.` };
}

export function advancePortalRounds(state, rounds) {
  let changed = false;
  for (const door of state.entities || []) if (portalHeld(door)) {
    door.holdPortal.rounds -= rounds;
    if (door.holdPortal.rounds <= 0) { delete door.holdPortal; changed = true; }
  }
  return changed;
}

export function sleepSquare(caster, point = null, size = 7) {
  return { x: caster.x - Math.floor(size / 2), y: caster.y - Math.floor(size / 2), size };
}

export function releaseSleep(state, caster, point = null) {
  const pending = caster.pendingSpell;
  const area = sleepSquare(caster, point, pending.size);
  const targets = [...state.characters, ...state.entities.filter(entity => entity.type === 'monster')].filter(creature =>
    creature.id !== caster.id && !creature.dead && !creature.slain && !creature.defeated && Number(creature.hp) > 0 &&
    Number(creature.level ?? creature['**LV**'] ?? 1) <= pending.maxLevel && isLivingCreature(creature) &&
    creature.x >= area.x && creature.x < area.x + area.size && creature.y >= area.y && creature.y < area.y + area.size &&
    canTargetAtRange(state, caster, creature, Infinity, { requireLight: false }));
  for (const target of targets) putToSleep(target, caster.id);
  caster.pendingSpell = null;
  return { targets, area, message: targets.length ? `${targets.map(target => target.name).join(', ')} fall asleep.` : 'Sleep finds no eligible living creatures.' };
}
