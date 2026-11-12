const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const STANDALONE_SUBTYPES = new Set(['balor', 'glabrezu', 'marilith', 'vrock']);
const ROLES = /^(?:priestess|priest|shaman|wizard|mage|warrior|chief|king|queen|leader)$/;

export function creatureTypeName(name) {
  const text = clean(name).toLowerCase().replace(/^(?:the|an?)\s+/, '');
  const parts = text.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  // Category labels are not extra species: "Demon, Marilith" and "Marilith" name the same type.
  if (parts.length === 2 && parts[0] === 'demon' && STANDALONE_SUBTYPES.has(parts[1])) return parts[1];
  if (parts.length === 2 && ROLES.test(parts[1])) return parts.join(' ');
  return parts.reverse().join(' ');
}

export function indefiniteArticle(name) {
  const type = creatureTypeName(name).replace(/^[\s"'([{]+/, '');
  if (/^(?:heir|honest|honou?r|hour)/.test(type)) return 'an';
  if (/^(?:unicorn|uniform|university|universal|unique|unified|union\b|unit\b|european|ewe\b|one(?:\b|-)|once\b)/.test(type)) return 'a';
  return /^[aeiou]/.test(type) ? 'an' : 'a';
}

// Shadowdark Character Names, p. 38.
const CHARACTER_NAMES = {
  'Dwarf': 'Hilde Torbin Marga Bruno Karina Naugrim Brenna Darvin Elga Alric Isolde Gendry Bruga Junnor Vidrid Torson Brielle Ulfgar Sarna Grimm'.split(' '),
  'Elf': 'Eliara Ryarn Sariel Tirolas Galira Varos Daeniel Axidor Hiralia Cyrwin Lothiel Zaphiel Nayra Ithior Amriel Elyon Jirwyn Natinel Fiora Ruhiel'.split(' '),
  'Goblin': 'Iggs Tark Nix Lenk Roke Fitz Tila Riggs Prim Zeb Finn Borg Yark Deeg Nibs Brak Fink Rizzo Squib Grix'.split(' '),
  'Halfling': 'Willow Benny Annie Tucker Marie Hobb Cora Gordie Rose Ardo Alma Norbert Jennie Barvin Tilly Pike Lydia Marlow Astrid Jasper'.split(' '),
  'Half-Orc': 'Vara Gralk Ranna Korv Zasha Hrogar Klara Tragan Brolga Drago Yelena Krull Ulara Tulk Shiraal Wulf Ivara Hirok Aja Zoraan'.split(' '),
  'Human': 'Zali Bram Clara Nattias Rina Denton Mirena Aran Morgan Giralt Tamra Oscar Ishana Rogar Jasmin Tarin Yuri Malchor Lienna Godfrey'.split(' '),
};

function companionNameAncestry(monster, ancestry) {
  const type = creatureTypeName(monster.name);
  if (/\b(?:goblin|hobgoblin|bugbear)\b/.test(type)) return 'Goblin';
  if (/\b(?:duergar|azer)\b/.test(type)) return 'Dwarf';
  if (/\b(?:drow|drider)\b/.test(type)) return 'Elf';
  if (/\borc\b/.test(type)) return 'Half-Orc';
  const knownAncestry = Object.keys(CHARACTER_NAMES).find(label => label.toLowerCase() === clean(ancestry).toLowerCase());
  const tags = Array.isArray(monster.tags) ? monster.tags : clean(monster.tags).split(/[,;|]/);
  const humanoid = tags.some(tag => /^humanoid$/i.test(clean(tag))) ||
    /\b(?:ghost|lich|mummy|vampire|werewolf|wererat)\b/.test(type);
  return knownAncestry || (humanoid ? 'Human' : null);
}

export function randomCompanionName(monster, ancestry, random = Math.random) {
  const names = CHARACTER_NAMES[companionNameAncestry(monster, ancestry)];
  return names ? names[Math.floor(random() * names.length)] : monster.name;
}

function intelligenceModifier(monster) {
  const value = monster.I ?? monster['**I**'] ?? monster.intelligence;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function buildGuardianPool(monsters) {
  const pool = new Map();
  for (const monster of Array.isArray(monsters) ? monsters : []) {
    if (!monster || typeof monster !== 'object') continue;
    const sourceName = monster.name ?? monster['Monster Name'];
    const name = creatureTypeName(sourceName), intelligence = intelligenceModifier(monster);
    if (!name || intelligence === null || intelligence < 0 || pool.has(name)) continue;
    pool.set(name, { name, sourceName, intelligence });
  }
  return [...pool.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
