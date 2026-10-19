import { isInvisible, isStealthed } from './concealment.js';
import { isSleeping } from './conditions.js';

export function unawareReason(attacker, target, state) {
  if (isSleeping(target, state)) return 'sleep';
  if (target?.conditions?.blind || target?.conditions?.blinded || target?.blind || target?.blinded) return 'blindness';
  if (target?.conditions?.paralyzed || target?.conditions?.paralysed || target?.paralyzed || target?.paralysed) return 'paralysis';
  if (target?.conditions?.surprised || target?.surprised || state?.combat?.surpriseRound &&
    !state.combat.surpriseParticipantIds?.includes(target?.id)) return 'surprise';
  if (isInvisible(attacker)) return 'invisibility';
  if (isStealthed(attacker)) return 'stealth';
  return '';
}

export function backstabMultiplier(character) {
  if (!/\bthief\b/i.test(character?.className || '') || character.companion?.kind === 'doppelganger') return 0;
  const explicit = (character.bonuses || []).filter(bonus => /BackstabIncrease/i.test(`${bonus.name || ''} ${bonus.bonusName || ''}`));
  const extra = explicit.length ? explicit.reduce((sum, bonus) => sum + (Number(bonus.bonusAmount) || 1), 0) :
    (character.levels || []).filter(level => /backstab.*(?:increase|\+1)/i.test(`${level.talentRolledName} ${level.talentRolledDesc}`)).length;
  return 2 + extra;
}
