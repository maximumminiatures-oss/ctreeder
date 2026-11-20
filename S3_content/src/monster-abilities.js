import {SEA_MONSTER_ABILITIES,seaAbilityAvailable,applySeaMonsterAbility} from './sea-monster-abilities.js';
import {quenchImmersedEffects} from './water-rules.js';
import {elementalSaveOptions} from './elemental-effects.js';
import { applyBloodDrain, isVampire } from './supernatural-traits.js';
import { abilityScoreModifier } from './characters.js';
import { rollCheck } from './interactions.js';
import { removeAffliction, restorableConditions } from './creature-afflictions.js';
import { circleBlocksHostileAction, circleBlocksMentalControl } from './magic-circle.js';

const names = {
  'brain eater': [
    ['mindControl', 'Mind Control', 6, 'CHA', 15, 4],
    ['mindBlast', 'Mind Blast', 6, 'INT', 15, 4, { area: true, damage: [3,6], condition: 'paralyzed' }]
  ],
  aboleth: [['enslave', 'Enslave', 12, 'WIS', 15, 4]],
  ghost: [['possess', 'Possess', 1, 'CHA', 0, 0]],
  archdevil: [['soulbind', 'Soulbind', 6, 'CHA', 20, 4, { area: true }]],
  cubi: [['charm', 'Charm', 6, 'CHA', 15, 0, { hours: 6, humanoid: true }]],
  vampire: [['charm', 'Charm', 6, 'CHA', 15, 0, { hours: 24, humanoid: true }]],
  cloaker: [['screech', 'Screech', 12, 'WIS', 15, 4, { area: true }]],
  'demon, vrock': [['screech', 'Screech', 12, 'WIS', 12, 4, { area: true }]],
  'night hag': [['blind', 'Blind', 6, 'CHA', 15, 0, { hours: 96 }]],
  'weald hag': [['drinkPain', 'Drink Pain', 6, 'CHA', 12, 0, { damage: [2,4], heal: true }]],
  harpy: [['harpySong', 'Song', 12, 'CHA', 12, 4, { area: true, audible: true }]],
  'dragon, frost': [['frozen', 'Ice Breath', 12, 'DEX', 15, 0, { area: true, damage: [4,8], turns: 1 }]],
  apprentice: [
    ['beguile', 'Beguile', 6, '', 0, 0, { spell: 'INT', dc: 11, focus: true, maxLevel: 2 }],
    ['magicBolt', 'Magic Bolt', 12, '', 0, 0, { spell: 'INT', dc: 11, damage: [1,4] }]
  ],
  'goblin shaman': [
    ['bugBrain', 'Bug Brain', 6, '', 0, 4, { spell: 'WIS', dc: 13 }],
    ['stinkBomb', 'Stink Bomb', 12, 'CON', 12, 0, { spell: 'WIS', dc: 12, damage: [2,4], damageOnSave: true }]
  ],
  naga: [
    ['hypnotize', 'Hypnotize', 6, '', 0, 0, { spell: 'CHA', dc: 13, focus: true }],
    ['agony', 'Agony', 6, '', 0, 0, { spell: 'CHA', dc: 14, damage: [3,8] }]
  ]
};
const nativeStats = { STR: 'S', DEX: 'D', CON: 'C', WIS: 'W', INT: 'I', CHA: 'Ch' };
const doesNotAct = new Set(['drinkPain', 'agony', 'magicBolt', 'boilWater']);
const controls = new Set(['possess', 'mindControl', 'enslave', 'soulbind', 'charm', 'hypnotize', 'beguile', 'harpySong']);
export const monsterAbilityDefinitions = monster => SEA_MONSTER_ABILITIES[String(monster?.name||'').toLowerCase()] || names[String(monster?.waterBaseName||monster?.name||'').toLowerCase()] || [];
const nativeModifier = (actor, stat) => actor.stats ? abilityScoreModifier(actor.stats[stat]) : Number(actor[nativeStats[stat]] || 0);
const fromUndead = creature => creature?.tags?.some(tag => String(tag).toLowerCase() === 'undead') ||
  isVampire(creature) || /^ghost$/i.test(creature?.name || '') || creature?.companion?.kind === 'animate-dead';
const d = sides => Math.floor(Math.random() * sides) + 1;
const rollDamage = ([count, sides],random=Math.random) => Array.from({ length: count }, () => Math.floor(random()*sides)+1).reduce((sum, roll) => sum + roll, 0);

