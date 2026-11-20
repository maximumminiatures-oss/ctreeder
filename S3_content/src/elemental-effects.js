import {isImmersed} from './water-rules.js';
import { isVampire } from './supernatural-traits.js';
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

export function elementalDamage(creature, amount, source, state = null) {
  const types = matchingDamageTypes(source), type = resistanceType(creature, source), original = Math.max(0, Number(amount) || 0);
  const immunity = isVampire(creature) && types.includes('poison') ? 'poison' : (creature?.spellEffects || []).filter(effect => effect.spell === 'protection from energy' && effect.active !== false)
    .flatMap(effect => effect.energyTypes || []).find(energy => types.includes(normalizeDamageType(energy))) || null;
  const gaseousArea = source?.areaEffect === true && (creature?.transformationEffects || []).some(effect => effect.spell === 'gaseous form' && effect.rounds > 0);
  const reduced = type ? Math.floor(original / 2) : original;
  const water=isImmersed(state,creature)&&types.includes("fire");
  const protectedTotal=gaseousArea?Math.floor(reduced/2):reduced;
  return { original, total: immunity ? 0 : water ? Math.floor(protectedTotal/2) : protectedTotal, resistance: type,
    ...(water?{water:true}:{}),
    ...(immunity ? { immunity } : {}), ...(gaseousArea ? { gaseousArea: true } : {}) };
}

export function elementalSaveOptions(creature, source, { advantage = false, disadvantage = false, state = null } = {}) {
  const types=matchingDamageTypes(source),wet=isImmersed(state,creature);
  advantage ||= Boolean(resistanceType(creature, source)) || wet&&types.includes("fire");
  disadvantage ||= wet&&types.includes("lightning");
  return { doubleRoll: advantage && !disadvantage, disadvantage: disadvantage && !advantage };
}


/** Weapon components keep physical and radiant damage independent of elemental defenses. */
export function elementalWeaponDamage(creature,{physical=0,elemental=0,radiant=0},element,state=null){
  const protection=elementalDamage(creature,elemental,element,state);
  return {...protection,original:physical+elemental+radiant,total:physical+protection.total+radiant};
}
