export function monsterAlignmentName(value) {
  const text = String(value || '').trim();
  return { c: 'Chaotic', chaotic: 'Chaotic', l: 'Lawful', lawful: 'Lawful', n: 'Neutral', neutral: 'Neutral' }[text.toLowerCase()] || text;
}

export function monsterGearName(value) {
  const text = String(value || '').trim();
  if (/^leather(?:\s+armor)?$/i.test(text)) return 'Leather Armor';
  if (/^chain\s*mail$/i.test(text)) return 'Chainmail';
  if (/^plate(?:\s+(?:mail|armor))?$/i.test(text)) return 'Plate Mail';
  if (/^shield$/i.test(text)) return 'Shield';
  return text;
}

export function normalizeMonsterGearItem(item) {
  return { ...item, name: monsterGearName(item?.name) };
}
