import { TARGETED_TIER_TWO_FOCUS, WIZARD_TIER_TWO_FOCUS_CRITICAL_CHOICES, castFocusedSpell, resolveFocusedSpell } from './wizard-tier-two-focus.js';
import { TRANSFORMATION_SPELLS, TRANSFORMATION_CRITICAL_CHOICES, ALTER_SELF_OPTIONS, alterSelfOptionEligible, castTransformationSpell, resolveTransformationSpell } from './transformation-spells.js';
import { AREA_SPELLS, AREA_CRITICAL_CHOICES, castAreaSpell, resolveAreaSpell } from './area-spells.js';

export const TIER_TWO_SPELLS = new Set([...TARGETED_TIER_TWO_FOCUS, ...TRANSFORMATION_SPELLS, ...AREA_SPELLS]);
export const TIER_TWO_CHOICES = { ...WIZARD_TIER_TWO_FOCUS_CRITICAL_CHOICES, ...TRANSFORMATION_CRITICAL_CHOICES, ...AREA_CRITICAL_CHOICES };
export function castTierTwoSpell(state, caster, spell, options = {}) {
  if (TARGETED_TIER_TWO_FOCUS.has(spell)) return castFocusedSpell(state, caster, spell, options);
  if (TRANSFORMATION_SPELLS.has(spell)) return castTransformationSpell(state, caster, spell, options);
  return castAreaSpell(state, caster, spell, options);
}
export function resolveTierTwoSpell(state, caster, selection, options = {}) {
  if (selection.dismiss) {
    if (caster.pendingSpell?.focusId) return resolveFocusedSpell(state, caster, { ...selection, ...options });
    caster.pendingSpell = null; return { message: 'Spell targeting dismissed.' };
  }
  const spell = caster.pendingSpell?.spell;
  if (TARGETED_TIER_TWO_FOCUS.has(spell) || caster.pendingSpell?.maintenance && caster.pendingSpell?.focusId) return resolveFocusedSpell(state, caster, { ...selection, ...options });
  if (TRANSFORMATION_SPELLS.has(spell)) return resolveTransformationSpell(state, caster, selection, options);
  return resolveAreaSpell(state, caster, selection, options);
}
export function tierTwoPresentation(state, caster) {
  const pending = caster?.pendingSpell;
  if (!TIER_TWO_SPELLS.has(pending?.spell)) return null;
  const title = pending.spell.replace(/\b\w/g, letter => letter.toUpperCase());
  const view = { id: `${caster.id}:${pending.spell}:${pending.focusId || ''}`, title, message: 'Pick target.' };
  if (pending.phase === 'critical') view.choices = (TIER_TWO_CHOICES[pending.spell] || []).map(([key, label]) => ({ key, label }));
  else if (pending.phase === 'options') view.options = ALTER_SELF_OPTIONS.map(option => ({ ...option, disabled: !alterSelfOptionEligible(state, caster, option.key) }));
  else if (pending.phase === 'placement') { view.area = { size: pending.size || 6, color: caster.colorValue, routeId: caster.routeId || '' }; view.message = 'Choose the area center, then confirm.'; }
  else if (pending.spell === 'misty step') view.message = 'Pick a destination square.';
  else if (pending.spell === 'fixed object') view.message = 'Pick a floor item, or choose carried gear.';
  else if (pending.spell === 'alter self') view.message = 'Pick the monster to copy.';
  else if (pending.remaining > 1) view.message = `Pick targets (${pending.remaining} remaining).`;
  return view;
}
