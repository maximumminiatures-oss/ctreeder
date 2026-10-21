const BASE_TERMS = [
  'fighter', 'priest', 'cleric', 'thief', 'wizard', 'monster', 'animal',
  'human', 'elf', 'dwarf', 'halfling', 'half-orc', 'goblin',
  'lawful', 'neutral', 'chaotic', 'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma', 'level',
  'urchin', 'wanted', 'cult initiate', "thieves' guild", 'banished', 'orphaned', "wizard's apprentice", 'jeweler',
  'herbalist', 'barbarian', 'mercenary', 'sailor', 'acolyte', 'soldier', 'ranger', 'scout', 'minstrel', 'scholar', 'noble', 'chirurgeon',
  'bastard sword', 'club', 'crossbow', 'dagger', 'greataxe', 'javelin', 'longbow', 'longsword', 'mace', 'shortbow',
  'shortsword', 'spear', 'staff', 'warhammer', 'unarmed strike'
];
const BASE_SPELLS = ['Alarm', 'Burning Hands', 'Charm Person', 'Cure Wounds', 'Detect Magic', 'Feather Fall',
  'Floating Disc', 'Hold Portal', 'Holy Weapon', 'Light', 'Mage Armor', 'Magic Missile', 'Protection from Evil',
  'Protection from Good', 'Shield of Faith', 'Sleep', 'Turn Undead', 'Acid Arrow', 'Alter Self', 'Detect Thoughts',
  'Fixed Object', 'Hold Person', 'Invisibility', 'Knock', 'Levitate', 'Mirror Image', 'Misty Step', 'Silence', 'Web'];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = character => character && /[\p{L}\p{N}_/\\-]/u.test(character);
const plurals = new Map([['elf', 'elves'], ['dwarf', 'dwarves'], ['thief', 'thieves'], ['wolf', 'wolves'], ['staff', 'staves']]);
const plural = value => plurals.get(value.toLowerCase()) || (/[^aeiou]y$/i.test(value) ? `${value.slice(0, -1)}ies` :
  /(?:s|x|z|ch|sh)$/i.test(value) ? `${value}es` : `${value}s`);
let cached;

