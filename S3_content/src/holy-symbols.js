const DEITY_ALIGNMENTS = new Map([
  ['saint', 'lawful'], ['madeera', 'lawful'], ['gede', 'neutral'], ['ord', 'neutral'],
  ['memnon', 'chaotic'], ['ramlaat', 'chaotic'], ['shune', 'chaotic']
]);
const words = text => String(text || '').match(/[\p{L}\p{N}]+/gu) || [];
const deityNames = deity => words(deity).filter(word => word.toLowerCase() !== 'the').slice(0, 2);

export function hasHolySymbol(character) {
  const names = deityNames(character?.deity).map(word => word.toLowerCase());
  const alignment = DEITY_ALIGNMENTS.get(names[0]) || String(character?.alignment || '').toLowerCase();
  return (character?.gear || []).some(item => {
    const name = String(item.name || '').toLowerCase();
    const description = [item.description, item.magic?.description, item.magic?.effect?.description].filter(Boolean).join(' ');
    const restricted = String(item.magic?.beneficiaryAlignment || item.beneficiaryAlignment || '').toLowerCase() ||
      description.match(/(?:benefits?|usable by|functions for|works for) only (?:creatures? (?:of )?|beings? (?:of )?)?(lawful|neutral|chaotic)|only (lawful|neutral|chaotic) (?:creatures?|beings?)/i)?.slice(1).find(Boolean)?.toLowerCase();
    return names.some(part => words(name).includes(part)) ||
      item.holySymbol === true || item.magic?.holySymbol === true ||
      /(?:acts?|functions?|serves?|counts?) as (?:a )?holy symbol/i.test(description) ||
      Boolean(alignment && restricted === alignment) ||
      !names.length && name === 'holy symbol';
  });
}

export function grantPriestTalisman(character) {
  const [name] = deityNames(character?.deity);
  if (!name || !/\bpriest\b/i.test(character.className || character.class || '') || character.companion || character.talismanGranted) return;
  character.gear ||= [];
  const itemName = 'Talisman of ' + name[0].toUpperCase() + name.slice(1).toLowerCase();
  if (!character.gear.some(item => String(item.name).toLowerCase() === itemName.toLowerCase())) {
    character.gear.push({ name: itemName, type: 'sundry', slots: 0, freeCarry: true, costGp: 1,
      quantity: 1, totalUnits: 1, equipped: false });
  }
  character.talismanGranted = true;
  if (character.raw) {
    character.raw.talismanGranted = true;
    character.raw.gear = structuredClone(character.gear);
  }
}
