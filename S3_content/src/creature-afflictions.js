import { hasLineOfSightFrom } from './visibility.js';
import { sameRoute } from './underpasses.js';
import { wakeCreature } from './conditions.js';

const labels = {
  poison: 'Poison', toxin: 'Toxin', stupefied: 'Stupefied', dazed: 'Dazed', blind: 'Blindness',
  paralyzed: 'Paralysis', sleeping: 'Sleep', disease: 'Disease', lycanthropy: 'Lycanthropy',
  petrified: 'Petrification', charm: 'Charm', soulbind: 'Soulbind', mindControl: 'Mind Control',
  enslave: 'Enslave', possess: 'Possession', screech: 'Screech', terrify: 'Terrify', beguile: 'Beguile',
  hellfire: 'Hellfire', vomiting: 'Vomiting', hypnotize: 'Hypnotize', frozen: 'Frozen',
  lifeDrain: 'Life Drain', carrionStench: 'Carrion Stench', harpySong: 'Harpy Song',
  gibbering: 'Gibbering', bugBrain: 'Bug Brain', stinkBomb: 'Stink Bomb', necrosis: 'Necrosis', curse: 'Curse'
};

export function restorableConditions(target) {
  const conditions = Object.keys(labels).filter(key => target?.conditions?.[key]).map(key => ({ key, label: labels[key] }));
  for (const key of ['charm', 'curse', 'lycanthropy']) {
    if ((target?.[key] || key === 'charm' && target?.companion?.charm) && !conditions.some(effect => effect.key === key)) conditions.push({ key, label: labels[key] });
  }
  for (const effect of target?.wizardEffects || []) {
    if (['petrification', 'stat-collapse'].includes(effect.type)) conditions.push({
      key: 'wizard:' + effect.type, label: effect.type === 'petrification' ? 'Petrification' : 'Arcano-Mutagenesis'
    });
  }
  return conditions;
}

export function removeAffliction(state, target, key, { observed = true } = {}) {
  if (!restorableConditions(target).some(entry => entry.key === key)) throw new Error('That affliction has already ended.');
  const condition = target.conditions?.[key];
  if (key === 'sleeping') wakeCreature(target, state);
  if (key === 'bugBrain' && condition?.previousInt != null && target.stats) target.stats.INT = condition.previousInt;
  if (key === 'lycanthropy') {
    const previous = target.lycanthropy?.original || condition?.original;
    if (previous) Object.assign(target, { ancestry: previous.ancestry, alignment: previous.alignment, stats: structuredClone(previous.stats) });
  }
  if ((key === 'lifeDrain' || key === 'bloodDrain') && condition?.originalStats) {
    for (const [stat, original] of Object.entries(condition.originalStats)) target.stats[stat] = original;
  }
  if (key === 'possess' && condition?.sourceId) {
    const ghost = (state.entities || []).find(creature => creature.id === condition.sourceId);
    if (ghost?.possessingId === target.id) {
      delete ghost.possessingId;
      ghost.x = target.x; ghost.y = target.y;
      ghost.routeId = target.routeId; ghost.roomId = target.roomId;
      ghost.visible = true;
    }
  }
  if (key.startsWith('wizard:')) {
    const type = key.slice(7);
    const effect = target.wizardEffects.find(entry => entry.type === type);
    if (type === 'stat-collapse') target.stats[effect.stat] = effect.original;
    target.wizardEffects = target.wizardEffects.filter(entry => entry !== effect);
  }
  if (target.conditions) delete target.conditions[key];
  if (['charm', 'curse', 'lycanthropy'].includes(key)) delete target[key];
  if (observed && condition?.sourceId) {
    for (const observer of state.entities || []) {
      if (observer.type !== 'monster' || observer.defeated || observer.visible === false || observer.conditions?.blind ||
          Number(observer.I) <= 0 || !(Math.hypot(target.x - observer.x, target.y - observer.y) <= 12) ||
          !sameRoute(state, observer, target) || !hasLineOfSightFrom(state, observer.x, observer.y, target.x, target.y, { source: observer, target })) continue;
      observer.observedNullifiedEffects = [...new Set([...(observer.observedNullifiedEffects || []), key])];
    }
  }
  if (target.raw) {
    target.raw.conditions = structuredClone(target.conditions || {});
    if (target.stats) target.raw.stats = structuredClone(target.stats);
    target.raw.ancestry = target.ancestry;
    target.raw.alignment = target.alignment;
  }
}

export function markAfflictedTurn(actor) {
  for (const effect of Object.values(actor.conditions || {})) if (effect?.waitForFirstTurn) delete effect.waitForFirstTurn;
}

export const CONTROL_EFFECTS = ['possess', 'mindControl', 'enslave', 'soulbind', 'charm'];
export const monsterControl = creature => CONTROL_EFFECTS.map(key => creature?.conditions?.[key]).find(effect => effect?.sourceId && !effect.regardsAsFriend);
export const blockedByAffliction = creature => ['frozen', 'hypnotize', 'beguile', 'vomiting', 'stupefied', 'toxin', 'poison']
  .some(key => Boolean(creature?.conditions?.[key]));
