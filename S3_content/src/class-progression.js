import { abilityScoreModifier } from './characters.js';
import { normalizeSpellLookupKey } from './spells.js';
import { forgottenSpells } from './arcane-effects.js';

export const MAX_CHARACTER_LEVEL = 10;
export const STAT_NAMES = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };
export const GRIT_DESCRIPTIONS = {
  STR: 'Advantage for things like breaking down doors, smashing locked chests.',
  DEX: 'Advantage for things like walking narrow ledges or falling softly.'
};
export const hasGrit = (character, stat) => (character?.bonuses || []).some(bonus => /grit/i.test(bonus.name || '') &&
  new RegExp(stat === 'STR' ? 'strength|\\bSTR\\b' : 'dexterity|\\bDEX\\b', 'i').test(`${bonus.bonusName} ${bonus.description}`));
export const xpTarget = character => Math.max(1, Number(character.level) || 1) * 10;
const classes = {
  fighter: { die: 8, talents: ['mastery','attack','stat','armor'], stats: ['STR','DEX','CON'],
    titles: { lawful: ['Squire','Cavalier','Knight','Thane','Lord/Lady'], chaotic: ['Knave','Bandit','Slayer','Reaver','Warlord'], neutral: ['Warrior','Barbarian','Battlerager','Warchief','Chieftain'] } },
  priest: { die: 6, talents: ['spell-advantage','attack-choice','casting','stat'], stats: ['STR','WIS'],
    titles: { lawful: ['Acolyte','Crusader','Templar','Champion','Paladin'], chaotic: ['Initiate','Zealot','Cultist','Scourge','Chaos Knight'], neutral: ['Seeker','Invoker','Haruspex','Mystic','Oracle'] } },
  thief: { die: 4, talents: ['initiative','backstab','stat','attack'], stats: ['STR','DEX','CHA'],
    titles: { lawful: ['Footpad','Burglar','Rook','Underboss','Boss'], chaotic: ['Thug','Cutthroat','Shadow','Assassin','Wraith'], neutral: ['Robber','Outlaw','Rogue','Renegade','Bandit King/Queen'] } },
  wizard: { die: 4, talents: ['magic-item','casting-or-int','spell-advantage','extra-spell'], stats: ['INT'],
    titles: { lawful: ['Apprentice','Conjurer','Arcanist','Mage','Archmage'], chaotic: ['Adept','Channeler','Witch/Warlock','Diabolist','Sorcerer'], neutral: ['Shaman','Seer','Warden','Sage','Druid'] } }
};
const classKey = character => String(character.className || character.class || '').toLowerCase();
const clone = value => JSON.parse(JSON.stringify(value));
const die = (sides, random) => Math.floor(random() * sides) + 1;
const bonusText = character => JSON.stringify(character.bonuses || []);
const talentNames = { mastery: 'Additional Weapon Mastery', attack: '+1 melee and ranged attacks', stat: '+2 to a class stat', armor: '+1 AC with one armor type',
  'spell-advantage': 'Advantage casting one known spell', 'attack-choice': '+1 melee or ranged attacks', casting: '+1 priest spellcasting', initiative: 'Advantage on initiative',
  backstab: '+1 Backstab damage die', 'magic-item': 'Create a random magic item', 'casting-or-int': '+2 INT or +1 wizard spellcasting', 'extra-spell': 'Learn an extra wizard spell', points: '+2 points distributed among stats' };

function save(character) {
  character.raw ||= {};
  for (const field of ['level','XP','hp','maxHitPoints','title','stats','levels','bonuses','spellsKnown','advancements','gearSlotsTotal']) character.raw[field] = clone(character[field] ?? (field === 'advancements' ? [] : null));
  character.raw.xp = character.XP;
  character.raw.xpNext = xpTarget(character);
}

function addBonus(character, event, name, target, amount = 1, description = '') {
  character.bonuses ||= [];
  character.bonuses.push({ sourceType: 'Class', sourceName: character.className, sourceCategory: 'Talent', gainedAtLevel: event.level,
    name, bonusName: name, bonusTo: target, bonusAmount: amount, description, progression: true });
  const level = character.levels.find(entry => entry.level === event.level);
  if (level && !event.initial && description && !name.startsWith('Spell:')) { level.talentRolledName = name; level.talentRolledDesc = description; }
}

