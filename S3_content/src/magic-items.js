import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollDamageExpression } from './damage.js';
import { makeInvisible } from './concealment.js';
import { rollCheck } from './interactions.js';
import { forgottenSpells } from './arcane-effects.js';

const clone = value => JSON.parse(JSON.stringify(value));
const title = value => String(value).replace(/\b\w/g, char => char.toUpperCase());
export const isMagicItem = item => Boolean(item?.magic || item?.magical ||
  (Array.isArray(item?.tags) ? item.tags : String(item?.tags || '').split(',')).some(tag => /^magic(?: items?| gear| treasure)?$/i.test(String(tag).trim())) ||
  /\b(?:magic|magical|enchanted)\b/i.test(typeof item === 'string' ? item : item?.name || ''));
export const magicBonus = item => Math.max(0, Number(item?.magic?.bonus) || 0);
export const revealedMagicBonus = item => item?.magic?.identified ? magicBonus(item) : 0;
export const POTIONS = [
  { key: 'healing-1', name: 'Potion of Healing I', value: 50, healing: '1d6', weight: 15, identified: true },
  { key: 'healing-2', name: 'Potion of Healing II', value: 100, healing: '2d8', weight: 7 },
  { key: 'healing-3', name: 'Potion of Healing III', value: 150, healing: '3d10', weight: 4 },
  { key: 'healing-4', name: 'Potion of Healing IV', value: 200, healing: '4d12', weight: 2 },
  { key: 'giant-strength', name: 'Potion of Giant Strength', value: 200, weight: 6 },
  { key: 'invisibility', name: 'Potion of Invisibility', value: 80, weight: 9 },
  { key: 'vitality', name: 'Potion of Vitality', value: 500, weight: 2 }
];

export function enchantedEquipment(base, kind, bonus) {
  if (!['weapon', 'armor', 'ammunition'].includes(kind) || ![1, 2, 3].includes(bonus)) throw new Error('Invalid magic equipment.');
  const premiums = kind === 'armor' ? [0, 150, 300, 900] : [0, 200, 500, 900];
  const baseName = title(base.name);
  const bundle = kind === 'ammunition' ? Number(base.stackSize) || 20 : 1;
  return { ...clone(base), name: `Magic ${baseName}`, baseName, type: kind === 'ammunition' ? 'sundry' : kind,
    quantity: bundle, totalUnits: bundle, slots: base.slots ?? 1, equipped: false,
    value: Number(base.costGp || 0) + premiums[bonus], treasureItem: true, tags: ['Magic'],
    magic: { kind, bonus, identified: false, trueName: `+${bonus} ${baseName}`, originalUnits: bundle } };
}
export function magicPotion(key) {
  const potion = POTIONS.find(item => item.key === key);
  if (!potion) throw new Error('Unknown potion.');
  return { name: potion.identified ? potion.name : 'Potion', type: 'potion', slots: 1, quantity: 1, totalUnits: 1,
    value: potion.value, treasureItem: true, tags: ['Magic'],
    magic: { kind: 'potion', potion: key, trueName: potion.name, identified: !!potion.identified } };
}
export function magicScroll(spell) {
  const tier = Number(spell.tier);
  if (![1, 2, 3, 4, 5].includes(tier)) throw new Error('Invalid scroll tier.');
  return { name: 'Magic Scroll', type: 'scroll', slots: 1, quantity: 1, totalUnits: 1, treasureItem: true, tags: ['Magic'],
    value: [0, 80, 140, 200, 260, 360][tier] + Math.max(0, Number(spell.costGp) || 0),
    magic: { kind: 'scroll', spellName: spell.name, tier, classes: spell.classes || [],
      identified: false, trueName: `Scroll of ${spell.name}` } };
}
export function identifyMagicItem(item) {
  if (!item?.magic || item.magic.identified) throw new Error('Choose an unidentified magic item.');
  item.magic.identified = true;
  item.name = item.magic.trueName;
  item.tags = [...new Set([...(item.tags || []), 'Magic'])];
  if (item.magic.kind === 'scroll') item.description = `Tier ${item.magic.tier} scroll.`;
  return item.name;
}
export function magicSaleValue(item) {
  if (!item?.magic) return null;
  if (item.magic.pricePending) return null;
  const full = item.magic.identified ? Number(item.value) || 0 : 100;
  return item.magic.kind === 'ammunition'
    ? full * Math.max(0, Number(item.totalUnits ?? item.quantity) || 0) / (item.magic.originalUnits || 20)
    : full;
}