export function inflictMonsterCondition(target, key, source, fields = {}) {
  if (isVampire(target) && (['poison', 'toxin'].includes(key) || fromUndead(source))) return false;
  target.conditions ||= {};
  if (target.conditions[key]) return false;
  target.conditions[key] = { sourceId: source.id, ...fields };
  if (fields.rounds != null && key !== 'gibbering') target.conditions[key].waitForFirstTurn = true;
  return true;
}

export function availableMonsterAbility(monster, entry, target, state = null) {
  const [id, , , , , , options = {}] = entry;
  return (!options.sea || state&&seaAbilityAvailable(state,monster,entry)) && !monster.failedMonsterSpells?.includes(id) &&
    !(target.conditions?.[options.condition || id] && !options.damage) &&
    !(Number(monster.I) > 0 && monster.observedNullifiedEffects?.includes(options.condition || id) && !options.damage) &&
    (options.maxLevel == null || Number(target.level || 1) <= options.maxLevel) &&
    (!options.humanoid || target.type !== 'monster' || target.tags?.includes('humanoid')) &&
    (!options.audible || !target.conditions?.deaf && !target.conditions?.deafened);
}

export function castMonsterAbility(state, monster, entry, targets, { harm, check = rollCheck, catalog = [], random = Math.random } = {}) {
  const [id, title, , savingStat, dc, duration, options = {}] = entry;
  if(options.sea&&!seaAbilityAvailable(state,monster,entry))throw Error("That ability has no valid placement or is already active.");
  if (options.spell) {
    const casting = check(options.castingBonus ?? nativeModifier(monster, options.spell));
    if (casting.roll === 1 || casting.roll !== 20 && casting.total < options.dc) {
      monster.failedMonsterSpells = [...new Set([...(monster.failedMonsterSpells || []), id])];
      return monster.name + ' fails to cast ' + title + '.';
    }
  }
  if(options.sea)return applySeaMonsterAbility(state,monster,entry,{catalog,random});
  const affected = [];
  for (const target of targets) {
    if (isVampire(target) && fromUndead(monster) || circleBlocksHostileAction(state, monster, target) ||
        controls.has(id) && circleBlocksMentalControl(state, monster, target)) continue;
    const difficulty = id === 'possess' ? check(nativeModifier(monster, 'CHA')).total : dc;
    const failed = !savingStat || check(nativeModifier(target, savingStat),elementalSaveOptions(target,options.damageType||title,{state})).total < difficulty;
    if (options.damage && (failed || options.damageOnSave)) {
      const dealt = harm?.(target, rollDamage(options.damage,random), { spell: Boolean(options.spell), damageSource: options.damageType || (id === 'frozen' ? 'cold' : '') }) || 0;
      if (options.heal) monster.hp = Math.min(Number(monster.maxHp || monster.hp), monster.hp + dealt);
      if(id==="boilWater"){affected.push(target.name+" for "+dealt+" fire damage");continue;}
    }
    if (id === 'harpySong' && !failed) {
      target.conditions ||= {};
      (target.conditions.harpySongImmunity ||= {})[monster.id] = (state.arcaneTime?.elapsedMs || 0) + 86400000;
    }
    if (!failed || Number(target.hp) <= 0) continue;
    if (doesNotAct.has(id)) { affected.push(target.name); continue; }
    const key = options.condition || id;
    const rounds = id === 'possess' ? d(4) + d(4) : options.turns ?? (duration ? d(duration) : null);
    const milliseconds = options.hours ? (options.hours === 96 ? d(4) * 24 : options.hours === 24 ? 24 : d(options.hours)) * 3600000 : null;
    if (!inflictMonsterCondition(target, key, monster, { rounds, milliseconds, magical: Boolean(options.spell) || controls.has(id),
        focus: options.focus ? { dc: options.dc, stat: options.spell } : null, ...(id === 'soulbind' ? { saveEachTurn: 20 } : {}) })) continue;
    if (id === 'bugBrain' && target.stats) {
      target.conditions.bugBrain.previousInt = target.stats.INT;
      target.stats.INT = 1;
    }
    if (id === 'possess') {
      monster.possessingId = target.id;
      monster.visible = false;
    }
    affected.push(target.name);
  }
  return monster.name + ' uses ' + title + (affected.length ? ' on ' + affected.join(', ') : '') + '.';
}

