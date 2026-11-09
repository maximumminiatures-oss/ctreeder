import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

const dayMs = 24 * 60 * 60 * 1000;
const undead = state => state.characters.filter(actor => actor.companion?.kind === 'animate-dead');
const actor = (state, id) => state.characters.find(member => member.id === id);
const turnIdentity = state => ({ round: state.combat.round, turnIndex: state.combat.turnIndex,
  turnOrder: state.combat.turnOrder, playerOrderIds: state.combat.playerOrderIds });
const loot = state => state.entities.filter(entity => entity.type === 'treasure' || entity.corpseLoot ||
  ['corpse-loot', 'character-corpse', 'dropped-equipment', 'monster-loot'].includes(entity.subtype));

function scene({ combat = false, bodies = 1 } = {}) {
  const width = 12, height = 10;
  const corpse = (id, name, x, y) => ({ id, type: 'treasure', subtype: 'corpse-loot', kind: 'worthless-loot',
    name: `Dead ${name}`, monsterName: name, sourceMonsterId: `slain-${id}`,
    corpseSource: { name, tags: ['humanoid'], level: 3, hp: 0, maxHp: 14, ac: 13,
      attack: '2 mace +3 (1d6)', S: 3, D: 0, C: 1, I: -1, W: 0, Ch: -2, movement: 'near', AL: 'C', talents: [] },
    x, y, roomId: 'room', visible: true, revealed: true, corpseLoot: true, collected: false, value: 0, slots: 1 });
  const entities = [corpse('body-one', 'Bugbear', 5, 6),
    { id: 'original-gear', type: 'treasure', subtype: 'dropped-equipment', kind: 'gear',
      name: 'Mace', gearItem: { name: 'Mace', type: 'weapon', slots: 1 }, x: 5, y: 6, roomId: 'room',
      visible: true, revealed: true, collected: false, value: 5, slots: 1 }];
  if (bodies === 2) entities.push(corpse('body-two', 'Elf', 4, 5));
  if (combat) entities.push({ id: 'enemy', type: 'monster', name: 'Bandit', level: 1, hp: 100, maxHp: 100,
    ac: 10, x: 7, y: 6, roomId: 'room', visible: true, hostile: true, attitude: 'combat', attitudeChecked: true,
    attack: '1 club +1 (1d4)', S: 1, D: 0, C: 0, I: 0, W: 0, Ch: 0, tags: ['humanoid'], gear: [] });
  return { seed: 456, level: 3, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }], entities,
    visibility: { visibleNow: Array.from({ length: width * height }, (_, i) => `${i % width},${Math.floor(i / width)}`),
      exploredEver: Array.from({ length: width * height }, (_, i) => `${i % width},${Math.floor(i / width)}`) },
    characters: [{ id: 'wizard', name: 'Badzog', className: 'Wizard', ancestry: 'Half-Orc', level: 5,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 18, WIS: 18, CHA: 10 }, hp: 80, maxHitPoints: 80,
      x: 4, y: 6, roomId: 'room', spellsKnown: 'Animate Dead, Dispel Magic', gear: [],
      lightSpellLit: true, lightRadius: 6, lightSource: 'light-spell' },
    { id: 'friend', name: 'Ad', className: 'Fighter', ancestry: 'Human', level: 1,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, hp: 30, maxHitPoints: 30,
      x: 3, y: 6, roomId: 'room', gear: [], equipmentInitialized: true }],
    activeCharacterId: 'wizard', player: { x: 4, y: 6, roomId: 'room', torchLit: true },
    wanderingMonsters: { numerator: 0, denominator: 6 },
    combat: combat ? { active: true, round: 1, turnIndex: 0, movementRemaining: 4, movementBudget: 6, actionUsed: false,
      lastUnoccupiedPosition: { x: 4, y: 6, roomId: 'room', routeId: '' },
      turnOrder: [{ type: 'character', id: 'wizard' }, { type: 'character', id: 'friend' }, { type: 'monster', id: 'enemy' }],
      playerOrderIds: ['wizard', 'friend'], pendingPlayerIds: [], monsterIds: ['enemy'],
      initiative: [{ id: 'wizard', type: 'character', total: 20 }, { id: 'friend', type: 'character', total: 15 }, { id: 'enemy', type: 'monster', total: 10 }] }
      : { active: false } };
}

