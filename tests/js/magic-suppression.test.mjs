import test from 'node:test';
import assert from 'node:assert/strict';
import { isMagicSuppressed, suppressMagic, advanceMagicSuppression, hasMagicSuppression } from '../../S3_content/src/magic-suppression.js';
import { enchantedEquipment, magicBonus, revealedMagicBonus, magicPotion, magicScroll,
  identifyMagicItem, isMagicItem, magicSaleValue, drinkPotion, POTIONS } from '../../S3_content/src/magic-items.js';
import { elementalDamage, elementalSaveOptions, resistanceType } from '../../S3_content/src/elemental-effects.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';
import { ensureMonsterGear, transferredMonsterGear } from '../../S3_content/src/companions.js';

const clone = value => JSON.parse(JSON.stringify(value));
const weapon = () => enchantedEquipment({ name: 'longsword', damage: '1d8', slots: 1, costGp: 9 }, 'weapon', 2);
const hero = gear => ({ id: 'hero', name: 'Hero', className: 'Wizard', hp: 2, maxHitPoints: 8,
  stats: { STR: 9, DEX: 10, CON: 12, INT: 14, WIS: 10, CHA: 10 }, gear });
const withoutDisplay = ({ name, magicSuppression, ...item }) => item;

test('suppression preserves mundane stats, identity, tags, price and all magic metadata', () => {
  for (const kind of ['weapon', 'armor', 'ammunition']) {
    const item = enchantedEquipment({ name: 'custom gear', damage: '1d8', ac: 14,
      attackBonus: 1, slots: 2, costGp: 15, stackSize: 20 }, kind, 3);
    Object.assign(item, { id: 'gear-id', instanceId: 'instance-id', equipped: true, metadata: { artist: 'original' } });
    Object.assign(item.magic, { element: 'fire', elementDice: '1d6', resistance: 'cold' });
    identifyMagicItem(item);
    const before = clone(item), price = magicSaleValue(item);
    assert.equal(magicBonus(item), 3);
    assert.equal(revealedMagicBonus(item), 3);
    assert.equal(suppressMagic(item), true);
    assert.equal(item.name, 'non-magical Custom Gear');
    assert.deepEqual(item.magicSuppression, { rounds: 10, originalName: before.name });
    assert.deepEqual(withoutDisplay(item), withoutDisplay(before));
    assert.equal(isMagicItem(item), true);
    assert.equal(magicSaleValue(item), price);
    assert.equal(magicBonus(item), 0);
    assert.equal(revealedMagicBonus(item), 0);
    advanceMagicSuppression({ characters: [hero([item])] }, 10);
    assert.deepEqual(item, before);
    assert.equal(magicBonus(item), 3);
  }
});

test('runtime gear names strip enchantments only when no actual baseName is present', () => {
  for (const name of ['Magic Longsword', '+2 Longsword', 'Magic +2 Longsword', 'Longsword +2']) {
    const item = { name, type: 'weapon', magic: { bonus: 2 } };
    suppressMagic(item);
    assert.equal(item.name, 'non-magical Longsword');
    advanceMagicSuppression({ entities: [{ gearItem: item }] }, 10);
    assert.equal(item.name, name);
  }
  const item = { name: '+3 Unrelated Alias', baseName: 'Sword of Magic +1', magic: { kind: 'weapon', bonus: 3 } };
  suppressMagic(item);
  assert.equal(item.name, 'non-magical Sword of Magic +1');
  assert.equal(item.baseName, 'Sword of Magic +1');
});

test('unidentified gear stays unidentified; identification during suppression does not restore magic', () => {
  const item = weapon(), state = { characters: [hero([item])] };
  suppressMagic(item);
  assert.equal(item.magic.identified, false);
  assert.equal(magicSaleValue(item), 100);
  assert.equal(identifyMagicItem(item), 'non-magical Longsword');
  assert.equal(item.magic.identified, true);
  assert.equal(item.magicSuppression.originalName, '+2 Longsword');
  assert.equal(magicBonus(item), 0);
  advanceMagicSuppression(state, 10);
  assert.equal(item.name, '+2 Longsword');
  assert.equal(revealedMagicBonus(item), 2);
});

test('suppressed armor provides neither elemental resistance nor save advantage', () => {
  const armor = enchantedEquipment({ name: 'chainmail', ac: 14, slots: 2, costGp: 60 }, 'armor', 2);
  armor.equipped = true;
  armor.magic.resistance = 'cold';
  const character = hero([armor]);
  assert.deepEqual(elementalDamage(character, 9, 'freezing ray'), { original: 9, total: 4, resistance: 'cold' });
  suppressMagic(armor);
  assert.equal(armor.ac, 14);
  assert.equal(resistanceType(character, 'cold'), null);
  assert.deepEqual(elementalDamage(character, 9, 'freezing ray'), { original: 9, total: 9, resistance: null });
  assert.deepEqual(elementalSaveOptions(character, 'cold'), { doubleRoll: false, disadvantage: false });
  assert.deepEqual(elementalSaveOptions(character, 'cold', { disadvantage: true }), { doubleRoll: false, disadvantage: true });
  assert.deepEqual(elementalSaveOptions(character, 'cold', { advantage: true }), { doubleRoll: true, disadvantage: false });
  advanceMagicSuppression({ characters: [character] }, 10);
  assert.equal(elementalDamage(character, 9, 'cold').total, 4);
});

