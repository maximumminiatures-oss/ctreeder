import { setCharacterHp, abilityScoreModifier } from './characters.js';
import { castingBonus, canReceiveHealing, canTouchCharacter } from './spell-effects.js';
import { ATTACK_RANGES, canTargetAtRange } from './targeting.js';
import { hasCreatureTag } from './creature-tags.js';
import { circleBlocksMentalControl } from './magic-circle.js';
import { normalizeLanguages, automaticMonsterLanguages, isTelepathicMonster } from './monster-languages.js';
import { isSleeping, isGaseousForm } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { hasHolySymbol } from './holy-symbols.js';
import { removeAffliction, restorableConditions } from './creature-afflictions.js';
import { rollCheck } from './interactions.js';
import { protectionDisadvantage } from './faith-spells.js';
import { wizardCastingMode } from './wizard-mishaps.js';

export const PRIEST_TIER_THREE_SPELLS = new Set(['command', 'lay to rest', 'mass cure', 'rebuke unholy', 'restoration']);
const names = {
  command: 'Command', 'lay to rest': 'Lay to Rest', 'mass cure': 'Mass Cure',
  'rebuke unholy': 'Rebuke Unholy', restoration: 'Restoration'
};
const criticalChoices = {
  command: [['targets', 'Two Targets'], ['orders', 'Two Commands']],
  'lay to rest': [['targets', 'Two Creatures'], ['level', 'Level 18 or Less'], ['range', 'Near Range']],
  'mass cure': [['dice', 'Heal 4d6'], ['range', 'Double Range']],
  'rebuke unholy': [['range', 'Double Range'], ['duration', 'Flee for 10 Rounds'], ['level', 'Double Destruction Level']],
  restoration: [['effects', 'End Two Afflictions']]
};
const commandNames = ['drop', 'flee', 'grovel', 'approach', 'halt'];
const noPair = new Set(['flee+grovel', 'approach+grovel', 'approach+flee']);
const movementOrders = ['flee', 'grovel', 'approach'];
const title = value => value[0].toUpperCase() + value.slice(1);
const dc = 13;
const creatures = state => [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')];
const alive = creature => creature && !creature.dead && !creature.slain && !creature.defeated && !creature.leftPeacefully && Number(creature.hp) > 0;
const findCreature = (state, id) => creatures(state).find(creature => creature.id === id);
const modifier = (creature, key) => creature.stats ? abilityScoreModifier(creature.stats[key]) : Number(creature[key === 'CHA' ? 'Ch' : key] || 0);

function languages(creature) {
  const spoken = normalizeLanguages(creature.languages);
  return spoken.length || creature.type !== 'monster' ? spoken : automaticMonsterLanguages(creature);
}

function understands(target, caster) {
  if (target.conditions?.deaf || target.conditions?.deafened || target.conditions?.bugBrain || caster.conditions?.bugBrain) return false;
  return isTelepathicMonster(target) || languages(target).some(language => languages(caster).includes(language));
}

function isAffectedByRebuke(caster, target) {
  const tags = String(caster.alignment).toLowerCase() === 'chaotic' ? ['celestial', 'animal'] : ['fiend', 'primordial'];
  return tags.some(tag => hasCreatureTag(target, tag));
}

function checkCasting(state, caster, options) {
  const bonus = modifier(caster, 'WIS') + castingBonus(caster, 'priest');
  return (options.checkRoll || rollCheck)(bonus, wizardCastingMode(caster, 3, options.advantage === true,
    Boolean(options.disadvantage || protectionDisadvantage(state, caster))));
}

function optionsForCommand(pending) {
  return commandNames.filter(word => !pending.orders.includes(word) &&
    !pending.orders.some(prior => (prior === 'halt' && movementOrders.includes(word)) ||
      (word === 'halt' && movementOrders.includes(prior)) || noPair.has([prior, word].sort().join('+'))));
}

function legalTarget(state, caster, pending, target) {
  const spell = pending.spell;
  if (!target || isFloatingDisc(target) || pending.usedTargetIds.includes(target.id) || target.possessingId || isGaseousForm(target)) return false;
  if (spell === 'restoration') return !target.dead && !target.slain && !target.defeated &&
    canTouchCharacter(state, caster, target) && restorableConditions(target).length > 0;
  if (!alive(target) || target.id === caster.id) return false;
  if (spell === 'lay to rest') return hasCreatureTag(target, 'undead') &&
    Number(target.level ?? target['**LV**'] ?? 1) <= pending.maxLevel && (pending.range === 1 ?
      canTouchCharacter(state, caster, target) : canTargetAtRange(state, caster, target, pending.range, { directAttack: true }));
  return understands(target, caster) && !circleBlocksMentalControl(state, caster, target) &&
    canTargetAtRange(state, caster, target, pending.range, { directAttack: true });
}

function areaEffect(state, caster, pending, options) {
  const roll = options.random || Math.random;
  if (pending.spell === 'mass cure') {
    const amount = Array.from({ length: pending.dice }, () => 1 + Math.floor(roll() * 6)).reduce((sum, n) => sum + n, 0);
    const allies = state.characters.filter(target => canReceiveHealing(target) && !isFloatingDisc(target) &&
      !target.conditions?.lycanthropy?.hostile && (!target.conditions?.necrosis || pending.castingTotal >= 15) && canTargetAtRange(state, caster, target, pending.range, { requireLight: false }));
    for (const target of allies) setCharacterHp(target, Number(target.hp) + amount);
    return { message: allies.length ? 'Mass Cure restores up to ' + amount + ' HP to ' + allies.map(target => target.name).join(', ') + '.' : 'No allies are in range.' };
  }
  const results = [];
  for (const target of creatures(state)) {
    if (!alive(target) || target.id === caster.id || !isAffectedByRebuke(caster, target) ||
        !canTargetAtRange(state, caster, target, pending.range, { requireLight: false })) continue;
    const check = (options.saveRoll || rollCheck)(modifier(target, 'CHA'));
    const destroyed = pending.castingTotal - check.total >= 10 && Number(target.level ?? 1) <= pending.maxLevel;
    const fled = !destroyed && check.total < pending.castingTotal;
    if (destroyed) options.destroy?.(target);
    if (fled) target.turnedUndead = { rounds: pending.rounds, casterId: caster.id };
    results.push({ id: target.id, name: target.name, destroyed, fled, check });
  }
  return { results, message: results.length ? results.map(result => result.name + (result.destroyed ? ' is destroyed.' : result.fled ?
    ' flees.' : ' resists.')).join(' ') : 'Rebuke Unholy affects no creatures in range.' };
}

function beginResolution(state, caster, pending, options) {
  if (['mass cure', 'rebuke unholy'].includes(pending.spell)) {
    caster.pendingSpell = null;
    return areaEffect(state, caster, pending, options);
  }
  pending.phase = 'targeting';
  return { message: 'Choose a target for ' + names[pending.spell] + '.' };
}

export function castPriestTierThree(state, caster, spell, options = {}) {
  if (!PRIEST_TIER_THREE_SPELLS.has(spell) || !/\bpriest\b/i.test(caster.className || '')) throw new Error('Only a priest can cast this spell.');
  if (caster.pendingSpell || caster.failedSpellKeys?.includes(spell)) throw new Error('This spell is unavailable.');
  if (spell === 'rebuke unholy' && !hasHolySymbol(caster)) throw new Error('Rebuke Unholy requires your holy symbol.');
  const check = checkCasting(state, caster, options);
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= dc);
  const result = { check, succeeded, dc, message: caster.name + (succeeded ? ' casts ' : ' fails to cast ') + names[spell] + '.' };
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
    if (check.roll === 1) caster.spellPenance = { ...(caster.spellPenance || {}), [spell]: { paid: false } };
    return result;
  }
  const range = spell === 'command' ? ATTACK_RANGES.far : ['lay to rest', 'restoration'].includes(spell) ? 1 : ATTACK_RANGES.near;
  const pending = { spell, phase: 'critical', range, castingTotal: check.total, maxLevel: spell === 'lay to rest' ? 9 : caster.level,
    remaining: 1, orderCount: 1, orders: [], dice: 2, rounds: 5, usedTargetIds: [] };
  caster.pendingSpell = pending;
  if (check.roll !== 20) {
    const outcome = beginResolution(state, caster, pending, options);
    return { ...result, ...outcome, message: result.message + ' ' + outcome.message };
  }
  return result;
}