async function command(state, values, random = .5) {
  const previous = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state, { character_id: 'wizard', ...values }); }
  finally { Math.random = previous; }
}

async function animate(state = scene(), { critical = false, form = 'zombie', targetId = 'body-one' } = {}) {
  let result = await command(state, { type: 'spell', spell_name: 'Animate Dead' }, critical ? .999 : .5);
  assert.equal(actor(result.state_json, 'wizard').pendingSpell.spell, 'animate dead');
  if (critical) result = await command(result.state_json, { type: 'resolve_spell', choice: 'targets' });
  result = await command(result.state_json, { type: 'resolve_spell', option: form });
  assert.equal(actor(result.state_json, 'wizard').pendingSpell.form.toLowerCase(), form);
  return command(result.state_json, { type: 'resolve_spell', target_id: targetId });
}

test('authoritative cast, form and corpse commands create normal undead, consume the corpse and preserve separate loot through normalize', async () => {
  for (const form of ['skeleton', 'zombie']) {
    let result = await animate(scene(), { form });
    let [child] = undead(result.state_json);
    assert.ok(child); assert.equal(child.ancestry, `Bugbear ${form === 'skeleton' ? 'Skeleton' : 'Zombie'}`);
    assert.equal(child.hp, 11); assert.equal(child.maxHitPoints, 11); assert.equal(child.level, 2);
    assert.equal(child.armorClass, form === 'skeleton' ? 10 : 8);
    assert.equal(child.x, 5); assert.equal(child.y, 6);
    assert.equal(child.companion.controllerCharacterId, 'wizard');
    assert.ok(child.summon, 'Serialized animated undead must retain summon metadata for backend caster ownership.');
    assert.equal(child.summon.casterId, 'wizard');
    assert.equal(child.summon.kind, 'animate-dead'); assert.equal(child.summon.remainingMs, dayMs);
    assert.equal(actor(result.state_json, 'wizard').pendingSpell, null);
    const consumed = result.state_json.entities.find(entity => entity.id === 'body-one');
    assert.equal(consumed.animateDeadConsumed.animatedId, child.id); assert.equal(consumed.corpseLoot, false);
    assert.equal(result.state_json.entities.find(entity => entity.id === 'original-gear').gearItem.name, 'Mace');
    assert.equal(child.gear.some(item => item.name === 'Mace'), false);
    result = await command(result.state_json, { type: 'normalize' });
    [child] = undead(result.state_json);
    assert.equal(child.raw.companion.kind, 'animate-dead');
    assert.equal(child.companion.animateDead.remainingMs, dayMs);
  }
});

test('critical resolution creates two undead with separate consecutive turns after the caster', async () => {
  let result = await animate(scene({ combat: true, bodies: 2 }), { critical: true, form: 'skeleton' });
  assert.equal(actor(result.state_json, 'wizard').pendingSpell.remaining, 1);
  assert.equal(Object.hasOwn(actor(result.state_json, 'wizard').pendingSpell, 'form'), false);
  result = await command(result.state_json, { type: 'resolve_spell', option: 'zombie' });
  result = await command(result.state_json, { type: 'resolve_spell', target_id: 'body-two' });
  assert.deepEqual(undead(result.state_json).map(child => child.ancestry), ['Bugbear Skeleton', 'Elf Zombie']);
  assert.equal(result.state_json.combat.actionUsed, true);
  assert.equal(result.state_json.combat.movementRemaining, 4);
  assert.deepEqual(result.state_json.combat.playerOrderIds, ['wizard', 'friend']);
  assert.deepEqual(result.state_json.combat.turnOrder.map(entry => entry.id),
    ['wizard', ...undead(result.state_json).map(child => child.id), 'friend', 'enemy']);
  for (const child of undead(result.state_json)) {
    assert.equal(result.state_json.combat.turnOrder.some(entry => entry.id === child.id), true);
    assert.equal(result.state_json.combat.initiative.some(entry => entry.id === child.id), false);
    assert.equal(child.companion.animateDead.remainingMs, dayMs);
  }
});

