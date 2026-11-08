import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { listMagicEffects } from '../../S3_content/src/magic-effect-registry.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)), { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene() {
  const width = 24, height = 20;
  return { seed: 3, level: 3, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }], entities: [],
    characters: [{ id: 'wizard', name: 'Badzog', className: 'Wizard', ancestry: 'Half-Orc', level: 5,
      x: 4, y: 6, roomId: 'room', hp: 50, maxHitPoints: 50, stats: { INT: 18, STR: 10, DEX: 10, CON: 10, WIS: 10, CHA: 10 },
      spellsKnown: 'Illusion, Dispel Magic, Detect Magic, Light', lightSpellLit: true, lightRadius: 12, lightSource: 'light-spell', gear: [] },
      { id: 'fighter', name: 'Ad', className: 'Fighter', ancestry: 'Human', level: 1, x: 7, y: 6, roomId: 'room', hp: 20, maxHitPoints: 20,
        stats: { STR: 18, DEX: 10, CON: 10 }, gear: [{ name: 'Shortsword', type: 'weapon', equipped: true, slots: 1 }], equipmentInitialized: true }],
    activeCharacterId: 'wizard', player: { x: 4, y: 6, roomId: 'room', torchLit: true },
    timers: { lightEverLit: true, torchElapsedMs: 0, torchDurationMs: 3600000 },
    visibility: { exploredEver: ['4,6', '7,6'] }, combat: { active: false }, wanderingMonsters: { numerator: 0, denominator: 6 } };
}
async function command(state, value, random = .5) {
  const previous = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state, { character_id: 'wizard', ...value }); }
  finally { Math.random = previous; }
}
async function project(state, form, point = { x: 8, y: 6 }, random = .5) {
  let result = await command(state, { type: 'spell', spell_name: 'Illusion' }, random);
  result = await command(result.state_json, { type: 'resolve_spell', option: form });
  return command(result.state_json, { type: 'resolve_spell', ...point, confirmed: true });
}

test('authoritative Illusion casting, placement, and Focus feedback retains the caster-only audience', async () => {
  let result = await command(scene(), { type: 'spell', spell_name: 'Illusion' });
  assert.equal(result.state_json.activity.at(-1).privateCharacterId, 'wizard');
  assert.ok(result.state_json.rollHistory.length);
  assert.ok(result.state_json.rollHistory.every(entry => entry.privateCharacterId === 'wizard'));
  result = await command(result.state_json, { type: 'resolve_spell', option: 'floor' });
  assert.equal(result.state_json.activity.at(-1).privateCharacterId, 'wizard');
  result = await command(result.state_json, { type: 'resolve_spell', x: 8, y: 6, confirmed: true });
  assert.equal(result.state_json.activity.at(-1).privateCharacterId, 'wizard');
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  const focus = result.state_json.rollHistory.find(entry => entry.label === 'Focus');
  assert.equal(focus?.privateCharacterId, 'wizard');
  assert.equal(result.state_json.combat.log.some(message => /maintains Illusion/.test(message)), false);
});

test('authoritative creature illusion joins the party with source AC, HP and attacks and survives normalization', async () => {
  let result = await project(scene(), 'horrible behemoth');
  let actor = result.state_json.characters.find(member => member.illusion);
  assert.ok(actor); assert.equal(actor.armorClass, 20); assert.equal(actor.hp, 60); assert.equal(actor.illusion.footprint, 3);
  assert.match(actor.attacks.join(' '), /bile spit.*\+10.*5d6\+20/);
  result = await command(result.state_json, { type: 'normalize' }); actor = result.state_json.characters.find(member => member.illusion);
  assert.ok(actor); assert.equal(actor.armorClass, 20); assert.equal(actor.companion.kind, 'illusion');
});

test('authoritative natural20 allows two separately placed projections and dispels only the selected one', async () => {
  let result = await project(scene(), 'floor', { x: 5, y: 6 }, .99);
  assert.equal(result.state_json.characters[0].pendingSpell.remaining, 1);
  result = await command(result.state_json, { type: 'resolve_spell', option: 'pit' });
  result = await command(result.state_json, { type: 'resolve_spell', x: 10, y: 6, confirmed: true });
  const zones = result.state_json.entities.filter(entity => entity.illusion); assert.equal(zones.length, 2);
  result = await command(result.state_json, { type: 'spell', spell_name: 'Dispel Magic' });
  result = await command(result.state_json, { type: 'resolve_spell', x: 5, y: 6 });
  const effect = listMagicEffects(result.state_json).find(effect => effect.targetId === zones[0].id);
  assert.ok(effect);
  result = await command(result.state_json, { type: 'resolve_spell', option: effect.id });
  assert.deepEqual(result.state_json.entities.filter(entity => entity.illusion).map(entity => entity.id), [zones[1].id]);
  assert.deepEqual(result.state_json.characters[0].focusSpell.illusionIds, [zones[1].id]);
});

test('a successful attack dismisses an illusion without a corpse, death timer, damage or regeneration', async () => {
  let result = await project(scene(), 'skeleton');
  const actor = result.state_json.characters.find(member => member.illusion);
  result = await command(result.state_json, { type: 'attack', character_id: 'fighter', target_id: actor.id, attack_index: 0, confirmed: true }, .99);
  assert.equal(result.state_json.characters.some(member => member.id === actor.id), false);
  assert.equal(result.state_json.entities.some(entity => entity.characterCorpse?.id === actor.id || entity.gearItem), false);
});

