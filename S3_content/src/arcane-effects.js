import { sameRoute } from './underpasses.js';

export const arcaneEffects = creature => (creature?.wizardEffects || []).filter(effect =>
  (effect.rounds == null || effect.rounds > 0) && (effect.remainingMs == null || effect.remainingMs > 0));
export const isRaving = creature => arcaneEffects(creature).some(effect => effect.type === 'raving');
export const availableHands = creature => Math.max(0, 2 - new Set(arcaneEffects(creature)
  .filter(effect => effect.type === 'petrified-limbs').flatMap(effect => effect.limbs || []).filter(limb => /arm$/.test(limb))).size);
export const petrifiedLegs = creature => new Set(arcaneEffects(creature).filter(effect => effect.type === 'petrified-limbs')
  .flatMap(effect => effect.limbs || []).filter(limb => /leg$/.test(limb))).size;
export const attackDamageMultiplier = creature => arcaneEffects(creature).some(effect => effect.type === 'dark-plasma') ? 2 : 1;
export const blocksSpellTier = (creature, tier) => arcaneEffects(creature).some(effect => effect.type === 'spell-tier-ban' && effect.tier === tier);
export const forgottenSpells = creature => new Set(arcaneEffects(creature).filter(effect => effect.type === 'forgotten-spell').map(effect => effect.spell));
export const shredZones = state => (state?.entities || []).filter(entity => entity.subtype === 'arcane-shred');
export const isShrouded = (state, x, y, point = { x, y }) => shredZones(state).some(zone =>
  sameRoute(state, zone, point) && Math.hypot(x - zone.x, y - zone.y) <= Math.max(.27, Number(zone.radius) || .27));
