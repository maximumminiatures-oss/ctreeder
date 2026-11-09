// Canonical damage types are separate from the five random treasure elements.
export const DAMAGE_TYPES = Object.freeze([
  'fire', 'cold', 'lightning', 'acid', 'poison', 'thunder', 'necrotic', 'radiant',
  'psychic', 'force', 'bludgeoning', 'piercing', 'slashing'
]);

const names = {
  electricity: 'lightning', electric: 'lightning', electrical: 'lightning',
  sound: 'thunder', sonic: 'thunder', holy: 'radiant', magic: 'force'
};
const patterns = {
  fire: /\b(?:fire|flame|flaming|burn(?:ing)?|heat|lava|magma)\b/i,
  cold: /\b(?:cold|frost|freez(?:e|ing)|frozen|ice|icy)\b/i,
  lightning: /\b(?:lightning|electric(?:ity|al)?|thunderbolt|shock)\b/i,
  acid: /\b(?:acid|acidic|corrosi(?:ve|on))\b/i,
  poison: /\b(?:poison(?:ous|ed)?|venom(?:ous)?|toxi(?:c|n))\b/i,
  thunder: /\b(?:thunder|sound|sonic)\b/i,
  necrotic: /\bnecrotic\b/i,
  radiant: /\b(?:radiant|holy)\b/i,
  psychic: /\bpsychic\b/i,
  force: /\bforce\b/i,
  bludgeoning: /\bbludgeoning\b/i,
  piercing: /\bpiercing\b/i,
  slashing: /\bslashing\b/i
};

export function normalizeDamageType(value) {
  const key = String(value || '').trim().toLowerCase();
  return names[key] || (DAMAGE_TYPES.includes(key) ? key : null);
}

export function matchingDamageTypes(source) {
  if (source && typeof source === 'object') {
    const explicit = source.damageTypes ?? source.damageType ?? source.damageSource;
    if (explicit != null) return [...new Set((Array.isArray(explicit) ? explicit : [explicit])
      .flatMap(value => matchingDamageTypes(value)))];
  }
  const text = typeof source === 'string' ? source : JSON.stringify(source || '');
  const exact = normalizeDamageType(text);
  if (exact) return [exact];
  return DAMAGE_TYPES.filter(type => patterns[type].test(text));
}
