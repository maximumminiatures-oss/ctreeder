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
