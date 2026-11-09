import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { buildMonsterCompanion } from '../../S3_content/src/companions.js';
import { equipItem, equipArmor, ensureEquipment } from '../../S3_content/src/equipment.js';
import { companionEquipmentClass } from '../../S3_content/src/darkvision.js';
import { getCharacterGearFreeSlots } from '../../S3_content/src/characters.js';
import { climbFromPit } from '../../S3_content/src/pits.js';
import { defeatMonster } from '../../S3_content/src/interactions.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
const { monsters } = JSON.parse(await readFile(new URL('data/shadowdark-content.json', root), 'utf8'));
test.after(() => dom.window.close());

function scene(form = 'Skeleton', gear = []) {
  const source = structuredClone(monsters.find(monster => monster.slug === form.toLowerCase()));
  const child = buildMonsterCompanion({ ...source, id: 'original', x: 3, y: 3, roomId: 'room' },
    { id: 'child', kind: 'animate-dead', controllerId: 'caster' });
  child.gear = structuredClone(gear);
  child.companion.animateDead = { casterId: 'caster', form, remainingMs: 86400000 };
  child.colorId = 'blue'; child.raw = { colorId: 'blue' };
  const cells = Array.from({ length: 81 }, (_, i) => `${i % 9},${Math.floor(i / 9)}`);
  return { seed: 123, level: 1, map: { width: 9, height: 9 }, generation: { entranceRoomId: 'room' },
    tiles: cells.map((_, i) => ({ x: i % 9, y: Math.floor(i / 9), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width: 9, height: 9 }],
    visibility: { visibleNow: cells, exploredEver: cells },
    entities: [{ id: 'lamp', type: 'feature', subtype: 'dropped-equipment', name: 'Magic lamp', lightSource: 'magic',
      lightRadius: 12, x: 1, y: 1, roomId: 'room', visible: true },
    { id: 'foe', type: 'monster', name: 'Target', hp: 100, maxHp: 100, ac: 1, x: 4, y: 3,
      roomId: 'room', visible: true, hostile: false, attitude: 'neutral', attitudeChecked: true, attack: '1 claw +0 (1d4)' }],
    characters: [child, { id: 'caster', name: 'Caster', ancestry: 'Human', className: 'Wizard', level: 5,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 18, WIS: 10, CHA: 10 }, hp: 20, maxHitPoints: 20,
      x: 2, y: 3, roomId: 'room', colorId: 'red', colorValue: 'rgb(127, 0, 0)', gear: [], equipmentInitialized: true }],
    player: { x: 3, y: 3, roomId: 'room' }, activeCharacterId: 'child', combat: { active: false } };
}
const childOf = state => state.characters.find(actor => actor.id === 'child');
async function command(state, values = { type: 'normalize' }) {
  const original = Math.random; Math.random = () => .5;
  try { return await executeGameCommand(state, { character_id: 'child', ...values }); }
  finally { Math.random = original; }
}

test('skeleton has only claw +1 for 1 damage without gear, not catalog weapons or natural chainmail AC', async () => {
  let result = await command(scene());
  assert.deepEqual(childOf(result.state_json).attacks, ['Claw: +1, 1, close']);
  assert.equal(childOf(result.state_json).armorClass, 10);
  result = await command(result.state_json, { type: 'attack', monster_id: 'foe', attack_index: 0 });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 99);
  assert.match(result.message, /12 hits for 1 damage/);
});

test('inherited mundane spiked mace uses skeleton +1, preserves metadata, and survives repeated save/normalize', async () => {
  const item = { name: 'Spiked Mace', type: 'weapon', equipped: true, slots: 1, damage: '1d6',
    nativeMonsterWeapon: true, attackBonus: 3, instanceId: 'unique-mace', provenance: { corpseId: 'bugbear' } };
  let result = await command(scene('Skeleton', [item]));
  for (let i = 0; i < 3; i++) result = await command(JSON.parse(JSON.stringify(result.state_json)));
  assert.deepEqual(childOf(result.state_json).attacks, ['Spiked Mace: +1, 1d6']);
  assert.deepEqual(childOf(result.state_json).gear[0], item);
  result = await command(result.state_json, { type: 'attack', monster_id: 'foe', attack_index: 0 });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 96);
  assert.match(result.message, /12 hits for 4 damage/);
});