test('other unsuppressed equipped armor still provides resistance', () => {
  const first = { name: 'Magic Armor', equipped: true, magic: { resistance: 'fire' } };
  const second = clone(first), character = hero([first, second]);
  suppressMagic(first);
  assert.equal(elementalDamage(character, 9, 'fire').total, 4);
  second.equipped = false;
  assert.equal(elementalDamage(character, 9, 'fire').total, 9);
});

test('all suppressed potions are wasted without rolls, healing, conditions or vitality side effects', () => {
  for (const potion of POTIONS) {
    const item = magicPotion(potion.key), character = hero([item]);
    character.potionEffects = [{ type: 'giant-strength', rounds: 7, originalStrength: 9 }];
    character.stats.STR = 18;
    character.invisibility = { rounds: 6, source: 'potion', breakOnOffense: true };
    character.vitalityPotionsDrunk = 1;
    const before = clone(character), state = { characters: [character] };
    suppressMagic(item);
    assert.equal(item.name, 'Potion of No Effect');
    assert.deepEqual(character.potionEffects, before.potionEffects);
    const unexpectedRoll = () => { throw new Error('Suppressed potions must not roll.'); };
    assert.deepEqual(drinkPotion(character, 0, { random: unexpectedRoll, checkRoll: unexpectedRoll }), { message: 'Nothing happens.' });
    assert.deepEqual(character.gear[0], { name: 'Empty flask', type: 'sundry', slots: 1, quantity: 1, totalUnits: 1, value: .3 });
    for (const key of ['hp', 'maxHitPoints', 'stats', 'potionEffects', 'invisibility', 'vitalityPotionsDrunk']) {
      assert.deepEqual(character[key], before[key]);
    }
    assert.deepEqual(character.raw.gear, character.gear);
    assert.equal(hasMagicSuppression(state), false);
    advanceMagicSuppression(state, 10);
    assert.equal(character.gear[0].name, 'Empty flask');
    assert.equal(character.gear[0].magic, undefined);
    const loaded = clone(state);
    normalizeCharacterState(loaded);
    advanceMagicSuppression(loaded, 10);
    assert.equal(loaded.characters[0].gear[0].name, 'Empty flask');
    assert.equal(loaded.characters[0].gear[0].magic, undefined);
  }
});

test('an undrunk potion regains its exact original name and effect after expiry', () => {
  const item = magicPotion('healing-1'), character = hero([item]), state = { characters: [character] };
  suppressMagic(item);
  advanceMagicSuppression(state, 10);
  assert.equal(item.name, 'Potion of Healing I');
  assert.match(drinkPotion(character, 0, { random: () => .99 }).message, /6 HP restored/);
  assert.equal(character.hp, 8);
});

test('wands retain all activation metadata while scroll items cannot be suppressed', () => {
  const wand = { name: 'Wand of Sleep', type: 'wand', id: 'wand', value: 800, tags: ['Magic'],
    magic: { kind: 'wand', spellName: 'Sleep', tier: 1, classes: ['wizard'], identified: true, disabledUntilRest: true } };
  const before = clone(wand);
  assert.equal(suppressMagic(wand), true);
  assert.equal(wand.name, 'non-magical wand');
  assert.equal(isMagicSuppressed(wand), true);
  assert.deepEqual(withoutDisplay(wand), withoutDisplay(before));
  const scroll = magicScroll({ name: 'Light', tier: 1, classes: ['wizard'] }), originalScroll = clone(scroll);
  const drop = { type: 'treasure', name: scroll.name, tags: ['Magic'], gearItem: scroll };
  assert.equal(suppressMagic(scroll), false);
  assert.equal(suppressMagic(drop), false);
  assert.equal(suppressMagic({ type: 'scroll', name: 'Magic Scroll', magical: true }), false);
  assert.deepEqual(scroll, originalScroll);
  assert.equal(isMagicSuppressed(scroll), false);
  advanceMagicSuppression({ entities: [drop], characters: [hero([wand])] }, 10);
  assert.deepEqual(wand, before);
});