export function advancementButtonLabel(character) {
  const pending = character?.advancements?.find(event => !event.completed);
  return pending?.initial ? /fighter/i.test(character.className) ? 'Pick Talent' : 'Pick Spells' : 'Level Up';
}

export function initializeImportChoices(character) {
  const key = classKey(character);
  if (!['fighter','priest','wizard'].includes(key) || character.advancements?.some(event => event.initial)) return;
  character.bonuses ||= []; character.levels ||= [];
  const tasks = [], discarded = [];
  if (key === 'fighter') {
    character.bonuses = character.bonuses.filter(bonus => {
      const remove = /WeaponMastery|\bGrit\b|AdvantageOnStatChecks/i.test(`${bonus.name} ${bonus.bonusName} ${bonus.bonusTo}`);
      if (remove) discarded.push(bonus); return !remove;
    });
    tasks.push({ id: 'mastery', type: 'mastery', grantWeapon: true }, { id: 'grit', type: 'grit' });
    const extraMasteries = discarded.filter(bonus => /WeaponMastery/i.test(bonus.name || '')).length - 1;
    for (let index = 0; index < extraMasteries; index++) tasks.push({ id: `extra-mastery-${index + 1}`, type: 'mastery', grantWeapon: true });
  } else {
    const spellChoiceTalent = character.bonuses.some(bonus => /adv.*cast.*spell/i.test(`${bonus.name} ${bonus.bonusName}`));
    const extraSpellTalent = character.levels.some(level => /learn.*(?:extra|additional).*spell/i.test(`${level.talentRolledName} ${level.talentRolledDesc}`));
    character.bonuses = character.bonuses.filter(bonus => {
      const text = `${bonus.name} ${bonus.bonusName} ${bonus.bonusTo}`;
      const remove = /^Spell:/i.test(bonus.name || '') || /Tier:\s*\d.*Spell:/i.test(bonus.bonusTo || '') ||
        /adv.*cast.*spell|learn.*extra.*spell/i.test(text);
      if (remove) discarded.push(bonus); return !remove;
    });
    character.spellsKnown = key === 'priest' ? 'Turn Undead' : '';
    character.learnedScrollSpells = [];
    tasks.push({ id: 'spell-1', type: 'spell', tier: 1 }, { id: 'spell-2', type: 'spell', tier: 1 });
    if (extraSpellTalent) tasks.push({ id: 'extra-spell', type: 'extra-spell', tier: 1 });
    if (spellChoiceTalent) tasks.push({ id: 'spell-advantage', type: 'spell-advantage' });
  }
  for (const level of character.levels) {
    const text = `${level.talentRolledName} ${level.talentRolledDesc}`;
    if (discarded.some(bonus => /Spell:|WeaponMastery|Grit|AdvantageOnStatChecks|adv.*cast.*spell/i.test(`${bonus.name} ${bonus.bonusTo}`)) &&
      /weapon.*mastery|\bgrit\b|adv.*cast.*spell|learn.*(?:extra|additional).*spell/i.test(text)) {
      level.talentRolledName = ''; level.talentRolledDesc = '';
      level.Rolled12ChosenTalentDesc = ''; level.Rolled12ChosenTalentName = '';
    }
  }
  character.advancements ||= [];
  character.advancements.unshift({ id: 'initial', initial: true, level: 1, hpRolls: [], hpGain: 0, tasks, completed: false });
  character.raw ||= {}; character.raw.learnedScrollSpells = []; delete character.raw.spells;
  save(character);
}

function talentForRoll(key, roll) {
  if (roll === 12) return 'wild';
  if (key === 'fighter') return roll === 2 ? 'mastery' : roll <= 6 ? 'attack' : roll <= 9 ? 'stat' : 'armor';
  if (key === 'priest') return roll === 2 ? 'spell-advantage' : roll <= 6 ? 'attack-choice' : roll <= 9 ? 'casting' : 'stat';
  if (key === 'thief') return roll === 2 ? 'initiative' : roll <= 5 ? 'backstab' : roll <= 9 ? 'stat' : 'attack';
  return roll === 2 ? 'magic-item' : roll <= 7 ? 'casting-or-int' : roll <= 9 ? 'spell-advantage' : 'extra-spell';
}

export function canLevelUp(character) {
  return Boolean(character && classes[classKey(character)] && !character.companion && !character.summon && !character.dead && !character.slain &&
    (Number(character.level) || 1) < MAX_CHARACTER_LEVEL && Number(character.XP) >= xpTarget(character) &&
    !character.advancements?.some(event => !event.completed));
}