test('undead wait until their own turn, then move and attack without spending caster resources', async () => {
  let result = await animate(scene({ combat: true }));
  const childId = undead(result.state_json)[0].id;
  assert.equal(result.state_json.combat.actionUsed, true); assert.equal(result.state_json.combat.movementRemaining, 4);
  await assert.rejects(() => command(result.state_json, { type: 'move', character_id: childId, dx: 1, dy: 0 }), /not.*turn/i);
  result = await command(result.state_json, { type: 'end_turn' });
  assert.equal(result.state_json.activeCharacterId, childId);
  assert.equal(result.state_json.combat.movementRemaining, 6);
  assert.equal(result.state_json.combat.actionUsed, false);
  result = await command(result.state_json, { type: 'move', character_id: childId, dx: 1, dy: 0 });
  assert.equal(actor(result.state_json, childId).x, 6);
  assert.equal(result.state_json.combat.movementRemaining, 5); assert.equal(result.state_json.combat.actionUsed, false);
  result = await command(result.state_json, { type: 'attack', character_id: childId, monster_id: 'enemy', attack_index: 0 });
  assert.ok(result.state_json.entities.find(entity => entity.id === 'enemy').hp < 100);
  assert.equal(result.state_json.combat.actionUsed, true); assert.equal(result.state_json.combat.movementRemaining, 5);
  await assert.rejects(() => command(result.state_json, { type: 'move', dx: 0, dy: 1 }), /not.*turn/i);
  result = await command(result.state_json, { type: 'move', character_id: childId, dx: 0, dy: 1 });
  assert.equal(result.state_json.combat.actionUsed, true); assert.equal(result.state_json.combat.movementRemaining, 4);
  const enemyHp = result.state_json.entities.find(entity => entity.id === 'enemy').hp;
  result = await command(result.state_json, { type: 'attack', character_id: childId, monster_id: 'enemy', attack_index: 0 });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'enemy').hp, enemyHp);
  assert.equal(result.state_json.combat.actionUsed, true);
});

test('undead End Turn advances to the next party member instead of returning to the caster', async () => {
  let result = await animate(scene({ combat: true }));
  const childId = undead(result.state_json)[0].id;
  result = await command(result.state_json, { type: 'end_turn' });
  result = await command(result.state_json, { type: 'end_turn', character_id: childId });
  assert.equal(result.state_json.activeCharacterId, 'friend');
  assert.equal(result.state_json.combat.actionUsed, false);
  assert.equal(result.state_json.animatedDeadTurn, undefined);
});

test('a child cannot move, attack or end_turn during another character turn', async () => {
  let result = await animate(scene({ combat: true }));
  const childId = undead(result.state_json)[0].id;
  result = await command(result.state_json, { type: 'end_turn' });
  result = await command(result.state_json, { type: 'end_turn', character_id: childId });
  assert.equal(result.state_json.combat.turnOrder[result.state_json.combat.turnIndex].id, 'friend');
  const snapshot = JSON.stringify(result.state_json);
  for (const values of [{ type: 'move', dx: 1, dy: 0 }, { type: 'attack', monster_id: 'enemy', attack_index: 0 }, { type: 'end_turn' }]) {
    await assert.rejects(() => command(result.state_json, { ...values, character_id: childId }), /not.*turn/i);
    assert.equal(JSON.stringify(result.state_json), snapshot);
  }
});

