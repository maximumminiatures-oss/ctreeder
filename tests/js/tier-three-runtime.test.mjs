import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { magicScroll } from '../../S3_content/src/magic-items.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene() {
  const width = 36, height = 19;
  return {
    seed: 456, level: 3, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }], entities: [],
    visibility: { exploredEver: ['2,9'] },
    characters: [{ id: 'wizard', name: 'Badzog', className: 'Wizard', ancestry: 'Half-Orc', level: 5,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 18, WIS: 18, CHA: 10 }, hp: 100, maxHitPoints: 100,
      x: 2, y: 9, roomId: 'room', spellsKnown: 'Fireball, Lightning Bolt', gear: [], luckToken: true }],
    activeCharacterId: 'wizard', player: { x: 2, y: 9, roomId: 'room', torchLit: false },
    wanderingMonsters: { numerator: 0, denominator: 6 }, combat: { active: false }
  };
}
function foe(id, x, y, extra = {}) {
  return { id, type: 'monster', name: 'Bandit', x, y, roomId: 'room', hp: 100, maxHp: 100,
    ac: 12, level: 1, attack: '1 dagger +0 (1d4)', attitude: 'neutral', attitudeChecked: true,
    stealthState: { attempted: true, revealed: true }, hostile: false, visible: false, ...extra };
}
async function command(state, values, random = .5) {
  const previous = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state, { character_id: 'wizard', ...values }); }
  finally { Math.random = previous; }
}
const cast = (state, name, random) => command(state, { type: 'spell', spell_name: name }, random);
const resolve = (result, values) => command(result.state_json, { type: 'resolve_spell', ...values });

test('authoritative Fireball remains ready through movement and resolves only once after confirmation', async () => {
  let result = await cast(scene(), 'Fireball');
  assert.equal(result.state_json.characters[0].pendingSpell.spell, 'fireball');
  const artTransform = structuredClone(result.state_json.characters[0].pendingSpell.artTransform);
  assert.ok([0, 90, 180, 270].includes(artTransform.rotation));
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  assert.equal(result.state_json.characters[0].x, 3);
  assert.deepEqual(result.state_json.characters[0].pendingSpell.artTransform, artTransform);
  result = await resolve(result, { x: 5, y: 9, confirmed: false });
  assert.equal(result.state_json.characters[0].hp, 100);
  assert.ok(result.state_json.characters[0].pendingSpell);
  assert.deepEqual(result.state_json.characters[0].pendingSpell.artTransform, artTransform);
  result = await resolve(result, { x: 5, y: 9, confirmed: true });
  assert.equal(result.state_json.characters[0].hp, 84);
  assert.equal(result.state_json.characters[0].pendingSpell, null);
  await assert.rejects(() => resolve(result, { x: 5, y: 9, confirmed: true }), /no critical or pending/i);
});

test('authoritative Lightning Bolt extends beyond a nearby aim point and a critical can extend to 24 squares', async () => {
  for (const critical of [false, true]) {
    const state = scene();
    state.entities.push(foe('near', 10, 9, { hp: 1 }), foe('far', 24, 9, { hp: 1 }));
    let result = await cast(state, 'Lightning Bolt', critical ? .999 : .5);
    if (critical) result = await resolve(result, { choice: 'range' });
    result = await resolve(result, { x: 3, y: 9, confirmed: true });
    assert.equal(result.state_json.entities.find(entity => entity.id === 'near').defeated, true);
    assert.equal(result.state_json.entities.find(entity => entity.id === 'far').hp, critical ? 0 : 1);
    assert.equal(result.state_json.characters[0].hp, 100, 'the origin caster is not struck by their own bolt');
  }
});

test('blast kills use normal monster defeat and gear-drop handling', async () => {
  const state = scene();
  state.entities.push(foe('pirate', 7, 9, { name: 'Pirate', hp: 1, ac: '12 (leather)', attack: '1 dagger +1 (1d4)' }));
  let result = await cast(state, 'Fireball');
  result = await resolve(result, { x: 7, y: 9, confirmed: true });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'pirate').defeated, true);
  assert.ok(result.state_json.entities.some(entity => entity.gearItem?.name === 'Dagger'));
});

