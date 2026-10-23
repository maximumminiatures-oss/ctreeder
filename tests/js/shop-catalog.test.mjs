import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { SHOP_CATEGORIES, STARTING_ROOM_SHOP_ITEMS, createShopGearItem } from '../../S3_content/src/shop-catalog.js';

const catalog = STARTING_ROOM_SHOP_ITEMS;
const find = id => catalog.find(item => item.id === id);

test('shop catalog covers the core gear tables once, omitting coins/gems and including both mithral armors', () => {
  assert.deepEqual(SHOP_CATEGORIES.map(tab => tab.label), ['BASIC GEAR', 'ARMOR', 'WEAPONS']);
  assert.deepEqual(SHOP_CATEGORIES.map(tab => catalog.filter(item => item.category === tab.id).length), [16, 6, 15]);
  assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
  assert.equal(new Set(catalog.map(item => item.name.toLowerCase())).size, catalog.length);
  assert.ok(!catalog.some(item => /^(?:coin|gold|gem)s?$/i.test(item.name)));
  assert.deepEqual(catalog.filter(item => item.category === 'weapons').map(item => [item.id, item.costCopper]), [
    ['bastard-sword', 1000], ['club', 5], ['crossbow', 800], ['dagger', 100], ['greataxe', 1000],
    ['greatsword', 1200], ['javelin', 50], ['longbow', 800], ['longsword', 900], ['mace', 500],
    ['shortbow', 600], ['shortsword', 700], ['spear', 50], ['staff', 50], ['warhammer', 1000]
  ]);
  for (const [id, copper, slots] of [['leather-armor', 1000, 1], ['chainmail', 6000, 2], ['plate-mail', 13000, 3],
    ['shield', 1000, 1], ['mithral-chainmail', 24000, 1], ['mithral-plate-mail', 52000, 2]]) {
    assert.equal(find(id).costCopper, copper); assert.equal(find(id).slots, slots);
  }
  for (const [id, copper] of [['torch', 50], ['rations', 50], ['flint-and-steel', 50], ['lantern', 500], ['oil-flask', 50]])
    assert.equal(find(id).costCopper, copper, 'legacy supply IDs and prices stay stable');
});

test('purchased items preserve bundle quantities, per-unit values, and usable equipment metadata', () => {
  for (const [id, quantity] of [['arrows', 20], ['crossbow-bolts', 20], ['iron-spikes', 10], ['rations', 3]]) {
    const item = createShopGearItem(find(id));
    assert.equal(item.totalUnits, quantity); assert.equal(item.slots, 1);
    assert.equal(Math.round(item.costGp * item.totalUnits * 100), find(id).costCopper);
  }
  const weapon = createShopGearItem(find('greatsword'));
  assert.equal(weapon.type, 'weapon'); assert.equal(weapon.damage, '1d12'); assert.equal(weapon.equipped, false);
  const armor = createShopGearItem(find('mithral-chainmail'));
  assert.equal(armor.type, 'armor'); assert.equal(armor.ac, 13); assert.equal(armor.slots, 1);
  assert.throws(() => createShopGearItem({ id: 'coin' }), /no fixed purchase price/);
});

test('mithral and unequipped armor do not impose the ordinary heavy-armor stealth penalty', () => {
  const source = fs.readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function characterWearsHeavyStealthArmor('), source.indexOf('function performStealth(')), context);
  for (const name of ['Mithral chainmail', 'Mithral plate mail'])
    assert.equal(context.characterWearsHeavyStealthArmor({ gear: [{ name, equipped: true }] }), false);
  assert.equal(context.characterWearsHeavyStealthArmor({ gear: [{ name: 'Chainmail', equipped: true }] }), true);
  assert.equal(context.characterWearsHeavyStealthArmor({ gear: [{ name: 'Plate mail', equipped: false }] }), false);
});

test('shop tabs replace the item list without closing, preserve the active tab on purchase, and retain X dismissal', () => {
  const dom = new JSDOM('<button id="anchor">Shop</button>');
  const character = { id: 'hero', name: 'Hero', gold: 1000, silver: 0, copper: 0 };
  let buys = 0;
  const context = vm.createContext({ document: dom.window.document, window: dom.window, SHOP_CATEGORIES, STARTING_ROOM_SHOP_ITEMS,
    getCurrentCharacter: () => character, canControlCharacter: () => true, isCharacterAbleToAct: () => true,
    isCharacterInStartingRoom: () => true, isCombatActive: () => false, state: { characters: [character] },
    getCharacterMoney: (character, coin) => character[coin], ensurePartyAssets: () => ({ gold: 0, silver: 0, copper: 0 }),
    getCharacterMoneyCopper: character => character.gold * 100, getMoneyCopper: () => 0,
    formatPartyAssetsText: () => 'Party Assets: 0 Gold', formatMoneyParts: () => '0 gp', formatFieldName: name => name,
    buyStartingRoomShopItem: () => { buys++; character.gold--; }, closeActiveSellPanel() {}, setTimeout: callback => callback() });
  vm.runInContext('let activeShopPanel=null, activeShopRefresh=null, activeShopCleanup=null;', context);
  const source = fs.readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function closeActiveShopPanel('), source.indexOf('function createSdDismissPanel(')), context);
  try {
    context.openStartingRoomShop(character, dom.window.document.getElementById('anchor'));
    const panel = dom.window.document.querySelector('.sd-buy-popover');
    assert.equal(panel.querySelector('[role=tab][aria-selected=true]').textContent, 'BASIC GEAR');
    assert.equal(panel.querySelectorAll('.sd-shop-row').length, 16);
    panel.querySelector('#sd-shop-tab-weapons').click();
    assert.equal(dom.window.document.querySelector('.sd-buy-popover'), panel);
    assert.equal(panel.querySelectorAll('.sd-shop-row').length, 15);
    assert.equal(panel.querySelectorAll('[data-shop-item=torch]').length, 0);
    panel.querySelector('[data-shop-item=club]').click();
    assert.equal(buys, 1); assert.equal(panel.querySelector('[aria-selected=true]').textContent, 'WEAPONS');
    panel.querySelector('#sd-shop-tab-weapons').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(panel.querySelector('[aria-selected=true]').textContent, 'ARMOR');
    assert.equal(panel.querySelectorAll('.sd-shop-row').length, 6);
    assert.equal(panel.querySelectorAll('.sd-shop-close').length, 1);
    panel.querySelector('.sd-shop-close').click();
    assert.equal(dom.window.document.querySelector('.sd-buy-popover'), null);
    assert.match(source, /if \(activeShopPanel \|\| activeSellPanel\)[\s\S]*?closeActiveShopPanel\(\); closeActiveSellPanel\(\)/);
  } finally { context.closeActiveShopPanel(); dom.window.close(); }
});