test('skeleton can equip fighter weapons, armor, shields, torches and lanterns', async () => {
  for (const [name, type] of [['Warhammer', 'weapon'], ['Shortbow', 'weapon'], ['Plate Mail', 'armor'],
    ['Shield', 'armor'], ['Torch', 'sundry'], ['Lantern', 'sundry']]) {
    let result = await command(scene('Skeleton', [{ name, type, equipped: false, slots: 1 }]));
    result = await command(result.state_json, { type: 'equip', gear_index: 0, equipped: true });
    assert.equal(childOf(result.state_json).gear[0].equipped, true, name);
    assert.equal(companionEquipmentClass(childOf(result.state_json)), 'fighter');
    if (name === 'Plate Mail') assert.equal(childOf(result.state_json).armorClass, 15);
  }
});

test('zombie inherited worn and held gear becomes carried, with metadata and strength capacity intact', async () => {
  const gear = [{ name: 'Spiked Mace', type: 'weapon', equipped: true, attackBonus: 3, slots: 1, instanceId: 'mace' },
    { name: 'Plate Mail', type: 'armor', equipped: true, slots: 3, magic: { identified: true, bonus: 1 } },
    { name: 'Shield', type: 'armor', equipped: true, slots: 1 },
    { name: 'Torch', type: 'sundry', equipped: true, lit: true, slots: 1 },
    { name: 'Lantern', type: 'sundry', equipped: true, lit: true, slots: 1 }];
  let result = await command(scene('Zombie', gear));
  const child = childOf(result.state_json);
  assert.deepEqual(child.gear, gear.map(item => ({ ...item, equipped: false })));
  assert.equal(child.armorClass, 8); assert.equal(child.lightRadius, 0);
  assert.equal(child.gearSlotsTotal, child.stats.STR);
  assert.equal(getCharacterGearFreeSlots(child), child.stats.STR - 7);
  assert.equal(companionEquipmentClass(child), null);
  const direct = structuredClone(child);
  assert.equal(equipItem(direct, 0, true), false);
  assert.equal(equipArmor(direct, 1, true, item => item.type === 'armor'), false);
  direct.gear.forEach(item => { item.equipped = true; }); ensureEquipment(direct);
  assert.ok(direct.gear.every(item => !item.equipped));
  for (let index = 0; index < gear.length; index++) await assert.rejects(
    () => command(result.state_json, { type: 'equip', gear_index: index, equipped: true }), /cannot equip/);
  await assert.rejects(() => command(result.state_json, { type: 'light', source: 'torch', gear_index: 3 }), /cannot equip/);
  result = await command(JSON.parse(JSON.stringify(result.state_json)));
  assert.deepEqual(childOf(result.state_json).gear, child.gear);
});

test('both undead reject forbidden skill and wake commands before spending resources, including a dead caster', async () => {
  for (const form of ['Skeleton', 'Zombie']) {
    const state = scene(form);
    state.characters[1].dead = true; state.characters[1].hp = 0;
    const normalized = (await command(state)).state_json;
    const snapshot = JSON.stringify(normalized);
    for (const type of ['wake', 'stealth', 'pick_lock', 'search']) {
      await assert.rejects(() => command(normalized, { type, target_id: 'caster' }), /Animated undead cannot/);
      assert.equal(JSON.stringify(normalized), snapshot);
    }
  }
});

test('undead match caster color regardless of party order and cannot change it through commands', async () => {
  for (const form of ['Skeleton', 'Zombie']) {
    let result = await command(scene(form));
    const child = childOf(result.state_json), caster = result.state_json.characters.find(actor => actor.id === 'caster');
    assert.equal(child.colorId, caster.colorId); assert.equal(child.colorValue, caster.colorValue);
    assert.equal(child.raw.colorId, caster.colorId); assert.equal(child.raw.colorValue, caster.colorValue);
    for (const type of ['color', 'set_color', 'change_color']) await assert.rejects(
      () => command(result.state_json, { type, color_id: 'green' }), /color always follows its caster/);
    await assert.rejects(() => command(result.state_json, { type: 'edit_character', character_json: { colorId: 'green' } }), /statistics are fixed/);
    const changedCaster = result.state_json.characters.find(actor => actor.id === 'caster');
    changedCaster.colorId = changedCaster.raw.colorId = 'green';
    changedCaster.colorValue = changedCaster.raw.colorValue = 'rgb(0, 127, 0)';
    result = await command(result.state_json);
    assert.equal(childOf(result.state_json).colorId, result.state_json.characters.find(actor => actor.id === 'caster').colorId);
  }
});

