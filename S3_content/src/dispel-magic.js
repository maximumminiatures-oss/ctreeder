import { abilityScoreModifier } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { silenceBlocksAction } from './area-spells.js';
import { canAimAtSquare, canTargetAtRange } from './targeting.js';
import { isTilePerceived } from './visibility.js';
import { isMonsterCurrentlyVisible, isFeatureCurrentlyVisible } from './monster-perception.js';
import { routeOf } from './underpasses.js';
import { listMagicEffects, endMagicEffect } from './magic-effect-registry.js';

export const DISPEL_CRITICAL_CHOICES = [['effects', 'Two Effects on One Target'], ['targets', 'One Effect on Each of Two Targets']];

export function castDispelMagic(state, caster, options = {}) {
  if (caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if ((caster.failedSpellKeys || []).includes('dispel magic') || spellLockRemaining(caster, 'dispel magic') || blocksSpellTier(caster, 3))
    throw new Error('Dispel Magic is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  const check = (options.checkRoll || options.rollCheck || rollCheck)(modifier, wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  const result = { check, succeeded, critical: check.roll === 20, mishaps: [],
    message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Dispel Magic: ${check.total} vs DC 13.` };
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'dispel magic'])];
    if (check.roll === 1) result.mishaps = rollWizardMishaps(state, caster, 'Dispel Magic', { ...options, tier: 3 });
    if (result.mishaps.length) result.message += ' ' + result.mishaps.map(mishap => `${mishap.name}: ${mishap.detail || ''}`).join(' ');
    return result;
  }
  caster.pendingSpell = { spell: 'dispel magic', tier: 3, phase: result.critical ? 'critical' : 'targeting',
    castingTotal: check.total, radius: 6, remaining: 1, usedEffectIds: [], usedTargetIds: [] };
  return { ...result, message: `${result.message} ${result.critical ? 'Choose a critical effect.' : 'Pick a target or ongoing area spell.'}` };
}

function pointFor(state, caster, selection) {
  const target = [...(state.characters || []), ...(state.entities || [])].find(actor => actor.id === selection.targetId);
  const point = target || { x: selection.x, y: selection.y, routeId: selection.routeId ?? routeOf(state, caster) };
  if (!canAimAtSquare(state, caster, point, 6)) throw new Error('Choose a target within six squares and clear line of sight on the same route.');
  if (target && target.id !== caster.id) {
    const visible = target.type === 'monster' ? isMonsterCurrentlyVisible(state, target, { viewer: caster }) :
      isFeatureCurrentlyVisible(state, target, { viewer: caster });
    if (!visible || !canTargetAtRange(state, caster, target, 6, { requireLight: false, directAttack: true }))
      throw new Error('Choose a target the caster can see.');
  } else if (!target && !isTilePerceived(state, point.x, point.y, { ...point, viewer: caster })) {
    throw new Error('Choose a square the caster can see.');
  }
  return { x: point.x, y: point.y, routeId: routeOf(state, point), ...(target ? { targetId: target.id } : {}) };
}

function effectsAt(state, point) {
  return listMagicEffects(state).filter(effect => {
    if ((effect.routeId || '') !== (point.routeId || '')) return false;
    if (point.targetId && effect.targetId === point.targetId) return true;
    const width = effect.width || 1, height = effect.height || 1;
    return (!point.targetId || effect.kind === 'area') && point.x >= effect.x && point.y >= effect.y &&
      point.x < effect.x + width && point.y < effect.y + height;
  });
}

export function dispelMagicOptions(state, caster) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'dispel magic' || !pending.selected) return [];
  return effectsAt(state, pending.selected).filter(effect => !pending.usedEffectIds.includes(effect.id) &&
    (!pending.lockedTargetId || effect.targetId === pending.lockedTargetId) &&
    (pending.choice !== 'targets' || !pending.usedTargetIds.includes(effect.targetId)));
}

export function resolveDispelMagic(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'dispel magic') throw new Error('No Dispel Magic is pending.');
  if (selection.dismiss) { caster.pendingSpell = null; return { message: 'Unused Dispel Magic dissipates. The casting action remains spent.' }; }
  if (pending.phase === 'critical') {
    if (!DISPEL_CRITICAL_CHOICES.some(([key]) => key === selection.choice)) throw new Error('Choose a valid critical effect.');
    pending.choice = selection.choice; pending.remaining = 2; pending.phase = 'targeting';
    return { message: 'Pick a target or ongoing area spell.' };
  }
  if (selection.back) { pending.phase = 'targeting'; delete pending.selected; return { message: 'Pick a target or ongoing area spell.' }; }
  if (selection.effectId == null) {
    const point = pointFor(state, caster, selection);
    pending.selected = point;
    const effects = dispelMagicOptions(state, caster);
    if (!effects.length) { delete pending.selected; throw new Error('No eligible magical effect is available on that target.'); }
    pending.phase = 'effects';
    return { effects, message: 'Choose the magical effect to end or suppress.' };
  }
  if (pending.phase !== 'effects') throw new Error('Pick a target before choosing its magical effect.');
  pointFor(state, caster, pending.selected);
  const effect = dispelMagicOptions(state, caster).find(entry => entry.id === selection.effectId);
  if (!effect) throw new Error('That effect is no longer available; choose a current effect.');
  const outcome = endMagicEffect(state, effect.id, options);
  pending.usedEffectIds.push(effect.id); pending.usedTargetIds.push(effect.targetId);
  if (pending.choice === 'effects') pending.lockedTargetId = effect.targetId;
  pending.remaining--;
  if (!pending.remaining) caster.pendingSpell = null;
  else if (pending.choice === 'effects') {
    if (dispelMagicOptions(state, caster).length) pending.phase = 'effects';
    else { caster.pendingSpell = null; outcome.message += ' No second effect remains on that target.'; }
  } else { pending.phase = 'targeting'; delete pending.selected; }
  return { ...outcome, actionCost: 0 };
}

export function dispelMagicPresentation(state, caster) {
  const pending = caster?.pendingSpell;
  if (pending?.spell !== 'dispel magic') return null;
  const view = { id: `${caster.id}:dispel-magic`, title: 'Dispel Magic', message: 'Pick a target or ongoing area spell.' };
  if (pending.phase === 'critical') { view.message = 'Choose a critical effect.'; view.choices = DISPEL_CRITICAL_CHOICES.map(([key, label]) => ({ key, label })); }
  else if (pending.phase === 'effects') {
    view.message = 'Choose the effect to end or suppress.';
    view.options = dispelMagicOptions(state, caster).map(effect => ({ key: effect.id, label: effect.name,
      description: effect.kind === 'suppression' ? 'Suppress this magic for ten rounds.' : 'End this effect only.' }));
    view.options.push({ key: '__back__', label: 'Choose Another Target' });
  } else if (pending.remaining === 2) view.message = 'Pick the first of two targets.';
  else if (pending.choice === 'targets') view.message = 'Pick a different second target.';
  return view;
}