test('caster safe-square rollback is independent of the undead later turn', async () => {
  let result = await animate(scene({ combat: true }));
  const childId = undead(result.state_json)[0].id, turn = turnIdentity(result.state_json);
  result = await command(result.state_json, { type: 'move', dx: -1, dy: 0 });
  assert.equal(actor(result.state_json, 'wizard').x, 3);
  assert.deepEqual(result.state_json.combat.lastUnoccupiedPosition, { x: 4, y: 6, roomId: 'room', routeId: '' });
  assert.equal(result.state_json.combat.movementRemaining, 3); assert.equal(result.state_json.combat.actionUsed, true);
  result = await command(result.state_json, { type: 'end_turn' });
  assert.equal(actor(result.state_json, 'wizard').x, 4); assert.equal(actor(result.state_json, 'wizard').y, 6);
  assert.equal(actor(result.state_json, childId).x, 5); assert.equal(actor(result.state_json, childId).y, 6);
  assert.deepEqual(turnIdentity(result.state_json), turn);
  assert.equal(result.state_json.combat.movementRemaining, 3); assert.equal(result.state_json.combat.actionUsed, true);
  result = await command(result.state_json, { type: 'end_turn' });
  assert.equal(result.state_json.activeCharacterId, childId);
  assert.deepEqual(result.state_json.combat.lastUnoccupiedPosition, { x: 5, y: 6, roomId: 'room', routeId: '' });
});

test('undead ending on its caster rolls back and can then end its own turn normally', async () => {
  let result = await animate(scene({ combat: true }));
  const childId = undead(result.state_json)[0].id;
  result = await command(result.state_json, { type: 'end_turn' });
  const turn = turnIdentity(result.state_json);
  result = await command(result.state_json, { type: 'move', character_id: childId, dx: -1, dy: 0 });
  assert.equal(actor(result.state_json, childId).x, 4);
  assert.deepEqual(result.state_json.combat.lastUnoccupiedPosition, { x: 5, y: 6, roomId: 'room', routeId: '' });
  result = await command(result.state_json, { type: 'end_turn', character_id: childId });
  assert.equal(actor(result.state_json, childId).x, 5); assert.equal(actor(result.state_json, childId).y, 6);
  assert.equal(actor(result.state_json, 'wizard').x, 4); assert.equal(actor(result.state_json, 'wizard').y, 6);
  assert.equal(result.state_json.activeCharacterId, childId);
  assert.deepEqual(turnIdentity(result.state_json), turn);
  assert.equal(result.state_json.combat.actionUsed, false); assert.equal(result.state_json.combat.movementRemaining, 5);
  result = await command(result.state_json, { type: 'end_turn', character_id: childId });
  assert.equal(result.state_json.activeCharacterId, 'friend');
  assert.equal(result.state_json.combat.actionUsed, false);
});

test('undead retain own movement and attacks when caster is sleeping, dying, dead or removed', async () => {
  for (const status of ['sleeping', 'dying', 'dead', 'removed']) {
    let result = await animate(scene({ combat: true }));
    const state = result.state_json, childId = undead(state)[0].id, caster = actor(state, 'wizard');
    if (status === 'sleeping') caster.conditions = { sleeping: true };
    if (status === 'dying') { caster.hp = 0; caster.dyingRounds = 3; }
    if (status === 'dead') { caster.hp = 0; caster.dead = true; }
    if (status === 'removed') state.characters = state.characters.filter(member => member.id !== 'wizard');
    // Simulate the next creature's valid turn after the caster's slot.
    state.combat.turnIndex = 1;
    state.activeCharacterId = childId;
    state.combat.actionUsed = false; state.combat.movementRemaining = 6;
    result = await command(state, { type: 'move', character_id: childId, dx: 1, dy: 0 });
    assert.equal(actor(result.state_json, childId).x, 6, status);
    result = await command(result.state_json, { type: 'attack', character_id: childId, monster_id: 'enemy', attack_index: 0 });
    assert.ok(result.state_json.entities.find(entity => entity.id === 'enemy').hp < 100, status);
    result = await command(result.state_json, { type: 'end_turn', character_id: childId });
    assert.equal(result.state_json.activeCharacterId, 'friend', status);
  }
});