export function applyMonsterStrikeEffect(state, source, target, attack, { harm, check = rollCheck } = {}) {
  if (isVampire(target) && fromUndead(source)) return null;
  const text = String(attack.segment || attack.name || '').toLowerCase();
  const talents = (source.talents || []).join(' ');
  if (/\bnecrosis\b/.test(text) && check(nativeModifier(target, 'CON')).total < 15) {
    if (inflictMonsterCondition(target, 'necrosis', source, { magical: true })) harm(target, target.hp);
  }
  if (!isVampire(target) && /\btoxin\b/.test(text) && check(nativeModifier(target, 'CON')).total < Number(talents.match(/Toxin\. DC (\d+) CON/i)?.[1] || 12)) {
    inflictMonsterCondition(target, /unconscious/i.test(talents) ? 'stupefied' : 'toxin', source, { rounds: d(4) });
  }
  if (/\bparalyze|\bpoison\b/.test(text) && check(nativeModifier(target, 'CON')).total < (/naga/i.test(source.name) ? 15 : 12)) {
    inflictMonsterCondition(target, /poison/.test(text) ? 'poison' : 'paralyzed', source, { rounds: d(4) });
  }
  if (/\bhellfire\b/.test(text) && check(nativeModifier(target, 'DEX'),elementalSaveOptions(target,'fire',{state})).total < 18) {
    inflictMonsterCondition(target, 'hellfire', source, { magical: true });
    quenchImmersedEffects(state,target);
  }
  if (/blood drain/.test(text)) return applyBloodDrain(source, target);
  const drain = /life drain/.test(text) ? 'lifeDrain' : /cubi/i.test(source.name) && /\bdrain\b/.test(text) ? 'lifeDrain' : null;
  if (drain && target.stats) {
    const stat = /cubi/i.test(source.name) ? 'WIS' : 'CON';
    inflictMonsterCondition(target, drain, source, { originalStats: { [stat]: target.stats[stat] }, magical: true });
    target.stats[stat] = Math.max(0, target.stats[stat] - d(stat === 'WIS' ? 6 : 4));
    if (!target.stats[stat]) harm(target, target.hp);
  }
  if (/^aboleth$/i.test(source.name) && /\bcurse\b/.test(text) && check(nativeModifier(target, 'CON')).total < 15) {
    inflictMonsterCondition(target, 'curse', source, { milliseconds: (d(10) + d(10)) * 86400000, magical: true });
  }
}

export function triggerCarrionMist(state, vrock, canReach, check = rollCheck) {
  if (!/^demon, vrock$/i.test(vrock.name || '') || d(6) > 3) return false;
  for (const target of state.characters) {
    if (target.hp > 0 && canReach(target) && check(nativeModifier(target, 'CON')).total < 15) {
      inflictMonsterCondition(target, 'vomiting', vrock, { rounds: d(4) });
    }
  }
  return true;
}

export function advanceMonsterAfflictions(state, { rounds, milliseconds, harm }) {
  let changed = false;
  const creatures = [...(state.characters || []), ...(state.entities || [])];
  for (const target of creatures) {
    changed=quenchImmersedEffects(state,target)||changed;
    for (const [key, effect] of Object.entries(target.conditions || {})) {
      if (!effect?.sourceId || !restorableConditions(target).some(entry => entry.key === key)) continue;
      const source = creatures.find(creature => creature.id === effect.sourceId);
      if (effect.rounds != null && (!state.combat?.active || !effect.waitForFirstTurn)) {
        effect.rounds -= rounds;
        changed ||= rounds > 0;
      }
      if (effect.milliseconds != null) { effect.milliseconds -= milliseconds; changed ||= milliseconds > 0; }
      if (key === 'hellfire' && rounds > 0 && target.hp > 0) harm(target, Array.from({ length: rounds }, () => d(8) + d(8)).reduce((a,b) => a+b), { damageSource: 'fire' });
      if (effect.focus && (!source || source.hp <= 0 || source.defeated || source.dead ||
          rounds > 0 && rollCheck(nativeModifier(source, effect.focus.stat)).total < effect.focus.dc) ||
          effect.rounds != null && effect.rounds <= 0 || effect.milliseconds != null && effect.milliseconds <= 0 ||
          key === 'possess' && target.hp <= 0) {
        if (key === 'harpySong' && target.conditions.harpySong) target.conditions.harpySongEnded = true;
        removeAffliction(state, target, key, { observed: false });
        changed = true;
      }
    }
  }
  return changed;
}
