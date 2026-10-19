export const isIncorporeal = creature => creature?.conditions?.incorporeal === true;
export const canPhase = creature => /^(?:ghost|wraith|void spider)$/i.test(creature?.name || '') ||
  /^(?:ghost|wraith|void spider)$/i.test(creature?.companion?.source?.name || '');

export function isSleeping(creature, state = null) {
  if (creature?.conditions?.sleeping) return true;
  const rest = state?.rest;
  if (rest?.phase !== 'sleeping' || !rest.participantIds?.includes(creature?.id)) return false;
  if (rest.scene?.durationMs && Date.now() < rest.scene.startedAt + rest.scene.durationMs) return false;
  const index = (rest.watchOrderIds || rest.participantIds).indexOf(creature.id);
  const shift = Math.floor(Math.min(7, Math.max(0, Number(rest.hours) || 0)) / 2);
  return index < 0 || index % 4 !== shift;
}

export const isProne = (creature, state = null) => creature?.conditions?.prone === true || isSleeping(creature, state);

export function putToSleep(creature, casterId = null) {
  creature.conditions ||= {};
  creature.conditions.sleeping = { source: 'sleep', casterId };
  creature.conditions.prone = true;
  creature.focusSpell = null;
  creature.pendingSpell = null;
}

export function wakeCreature(creature, state = null) {
  if (!isSleeping(creature, state)) return false;
  creature.conditions ||= {};
  delete creature.conditions.sleeping;
  creature.conditions.prone = true;
  return true;
}

export function standCreature(creature, budget, remaining, state = null) {
  if (isSleeping(creature, state)) throw new Error('Sleeping creatures cannot stand.');
  if (!isProne(creature, state)) return remaining;
  const cost = Math.ceil(Math.max(0, Number(budget) || 0) / 2);
  if (remaining < cost) throw new Error(`Standing requires ${cost} movement.`);
  delete creature.conditions.prone;
  return remaining - cost;
}

export function conditionAttackMode(target, { melee = true, close = true, advantage = false, disadvantage = false, state = null } = {}) {
  advantage ||= isProne(target, state) && melee;
  disadvantage ||= isProne(target, state) && !melee && !close;
  return { doubleRoll: advantage && !disadvantage, disadvantage: disadvantage && !advantage };
}

export function phaseStepAllowed(state, x, y, nextX, nextY) {
  return Number.isInteger(nextX) && Number.isInteger(nextY) && nextX >= 0 && nextY >= 0 &&
    nextX < state.map.width && nextY < state.map.height &&
    Math.max(Math.abs(nextX - x), Math.abs(nextY - y)) === 1;
}

export const isLivingCreature = creature => creature?.summon?.kind !== 'floating-disc' && !/(?:^|\b)(?:undead|construct|golem)(?:\b|$)/i.test(
  [...(creature?.tags || []), ...(creature?.companion?.source?.tags || []), creature?.ancestry || '', creature?.name || ''].join(' '));
