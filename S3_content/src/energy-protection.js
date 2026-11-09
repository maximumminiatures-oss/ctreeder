import { abilityScoreModifier } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus, canTouchCharacter } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { silenceBlocksAction } from './area-spells.js';
import { isSleeping } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { canTargetAtRange } from './targeting.js';

export const ENERGY_PROTECTION = 'protection from energy';
export const PROTECTION_ENERGIES = Object.freeze([
  ['fire', 'Fire'], ['cold', 'Cold'], ['lightning', 'Electricity']
]);
const actors = state => [...(state.characters || []), ...(state.entities || []).filter(actor => actor.type === 'monster')];
const alive = actor => actor && !actor.dead && !actor.slain && !actor.defeated && Number(actor.hp) > 0;
const awake = (state, actor) => alive(actor) && !isSleeping(actor, state) && !actor.conditions?.unconscious;
const save = actor => { if (actor.raw) for (const key of ['focusSpell', 'pendingSpell', 'spellEffects', 'failedSpellKeys']) actor.raw[key] = structuredClone(actor[key] ?? (key.endsWith('Keys') || key === 'spellEffects' ? [] : null)); };

export function syncEnergyProtection(state) {
  const all = actors(state);
  const byId = new Map(all.map(actor => [actor.id, actor]));
  for (const caster of all) {
    if (caster.focusSpell?.spell !== ENERGY_PROTECTION) continue;
    if (!awake(state, caster)) caster.focusSpell = null;
    if (caster.pendingSpell?.spell === ENERGY_PROTECTION && caster.pendingSpell.focusId !== caster.focusSpell?.id) caster.pendingSpell = null;
    save(caster);
  }
  for (const actor of all) {
    if (!actor.spellEffects?.some(effect => effect.spell === ENERGY_PROTECTION)) continue;
    actor.spellEffects = actor.spellEffects.filter(effect => {
      if (effect.spell !== ENERGY_PROTECTION) return true;
      const caster = byId.get(effect.casterId);
      return alive(actor) && awake(state, caster) && caster.focusSpell?.spell === ENERGY_PROTECTION &&
        caster.focusSpell.id === effect.focusId && caster.focusSpell.targetIds?.includes(actor.id);
    });
    if (actor.raw) actor.raw.spellEffects = structuredClone(actor.spellEffects);
  }
}

function check(caster, options) {
  return (options.checkRoll || options.rollCheck || rollCheck)(abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard'),
    wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage === true));
}
function fail(state, caster, result, options) {
  caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), ENERGY_PROTECTION])];
  save(caster);
  return result.roll === 1 ? rollWizardMishaps(state, caster, ENERGY_PROTECTION, { ...options, tier: 3 }) : [];
}