function names(values) {
  if (values instanceof Map) values = [...values.values()];
  if (values instanceof Set) values = [...values];
  return (Array.isArray(values) ? values : []).map(value => typeof value === 'string' ? value : value?.name || value?.['Monster Name'])
    .filter(value => typeof value === 'string' && value.trim());
}
function uniqueNames(entity) {
  const result = [entity?.uniqueName, typeof entity?.properName === 'string' ? entity.properName : null,
    entity?.metadata?.uniqueName, entity?.meta?.uniqueName].filter(value => typeof value === 'string' && value);
  if (!result.length && (entity?.properName === true || entity?.isUnique === true || entity?.isNamed === true || entity?.unique === true ||
      entity?.metadata?.isUnique === true || entity?.meta?.isUnique === true || entity?.metadata?.unique === true || entity?.meta?.unique === true))
    result.push(entity.name);
  return result.filter(value => typeof value === 'string' && value);
}
function dynamicTerms(state) {
  const characters = [...(state?.characters || []), ...(state?.entities || []).map(entity => entity.characterCorpse).filter(Boolean)];
  return {
    characters: characters.map(character => [character.name, character.className || character.class, character.ancestry,
      character.background, character.alignment, character.spellsKnown]),
    monsters: (state?.entities || []).filter(entity => entity.type === 'monster').map(entity => [entity.name, uniqueNames(entity)])
  };
}
function lexicon({ state, rulesData, monsters, spells, classes, ancestries, backgrounds, alignments } = {}) {
  const dynamic = dynamicTerms(state);
  const signature = JSON.stringify([dynamic, classes, ancestries, backgrounds, alignments]);
  const spellSize = spells instanceof Map || spells instanceof Set ? spells.size : spells?.length;
  if (cached?.rulesData === rulesData && cached?.monsters === monsters && cached?.spells === spells &&
      cached.spellSize === spellSize && cached.signature === signature) return cached;
  const entries = new Map();
  const add = (value, kind, canonical = value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) return;
    const text = value.trim(), key = text.toLowerCase();
    const entry = entries.get(key) || {};
    entry[kind] = canonical.trim(); entries.set(key, entry);
    if (kind === 'ordinary') {
      const pluralKey = plural(key), pluralEntry = entries.get(pluralKey) || {};
      pluralEntry.ordinary = pluralKey; entries.set(pluralKey, pluralEntry);
    }
  };
  for (const value of [...BASE_TERMS, ...names(rulesData?.weapons), ...names(classes), ...names(ancestries), ...names(backgrounds), ...names(alignments)])
    add(value, 'ordinary');
  for (const monster of names(monsters)) add(monster, 'ordinary');
  for (const spell of [...BASE_SPELLS, ...names(spells)]) add(spell, 'spell');
  for (const [name, className, ancestry, background, alignment, spellsKnown] of dynamic.characters) {
    add(name, 'character');
    for (const value of [className, ancestry, background, alignment]) add(value, 'ordinary');
    for (const spell of String(spellsKnown || '').split(/,\s*/)) {
      if (!entries.get(spell.toLowerCase())?.spell) add(spell, 'spell');
    }
  }
  for (const [name, properNames] of dynamic.monsters) {
    add(name, 'ordinary');
    for (const proper of properNames) add(proper, 'proper');
    if (properNames.includes(name)) add(name, 'proper');
  }
  for (const record of Array.isArray(monsters) ? monsters : []) for (const proper of uniqueNames(record)) add(proper, 'proper');
  const alternatives = [...entries.keys()].sort((a, b) => b.length - a.length).map(escape);
  cached = { rulesData, monsters, spells, spellSize, signature, entries,
    pattern: new RegExp(alternatives.join('|'), 'giu') };
  return cached;
}
function genericUse(text, start, end) {
  const before = text.slice(Math.max(0, start - 60), start), after = text.slice(end, end + 25);
  return /(?:\b(?:a|an)\s+|\b(?:with|using)\s+the\s+|\b(?:equip|equips|equipped|wield|wields|wielding|buy|buys|bought|sell|sells|sold)\s+|\b(?:class|ancestry|background|alignment)\s*[:=]\s*)$/i.test(before) ||
    /\bout of (?:attack )?range with\s+$/i.test(before) ||
    /^\s+(?:check|save|modifier|score)\b/i.test(after);
}
function replacement(entry, matched, text, start) {
  if (entry.proper && (!entry.ordinary || !genericUse(text, start, start + matched.length)))
    return { text: entry.proper, protected: true };
  if (entry.character && (!entry.ordinary || !genericUse(text, start, start + matched.length)))
    return { text: entry.character, protected: true };
  if (entry.spell && (/\s/.test(entry.spell) || matched === entry.spell ||
      /\b(?:cast|casts|casting|spell|maintain|maintaining|focus|prepare|prepares)\s+(?:the\s+)?$/i.test(text.slice(Math.max(0, start - 40), start))))
    return { text: entry.spell, protected: true };
  return { text: entry.ordinary ? matched.toLowerCase() : matched, protected: false };
}
const opaque = /`[^`\r\n]*`|<[^>\r\n]*>|https?:\/\/[^\s<>]+|\b[A-Za-z]:[\\/][^\s<>]+|(?:^|(?<=\s))\.{0,2}\/[^\s<>]+|\b[\p{L}\p{N}_-]+\.[A-Za-z][A-Za-z0-9]{0,8}\b|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_-]+\b|\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-\d[A-Za-z0-9-]*\b/gu;

/** Plain status text only. This never parses HTML, changes game data, or formats roll-history segments. */
export function formatRulesMessage(message, context = {}) {
  if (typeof message !== 'string' || !message.trim()) return typeof message === 'string' ? message : '';
  const plan = lexicon(context), segments = [];
  const process = (text, offset = 0) => {
    let previous = 0;
    plan.pattern.lastIndex = 0;
    for (const match of text.matchAll(plan.pattern)) {
      const start = match.index, end = start + match[0].length;
      if (word(text[start - 1]) || word(text[end])) continue;
      segments.push({ text: text.slice(previous, start), protected: false });
      segments.push(replacement(plan.entries.get(match[0].toLowerCase()), match[0], message, offset + start));
      previous = end;
    }
    segments.push({ text: text.slice(previous), protected: false });
  };
  let previous = 0;
  for (const match of message.matchAll(opaque)) {
    process(message.slice(previous, match.index), previous);
    segments.push({ text: match[0], protected: true }); previous = match.index + match[0].length;
  }
  process(message.slice(previous), previous);
  let initial = true, output = '';
  for (const segment of segments) {
    if (segment.protected) {
      output += segment.text;
      if (/[\p{L}\p{N}]/u.test(segment.text)) initial = false;
      continue;
    }
    for (let index = 0; index < segment.text.length; index++) {
      let character = segment.text[index];
      if (/\p{L}/u.test(character)) { if (initial) character = character.toUpperCase(); initial = false; }
      else if (character === '\n' || /[!?]/.test(character) || character === '.' && !/\d/.test(segment.text[index + 1] || '')) initial = true;
      output += character;
    }
  }
  const trimmed = output.trimEnd();
  if (!/[.!?:;][\s"')\]]*$/.test(trimmed)) output = `${trimmed}.`;
  return output;
}
