import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { listMagicEffects } from '../../S3_content/src/magic-effect-registry.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function hero(id, x, extra = {}) {
  return { id, name: id, className: 'Wizard', ancestry: 'Half-Orc', level: 5, hp: 100, maxHitPoints: 100,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 18, WIS: 18, CHA: 10 },
    x, y: 6, roomId: 'room', routeId: '', gold: 10, gear: [], equipmentInitialized: true,
    spellsKnown: 'Fly, Gaseous Form, Fireball, Lightning Bolt, Burning Hands, Magic Missile, Dispel Magic, Light', ...extra };
}
function scene() {
  const width = 24, height = 13;
  return { seed: 456, level: 3, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }], entities: [], visibility: { exploredEver: ['2,6'] },
    characters: [hero('wizard', 2), hero('ally', 1)], activeCharacterId: 'wizard',
    player: { x: 2, y: 6, roomId: 'room', routeId: '', torchLit: false },
    wanderingMonsters: { numerator: 0, denominator: 6 }, combat: { active: false } };
}
function foe(state, x = 22, extra = {}) {
  const monster = { id: 'foe', name: 'Bandit', type: 'monster', x, y: 6, routeId: '', roomId: 'room', hp: 100, maxHp: 100,
    ac: 12, level: 1, attack: '1 dagger +0 (1d4)', attitude: 'combat', attitudeChecked: true, hostile: true, visible: false, ...extra };
  state.entities.push(monster); return monster;
}
function combat(state) {
  if (!state.entities.some(entity => entity.id === 'foe')) foe(state);
  state.combat = { active: true, round: 1, turnIndex: 0, movementBudget: 6, movementRemaining: 6, actionUsed: false,
    turnOrder: [...state.characters.map(actor => ({ type: 'character', id: actor.id })), { type: 'monster', id: 'foe' }],
    playerOrderIds: state.characters.map(actor => actor.id), monsterIds: ['foe'] };
  return state;
}
async function command(state, values, random = .5) {
  const previous = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state, { character_id: 'wizard', ...values }); }
  finally { Math.random = previous; }
}
const actor = (state, id = 'wizard') => state.characters.find(character => character.id === id);
const effect = (state, spell, id = 'wizard') => actor(state, id).transformationEffects?.find(entry => entry.spell === spell);
const cast = (state, spell, random = .5, character_id = 'wizard') => command(state, { type: 'spell', spell_name: spell, character_id }, random);
const resolve = (state, values = {}, character_id = 'wizard') => command(state, { type: 'resolve_spell', character_id, ...values });
function flight(actor, spell = 'fly', rounds = 10) {
  actor.transformationEffects = [{ spell, casterId: actor.id, tier: 3, rounds, movementSquares: 6 }];
}

test('authoritative Fly and gas casts use the utility adapter, self-only durations, and initial critical choices', async () => {
  let result = await cast(scene(), 'Fly');
  assert.equal(effect(result.state_json, 'fly').rounds, 5);
  assert.equal(actor(result.state_json).pendingSpell, null);
  assert.equal(actor(result.state_json, 'ally').transformationEffects?.length || 0, 0);
  for (const [choice, rounds, movement] of [['duration',10,6], ['movement',5,12]]) {
    result = await cast(scene(), 'Fly', .999);
    assert.equal(actor(result.state_json).pendingSpell.phase, 'critical');
    result = await resolve(result.state_json, { choice });
    assert.equal(effect(result.state_json, 'fly').rounds, rounds);
    assert.equal(effect(result.state_json, 'fly').movementSquares, movement);
  }
  for (const [random, rounds] of [[.5,10],[.999,20]]) {
    result = await cast(scene(), 'Gaseous Form', random);
    assert.equal(effect(result.state_json, 'gaseous form').rounds, rounds);
    assert.equal(actor(result.state_json).pendingSpell, null);
  }
});

for (const doorState of ['closed','locked']) test(`gas crosses a ${doorState} ordinary door without opening, unlocking, or triggering its trap`, async () => {
  const state = scene();
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 3, y: 6, roomId: 'room', hallDirection: 'east', doorState },
    { id: 'door-trap', type: 'trap', name: 'Needle', targetType: 'door', targetId: 'door', x: 3, y: 6, revealed: false, triggered: false });
  let result = await cast(state, 'Gaseous Form');
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  assert.equal(actor(result.state_json).x, 3);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'door').doorState, doorState);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'door-trap').triggered, false);
});

test('gas cannot move through solid walls and is not restrained by Web', async () => {
  const state = scene();
  state.areaSpells = [{ id: 'web', spell: 'web', casterId: 'ally', x: 1, y: 5, width: 6, height: 3, routeId: '', rounds: 5, castingTotal: 18 }];
  state.tiles[6 * state.map.width + 4].type = 'wall';
  let result = await cast(state, 'Gaseous Form');
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  assert.equal(actor(result.state_json).x, 3);
  assert.equal(actor(result.state_json).conditions?.webs, undefined);
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  assert.equal(actor(result.state_json).x, 3);
});

