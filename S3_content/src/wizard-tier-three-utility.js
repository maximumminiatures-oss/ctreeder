import { ENERGY_PROTECTION, castEnergyProtection, resolveEnergyProtection, maintainEnergyProtection, syncEnergyProtection, energyProtectionPresentation } from './energy-protection.js';
import { SPEAK_WITH_DEAD_KEY, castSpeakWithDead, resolveSpeakWithDead, speakWithDeadPresentation } from './speak-with-dead.js';
import { TIER_THREE_MOBILITY_SPELLS, castTierThreeMobilitySpell, resolveTierThreeMobilitySpell, tierThreeMobilityPresentation } from './tier-three-mobility.js';
import { castAnimateDead, resolveAnimateDead, animateDeadPresentation, syncAnimatedDeadState } from './animate-dead.js';
import { MAGIC_CIRCLE, castMagicCircle, resolveMagicCircle, maintainMagicCircle, syncMagicCircles, magicCirclePresentation } from './magic-circle.js';

export const TIER_THREE_UTILITY_SPELLS = new Set([ENERGY_PROTECTION, SPEAK_WITH_DEAD_KEY, ...TIER_THREE_MOBILITY_SPELLS, 'animate dead', MAGIC_CIRCLE]);
export function castTierThreeUtility(state, caster, spell, options = {}) {
  if (spell === ENERGY_PROTECTION) return castEnergyProtection(state, caster, options);
  if (spell === SPEAK_WITH_DEAD_KEY) return castSpeakWithDead(state, caster, options);
  if (TIER_THREE_MOBILITY_SPELLS.has(spell)) return castTierThreeMobilitySpell(state, caster, spell, options);
  if (spell === 'animate dead') return castAnimateDead(state, caster, options);
  if (spell === MAGIC_CIRCLE) return castMagicCircle(state, caster, options);
  throw new Error('This Tier 3 spell is not implemented.');
}
export function resolveTierThreeUtility(state, caster, selection = {}, options = {}) {
  if (selection.dismiss && TIER_THREE_MOBILITY_SPELLS.has(caster.pendingSpell?.spell)) {
    caster.pendingSpell = null; return { message: 'Spell choice dismissed. The casting action remains spent.' };
  }
  if (caster.pendingSpell?.spell === ENERGY_PROTECTION) return resolveEnergyProtection(state, caster, selection, options);
  if (caster.pendingSpell?.spell === SPEAK_WITH_DEAD_KEY) return resolveSpeakWithDead(state, caster, selection, options);
  if (TIER_THREE_MOBILITY_SPELLS.has(caster.pendingSpell?.spell)) return resolveTierThreeMobilitySpell(state, caster, selection, options);
  if (caster.pendingSpell?.spell === 'animate dead') return resolveAnimateDead(state, caster, { ...selection, form: selection.option }, options);
  if (caster.pendingSpell?.spell === MAGIC_CIRCLE) return resolveMagicCircle(state, caster, selection);
  throw new Error('No Tier 3 utility spell is pending.');
}
export function tierThreeUtilityPresentation(state, caster, options = {}) {
  return energyProtectionPresentation(state, caster) || speakWithDeadPresentation(state, caster, options) || tierThreeMobilityPresentation(state, caster) || animateDeadPresentation(state, caster, options) || magicCirclePresentation(state, caster);
}
export function isTierThreeUtilityFocus(focus) { return [ENERGY_PROTECTION, MAGIC_CIRCLE].includes(focus?.spell); }
export function maintainTierThreeUtility(state, caster, options = {}) {
  return caster.focusSpell?.spell === MAGIC_CIRCLE ? maintainMagicCircle(state, caster, options) : maintainEnergyProtection(state, caster, options);
}
export function syncTierThreeUtility(state) { syncEnergyProtection(state); syncAnimatedDeadState(state); syncMagicCircles(state); }
