import { creatureTypeName, indefiniteArticle } from './creature-names.js';
import { revealSecretDoor } from './interactions.js';
import { routeOf } from './underpasses.js';

const weighted = (weight, values) => values.map(text => ({ text, weight }));
export const DEAD_VERBS = Object.freeze([
  ...weighted(10, ['hated', 'loved', 'liked', 'cared for', 'gave birth to', 'was obsessed with', 'crafted', 'got married to']),
  ...weighted(5, ['secretly ate', 'hid from', 'imprisoned', 'tortured', 'helped', 'never wanted', 'felt annoyed by', 'yelled at', 'was yelled at by']),
  ...weighted(2, ['sniffed', 'looked at', 'slept next to', 'tricked', 'poisoned', 'stabbed', 'gave a [noun] to'])
]);
export const DEAD_ADJECTIVES = Object.freeze([
  ...weighted(10, ['my']),
  ...weighted(5, ["Memnon's", "Shune's", "Ramlaat's", 'every one of my', 'some of my', 'anyone who liked my', 'anyone with my',
    "my wife's", "my son's", "my daughter's", "my sister's", "my brother's", "my grandma's", "my grandpa's"]),
  ...weighted(2, ["Ord's", "Madeera's", "Gede's", "St. Terragnis's", "the king's", "the queen's", "the warlord's", 'her', 'his',
    'their', "the boss's", "my cousin's", "my uncle's", "my aunt's", "my master's"])
]);
export const DEAD_NOUNS = Object.freeze([
  ...weighted(10, ['personality', 'appearance', 'darkness', 'mind', 'evil', 'hatred', 'son', 'daughter', 'husband', 'wife', 'lover',
    'girlfriend', 'boyfriend', 'sense of self', 'brother', 'sister', 'father', 'mother', 'friends', 'closest friend',
    'fellow dungeon dwellers', 'body', 'everyone', 'animals', 'plants', 'food']),
  ...weighted(5, ['kindness', 'happiness', 'honor', 'friendship', 'eyes', 'ears', 'fellow believers', 'fellow cultists', 'roommates', 'grandparents']),
  ...weighted(2, ['chair', 'cousins', 'bed', 'house', 'keys', 'clothes', 'armor', 'weapons', 'vegetables', 'meat', 'herbs and spices',
    'corridors', 'cats', 'dogs', 'chickens', 'cows', 'horses']),
  ...weighted(2, ['[monster_name]s', '[class_name]s', '[ancestry_name]s', '[background_name]s', '[gear_name]s'])
]);

export function deadWeightedChoice(entries, rng = Math.random) {
  const value = typeof rng === 'function' ? rng() : rng?.nextFloat?.();
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid dialogue random source.');
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.min(1 - Number.EPSILON, value) * total;
  return entries.find(entry => (roll -= entry.weight) < 0) || entries.at(-1);
}

const irregulars = new Map(Object.entries({ elf: 'elves', dwarf: 'dwarves', thief: 'thieves', wolf: 'wolves', staff: 'staves',
  man: 'men', woman: 'women', child: 'children', person: 'people', mouse: 'mice', goose: 'geese', foot: 'feet', tooth: 'teeth',
  knife: 'knives', wife: 'wives', half: 'halves', leaf: 'leaves', life: 'lives', ox: 'oxen' }));
const invariant = new Set(['mushroomfolk', 'merfolk', 'lizardfolk', 'beastmen', 'chainmail', 'ringmail', 'armor', 'clothing',
  'clothes', 'underwear', 'breeches', 'rations', 'iron spikes', 'arrows', 'crossbow bolts', 'bagpipes', 'castanets',
  'earrings', 'dentures', 'boots', 'socks', 'quartz', 'food', 'meat', 'darkness', 'evil', 'hatred', 'kindness', 'happiness', 'honor']);
const alreadyPlural = new Set([...irregulars.values(), 'sphinxes', 'friends', 'fellow dungeon dwellers', 'animals', 'plants',
  'eyes', 'ears', 'fellow believers', 'fellow cultists', 'roommates', 'grandparents', 'cousins', 'keys', 'weapons',
  'vegetables', 'herbs and spices', 'corridors', 'cats', 'dogs', 'chickens', 'cows', 'horses']);

