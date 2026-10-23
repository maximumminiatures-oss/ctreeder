const normalize = value => String(value || '').trim().toLowerCase().replace(/[-_\u2010-\u2015]/g, ' ').replace(/\s+/g, ' ');
const TRAITS = { dwarf: 'Stout', elf: 'Farsight', goblin: 'Keen Senses', halfling: 'Stealthy', 'half orc': 'Mighty', human: 'Ambitious' };
const bonusesOf = character => Array.isArray(character?.bonuses) ? character.bonuses : character?.raw?.bonuses || [];
const STAT_NAMES = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };

function humanAmbitionText(bonus) {
  const origin = normalize(`${bonus?.sourceType || ''} ${bonus?.sourceCategory || ''} ${bonus?.sourceName || ''}`);
  const name = String(bonus?.name || ''), target = String(bonus?.bonusTo || '');
  if (!/ambition/.test(origin) && !(normalize(bonus?.sourceType) === 'ancestry' && /human|ambitio/i.test(`${bonus.sourceName || ''} ${name}`))) return '';
  const statChanges = [...target.matchAll(/\b(STR|DEX|CON|INT|WIS|CHA)\s*:\s*([+-]?\d+)/gi)];
  if (statChanges.length) return statChanges.map(([, stat, amount]) => `${Number(amount) >= 0 ? '+' : ''}${Number(amount)} to ${STAT_NAMES[stat.toUpperCase()]}`).join(', ');
  if (/WeaponMastery/i.test(name) && target) return `${target} mastery`;
  if (/^Grit$/i.test(name)) return `Grit: ${bonus.bonusName || target}`;
  if (/Plus1ToHit|AttackBonus/i.test(name) && /attack/i.test(target)) return `+${Number(bonus.bonusAmount) || 1} to ${target.toLowerCase()}`;
  if (/^Spell:/i.test(name) && bonus.bonusName) return `Learn ${bonus.bonusName}`;
  if (/adv.*cast.*spell/i.test(`${name} ${bonus.bonusName || ''}`) && target) return `Advantage on casting ${target}`;
  if (/spellcasting|casting.*spells/i.test(`${name} ${bonus.bonusName || ''} ${target}`)) return `+${Number(bonus.bonusAmount) || 1} to ${target || 'spellcasting checks'}`;
  const description = String(bonus.description || '').trim();
  return description && !/\bor\b|choose|extra.*talent.*roll/i.test(description) ? description.replace(/[.]$/, '') : '';
}

export function ancestryKey(character) {
  // A copied monster appearance never grants its ancestry or removes the adventurer's inherited traits.
  if (!character || character.companion || character.summon || character.impersonation) return '';
  const form = character.transformationEffects?.find(effect => effect.spell === 'alter self' && effect.rounds > 0 && effect.originalAncestry);
  const key = normalize(form?.originalAncestry || character.ancestry || character.raw?.ancestry);
  return key === 'halforc' ? 'half orc' : Object.hasOwn(TRAITS, key) ? key : '';
}

export function isRepresentedAncestryBonus(character, bonus) {
  const key = ancestryKey(character);
  if (!key || !bonus || typeof bonus !== 'object') return false;
  const source = normalize(bonus.sourceType), name = normalize(`${bonus.name || ''} ${bonus.bonusName || ''}`);
  const fromAncestry = source === 'ancestry' || normalize(bonus.sourceName) === key;
  if (key === 'human') {
    return Boolean(humanAmbitionText(bonus)) || (fromAncestry || source === 'ambition') && /\bambitious\b|\bambition\b|extra.*talent.*roll/.test(name);
  }
  const detail = `${bonus.name || ''} ${bonus.bonusName || ''} ${bonus.bonusTo || ''}`;
  if (/adv.*cast|learn.*spell|^Spell:/i.test(detail)) return false;
  if (key === 'elf') return /far\s*sight/.test(name) || fromAncestry &&
    (/^(?:AttackBonus|Spellcasting)$/i.test(bonus.name || '') && /rang|cast/i.test(detail) ||
      Number(bonus.bonusAmount ?? bonus.bonusValue ?? bonus.value) === 1 && /rang|cast/i.test(detail) ||
      /(?:\+?1|plus1).*?(?:rang|cast)|(?:rang|cast).*?\+1/i.test(detail));
  if (key === 'half orc') return /\bmighty\b/.test(name) || fromAncestry && /melee/i.test(detail) && /attack|damage/i.test(detail);
  return fromAncestry && name.replace(/\s/g, '').includes(normalize(TRAITS[key]).replace(/\s/g, ''));
}