export function awardExperience(character, amount) {
  if (!classes[classKey(character)] || character.companion || character.summon || character.dead || character.slain) return false;
  character.XP = Math.max(0, Number(character.XP) || 0) + Math.max(0, Math.floor(Number(amount) || 0));
  save(character);
  return canLevelUp(character);
}

export function beginLevelUp(character, { random = Math.random } = {}) {
  const key = classKey(character), config = classes[key];
  if (!canLevelUp(character)) throw new Error('This character has no new level available. Finish any pending choices first.');
  character.level = Math.max(1, Number(character.level) || 1);
  character.advancements ||= []; character.levels ||= []; character.bonuses ||= [];
  const events = [];
  if (character.level < MAX_CHARACTER_LEVEL && character.XP >= xpTarget(character)) {
    character.XP -= xpTarget(character); character.level++;
    const hpRolls = [die(config.die, random)];
    if (/\bdwarf\b/i.test(character.ancestry)) hpRolls.push(die(config.die, random));
    const hpGain = Math.max(1, Math.max(...hpRolls) + abilityScoreModifier(character.stats?.CON));
    character.maxHitPoints += hpGain;
    if (Number(character.hp) > 0) character.hp += hpGain;
    character.title = config.titles[String(character.alignment || 'neutral').toLowerCase()]?.[Math.floor((character.level - 1) / 2)] || character.title;
    const event = { id: `level-${character.level}`, level: character.level, hpRolls, hpGain, conModifier: abilityScoreModifier(character.stats?.CON), tasks: [], completed: false };
    const level = { level: character.level, HitPointRoll: Math.max(...hpRolls), stoutHitPointRoll: hpRolls[1] || 0, talentRolledName: '', talentRolledDesc: '', progression: true };
    character.levels.push(level);
    if (character.level % 2 === 1) {
      let rolled;
      for (let attempt = 0; attempt < 32; attempt++) {
        const rolls = [die(6, random), die(6, random)];
        rolled = { rolls, total: rolls[0] + rolls[1] };
        if (!(key === 'thief' && rolled.total === 2 && /initiative/i.test(bonusText(character)))) break;
      }
      const type = key === 'thief' && rolled.total === 2 && /initiative/i.test(bonusText(character)) ? 'backstab' : talentForRoll(key, rolled.total);
      event.talentRoll = rolled;
      event.tasks.push({ id: 'talent', type });
    }
    if (key === 'wizard' || key === 'priest') {
      const count = 1;
      for (let index = 0; index < count; index++) event.tasks.push({ id: index ? `spell-${index + 1}` : 'spell', type: 'spell', tier: Math.min(5, Math.floor((character.level + 1) / 2)) });
    }
    character.advancements.push(event); events.push(event);
    resolveAutomaticTalents(character, event);
  }
  save(character);
  return events[0];
}

function resolveAutomaticTalents(character, event) {
  const task = event.tasks.find(entry => entry.id === 'talent' && !entry.done);
  if (task?.type === 'attack') { addBonus(character,event,'Plus1ToHit','Melee and ranged attacks',1,'+1 to melee and ranged attacks'); task.done = true; }
  if (task?.type === 'casting') { addBonus(character,event,'PriestSpellcasting','priest spellcasting checks',1,'+1 to priest spellcasting checks'); task.done = true; }
  if (task?.type === 'backstab') { addBonus(character,event,'BackstabIncrease','Backstab increase',1,'Backstab increase: +1 damage die'); task.done = true; }
  if (task?.type === 'initiative') { addBonus(character,event,'InitiativeAdvantage','Initiative',1,'Advantage on initiative'); task.done = true; }
  event.completed = event.tasks.every(entry => entry.done);
}

function knownNames(character) {
  return new Set([String(character.spellsKnown || '').split(/,\s*/), character.learnedScrollSpells || [], classKey(character) === 'priest' ? ['Turn Undead'] : [],
    (character.bonuses || []).filter(bonus => /spell:/i.test(bonus.name || '')).map(bonus => bonus.bonusName)].flat().filter(Boolean).map(normalizeSpellLookupKey));
}