test('one clock pass visits shared party, monster, dropped, treasure, trap, door and corpse holdings once', () => {
  const shared = weapon(), monsterItem = weapon(), dropped = weapon(), corpseItem = weapon();
  const legacyTreasure = weapon(), legacyMagicItem = weapon();
  const trap = { type: 'trap', name: 'Magic glyph', magical: true, dc: 15 };
  const door = { type: 'feature', subtype: 'door', name: 'Sealed door', tags: ['Magic'], locked: true };
  const treasure = { type: 'treasure', name: dropped.name, value: dropped.value, gearItem: dropped };
  for (const item of [shared, monsterItem, corpseItem, legacyTreasure, legacyMagicItem, trap, door, treasure]) suppressMagic(item);
  const character = hero([shared]);
  character.treasures = [legacyTreasure];
  character.magicItems = [legacyMagicItem];
  const state = { characters: [character], entities: [
    { type: 'monster', gear: [monsterItem, shared], carriedGear: [monsterItem] }, treasure, trap, door,
    { type: 'feature', subtype: 'character-corpse', gear: [corpseItem] }
  ], droppedGear: [dropped], features: [door], traps: [trap], doors: [door], corpseGear: [corpseItem] };
  state.entities.push(state);
  const rawOnly = weapon();
  suppressMagic(rawOnly);
  state.characters[0].raw = { gear: [rawOnly] };
  assert.equal(hasMagicSuppression(state), true);
  assert.equal(advanceMagicSuppression(state, 9), true);
  for (const item of [shared, monsterItem, dropped, corpseItem, legacyTreasure, legacyMagicItem, trap, door, treasure]) {
    assert.equal(item.magicSuppression.rounds, 1);
  }
  assert.equal(rawOnly.magicSuppression.rounds, 10);
  assert.equal(trap.dc, 15);
  assert.equal(door.locked, true);
  advanceMagicSuppression(state, 1);
  assert.equal(hasMagicSuppression(state), false);
  assert.equal(advanceMagicSuppression(state, 1), false);
  assert.equal(treasure.name, 'Magic Longsword');
  assert.equal(dropped.name, 'Magic Longsword');
});

test('suppression survives JSON save/load, normalization, drop, monster transfer and pickup', () => {
  const item = weapon();
  item.instanceId = 'persistent-item';
  suppressMagic(item);
  let state = clone({ characters: [hero([item])], entities: [] });
  normalizeCharacterState(state);
  let current = state.characters[0].gear[0];
  assert.equal(current.name, 'non-magical Longsword');
  assert.equal(magicBonus(current), 0);
  advanceMagicSuppression(state, 3);
  state.entities.push({ type: 'treasure', subtype: 'dropped-equipment', name: current.name, gearItem: clone(current) });
  state.characters[0].gear = [];
  state = clone(state);
  current = state.entities.pop().gearItem;
  const monster = { type: 'monster', gear: [current] };
  ensureMonsterGear(monster);
  state.entities.push(monster);
  advanceMagicSuppression(state, 2);
  current = transferredMonsterGear(monster.gear.pop());
  monster.carriedGear = [];
  state.characters[0].gear.push(current);
  state = clone(state);
  current = state.characters[0].gear[0];
  assert.equal(current.instanceId, 'persistent-item');
  assert.equal(current.magicSuppression.rounds, 5);
  assert.equal(current.name, 'non-magical Longsword');
  advanceMagicSuppression(state, 5);
  assert.equal(current.name, 'Magic Longsword');
  assert.equal(magicBonus(current), 2);
});

test('expiry never recreates removed items or revisits obsolete item references', () => {
  const item = weapon(), character = hero([item]), state = { characters: [character] };
  suppressMagic(item);
  character.gear.splice(0, 1);
  assert.equal(hasMagicSuppression(state), false);
  advanceMagicSuppression(state, 20);
  assert.deepEqual(character.gear, []);
  assert.equal(item.magicSuppression.rounds, 10);
});

test('reapplying extends but never shortens suppression or loses the original name', () => {
  const item = weapon(), state = { entities: [{ gearItem: item }] };
  assert.equal(suppressMagic(item), true);
  assert.equal(suppressMagic(item), false);
  assert.equal(suppressMagic(item, 2), false);
  advanceMagicSuppression(state, 4);
  assert.equal(suppressMagic(item), true);
  assert.deepEqual(item.magicSuppression, { rounds: 10, originalName: 'Magic Longsword' });
  advanceMagicSuppression(state, 10);
  assert.equal(item.name, 'Magic Longsword');
});

test('invalid durations and mundane objects do not mutate state', () => {
  const mundane = { name: 'Longsword', type: 'weapon', damage: '1d8' };
  assert.equal(suppressMagic(mundane), false);
  assert.deepEqual(mundane, { name: 'Longsword', type: 'weapon', damage: '1d8' });
  for (const rounds of [0, -1, NaN, Infinity, 'invalid']) {
    const item = weapon(), before = clone(item);
    assert.equal(suppressMagic(item, rounds), false);
    assert.deepEqual(item, before);
    suppressMagic(item);
    assert.equal(advanceMagicSuppression({ characters: [hero([item])] }, rounds), false);
    assert.equal(item.magicSuppression.rounds, 10);
  }
  for (const object of [null, undefined, 'Magic Sword', 0]) {
    assert.equal(suppressMagic(object), false);
    assert.equal(isMagicSuppressed(object), false);
  }
});
