import { abilityScoreModifier } from './characters.js';
import { isFloatingDisc } from './floating-disc.js';
import { isSleeping, isGaseousForm } from './conditions.js';
import { sameRoute } from './underpasses.js';
import { hasAncestryTrait } from './ancestry.js';

export const isInvisibleStalker = creature => /\binvisible stalker\b/i.test(creature?.companion?.source?.name || creature?.name || '');
export const isDuergar = creature => /\bduergar\b/i.test(creature?.name || '');
export const isInvisible = creature => isInvisibleStalker(creature) || creature?.invisible === true || Number(creature?.invisibility?.rounds) > 0;
export const isStealthed = creature => isInvisible(creature) || creature?.illusionStealthIds?.length > 0 || creature?.stealthed === true ||
  (creature?.stealthState?.attempted === true && creature.stealthState.revealed !== true);
export const isHiddenMonster = monster => monster?.stealthState?.attempted === true && monster.stealthState.revealed !== true;
export const neverSurprised = creature => {
  const monsterName = creature?.companion?.source?.name || (creature?.type === 'monster' ? creature.name : '');
  if (/hobgoblin/i.test(monsterName || '')) return false;
  return hasAncestryTrait(creature, 'Keen Senses') || /goblin/i.test(monsterName || '') ||
    Boolean(monsterName && /\bgoblin\b/i.test(creature?.ancestry || ''));
};
export const canDirectlyTarget = (target, range = 1, actor = null) => !isGaseousForm(target) &&
  (!isStealthed(target) || Boolean(actor?.magicDetectedIds?.includes(target.id)));

export function makeInvisible(creature, { rounds = 3, source = 'halfling', breakOnOffense = false } = {}) {
  creature.invisibility = { rounds, source, breakOnOffense };
  return creature.invisibility;
}
export function activateHalflingInvisibility(character) {
  if (!hasAncestryTrait(character, 'Stealthy') || character.halflingInvisibilityUsed || character.dead ||
      character.slain || character.dyingRounds > 0 || Number(character.hp) <= 0) throw new Error('Halfling invisibility is unavailable.');
  character.halflingInvisibilityUsed = true;
  makeInvisible(character);
  return `${character.name} becomes invisible for three rounds.`;
}
export function revealAfterOffense(creature) {
  if (creature.invisibility?.breakOnOffense) delete creature.invisibility;
  creature.stealthed = false;
  if (creature.stealthState) creature.stealthState.revealed = true;
  if (creature.raw) creature.raw.stealthed = false;
}
export function advanceConcealmentRounds(state, rounds = 1) {
  let changed = false;
  for (const creature of [...(state.characters || []), ...(state.entities || [])]) if (creature.invisibility) {
    creature.invisibility.rounds -= rounds;
    if (creature.invisibility.rounds <= 0) delete creature.invisibility;
    changed = true;
  }
  return changed;
}

const STEALTH_NAMES = /\b(?:bandits?|assassins?|bugbears?|goblins?|gricks?|kobolds?|panthers?|\w*rats?|shadows?|thief|thieves|vampires?|drow|elf|elves|fairy|fairies|faerie\w*|ettercaps?|\w*spiders?|stranglers?|imps?|velociraptors?|deep gnomes?)\b/i;

export const attemptsMonsterStealth = monster => !/hobgoblin/i.test(monster?.name || '') && STEALTH_NAMES.test(monster?.name || '');

export function updateMonsterStealth(state, { random = Math.random, canSee = () => true, isLit = () => true } = {}) {
  if (state.combat?.active) return;
  for (const monster of state.entities || []) {
    if (monster.type !== 'monster' || monster.defeated || monster.leftPeacefully || isSleeping(monster, state) || isInvisibleStalker(monster)) continue;
    if ((!attemptsMonsterStealth(monster) && !isDuergar(monster)) || monster.stealthState?.revealed) continue;
    if (!isLit(monster)) continue;
    const observers = (state.characters || []).filter(character => !isFloatingDisc(character) && !character.dead && !character.slain &&
      !character.conditions?.blind && !isSleeping(character, state) && Number(character.hp) > 0 &&
      sameRoute(state, character, monster) && Math.hypot(character.x - monster.x, character.y - monster.y) <= 14 && canSee(character, monster));
    if (!observers.length) continue;
    if (isDuergar(monster)) {
      if (!monster.stealthState) {
        monster.stealthState = { attempted: true, revealed: true };
        makeInvisible(monster, { rounds: 3, source: 'monster', breakOnOffense: true });
      }
      continue;
    }
    if (!monster.stealthState) {
      const roll = Math.floor(random() * 20) + 1;
      monster.stealthState = { attempted: true, roll, total: roll + (Number(monster.D ?? monster['**D**']) || 0), revealed: false };
    }
    const dc = 10 + Math.max(...observers.map(character => abilityScoreModifier(character.stats?.WIS)));
    if (!isInvisible(monster) && monster.stealthState.total < dc) monster.stealthState.revealed = true;
  }
}

export function surpriseParticipants(state, initiator) {
  const creatures = [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')];
  return creatures.filter(creature => !isFloatingDisc(creature) && !creature.dead && !creature.slain && !creature.defeated &&
    (creature.id === initiator?.id || neverSurprised(creature))).map(creature => creature.id);
}