test('actual bugbear death drops and authoritative animation retain mace +1 and worn chainmail AC 13', async () => {
  let state = scene(); state.characters.shift(); state.activeCharacterId = 'caster';
  const caster = state.characters[0]; caster.spellsKnown = 'Animate Dead';
  state.player = { x: caster.x, y: caster.y, roomId: 'room' };
  const source = { ...structuredClone(monsters.find(monster => monster.slug === 'bugbear')), id: 'bugbear',
    type: 'monster', hp: 0, x: 3, y: 3, roomId: 'room',
    gear: [{ name: 'Spiked Mace', type: 'weapon', nativeMonsterWeapon: true, attackBonus: 3, damage: '1d6',
      equipped: true, slots: 1, instanceId: 'real-mace' },
    { name: 'Chainmail', type: 'armor', ac: 13, equipped: true, slots: 2, instanceId: 'real-mail' }] };
  state.entities.push(source); defeatMonster(state, source);
  const corpse = state.entities.find(entity => entity.subtype === 'corpse-loot');
  for (const values of [{ type: 'spell', spell_name: 'Animate Dead' }, { type: 'resolve_spell', option: 'skeleton' },
    { type: 'resolve_spell', target_id: corpse.id }]) state = (await command(state, { character_id: 'caster', ...values })).state_json;
  let child = state.characters.find(actor => actor.companion?.kind === 'animate-dead');
  assert.equal(child.companion.source.ac, 10); assert.match(child.companion.source.attack, /claw \+1/);
  assert.equal(child.armorClass, 13); assert.deepEqual(child.attacks, ['Spiked Mace: +1, 1d6']);
  assert.deepEqual(child.gear.map(item => item.instanceId), ['real-mace', 'real-mail']);
  assert.equal(child.companion.animateDead.corpseArmorClass, 13);
  state = (await command(JSON.parse(JSON.stringify(state)), { type: 'normalize', character_id: child.id })).state_json;
  child = state.characters.find(actor => actor.id === child.id);
  assert.equal(child.armorClass, 13); assert.deepEqual(child.attacks, ['Spiked Mace: +1, 1d6']);
});

test('both undead can open and smash doors, pick up cargo, and climb with STR', async () => {
  for (const form of ['Skeleton', 'Zombie']) {
    const input = scene(form);
    input.entities.push({ id: 'door', type: 'feature', subtype: 'door', doorState: 'closed', x: 3, y: 4,
      wallSide: 'south', orientation: 'horizontal' });
    let result = await command(input, { type: 'interact', x: 3, y: 4 });
    assert.equal(result.state_json.entities.find(entity => entity.id === 'door').doorState, 'open', result.message);
    const door = result.state_json.entities.find(entity => entity.id === 'door');
    door.doorState = 'locked'; door.breakDc = 1;
    result.state_json.lockedDoorAction = { doorId: 'door', breakDc: 1, pickDc: 12 };
    result = await command(result.state_json, { type: 'break_door' });
    assert.equal(result.state_json.entities.some(entity => entity.id === 'door'), false);
    result.state_json.entities.push({ id: 'cargo', type: 'treasure', subtype: 'dropped-equipment', kind: 'gear',
      name: 'Rope', slots: 1, x: 3, y: 3, roomId: 'room', visible: true, gearItem: { name: 'Rope', slots: 1 } });
    result = await command(result.state_json, { type: 'pickup', entity_id: 'cargo' });
    const child = childOf(result.state_json);
    assert.ok(child.gear.some(item => item.name === 'Rope'));
    assert.equal(child.gearSlotsTotal, child.stats.STR);
    const pit = { id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 3, roomId: 'room' };
    result.state_json.entities.push(pit); child.conditions = { sinkhole: pit.id };
    const climbed = climbFromPit(result.state_json, child, { check: modifier => {
      assert.equal(modifier, form === 'Skeleton' ? 1 : 2); return { total: 20, roll: 18, modifier };
    } });
    assert.equal(climbed.escaped, true);
  }
});
