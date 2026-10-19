export const ELEMENTS = ['lightning', 'fire', 'cold', 'acid', 'poison'];
const aliases = {
  lightning: /\b(?:lightning|electric(?:ity|al)?|thunderbolt|shock)\b/i,
  fire: /\b(?:fire|flame|flaming|burn(?:ing)?|heat|lava|magma)\b/i,
  cold: /\b(?:cold|frost|freez(?:e|ing)|frozen|ice|icy)\b/i,
  acid: /\b(?:acid|acidic|corrosi(?:ve|on))\b/i,
  poison: /\b(?:poison(?:ous|ed)?|venom(?:ous)?|toxi(?:c|n))\b/i
};

export function matchingElements(source) {
  const text = typeof source === 'string' ? source : JSON.stringify(source || '');
  return ELEMENTS.filter(element => aliases[element].test(text));
}

export function resistanceType(creature, source) {
  const elements = matchingElements(source);
  return (creature?.gear || []).find(item => item.equipped && elements.includes(item.magic?.resistance))?.magic.resistance || null;
}

export function elementalDamage(creature, amount, source) {
  const type = resistanceType(creature, source), original = Math.max(0, Number(amount) || 0);
  return { original, total: type ? Math.floor(original / 2) : original, resistance: type };
}

export function elementalSaveOptions(creature, source, { advantage = false, disadvantage = false } = {}) {
  advantage ||= Boolean(resistanceType(creature, source));
  return { doubleRoll: advantage && !disadvantage, disadvantage: disadvantage && !advantage };
}