function finishTarget(caster, pending, target) {
  pending.usedTargetIds.push(target.id);
  if (--pending.remaining <= 0) caster.pendingSpell = null;
}

export function resolvePriestTierThree(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell, spell = pending?.spell;
  if (!PRIEST_TIER_THREE_SPELLS.has(spell)) throw new Error('No Tier 3 priest spell is pending.');
  if (selection.dismiss) {
    caster.pendingSpell = null;
    return { message: 'The unused spell dissipates. The casting action remains spent.' };
  }
  if (pending.phase === 'critical') {
    const choice = selection.choice;
    if (!criticalChoices[spell].some(([key]) => key === choice)) throw new Error('Choose a critical effect.');
    if (choice === 'targets') pending.remaining = 2;
    if (choice === 'orders') pending.orderCount = 2;
    if (choice === 'range') pending.range = pending.range === 1 ? ATTACK_RANGES.near : 2 * pending.range;
    if (choice === 'level') pending.maxLevel *= 2;
    if (choice === 'duration') pending.rounds *= 2;
    if (choice === 'dice') pending.dice *= 2;
    if (choice === 'effects') pending.effectCount = 2;
    return beginResolution(state, caster, pending, options);
  }
  const target = findCreature(state, pending.targetId || selection.targetId);
  if (!legalTarget(state, caster, pending, target)) throw new Error('Choose an eligible target within range.');
  if (pending.phase === 'targeting' && ['restoration', 'command'].includes(spell)) {
    pending.targetId = target.id;
    pending.orders = [];
    pending.phase = 'option';
    return { message: 'Choose ' + (spell === 'restoration' ? 'an affliction to end.' : 'a command for ' + target.name + '.') };
  }
  if (spell === 'restoration') {
    const effect = restorableConditions(target).find(item => item.key === selection.option);
    if (!effect) throw new Error('Choose an active affliction.');
    removeAffliction(state, target, effect.key);
    if (!(pending.effectCount > 1) || !restorableConditions(target).length) finishTarget(caster, pending, target);
    else pending.effectCount--;
    return { restoredId: target.id, removedEffect: effect.key, message: 'Restoration ends ' + effect.label + ' on ' + target.name + '.' };
  }
  if (spell === 'command') {
    if (!optionsForCommand(pending).includes(selection.option)) throw new Error('Choose a compatible command.');
    pending.orders.push(selection.option);
    if (pending.orders.length < pending.orderCount) return { message: 'Choose a second command for ' + target.name + '.' };
    if (caster.focusSpell?.spell !== 'command') caster.focusSpell = { spell, tier: 3, castingTotal: pending.castingTotal, ordersByTarget: {} };
    caster.focusSpell.ordersByTarget[target.id] = {
      orders: [...pending.orders], start: { x: target.x, y: target.y },
      direction: { x: target.x - caster.x, y: target.y - caster.y }
    };
    if (pending.orders.includes('grovel')) {
      target.conditions ||= {};
      target.conditions.prone = true;
    }
    finishTarget(caster, pending, target);
    pending.phase = 'targeting';
    pending.targetId = null;
    return { commandedId: target.id, message: caster.name + ' commands ' + target.name + ' to ' + pending.orders.join(' and ') + '.' };
  }
  options.destroy?.(target);
  finishTarget(caster, pending, target);
  return { struckIds: [target.id], message: 'Lay to Rest destroys ' + target.name + '.' };
}

