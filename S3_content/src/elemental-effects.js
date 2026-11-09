import { isMagicSuppressed } from './magic-suppression.js';
import { matchingDamageTypes, normalizeDamageType } from './damage-types.js';

export const ELEMENTS = ['lightning', 'fire', 'cold', 'acid', 'poison'];
export function matchingElements(source) {
  const types = matchingDamageTypes(source);
  return ELEMENTS.filter(element => types.includes(element));
}

export function resistanceType(creature, source) {
  const elements = matchingDamageTypes(source);
  return normalizeDamageType((creature?.gear || []).find(item => item.equipped && !isMagicSuppressed(item) && elements.includes(normalizeDamageType(item.magic?.resistance)))?.magic.resistance);
}

export function elementalDamage(creature, amount, source) {
  const types = matchingDamageTypes(source), type = resistanceType(creature, source), original = Math.max(0, Number(amount) || 0);
  const immunity = (creature?.spellEffects || []).filter(effect => effect.spell === 'protection from energy' && effect.active !== false)
    .flatMap(effect => effect.energyTypes || []).find(energy => types.includes(normalizeDamageType(energy))) || null;
  const gaseousArea = source?.areaEffect === true && (creature?.transformationEffects || []).some(effect => effect.spell === 'gaseous form' && effect.rounds > 0);
  const reduced = type ? Math.floor(original / 2) : original;
  return { original, total: immunity ? 0 : gaseousArea ? Math.floor(reduced / 2) : reduced, resistance: type,
    ...(immunity ? { immunity } : {}), ...(gaseousArea ? { gaseousArea: true } : {}) };
}

export function elementalSaveOptions(creature, source, { advantage = false, disadvantage = false } = {}) {
  advantage ||= Boolean(resistanceType(creature, source));
  return { doubleRoll: advantage && !disadvantage, disadvantage: disadvantage && !advantage };
}