test('initial blast critical choices are validated and cancelling does not apply damage', async () => {
  let result = await cast(scene(), 'Fireball', .999);
  await assert.rejects(() => resolve(result, { choice: 'range' }), /critical|choice/i);
  result = await resolve(result, { choice: 'area' });
  result = await resolve(result, { dismiss: true });
  assert.equal(result.state_json.characters[0].hp, 100);
  assert.equal(result.state_json.characters[0].pendingSpell, null);
});

test('Luck can recover a failed Tier 3 cast into ready targeting', async () => {
  let result = await cast(scene(), 'Fireball', .1);
  assert.ok(result.state_json.characters[0].failedSpellKeys.includes('fireball'));
  result = await command(result.state_json, { type: 'luck' }, .8);
  const actor = result.state_json.characters[0];
  assert.equal(actor.pendingSpell.spell, 'fireball');
  assert.ok(!actor.failedSpellKeys.includes('fireball'));
  assert.equal(actor.luckToken, false);
});

test('Fireball scrolls dispatch into the same Tier 3 placement flow without requiring a known spell', async () => {
  const state = scene(); state.characters[0].spellsKnown = 'Light';
  state.characters[0].gear.push(magicScroll({ name: 'Fireball', tier: 3, classes: ['wizard'] }));
  let result = await command(state, { type: 'read_scroll', gear_index: 0 });
  assert.equal(result.state_json.characters[0].pendingSpell.spell, 'fireball');
  assert.equal(result.state_json.characters[0].gear[0].name, 'Blank paper');
  result = await resolve(result, { x: 6, y: 9, confirmed: true });
  assert.equal(result.state_json.characters[0].pendingSpell, null);
});

test('casting consumes the combat action, but movement and reselecting a ready blast do not recast it', async () => {
  const state = scene(); state.entities.push(foe('foe', 20, 9));
  state.combat = { active: true, round: 1, turnIndex: 0, movementRemaining: 6, actionUsed: false,
    turnOrder: [{ type: 'character', id: 'wizard' }, { type: 'monster', id: 'foe' }],
    playerOrderIds: ['wizard'], monsterIds: ['foe'] };
  let result = await cast(state, 'Lightning Bolt');
  assert.equal(result.state_json.combat.actionUsed, true);
  result = await cast(result.state_json, 'Lightning Bolt', .1);
  assert.ok(result.state_json.characters[0].pendingSpell);
  assert.ok(!result.state_json.characters[0].failedSpellKeys.includes('lightning bolt'));
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  assert.equal(result.state_json.combat.movementRemaining, 5);
  result = await resolve(result, { dismiss: true });
  assert.equal(result.state_json.combat.actionUsed, true);
  await assert.rejects(() => cast(result.state_json, 'Fireball'), /already acted/i);
});

test('a caster felled by their Fireball immediately ends source-owned Focus conditions outside the blast', async () => {
  const state = scene(); state.characters[0].spellsKnown += ', Hold Person';
  state.characters[0].gear = [{ name: 'Torch', lit: true, equipped: true }];
  Object.assign(state.characters[0], { lightSource: 'torch', lightRadius: 6 });
  state.entities.push(foe('held', 7, 9, { visible: true }));
  let result = await cast(state, 'Hold Person');
  result = await resolve(result, { target_id: 'held' });
  assert.ok(result.state_json.entities.find(entity => entity.id === 'held').conditions.paralyzed);
  result.state_json.characters[0].hp = 1;
  result = await cast(result.state_json, 'Fireball');
  result = await resolve(result, { x: 2, y: 9, confirmed: true });
  assert.equal(result.state_json.characters[0].hp, 0);
  assert.equal(result.state_json.characters[0].focusSpell, null);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'held').conditions.paralyzed, undefined);
});
