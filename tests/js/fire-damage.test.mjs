import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFireToTreasure, treasureFireResponse } from '../../S3_content/src/fire-damage.js';
import { matchesTreasureTypeName } from '../../S3_content/src/treasure.js';

const loot = (name, kind, extra = {}) => ({ type: 'treasure', name, kind, value: 100, ...extra });

test('instrument vocabulary uses cornet and excludes the two confirmed typos', () => {
  assert.equal(matchesTreasureTypeName('cornet', 'instrument'), true);
  assert.equal(matchesTreasureTypeName('coronet', 'instrument'), false);
  assert.equal(matchesTreasureTypeName('sludra', 'instrument'), false);
  assert.equal(treasureFireResponse(loot('cornet', 'gear')), 'charred');
});

test('instruments and wooden/leather objects char exactly once and keep half value', () => {
  for (const item of [loot('silver trumpet', 'instrument'), loot('wooden shield', 'shield'), loot('masterwork hide', 'leather'),
    loot('padded', 'leather'), loot('hardened cloth', 'leather'), loot('wooden mask', 'jewels'), loot('lute', 'gear')]) {
    const name = item.name;
    assert.equal(treasureFireResponse(item), 'charred');
    applyFireToTreasure(item);
    assert.equal(item.name, 'charred ' + name);
    assert.equal(item.value, 50);
    assert.equal(applyFireToTreasure(item), null);
    assert.equal(item.value, 50);
  }
});

test('herbs, clothing, books, scrolls and rope become zero-value ash without usable gear', () => {
  for (const item of [loot('a bag of saffron', 'herbs'), loot('leather boots', 'clothing'), loot('silk robe', 'clothing'),
    loot('book', 'gear'), loot('scroll of old tax records', 'gear'), loot("rope 60'", 'gear', { subtype: 'dropped-equipment', gearItem: { name: 'Rope', value: 1 } })]) {
    assert.equal(treasureFireResponse(item), 'ash');
    applyFireToTreasure(item);
    assert.equal(item.name, 'ash pile');
    assert.equal(item.value, 0);
    assert.equal(item.kind, 'worthless-loot');
    assert.equal(item.gearItem, undefined);
  }
});

test('weapons, coins, gems, metal jewelry/armor, bone armor, rations and oil survive', () => {
  for (const item of [loot('wooden staff', 'weapon'), loot('leather grip dagger', 'dagger'), loot('ruby', 'gems'),
    loot('gold crown', 'jewels'), loot('bone armor', 'leather'), loot('steel bracers', 'clothing'),
    loot('bronze gauntlets', 'clothing'), loot('plate mail', 'platemail'), loot('chainmail', 'chainmail'),
    loot('rations', 'gear'), loot('oil flask', 'gear'), loot('coin pouch', 'coin-cache', { coinBreakdown: { gold: 100 } })]) {
    assert.equal(applyFireToTreasure(item), null, item.name);
    assert.equal(item.value, 100);
  }
});

test('magical treasures are protected and items already collected are outside fire exposure', () => {
  for (const item of [loot('magic flute', 'instrument'), loot('enchanted leather armor', 'leather'),
    loot('Cloak of Elvenkind', 'magic-item', { tags: ['clothing', 'wondrous item'] }),
    loot('Robe', 'clothing', { isMagical: true }), loot('rope', 'gear', { collected: true })]) {
    assert.equal(applyFireToTreasure(item), null, item.name);
  }
});

test('dropped item sale values and fire provenance remain correct through another exposure', () => {
  const item = loot('wooden shield', 'equipment', { value: 0, gearItem: { name: 'wooden shield', costGp: 10, quantity: 1 } });
  applyFireToTreasure(item);
  assert.equal(item.value, 5);
  assert.equal(item.gearItem.value, 5);
  assert.equal(item.gearItem.name, 'charred wooden shield');
  const droppedAgain = loot(item.gearItem.name, 'equipment', { gearItem: structuredClone(item.gearItem) });
  assert.equal(applyFireToTreasure(droppedAgain), null);
  assert.equal(droppedAgain.gearItem.value, 5);
});