test('floor cover applies inside, expires on leaving with a stealth check, and monster contact removes it', async () => {
  let result = await project(scene(), 'floor', { x: 4, y: 6 });
  assert.equal(result.state_json.characters[0].illusionStealthIds.length, 1);
  result = await command(result.state_json, { type: 'move', dx: -1, dy: 0 });
  assert.equal(result.state_json.characters[0].illusionStealthIds.length, 1);
  result = await command(result.state_json, { type: 'move', dx: -1, dy: 0 });
  assert.equal(result.state_json.characters[0].illusionStealthIds.length, 0);
  assert.equal(result.state_json.characters[0].stealthed, true);
  const state = result.state_json;
  state.entities.push({ id: 'visitor', type: 'monster', name: 'Orc', x: 4, y: 6, hp: 10, maxHp: 10, ac: 12, level: 1,
    attack: '1 axe +1 (1d6)', movement: 'near', hostile: false, attitude: 'neutral', attitudeChecked: true });
  result = await command(state, { type: 'tick', elapsed_ms: 0 });
  assert.equal(result.state_json.entities.some(entity => entity.illusion), false);
});

test('ordinary failed Focus ends all projections but leaves Illusion available for recasting', async () => {
  let result = await project(scene(), 'floor');
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 }, .2);
  assert.equal(result.state_json.characters[0].focusSpell, null);
  assert.equal(result.state_json.entities.some(entity => entity.illusion), false);
  assert.ok(!result.state_json.characters[0].failedSpellKeys.includes('illusion'));
});

test('failed Focus journals creature dismissal and Luck safely restores the projection on a successful reroll', async () => {
  const start = scene(); start.characters[0].luckTokens = 1; start.characters[0].luckToken = true;
  let result = await project(start, 'skeleton');
  const id = result.state_json.characters.find(member => member.illusion).id;
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 }, .2);
  assert.equal(result.state_json.characters.some(member => member.id === id), false);
  result = await command(result.state_json, { type: 'luck' }, .9);
  assert.equal(result.state_json.characters.some(member => member.id === id), true);
  assert.equal(result.state_json.characters[0].focusSpell.spell, 'illusion');
  assert.equal(result.privateCharacterId, 'wizard');
  assert.equal(result.state_json.rollHistory[0].privateCharacterId, 'wizard');
  assert.equal(result.state_json.activity.at(-1).privateCharacterId, 'wizard');
});

test('a monster entering covered real pit ground exposes the illusion and suffers the real falling rules', async () => {
  let result = await project(scene(), 'floor', { x: 10, y: 6 });
  const state = result.state_json;
  state.entities.push({ id: 'pit', type: 'trap', subtype: 'hidden-trap', pit: true, x: 10, y: 6, cells: [{ x: 10, y: 6 }],
    name: 'Pit trap', targetType: 'tile', revealed: false, visible: false },
    { id: 'visitor', type: 'monster', name: 'Orc', x: 10, y: 6, hp: 30, maxHp: 30, ac: 12, level: 1, D: 0,
      attack: '1 axe +1 (1d6)', movement: 'near', hostile: false, attitude: 'neutral', attitudeChecked: true });
  result = await command(state, { type: 'tick', elapsed_ms: 0 }, .2);
  const monster = result.state_json.entities.find(entity => entity.id === 'visitor');
  assert.ok(monster.hp < 30); assert.equal(monster.conditions.sinkhole, 'pit');
  assert.equal(result.state_json.entities.some(entity => entity.illusion), false);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'pit').triggered, true);
});

test('a creature projection takes its combat turn automatically, misses, and returns control to a real character', async () => {
  const placed = await project(scene(), 'horrible behemoth'), state = placed.state_json;
  const projection = state.characters.find(member => member.illusion);
  state.entities.push({ id: 'foe', type: 'monster', name: 'Orc', x: 10, y: 6, hp: 30, maxHp: 30, ac: 1, level: 1, W: 0,
    attack: '1 axe +1 (1d6)', movement: 'near', hostile: true, attitude: 'combat', attitudeChecked: true });
  state.combat = { active: true, round: 1, turnIndex: 0, turnOrder: [{ type: 'character', id: 'wizard' },
    { type: 'character', id: projection.id }, { type: 'monster', id: 'foe' }], actionUsed: false, movementRemaining: 6,
    playerOrderIds: ['wizard', projection.id], monsterIds: ['foe'], pendingPlayerIds: [], surpriseRound: false };
  const result = await command(state, { type: 'end_turn' });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 30);
  assert.equal(result.state_json.combat.turnOrder[result.state_json.combat.turnIndex].id, 'wizard');
  assert.equal(result.state_json.characters.find(member => member.id === projection.id).illusion.lastTurn, '1:1');
});

test('Illusion casting and Focus journaling remain bounded on a dungeon containing many monsters', async () => {
  const state = scene();
  for (let index = 0; index < 40; index++) state.entities.push({ id: `foe-${index}`, type: 'monster', name: 'Orc', x: 21, y: 17,
    hp: 10, maxHp: 10, ac: 12, level: 1, attack: '1 axe +1 (1d6)', movement: 'near',
    hostile: false, attitude: 'neutral', attitudeChecked: true });
  let result = await project(state, 'skeleton');
  assert.equal(result.state_json.characters.filter(member => member.illusion).length, 1);
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 }, .2);
  assert.equal(result.state_json.characters.filter(member => member.illusion).length, 0);
});

test('choosing and previewing the first projection does not begin automatic Focus checks before placement', async () => {
  let result = await command(scene(), { type: 'spell', spell_name: 'Illusion' });
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 }, .2);
  assert.equal(result.state_json.characters[0].pendingSpell.phase, 'options');
  result = await command(result.state_json, { type: 'resolve_spell', option: 'floor' });
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 }, .2);
  assert.equal(result.state_json.characters[0].pendingSpell.phase, 'placement');
});
