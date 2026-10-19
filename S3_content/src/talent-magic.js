import { enchantedEquipment, magicPotion, magicScroll, POTIONS, identifyMagicItem } from './magic-items.js';
import { treasureArmorBases } from './treasure.js';
import { ELEMENTS } from './elemental-effects.js';

const clone = value => JSON.parse(JSON.stringify(value));
const title = value => String(value).replace(/\b\w/g, letter => letter.toUpperCase());
const roll = (sides, random) => Math.floor(random() * sides) + 1;
const pick = (items, random) => {
  if (!items.length) throw new Error('No items of that type are available.');
  return items[Math.floor(random() * items.length)];
};

export function createTalentMagicItem(kind, character, { rules, spells, random = Math.random } = {}) {
  let item, tableRoll;
  if (kind === 'weapon' || kind === 'armor') {
    const base = pick(kind === 'weapon' ? rules?.weapons || [] : treasureArmorBases(rules), random);
    tableRoll = roll(kind === 'weapon' ? 80 : 75, random);
    let bonus = 0, elemental = null, elementDie = null;
    if (kind === 'weapon') {
      bonus = tableRoll <= 50 ? 1 : tableRoll <= 65 ? 2 : tableRoll <= 71 ? 3 : tableRoll === 79 ? 1 : tableRoll === 80 ? 2 : 0;
      if (tableRoll >= 72) { elemental = pick(ELEMENTS, random); elementDie = tableRoll <= 76 || tableRoll === 79 ? '1d4' : '1d6'; }
    } else {
      bonus = tableRoll <= 50 ? 1 : tableRoll <= 61 ? 2 : tableRoll <= 66 ? 3 : tableRoll <= 70 ? 0 : tableRoll <= 72 ? 1 : tableRoll <= 74 ? 2 : 3;
      if (tableRoll >= 67) elemental = pick(ELEMENTS, random);
    }
    item = bonus ? enchantedEquipment(base, kind, bonus) : { ...clone(base), type: kind, quantity: 1, totalUnits: 1,
      equipped: false, treasureItem: true, tags: ['Magic'], baseName: title(base.name), value: Number(base.costGp) || 0,
      magic: { kind, bonus: 0, identified: false, trueName: title(base.name) } };
    if (elemental) {
      if (kind === 'weapon') { item.magic.element = elemental; item.magic.elementDice = elementDie; }
      else item.magic.resistance = elemental;
      item.magic.trueName = kind === 'weapon' ? `${bonus ? `+${bonus} ` : ''}${title(elemental)} ${title(base.name)}`
        : `${bonus ? `+${bonus} ` : ''}${title(base.name)} of ${title(elemental)} Resistance`;
      item.value = Math.round(item.value * 150) / 100;
    }
  } else if (kind === 'wand') {
    tableRoll = roll(91, random);
    const tier = tableRoll <= 50 ? 1 : tableRoll <= 75 ? 2 : tableRoll <= 85 ? 3 : tableRoll <= 90 ? 4 : 5;
    const spell = pick(spells.filter(spell => spell.tier === tier && spell.classes.includes('wizard')), random);
    item = { name: 'Magic Wand', type: 'wand', slots: 1, quantity: 1, totalUnits: 1, treasureItem: true, tags: ['Magic'], value: magicScroll(spell).value * 10,
      magic: { kind: 'wand', spellName: spell.name, tier, classes: spell.classes, identified: false,
        trueName: `Wand of ${spell.name}` } };
  } else if (kind === 'scroll') {
    const maxTier = Math.min(5, Math.ceil((Number(character.level) || 1) / 2));
    const spell = pick(spells.filter(spell => spell.classes.includes('wizard') && (maxTier === 5 ? spell.tier === 5 : spell.tier > maxTier)), random);
    item = magicScroll(spell);
  } else if (kind === 'potion') {
    const total = POTIONS.reduce((sum, potion) => sum + potion.weight, 0); let value = random() * total;
    const potion = POTIONS.find(potion => (value -= potion.weight) < 0) || POTIONS.at(-1); item = magicPotion(potion.key);
  } else throw new Error('Choose weapon, armor, wand, potion, or scroll.');
  if (!item.magic.identified) identifyMagicItem(item);
  item.magic.createdByTalent = true; item.magic.creationRoll = tableRoll || null;
  return item;
}
