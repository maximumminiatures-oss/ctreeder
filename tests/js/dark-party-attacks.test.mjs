import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { attackNarrative, attackRollSegments } from '../../S3_content/src/combat-rules.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene() {
  return {
    seed: 123, level: 1, map: { width: 10, height: 7 }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: 70 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), type: 'floor', roomId: 'room' })),
    rooms: [{ id: 'room', x: 0, y: 0, width: 10, height: 7 }],
    visibility: { exploredEver: [] },
    entities: [{ id: 'foe', type: 'monster', name: 'Bandit', hp: 100, maxHp: 100, ac: 12, x: 8, y: 5,
      roomId: 'room', hostile: true, attitude: 'combat', attitudeChecked: true, attack: '1 claw +0 (1d4)' }],
    characters: [
      { id: 'actor', name: 'Erd', className: 'Fighter', level: 1, hp: 100, maxHitPoints: 100, stats: { STR: 16, DEX: 10, WIS: 10 },
        x: 2, y: 2, roomId: 'room', lightRadius: 0, lightSource: '', equipmentInitialized: true,
        gear: [{ name: 'Dagger', type: 'weapon', equipped: true }] },
      { id: 'friend', name: 'Ratbilg', className: 'Fighter', level: 1, hp: 100, maxHitPoints: 100, armorClass: 10,
        stats: { STR: 10, DEX: 10, WIS: 10 }, x: 3, y: 2, roomId: 'room', gear: [], lightRadius: 0, lightSource: '' }
    ],
    player: { x: 2, y: 2, roomId: 'room', torchLit: false, lightRadius: 0, lightSource: '' }, activeCharacterId: 'actor',
    combat: { active: true, round: 1, turnIndex: 0, movementRemaining: 6, actionUsed: false,
      turnOrder: [{ type: 'character', id: 'actor' }, { type: 'character', id: 'friend' }, { type: 'monster', id: 'foe' }],
      playerOrderIds: ['actor', 'friend'], monsterIds: ['foe'] }
  };
}
const command = { type: 'attack', character_id: 'actor', target_id: 'friend', confirmed: true, attack_index: 0 };
async function attack(state, overrides = {}) {
  const random = Math.random;
  Math.random = () => .8;
  try { return await executeGameCommand(state, { ...command, ...overrides }); }
  finally { Math.random = random; }
}

test('adjacent and diagonal party targets in darkness can be attacked at disadvantage after confirmation', async () => {
  for (const diagonal of [false, true]) {
    const state = scene(); if (diagonal) state.characters[1].y = 3;
    const result = await attack(state), entry = result.state_json.rollHistory[0];
    assert.ok(result.state_json.characters.find(character => character.id === 'friend').hp < 100);
    assert.equal(result.state_json.combat.actionUsed, true);
    assert.match(entry.detail, /^Erd attacks Ratbilg at disadvantage with a dagger\./);
    assert.ok(entry.segments.some(segment => segment.tooltip?.some(part => /2d20/.test(part.text))));
    assert.equal(result.state_json.characters[0].lightRadius, 0);
  }
});

test('dark party attacks still require explicit confirmation and reject self targeting', async () => {
  await assert.rejects(() => attack(scene(), { confirmed: false }), /Confirm/);
  await assert.rejects(() => attack(scene(), { target_id: 'actor' }), /Confirm|yourself/);
});

test('dark party attacks retain range and physical wall checks without spending the action', async () => {
  for (const wall of [false, true]) {
    const state = scene(); state.characters[1].x = wall ? 4 : 9;
    if (wall) state.tiles[2 * 10 + 3].type = 'wall';
    const result = await attack(state);
    assert.equal(result.message, 'Out of range with dagger.');
    assert.equal(result.state_json.characters[1].hp, 100);
    assert.equal(result.state_json.combat.actionUsed, false);
    assert.equal(result.state_json.rollHistory?.length || 0, 0);
  }
});

test('dark party attacks cannot cross upper and lower passage routes', async () => {
  const state = scene(); state.characters[1].routeId = 'lower';
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 3, y: 2 }], upperCrossings: [{ x: 3, y: 2 }], portals: [] }];
  await assert.rejects(() => attack(state), /different passage|separate passage/);
});

test('lit party targets use normal rolls, while unseen monsters remain invalid direct targets', async () => {
  const lit = scene(); Object.assign(lit.characters[0], { lightSpellLit: true, lightRadius: 6, lightSource: 'light' });
  const result = await attack(lit);
  assert.match(result.state_json.rollHistory[0].detail, /^Erd attacks Ratbilg with a dagger\./);
  const dark = scene(); Object.assign(dark.entities[0], { x: 3, y: 2 });
  await assert.rejects(() => attack(dark, { target_id: undefined, monster_id: 'foe' }), /monster is not visible/);
  assert.equal(dark.entities[0].hp, 100);
});

test('attack narratives lowercase ordinary terms but preserve character, unique creature and spell names', () => {
  const base = { character: { id: 'erd', name: 'Erd' }, monster: { name: 'Giant Wasp' }, weapon: 'Dagger',
    roll: { roll: 15, total: 17, modifier: 2 }, ability: 'STR', abilityModifier: 2, hit: true, damage: 3 };
  assert.match(attackNarrative(base), /^Erd attacks the giant wasp with a dagger\./);
  assert.match(attackNarrative({ ...base, monster: { name: 'Ratbilg', partyMember: true } }), /^Erd attacks Ratbilg with a dagger\./);
  assert.match(attackNarrative({ ...base, monster: { name: 'Count Orlok', isUnique: true } }), /^Erd attacks Count Orlok with a dagger\./);
  assert.match(attackNarrative({ ...base, monster: { name: 'Vampire', properName: 'Count Orlok' } }), /^Erd attacks Count Orlok with a dagger\./);
  assert.match(attackNarrative({ ...base, character: { id: 'wasp', type: 'monster', name: 'Giant Wasp' } }), /^Giant wasp attacks/);
  const spell = attackRollSegments({ ...base, spell: 'Magic Missile' });
  assert.match(spell.map(part => part.text).join(''), /with Magic Missile\./);
  assert.equal(spell.at(-1).tooltip[0].text, 'Magic Missile: ');
});