function farsightSelection(value) {
  const text = normalize(typeof value === 'object' ? value?.choice : value);
  const ranged = /ranged|archery/.test(text), casting = /cast|spell/.test(text);
  return ranged !== casting ? ranged ? 'ranged' : 'casting' : '';
}

export function elfFarsightChoice(character) {
  if (ancestryKey(character) !== 'elf') return '';
  const explicit = character.ancestryChoices?.farsight ?? character.farsightChoice ??
    character.raw?.ancestryChoices?.farsight ?? character.raw?.farsightChoice;
  if (explicit != null) return farsightSelection(explicit);
  const choices = new Set();
  for (const bonus of bonusesOf(character)) if (isRepresentedAncestryBonus(character, bonus)) {
    const selection = farsightSelection(`${bonus.bonusName || ''} ${bonus.bonusTo || ''} ${bonus.description || ''}`);
    if (selection) choices.add(selection);
  }
  return choices.size === 1 ? [...choices][0] : '';
}

export function ancestryAttackModifiers(character, { ranged = false } = {}) {
  const key = ancestryKey(character);
  if (key === 'half orc' && !ranged) return { attack: 1, damage: 1 };
  return { attack: key === 'elf' && ranged && elfFarsightChoice(character) === 'ranged' ? 1 : 0, damage: 0 };
}

export const ancestryCastingBonus = character => elfFarsightChoice(character) === 'casting' ? 1 : 0;
export const hasAncestryTrait = (character, name) => normalize(TRAITS[ancestryKey(character)]) === normalize(name) && Boolean(name);

export function ancestryTalents(character) {
  const key = ancestryKey(character);
  if (!key) return [];
  const choice = elfFarsightChoice(character);
  const descriptions = {
    dwarf: 'Stout +2 HP. Upon gaining a level, roll new HP with advantage.',
    elf: choice === 'ranged' ? 'Farsight: +1 to hit with ranged weapons.' : choice === 'casting' ?
      'Farsight: +1 to spellcasting checks.' : 'Farsight: choose +1 to hit with ranged weapons or spellcasting checks (choice not recorded).',
    goblin: "Keen Senses: you can't be surprised.",
    halfling: 'Stealthy: Once per day become invisible for 3 rounds.',
    'half orc': 'Mighty. +1 to attack and damage with melee weapons.',
    human: 'Ambitious: one additional talent roll at 1st level.'
  };
  const source = key === 'half orc' ? 'Half-Orc' : key[0].toUpperCase() + key.slice(1);
  if (key === 'human') {
    const choices = [...new Set(bonusesOf(character).map(humanAmbitionText).filter(Boolean))];
    const level = character.ambitionTalentLevel || character.raw?.ambitionTalentLevel;
    const description = level?.Rolled12ChosenTalentDesc || level?.talentRolledDesc;
    if (!choices.length && description && !/\bor\b|choose/i.test(description)) choices.push(String(description).replace(/[.]$/, ''));
    if (choices.length) return choices.map(text => ({ name: 'Ambitious', text: `Ambitious: ${text}.`, source }));
  }
  const tooltip = key === 'half orc' ? 'Mighty also applies to unarmed melee attacks, but not thrown attacks.' : key === 'halfling' ?
    'Activation is free in combat. Recharges after an eight-hour rest that grants benefits; attacking does not end this invisibility.' : '';
  return [{ name: TRAITS[key], text: descriptions[key], source, ...(tooltip ? { tooltip } : {}) }];
}

export const ancestryTalentRows = ancestryTalents;
