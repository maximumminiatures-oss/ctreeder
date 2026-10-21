import { sheetLore } from './sheet-lore.js';

// User-reviewed sheet copy; existing deity and alignment lore stays intact.
const normalize = value => String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLowerCase().replace(/['\u2018\u2019]/g, '').replace(/[_\-/&]+/g, ' ').trim().replace(/\s+/g, ' ');
const lookup = (table, key) => Object.hasOwn(table, key) ? table[key] : '';

const ABILITIES = Object.freeze({
  STR: 'Strength: Used to climb, swim, shove, destroy things and for melee and thrown attacks. Adds gear slots.',
  DEX: 'Dexterity: Crucial for most thief skills, ranged attacks, stabbing with daggers, armor class, and dodging traps, fireballs and other nasty things.',
  CON: 'Constitution: Resilience against poison, exhaustion, and injury; adds to hit points and not dying from dropping to 0 HP.',
  INT: 'Intelligence: Governs wizard spellcasting, deciphering runes, and learning spells.',
  WIS: 'Wisdom: Awareness and intuition; governs priest spellcasting and searching for traps and stealthy monsters.',
  CHA: 'Charisma: Befriend strangers and resist attempts to control your mind.'
});
const ABILITY_KEYS = Object.freeze({ str: 'STR', strength: 'STR', dex: 'DEX', dexterity: 'DEX', con: 'CON', constitution: 'CON',
  int: 'INT', intelligence: 'INT', wis: 'WIS', wisdom: 'WIS', cha: 'CHA', charisma: 'CHA' });

const ANCESTRIES = Object.freeze({
  dwarf: 'Stalwart mountain folk. Ancient enemy of elves, goblins and orcs.',
  elf: 'Long-lived seekers of beauty and knowledge;  acclaimed archers and wizards. Ancient enemies of dwarves, goblins and orcs.',
  goblin: 'small scrappy folk; survivors. Ancient enemies of humans, elves, and dwarves. Allies of orcs. Large eyes, ears and noses keep them aware.',
  halfling: 'Cheerful smallfolk that love cooking and eating. Their padded furry feet are so quiet that they can almost vanish for short periods of time.',
  'half orc': 'Brutish ancient foes of elves, dwarves, and humans, they are cunning with blades and other melee weapons. Allies of goblins.',
  human: 'It is said to be the age of humankind, their adaptability has caused their ascendance and mistrust by many monsters and other ancestries.'
});
const CLASSES = Object.freeze({
  fighter: 'A warrior who uses physical prowess, and trains with weapons and armor.',
  priest: 'Divine spellcaster serving a deity; uses Wisdom, armor, shields, and sacred power to turn undead.',
  thief: 'Stealth and trap specialist with Backstab; excels at climbing, disguises, locks, and other delicate tasks.',
  wizard: 'Intelligence-based arcane spellcaster who studies scrolls; wields daggers and staves, but lacks armor training.'
});
const BACKGROUNDS = Object.freeze({
  urchin: 'A harsh urban childhood taught you survival among crowded streets and overlooked people.',
  wanted: 'Pursuers seek your capture, while sympathetic contacts may offer shelter or aid.',
  'cult initiate': 'Your former devotion exposed you to forbidden worship and unsettling ceremonial knowledge.',
  'thieves guild': 'Criminal associates can provide information and favors, though old obligations may follow you.',
  banished: 'Exile separated you from your community after accusations against you.',
  orphaned: 'An unexpected protector raised you after the loss of your family.',
  'wizards apprentice': 'Early magical training gave you practical familiarity with arcane workings.',
  jeweler: 'Experience with precious objects helps you judge craftsmanship, authenticity, and worth.',
  herbalist: 'You recognize useful plants and understand their healing or poisonous properties.',
  barbarian: 'Life among a roaming horde left you with enduring customs and hard-earned instincts.',
  mercenary: 'Paid fighting taught you warfare without depending on loyalty to one side.',
  sailor: 'Seafaring work taught you ships, navigation, and life aboard a vessel.',
  acolyte: 'Religious instruction gave you familiarity with worship, sacred customs, and doctrine.',
  soldier: 'Service in an organized military taught you discipline and the routines of war.',
  ranger: 'Experience in untamed places taught you woodland survival and wilderness ways.',
  scout: 'You learned to stay alive by moving quietly, watching carefully, and acting quickly.',
  minstrel: 'Travel and performance taught you how talent and charm can win an audience.',
  scholar: 'Study gave you insight into old civilizations, forgotten events, and obscure lore.',
  noble: 'Family reputation and social standing grant you access denied to less privileged travelers.',
  chirurgeon: 'Practical medical training taught you anatomy, treating wounds, and performing surgery.'
});

const FIELDS = Object.freeze({
  name: '',
  ancestry: 'what type of creature are you?',
  class: 'Your adventuring profession; class abilities, talents, hit-point dice, and access to magic.',
  alignment: 'Your allegiance to Law, Chaos, or Neutrality; influences your outlook, deity, and title.',
  deity: 'The god your character follows; priests must serve a deity whose alignment matches their own.',
  level: 'earn your current level times 10 XP to advance to the next level.',
  xp: 'gained by selling treasure, socializing with friends and partying.',
  title: 'Your reputation among your guild, college or religion.',
  background: 'Your life before adventuring. What drove you into the ShadowDark?',
  stats: 'Six ability scores describe physical and mental strengths; their modifiers affect related rolls.',
  hp: 'Hit Points. These keep you from dying.',
  ac: 'Armor Class. How hard are you to hit?',
  attacks: 'Weapon name. To hit bonus. Damage.',
  gear: 'This is your stuff. If you are strong you can carry more.',
  'gear slots': 'Equipment capacity measured in slots; bulky items use more, while some small items share a slot.',
  coins: 'Money for purchases: one gold equals 10 silver or 100 copper. 100 coins occupy 1 slot.',
  gp: 'Gold pieces',
  sp: 'Silver pieces',
  cp: 'Copper pieces',
  'free to carry': 'Items exempt from gear slots, including normal clothing, your first backpack, and up to 100 coins.',
  talents: 'Ancestry and class abilities.',
  spells: 'Known spells.',
  'talents spells': 'Your ancestry abilities, class talents, and known spells.',
  languages: 'Languages you can speak; sharing one lets you communicate with a creature that knows it.'
});
const SPELLCASTING_LORE = Object.freeze({
  wizard: 'Cast with intelligence, DC 10 plus the spell\'s tier to cast.',
  priest: 'Cast with wisdom, DC 10 plus the spell\'s tier to cast.'
});
const FIELD_ALIASES = Object.freeze({
  'character name': 'name', classname: 'class', 'class name': 'class', race: 'ancestry',
  experience: 'xp', 'experience points': 'xp', 'hit points': 'hp', 'current hp': 'hp', 'maximum hp': 'hp', 'max hp': 'hp',
  'max hit points': 'hp', 'armor class': 'ac', 'armour class': 'ac', attack: 'attacks', equipment: 'gear',
  'gear slots total': 'gear slots', 'gear slots used': 'gear slots', gold: 'gp', silver: 'sp', copper: 'cp',
  'gold pieces': 'gp', 'silver pieces': 'sp', 'copper pieces': 'cp', 'total coins': 'coins',
  freecarry: 'free to carry', 'free carry': 'free to carry', 'free to carry items': 'free to carry',
  talent: 'talents', spell: 'spells', 'talents and spells': 'talents spells'
});

const TITLES = Object.create(null);
const titleGroups = {
  Fighter: { lawful: ['Squire', 'Cavalier', 'Knight', 'Thane', 'Lord/Lady'], chaotic: ['Knave', 'Bandit', 'Slayer', 'Reaver', 'Warlord'],
    neutral: ['Warrior', 'Barbarian', 'Battlerager', 'Warchief', 'Chieftain'] },
  Priest: { lawful: ['Acolyte', 'Crusader', 'Templar', 'Champion', 'Paladin'], chaotic: ['Initiate', 'Zealot', 'Cultist', 'Scourge', 'Chaos Knight'],
    neutral: ['Seeker', 'Invoker', 'Haruspex', 'Mystic', 'Oracle'] },
  Thief: { lawful: ['Footpad', 'Burglar', 'Rook', 'Underboss', 'Boss'], chaotic: ['Thug', 'Cutthroat', 'Shadow', 'Assassin', 'Wraith'],
    neutral: ['Robber', 'Outlaw', 'Rogue', 'Renegade', 'Bandit King/Queen'] },
  Wizard: { lawful: ['Apprentice', 'Conjurer', 'Arcanist', 'Mage', 'Archmage'], chaotic: ['Adept', 'Channeler', 'Witch/Warlock', 'Diabolist', 'Sorcerer'],
    neutral: ['Shaman', 'Seer', 'Warden', 'Sage', 'Druid'] }
};
for (const [className, alignments] of Object.entries(titleGroups)) {
  for (const [alignment, names] of Object.entries(alignments)) names.forEach((name, rank) => {
    TITLES[normalize(name)] = `${className} title for a ${alignment} adventurer at levels ${rank * 2 + 1}-${rank * 2 + 2}; reflects reputation, not an additional ability.`;
  });
}
for (const [alias, title] of Object.entries({ lord: 'lord lady', lady: 'lord lady', witch: 'witch warlock', warlock: 'witch warlock',
  'bandit king': 'bandit king queen', 'bandit queen': 'bandit king queen' })) TITLES[alias] = TITLES[title];
Object.freeze(TITLES);

export function abilityLore(key) {
  return lookup(ABILITIES, lookup(ABILITY_KEYS, normalize(key)));
}

export function fieldLore(field, value = '') {
  const normalized = normalize(field), key = lookup(FIELD_ALIASES, normalized) || normalized;
  const ability = abilityLore(key);
  if (ability) return ability;
  if (key === 'deity' || key === 'alignment') {
    // User-authored lore is intentionally preserved, including passages longer than the new-summary limit.
    const existing = sheetLore(key === 'deity' ? 'Deity' : 'Alignment', value);
    return typeof existing === 'string' && existing ? existing : FIELDS[key];
  }
  const specific = normalize(value);
  if (key === 'spells') return lookup(SPELLCASTING_LORE, specific === 'cleric' ? 'priest' : specific) || FIELDS.spells;
  if (key === 'ancestry') return lookup(ANCESTRIES, specific === 'halforc' ? 'half orc' : specific) || FIELDS.ancestry;
  if (key === 'class') return lookup(CLASSES, ({ cleric: 'priest', rogue: 'thief' })[specific] || specific) || FIELDS.class;
  if (key === 'background') return lookup(BACKGROUNDS, specific) || FIELDS.background;
  if (key === 'title') return lookup(TITLES, specific) || FIELDS.title;
  return lookup(FIELDS, key);
}
