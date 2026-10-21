import { abilityScoreModifier } from './characters.js';
import { isStealthed } from './concealment.js';
import { isFloatingDisc } from './floating-disc.js';
import { sameRoute } from './underpasses.js';
import { ensureMonsterLanguages, normalizeLanguages, isAnimalMonsterName } from './monster-languages.js';
import { isSleeping } from './conditions.js';

export const monsterTraits = monster => [...(monster?.tags || []), monster?.name || '', JSON.stringify([monster?.abilities,monster?.talents])].join(' ').toLowerCase();
export const monsterModifier = (monster, ability) => Number(monster?.[ability] ?? monster?.[`**${ability === 'Ch' ? 'CH' : ability}**`] ?? 0) || 0;
export const monsterScore = (monster, ability) => Math.max(1, 10 + 2 * monsterModifier(monster, ability));
export const isAnimalMonster = monster => /\b(?:animal|beast)\b/.test((monster.tags || []).join(' ')) ||
  isAnimalMonsterName(monster);
export function automaticallyHostile(monster) {
  const traits = monsterTraits(monster), intelligence = monsterScore(monster, 'I');
  return /\bdemon\w*\b/.test(traits) || (/\b(?:devil\w*|fiend\w*|undead)\b/.test(traits) && intelligence < 10) ||
    (!isAnimalMonster(monster) && intelligence < 4);
}
export function creatureLanguages(creature, monster = false) {
  return (monster ? ensureMonsterLanguages(creature) : normalizeLanguages(creature?.languages ?? creature?.raw?.languages))
    .map(language => language.toLowerCase());
}
export function reactionSpeaker(state, monster) {
  const languages = new Set(creatureLanguages(monster, true));
  return (state.characters || []).filter(character => !character.dead && !character.slain && Number(character.hp) > 0 &&
    !isFloatingDisc(character) && !isSleeping(character, state) &&
    sameRoute(state, character, monster) && Math.hypot(character.x - monster.x, character.y - monster.y) <= 16 && creatureLanguages(character).some(language => languages.has(language)))
    .sort((a,b) => Number(b.stats?.CHA||10) - Number(a.stats?.CHA||10))[0] || null;
}
export const reactionAttitude = total => total <= 6 ? 'hostile' : total <= 8 ? 'suspicious' : total === 9 ? 'neutral' : total <= 11 ? 'curious' : 'friendly';
export function resolveReaction(state, monster, { talk = false, speaker = null, random = Math.random } = {}) {
  speaker = talk ? reactionSpeaker(state, monster) : null;
  const rolls = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)];
  const modifier = talk && speaker ? abilityScoreModifier(speaker.stats?.CHA) : 0;
  const total = rolls[0] + rolls[1] + modifier;
  monster.attitude = reactionAttitude(total); monster.attitudeChecked = true;
  monster.hostile = monster.attitude === 'hostile';
  monster.reaction = { rolls, modifier, total, speakerId: speaker?.id || null };
  if (monster.attitude === 'curious') {
    const nearest = (state.characters || []).filter(character => !isFloatingDisc(character) && !character.dead && !character.slain)
      .sort((a,b) => Math.hypot(a.x-monster.x,a.y-monster.y)-Math.hypot(b.x-monster.x,b.y-monster.y))[0];
    monster.curious = { targetId: speaker?.id || nearest?.id, remainingMs: 3600000 };
  }
  return { attitude: monster.attitude, rolls, modifier, total,
    message: `${monster.name}: 2d6 = (${rolls.join(' + ')})${modifier ? ` ${modifier >= 0 ? '+' : ''}${modifier} CHA` : ''} = ${total}; ${monster.attitude}.` };
}
export function suspiciousProvoked(state, monster, { treasure = null, actorId = null, canSee = () => true } = {}) {
  if (monster.attitude !== 'suspicious') return false;
  return (state.characters || []).some(character => !isFloatingDisc(character) && !character.dead && !character.slain && !isStealthed(character) &&
    (!actorId || character.id===actorId) &&
    canSee(monster, character) && (treasure ? canSee(monster, treasure) : Math.hypot(character.x-monster.x,character.y-monster.y) <= 3));
}

export const moraleImmune = monster => /\b(?:undead|ooze\w*|demon\w*|devil\w*|golem\w*)\b/.test(monsterTraits(monster));
export function initializeMorale(state) {
  for (const monster of state.entities || []) if (monster.type === 'monster' && !monster.morale) {
    monster.maxHp = Number(monster.maxHp) || Number.parseInt(monster.hp,10) || 1;
    monster.morale = { halfChecked: false, deathChecked: monster.defeated === true };
  }
}
export function processMorale(state, { sourceId = null, random = Math.random } = {}) {
  if (!state.combat?.active) return [];
  initializeMorale(state);
  const monsters = state.entities.filter(entity => entity.type === 'monster' && !entity.leftPeacefully);
  const events = [];
  for (const cue of monsters) {
    let trigger = false;
    if (!cue.defeated && !cue.morale.halfChecked && Number(cue.hp) < cue.maxHp/2) {cue.morale.halfChecked=true;trigger=!moraleImmune(cue);}
    const nearby = monsters.filter(monster => sameRoute(state, monster, cue) && Math.hypot(monster.x-cue.x,monster.y-cue.y)<=12);
    if (cue.defeated && !cue.morale.deathChecked) {
      cue.morale.deathChecked=true;
      const living=nearby.filter(monster=>!monster.defeated).length;
      if (nearby.length>=3 && living<nearby.length/2 && living+1>=nearby.length/2) trigger=true;
    }
    if (!trigger) continue;
    const affected=nearby.filter(monster=>!monster.defeated&&!moraleImmune(monster));
    if (!affected.length) continue;
    const modifier=Math.max(...affected.map(monster=>monsterModifier(monster,'W')));
    const roll=1+Math.floor(random()*20),total=roll+modifier;
    const caster=state.characters.find(character=>character.id===sourceId&&!isFloatingDisc(character)) || state.characters.filter(character=>!isFloatingDisc(character)&&!character.dead&&!character.slain)
      .sort((a,b)=>Math.hypot(a.x-cue.x,a.y-cue.y)-Math.hypot(b.x-cue.x,b.y-cue.y))[0];
    if (total<15 && caster) for (const monster of affected) monster.moraleFlight={casterId:caster.id,rounds:5};
    events.push({roll,modifier,total,ids:affected.map(monster=>monster.id),message:`Morale: 1d20 = (${roll}) ${modifier>=0?'+':''}${modifier} WIS = ${total} vs DC 15; ${total<15?'monsters flee':'monsters hold'}.`});
  }
  return events;
}
