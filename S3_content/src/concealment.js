import { abilityScoreModifier } from './characters.js';
import { isFloatingDisc } from './floating-disc.js';
import { isSleeping } from './conditions.js';
import { sameRoute } from './underpasses.js';
import { hasAncestryTrait } from './ancestry.js';

export const isInvisible = creature => creature?.invisible === true || Number(creature?.invisibility?.rounds) > 0;
export const isStealthed = creature => isInvisible(creature) || creature?.stealthed === true ||
  (creature?.stealthState?.attempted === true && creature.stealthState.revealed !== true);
export const isHiddenMonster = monster => monster?.stealthState?.attempted === true && monster.stealthState.revealed !== true;
export const neverSurprised = creature => hasAncestryTrait(creature, 'Keen Senses') ||
  (creature?.type === 'monster' || creature?.companion) && /\bgoblin\b/i.test(creature?.ancestry || '') ||
  /goblin/i.test(creature?.name || '') || /(?:never (?:be )?|can['’]?t be |cannot be )surprised/i.test(JSON.stringify(creature?.abilities || {}));
export const canDirectlyTarget = (target, range = 1, actor = null) => !isInvisible(target) || Number(range) <= Math.SQRT2 || Boolean(actor?.magicDetectedIds?.includes(target.id));

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

const STEALTH_NAMES = /\b(?:bandit\w*|assassin\w*|bugbear\w*|\w*goblin\w*|grick\w*|kobold\w*|panther\w*|rat\w*|shadow\w*|thief|thieves|vampire\w*|viperian\w*|drow|drider\w*|duergar|elf|elves|faerie\w*|ettercap\w*)\b/i;
export const attemptsMonsterStealth = monster => STEALTH_NAMES.test(monster?.name || '') ||
  /spider|stealth|surprise|undetected|sneak|\bhide\b|invisib/i.test(JSON.stringify([monster?.name,monster?.description,monster?.abilities,monster?.talents]));

export function updateMonsterStealth(state, { random = Math.random } = {}) {
  for (const monster of state.entities || []) {
    if (monster.type !== 'monster' || monster.defeated || monster.leftPeacefully || isSleeping(monster, state) || !attemptsMonsterStealth(monster)) continue;
    const nearby = (state.characters || []).filter(character => !isFloatingDisc(character) && !character.dead && !character.slain && !isSleeping(character, state) &&
      Number(character.hp) > 0 && sameRoute(state, character, monster) && Math.hypot(character.x - monster.x, character.y - monster.y) <= 14);
    if (!monster.stealthState && nearby.some(character => !isStealthed(character))) {
      const roll = Math.floor(random() * 20) + 1;
      monster.stealthState = { attempted: true, roll, total: roll + (Number(monster.D ?? monster['**D**']) || 0), revealed: false };
      if (/invisib/i.test(JSON.stringify([monster.abilities,monster.talents]))) {
        makeInvisible(monster,{rounds:3,source:'monster',breakOnOffense:true});
      }
    }
    if (!monster.stealthState || monster.stealthState.revealed || isInvisible(monster)) continue;
    if (nearby.some(character => 10 + abilityScoreModifier(character.stats?.WIS) >= monster.stealthState.total)) monster.stealthState.revealed = true;
  }
}

export function surpriseParticipants(state, initiator, { forcedSurprisedIds = [] } = {}) {
  const excluded = new Set(forcedSurprisedIds);
  const creatures = [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')];
  return creatures.filter(creature => !isFloatingDisc(creature) && !creature.dead && !creature.slain && !creature.defeated &&
    (creature.id === initiator?.id || neverSurprised(creature) || (!excluded.has(creature.id) && isStealthed(creature)))).map(creature => creature.id);
}