export function magicTreasureCatalog(rules, spells = [], level = 1) {
  const catalog = [];
  for (const bonus of [1, 2, 3]) {
    const depth = Math.max(0, Math.min(1, (level - 1) / 9));
    const weight = [0, .88 - .53 * depth, .10 + .30 * depth, .02 + .23 * depth][bonus];
    for (const item of rules?.weapons || []) catalog.push({ item: enchantedEquipment(item, 'weapon', bonus), weight: 20 * weight });
    for (const item of rules?.armor || []) catalog.push({ item: enchantedEquipment(item, 'armor', bonus), weight: 12 * weight });
    for (const item of (rules?.gear || []).filter(item => item.ammoType)) catalog.push({ item: enchantedEquipment(item, 'ammunition', bonus), weight: 10 * weight });
  }
  for (const spell of spells) catalog.push({ item: magicScroll(spell), weight: 5 / Number(spell.tier) ** 2 });
  for (const potion of POTIONS.filter(potion => potion.key !== 'healing-1')) catalog.push({ item: magicPotion(potion.key), weight: potion.weight });
  return catalog;
}

// Replace treasure only after ordinary budget balancing; magic prices never rescale.
export function placeMagicTreasure(state, rng, spells = []) {
  const treasures = (state.entities || []).filter(entity => entity.type === 'treasure' && !entity.collected && !entity.gearItem?.magic);
  if (!treasures.length || !state.rulesData) return;
  const budget = treasures.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const count = Math.max(0, Math.round(treasures.length * .2));
  const catalog = magicTreasureCatalog(state.rulesData, spells, state.level);
  const candidates = [...treasures];
  let spent = 0, placed = 0;
  for (let index = 0; index < count && candidates.length; index++) {
    const available = budget - spent - (treasures.length - index - 1) * .01;
    let item;
    if (rng.nextFloat() < .15 && available >= 50) item = magicPotion('healing-1');
    else {
      const eligible = catalog.filter(entry => entry.item.value <= available);
      if (!eligible.length) { if (available >= 50) item = magicPotion('healing-1'); else break; }
      else {
        const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = rng.nextFloat() * total;
        item = eligible.find(entry => (roll -= entry.weight) < 0)?.item || eligible.at(-1).item;
      }
    }
    const candidateIndex = rng.nextInt(0, candidates.length - 1);
    const entity = candidates.splice(candidateIndex, 1)[0];
    Object.assign(entity, { name: item.name, value: item.value, slots: item.slots, kind: 'magic', subtype: 'magic',
      coinBreakdown: null, gearItem: clone(item), tags: ['Magic'], priceless: false, description: item.description || '' });
    spent += item.value; placed++;
  }
  const remaining = treasures.filter(entity => !entity.gearItem?.magic);
  const current = remaining.reduce((sum, item) => sum + Number(item.value || 0), 0);
  let assigned = spent;
  for (const [index, entity] of remaining.entries()) {
    const value = index === remaining.length - 1 ? budget - assigned : (budget - spent) * (Number(entity.value || 0) / current);
    entity.value = Math.max(.01, Math.round(value * 100) / 100);
    assigned += entity.value;
    if (entity.coinBreakdown) {
      const copper = Math.round(entity.value * 100);
      entity.coinBreakdown = { gold: Math.floor(copper / 100), silver: Math.floor(copper % 100 / 10), copper: copper % 10 };
      const coins = Object.values(entity.coinBreakdown).reduce((sum, amount) => sum + amount, 0);
      entity.slots = Math.max(0, Math.ceil((coins - 100) / 100));
    }
    if (entity.gearItem) entity.gearItem.value = entity.value;
  }
  state.generation.magicTreasureCount = placed;
  state.generation.treasureActualGp = treasures.reduce((sum, item) => sum + item.value, 0);
}