test('gas rejects casting, guessed weapon attacks, and ordinary gear commands at the authoritative boundary', async () => {
  const gas = (await cast(scene(), 'Gaseous Form')).state_json;
  for (const values of [{ type: 'spell', spell_name: 'Light' }, { type: 'attack_empty', x: 3, y: 6 },
    { type: 'drop_gear', gear_index: 0 }, { type: 'drink_potion', gear_index: 0 },
    { type: 'read_scroll', gear_index: 0 }, { type: 'equip', gear_index: 0, equipped: true }]) {
    await assert.rejects(() => command(gas, values), /Gaseous Form|gaseous form/i);
  }
});

for (const [choice, budget] of [[null,6], ['movement',12]]) test(`Fly combat movement is ${budget}, ignores departure water, crosses pits and floor traps`, async () => {
  const state = combat(scene());
  state.tiles[6 * state.map.width + 2].meta.slowWater = true;
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 6, routeId: '' },
    { id: 'floor-trap', type: 'trap', targetType: 'tile', name: 'Needles', x: 4, y: 6, triggered: false, revealed: false });
  let result = await cast(state, 'Fly', choice ? .999 : .5);
  if (choice) result = await resolve(result.state_json, { choice });
  assert.equal(result.state_json.combat.movementBudget, budget);
  assert.equal(result.state_json.combat.movementRemaining, budget);
  result = await command(result.state_json, { type: 'move_batch', moves: [{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }] });
  assert.equal(actor(result.state_json).x, 4);
  assert.equal(result.state_json.combat.movementRemaining, budget - 2);
  assert.equal(actor(result.state_json).hp, 100);
  assert.equal(actor(result.state_json).conditions?.sinkhole, undefined);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'floor-trap').triggered, false);
});

for (const spell of ['Fireball','Lightning Bolt']) test(`${spell} deals half area damage to gas through authoritative commands`, async () => {
  let result = await cast(scene(), 'Gaseous Form');
  result = await cast(result.state_json, spell, .5, 'ally');
  result = await resolve(result.state_json, { x: 3, y: 6, confirmed: true }, 'ally');
  assert.equal(actor(result.state_json).hp, spell === 'Fireball' ? 92 : 94);
});

test('Burning Hands still hits gas for half damage rather than filtering it as a direct target', async () => {
  let result = await cast(scene(), 'Gaseous Form');
  result = await cast(result.state_json, 'Burning Hands', .5, 'ally');
  result = await resolve(result.state_json, {}, 'ally');
  assert.equal(actor(result.state_json).hp, 98);
});

test('Web ignition still burns gas for half damage even though its restraints have no effect', async () => {
  const state = scene();
  state.areaSpells = [{ id: 'web', spell: 'web', casterId: 'ally', x: 2, y: 6, width: 1, height: 1, routeId: '', rounds: 5, castingTotal: 18 }];
  let result = await cast(state, 'Gaseous Form');
  result = await cast(result.state_json, 'Burning Hands', .5, 'ally');
  result = await resolve(result.state_json, {}, 'ally');
  assert.equal(actor(result.state_json).hp, 96, 'Half of 4 direct fire damage plus half of 4 Web fire damage.');
  assert.equal(actor(result.state_json).conditions?.webs, undefined);
  assert.ok(result.state_json.areaSpells.find(zone => zone.id === 'web').burnedAt);
});

for (const spell of ['Fly','Gaseous Form']) test(`${spell} expiry falls on the current pit instead of relocating to a free adjacent rim`, async () => {
  const state = scene(); state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 6, routeId: '' });
  let result = await cast(state, spell);
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  effect(result.state_json, spell.toLowerCase()).rounds = 1;
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  assert.equal(actor(result.state_json).hp, 88);
  assert.equal(actor(result.state_json).conditions.sinkhole, 'pit');
  assert.equal(actor(result.state_json).conditions.prone, true);
  assert.deepEqual([actor(result.state_json).x, actor(result.state_json).y], [3,6]);
});

test('Fly expiry uses the existing Feather Fall response prompt', async () => {
  const state = scene(); actor(state).spellsKnown += ', Feather Fall';
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 6, routeId: '' });
  let result = await cast(state, 'Fly');
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  effect(result.state_json, 'fly').rounds = 1;
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  assert.ok(actor(result.state_json).pendingFall);
  assert.equal(actor(result.state_json).hp, 100);
  result = await command(result.state_json, { type: 'fall_response', attempt: false });
  assert.equal(actor(result.state_json).hp, 88);
});