export function advancementOptions(character, event, task, { spells = [], weapons = [] } = {}) {
  const key = classKey(character), known = knownNames(character), config = classes[key];
  const options = values => values.map(value => ({ value, label: value }));
  if (task.type === 'wild') return [...config.talents.filter(type => type !== 'stat'), 'points','talents']
    .filter(type => type !== 'initiative' || !/initiative/i.test(bonusText(character)))
    .map(type => ({ value: type, label: type === 'talents' ? 'Pick a talent' : talentNames[type] }));
  if (task.type === 'stat') return options(config.stats).map(option => ({ ...option, label: STAT_NAMES[option.value] }));
  if (task.type === 'points') return options(Object.keys(STAT_NAMES)).map(option => ({ ...option, label: STAT_NAMES[option.value] }));
  if (task.type === 'mastery') {
    const existing = (character.bonuses || []).filter(bonus => /WeaponMastery/i.test(bonus.name || '')).map(bonus => String(bonus.bonusTo).toLowerCase());
    return options(weapons.map(weapon => weapon.name).filter(name => !existing.includes(name.toLowerCase())));
  }
  if (task.type === 'armor') return options(['Light','Medium','Heavy','Shield']);
  if (task.type === 'grit') return [{ value: 'STR', label: 'Strength' }, { value: 'DEX', label: 'Dexterity' }];
  if (task.type === 'attack-choice') return options(['Melee','Ranged']);
  if (task.type === 'casting-or-int') return [{ value: 'INT', label: '+2 Intelligence' }, { value: 'casting', label: '+1 wizard spellcasting' }];
  if (task.type === 'magic-item') return options(['weapon','armor','wand','potion','scroll']);
  if (['spell','extra-spell','spell-advantage'].includes(task.type)) {
    return spells.filter(spell => !forgottenSpells(character).has(normalizeSpellLookupKey(spell.name)) && spell.classes?.includes(key) && (task.type === 'spell-advantage' ? known.has(normalizeSpellLookupKey(spell.name)) &&
      !(character.bonuses || []).some(bonus => bonus.name === 'AdvantageOnSpellcasting' && normalizeSpellLookupKey(bonus.bonusTo) === normalizeSpellLookupKey(spell.name)) :
      !known.has(normalizeSpellLookupKey(spell.name)) && (task.type === 'spell' ? spell.tier === task.tier : spell.tier <= Math.min(5, Math.ceil(event.level / 2)))))
      .sort((a,b) => a.tier-b.tier || a.name.localeCompare(b.name)).map(spell => ({ value: spell.name, label: `Tier ${spell.tier}: ${spell.name}` }));
  }
  return [];
}

