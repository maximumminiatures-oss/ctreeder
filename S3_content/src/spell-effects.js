import { canMoveBetweenTiles, rollCheck } from './interactions.js';
import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { sameRoute, routeOf } from './underpasses.js';
import { ancestryKey, ancestryCastingBonus, isRepresentedAncestryBonus } from './ancestry.js';
import { isGaseousForm } from './conditions.js';

export function canReceiveHealing(character) {
  return Boolean(character && !character.dead && !character.slain &&
    (Number(character.hp) > 0 || Number(character.dyingRounds) > 0));
}

export function canTouchCharacter(state, caster, target) {
  if (!caster || !target || isGaseousForm(target) || !sameRoute(state, caster, target) || ![caster.x, caster.y, target.x, target.y].every(Number.isInteger)) return false;
  const dx = target.x - caster.x;
  const dy = target.y - caster.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) return false;
  if (!dx && !dy) return true;
  const step = (x, y, nx, ny) => canMoveBetweenTiles(state, x, y, nx, ny, { routeId: routeOf(state, caster) }).ok &&
    canMoveBetweenTiles(state, nx, ny, x, y, { routeId: routeOf(state, caster) }).ok;
  if (!step(caster.x, caster.y, target.x, target.y)) return false;
  // Touch cannot cut diagonally through a wall or a closed doorway.
  return !dx || !dy || (
    step(caster.x, caster.y, target.x, caster.y) && step(target.x, caster.y, target.x, target.y) &&
    step(caster.x, caster.y, caster.x, target.y) && step(caster.x, target.y, target.x, target.y)
  );
}

export function validateCureWoundsTarget(state, caster, targetId) {
  const target = state.characters.find(character => character.id === targetId);
  if (!canReceiveHealing(target)) throw new Error('Choose a living or dying character to heal.');
  if (!canTouchCharacter(state, caster, target)) throw new Error('Move within touch range of that character first.');
  return target;
}

export function cureWoundsDiceCount(character) {
  return 1 + Math.floor(Math.max(1, Math.min(99, Number(character.level) || 1)) / 2);
}

export function castingBonusSources(character, casterClass = 'priest') {
  const bonuses = character.bonuses || [];
  const sources = [];
  const ancestry = ancestryCastingBonus(character);
  if (ancestry) sources.push({ label: 'Farsight', amount: ancestry });
  for (const bonus of bonuses) {
    if (ancestryKey(character) === 'elf' && isRepresentedAncestryBonus(character, bonus)) continue;
    const name = String(bonus.bonusName || bonus.name || '');
    const detail = String(bonus.bonusTo || '');
    if (/advantage/i.test(name)) continue;
    if (!/spellcasting|casting.*spells/i.test(name + ' ' + detail) || new RegExp(casterClass === 'wizard' ? 'priest' : 'wizard', 'i').test(detail)) continue;
    const amount = Number(bonus.bonusAmount ?? bonus.bonusValue ?? bonus.value ?? detail.match(/[+-]?\d+/)?.[0]);
    if (Number.isFinite(amount) && amount) {
      const source = bonus.sourceName || character.className || 'Talent';
      sources.push({ label: [source, bonus.gainedAtLevel].filter(Boolean).join(' '), amount });
    }
  }
  for (const level of character.levels || []) {
    const text = level.Rolled12ChosenTalentDesc || ((level.talentRolledName || '') + ' ' + (level.talentRolledDesc || ''));
    // A rolled choice is not a second bonus; imported selected bonuses resolve it.
    if (/\bor\b|choose/i.test(text) || !/spellcasting/i.test(text)) continue;
    const alreadyIncluded = bonuses.some(bonus => /spellcasting/i.test((bonus.bonusName || '') + ' ' + (bonus.bonusTo || '')) &&
      /class/i.test(bonus.sourceType || '') && Number(bonus.gainedAtLevel) === Number(level.level));
    const amount = Number(text.match(/[+-]\d+/)?.[0]);
    if (!alreadyIncluded && Number.isFinite(amount) && amount) {
      sources.push({ label: [character.className || 'Class', level.level].filter(Boolean).join(' '), amount });
    }
  }
  return sources;
}

export function castingBonus(character, casterClass = 'priest') {
  return castingBonusSources(character, casterClass).reduce((total, source) => total + source.amount, 0);
}

export const priestCastingBonus = character => castingBonus(character, 'priest');

export function applyCureWoundsHealing(caster, target, diceCount, choice = 'normal', random = Math.random) {
  if (!canReceiveHealing(target)) throw new Error('Cure Wounds cannot restore a dead character.');
  if (!['normal', 'double-dice', 'double-total'].includes(choice)) throw new Error('Choose a critical healing option.');
  const count = diceCount * (choice === 'double-dice' ? 2 : 1);
  const rolls = Array.from({ length: count }, () => Math.floor(random() * 6) + 1);
  const total = rolls.reduce((sum, roll) => sum + roll, 0) * (choice === 'double-total' ? 2 : 1);
  const before = Number(target.hp) || 0;
  setCharacterHp(target, before + total);
  const healed = target.hp - before;
  return { rolls, total, healed, message: `${caster.name} heals ${target.name} with Cure Wounds: ${count}d6 = (${rolls.join(' + ')})${choice === 'double-total' ? ' x 2' : ''} = ${total}; ${healed} HP restored (${target.hp}/${target.maxHitPoints} HP).` };
}

export function castCureWounds(state, caster, targetId, options = {}) {
  const target = validateCureWoundsTarget(state, caster, targetId);
  if (caster.pendingSpell) throw new Error('Finish the pending critical spell first.');
  if ((caster.failedSpellKeys || []).includes('cure wounds')) throw new Error('Cure Wounds is unavailable until recovery.');
  const modifier = abilityScoreModifier(caster.stats?.WIS) + priestCastingBonus(caster);
  const check = (options.rollCheck || rollCheck)(modifier, { doubleRoll: options.advantage === true && !options.disadvantage,
    disadvantage: options.disadvantage === true && !options.advantage });
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 11);
  const message = `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Cure Wounds: 1d20 = (${check.roll}) ${modifier >= 0 ? '+' : '-'}${Math.abs(modifier)} = ${check.total} vs DC 11.`;
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'cure wounds'])];
    if (check.roll === 1) {
      caster.spellPenance = { ...(caster.spellPenance || {}), 'cure wounds': { paid: false } };
    }
    return { check, message, succeeded: false };
  }
  const diceCount = cureWoundsDiceCount(caster);
  if (check.roll === 20) {
    caster.pendingSpell = { spell: 'cure wounds', targetId: target.id, diceCount };
    return { check, message: `${message} Critical success: choose double healing dice or double healing total.`, succeeded: true, critical: true };
  }
  const healing = applyCureWoundsHealing(caster, target, diceCount, 'normal', options.random);
  return { check, healing, message: `${message} ${healing.message}`, succeeded: true };
}

export function resolveCureWounds(state, caster, choice, random = Math.random) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'cure wounds') throw new Error('There is no critical Cure Wounds awaiting a choice.');
  if (!['double-dice', 'double-total'].includes(choice)) throw new Error('Choose double healing dice or double healing total.');
  const target = state.characters.find(character => character.id === pending.targetId);
  if (!canReceiveHealing(target)) {
    caster.pendingSpell = null;
    return { message: 'The healing target is no longer available; Cure Wounds cannot resurrect the dead.' };
  }
  const result = applyCureWoundsHealing(caster, target, pending.diceCount, choice, random);
  caster.pendingSpell = null;
  return result;
}