export function deadPlural(value) {
  const text = String(value || '').trim();
  if (!text || invariant.has(text.toLowerCase()) || alreadyPlural.has(text.toLowerCase())) return text;
  const of = text.match(/^(.*?)\s+(of\s+.+)$/i);
  if (of) return `${deadPlural(of[1])} ${of[2]}`;
  const match = text.match(/^(.*?)([\p{L}'-]+)$/u);
  if (!match) return text;
  const [, prefix, word] = match, lower = word.toLowerCase();
  if (invariant.has(lower) || alreadyPlural.has(lower) || /folk$/i.test(word)) return text;
  const plural = irregulars.get(lower) || (/[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` :
    /(?:s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`);
  return prefix + (/^[A-Z]/.test(word) ? plural[0].toUpperCase() + plural.slice(1) : plural);
}

export function deadNumber(value) {
  const number = Math.max(0, Math.floor(Number(value) || 0));
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  if (number < 20) return ones[number];
  if (number < 100) return ['zero', 'ten', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(number / 10)] +
    (number % 10 ? `-${ones[number % 10]}` : '');
  if (number < 1000) return `${ones[Math.floor(number / 100)]} hundred${number % 100 ? ` ${deadNumber(number % 100)}` : ''}`;
  if (number < 1000000) return `${deadNumber(Math.floor(number / 1000))} thousand${number % 1000 ? ` ${deadNumber(number % 1000)}` : ''}`;
  return number.toLocaleString('en-US');
}

const list = values => values.length > 2 ? `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}` : values.join(' and ');
const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const nameOf = value => typeof value === 'string' ? value : value?.name || value?.['Monster Name'] || '';
const activeCharm = creature => creature.charm && !creature.charm.brokenByParty &&
  (creature.charm.remainingMs == null || creature.charm.remainingMs > 0);

export function deadRemainingMonsters(state) {
  const partyIds = new Set((state.characters || []).flatMap(member => [member.id, member.companion?.sourceMonsterId, member.companion?.source?.id]).filter(Boolean));
  const seen = new Set();
  return (state.entities || []).filter(creature => {
    if (creature.type !== 'monster' || partyIds.has(creature.id) || creature.dead || creature.slain || creature.defeated ||
      creature.leftPeacefully || creature.departing || Number(creature.hp ?? creature.maxHp ?? 1) <= 0 || activeCharm(creature) ||
      creature.friendly || creature.attitude === 'friendly' || seen.has(creature.id)) return false;
    if (creature.id) seen.add(creature.id);
    return true;
  });
}

function treasureFound(state, item) {
  if (item.found || item.discovered || item.darknessRevealed) return true;
  if (!item.revealed && !item.visible) return false;
  const visibility = state.visibility || {}, key = `${item.x},${item.y}`, route = routeOf(state, item);
  const has = cells => cells instanceof Set ? cells.has(key) : Array.isArray(cells) && cells.includes(key);
  // Generation's visible/revealed flags permit rendering; only explored cells establish that the party found the item.
  const memories = state.underpasses?.length ? [visibility.routeExplored?.[route], visibility.routeVisible?.[route],
    visibility.routeDarkvisionExplored?.[route], visibility.routeDarkvision?.[route]] :
    [visibility.exploredEver, visibility.visibleNow, visibility.darkvisionExplored, visibility.darkvisionNow];
  return memories.some(has);
}

export function deadRemainingTreasure(state) {
  return (state.entities || []).filter(item => item.type === 'treasure' && !item.collected && !item.destroyed &&
    !item.corpseLoot && !['corpse-loot', 'turned-ash'].includes(item.subtype) && !treasureFound(state, item));
}

export function deadTreasureValue(item) {
  if (item.value != null) return nonnegative(item.value);
  if (item.coinBreakdown) return nonnegative(item.coinBreakdown.gold) + nonnegative(item.coinBreakdown.silver) / 10 + nonnegative(item.coinBreakdown.copper) / 100;
  return nonnegative(item.gearItem?.value);
}

export function deadTreasureCategory(item) {
  const kind = String(item.gearItem?.magic?.kind || item.gearItem?.type || item.category || item.kind || '').toLowerCase();
  if (['armor', 'shield', 'leather', 'chainmail', 'platemail'].includes(kind)) return 'armor';
  if (['weapon', 'weapons', 'dagger', 'ammunition'].includes(kind)) return 'weapons';
  if (['gem', 'gems'].includes(kind)) return 'gems';
  if (['coin', 'coins', 'coin-cache'].includes(kind) || item.coinBreakdown) return 'coins';
  if (['instrument', 'instruments'].includes(kind)) return 'instruments';
  if (['clothing', 'jewels', 'herbs', 'potion', 'scroll', 'wand'].includes(kind)) return { potion: 'potions', scroll: 'scrolls', wand: 'wands' }[kind] || kind;
  return 'gear';
}

function treasureGroups(state) {
  const groups = new Map();
  for (const item of deadRemainingTreasure(state)) {
    const key = deadTreasureCategory(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

const categoryLabels = Object.freeze({ weapons: 'Weapons', armor: 'Shields or Suits of Armor', gems: 'Gems', clothing: 'Clothing',
  coins: 'Coins', instruments: 'Musical Instruments', jewels: 'Jewels', herbs: 'Herbs', potions: 'Potions', scrolls: 'Scrolls', wands: 'Wands', gear: 'Gear' });
const categoryLabel = key => categoryLabels[key] || 'Gear';
function categoryNoun(category, count) {
  if (category === 'clothing') return `type${count === 1 ? '' : 's'} of clothing`;
  if (category === 'gear') return `piece${count === 1 ? '' : 's'} of gear`;
  if (category === 'armor') return count === 1 ? 'shield or suit of armor' : 'shields or suits of armor';
  return count === 1 ? ({ weapons: 'weapon', gems: 'gem', coins: 'coin', instruments: 'musical instrument', jewels: 'jewel',
    herbs: 'herb', potions: 'potion', scrolls: 'scroll', wands: 'wand' }[category] || categoryLabel(category).toLowerCase()) : categoryLabel(category).toLowerCase();
}
const typeOf = creature => creatureTypeName(creature.monsterName || creature.companion?.source?.name || creature.name);

export function deadQuestionMenu(state, session = {}) {
  const entries = [
    ['secret_doors', "Are there any secret doors I haven't found?"],
    ['treasure_value', "How much treasure is left I haven't found?"],
    ['monster_count', 'How many comrades still lurk in the shadows to try and do me in?'],
    ['monster_types', 'What types of monsters are out there beyond my torchlight?'],
    ['treasure_types', 'What type of treasure is hidden in these gloomy halls?'],
    ['flavor', 'I just want to get to know you.']
  ].map(([key, label]) => ({ key, label }));
  for (const type of session.monsterTypes || []) entries.push({ key: `monster_count:${encodeURIComponent(type)}`,
    label: `How many ${deadPlural(type)} are there?` });
  for (const category of session.treasureCategories || []) {
    const count = (treasureGroups(state).get(category) || []).reduce((sum, item) => sum + itemQuantity(item), 0);
    entries.push({ key: `treasure_value:${category}`, label: `How much ${count === 1 ? 'is' : 'are'} the ${categoryNoun(category, count)} worth?` });
    entries.push({ key: `treasure_names:${category}`, label: `What types of ${categoryLabel(category).toLowerCase()} are they?` });
  }
  return entries;
}

function dynamicNames(state, kind, options) {
  const rules = options.rulesData || state.rulesData || {};
  const configured = options[kind] || rules[kind];
  let values = configured instanceof Map ? [...configured.values()] : Array.isArray(configured) ? configured : [];
  if (kind === 'monsters') values = [...values, ...(state.entities || []).filter(item => item.type === 'monster')];
  else if (kind === 'gear') values = [...values, ...(rules.weapons || []), ...(rules.armor || []),
    ...(state.characters || []).flatMap(member => member.gear || [])];
  else values = [...values, ...(state.characters || []).map(member => kind === 'classes' ? member.className || member.class :
    kind === 'ancestries' ? member.ancestry : member.background)];
  const fallback = { monsters: ['sphinx', 'mushroomfolk'], classes: ['fighter', 'priest', 'thief', 'wizard'],
    ancestries: ['human', 'elf', 'dwarf', 'goblin', 'halfling', 'half-orc'], backgrounds: ['entertainer', 'orphan', 'noble'],
    gear: ['iron spikes', 'torch', 'chainmail'] };
  const names = [...new Set(values.map(nameOf).filter(Boolean).map(value => kind === 'monsters' ? creatureTypeName(value) :
    String(value).toLowerCase().replace(/^minstrel$/, 'entertainer')))];
  return names.length ? names : fallback[kind];
}

function chooseNoun(state, verb, options) {
  const entries = verb === 'got married to' ? DEAD_NOUNS.filter(entry => !['son', 'daughter'].includes(entry.text)) : DEAD_NOUNS;
  let noun = deadWeightedChoice(entries, options.rng).text;
  const dynamic = { '[monster_name]s': 'monsters', '[class_name]s': 'classes', '[ancestry_name]s': 'ancestries',
    '[background_name]s': 'backgrounds', '[gear_name]s': 'gear' }[noun];
  if (dynamic) noun = deadPlural(deadWeightedChoice(dynamicNames(state, dynamic, options).map(text => ({ text, weight: 1 })), options.rng).text);
  return noun;
}

function chooseVerb(state, opts) {
  let verb = deadWeightedChoice(DEAD_VERBS, opts.rng).text;
  if (verb.includes('[noun]')) {
    const gift = chooseNoun(state, verb, opts);
    const determiner = gift === 'everyone' ? '' : invariant.has(gift.toLowerCase()) || alreadyPlural.has(gift.toLowerCase()) ||
      /(?:folk|s)$/i.test(gift) ? 'some ' : `${indefiniteArticle(gift)} `;
    verb = verb.replace('a [noun]', `${determiner}${gift}`);
  }
  return verb;
}

export function deadReminiscence(state, options = {}) {
  const opts = { ...options, rng: options.rng || options.random || Math.random };
  const sentence = withAdjective => {
    const verb = chooseVerb(state, opts);
    const adjective = withAdjective ? deadWeightedChoice(DEAD_ADJECTIVES, opts.rng).text + ' ' : '';
    const noun = chooseNoun(state, verb, opts);
    return `${verb} ${adjective}${noun}`;
  };
  return `When I was alive, I ${sentence(true)}. I also ${sentence(false)}.`;
}

export function monsterThought(state, monster, options = {}) {
  const opts = { ...options, rng: options.rng || options.random || Math.random };
  const pattern = deadWeightedChoice(['A', 'B', 'C', 'D', 'E', 'F'].map(text => ({ text, weight: 1 })), opts.rng).text;
  const phrase = verb => `${deadWeightedChoice(DEAD_ADJECTIVES, opts.rng).text} ${chooseNoun(state, verb, opts)}`;
  const action = () => { const verb = chooseVerb(state, opts); return `${verb} ${phrase(verb)}`; };
  const name = monster.uniqueName || (typeof monster.properName === 'string' ? monster.properName : null) ||
    (monster.properName === true || monster.isUnique || monster.isNamed ? monster.name : creatureTypeName(monster.name));
  if (pattern === 'A') return `The ${name} is thinking about when it ${action()}.`;
  if (pattern === 'B') { const subject = phrase(); return `I wonder if ${subject} ${action()}.`; }
  if (pattern === 'C') return `I think those adventurers ${action()}.`;
  if (pattern === 'D') {
    const noun = chooseNoun(state, '', opts);
    return `${noun[0].toUpperCase()}${noun.slice(1)} is ${phrase()}.`;
  }
  if (pattern === 'E') return `I just wish I had some of ${phrase()}.`;
  return `By ${phrase()} and ${phrase()} I will show those fools!`;
}

function itemQuantity(item) {
  return Math.max(1, Math.floor(nonnegative(item.gearItem?.quantity ?? item.quantity ?? 1)));
}

function trueItemName(item) {
  const magic = item.gearItem?.magic || item.magic;
  let name = String(magic?.trueName || item.gearItem?.name || item.name || 'treasure').replace(/\s+x\d+$/i, '').trim().toLowerCase();
  if (magic?.spellName && name.endsWith(magic.spellName.toLowerCase())) name = name.slice(0, -magic.spellName.length) + magic.spellName;
  return name.replace(/\b(healing) (i{1,3}|iv)\b/g, (_, word, numeral) => `${word} ${numeral.toUpperCase()}`);
}

function itemNames(items) {
  const groups = new Map();
  for (const item of items) {
    const name = trueItemName(item);
    groups.set(name, (groups.get(name) || 0) + itemQuantity(item));
  }
  return list([...groups].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, count]) =>
    count === 1 ? `${indefiniteArticle(name)} ${name}` : `${deadNumber(count)} ${deadPlural(name)}`));
}

// Only server-derived menu keys and current dungeon records are accepted; answers never trust client totals or names.
export function answerDeadQuestion(state, session, key, options = {}) {
  if (!deadQuestionMenu(state, session).some(entry => entry.key === key)) throw new Error('Choose an available question.');
  let reply, data = {};
  const monsters = deadRemainingMonsters(state), treasures = deadRemainingTreasure(state);
  if (key === 'secret_doors') {
    const doors = (state.entities || []).filter(door => door.subtype === 'door' && door.secret && !door.secretFound && !door.revealed);
    for (const door of doors) revealSecretDoor(door, state, { roomId: door.roomId });
    reply = doors.length ? 'Yes. I have revealed them on your map.' : 'No.';
    data.secretDoorIds = doors.map(door => door.id);
  } else if (key === 'treasure_value') {
    const value = treasures.reduce((sum, item) => sum + deadTreasureValue(item), 0);
    data.value = value; data.estimate = Math.round(value / 100) * 100;
    reply = `There's about ${data.estimate.toLocaleString('en-US')} gp worth of loot left on this dungeon level.`;
  } else if (key === 'monster_count') {
    data.count = monsters.length;
    reply = `There ${data.count === 1 ? 'is' : 'are'} ${deadNumber(data.count)} of my fellows left on this dungeon level.`;
  } else if (key === 'monster_types') {
    session.monsterTypes = [...new Set(monsters.map(typeOf).filter(Boolean))].sort();
    reply = session.monsterTypes.length ? `You must still face at least ${list(session.monsterTypes.map(type => `one ${type}`))} if you wish to slay everything on this level, the way you have slain me.` :
      'There are no more foes left on this dungeon level.';
    data.types = [...session.monsterTypes];
  } else if (key.startsWith('monster_count:')) {
    const type = decodeURIComponent(key.slice('monster_count:'.length));
    data.count = monsters.filter(monster => typeOf(monster) === type).length;
    reply = `There ${data.count === 1 ? 'is' : 'are'} still ${deadNumber(data.count)} ${data.count === 1 ? type : deadPlural(type)} left on this dungeon level.`;
  } else if (key === 'treasure_types') {
    const groups = treasureGroups(state);
    session.treasureCategories = [...groups.keys()].sort();
    const counts = [...groups].map(([category, items]) => {
      const count = items.reduce((sum, item) => sum + itemQuantity(item), 0);
      return `${deadNumber(count)} ${categoryNoun(category, count)}`;
    });
    reply = counts.length ? `There ${treasures.length === 1 && itemQuantity(treasures[0]) === 1 ? 'is' : 'are'} ${list(counts)} you haven't found.` : 'There is no treasure left that you have not found.';
    data.categories = [...session.treasureCategories];
  } else if (key.startsWith('treasure_value:')) {
    const category = key.slice('treasure_value:'.length), items = treasureGroups(state).get(category) || [];
    data.value = items.reduce((sum, item) => sum + deadTreasureValue(item), 0);
    data.low = data.value > 0 ? Math.max(1, Math.floor(data.value / 100) * 100) : 0;
    data.high = data.value > 0 ? Math.ceil(data.value / 100) * 100 : 0;
    if (data.low === data.high && data.high > 0) data.low = Math.max(1, data.high - 100);
    reply = data.value ? `Their total is worth between ${data.low.toLocaleString('en-US')} and ${data.high.toLocaleString('en-US')} gp.` : 'There is none left that you have not found.';
  } else if (key.startsWith('treasure_names:')) {
    const items = treasureGroups(state).get(key.slice('treasure_names:'.length)) || [];
    data.names = items.map(trueItemName);
    reply = items.length ? `There ${items.length === 1 && itemQuantity(items[0]) === 1 ? 'is' : 'are'} ${itemNames(items)}.` : 'There is none left that you have not found.';
  } else reply = deadReminiscence(state, options);
  return { question: key, reply, answer: reply, message: reply, ...data };
}