export function castEnergyProtection(state, caster, options = {}) {
  if (!awake(state, caster)) throw new Error('The caster must be conscious.');
  if (caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if (caster.failedSpellKeys?.includes(ENERGY_PROTECTION) || spellLockRemaining(caster, ENERGY_PROTECTION) || blocksSpellTier(caster, 3)) throw new Error('Protection From Energy is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  caster.focusSpell = null; syncEnergyProtection(state);
  const result = check(caster, options), succeeded = result.roll !== 1 && (result.roll === 20 || result.total >= 13);
  if (!succeeded) return { check: result, succeeded, mishaps: fail(state, caster, result, options), message: `${caster.name} fails to cast Protection From Energy: ${result.total} vs DC 13.` };
  caster.raw ||= {};
  caster.raw.energyProtectionSequence = (Number(caster.raw.energyProtectionSequence) || 0) + 1;
  const id = `energy-${caster.id}-${caster.raw.energyProtectionSequence}`;
  caster.focusSpell = { id, spell: ENERGY_PROTECTION, tier: 3, targetIds: [], energyTypes: [], maxTargets: 1, maxEnergies: 1, lastCheck: result.total };
  caster.pendingSpell = { spell: ENERGY_PROTECTION, focusId: id, phase: result.roll === 20 ? 'critical' : 'options' };
  save(caster);
  return { check: result, succeeded: true, critical: result.roll === 20, message: result.roll === 20 ? 'Choose a critical effect.' : 'Choose an energy type.' };
}

export function resolveEnergyProtection(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell, focus = caster.focusSpell;
  if (pending?.spell !== ENERGY_PROTECTION || focus?.id !== pending.focusId) throw new Error('No Protection From Energy casting is pending.');
  if (selection.dismiss) {
    caster.pendingSpell = null;
    if (!focus.targetIds.length) caster.focusSpell = null;
    syncEnergyProtection(state); save(caster);
    return { message: focus.targetIds.length ? 'Remaining targeting dismissed; existing protection continues.' : 'Protection From Energy dismissed.' };
  }
  if (pending.phase === 'critical') {
    if (!['targets', 'energies'].includes(selection.choice)) throw new Error('Choose two creatures or two energy types.');
    focus.maxTargets = selection.choice === 'targets' ? 2 : 1;
    focus.maxEnergies = selection.choice === 'energies' ? 2 : 1;
    pending.phase = 'options';
  } else if (pending.phase === 'options') {
    if (!PROTECTION_ENERGIES.some(([key]) => key === selection.option) || focus.energyTypes.includes(selection.option)) throw new Error('Choose a different valid energy type.');
    focus.energyTypes.push(selection.option);
    if (focus.energyTypes.length === focus.maxEnergies) pending.phase = 'targeting';
  } else {
    const target = actors(state).find(actor => actor.id === selection.targetId);
    const reachable = target && (options.canTouch ? options.canTouch(target) :
      target.id === caster.id || ((state.characters || []).includes(target) ? canTouchCharacter(state, caster, target) :
        canTargetAtRange(state, caster, target, 1, { directAttack: true })));
    if (!alive(target) || isFloatingDisc(target) || target.illusion || focus.targetIds.includes(target.id) || !reachable) throw new Error('Choose a different living creature within clear touch range.');
    focus.targetIds.push(target.id);
    target.spellEffects ||= [];
    target.spellEffects.push({ id: `${focus.id}:${target.id}`, spell: ENERGY_PROTECTION, kind: 'spell', casterId: caster.id,
      focusId: focus.id, targetId: target.id, energyTypes: [...focus.energyTypes] });
    save(target);
    if (focus.targetIds.length === focus.maxTargets) caster.pendingSpell = null;
  }
  save(caster);
  return { message: caster.pendingSpell?.phase === 'options' ? 'Choose an energy type.' : caster.pendingSpell ? 'Pick a creature within touch range.' : 'Protection From Energy takes effect while Focus lasts.' };
}

export function maintainEnergyProtection(state, caster, options = {}) {
  if (caster.focusSpell?.spell !== ENERGY_PROTECTION) return null;
  if (!awake(state, caster) || silenceBlocksAction(state, caster, { spellcasting: true })) { caster.focusSpell = null; syncEnergyProtection(state); return { succeeded: false, message: `${caster.name}'s Protection From Energy ends.` }; }
  const result = check(caster, options), succeeded = result.roll !== 1 && (result.roll === 20 || result.total >= 13);
  let mishaps = [];
  if (succeeded) caster.focusSpell.lastCheck = result.total;
  else {
    caster.focusSpell = null;
    if (caster.pendingSpell?.spell === ENERGY_PROTECTION) caster.pendingSpell = null;
    if (result.roll === 1) mishaps = fail(state, caster, result, options);
  }
  syncEnergyProtection(state); save(caster);
  return { check: result, succeeded, mishaps, message: `${caster.name} ${succeeded ? 'maintains' : 'loses'} Focus on Protection From Energy: ${result.total} vs DC 13.` };
}

export function energyProtectionPresentation(state, caster) {
  if (caster?.pendingSpell?.spell !== ENERGY_PROTECTION) return null;
  const pending = caster.pendingSpell, focus = caster.focusSpell;
  const view = { id: `${caster.id}:${pending.focusId}`, title: 'Protection From Energy', message: 'Pick a creature within touch range.' };
  if (pending.phase === 'critical') view.choices = [{ key: 'targets', label: 'Two Creatures' }, { key: 'energies', label: 'Two Energy Types on One Creature' }];
  else if (pending.phase === 'options') {
    view.message = 'Choose an energy type.';
    view.options = PROTECTION_ENERGIES.map(([key, label]) => ({ key, label, disabled: focus.energyTypes.includes(key) }));
  } else view.targets = (state.characters || []).filter(actor => alive(actor) && !isFloatingDisc(actor) && !actor.illusion && !focus.targetIds.includes(actor.id) &&
    (actor.id === caster.id || canTouchCharacter(state, caster, actor))).map(actor => ({ key: actor.id, label: actor.name }));
  return view;
}