export function resolveAdvancement(character, eventId, taskId, value, context = {}) {
  const event = character.advancements?.find(entry => entry.id === eventId && !entry.completed);
  const task = event?.tasks.find(entry => entry.id === taskId && !entry.done);
  if (!event || event !== character.advancements.find(entry => !entry.completed) || !task || !advancementOptions(character,event,task,context).some(option => option.value === value)) throw new Error('Choose a valid pending level-up option.');
  if (task.type === 'wild') {
    if (value === 'talents') task.mode = 'talents';
    else { task.fromWild = true; task.type = value; if (value === 'points') task.remaining = 2; resolveAutomaticTalents(character,event); }
    save(character); return {};
  }
  let createdItem = null;
  if (task.type === 'stat' || task.type === 'points' || task.type === 'casting-or-int' && value === 'INT') {
    const stats = task.type === 'points' ? [value] : [value,value];
    const oldCapacity = Math.max(10, Number(character.stats.STR) || 10) + (classKey(character) === 'fighter' ? Math.max(0, abilityScoreModifier(character.stats.CON)) : 0);
    for (const stat of stats) character.stats[stat] = Math.min(99, (Number(character.stats[stat]) || 10) + 1);
    const newCapacity = Math.max(10, Number(character.stats.STR) || 10) + (classKey(character) === 'fighter' ? Math.max(0, abilityScoreModifier(character.stats.CON)) : 0);
    character.gearSlotsTotal = Math.max(10, (Number(character.gearSlotsTotal) || oldCapacity) + newCapacity - oldCapacity);
    if (stats.includes('CON')) for (const advancement of character.advancements.filter(entry => entry.level >= event.level)) {
      const modifier = abilityScoreModifier(character.stats.CON);
      const gain = Math.max(1, Math.max(...advancement.hpRolls) + modifier);
      character.maxHitPoints += gain - advancement.hpGain;
      if (Number(character.hp) > 0) character.hp += gain - advancement.hpGain;
      advancement.hpGain = gain; advancement.conModifier = modifier;
    }
    addBonus(character,event,'StatBonus',stats.map(stat => `${stat}:+1`).join(', '),stats.length,stats.length === 1 ? `+1 ${stats[0]}` : stats[0] === stats[1] ? `+2 ${stats[0]}` : `+1 ${stats.join(', +1 ')}`);
    if (task.type === 'points') {
      task.remaining = (task.remaining ?? 2) - 1;
      if (task.remaining > 0) { save(character); return {}; }
    }
  } else if (task.type === 'mastery') {
    addBonus(character,event,'WeaponMastery',value,1,`${value} mastery`);
    if (task.grantWeapon) createdItem = { ...clone(context.weapons.find(item => item.name === value)), type: 'weapon', quantity: 1, totalUnits: 1, equipped: false };
  }
  else if (task.type === 'grit') addBonus(character,event,'Grit','AdvantageOnStatChecks',1,`Grit: ${STAT_NAMES[value]}`);
  else if (task.type === 'armor') addBonus(character,event,'ArmorMastery',value,1,`Armor mastery: +1 AC with ${value}`);
  else if (task.type === 'attack-choice') addBonus(character,event,'AttackBonus',`${value} attacks`,1,`+1 to ${value.toLowerCase()} attacks`);
  else if (task.type === 'casting-or-int') addBonus(character,event,'WizardSpellcasting','wizard spellcasting checks',1,'+1 to wizard spellcasting checks');
  else if (task.type === 'spell-advantage') addBonus(character,event,'AdvantageOnSpellcasting',value,1,`Gain advantage on casting ${value}`);
  else if (task.type === 'spell' || task.type === 'extra-spell') {
    const spell = context.spells.find(entry => entry.name === value);
    const names = String(character.spellsKnown || '').split(/,\s*/).filter(name => name && name !== 'None');
    character.spellsKnown = [...new Set([...names,value])].join(', ');
    addBonus(character,event,`Spell: ${character.className}, Tier ${spell.tier}, Level ${event.level}`,value,1,`Learn ${value}`);
    character.bonuses.at(-1).bonusName = value;
  } else if (task.type === 'magic-item') {
    if (context.createMagicItem) createdItem = context.createMagicItem(value, character);
    else {
    const catalog = context.magicItems?.filter(entry => entry.item.magic?.kind === value) || [];
    if (!catalog.length) throw new Error('No magic items of that type are available.');
    const random = context.random || Math.random;
    const total = catalog.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = random() * total;
    createdItem = clone(catalog.find(entry => (roll -= entry.weight) < 0)?.item || catalog.at(-1).item);
    }
    addBonus(character,event,'CreateMagicItem',value,1,`Created a magic ${value}`);
  }
  task.done = true; task.choice = value; event.completed = event.tasks.every(entry => entry.done);
  if (task.type === 'grit') character.bonuses.at(-1).bonusName = STAT_NAMES[value];
  save(character);
  return { createdItem };
}

export function classAttackBonus(character, ranged) {
  const entries = (character.bonuses || []).filter(bonus => /^(?:Plus1ToHit|AttackBonus)$/i.test(bonus.name || ''));
  return entries.reduce((total, bonus) => total + (/melee and ranged/i.test(bonus.bonusTo) || new RegExp(ranged ? 'ranged' : 'melee','i').test(bonus.bonusTo) ? Number(bonus.bonusAmount) || 1 : 0), 0);
}

export function masteryTargets(character) {
  return (character.bonuses || []).filter(bonus => /WeaponMastery/i.test(bonus.name || '')).map(bonus => String(bonus.bonusTo).toLowerCase());
}

export function classArmorBonus(character, armor, baseAc = null) {
  const category = armor === 'shield' ? 'shield' : baseAc >= 15 ? 'heavy' : baseAc >= 13 ? 'medium' : baseAc >= 11 ? 'light' : '';
  return (character.bonuses || []).filter(bonus => /ArmorMastery/i.test(bonus.name || '') &&
    (String(bonus.bonusTo).toLowerCase() === category || String(bonus.bonusTo).toLowerCase().includes(armor))).reduce((sum, bonus) => sum + (Number(bonus.bonusAmount) || 1), 0);
}