export const giantStrengthActive = character => (character?.potionEffects || []).some(effect => effect.type === 'giant-strength' && effect.rounds > 0);
export function drinkPotion(character, index, { random = Math.random, checkRoll = rollCheck } = {}) {
  const item = character.gear?.[index], potion = POTIONS.find(potion => potion.key === item?.magic?.potion);
  if (!potion || item.magic.kind !== 'potion') throw new Error('Choose a potion to drink.');
  let detail;
  if (potion.healing) {
    const roll = rollDamageExpression(potion.healing, random);
    const before = Number(character.hp) || 0;
    setCharacterHp(character, before + roll.total);
    detail = `${character.hp - before} HP restored (${roll.expression} = ${roll.total}).`;
  } else if (potion.key === 'invisibility') {
    makeInvisible(character, { rounds: 10, source: 'potion', breakOnOffense: true });
    detail = 'Invisible for 10 rounds, or until attacking or casting.';
  } else if (potion.key === 'giant-strength') {
    character.potionEffects ||= [];
    const existing = character.potionEffects.find(effect => effect.type === 'giant-strength');
    if (existing) existing.rounds = 10;
    else character.potionEffects.push({ type: 'giant-strength', rounds: 10, originalStrength: Number(character.stats.STR) });
    character.stats.STR = 18;
    detail = 'STR 18 and double melee damage for 10 rounds.';
  } else {
    character.vitalityPotionsDrunk = (Number(character.vitalityPotionsDrunk) || 0) + 1;
    const result = character.vitalityPotionsDrunk > 1 ? checkRoll(abilityScoreModifier(character.stats.CON)) : null;
    if (result && result.total < 18) {
      character.dead = true; character.slain = true; character.dyingRounds = 0; character.hp = 0;
      character.focusSpell = null; character.pendingSpell = null;
      detail = `CON ${result.total} vs DC 18: failed; dies instantly.`;
    } else {
      const sides = /fighter/i.test(character.className) ? 8 : /priest/i.test(character.className) ? 6 : 4;
      const roll = Math.floor(random() * sides) + 1;
      character.maxHitPoints += roll;
      character.hp += roll;
      detail = `${result ? `CON ${result.total} vs DC 18: passed; ` : ''}permanently gains ${roll} HP (1d${sides}).`;
    }
  }
  character.gear[index] = { name: 'Empty flask', type: 'sundry', slots: 1, quantity: 1, totalUnits: 1, value: .3 };
  character.raw ||= {};
  Object.assign(character.raw, { gear: clone(character.gear), stats: clone(character.stats), hp: character.hp,
    maxHitPoints: character.maxHitPoints, potionEffects: clone(character.potionEffects || []), vitalityPotionsDrunk: character.vitalityPotionsDrunk });
  return { message: `${character.name} drinks ${item.magic.identified ? potion.name : 'a potion'}: ${detail}` };
}
export function advancePotionRounds(state, rounds = 1) {
  for (const character of state.characters || []) {
    for (const effect of character.potionEffects || []) {
      effect.rounds -= rounds;
      if (effect.type === 'giant-strength' && effect.rounds <= 0) character.stats.STR = effect.originalStrength;
    }
    character.potionEffects = (character.potionEffects || []).filter(effect => effect.rounds > 0);
  }
}

export function queueScrollLearning(character, index) {
  const item = character.gear?.[index];
  if (forgottenSpells(character).has(item?.magic?.spellName?.toLowerCase())) throw new Error('The ability to cast this spell was permanently lost.');
  if (character.companion?.kind === 'doppelganger' || !/wizard/i.test(character.className) || item?.magic?.kind !== 'scroll' || !item.magic.classes.includes('wizard')) throw new Error('Only wizards can learn wizard spells from scrolls.');
  if (!item.magic.identified) throw new Error('Identify the scroll first.');
  if (String(character.spellsKnown || '').split(/,\s*/).some(name => name.toLowerCase() === item.magic.spellName.toLowerCase())) throw new Error('This wizard already knows that spell.');
  item.magic.learnOnRest = true;
  return { message: 'will attempt on next rest.' };
}
export function learnQueuedScrolls(character, checkRoll = rollCheck) {
  const results = [];
  if (!/wizard/i.test(character.className) || character.dead || character.slain || Number(character.hp) <= 0) return results;
  for (const [index, item] of (character.gear || []).entries()) {
    if (item.magic?.kind !== 'scroll' || !item.magic.learnOnRest || !item.magic.classes.includes('wizard')) continue;
    const check = checkRoll(abilityScoreModifier(character.stats?.INT));
    const succeeded = check.total >= 15;
    const name = item.magic.spellName;
    character.gear[index] = { name: 'Blank paper', slots: 1, quantity: 1, totalUnits: 1, value: 1, type: 'sundry' };
    if (succeeded) {
      character.spellsKnown = [...new Set([...String(character.spellsKnown || '').split(/,\s*/).filter(Boolean), name])].join(', ');
      character.learnedScrollSpells = [...new Set([...(character.learnedScrollSpells || []), name])];
    }
    results.push({ characterId: character.id, spell: name, check, succeeded,
      message: `${character.name} ${succeeded ? 'learned' : 'failed to learn'} ${name}` });
  }
  return results;
}