export function maintainCommand(state, caster, options = {}) {
  const focus = caster.focusSpell;
  if (focus?.spell !== 'command') return null;
  const check = checkCasting(state, caster, options);
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= dc);
  if (succeeded) {
    focus.castingTotal = check.total;
    focus.maintained = true;
  }
  else {
    caster.focusSpell = null;
    if (caster.pendingSpell?.spell === 'command') caster.pendingSpell = null;
    if (check.roll === 1) {
      caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'command'])];
      caster.spellPenance = { ...(caster.spellPenance || {}), command: { paid: false } };
    }
  }
  return { check, succeeded, message: caster.name + (succeeded ? ' maintains Command.' : ' loses Focus on Command.') };
}

export function activeCommand(state, target) {
  if (!target) return null;
  for (const caster of state.characters || []) {
    const focus = caster.focusSpell;
    if (focus?.spell !== 'command' || !alive(caster) || isSleeping(caster, state) || caster.conditions?.paralyzed) continue;
    const orders = focus.ordersByTarget?.[target.id];
    if (orders) return { caster, focus, ...orders };
  }
  return null;
}

export function priestTierThreePresentation(state, caster) {
  const pending = caster?.pendingSpell;
  if (!PRIEST_TIER_THREE_SPELLS.has(pending?.spell)) return null;
  const view = { id: caster.id + ':' + pending.spell + ':' + pending.phase, title: names[pending.spell] };
  if (pending.phase === 'critical') return { ...view, choices: criticalChoices[pending.spell].map(([key, label]) => ({ key, label })) };
  if (pending.phase === 'option') return { ...view, options: pending.spell === 'command' ?
    optionsForCommand(pending).map(key => ({ key, label: title(key) })) : restorableConditions(findCreature(state, pending.targetId)) };
  return { ...view, targets: creatures(state).filter(target => legalTarget(state, caster, pending, target))
    .map(target => ({ key: target.id, label: target.name })) };
}
