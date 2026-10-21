import { abilityScoreModifier } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { rollWizardMishaps, wizardCastingMode } from './wizard-mishaps.js';
import { ATTACK_RANGES, canAimAtSquare } from './targeting.js';
import { routeOf, sameRoute } from './underpasses.js';

export function castMagicMissile(state, caster, options = {}) {
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if ((caster.failedSpellKeys || []).includes('magic missile')) throw new Error('Magic Missile is unavailable until recovery.');
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  const check = (options.rollCheck || rollCheck)(modifier, wizardCastingMode(caster, 1, true, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 11);
  const rolls = check.secondaryRoll != null ? `${check.firstRoll}, ${check.secondaryRoll}; keep ${check.roll}` : check.roll;
  let message = `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Magic Missile: 1d20 = (${rolls}) ${modifier >= 0 ? '+' : '-'}${Math.abs(modifier)} = ${check.total} vs DC 11.`;
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'magic missile'])];
    const mishaps = check.roll === 1 ? rollWizardMishaps(state, caster, 'Magic Missile', options) : [];
    if (mishaps.length) message += ` ${mishaps.map(result => `Mishap ${result.roll}: ${result.name}! ${result.detail}`).join(' ')}`;
    return { check, message, succeeded: false, mishaps };
  }
  caster.magicMissileSequence = (Number(caster.magicMissileSequence) || 0) + 1;
  caster.lastMagicMissile = null;
  const critical = check.roll === 20;
  caster.pendingSpell = { spell: 'magic missile', phase: critical ? 'critical' : 'targeting',
    castNumber: caster.magicMissileSequence, diceSides: 4, total: 1, remaining: 1, spent: [] };
  return { check, succeeded: true, critical, message: `${message} ${critical ? 'Choose two 1d4 missiles or one 1d8 missile.' : 'Pick target.'}` };
}

export function chooseMagicMissile(caster, choice) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'magic missile' || pending.phase !== 'critical') throw new Error('There is no critical Magic Missile awaiting a choice.');
  if (!['two-missiles', 'one-d8'].includes(choice)) throw new Error('Choose two 1d4 missiles or one 1d8 missile.');
  Object.assign(pending, { phase: 'targeting', total: choice === 'two-missiles' ? 2 : 1,
    remaining: choice === 'two-missiles' ? 2 : 1, diceSides: choice === 'two-missiles' ? 4 : 8 });
  return { message: pending.total === 2 ? 'Pick targets.' : 'Pick target.' };
}

export function fireMagicMissile(caster, target, { canTarget, random = Math.random, state } = {}) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'magic missile' || pending.phase !== 'targeting' || pending.remaining < 1) throw new Error('There are no Magic Missiles awaiting a target.');
  const blind = target?.blind === true;
  let square = null;
  if (blind) {
    if (!state || !canAimAtSquare(state, caster, target, ATTACK_RANGES.far)) throw new Error('Pick a square within range and a clear line of sight on the same floor.');
    square = { x: target.x, y: target.y, routeId: routeOf(state, caster) };
    target = (state.entities || []).find(entity => entity.type === 'monster' && !entity.defeated && !entity.leftPeacefully &&
      Number(entity.hp) > 0 && sameRoute(state, caster, entity) && entity.x === square.x && entity.y === square.y) || null;
  } else if (!target || target.type !== 'monster' || target.defeated || target.leftPeacefully || Number(target.hp) <= 0 || !canTarget?.(target)) {
    throw new Error('Pick a living enemy visible to the caster.');
  }
  let damage = 0;
  if (target) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid missile damage roll.');
    damage = Math.floor(value * pending.diceSides) + 1;
    target.hp = Math.max(0, Number(target.hp) - damage);
    if (damage > 0 && target.conditions?.sleeping) { delete target.conditions.sleeping; target.conditions.prone = true; }
  }
  pending.remaining -= 1;
  pending.spent.push({ targetId: target?.id || null, damage, ...(blind ? { blind: true, ...square } : {}) });
  const result = { damage, diceSides: pending.diceSides, defeated: Boolean(target && target.hp <= 0), hit: Boolean(target),
    targetId: target?.id || null, ...(blind ? { blind: true, square, guessedMonster: target } : {}),
    message: target ? `${caster.name} hits ${target.name || 'the enemy'} with Magic Missile: 1d${pending.diceSides} = (${damage}); ${damage} damage.`
      : `${caster.name} fires Magic Missile at an empty square and misses.` };
  if (!pending.remaining) {
    caster.lastMagicMissile = { ...pending, phase: 'complete' };
    caster.pendingSpell = null;
  }
  return result;
}

export function dismissMagicMissiles(caster) {
  if (caster.pendingSpell?.spell !== 'magic missile') throw new Error('There is no Magic Missile to dismiss.');
  caster.pendingSpell = null;
  caster.lastMagicMissile = null;
  return { message: 'Unused Magic Missiles dissipate. The casting action remains spent.' };
}
