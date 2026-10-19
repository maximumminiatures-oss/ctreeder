export const DEITY_LORE = {
  'saint terragnis': 'Once a knight of justice, she sacrificed herself to save the world and ascended to godhood.',
  gede: 'She is the tree, the pine nut crushed, the pesto, the party, the lovers who met there, the wife who grieves, the drowned husband, and the tsunami that washed him to sea.',
  'madeera the covenant': 'Hark the innate laws: gravity, time, existence! But greater are the laws of sentience: the social contract, compassion, the old advise the young, elders, the infirm are cared for.',
  memnon: "Cat's eyes flash to the sparrow. His muscles flex, he leaps, swipes; claws pierce. The bird dies, as forgotten as the laws the feeble build against a universe they fear and can never control.",
  ramlaat: "The hubris of other gods drive their cronies to destroy us. Survive. That's what matters. Sharpen your blades!",
  ord: 'Wonder at the mysteries, for only I know all their depths. Every insightful question answered reveals three more questions and that is sacred. That is magic.',
  'shune the vile': 'Theft is liberation. Magic is of the dark wood, the wild sea. It wants freedom. But the powerful lock it in their vaults, their spellbooks. It must be taken in the night.'
};
export const ALIGNMENT_LORE = {
  chaotic: 'Destroy the status quo. Create the world you want. Rebel.',
  lawful: 'The world should be fair. All who are able, must help, so that none suffer.',
  neutral: 'All is born and all must die. Accept both joy and sorrow. Better to observe the world than to shape it in pride and folly.'
};
export function sheetLore(label, value) {
  const key = String(value || '').toLowerCase().trim();
  if (label === 'Alignment') return ALIGNMENT_LORE[key] || '';
  if (label !== 'Deity') return '';
  const aliases = { madeera: 'madeera the covenant', shune: 'shune the vile', 'saint terrangis': 'saint terragnis' };
  return DEITY_LORE[aliases[key] || key] || '';
}
export function talentPresentation(line) {
  const clean = String(line || '').replace(/\s*\(all thieves\)/gi, '').trim();
  if (/^(?:Spells|Languages):/i.test(clean)) return { text: clean, source: '' };
  const match = clean.match(/^([^:]+):\s*(.*)$/);
  return match ? { text: match[2], source: match[1] } : { text: clean, source: '' };
}