test('removing the active dead caster starts the undead next turn with fresh resources and preserves later rounds', async () => {
  for (const removed of [false, true]) {
    let result = await animate(scene({ combat: true }));
    const state = result.state_json, childId = undead(state)[0].id;
    const caster = actor(state, 'wizard');
    caster.hp = 0; caster.dead = true;
    if (removed) state.characters = state.characters.filter(member => member.id !== caster.id);
    result = await command(state, { type: 'tick', elapsed_ms: 0 });
    assert.equal(result.state_json.activeCharacterId, childId);
    assert.equal(result.state_json.combat.turnOrder[result.state_json.combat.turnIndex].id, childId);
    assert.equal(result.state_json.combat.movementRemaining, 6);
    assert.equal(result.state_json.combat.actionUsed, false);
    result = await command(result.state_json, { type: 'end_turn', character_id: childId });
    assert.equal(result.state_json.activeCharacterId, 'friend');
    result = await command(result.state_json, { type: 'end_turn', character_id: 'friend' });
    assert.equal(result.state_json.combat.round, 2, JSON.stringify({ combat: result.state_json.combat, message: result.message }));
    assert.equal(result.state_json.activeCharacterId, childId);
    assert.equal(result.state_json.combat.turnOrder[result.state_json.combat.turnIndex].id, childId);
    assert.equal(result.state_json.combat.actionUsed, false);
  }
});

test('authoritative tick expiry removes a near-expiration saved summon once, without defeat, corpses or extra loot', async () => {
  let result = await animate(scene(), { form: 'skeleton' });
  const saved = JSON.parse(JSON.stringify(result.state_json)), child = undead(saved)[0];
  // Resume the final ten seconds of the saved game-time lifetime.
  child.companion.animateDead.remainingMs = 10000; child.raw.companion.animateDead.remainingMs = 10000;
  if (child.summon) child.summon.remainingMs = 10000;
  if (child.raw.summon) child.raw.summon.remainingMs = 10000;
  const originalLoot = loot(saved), originalDefeats = saved.entities.filter(entity => entity.defeated).length;
  result = await command(saved, { type: 'tick', elapsed_ms: 9999 });
  assert.equal(undead(result.state_json)[0].companion.animateDead.remainingMs, 1);
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 1 });
  assert.equal(undead(result.state_json).length, 0);
  const dust = result.state_json.entities.filter(entity => entity.subtype === 'grave-dust');
  assert.equal(dust.length, 1); assert.equal(dust[0].type, 'feature'); assert.equal(dust[0].corpseLoot, undefined);
  assert.deepEqual(loot(result.state_json), originalLoot);
  assert.equal(result.state_json.entities.filter(entity => entity.defeated).length, originalDefeats);
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  assert.equal(result.state_json.entities.filter(entity => entity.subtype === 'grave-dust').length, 1);
  assert.deepEqual(loot(result.state_json), originalLoot);
});

test('Dispel Magic selects and removes Animate Dead through commands without a corpse, defeat or duplicate loot', async () => {
  let result = await animate(scene(), { form: 'skeleton' });
  const child = undead(result.state_json)[0], originalLoot = loot(result.state_json);
  result = await command(result.state_json, { type: 'spell', spell_name: 'Dispel Magic' });
  result = await command(result.state_json, { type: 'resolve_spell', target_id: child.id });
  assert.equal(actor(result.state_json, 'wizard').pendingSpell.phase, 'effects');
  const effectId = [child.id, 'summon', 'animate-dead'].map(encodeURIComponent).join(':');
  result = await command(result.state_json, { type: 'resolve_spell', option: effectId });
  assert.equal(undead(result.state_json).length, 0); assert.equal(actor(result.state_json, 'wizard').pendingSpell, null);
  assert.equal(result.state_json.entities.filter(entity => entity.subtype === 'grave-dust').length, 1);
  assert.equal(result.state_json.entities.some(entity => entity.id === child.id && entity.defeated), false);
  assert.deepEqual(loot(result.state_json), originalLoot);
  result = await command(result.state_json, { type: 'normalize' });
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  assert.equal(result.state_json.entities.filter(entity => entity.subtype === 'grave-dust').length, 1);
  assert.deepEqual(loot(result.state_json), originalLoot);
});
