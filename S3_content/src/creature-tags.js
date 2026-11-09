export const CREATURE_TAGS = Object.freeze([
  ['fiend', 'Fiends (Demons and Devils)'], ['fey', 'Fey'], ['undead', 'Undead'],
  ['primordial', 'Primordials (Elementals)'], ['celestial', 'Celestials (Angels)'],
  ['aberration', 'Aberrations'], ['animal', 'Animals'], ['construct', 'Constructs (Golems)'],
  ['dragon', 'Dragons'], ['giant', 'Giants'], ['monstrosity', 'Monstrosities'],
  ['ooze', 'Oozes'], ['plant', 'Plants'], ['shapechanger', 'Shapechangers']
].map(pair => Object.freeze(pair)));

const aliases = new Map();
for (const [canonical, names] of [
  ['fiend', ['fiends', 'demon', 'demons', 'devil', 'devils']],
  ['fey', []], ['undead', []],
  ['primordial', ['primordials', 'elemental', 'elementals']],
  ['celestial', ['celestials', 'angel', 'angels']],
  ['aberration', ['aberrations']], ['animal', ['animals', 'beast', 'beasts']],
  ['construct', ['constructs', 'golem', 'golems']], ['dragon', ['dragons']],
  ['giant', ['giants']], ['monstrosity', ['monstrosities']],
  ['ooze', ['oozes']], ['plant', ['plants']], ['shapechanger', ['shapechangers']]
]) for (const name of [canonical, ...names]) aliases.set(name, canonical);

export function canonicalCreatureTag(tag) {
  return typeof tag === 'string' ? aliases.get(tag.trim().toLowerCase()) || null : null;
}

export function canonicalCreatureTags(tags) {
  const values = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,;|]/) : [];
  const found = new Set(values.map(canonicalCreatureTag).filter(Boolean));
  return CREATURE_TAGS.map(([key]) => key).filter(key => found.has(key));
}

// Read actual tags and retained monster sources, never ancestry, names or ability prose.
export function creatureTags(creature) {
  const source = creature?.companion?.source || creature?.raw?.companion?.source;
  return canonicalCreatureTags([
    ...canonicalCreatureTags(creature?.tags), ...canonicalCreatureTags(creature?.raw?.tags),
    ...canonicalCreatureTags(source?.tags), ...canonicalCreatureTags(source?.raw?.tags)
  ]);
}

export function hasCreatureTag(creature, tag) {
  const canonical = canonicalCreatureTag(tag);
  return canonical !== null && creatureTags(creature).includes(canonical);
}

export function creatureMatchesTags(creature, tags) {
  const selected = canonicalCreatureTags(tags);
  return creatureTags(creature).some(tag => selected.includes(tag));
}