test('Dispel removes Fly and performs the same pit landing with falling damage', async () => {
  const state = scene();
  Object.assign(actor(state, 'ally'), { lightSpellLit: true, lightRadius: 6, lightSource: 'light' });
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 6, routeId: '' });
  let result = await cast(state, 'Fly');
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  const id = listMagicEffects(result.state_json).find(entry => entry.spell === 'fly').id;
  result = await cast(result.state_json, 'Dispel Magic', .5, 'ally');
  result = await resolve(result.state_json, { target_id: 'wizard' }, 'ally');
  result = await resolve(result.state_json, { option: id }, 'ally');
  assert.equal(effect(result.state_json, 'fly'), undefined);
  assert.equal(actor(result.state_json).hp, 88);
  assert.equal(actor(result.state_json).conditions.sinkhole, 'pit');
});

for (const spell of ['Fly','Gaseous Form']) test(`${spell} cannot end its turn while overlapping an enemy token`, async () => {
  const state = scene(); foe(state, 3); combat(state);
  let result = await cast(state, spell);
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  assert.equal(actor(result.state_json).x, 3);
  result = await command(result.state_json, { type: 'end_turn' });
  const monster = result.state_json.entities.find(entity => entity.id === 'foe');
  const entry = result.state_json.combat.turnOrder[result.state_json.combat.turnIndex];
  assert.ok(entry.id === 'wizard' || actor(result.state_json).x !== monster.x || actor(result.state_json).y !== monster.y,
    'Ending the turn must reject the overlap or restore a genuinely unoccupied position.');
});

test('guessed melee attacks cannot bypass Fly immunity on a hidden monster', async () => {
  const state = scene();
  actor(state).gear.push({ name: 'Dagger', type: 'weapon', equipped: true });
  const monster = foe(state, 3, { stealthState: { attempted: true, revealed: false, total: 30 } }); flight(monster);
  const result = await command(state, { type: 'attack_empty', x: 3, y: 6 }, .8);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 100);
});

test('monster melee attacks cannot hit a character with Fly', async () => {
  const state = scene(); state.characters = [actor(state)]; flight(actor(state));
  foe(state, 3, { visible: true, attack: '1 club +0 (1d4)' }); combat(state);
  const result = await command(state, { type: 'end_turn' }, .8);
  assert.equal(actor(result.state_json).hp, 100);
});

test('an adjacent monster can throw a dagger at a character with Fly', async () => {
  const state = scene(); state.characters = [actor(state)]; flight(actor(state));
  foe(state, 3, { visible: true, attack: '1 dagger +0 (1d4)' }); combat(state);
  const result = await command(state, { type: 'end_turn' }, .8);
  assert.ok(actor(result.state_json).hp < 100);
});

test('a guessed Magic Missile square cannot damage a gaseous monster', async () => {
  const state = scene(), monster = foe(state, 4); flight(monster, 'gaseous form');
  let result = await cast(state, 'Magic Missile');
  result = await resolve(result.state_json, { x: 4, y: 6, blind: true });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 100);
});

test('gas cannot spend coins to buy gear through an unlisted command', async () => {
  const gas = (await cast(scene(), 'Gaseous Form')).state_json;
  await assert.rejects(() => command(gas, { type: 'buy_gear', item_id: 'torch' }), /Gaseous Form|gaseous form|gear|inventory/i);
});

test('gas cannot drop coins through an unlisted command', async () => {
  const gas = (await cast(scene(), 'Gaseous Form')).state_json;
  await assert.rejects(() => command(gas, { type: 'money', key: 'gold', amount: 5 }), /Gaseous Form|gaseous form|gear|inventory/i);
});

test('gas cannot use rope gear through the pit_action command', async () => {
  const state = scene(); actor(state).gear.push({ name: 'Rope', quantity: 1, totalUnits: 1, slots: 1 });
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 6, routeId: '' });
  const gas = (await cast(state, 'Gaseous Form')).state_json;
  await assert.rejects(() => command(gas, { type: 'pit_action', action: 'bridge', pit_id: 'pit' }), /Gaseous Form|gaseous form|rope|gear/i);
});

test('a touch spell cannot bypass the prohibition on directly targeting a gas character', async () => {
  const state = scene(); actor(state).hp = 50;
  Object.assign(actor(state, 'ally'), { className: 'Priest', spellsKnown: 'Cure Wounds' });
  const gas = (await cast(state, 'Gaseous Form')).state_json;
  await assert.rejects(() => command(gas, { type: 'spell', spell_name: 'Cure Wounds', character_id: 'ally', target_id: 'wizard' }),
    /Gaseous Form|gaseous form|target|touch/i);
});

test('normal rope restraints cannot bind a gas character', async () => {
  const state = scene(); actor(state, 'ally').gear.push({ name: 'Rope', quantity: 1, totalUnits: 1, slots: 1 });
  const gas = (await cast(state, 'Gaseous Form')).state_json;
  actor(gas).conditions ||= {}; actor(gas).conditions.sleeping = true;
  let result;
  try { result = await command(gas, { type: 'pit_action', action: 'tie', target_id: 'wizard', character_id: 'ally' }); }
  catch (error) { assert.match(error.message, /Gaseous Form|gaseous|tie|target|restraint/i); return; }
  assert.equal(actor(result.state_json).conditions?.tied, undefined);
});
