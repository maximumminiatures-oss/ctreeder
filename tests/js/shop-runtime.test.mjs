import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { STARTING_ROOM_SHOP_ITEMS } from '../../S3_content/src/shop-catalog.js';
import { getCharacterCoinBagSlots } from '../../S3_content/src/characters.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)), { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene(gear = []) {
  return {
    seed: 123, level: 1, map: { width: 5, height: 5 }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width: 5, height: 5 }], entities: [],
    visibility: { exploredEver: ['2,2'] }, partyAssets: { gold: 50, silver: 0, copper: 0 },
    characters: [{ id: 'hero', name: 'Hero', ancestry: 'Half-Orc', className: 'Fighter', level: 1, xp: 7,
      stats: { STR: 20, DEX: 12, CON: 10, INT: 10, WIS: 10, CHA: 10 }, gold: 1000, silver: 0, copper: 0,
      hp: 10, maxHitPoints: 10, x: 2, y: 2, roomId: 'room', gear,
      equipmentInitialized: true, armorEquipmentInitialized: true }],
    player: { x: 2, y: 2, roomId: 'room', torchLit: false }, activeCharacterId: 'hero', combat: { active: false }
  };
}
const money = actor => actor.gold * 100 + actor.silver * 10 + actor.copper;
const buy = (state, id) => executeGameCommand(state, { type: 'buy_gear', character_id: 'hero', item_id: id });

test('every catalog purchase works through authoritative commands with exact prices, quantities and no XP loss', async () => {
  for (const config of STARTING_ROOM_SHOP_ITEMS) {
    const result = await buy(scene(), config.id);
    const hero = result.state_json.characters[0], item = hero.gear.find(item => item.gearId === `shop-${config.id}`);
    assert.ok(item, `${config.name}: ${result.message}`);
    assert.equal(money(hero), 100000 - config.costCopper, config.name);
    assert.equal(result.state_json.partyAssets.gold, 50);
    assert.equal(hero.XP, 7); assert.equal(hero.hp, 10); assert.equal(hero.ancestry, 'Half-Orc');
    assert.equal(item.totalUnits, config.quantity || 1);
    assert.equal(item.equipped, false);
  }
});

test('payment draws personal coins first, then party assets, and rejects insufficient funds without adding gear', async () => {
  const input = scene(); input.characters[0].gold = 2; input.partyAssets.gold = 10;
  const result = await buy(input, 'leather-armor');
  assert.equal(money(result.state_json.characters[0]), 0);
  assert.equal(result.state_json.partyAssets.gold, 2);
  const failed = await buy(result.state_json, 'plate-mail');
  assert.equal(failed.state_json.characters[0].gear.length, 1);
  assert.equal(failed.state_json.partyAssets.gold, 2);
  assert.match(failed.message, /not enough/i);
  await assert.rejects(() => buy(scene(), 'coin'), /Buy supplies only/);
  await assert.rejects(() => buy(scene(), 'gem'), /Buy supplies only/);
});

test('spikes and ammunition occupy one bundle slot; mithral armor uses its reduced slots and retains AC', async () => {
  for (const [id, slots] of [['iron-spikes', 1], ['arrows', 1], ['crossbow-bolts', 1], ['rations', 1],
    ['chainmail', 2], ['plate-mail', 3], ['mithral-chainmail', 1], ['mithral-plate-mail', 2]]) {
    let result = await buy(scene(), id);
    assert.equal(result.state_json.characters[0].gearSlotsUsed - getCharacterCoinBagSlots(result.state_json.characters[0]), slots, id);
    if (id.startsWith('mithral')) {
      result = await executeGameCommand(result.state_json, { type: 'equip', character_id: 'hero', gear_index: 0, equipped: true });
      assert.equal(result.state_json.characters[0].armorClass, id === 'mithral-chainmail' ? 14 : 15);
      assert.equal(result.state_json.characters[0].gearSlotsUsed - getCharacterCoinBagSlots(result.state_json.characters[0]), slots);
    }
  }
});

test('full inventory sends purchases to the floor, except the first free-to-carry backpack', async () => {
  const gear = Array.from({ length: 20 }, () => ({ name: 'Pole', totalUnits: 1, slots: 1 }));
  const backpack = await buy(scene(gear), 'backpack');
  assert.equal(backpack.state_json.characters[0].gear.length, 21);
  assert.equal(backpack.state_json.characters[0].gearSlotsUsed, 20);
  const torch = await buy(backpack.state_json, 'torch');
  assert.equal(torch.state_json.characters[0].gear.length, 21);
  assert.ok(torch.state_json.entities.some(entity => entity.subtype === 'dropped-equipment' && entity.gearItem.name === 'Torch'));
});
