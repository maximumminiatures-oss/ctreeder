import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { magicPotion, magicScroll, enchantedEquipment, identifyMagicItem } from '../../S3_content/src/magic-items.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)), { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
function scene() {
  return {
    seed: 123, level: 1, map: { width: 7, height: 7 }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: 49 }, (_, i) => ({ x: i % 7, y: Math.floor(i / 7), type: 'floor', roomId: 'room' })),
    rooms: [{ id: 'room', x: 0, y: 0, width: 7, height: 7 }],
    visibility: { exploredEver: Array.from({ length: 49 }, (_, i) => `${i % 7},${Math.floor(i / 7)}`) },
    entities: [{ id: 'stairs', type: 'stairs', subtype: 'up', x: 2, y: 2, roomId: 'room' },
      { id: 'foe', type: 'monster', name: 'Foe', hp: 100, maxHp: 100, ac: 12, x: 5, y: 2, roomId: 'room', hostile: true, attitude: 'combat', attitudeChecked: true, visible: true, attack: '1 claw +0 (1d4)' }],
    characters: [
      { id: 'priest', name: 'Priest', className: 'Priest', level: 1, stats: { WIS: 14 }, spellsKnown: 'Cure Wounds, Light', hp: 3, maxHitPoints: 10, x: 2, y: 2, roomId: 'room', lightSource: 'torch', lightRadius: 6, gear: [{name:'Torch',lit:true,equipped:true}] },
      { id: 'friend', name: 'Friend', hp: 0, maxHitPoints: 20, dyingRounds: 3, x: 3, y: 3, roomId: 'room', gear: [] }
    ], player: { x: 2, y: 2, roomId: 'room', torchLit: true, lightSource:'torch',lightRadius:6 }, activeCharacterId: 'priest',
    combat: { active: true, round: 1, turnIndex: 0, movementRemaining: 6, actionUsed: false, turnOrder: [{ type: 'character', id: 'priest' }, { type: 'character', id: 'friend' }, {type:'monster',id:'foe'}], playerOrderIds: ['priest', 'friend'], monsterIds: ['foe'] }
  };
}
async function withRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return await fn(); } finally { Math.random = original; }
}
test.after(() => dom.window.close());

function tierTwoScene() {
  const state = scene(); state.combat.active = false; state.characters = [state.characters[0]];
  Object.assign(state.characters[0], { className: 'Wizard', level: 4, stats: { INT: 18, CON: 10, WIS: 18 }, hp: 50, maxHitPoints: 50,
    spellsKnown: 'Acid Arrow, Alter Self, Detect Thoughts, Fixed Object, Hold Person, Invisibility, Knock, Levitate, Mirror Image, Misty Step, Silence, Web', luckTokens: 1 });
  Object.assign(state.entities[1], { name: 'Bandit', level: 1, W: -4, hostile: false, attitude: 'neutral', stealthState: { attempted: true, revealed: true } });
  return state;
}
async function castTier(state, name, random = .5) {
  return withRandom(random, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: name }));
}
async function resolveTier(result, selection) {
  return withRandom(.5, () => executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', ...selection }));
}
test('tier-two runtime Acid Arrow resolves initial and Focus damage and preserves ready targeting after movement', async () => {
  let result = await castTier(tierTwoScene(), 'Acid Arrow');
  assert.equal(result.state_json.characters[0].pendingSpell.spell, 'acid arrow');
  result = await resolveTier(result, { target_id: 'foe' });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 96);
  result = await withRandom(.5, () => executeGameCommand(result.state_json, { type: 'tick', elapsed_ms: 10000 }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 92);
});
test('tier-two runtime transformations, teleport and centered area placement survive authoritative commands', async () => {
  let result = await castTier(tierTwoScene(), 'Alter Self');
  result = await resolveTier(result, { option: 'goat-legs' });
  assert.ok(result.state_json.characters[0].transformationEffects.some(effect => effect.features.includes('goat-legs')));
  result = await castTier(result.state_json, 'Mirror Image');
  assert.equal(result.state_json.characters[0].transformationEffects.find(effect => effect.spell === 'mirror image').offsets.length, 2);
  result = await castTier(result.state_json, 'Misty Step');
  result = await resolveTier(result, { x: 4, y: 4 });
  assert.equal(result.state_json.characters[0].x, 4);
  result = await castTier(result.state_json, 'Web');
  result = await resolveTier(result, { x: 3, y: 3, confirmed: true });
  assert.deepEqual([result.state_json.areaSpells[0].x, result.state_json.areaSpells[0].y, result.state_json.areaSpells[0].width], [0, 0, 6]);
  const blocked = await executeGameCommand(result.state_json, { type: 'move', character_id: 'priest', dx: 1, dy: 0 });
  assert.equal(blocked.state_json.characters[0].x, 4); assert.match(blocked.message, /web/i);
});
test('tier-two runtime Silence rejects casting and Hold Person prevents monster actions', async () => {
  let result = await castTier(tierTwoScene(), 'Silence');
  result = await resolveTier(result, { x: 3, y: 3, confirmed: true });
  await assert.rejects(() => castTier(result.state_json, 'Mirror Image'), /Silence/);
  result = await castTier(tierTwoScene(), 'Hold Person');
  result = await resolveTier(result, { target_id: 'foe' });
  assert.ok(result.state_json.entities.find(entity => entity.id === 'foe').conditions.paralyzed);
});

test('runtime Hold Person Focus natural twenties never offer a critical or change the initial casting benefit', async () => {
  for (const initial of [.5, .999]) {
    let result = await castTier(tierTwoScene(), 'Hold Person', initial);
    if (initial === .999) result = await resolveTier(result, { choice: 'level' });
    result = await resolveTier(result, { target_id: 'foe' });
    result = await withRandom(.999, () => executeGameCommand(result.state_json, { type: 'tick', elapsed_ms: 10000 }));
    const caster = result.state_json.characters[0];
    assert.equal(caster.pendingSpell, null);
    assert.equal(caster.focusSpell.spell, 'hold person');
    assert.equal(caster.focusSpell.maxLevel, initial === .999 ? 8 : 4);
    assert.equal(caster.focusSpell.critical, initial === .999);
    assert.ok(result.state_json.entities.find(entity => entity.id === 'foe').conditions.paralyzed);
  }
});
test('Luck runtime restores a failed spell and resolves its successful reroll without another action', async () => {
  let result = await castTier(tierTwoScene(), 'Mirror Image', .1);
  assert.ok(result.state_json.characters[0].failedSpellKeys.includes('mirror image'));
  result = await withRandom(.8, () => executeGameCommand(result.state_json, { type: 'luck', character_id: 'priest' }));
  assert.ok(!result.state_json.characters[0].failedSpellKeys.includes('mirror image'));
  assert.ok(result.state_json.characters[0].transformationEffects.some(effect => effect.spell === 'mirror image'));
  assert.equal(result.state_json.characters[0].luckTokens, 0);
});
test('Luck runtime converts an old missed attack into damage at the target current position', async () => {
  const state = tierTwoScene(), actor = state.characters[0];
  Object.assign(actor, { className: 'Fighter', stats: { STR: 10, DEX: 10, WIS: 18 }, equipmentInitialized: true, lightSpellLit: true,
    gear: [{ name: 'Dagger', type: 'weapon', equipped: true }] });
  Object.assign(state.entities[1], { x: 3, y: 2, ac: 15, hp: 100 });
  let result = await withRandom(.1, () => executeGameCommand(state, { type: 'attack', character_id: 'priest', monster_id: 'foe', attack_index: 0 }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 100);
  result.state_json.entities.find(entity => entity.id === 'foe').x = 6;
  result = await withRandom(.8, () => executeGameCommand(result.state_json, { type: 'luck', character_id: 'priest' }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').x, 6);
  assert.ok(result.state_json.entities.find(entity => entity.id === 'foe').hp < 100);
});
test('Luck runtime turns a monster hit into a miss and restores a dying character without changing selection', async () => {
  const state = tierTwoScene(); state.characters[0].hp = 3;
  Object.assign(state.entities[1], { x: 3, y: 2, attitude: 'combat', hostile: true });
  Object.assign(state.combat, { active: true, turnOrder: [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }], playerOrderIds: ['priest'] });
  let result = await withRandom(.8, () => executeGameCommand(state, { type: 'end_turn', character_id: 'priest' }));
  assert.equal(result.state_json.characters[0].hp, 0);
  assert.ok(result.state_json.characters[0].dyingRounds > 0);
  result = await withRandom(.05, () => executeGameCommand(result.state_json, { type: 'luck', character_id: 'priest' }));
  assert.equal(result.state_json.characters[0].hp, 3);
  assert.equal(result.state_json.characters[0].dyingRounds, 0);
  assert.equal(result.state_json.activeCharacterId, 'priest');
});
test('tier-two runtime Claws allow exactly two attacks and furniture uses AC 10 and HP 10', async () => {
  const state = tierTwoScene(); state.combat.active = true;
  Object.assign(state.combat, { actionUsed: false, turnOrder: [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }], playerOrderIds: ['priest'] });
  Object.assign(state.entities[1], { x: 3, y: 2 });
  state.characters[0].transformationEffects = [{ spell: 'alter self', rounds: 5, features: ['claws'] }];
  let result = await executeGameCommand(state, { type: 'normalize', character_id: 'priest' });
  const index = result.state_json.characters[0].attacks.length;
  result = await withRandom(.8, () => executeGameCommand(result.state_json, { type: 'attack', character_id: 'priest', monster_id: 'foe', attack_index: index }));
  assert.equal(result.state_json.combat.actionUsed, false);
  result = await withRandom(.8, () => executeGameCommand(result.state_json, { type: 'attack', character_id: 'priest', monster_id: 'foe', attack_index: index }));
  assert.equal(result.state_json.combat.actionUsed, true);
  const hp = result.state_json.entities.find(entity => entity.id === 'foe').hp;
  const third = await executeGameCommand(result.state_json, { type: 'attack', character_id: 'priest', monster_id: 'foe', attack_index: index });
  assert.equal(third.state_json.entities.find(entity => entity.id === 'foe').hp, hp); assert.match(third.message, /acted|attacks remain/i);
  const furniture = tierTwoScene(); furniture.entities = furniture.entities.filter(entity => entity.type !== 'monster');
  furniture.characters[0].equipmentInitialized = true;
  furniture.characters[0].lightSpellLit = true;
  furniture.characters[0].gear = [{ name: 'Dagger', type: 'weapon', equipped: true }];
  furniture.entities.push({ id: 'chair', type: 'feature', subtype: 'furniture', name: 'Chair', x: 3, y: 2, visible: true });
  const hit = await withRandom(.8, () => executeGameCommand(furniture, { type: 'attack_empty', character_id: 'priest', x: 3, y: 2 }));
  assert.equal(hit.state_json.entities.find(entity => entity.id === 'chair').hp, 6);
});

test('authoritative level-up rolls only on request and spell choices persist without rerolls', async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);
  Object.assign(state.characters[0],{className:'Wizard',level:1,XP:12,alignment:'Lawful',spellsKnown:'Light, Sleep, Magic Missile',stats:{INT:12,CON:12}});
  const result=await withRandom(.5,()=>executeGameCommand(state,{type:'level_up',character_id:'priest'}));
  const character=result.state_json.characters[0];assert.equal(character.level,2);assert.equal(character.XP,2);assert.equal(character.maxHitPoints,14);
  assert.equal(character.advancements[0].tasks[0].tier,1);
  await assert.rejects(()=>executeGameCommand(result.state_json,{type:'level_up',character_id:'priest'}),/no new level/);
  await assert.rejects(()=>executeGameCommand(result.state_json,{type:'advance_choice',character_id:'priest',event_id:'level-2',task_id:'spell',value:'Cure Wounds'}),/valid pending/);
  const chosen=await executeGameCommand(result.state_json,{type:'advance_choice',character_id:'priest',event_id:'level-2',task_id:'spell',value:'Alarm'});
  assert.ok(chosen.state_json.characters[0].spellsKnown.includes('Alarm'));assert.equal(chosen.state_json.characters[0].maxHitPoints,14);
  await assert.rejects(()=>executeGameCommand(chosen.state_json,{type:'advance_choice',character_id:'priest',event_id:'level-2',task_id:'spell',value:'Alarm'}),/valid pending/);
});

test('fighter level-up scales existing weapon mastery and stacks the newly rolled attack talent',async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);
  Object.assign(state.characters[0],{className:'Fighter',level:2,XP:20,alignment:'Lawful',stats:{STR:10,DEX:10,CON:10},
    gear:[{name:'Shortsword',type:'weapon',equipped:true}],equipmentInitialized:true,
    bonuses:[{name:'WeaponMastery',bonusTo:'Shortsword',bonusAmount:1,sourceType:'Class',sourceName:'Fighter',gainedAtLevel:1}]});
  const result=await withRandom(.4,()=>executeGameCommand(state,{type:'level_up',character_id:'priest'}));
  const character=result.state_json.characters[0];assert.equal(character.level,3);assert.equal(character.title,'Cavalier');
  assert.ok(character.attacks.some(attack=>/Shortsword.*\+3, 1d6\+2/i.test(attack)),character.attacks);
  state.combat.active=true;
  await assert.rejects(()=>executeGameCommand(state,{type:'level_up',character_id:'priest'}),/outside combat/);
});

function discScene() {
  const state = scene(); state.combat.active = false; state.entities = state.entities.filter(entity => entity.type !== 'monster');
  Object.assign(state.characters[0], { className: 'Wizard', stats: { INT: 14, DEX: 12 }, spellsKnown: 'Alarm, Floating Disk',
    gear: [{ name: 'Torch', quantity: 6, totalUnits: 6 }, { name: 'Rations', quantity: 4 }, { name: 'Flint and steel' }] });
  state.characters[1].hp = 10; state.characters[1].dyingRounds = 0;
  return state;
}

function ambushScene({ movement = 6, x = movement + 2, attack = '1 sword +2 (1d6)' } = {}) {
  const state = scene();
  state.map.width = 23;
  state.tiles = Array.from({ length: 161 }, (_, i) => ({ x: i % 23, y: Math.floor(i / 23), type: Math.floor(i / 23) === 2 ? 'floor' : 'wall', roomId: 'room' }));
  state.rooms[0].width = 23;
  Object.assign(state.characters[0], { x: 1, y: 2, hp: 50, maxHitPoints: 50, ancestry: 'Goblin', stats: { DEX: 30, WIS: 10 }, lightRadius: 3 });
  Object.assign(state.characters[1], { x: 0, y: 2, hp: 30, maxHitPoints: 30, dyingRounds: 0, ancestry: 'Human' });
  Object.assign(state.player, { x: 1, y: 2, lightRadius: 3 });
  Object.assign(state.entities[1], { name: 'Bandit', x, y: 2, attack, movement: String(movement), D: 2,
    stealthState: { attempted: true, roll: 20, total: 22, revealed: false } });
  state.combat.active = false;
  return state;
}

test('hidden melee monsters start surprise at movement plus attack reach, with turns only for monsters and goblins', async () => {
  for (const movement of [6, 12]) {
    const state = ambushScene({ movement });
    let result = await withRandom(.6, () => executeGameCommand(state, { type: 'tick', elapsed_ms: 1000 }));
    assert.equal(result.state_json.combat.surpriseRound, true);
    assert.equal(result.state_json.combat.round, 0);
    assert.deepEqual(new Set(result.state_json.combat.surpriseParticipantIds), new Set(['priest', 'foe']));
    assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').x, movement + 2);
    assert.ok(result.state_json.combat.turnOrder.every(entry => entry.type === 'monster' || entry.id === 'priest'));
    result = await withRandom(.6, () => executeGameCommand(result.state_json, { type: 'end_turn', character_id: 'priest' }));
    assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').x, 2);
    assert.ok(result.state_json.characters[0].hp < 50);
    assert.ok(result.state_json.rollHistory.some(entry => /Bandit attacks Priest at advantage/.test(entry.detail)));
    assert.equal(result.state_json.combat.surpriseRound, false);
  }
});

test('hidden approaches remain outside combat until the monster can attack this turn', async () => {
  let state = ambushScene({ x: 11 });
  for (const expected of [10, 9]) {
    const result = await withRandom(.6, () => executeGameCommand(state, { type: 'tick', elapsed_ms: 1000 }));
    assert.equal(result.state_json.combat.active, false);
    const monster = result.state_json.entities.find(entity => entity.id === 'foe');
    assert.equal(monster.x, expected); assert.equal(monster.stealthState.revealed, false);
    state = result.state_json;
  }
  const result = await withRandom(.6, () => executeGameCommand(state, { type: 'tick', elapsed_ms: 1000 }));
  assert.equal(result.state_json.combat.surpriseRound, true);
});

test('ranged ambushers plan through ordinary doors and fire at the longest visible circular range', async () => {
  const state = ambushScene({ x: 10, attack: '1 bow +3 (near 1d6)' });
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 8, y: 2, roomId: 'room', wallSide: 'east', doorState: 'closed', visible: true });
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'tick', elapsed_ms: 1000 }));
  assert.equal(result.state_json.combat.surpriseRound, true);
  result = await withRandom(.6, () => executeGameCommand(result.state_json, { type: 'end_turn', character_id: 'priest' }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'door').doorState, 'open');
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').x, 7);
  assert.ok(result.state_json.rollHistory.some(entry => /Bandit attacks Priest at advantage/.test(entry.detail)));
});

test('a revealed archer retreats into darkness, attacks at advantage, and cannot be directly targeted there', async () => {
  const state = ambushScene({ x: 9, attack: '1 bow +3 (far 1d6)' });
  state.combat = scene().combat; state.combat.playerOrderIds = ['priest'];
  state.combat.turnOrder = [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }];
  state.entities[1].stealthState.revealed = true;
  const result = await withRandom(.6, () => executeGameCommand(state, { type: 'end_turn', character_id: 'priest' }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').x, 13);
  assert.ok(result.state_json.rollHistory.some(entry => /Bandit attacks Priest at advantage/.test(entry.detail)));
  await assert.rejects(executeGameCommand(result.state_json, { type: 'attack', character_id: 'priest', monster_id: 'foe' }), /not visible/);
});

test('hidden Void Spiders can still phase through a wall while preparing their approach', async () => {
  const state = ambushScene();
  Object.assign(state.entities[1], { name: 'Void Spider', x: 5 });
  state.tiles.find(tile => tile.x === 3 && tile.y === 2).type = 'wall';
  const result = await withRandom(.6, () => executeGameCommand(state, { type: 'search', character_id: 'priest' }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').conditions.incorporeal, true);
});

test('Hold Portal resolves onto a door, ordinary door use is free, and forcing spends an action', async () => {
  const state = discScene(); state.characters = state.characters.slice(0, 1);
  const actor = state.characters[0]; Object.assign(actor, { spellsKnown: 'Hold Portal', x: 2, y: 2, hp: 10, maxHitPoints: 10, stats: { INT: 14, STR: 18 } });
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 3, y: 2, roomId: 'room', wallSide: 'east', orientation: 'vertical', doorState: 'open', visible: true });
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'spell', character_id: actor.id, spell_name: 'Hold Portal' }));
  result = await executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: actor.id, target_id: 'door' });
  let door = result.state_json.entities.find(entity => entity.id === 'door');
  assert.equal(door.holdPortal.dc, 15); assert.equal(door.doorState, 'closed');
  result.state_json.combat = { ...state.combat, active: true, round: 1, turnIndex: 0, actionUsed: false, turnOrder: [{ type: 'character', id: actor.id }], playerOrderIds: [actor.id], monsterIds: [] };
  // Keep one distant sleeping foe so combat does not end before the assertion.
  result.state_json.entities.push({ id: 'foe', type: 'monster', name: 'Foe', x: 6, y: 6, hp: 10, ac: 10, hostile: true, attitude: 'combat', attitudeChecked: true, conditions: { sleeping: {} } });
  result.state_json.combat.monsterIds = ['foe'];
  result = await withRandom(.9, () => executeGameCommand(result.state_json, { type: 'interact', character_id: actor.id, x: 3, y: 2 }));
  door = result.state_json.entities.find(entity => entity.id === 'door');
  assert.equal(door.holdPortal, undefined); assert.equal(door.doorState, 'open'); assert.equal(result.state_json.combat.actionUsed, true);
  result = await executeGameCommand(result.state_json, { type: 'interact', character_id: actor.id, x: 3, y: 2 });
  assert.equal(result.state_json.entities.find(entity => entity.id === 'door').doorState, 'closed');
  assert.equal(result.state_json.combat.actionUsed, true);
});

test('ranged monsters pursue through a closed door instead of ending combat or stopping at attack range', async () => {
  const state = scene(); state.characters = state.characters.slice(0, 1);
  state.characters[0].x = 1; state.player.x = 1;
  state.combat.turnOrder = [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }];
  state.combat.playerOrderIds = ['priest'];
  state.tiles.forEach(tile => { if (tile.y !== 2) tile.type = 'wall'; });
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 3, y: 2, roomId: 'room', wallSide: 'east', doorState: 'closed', visible: true });
  state.entities[1].attack = '1 bow +3 (near 1d6)';
  const result = await withRandom(.6, () => executeGameCommand(state, { type: 'end_turn', character_id: 'priest' }));
  assert.equal(result.state_json.combat.active, true);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'door').doorState, 'open');
  assert.ok(result.state_json.entities.find(entity => entity.id === 'foe').x < 5);
  assert.ok(result.state_json.rollHistory.some(entry => /Foe attacks Priest/.test(entry.detail)));
  assert.equal(result.state_json.monsterTurnEvents[0].actor.id, 'foe');
  assert.equal(result.state_json.monsterTurnEvents[0].range, 6);
});

test('Hold Portal stops pursuit and a failed monster forcing check uses its action', async () => {
  const state = scene(); state.characters = state.characters.slice(0, 1); state.characters[0].x = 1; state.player.x = 1;
  state.combat.turnOrder = [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }]; state.combat.playerOrderIds = ['priest'];
  state.tiles.forEach(tile => { if (tile.y !== 2) tile.type = 'wall'; });
  state.entities[1].x = 4; state.entities[1].attack = '1 bow +3 (near 1d6)';
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 3, y: 2, roomId: 'room', wallSide: 'east', doorState: 'closed', holdPortal: { rounds: 10, dc: 99, casterId: 'priest' } });
  const result = await withRandom(.6, () => executeGameCommand(state, { type: 'end_turn', character_id: 'priest' }));
  assert.equal(result.state_json.combat.active, true); assert.equal(result.state_json.characters[0].hp, 3);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'door').doorState, 'closed');
  assert.ok(result.state_json.rollHistory.some(entry => /cannot force/.test(entry.detail)));
});

test('an incorporeal monster crosses walls but spends a later action materializing before it can attack', async () => {
  const state = scene(); state.characters = state.characters.slice(0, 1); state.characters[0].x = 1; state.player.x = 1;
  state.combat.turnOrder = [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }]; state.combat.playerOrderIds = ['priest'];
  state.tiles.forEach(tile => { if (tile.x === 3 || tile.y !== 2) tile.type = 'wall'; });
  state.entities[1].name = 'Ghost'; state.entities[1].conditions = { incorporeal: true };
  let result = await executeGameCommand(state, { type: 'end_turn', character_id: 'priest' });
  let ghost = result.state_json.entities.find(entity => entity.id === 'foe');
  assert.equal(ghost.x, 2); assert.equal(ghost.conditions.incorporeal, true); assert.equal(result.state_json.characters[0].hp, 3);
  result = await executeGameCommand(result.state_json, { type: 'end_turn', character_id: 'priest' });
  ghost = result.state_json.entities.find(entity => entity.id === 'foe');
  assert.equal(ghost.conditions.incorporeal, false); assert.equal(result.state_json.characters[0].hp, 3);
});

test('Sleep applies without a target click; waking uses an action and standing costs movement', async () => {
  const state = scene();
  Object.assign(state.characters[0], { className: 'Wizard', spellsKnown: 'Sleep', stats: { INT: 14 } });
  Object.assign(state.characters[1], { hp: 8, dyingRounds: 0 });
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Sleep' }));
  assert.ok(result.state_json.characters[1].conditions.sleeping);
  assert.ok(result.state_json.entities.find(entity => entity.id === 'foe').conditions.sleeping);
  assert.equal(result.state_json.characters[0].conditions.sleeping, undefined);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'move', character_id: 'friend', dx: 1, dy: 0 }), /cannot act/);
  result.state_json.combat.actionUsed = false;
  result = await executeGameCommand(result.state_json, { type: 'wake', character_id: 'priest', target_id: 'friend' });
  assert.equal(result.state_json.characters[1].conditions.sleeping, undefined);
  assert.equal(result.state_json.characters[1].conditions.prone, true); assert.equal(result.state_json.combat.actionUsed, true);
  result.state_json.combat.turnIndex = 1; result.state_json.combat.actionUsed = false; result.state_json.combat.movementRemaining = 6;
  result = await executeGameCommand(result.state_json, { type: 'stand', character_id: 'friend' });
  assert.equal(result.state_json.combat.movementRemaining, 3); assert.equal(result.state_json.combat.actionUsed, false);
});

test('free Revive succeeds only on natural twenty and cannot be repeated on the same turn', async () => {
  const state = scene(); state.combat.turnIndex = 1;
  let result = await withRandom(.99, () => executeGameCommand(state, { type: 'revive', character_id: 'friend' }));
  const friend = result.state_json.characters.find(character => character.id === 'friend');
  assert.equal(friend.hp, 1); assert.equal(friend.dyingRounds, 0); assert.equal(friend.conditions.prone, true);
  assert.equal(result.state_json.combat.actionUsed, false); assert.equal(result.state_json.combat.movementRemaining, 6);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'revive', character_id: 'friend' }), /dying character/);
});

test('player attacks require explicit confirmation, never target self, and damage uses character HP rules', async () => {
  const state = scene(); Object.assign(state.characters[1], { hp: 8, maxHitPoints: 8, dyingRounds: 0 });
  Object.assign(state.characters[0], { className: 'Fighter', stats: { STR: 16 }, equipmentInitialized: true, lightSpellLit: true,
    gear: [{ name: 'Dagger', type: 'weapon', equipped: true, slots: 1 }] });
  await assert.rejects(executeGameCommand(state, { type: 'attack', character_id: 'priest', target_id: 'friend', attack_index: 0 }), /Confirm/);
  await assert.rejects(executeGameCommand(state, { type: 'attack', character_id: 'priest', target_id: 'priest', confirmed: true, attack_index: 0 }), /Confirm/);
  const result = await withRandom(.99, () => executeGameCommand(state, { type: 'attack', character_id: 'priest', target_id: 'friend', confirmed: true, attack_index: 0 }));
  assert.ok(result.state_json.characters[1].hp < 8); assert.equal(result.state_json.combat.actionUsed, true);
  assert.match(result.state_json.rollHistory[0].detail, /attacks Friend/); assert.ok(result.state_json.rollHistory[0].segments.length);
});

test('empty attacks log a miss and melee door attacks deplete AC 10 / HP 15 doors', async () => {
  const state = discScene(); const actor = state.characters[0];
  Object.assign(actor, { className: 'Fighter', stats: { STR: 18 }, equipmentInitialized: true, lightSpellLit: true, gear: [{ name: 'Dagger', type: 'weapon', equipped: true }] });
  let result = await withRandom(.8, () => executeGameCommand(state, { type: 'attack_empty', character_id: actor.id, x: 1, y: 2, attack_index: 0 }));
  assert.match(result.state_json.rollHistory[0].detail, /attacks nothing.*\n17 Miss!/);
  result.state_json.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 3, y: 2, roomId: 'room', wallSide: 'east', doorState: 'closed', breakDc: 10, visible: true });
  result = await withRandom(.9, () => executeGameCommand(result.state_json, { type: 'attack_door', character_id: actor.id, entity_id: 'door', attack_index: 0 }));
  assert.ok(result.state_json.entities.find(entity => entity.id === 'door').hp < 15);
  for (let i = 0; i < 4 && result.state_json.entities.find(entity => entity.id === 'door')?.doorState !== 'gone'; i++)
    result = await withRandom(.9, () => executeGameCommand(result.state_json, { type: 'attack_door', character_id: actor.id, entity_id: 'door', attack_index: 0 }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'door')?.doorState, 'gone');
});

test('adjacent thrown weapons can smash doors, dagger rolls at disadvantage, and bows cannot smash', async () => {
  for (const name of ['Spear', 'Dagger', 'Shortbow']) {
    const state = discScene(); const actor = state.characters[0];
    Object.assign(actor, { className: 'Fighter', stats: { STR: 18 }, equipmentInitialized: true, lightSpellLit: true,
      gear: [{ name, type: 'weapon', equipped: true }, { name: 'Arrows', totalUnits: 20 }] });
    state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 3, y: 2, roomId: 'room', wallSide: 'east', doorState: 'closed', breakDc: 99, visible: true });
    if (name === 'Shortbow') {
      await assert.rejects(executeGameCommand(state, { type: 'attack_door', character_id: actor.id, entity_id: 'door', attack_index: 0 }), /melee weapon/);
      continue;
    }
    const result = await withRandom(.5, () => executeGameCommand(state, { type: 'attack_door', character_id: actor.id, entity_id: 'door', attack_index: 0 }));
    const entry = result.state_json.rollHistory[0];
    assert.equal(entry.segments.some(part => part.tooltip?.some?.(segment => /2d20/.test(segment.text))), name === 'Dagger');
  }
});

test('a prone ambusher spends half its movement standing and cannot move a second full budget', async () => {
  const state = scene(); state.characters = state.characters.slice(0, 1);
  state.characters[0].x = 0; state.player.x = 0;
  state.combat.turnOrder = [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }]; state.combat.playerOrderIds = ['priest'];
  state.tiles.forEach(tile => { if (tile.y !== 2) tile.type = 'wall'; });
  Object.assign(state.entities[1], { x: 6, movement: 'near', ambushAttack: true, conditions: { prone: true } });
  const result = await withRandom(.6, () => executeGameCommand(state, { type: 'end_turn', character_id: 'priest' }));
  const monster = result.state_json.entities.find(entity => entity.id === 'foe');
  assert.equal(monster.x, 3); assert.equal(monster.conditions.prone, undefined);
  assert.equal(result.state_json.characters[0].hp, 3);
});

test('Steal stores one advantage roll, prevents armor theft and takes one item without rerolling', async () => {
  const state = scene();
  Object.assign(state.characters[0], { className: 'Thief', stats: { DEX: 18 }, stealthed: true });
  Object.assign(state.entities[1], { x: 3, y: 2, W: 1, gear: [{ name: 'Chainmail', type: 'armor', equipped: true }, { name: 'Rope', slots: 1 }] });
  let result = await withRandom(.7, () => executeGameCommand(state, { type: 'steal', character_id: 'priest' }));
  assert.equal(result.state_json.characters[0].pendingSteal.check.total, 19);
  result = await withRandom(0, () => executeGameCommand(result.state_json, { type: 'steal_target', character_id: 'priest', target_id: 'foe' }));
  await assert.rejects(executeGameCommand(result.state_json, { type: 'steal_take', character_id: 'priest', gear_index: 0 }), /cannot be stolen/);
  result = await withRandom(0, () => executeGameCommand(result.state_json, { type: 'steal_take', character_id: 'priest', gear_index: 1 }));
  assert.equal(result.state_json.characters[0].pendingSteal, null);
  assert.ok(result.state_json.characters[0].gear.some(item => item.name === 'Rope'));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').gear.length, 1);
});

test('failed theft ends ordinary stealth without breaking even spell invisibility', async () => {
  const state = scene();
  Object.assign(state.characters[0], { className: 'Thief', stats: { DEX: 10 }, stealthed: true,
    invisibility: { rounds: 10, source: 'spell', breakOnOffense: true } });
  const result = await withRandom(0, () => executeGameCommand(state, { type: 'steal', character_id: 'priest' }));
  assert.equal(result.state_json.characters[0].stealthed, false);
  assert.equal(result.state_json.characters[0].invisibility.rounds, 10);
  assert.equal(result.state_json.characters[0].pendingSteal, null);
});

test('light reset handles every lantern without spare oil and No preserves elapsed time and other lights', async () => {
  for (const reset of [true, false]) {
    const state = discScene();
    state.characters[0].gear = [{ name: 'Torch', equipped: true, lit: true }, { name: 'Torch', lit: false },
      { name: 'Lantern', equipped: false, lit: true }, { name: 'Flint and steel' }];
    Object.assign(state.characters[0], { equipmentInitialized: true, lightSource: 'torch', lightRadius: 6 });
    state.timers = { torchElapsedMs: 12345, torchDurationMs: 3600000, lightEverLit: true, actualElapsedMs: 12345, lastTickAt: Date.now() };
    const result = await executeGameCommand(state, { type: 'light', character_id: 'priest', source: 'torch', gear_index: 1, reset_timer: reset });
    assert.equal(result.state_json.timers.torchElapsedMs, reset ? 0 : 12345);
    assert.equal(result.state_json.characters[0].gear.find(item => item.name === 'Lantern').lit, !reset);
    assert.equal(result.state_json.characters[0].gear.filter(item => item.name === 'Torch').length, 1);
    if (!reset) assert.ok(result.state_json.entities.some(entity => entity.lightSource === 'torch'));
  }
});

test('incorporeal companions cross solid tiles but cannot attack or interact until spending an action to materialize', async () => {
  const state = discScene(); state.characters = state.characters.slice(0, 1);
  Object.assign(state.characters[0], { name: 'Ghost', className: 'Monster', conditions: { incorporeal: true } });
  state.tiles.find(tile => tile.x === 3 && tile.y === 2).type = 'wall';
  let result = await executeGameCommand(state, { type: 'move', character_id: 'priest', dx: 1, dy: 0 });
  assert.equal(result.state_json.characters[0].x, 3);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'phase', character_id: 'priest' }), /solid terrain/);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'attack_empty', character_id: 'priest', x: 4, y: 2, attack_index: 0 }), /corporeal/);
  result = await executeGameCommand(result.state_json, { type: 'move', character_id: 'priest', dx: 1, dy: 0 });
  result = await executeGameCommand(result.state_json, { type: 'phase', character_id: 'priest' });
  assert.equal(result.state_json.characters[0].conditions.incorporeal, false);
});

test('authoritative Mage Armor replaces even higher AC, applies only to self, and spends one action', async () => {
  for (const [random, ac] of [[.6, 14], [.99, 18]]) {
    const state = scene();
    Object.assign(state.characters[0], { className: 'Wizard', spellsKnown: 'Mage Armor', stats: { INT: 14, DEX: 40 } });
    const result = await withRandom(random, () => executeGameCommand(state, {
      type: 'spell', character_id: 'priest', spell_name: 'Mage Armor', target_id: 'friend'
    }));
    assert.equal(result.state_json.characters[0].armorClass, ac);
    assert.equal(result.state_json.characters[0].wizardEffects[0].rounds, 10);
    assert.equal(result.state_json.characters[0].pendingSpell, null);
    assert.equal(result.state_json.characters[1].wizardEffects.length, 0);
    assert.equal(result.state_json.combat.actionUsed, true);
    await assert.rejects(executeGameCommand(result.state_json, { type: 'spell', character_id: 'priest', spell_name: 'Mage Armor' }), /already acted/);
  }
});

test('Mage Armor expires on the normal outside-combat clock and restores current DEX immediately', async () => {
  const state = discScene();
  Object.assign(state.characters[0], { spellsKnown: 'Mage Armor', stats: { INT: 14, DEX: 8 } });
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Mage Armor' }));
  assert.equal(result.state_json.characters[0].armorClass, 14);
  result.state_json.characters[0].stats.DEX = 18;
  for (let tick = 0; tick < 6; tick++) result = await executeGameCommand(result.state_json, { type: 'tick', elapsed_ms: 15000 });
  assert.equal(result.state_json.characters[0].wizardEffects[0].rounds, 1);
  assert.equal(result.state_json.characters[0].armorClass, 14);
  result = await executeGameCommand(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  assert.equal(result.state_json.characters[0].wizardEffects.length, 0);
  assert.equal(result.state_json.characters[0].armorClass, 14);
  result.state_json.characters[0].stats.DEX = 8;
  result = await executeGameCommand(result.state_json, { type: 'normalize' });
  assert.equal(result.state_json.characters[0].armorClass, 9);
});

test('a Mage Armor scroll casts an unknown class-list spell and expiry advances on combat rounds, not ticks', async () => {
  const state = scene();
  state.characters = state.characters.slice(0, 1);
  state.combat.turnOrder = [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }];
  state.combat.playerOrderIds = ['priest'];
  Object.assign(state.characters[0], { className: 'Wizard', stats: { INT: 14 }, spellsKnown: '',
    gear: [magicScroll({ name: 'Mage Armor', tier: 1, classes: ['wizard'] })] });
  let result = await withRandom(.99, () => executeGameCommand(state, { type: 'read_scroll', character_id: 'priest', gear_index: 0 }));
  assert.equal(result.state_json.characters[0].armorClass, 18);
  assert.equal(result.state_json.characters[0].gear[0].name, 'Blank paper');
  result = await executeGameCommand(result.state_json, { type: 'tick', elapsed_ms: 15000 });
  assert.equal(result.state_json.characters[0].wizardEffects[0].rounds, 10);
  result.state_json.characters[0].wizardEffects[0].rounds = 1;
  result.state_json.characters[0].hp = 100; result.state_json.characters[0].maxHitPoints = 100;
  result = await withRandom(.2, () => executeGameCommand(result.state_json, { type: 'end_turn', character_id: 'priest' }));
  assert.equal(result.state_json.characters[0].wizardEffects.length, 0);
  assert.equal(result.state_json.characters[0].armorClass, 10);
});

test('Mage Armor is cleared on personal-character import while unrelated wizard effects remain', async () => {
  const state = discScene(), imported = structuredClone(state.characters[0]);
  imported.wizardEffects = [{ type: 'mage-armor', armorClass: 18, rounds: 7 }, { type: 'unstable', tier: 1, rounds: 3 }];
  const result = await executeGameCommand(state, { type: 'import', character_json: imported, new_character_id: 'arriving-wizard' });
  const arrival = result.state_json.characters.find(character => character.id === 'arriving-wizard');
  assert.deepEqual(arrival.wizardEffects.map(effect => effect.type), ['unstable']);
  assert.equal(arrival.armorClass, 11);
});

test('authoritative Alarm prepares one rest and can be cast while multiplayer consent is pending', async () => {
  for (const voting of [false, true]) {
    let state = discScene();
    if (voting) state = (await executeGameCommand(state, { type: 'rest', character_id: 'priest', rest_member_id: 'a', rest_member_ids: ['a', 'b'] })).state_json;
    const result = await withRandom(.99, () => executeGameCommand(state, { type: 'rest_alarm', character_id: 'priest' }));
    assert.equal((voting ? result.state_json.rest.alarm : result.state_json.preparedAlarm).encounterDivisor, 4);
    await assert.rejects(executeGameCommand(result.state_json, { type: 'rest_alarm', character_id: 'friend' }), /unavailable/);
  }
});

test('authoritative disc creation, forbidden actions and caster-turn inventory restrictions', async () => {
  let result = await withRandom(.6, () => executeGameCommand(discScene(), { type: 'spell', character_id: 'priest', spell_name: 'Floating Disk' }));
  const disc = result.state_json.characters.find(character => character.summon);
  assert.ok(disc); assert.equal(disc.gearSlotsTotal, 20); assert.equal(disc.hp, 0);
  for (const type of ['move', 'attack', 'stealth', 'edit_character', 'dismiss', 'spell']) {
    await assert.rejects(executeGameCommand(result.state_json, { type, character_id: disc.id, dx: 1, dy: 0 }), /Floating Disc/);
  }
  const state = result.state_json;
  state.combat = scene().combat;
  state.entities.push(scene().entities[1]);
  state.characters.find(character => character.id === disc.id).gear = [{ name: 'Lantern', lit: true }, { name: 'Dagger', type: 'weapon' }];
  result = await executeGameCommand(state, { type: 'equip', character_id: disc.id, gear_index: 0, equipped: true });
  assert.equal(result.state_json.combat.actionUsed, true);
  assert.equal(result.state_json.characters.find(character => character.id === disc.id).lightRadius, 12);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'equip', character_id: disc.id, gear_index: 0, equipped: false }), /already acted|cannot change/);
  state.combat.actionUsed = false;
  await assert.rejects(executeGameCommand(state, { type: 'equip', character_id: disc.id, gear_index: 1, equipped: true }), /only lanterns/);
  state.combat.turnIndex = 1;
  await assert.rejects(executeGameCommand(state, { type: 'get', character_id: disc.id }), /not this character/);
});

test('disc expiry and caster death drop every cargo item, money and lit lantern without losing stacks', async () => {
  const made = await withRandom(.6, () => executeGameCommand(discScene(), { type: 'spell', character_id: 'priest', spell_name: 'Floating Disc' }));
  for (const death of [false, true]) {
    const state = structuredClone(made.state_json), disc = state.characters.find(character => character.summon);
    disc.gear = [{ name: 'Lantern', lit: true, equipped: true }, { name: 'Rations', quantity: 50, totalUnits: 50 }];
    disc.gold = 13;
    if (death) { state.characters[0].hp = 0; state.characters[0].dyingRounds = 2; state.characters[0].focusSpell = { spell: 'detect magic' }; }
    else disc.summon.remainingMs = 1;
    const result = await executeGameCommand(state, { type: 'tick', elapsed_ms: 10 });
    assert.equal(result.state_json.characters.some(character => character.summon), false);
    const drops = result.state_json.entities.filter(entity => entity.id.startsWith(disc.id));
    assert.equal(drops.length, 3); assert.equal(new Set(drops.map(entity => entity.id)).size, 3);
    assert.equal(drops.find(entity => entity.gearItem?.name === 'Rations').gearItem.totalUnits, 50);
    assert.equal(drops.find(entity => entity.gearItem?.name === 'Lantern').lightRadius, 12);
    assert.equal(drops.find(entity => entity.coinBreakdown)?.coinBreakdown.gold, 13);
    if (death) assert.equal(result.state_json.characters[0].focusSpell, null);
  }
});

test('Alarm prevents the resting party surprise round even when wandering monsters arrive', async () => {
  const state = discScene(); state.generation.entranceRoomId = 'elsewhere';
  state.entities = []; state.map = { width: 9, height: 9 }; Object.assign(state.rooms[0], { width: 9, height: 9 });
  state.tiles = Array.from({ length: 81 }, (_, index) => ({ x: index % 9, y: Math.floor(index / 9), type: 'floor', roomId: 'room' }));
  for (const character of state.characters) { character.hp = 30; character.maxHitPoints = 30; }
  state.preparedAlarm = { casterId: 'priest', roomId: 'room', encounterDivisor: 4 };
  state.wanderingMonsters = { numerator: 4, denominator: 1 };
  const started = await executeGameCommand(state, { type: 'rest', character_id: 'priest' });
  started.state_json.rest.nextHourAt = Date.now() - 1000;
  const result = await withRandom(.4, () => executeGameCommand(started.state_json, { type: 'tick', elapsed_ms: 1000 }));
  assert.equal(result.state_json.rest.phase, 'interrupted');
  assert.equal(result.state_json.combat.active, true);
  assert.equal(result.state_json.combat.surpriseRound, false);
  assert.ok(result.state_json.combat.playerOrderIds.includes('friend'));
});

test('authoritative disc stays still in combat and catches up after combat without light or follow toggles', async () => {
  const made = await withRandom(.6, () => executeGameCommand(discScene(), { type: 'spell', character_id: 'priest', spell_name: 'Floating Disc' }));
  const state = made.state_json, disc = state.characters.find(character => character.summon);
  state.combat = scene().combat; state.entities.push(scene().entities[1]);
  let result = await executeGameCommand(state, { type: 'move', character_id: 'priest', dx: 0, dy: 1 });
  assert.deepEqual([result.state_json.characters.find(character => character.id === disc.id).x,
    result.state_json.characters.find(character => character.id === disc.id).y], [2, 2]);
  result.state_json.combat.active = false; result.state_json.entities = [];
  Object.assign(result.state_json.characters[0], { x: 5, y: 5, lightSource: '', lightRadius: 0, gear: [] });
  result.state_json.player = { x: 5, y: 5, roomId: 'room', torchLit: false, lightRadius: 0 };
  for (let step = 0; step < 6; step++) result = await executeGameCommand(result.state_json, { type: 'tick', elapsed_ms: 1000 });
  const caught = result.state_json.characters.find(character => character.id === disc.id);
  assert.ok(Math.max(Math.abs(caught.x - 5), Math.abs(caught.y - 5)) <= 1);
  assert.ok(result.state_json.multiplayerMotions.some(motion => motion.characterId === disc.id));
});

test('Charm Person converts the final hostile humanoid, ends combat and keeps its rolled duration', async () => {
  const state=wizardScene();state.characters[0].spellsKnown='Charm Person';Object.assign(state.entities[1],{name:'Bandit',level:2,tags:['humanoid'],stealthState:{attempted:true,revealed:true}});
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Charm Person'}));
  result=await withRandom(.5,()=>executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest',target_id:'foe'}));
  assert.equal(result.state_json.combat.active,false);
  const companion=result.state_json.characters.find(c=>c.companion?.kind==='charmed');assert.ok(companion);
  assert.equal(companion.companion.controllerCharacterId,'priest');assert.equal(companion.companion.charm.days,5);
  assert.equal(result.state_json.entities.some(e=>e.id==='foe'),false);
});
test('party fire breaks a charmed companion back into a hostile monster',async()=>{
  const state=wizardScene();state.characters[0].spellsKnown='Charm Person, Burning Hands';
  Object.assign(state.entities[1],{name:'Bandit',level:2,tags:['humanoid'],x:3,y:2,stealthState:{attempted:true,revealed:true}});
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Charm Person'}));
  result=await withRandom(.6,()=>executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest',target_id:'foe'}));
  result=await withRandom(.6,()=>executeGameCommand(result.state_json,{type:'spell',character_id:'priest',spell_name:'Burning Hands'}));
  result=await withRandom(.5,()=>executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest'}));
  assert.equal(result.state_json.characters.some(c=>c.companion?.kind==='charmed'),false);
  const monster=result.state_json.entities.find(e=>e.id==='foe');assert.ok(monster);assert.equal(monster.hostile,true);assert.equal(monster.charm,undefined);
});
test('drinking a potion is free even after acting; duration and empty flask survive normalization', async () => {
  const state=wizardScene();state.combat.actionUsed=true;state.characters[0].gear=[magicPotion('giant-strength')];
  const result=await executeGameCommand(state,{type:'drink_potion',character_id:'priest',gear_index:0});
  assert.equal(result.state_json.characters[0].stats.STR,18);assert.equal(result.state_json.characters[0].gear[0].name,'Empty flask');
  assert.equal(result.state_json.characters[0].potionEffects[0].rounds,10);assert.equal(result.state_json.combat.actionUsed,true);
  assert.equal(result.state_json.combat.turnIndex,0);
  await assert.rejects(executeGameCommand(result.state_json,{type:'drink_potion',character_id:'priest',gear_index:0}),/potion/);
});
test('weapon enchantments work while hidden and are named in roll history only after identification', async () => {
  for(const identified of [false,true]) {
    const state=scene(),item=enchantedEquipment({name:'shortsword',costGp:7,damage:'1d6'},'weapon',2);item.equipped=true;
    if(identified)identifyMagicItem(item);
    Object.assign(state.characters[0],{className:'Fighter',stats:{STR:14,DEX:10},equipmentInitialized:true,
      gear:[item,{name:'Torch',lit:true,equipped:true}],spellsKnown:'',x:4,y:2});state.player.x=4;
    state.entities[1].ac=13;
    const normalized=await executeGameCommand(state,{type:'tick',elapsed_ms:0});
    const result=await withRandom(.4,()=>executeGameCommand(normalized.state_json,{type:'attack',character_id:'priest',monster_id:'foe',attack_index:0}));
    assert.equal(result.state_json.entities.find(e=>e.id==='foe').hp,95);
    const history=result.state_json.rollHistory.find(entry=>entry.label==='Attack'||entry.detail.includes('attacks the'));
    assert.match(history.detail,/13 Hits!/);
    const tooltip=history.segments.find(part=>part.tooltip).tooltip.map(part=>part.text).join('');
    if(identified)assert.match(tooltip,/\+2 magic/);else assert.doesNotMatch(tooltip,/\+2 magic|other/);
  }
});
test('magic ammunition stacks with weapon magic and spends a single projectile per attack', async () => {
  const state=scene(),bow=enchantedEquipment({name:'longbow',costGp:8,damage:'1d8'},'weapon',1),ammo=enchantedEquipment({name:'arrows',costGp:1,stackSize:20,ammoType:'arrows'},'ammunition',2);
  bow.equipped=true;Object.assign(state.characters[0],{className:'Fighter',stats:{DEX:14},gear:[bow,ammo],equipmentInitialized:true});
  state.entities[1].ac=13;
  Object.assign(state.characters[1], {hp:10,dyingRounds:0,gear:[{name:'Torch',lit:true,equipped:true}],lightSource:'torch',lightRadius:6});
  const normalized=await executeGameCommand(state,{type:'tick',elapsed_ms:0});
  const result=await withRandom(.4,()=>executeGameCommand(normalized.state_json,{type:'attack',character_id:'priest',monster_id:'foe',attack_index:0}));
  assert.equal(result.state_json.characters[0].gear.find(i=>i.magic?.kind==='ammunition').totalUnits,19);
  assert.equal(result.state_json.entities.find(e=>e.id==='foe').hp,93);
});
test('magic armor changes real AC even before identification',async()=>{
  const state=scene(),armor=enchantedEquipment({name:'leather armor',costGp:10,ac:11},'armor',3);
  armor.equipped=true;Object.assign(state.characters[0],{className:'Fighter',stats:{DEX:10},gear:[armor],armorEquipmentInitialized:true});
  const result=await executeGameCommand(state,{type:'normalize'});assert.equal(result.state_json.characters[0].armorClass,14);
});
test('friendly companions receive magic armor bonuses but impersonators cannot read scrolls',async()=>{
  const state=scene(),armor=enchantedEquipment({name:'leather armor',costGp:10,ac:11},'armor',2);armor.equipped=true;
  Object.assign(state.characters[0],{className:'Monster',gear:[armor],armorEquipmentInitialized:true,companion:{kind:'friendly',source:{ac:12}}});
  let result=await executeGameCommand(state,{type:'normalize'});assert.equal(result.state_json.characters[0].armorClass,14);
  Object.assign(state.characters[0],{className:'Wizard',gear:[magicScroll({name:'Magic Missile',tier:1,classes:['wizard']})],companion:{kind:'doppelganger',source:{ac:12}}});
  await assert.rejects(executeGameCommand(state,{type:'read_scroll',character_id:'priest',gear_index:0}),/cannot cast/);
});
test('scroll casts unknown class-list spells once, leaves blank paper, and failures do not lose known spells',async()=>{
  for(const value of [.2,.6]) {
    const state=wizardScene();state.characters[0].spellsKnown='Sleep';state.characters[0].gear=[magicScroll({name:'Magic Missile',tier:1,classes:['wizard']})];
    const result=await withRandom(value,()=>executeGameCommand(state,{type:'read_scroll',character_id:'priest',gear_index:0}));
    assert.equal(result.state_json.characters[0].gear[0].name,'Blank paper');
    assert.equal(result.state_json.characters[0].gear[0].value,1);assert.equal(result.state_json.characters[0].spellsKnown,'Sleep');
    assert.deepEqual(result.state_json.characters[0].failedSpellKeys,[]);assert.equal(result.state_json.combat.actionUsed,true);
    assert.equal(Boolean(result.state_json.characters[0].pendingSpell),value===.6);
  }
  const wrong=scene();wrong.characters[0].gear=[magicScroll({name:'Magic Missile',tier:1,classes:['wizard']})];
  await assert.rejects(executeGameCommand(wrong,{type:'read_scroll',character_id:'priest',gear_index:0}),/spell list/);
});

test('fresh imports choose starting spells while saved characters retain their existing choices', async()=>{
  for (const className of ['Wizard','Priest']) for (const fresh of [false,true]) {
    const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);
    const raw={name:'New caster',class:className,level:1,stats:{STR:10,CON:10,INT:14,WIS:14},maxHitPoints:6,gear:[],spellsKnown:'Light, Sleep'};
    let result=await executeGameCommand(state,{type:'import',character_json:raw,new_character_id:'new',fresh_import:fresh});
    let hero=result.state_json.characters.find(character=>character.id==='new');
    if(!fresh) { assert.equal(hero.spellsKnown,'Light, Sleep');assert.ok(!hero.advancements.length);continue; }
    assert.equal(hero.spellsKnown,className==='Priest'?'Turn Undead':'');
    const spells=className==='Priest'?['Cure Wounds','Holy Weapon']:['Sleep','Magic Missile'];
    for(const [index,name] of spells.entries()) result=await executeGameCommand(result.state_json,{type:'advance_choice',character_id:'new',event_id:'initial',task_id:`spell-${index+1}`,value:name});
    hero=result.state_json.characters.find(character=>character.id==='new');
    assert.ok(hero.advancements[0].completed);assert.ok(spells.every(name=>hero.spellsKnown.includes(name)));
  }
});

test('a sleeping target receives base and stacked talent backstab dice, with compact rich hover history',async()=>{
  for(const extra of [0,1,2]) {
    const state=scene(),hero=state.characters[0],foe=state.entities[1];
    Object.assign(hero,{name:'Shrigark',className:'Thief',stats:{STR:9,DEX:17,CON:12},equipmentInitialized:true,
      gear:[{name:'Dagger',type:'weapon',equipped:true},{name:'Torch',lit:true,equipped:true}],
      bonuses:extra?[{name:'BackstabIncrease',bonusAmount:extra}]:[]});
    Object.assign(foe,{name:'Stingbat',x:3,y:2,conditions:{sleeping:{source:'sleep'},prone:true}});
    const old=Math.random;let values=[.67,.87,.26,0];Math.random=()=>values.shift()??0;
    let result;try{result=await executeGameCommand(state,{type:'attack',character_id:'priest',monster_id:'foe',attack_index:0});}finally{Math.random=old;}
    const entry=result.state_json.rollHistory.find(item=>item.detail.startsWith('Shrigark backstabs'));
    assert.ok(entry,JSON.stringify(result.state_json.rollHistory));
    assert.equal(entry.detail,`Shrigark backstabs the stingbat with a dagger.\n21 Hits! Damage: ${3+extra}`);
    const tips=entry.segments.filter(part=>part.tooltip).map(part=>part.tooltip.map(item=>item.text).join(''));
    assert.match(tips[0],/Advantage from sleep; 2d20 = \(14\)\(18\) \+3 DEX/);
    assert.equal((tips[1].match(/1d4/g)||[]).length,2+extra);assert.match(tips[1],/backstab = /);
    assert.ok(!result.state_json.entities.find(entity=>entity.id==='foe').conditions.sleeping);
  }
});

test('wands retain charges on normal success/failure, never lose a known spell, and break on natural one',async()=>{
  const wand=()=>({name:'Wand of Magic Missile',type:'wand',slots:1,magic:{kind:'wand',spellName:'Magic Missile',tier:1,classes:['wizard'],identified:true}});
  for(const value of [.2,.6,0]) {
    const state=wizardScene();state.characters[0].spellsKnown='Sleep';state.characters[0].gear=[wand()];
    const result=await withRandom(value,()=>executeGameCommand(state,{type:'read_wand',character_id:'priest',gear_index:0}));
    const hero=result.state_json.characters[0];
    assert.equal(hero.spellsKnown,'Sleep');assert.ok(!hero.failedSpellKeys.includes('magic missile'));
    assert.equal(hero.gear.some(item=>item.magic?.kind==='wand'),value!==0);
    assert.equal(Boolean(hero.pendingSpell),value===.6);assert.equal(result.state_json.combat.actionUsed,true);
    if(value===.2) {
      assert.equal(hero.gear[0].magic.disabledUntilRest,true);
      result.state_json.combat.active=false;
      await assert.rejects(()=>executeGameCommand(result.state_json,{type:'read_wand',character_id:'priest',gear_index:0}),/successful rest/);
    }
    if(value===0) assert.match(result.message,/wand is destroyed/);
  }
  const wrong=scene();wrong.characters[0].gear=[wand()];
  await assert.rejects(()=>executeGameCommand(wrong,{type:'read_wand',character_id:'priest',gear_index:0}),/spell list/);
  const wrongTurn=wizardScene();wrongTurn.characters[0].gear=[wand()];wrongTurn.combat.turnIndex=1;
  await assert.rejects(()=>executeGameCommand(wrongTurn,{type:'read_wand',character_id:'priest',gear_index:0}),/turn/);
});

async function withRolls(values,fn){const previous=Math.random;let index=0;Math.random=()=>values[index++]??.5;try{return await fn();}finally{Math.random=previous;}}
function higherScene(){const state=wizardScene();state.combat.active=false;state.entities=state.entities.slice(0,1);state.characters=state.characters.slice(0,1);
  Object.assign(state.characters[0],{hp:100,maxHitPoints:100,spellsKnown:'Magic Missile, Fireball, Antimagic Shell',stats:{STR:12,DEX:12,CON:12,INT:14,WIS:12,CHA:10}});return state;}

test('authoritative higher-tier failure selects Shred, retains its fixed center, and grows on the crawl clock, not polls',async()=>{
  const state=higherScene();
  let result=await withRolls([0,.99],()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Antimagic Shell'}));
  const shred=result.state_json.entities.find(entity=>entity.subtype==='arcane-shred');assert.equal(shred.radius,.27);
  assert.equal(result.state_json.characters[0].lastWizardMishaps[0].tier,5);assert.match(result.message,/Shred/);
  result=await executeGameCommand(result.state_json,{type:'normalize'});assert.equal(result.state_json.entities.find(entity=>entity.id===shred.id).radius,.27);
  result=await executeGameCommand(result.state_json,{type:'tick',elapsed_ms:10000});assert.equal(result.state_json.entities.find(entity=>entity.id===shred.id).radius,1.27);
  assert.deepEqual([shred.x,shred.y],[2,2]);assert.equal(result.state_json.characters[0].hp,100);
});

test('a disabled wand recovers only for a character benefiting from a successful completed rest',async()=>{
  for(const failed of [false,true]) {
    const state=higherScene();state.characters[0].gear=[{name:'Wand of Magic Missile',magic:{kind:'wand',spellName:'Magic Missile',tier:1,classes:['wizard'],identified:true,disabledUntilRest:true}},
      {name:'Rations',quantity:1},{name:'Torch',quantity:3}];
    let result=await executeGameCommand(state,{type:'rest',character_id:'priest'});
    result.state_json.characters[0].restFailed=failed;result.state_json.rest.nextHourAt=Date.now()-10000;
    result=await executeGameCommand(result.state_json,{type:'tick',elapsed_ms:10000});
    assert.equal(result.state_json.rest.phase,'completed');assert.equal(Boolean(result.state_json.characters[0].gear[0].magic.disabledUntilRest),failed);
  }
});

test('Gate closes only for its caster using one INT action, or summons a level-eight-plus foe once',async()=>{
  const state=higherScene();state.entities.push({id:'gate',type:'feature',subtype:'arcane-gate',casterId:'priest',x:2,y:2,rounds:2});
  let closed=await withRandom(.99,()=>executeGameCommand(state,{type:'mishap_action',character_id:'priest',action:'close-gate',entity_id:'gate'}));
  assert.equal(closed.state_json.entities.find(entity=>entity.id==='gate').closed,true);
  await assert.rejects(()=>executeGameCommand(closed.state_json,{type:'mishap_action',character_id:'priest',action:'close-gate',entity_id:'gate'}),/no longer available/);
  let result=await withRandom(.5,()=>executeGameCommand(state,{type:'tick',elapsed_ms:15000}));
  assert.equal(result.state_json.entities.filter(entity=>entity.id.startsWith('arcane-monster-')).length,0);
  result=await withRandom(.5,()=>executeGameCommand(result.state_json,{type:'tick',elapsed_ms:5000}));
  const monsters=result.state_json.entities.filter(entity=>entity.id.startsWith('arcane-monster-'));
  assert.equal(monsters.length,1);assert.ok(monsters[0].level>=8);assert.ok(result.state_json.combat.active);
  assert.equal(result.state_json.entities.find(entity=>entity.id==='gate').closed,true);
});

test('raving forbids movement and actions but permits ending its turn; petrified legs reduce actual movement',async()=>{
  const state=wizardScene();state.characters[0].wizardEffects=[{type:'raving',rounds:3}];
  await assert.rejects(()=>executeGameCommand(state,{type:'move',character_id:'priest',dx:1,dy:0}),/cannot act/);
  await assert.rejects(()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Light'}),/cannot act/);
  await executeGameCommand(state,{type:'end_turn',character_id:'priest'});
  const legs=wizardScene();legs.characters[0].wizardEffects=[{type:'petrified-limbs',limbs:['left leg'],remainingMs:86400000}];
  const normalized=await executeGameCommand(legs,{type:'normalize'});assert.equal(normalized.state_json.combat.movementBudget,3);assert.equal(normalized.state_json.combat.movementRemaining,3);
});

test('Ord sacrifice validates choices, removes a magic item or fallback spell, and cannot be repeated',async()=>{
  const state=higherScene();state.characters[0].wizardEffects=[{type:'ord-balance',pending:true}];state.characters[0].spellsKnown='Light, Sleep';
  let result=await executeGameCommand(state,{type:'mishap_action',character_id:'priest',action:'sacrifice',kind:'spell',name:'Sleep'});
  assert.equal(result.state_json.characters[0].spellsKnown,'Light');
  await assert.rejects(()=>executeGameCommand(result.state_json,{type:'mishap_action',character_id:'priest',action:'sacrifice',kind:'spell',name:'Light'}),/available magic item or spell/);
  state.characters[0].gear=[enchantedEquipment({name:'dagger',costGp:1},'weapon',1)];
  await assert.rejects(()=>executeGameCommand(state,{type:'mishap_action',character_id:'priest',action:'sacrifice',kind:'spell',name:'Light'}),/available magic item or spell/);
  result=await executeGameCommand(state,{type:'mishap_action',character_id:'priest',action:'sacrifice',kind:'item',name:'Magic Dagger',gear_index:0});
  assert.equal(result.state_json.characters[0].gear.length,0);assert.equal(result.state_json.characters[0].spellsKnown,'Light, Sleep');
});

test('sinkhole failure offers Feather Fall before damage and climbing uses an action without restoring spent movement',async()=>{
  const state=higherScene();state.characters[0].spellsKnown='Fireball, Feather Fall';
  state.map={width:19,height:19};state.tiles=Array.from({length:361},(_,i)=>({x:i%19,y:Math.floor(i/19),type:'floor',roomId:'room'}));
  Object.assign(state.characters[0],{x:9,y:9});Object.assign(state.player,{x:9,y:9});Object.assign(state.rooms[0],{width:19,height:19});
  let result=await withRolls([0,.55,0],()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Fireball'}));
  const hero=result.state_json.characters[0];assert.ok(hero.pendingFall);assert.equal(hero.hp,100);assert.ok(hero.conditions.sinkhole);
  result=await withRandom(.99,()=>executeGameCommand(result.state_json,{type:'fall_response',character_id:'priest',attempt:true}));
  assert.equal(result.state_json.characters[0].hp,100);assert.equal(result.state_json.characters[0].pendingFall,null);
  result=await withRandom(.99,()=>executeGameCommand(result.state_json,{type:'mishap_action',character_id:'priest',action:'climb'}));
  assert.ok(!result.state_json.characters[0].conditions.sinkhole);assert.ok(!result.state_json.characters[0].conditions.prone);
});

test('monsters that climb out of a sinkhole relocate to a free adjacent rim square',async()=>{
  const state=scene();state.characters=state.characters.slice(0,1);
  state.combat.turnOrder=state.combat.turnOrder.filter(entry=>entry.id!=='friend');state.combat.playerOrderIds=['priest'];
  state.entities.push({id:'pit',type:'feature',subtype:'arcane-sinkhole',x:5,y:2,radius:0,cells:[{x:5,y:2}]});
  state.entities.find(entity=>entity.id==='foe').conditions={sinkhole:'pit',prone:true};
  const result=await withRandom(.99,()=>executeGameCommand(state,{type:'end_turn',character_id:'priest'}));
  const monster=result.state_json.entities.find(entity=>entity.id==='foe');
  assert.ok(!monster.conditions.sinkhole);assert.ok(!monster.conditions.prone);
  assert.equal(Math.max(Math.abs(monster.x-5),Math.abs(monster.y-2)),1);
});

test('hidden pit traps apply automatic falling damage, reveal art metadata, and save/load blocks repeat entry',async()=>{
  const state=higherScene();state.entities.push({id:'pit',type:'trap',targetType:'tile',x:3,y:2,name:'Spiked pit',trigger:'Step',effect:'Old manual text'});
  const failed=await withRandom(0,()=>executeGameCommand(state,{type:'move',character_id:'priest',dx:1,dy:0}));
  const hero=failed.state_json.characters[0],pit=failed.state_json.entities.find(entity=>entity.id==='pit');
  assert.equal(hero.hp,97);assert.equal(hero.conditions.sinkhole,'pit');assert.equal(hero.conditions.prone,true);
  assert.equal(pit.triggered,true);assert.deepEqual(pit.cells,[{x:3,y:2}]);
  const escaped=await withRandom(.99,()=>executeGameCommand(failed.state_json,{type:'mishap_action',character_id:'priest',action:'climb'}));
  const climber=escaped.state_json.characters[0];assert.ok(!climber.conditions.sinkhole);
  const blocked=await executeGameCommand(escaped.state_json,{type:'move',character_id:'priest',dx:3-climber.x,dy:2-climber.y});
  assert.deepEqual([blocked.state_json.characters[0].x,blocked.state_json.characters[0].y],[climber.x,climber.y]);
});

test('successful saves from a larger pit move every character to distinct safe adjacent tiles without damage',async()=>{
  const state=higherScene();state.characters.push({id:'friend',name:'Friend',className:'Thief',hp:30,maxHitPoints:30,x:4,y:2,roomId:'room',stats:{DEX:12},gear:[]});
  state.entities.push({id:'pit',type:'trap',targetType:'tile',x:3,y:2,width:2,height:2,name:'Pit',trigger:'Step',effect:'Fall'});
  const result=await withRandom(.99,()=>executeGameCommand(state,{type:'move',character_id:'priest',dx:1,dy:0}));
  const characters=result.state_json.characters;assert.equal(characters[0].hp,100);assert.equal(characters[1].hp,30);
  const pit=result.state_json.entities.find(entity=>entity.id==='pit');assert.equal(pit.cells.length,4);
  assert.equal(new Set(characters.map(hero=>`${hero.x},${hero.y}`)).size,2);
  assert.ok(characters.every(hero=>!pit.cells.some(cell=>cell.x===hero.x&&cell.y===hero.y)));
});

function pitCombatScene(){const state=scene();state.characters=state.characters.slice(0,1);
  Object.assign(state.characters[0],{className:'Fighter',hp:60,maxHitPoints:60,stats:{STR:18,DEX:12,CON:12},gear:[{name:'Rope',quantity:1},{name:'Torch',lit:true,equipped:true}]});
  state.combat.turnOrder=state.combat.turnOrder.filter(entry=>entry.id!=='friend');state.combat.playerOrderIds=['priest'];
  state.entities.push({id:'pit',type:'feature',subtype:'pit',x:4,y:2,cells:[{x:4,y:2}],visible:true,revealed:true});
  Object.assign(state.entities.find(entity=>entity.id==='foe'),{x:3,y:2});return state;}

test('rope rescue is automatic, spends only the helper action, and can rescue another character',async()=>{
  const state=pitCombatScene();state.entities.find(entity=>entity.id==='foe').x=6;
  Object.assign(state.characters[0],{x:3,y:2});Object.assign(state.player,{x:3,y:2});
  state.characters.push({id:'fallen',name:'Fallen',className:'Wizard',hp:20,maxHitPoints:20,x:4,y:2,roomId:'room',gear:[],conditions:{sinkhole:'pit',prone:true}});
  const result=await withRandom(0,()=>executeGameCommand(state,{type:'pit_action',character_id:'priest',action:'rescue',target_id:'fallen'}));
  const target=result.state_json.characters.find(hero=>hero.id==='fallen');assert.equal(target.hp,20);assert.ok(!target.conditions.sinkhole);assert.ok(!target.conditions.prone);
  assert.notDeepEqual([target.x,target.y],[3,2]);assert.notDeepEqual([target.x,target.y],[4,2]);assert.equal(result.state_json.combat.actionUsed,true);
  await assert.rejects(()=>executeGameCommand(state,{type:'pit_action',character_id:'priest',action:'rescue',target_id:'priest'}),/no longer available/);
  for(const alteration of ['rope','asleep','dying','distance']) {
    const invalid=structuredClone(state);
    if(alteration==='rope')invalid.characters[0].gear=[];
    if(alteration==='asleep')invalid.characters[1].conditions.sleeping=true;
    if(alteration==='dying')Object.assign(invalid.characters[1],{hp:0,dyingRounds:3});
    if(alteration==='distance')Object.assign(invalid.characters[0],{x:0,y:0});
    await assert.rejects(()=>executeGameCommand(invalid,{type:'pit_action',character_id:'priest',action:'rescue',target_id:'fallen'}),/no longer available/);
  }
});

test('fighter pushes roll STR against AC, use an action, and monsters take 3d6 with no second save',async()=>{
  const state=pitCombatScene();
  const result=await withRandom(.6,()=>executeGameCommand(state,{type:'pit_action',character_id:'priest',action:'push',target_id:'foe',pit_id:'pit'}));
  const monster=result.state_json.entities.find(entity=>entity.id==='foe');
  assert.equal(result.state_json.combat.actionUsed,true);assert.equal(monster.hp,88);assert.equal(monster.conditions.sinkhole,'pit');assert.equal(monster.conditions.prone,true);
  const after=await withRandom(.99,()=>executeGameCommand(result.state_json,{type:'end_turn',character_id:'priest'}));
  assert.ok(!after.state_json.entities.find(entity=>entity.id==='foe').conditions.sinkhole);
  assert.equal(after.state_json.entities.find(entity=>entity.id==='foe').hp,88);
  const failed=await withRandom(0,()=>executeGameCommand(state,{type:'pit_action',character_id:'priest',action:'push',target_id:'foe',pit_id:'pit'}));
  assert.equal(failed.state_json.entities.find(entity=>entity.id==='foe').hp,100);assert.equal(failed.state_json.combat.actionUsed,true);
});

test('Orc falling damage survives combat initialization, normalization and later turns, and lethal falls defeat it', async () => {
  for (const hp of [30, 5]) {
    const state = pitCombatScene(), orc = state.entities.find(entity => entity.id === 'foe');
    state.combat.active = false;
    Object.assign(orc, { name: 'Orc', hp, maxHp: hp, hostile: false, attitude: 'neutral' });
    let result = await withRandom(.99, () => executeGameCommand(state, { type: 'pit_action', character_id: 'priest', action: 'push', target_id: 'foe', pit_id: 'pit' }));
    let monster = result.state_json.entities.find(entity => entity.id === 'foe');
    assert.equal(monster.hp, Math.max(0, hp - 18));
    assert.deepEqual(monster.lastPitFall.rolls, [6, 6, 6]);
    assert.equal(monster.lastPitFall.damage, 18);
    if (hp === 5) assert.equal(monster.defeated, true);
    result = await executeGameCommand(result.state_json, { type: 'normalize' });
    assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, Math.max(0, hp - 18));
  }
});

test('an expired disc drops its cargo and lantern on the lower route, not the upper crossing', async () => {
  const state = scene(); state.combat.active = false; state.entities = state.entities.slice(0, 1);
  state.underpasses = [{ id: 'lower', axis: 'horizontal', lowerCells: [1, 2, 3, 4, 5].map(x => ({ x, y: 3 })),
    upperCrossings: [{ x: 3, y: 3 }], portals: [{ upper: { x: 0, y: 3 }, lower: { x: 1, y: 3 } },
      { upper: { x: 6, y: 3 }, lower: { x: 5, y: 3 } }], art: [] }];
  state.characters.push({ id: 'disc', name: 'Floating Disc', x: 3, y: 3, routeId: 'lower', hp: 0,
    summon: { kind: 'floating-disc', casterId: 'priest', remainingMs: 0 },
    gear: [{ name: 'Lantern', lit: true, equipped: true }, { name: 'Rope' }], gold: 2 });
  const result = await executeGameCommand(state, { type: 'normalize' });
  const cargo = result.state_json.entities.filter(entity => entity.id.startsWith('disc-'));
  assert.equal(cargo.length, 3);
  assert.ok(cargo.every(entity => entity.routeId === 'lower'));
  assert.equal(cargo.find(entity => entity.gearItem?.name === 'Lantern').lightRadius, 12);
});

test('any character automatically pushes sleeping/paralyzed foes, but flying and incorporeal foes are immune',async()=>{
  for(const condition of ['sleeping','paralyzed']) {
    const state=pitCombatScene();state.characters[0].className='Wizard';state.entities.find(entity=>entity.id==='foe').conditions={[condition]:true};
    const result=await withRandom(0,()=>executeGameCommand(state,{type:'pit_action',character_id:'priest',action:'push',target_id:'foe',pit_id:'pit'}));
    assert.equal(result.state_json.entities.find(entity=>entity.id==='foe').hp,97);assert.equal(result.state_json.combat.actionUsed,true);
  }
  for(const condition of ['fly','incorporeal','not-fighter','wrong-turn','action-used']) {
    const state=pitCombatScene(),monster=state.entities.find(entity=>entity.id==='foe');
    if(condition==='fly')monster.movement='fly near';if(condition==='incorporeal')monster.conditions={incorporeal:true};
    if(condition==='not-fighter')state.characters[0].className='Wizard';if(condition==='wrong-turn')state.combat.turnIndex=1;if(condition==='action-used')state.combat.actionUsed=true;
    await assert.rejects(()=>executeGameCommand(state,{type:'pit_action',character_id:'priest',action:'push',target_id:'foe',pit_id:'pit'}),/no longer available|cannot act|unavailable/);
  }
});

test('Shred hides ranged targets but does not stop monster attacks or tile traps',async()=>{
  const state=wizardScene();state.entities.push({id:'shred',type:'feature',subtype:'arcane-shred',x:3,y:2,radius:12});
  state.characters=state.characters.slice(0,1);state.combat.turnOrder=state.combat.turnOrder.filter(entry=>entry.id!=='friend');
  const cast=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Magic Missile'}));
  await assert.rejects(()=>executeGameCommand(cast.state_json,{type:'resolve_spell',character_id:'priest',target_id:'foe'}),/visible|sight/);
  const attacked=await withRandom(.6,()=>executeGameCommand(state,{type:'end_turn',character_id:'priest'}));
  assert.ok(attacked.state_json.characters[0].hp<10);
  const trapState=higherScene();trapState.entities.push({id:'shred',type:'feature',subtype:'arcane-shred',x:2,y:2,radius:12},
    {id:'trap',type:'trap',targetType:'tile',x:3,y:2,name:'Test trap',effect:'Manual damage',trigger:'Step'});
  const moved=await executeGameCommand(trapState,{type:'move',character_id:'priest',dx:1,dy:0});
  assert.equal(moved.state_json.entities.find(entity=>entity.id==='trap').triggered,true);
});

test('elemental weapon damage rolls once even with backstab and unidentified bonuses stay out of hit hover text',async()=>{
  const state=scene(),hero=state.characters[0],foe=state.entities[1];
  const dagger=enchantedEquipment({name:'dagger',costGp:1},'weapon',2);dagger.equipped=true;
  Object.assign(dagger.magic,{element:'lightning',elementDice:'1d4'});
  Object.assign(hero,{className:'Thief',stats:{STR:10,DEX:10},equipmentInitialized:true,gear:[dagger,{name:'Torch',lit:true,equipped:true}]});
  Object.assign(foe,{x:3,y:2,conditions:{sleeping:true}});
  const result=await withRandom(.6,()=>executeGameCommand(state,{type:'attack',character_id:'priest',monster_id:'foe',attack_index:0}));
  assert.equal(result.state_json.entities.find(entity=>entity.id==='foe').hp,89);
  const log=result.state_json.rollHistory.find(entry=>entry.detail.includes('backstabs'));
  const hit=log.segments.find(part=>part.tooltip).tooltip.map(part=>part.text).join('');assert.ok(!hit.includes('magic'));
  const damage=log.segments.filter(part=>part.tooltip)[1].tooltip.map(part=>part.text).join('');
  assert.equal((damage.match(/1d4/g)||[]).length,3);assert.equal((damage.match(/lightning/g)||[]).length,1);
});

test('crafted items without agreed prices cannot be sold or removed',async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);
  state.characters[0].gear=[{name:'Wand of Sleep',type:'wand',magic:{kind:'wand',identified:true,pricePending:true}}];
  await assert.rejects(()=>executeGameCommand(state,{type:'sell_treasure',character_id:'priest',items:[{index:0,name:'Wand of Sleep'}],coins:{}}),/Gold value is defined/);
});
test('a queued scroll is studied on the next completed rest and learned spells are tracked separately',async()=>{
  const state=wizardScene(),scroll=magicScroll({name:'Burning Hands',tier:1,classes:['wizard']});identifyMagicItem(scroll);
  state.combat.active=false;state.entities=state.entities.slice(0,1);state.characters[1].hp=1;state.characters[1].dyingRounds=0;
  state.characters[0].gear=[scroll,{name:'Rations',quantity:2},{name:'Torch',quantity:3}];
  let result=await executeGameCommand(state,{type:'learn_scroll',character_id:'priest',gear_index:0});
  assert.equal(result.message,'Will attempt on next rest.');
  result=await executeGameCommand(result.state_json,{type:'rest',character_id:'priest'});result.state_json.rest.nextHourAt=Date.now()-16000;
  result=await withRandom(.6,()=>executeGameCommand(result.state_json,{type:'tick',elapsed_ms:2000}));
  assert.equal(result.state_json.rest.phase,'completed');assert.equal(result.state_json.rest.studyResults[0].message,'Priest learned Burning Hands');
  assert.ok(result.state_json.characters[0].spellsKnown.includes('Burning Hands'));assert.deepEqual(result.state_json.characters[0].learnedScrollSpells,['Burning Hands']);
  assert.equal(result.state_json.characters[0].gear[0].name,'Blank paper');
});
test('identification requires two checks, consumes one action and supports normal spell loss',async()=>{
  for(const value of [.2,.6]) {
    const state=wizardScene();state.characters[0].spellsKnown='Detect Magic';state.characters[0].gear=[enchantedEquipment({name:'dagger',costGp:1},'weapon',1)];
    const result=await withRandom(value,()=>executeGameCommand(state,{type:'identify',character_id:'priest',gear_index:0}));
    assert.equal(result.state_json.characters[0].gear[0].magic.identified,value===.6);assert.equal(result.state_json.combat.actionUsed,true);
    if(value===.2)assert.ok(result.state_json.characters[0].failedSpellKeys.includes('detect magic'));
  }
});
test('Feather Fall can respond outside its caster turn without spending or changing the active turn action',async()=>{
  const state=wizardScene();state.characters[0].spellsKnown='Feather Fall';state.characters[0].pendingFall={sourceId:'pit',damage:20,manual:false};
  state.combat.turnIndex=1;state.characters[1].hp=10;state.characters[1].dyingRounds=0;
  const result=await withRandom(.99,()=>executeGameCommand(state,{type:'fall_response',character_id:'priest',attempt:true}));
  assert.equal(result.state_json.characters[0].hp,10);assert.equal(result.state_json.characters[0].pendingFall,null);
  assert.equal(result.state_json.combat.turnIndex,1);assert.equal(result.state_json.combat.actionUsed,false);
});
test('unidentified magic sells for 100 Gold; identified magic uses its exact treasure value',async()=>{
  for(const identified of [false,true]) {
    const state=scene(),item=enchantedEquipment({name:'greataxe',costGp:10},'weapon',1);if(identified)identifyMagicItem(item);
    state.combat.active=false;state.entities=state.entities.slice(0,1);state.characters[0].gear=[item];
    const result=await executeGameCommand(state,{type:'sell_treasure',character_id:'priest',items:[{index:0,name:item.name}],coins:{}});
    assert.equal(result.state_json.partyAssets.gold,identified?210:100);assert.equal(result.state_json.characters[0].gear.length,0);
    await assert.rejects(executeGameCommand(result.state_json,{type:'sell_treasure',character_id:'priest',items:[{index:0,name:item.name}],coins:{}}),/gear list changed/);
  }
});

test('authoritative casting heals another character and consumes exactly one action', async () => {
  const result = await withRandom(.6, () => executeGameCommand(scene(), { type: 'spell', character_id: 'priest', spell_name: 'Cure Wounds', target_id: 'friend' }));
  assert.equal(result.state_json.characters[1].hp, 4);
  assert.equal(result.state_json.characters[1].dyingRounds, 0);
  assert.equal(result.state_json.combat.actionUsed, true);
  assert.match(result.state_json.rollHistory[0].detail, /4 HP restored/);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'spell', character_id: 'priest', spell_name: 'Cure Wounds', target_id: 'friend' }), /already acted/);
});

test('invalid target, unknown spell and wrong turn cannot heal', async () => {
  let state = scene();
  state.characters[1].x = 5;
  await assert.rejects(executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Cure Wounds', target_id: 'friend' }), /touch range/);
  assert.equal(state.combat.actionUsed, false);
  state = scene(); state.characters[0].spellsKnown = 'Light';
  await assert.rejects(executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Cure Wounds', target_id: 'friend' }), /not available/);
  state = scene(); state.combat.turnIndex = 1;
  await assert.rejects(executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Cure Wounds', target_id: 'friend' }), /turn/);
});

test('critical choice is a separate persisted command, not a second action or reroll', async () => {
  const cast = await withRandom(.99, () => executeGameCommand(scene(), { type: 'spell', character_id: 'priest', spell_name: 'Cure Wounds', target_id: 'friend' }));
  assert.equal(cast.state_json.characters[1].hp, 0);
  assert.equal(cast.state_json.characters[0].pendingSpell.spell, 'cure wounds');
  assert.equal(cast.state_json.combat.actionUsed, true);
  await assert.rejects(executeGameCommand(cast.state_json, { type: 'end_turn', character_id: 'priest' }), /critical healing/);
  const result = await withRandom(.99, () => executeGameCommand(cast.state_json, { type: 'resolve_spell', character_id: 'priest', choice: 'double-dice' }));
  assert.equal(result.state_json.characters[1].hp, 12);
  assert.equal(result.state_json.characters[0].pendingSpell, null);
  assert.equal(result.state_json.combat.actionUsed, true);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', choice: 'double-total' }), /no critical/);
});

test('natural one persists the loss and unpaid penance without healing', async () => {
  const result = await withRandom(0, () => executeGameCommand(scene(), { type: 'spell', character_id: 'priest', spell_name: 'Cure Wounds', target_id: 'friend' }));
  assert.equal(result.state_json.characters[1].hp, 0);
  assert.deepEqual(result.state_json.characters[0].failedSpellKeys, ['cure wounds']);
  assert.deepEqual(result.state_json.characters[0].spellPenance, { 'cure wounds': { paid: false } });
});

test('penance uses personal coins first, then party assets, and does not recover until rest', async () => {
  const state=scene(); state.combat.active=false; state.entities=state.entities.slice(0,1);
  Object.assign(state.characters[0], { gold:2, failedSpellKeys:['cure wounds'], spellPenance:{'cure wounds':{paid:false}} });
  state.partyAssets={gold:4};
  const result=await executeGameCommand(state,{type:'penance',character_id:'priest'});
  assert.equal(result.state_json.characters[0].gold,0);
  assert.equal(result.state_json.partyAssets.gold,1);
  assert.deepEqual(result.state_json.characters[0].failedSpellKeys,['cure wounds']);
  assert.equal(result.state_json.characters[0].spellPenance['cure wounds'].paid,true);
  await assert.rejects(executeGameCommand(result.state_json,{type:'penance',character_id:'priest'}),/No unpaid/);
  state.partyAssets.gold=0;
  await assert.rejects(executeGameCommand(state,{type:'penance',character_id:'priest'}),/requires 5 Gold/);
});

test('authoritative rest completes with maximum HP and recovers paid penance', async () => {
  const state=scene(); state.combat.active=false; state.entities=state.entities.slice(0,1);
  for (const character of state.characters) Object.assign(character,{hp:2,dyingRounds:0,gear:[{name:'Rations',quantity:1},{name:'Torch',quantity:3}]});
  Object.assign(state.characters[0],{failedSpellKeys:['cure wounds'],spellPenance:{'cure wounds':{paid:true}}});
  const start=await executeGameCommand(state,{type:'rest',character_id:'priest'});
  assert.equal(start.state_json.rest.phase,'sleeping');
  start.state_json.rest.nextHourAt=Date.now()-16000;
  const result=await executeGameCommand(start.state_json,{type:'tick',elapsed_ms:2000});
  assert.equal(result.state_json.rest.phase,'completed');
  assert.equal(result.state_json.characters[0].hp,10);
  assert.equal(result.state_json.characters[1].hp,20);
  assert.deepEqual(result.state_json.characters[0].failedSpellKeys,[]);
});

test('rest ambush grants turns only to watchers, goblins and monsters in the surprise round', async () => {
  const state=scene();state.combat={active:false};state.generation.entranceRoomId='elsewhere';
  state.entities=state.entities.filter(entity=>entity.type!=='stairs');
  state.map={width:9,height:9};state.rooms[0].width=9;state.rooms[0].height=9;
  state.tiles=Array.from({length:81},(_,index)=>({x:index%9,y:Math.floor(index/9),type:'floor',roomId:'room'}));
  state.characters[1].hp=5;delete state.characters[1].dyingRounds;
  state.characters.push({...structuredClone(state.characters[1]),id:'goblin',name:'Goblin',ancestry:'Goblin',x:3,y:2});
  for(const character of state.characters)character.gear=[{name:'Torch',quantity:3},{name:'Rations',quantity:1}];
  state.wanderingMonsters={numerator:1,denominator:1};
  const start=await executeGameCommand(state,{type:'rest',character_id:'priest',watch_order_ids:['priest','friend','goblin']});
  assert.equal(start.state_json.rest.safe,false);
  start.state_json.rest.nextHourAt=Date.now()-1000;
  const result=await withRandom(.4,()=>executeGameCommand(start.state_json,{type:'tick',elapsed_ms:1000}));
  assert.equal(result.state_json.rest.phase,'interrupted');
  assert.deepEqual(result.state_json.rest.interruptedWatchIds,['priest']);
  assert.deepEqual(result.state_json.rest.interruptionChecks.map(check=>check.characterId).sort(),['friend','goblin']);
  assert.equal(result.state_json.combat.surpriseRound,true);
  assert.ok(result.state_json.combat.surpriseParticipantIds.includes('priest'));
  assert.ok(result.state_json.combat.surpriseParticipantIds.includes('goblin'));
  assert.ok(!result.state_json.combat.surpriseParticipantIds.includes('friend'));
  assert.ok(result.state_json.combat.monsterIds.every(id=>result.state_json.combat.surpriseParticipantIds.includes(id)));
});

test('starting-room rations can be replenished as a three-day bundle for five silver', async () => {
  const state=scene(); state.combat.active=false; state.entities=state.entities.slice(0,1);
  state.characters[0].silver=5;
  const result=await executeGameCommand(state,{type:'buy_gear',character_id:'priest',item_id:'rations'});
  assert.equal(result.state_json.characters[0].silver,0);
  assert.equal(result.state_json.characters[0].gear.find(item=>item.name==='Rations').quantity,3);
});

function wizardScene() {
  const state = scene();
  Object.assign(state.characters[0], { className: 'Wizard', spellsKnown: 'Magic Missile, Light, Sleep', stats: { INT: 14, CON: 14 }, hp: 10 });
  return state;
}

test('authoritative Magic Missile casts before targeting, resolves damage once and keeps the action spent', async () => {
  const cast = await withRandom(.6, () => executeGameCommand(wizardScene(), { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
  assert.equal(cast.state_json.entities.find(entity => entity.id === 'foe').hp, 100);
  assert.equal(cast.state_json.characters[0].pendingSpell.phase, 'targeting');
  assert.equal(cast.state_json.combat.actionUsed, true);
  const moved = await executeGameCommand(cast.state_json, { type: 'move', character_id: 'priest', dx: 1, dy: 0 });
  assert.equal(moved.state_json.characters[0].x, 3);
  assert.equal(moved.state_json.combat.movementRemaining, 5);
  assert.equal(moved.state_json.characters[0].pendingSpell.remaining, 1);
  const fired = await withRandom(.99, () => executeGameCommand(cast.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }));
  assert.equal(fired.state_json.entities.find(entity => entity.id === 'foe').hp, 96);
  assert.equal(fired.state_json.characters[0].pendingSpell, null);
  assert.equal(fired.state_json.combat.actionUsed, true);
  await assert.rejects(executeGameCommand(fired.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }));
});

test('authoritative critical options resolve separately; killing one target leaves the other missile available', async () => {
  for (const choice of ['two-missiles', 'one-d8']) {
    const state = wizardScene();
    state.entities[1].hp = 4;
    state.entities.push({ ...state.entities[1], id: 'second', x: 5, y: 3, hp: 20 });
    state.combat.monsterIds.push('second');
    state.combat.turnOrder.push({ type: 'monster', id: 'second' });
    let result = await withRandom(.99, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
    assert.equal(result.state_json.characters[0].pendingSpell.phase, 'critical');
    result = await executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', choice });
    result = await withRandom(.99, () => executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }));
    assert.ok(!result.state_json.entities.some(entity => entity.id === 'foe' && !entity.defeated));
    if (choice === 'two-missiles') {
      assert.equal(result.state_json.characters[0].pendingSpell.remaining, 1);
      result = await withRandom(.99, () => executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'second' }));
      assert.equal(result.state_json.entities.find(entity => entity.id === 'second').hp, 16);
    } else assert.equal(result.state_json.characters[0].lastMagicMissile.diceSides, 8);
    assert.equal(result.state_json.characters[0].pendingSpell, null);
  }
});

test('authoritative missile targets require visibility and unobstructed caster line of sight', async () => {
  let result = await withRandom(.6, () => executeGameCommand(wizardScene(), { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
  result.state_json.entities.find(entity => entity.id === 'foe').visible = false;
  await assert.rejects(executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }), /visible/);
  assert.equal(result.state_json.characters[0].pendingSpell.remaining, 1);
  result.state_json.entities.find(entity => entity.id === 'foe').visible = true;
  result.state_json.tiles[2 * 7 + 4].type = 'wall';
  await assert.rejects(executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }), /visible/);
  result = await executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', dismiss: true });
  assert.equal(result.state_json.characters[0].pendingSpell, null);
  assert.equal(result.state_json.combat.actionUsed, true);
});

test('authoritative natural one applies a wizard mishap and long spell locks survive rest', async () => {
  let calls = 0;
  const original = Math.random;
  Math.random = () => calls++ < 2 ? 0 : (5 - .5) / 12;
  let result;
  try { result = await executeGameCommand(wizardScene(), { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }); }
  finally { Math.random = original; }
  const wizard = result.state_json.characters[0];
  assert.equal(wizard.lastWizardMishaps[0].roll, 5);
  assert.equal(wizard.spellLocks['magic missile'].remainingMs, 7 * 24 * 60 * 60 * 1000);
  result.state_json.combat.active = false;
  result.state_json.entities = result.state_json.entities.slice(0, 1);
  for (const character of result.state_json.characters) Object.assign(character, { hp: 1, dyingRounds: 0, gear: [{ name: 'Rations' }, { name: 'Torch', quantity: 3 }] });
  result = await executeGameCommand(result.state_json, { type: 'rest', character_id: 'priest' });
  result.state_json.rest.nextHourAt = Date.now() - 16000;
  result = await executeGameCommand(result.state_json, { type: 'tick', elapsed_ms: 2000 });
  assert.equal(result.state_json.characters[0].hp, 10);
  assert.ok(result.state_json.characters[0].failedSpellKeys.includes('magic missile'));
  assert.equal(result.state_json.characters[0].spellLocks['magic missile'].remainingMs, (7 * 24 - 8) * 60 * 60 * 1000);
});

test('pending missiles prevent automatic end-turn even when all movement is spent', async () => {
  const state = wizardScene();
  state.combat.movementRemaining = 0;
  let result = await withRandom(.99, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
  assert.equal(result.state_json.combat.turnIndex, 0);
  result = await executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', choice: 'two-missiles' });
  result = await withRandom(.99, () => executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }));
  assert.equal(result.state_json.combat.turnIndex, 0);
  assert.equal(result.state_json.characters[0].pendingSpell.remaining, 1);
});

test('the final missile can kill the last enemy and end combat without leaving a pending spell', async () => {
  const state = wizardScene();
  state.entities[1].hp = 1;
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
  result = await withRandom(.6, () => executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }));
  assert.equal(result.state_json.combat.active, false);
  assert.equal(result.state_json.characters[0].pendingSpell, null);
  assert.equal(result.state_json.characters[0].lastMagicMissile.spent.length, 1);
});

test('purple glow grants real enemy attack advantage and expires on initiative rounds, not heartbeat ticks', async () => {
  for (const glowing of [false, true]) {
    const state = wizardScene();
    state.characters.length = 1;
    state.combat.playerOrderIds = ['priest'];
    state.combat.turnOrder = [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }];
    state.entities[1].x = 3;
    if (glowing) state.characters[0].wizardEffects = [{ type: 'purple-glow', rounds: 10 }];
    let result = await executeGameCommand(state, { type: 'tick', elapsed_ms: 15000 });
    if (glowing) assert.equal(result.state_json.characters[0].wizardEffects[0].rounds, 10);
    const values = [.5, .2, .8, .5];
    let index = 0;
    const original = Math.random;
    Math.random = () => values[index++] ?? .5;
    try { result = await executeGameCommand(result.state_json, { type: 'end_turn', character_id: 'priest' }); }
    finally { Math.random = original; }
    assert.equal(result.state_json.characters[0].hp, glowing ? 7 : 10);
    if (glowing) assert.equal(result.state_json.characters[0].wizardEffects[0].rounds, 9);
  }
});

test('self-damaging mishaps cannot strand a dying caster on their own turn', async () => {
  const state = wizardScene();
  state.characters[0].hp = 1;
  Object.assign(state.characters[1], { hp: 10, dyingRounds: 0, className: 'Priest', spellsKnown: 'Cure Wounds', stats: { WIS: 14 } });
  const values = [0, 0, .1, .99, .5];
  let index = 0;
  const original = Math.random;
  Math.random = () => values[index++] ?? .5;
  let result;
  try { result = await executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }); }
  finally { Math.random = original; }
  assert.equal(result.state_json.characters[0].hp, 0);
  assert.ok(result.state_json.characters[0].dyingRounds > 0);
  assert.equal(result.state_json.combat.turnOrder[result.state_json.combat.turnIndex].id, 'priest');
  result = await withRandom(.99, () => executeGameCommand(result.state_json, { type: 'revive', character_id: 'priest' }));
  assert.equal(result.state_json.characters[0].hp, 1);
  assert.equal(result.state_json.combat.actionUsed, false);
  result = await executeGameCommand(result.state_json, { type: 'end_turn', character_id: 'priest' });
  result = await withRandom(.6, () => executeGameCommand(result.state_json, { type: 'spell', character_id: 'friend', spell_name: 'Cure Wounds', target_id: 'priest' }));
  assert.equal(result.state_json.characters[0].hp, 5);
  assert.equal(result.state_json.characters[0].dyingRounds, 0);
});

test('reselecting a ready spell neither rerolls casting nor spends another action; movement retains it', async () => {
  let result = await withRandom(.6, () => executeGameCommand(wizardScene(), { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
  const history = result.state_json.rollHistory.length;
  const original = Math.random;
  Math.random = () => { throw new Error('Unexpected reroll'); };
  try {
    result = await executeGameCommand(result.state_json, { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' });
  } finally { Math.random = original; }
  assert.equal(result.state_json.rollHistory.length, history);
  assert.equal(result.state_json.combat.actionUsed, true);
  result = await executeGameCommand(result.state_json, { type: 'move_batch', character_id: 'priest', moves: [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }] });
  assert.equal(result.state_json.characters[0].pendingSpell.remaining, 1);
  assert.equal(result.state_json.combat.movementRemaining, 4);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'light', character_id: 'priest', source: 'torch' }), /Spell ready/);
});

test('unreleased spells expire at the end of the caster turn', async () => {
  const state = wizardScene();
  Object.assign(state.characters[1], { hp: 10, dyingRounds: 0 });
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
  result = await executeGameCommand(result.state_json, { type: 'end_turn', character_id: 'priest' });
  assert.equal(result.state_json.characters[0].pendingSpell, null);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 100);
  assert.equal(result.state_json.combat.turnOrder[result.state_json.combat.turnIndex].id, 'friend');
});

test('authoritative Burning Hands may reposition after casting, then damages allies, enemies and exposed treasure once', async () => {
  const state = wizardScene();
  state.characters[0].spellsKnown = 'Burning Hands, Magic Missile';
  state.characters[1].x = 3; state.characters[1].y = 3; state.characters[1].hp = 10; state.characters[1].dyingRounds = 0;
  state.entities[1].x = 4; state.entities[1].y = 2;
  state.entities.push({ id: 'loot', type: 'treasure', kind: 'shield', name: 'wooden shield', value: 20, x: 3, y: 3, visible: true });
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Burning Hands' }));
  assert.equal(result.state_json.characters[0].pendingSpell.spell, 'burning hands');
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 100);
  result = await executeGameCommand(result.state_json, { type: 'move', character_id: 'priest', dx: 1, dy: 0 });
  result = await withRandom(.99, () => executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest' }));
  assert.equal(result.state_json.characters[0].hp, 10);
  assert.equal(result.state_json.characters[1].hp, 4);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 94);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'loot').name, 'charred wooden shield');
  assert.equal(result.state_json.entities.find(entity => entity.id === 'loot').value, 10);
  assert.equal(result.state_json.combat.actionUsed, true);
  assert.equal(result.state_json.combat.movementRemaining, 5);
  assert.equal(result.state_json.characters[0].pendingSpell, null);
  await assert.rejects(executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest' }));
});

test('authoritative Burning Hands critical choice persists without firing or rolling casting twice', async () => {
  for (const choice of ['two-d6', 'one-d12', 'double-radius']) {
    const state = wizardScene(); state.characters[0].spellsKnown = 'Burning Hands';
    let result = await withRandom(.99, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Burning Hands' }));
    await assert.rejects(executeGameCommand(result.state_json, { type: 'move', character_id: 'priest', dx: 1, dy: 0 }), /critical Burning Hands/);
    result = await executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', choice });
    assert.equal(result.state_json.characters[0].pendingSpell.phase, 'targeting');
    assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 100);
    assert.equal(result.state_json.combat.actionUsed, true);
  }
});

test('importing a personal character cannot carry a ready spell from another dungeon or turn', async () => {
  const state = wizardScene();
  const result = await executeGameCommand(state, { type: 'import', new_character_id: 'imported', character_json: {
    name: 'Imported Wizard', className: 'Wizard', hp: 10, maxHitPoints: 10, spellsKnown: 'Burning Hands',
    pendingSpell: { spell: 'burning hands', phase: 'targeting', radius: 2, diceCount: 1, diceSides: 12 },
    openingSpellActionSpent: true, lastMagicMissile: { phase: 'complete' }
  } });
  const imported = result.state_json.characters.find(character => character.id === 'imported');
  assert.equal(imported.pendingSpell, null);
  assert.equal(imported.lastMagicMissile, null);
  assert.equal(imported.openingSpellActionSpent, false);
});

test('authoritative Magic Missile uses a twelve-square circular limit even when farther enemies are lit', async () => {
  const state = wizardScene();
  state.map.width = 25;
  state.tiles = Array.from({ length: 175 }, (_, i) => ({ x: i % 25, y: Math.floor(i / 25), type: 'floor', roomId: 'room' }));
  state.rooms[0].width = 25;
  Object.assign(state.characters[1], { x: 9, y: 2, hp: 10, dyingRounds: 0, equipmentInitialized: true,
    gear: [{ name: 'Lantern', lit: true, equipped: true }], lightSource: 'lantern', lightRadius: 12 });
  state.entities[1].x = 15;
  let result = await withRandom(.6, () => executeGameCommand(state, { type: 'spell', character_id: 'priest', spell_name: 'Magic Missile' }));
  assert.ok(result.state_json.visibility.visibleNow.includes('15,2'));
  await assert.rejects(executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }), /visible/);
  result.state_json.entities.find(entity => entity.id === 'foe').x = 14;
  result = await withRandom(.6, () => executeGameCommand(result.state_json, { type: 'resolve_spell', character_id: 'priest', target_id: 'foe' }));
  assert.equal(result.state_json.entities.find(entity => entity.id === 'foe').hp, 97);
});

test('stealth does not prevent an authoritative weapon attack on a visible enemy', async () => {
  const state = wizardScene();
  Object.assign(state.characters[1], { hp: 10, dyingRounds: 0, equipmentInitialized: true,
    gear: [{ name: 'Lantern', lit: true, equipped: true }], lightSource: 'lantern', lightRadius: 12 });
  Object.assign(state.characters[0], { className: 'Fighter', stealthed: true,
    attacks: ['Longsword: +2, 1d8, close'], equipmentInitialized: true,
    gear: [{ name: 'Longsword', equipped: true }, { name: 'Torch', lit: true, equipped: true }] });
  state.entities[1].x = 3;
  const normalized = await executeGameCommand(state, { type: 'tick', elapsed_ms: 0 });
  const result = await withRandom(.6, () => executeGameCommand(normalized.state_json, {
    type: 'attack', character_id: 'priest', monster_id: 'foe', attack_index: 0
  }));
  assert.ok(result.state_json.entities.find(entity => entity.id === 'foe').hp < 100);
  assert.equal(result.state_json.characters[0].stealthed, false);
  assert.equal(result.state_json.combat.actionUsed, true);
});

test('authoritative canal steps charge the source square and never move with insufficient points', async () => {
  const state=wizardScene();
  state.decor={canals:[{assetKey:'canal-center-piece',x:3,y:2,blocksMovement:true}]};
  let result=await executeGameCommand(state,{type:'move',character_id:'priest',dx:1,dy:0});
  assert.equal(result.state_json.characters[0].x,3);
  assert.equal(result.state_json.combat.movementRemaining,5);
  result=await executeGameCommand(result.state_json,{type:'move',character_id:'priest',dx:1,dy:0});
  assert.equal(result.state_json.characters[0].x,4);
  assert.equal(result.state_json.combat.movementRemaining,3);
  result.state_json.characters[0].x=3;
  result.state_json.combat.movementRemaining=1;
  result=await executeGameCommand(result.state_json,{type:'move',character_id:'priest',dx:1,dy:0});
  assert.equal(result.state_json.characters[0].x,3);
  assert.equal(result.state_json.combat.movementRemaining,1);
  assert.match(result.message,/needs 2 movement/);
});

test('authoritative Shield of Faith critical changes derived AC without stacking and expires outside combat', async () => {
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);
  state.characters[0].spellsKnown='Shield of Faith';
  let result=await withRandom(.99,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Shield of Faith'}));
  assert.equal(result.state_json.characters[0].pendingSpell.spell,'shield of faith');
  result=await executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest',choice:'bonus'});
  assert.equal(result.state_json.characters[0].armorClass,14);
  result=await executeGameCommand(result.state_json,{type:'tick',elapsed_ms:15000});
  assert.equal(result.state_json.characters[0].faithEffects[0].rounds,4);
  result=await executeGameCommand(result.state_json,{type:'normalize'});
  assert.equal(result.state_json.characters[0].armorClass,14);
});

test('authoritative Holy Weapon enchants the selected equipped weapon and rebuilds attack/damage bonuses once',async()=>{
  const state=scene();state.characters[0].spellsKnown='Holy Weapon';
  Object.assign(state.characters[1],{hp:10,dyingRounds:0,className:'Fighter',stats:{STR:14},equipmentInitialized:true,
    gear:[{name:'Longsword',equipped:true}],attacks:['Longsword: +2, 1d8, close']});
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Holy Weapon'}));
  assert.equal(result.state_json.characters[0].pendingSpell.phase,'targeting');
  result=await executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest',target_id:'friend'});
  assert.match(result.state_json.characters[1].attacks[0],/\+3, 1d8\+1/);
  result=await executeGameCommand(result.state_json,{type:'normalize'});
  assert.match(result.state_json.characters[1].attacks[0],/\+3, 1d8\+1/);
  assert.equal(result.state_json.combat.actionUsed,true);
});

test('damage immediately checks focus without spending the priest next action; ordinary loss does not lose the spell',async()=>{
  const state=scene();state.characters[0].spellsKnown='Protection from Evil';state.characters[0].hp=10;
  Object.assign(state.characters[1],{hp:20,dyingRounds:0,className:'Wizard',stats:{INT:14},spellsKnown:'Burning Hands'});
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Protection from Evil'}));
  result.state_json.combat.turnIndex=1;result.state_json.combat.actionUsed=false;
  result=await withRandom(.6,()=>executeGameCommand(result.state_json,{type:'spell',character_id:'friend',spell_name:'Burning Hands'}));
  result=await withRandom(.05,()=>executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'friend'}));
  assert.equal(result.state_json.characters[0].hp,9);
  assert.equal(result.state_json.characters[0].focusSpell,null);
  assert.ok(!result.state_json.characters[0].failedSpellKeys.includes('protection from evil'));
  assert.ok(result.state_json.rollHistory.some(entry=>/focus \(damage\)/i.test(entry.detail)));
});

test('authoritative turned undead spend their turn fleeing rather than using melee attacks',async()=>{
  const state=scene();state.characters.length=1;state.characters[0].hp=10;
  state.characters[0].spellsKnown='Turn Undead';state.characters[0].gear.push({name:'Holy symbol'});
  state.entities[1].tags=['undead'];state.entities[1].level=9;state.entities[1]['**CH**']=-2;
  state.combat.turnOrder=[{type:'character',id:'priest'},{type:'monster',id:'foe'}];state.combat.playerOrderIds=['priest'];
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Turn Undead'}));
  assert.equal(result.state_json.entities[1].turnedUndead.rounds,5);
  result=await withRandom(.6,()=>executeGameCommand(result.state_json,{type:'end_turn',character_id:'priest'}));
  assert.ok(result.state_json.entities[1].x>=5);
  assert.equal(result.state_json.characters[0].hp,10);
});

test('next-turn Focus is free and an ordinary failed maintenance check permits recasting that turn',async()=>{
  const state=scene();state.characters[0].hp=10;state.characters[0].spellsKnown='Protection from Evil';
  state.characters.length=1;state.combat.turnOrder=[{type:'character',id:'priest'},{type:'monster',id:'foe'}];state.combat.playerOrderIds=['priest'];
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Protection from Evil'}));
  result=await withRandom(.05,()=>executeGameCommand(result.state_json,{type:'end_turn',character_id:'priest'}));
  assert.equal(result.state_json.characters[0].focusSpell,null);
  assert.equal(result.state_json.combat.actionUsed,false);
  assert.ok(!result.state_json.characters[0].failedSpellKeys.includes('protection from evil'));
  result=await withRandom(.6,()=>executeGameCommand(result.state_json,{type:'spell',character_id:'priest',spell_name:'Protection from Evil'}));
  assert.ok(result.state_json.characters[0].focusSpell);
});

test('halfling activation is free, persists through commands and cannot be repeated',async()=>{
  const state=scene();state.characters[0].ancestry='Halfling';
  let result=await executeGameCommand(state,{type:'ancestry_invisibility',character_id:'priest'});
  assert.equal(result.state_json.combat.actionUsed,false);assert.equal(result.state_json.characters[0].invisibility.rounds,3);
  result=await executeGameCommand(result.state_json,{type:'move',character_id:'priest',dx:0,dy:1});
  assert.equal(result.state_json.characters[0].invisibility.rounds,3);
  await assert.rejects(executeGameCommand(result.state_json,{type:'ancestry_invisibility',character_id:'priest'}),/unavailable/);
});

test('authoritative reaction pauses movement and creates a controllable companion on friendly result',async()=>{
  const state=scene();state.combat.active=false;state.characters.length=1;
  Object.assign(state.characters[0],{languages:'Common',stats:{CHA:18}});
  Object.assign(state.entities[1],{name:'Peasant',attitude:null,attitudeChecked:false,hostile:false,languages:['Common']});
  let result=await executeGameCommand(state,{type:'tick',elapsed_ms:1000});
  assert.equal(result.state_json.encounterPrompt.speakerId,'priest');
  await assert.rejects(executeGameCommand(result.state_json,{type:'move',character_id:'priest',dx:0,dy:1}),/reaction/);
  result=await withRandom(.99,()=>executeGameCommand(result.state_json,{type:'reaction',character_id:'priest',talk:true}));
  assert.equal(result.state_json.encounterPrompt,null);
  const companion=result.state_json.characters.find(character=>character.companion);
  assert.equal(companion.companion.kind,'friendly');assert.equal(companion.companion.controllerCharacterId,'priest');
});

test('mimic pickup starts an ambush rather than collecting or instantly defeating it',async()=>{
  const state=scene();state.combat.active=false;state.characters[0].hp=10;
  Object.assign(state.characters[1],{hp:20,dyingRounds:0,ancestry:'Goblin'});
  Object.assign(state.entities[1],{name:'Mimic',attack:'1 bite +0 (1d4)',x:3,hp:50,attitude:null,attitudeChecked:false,hostile:false});
  const result=await withRandom(.5,()=>executeGameCommand(state,{type:'pickup',character_id:'priest',entity_id:'foe'}));
  const foe=result.state_json.entities.find(entity=>entity.id==='foe');
  assert.equal(foe.disguiseRevealed,true);assert.equal(foe.defeated,undefined);
  assert.equal(result.state_json.combat.surpriseRound,true);
  assert.ok(!result.state_json.combat.surpriseParticipantIds.includes('priest'));
  assert.ok(result.state_json.combat.surpriseParticipantIds.includes('friend'));
});

test('an interior monster cannot be killed by the generic interact command',async()=>{
  await assert.rejects(executeGameCommand(scene(),{type:'interact',character_id:'priest',x:5,y:2}),/Choose an attack/);
});

test('wizard invisibility uses a cast then target flow and prevents ranged missile targeting',async()=>{
  const state=scene();Object.assign(state.characters[0],{className:'Wizard',stats:{INT:14},spellsKnown:'Invisibility'});
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Invisibility'}));
  assert.equal(result.state_json.characters[0].pendingSpell.spell,'invisibility');
  result=await executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest',target_id:'priest'});
  assert.equal(result.state_json.characters[0].invisibility.rounds,10);
  const target=scene();target.characters[0].className='Wizard';target.characters[0].stats={INT:14};target.characters[0].spellsKnown='Magic Missile';
  target.entities[1].invisibility={rounds:3,source:'halfling'};
  result=await withRandom(.6,()=>executeGameCommand(target,{type:'spell',character_id:'priest',spell_name:'Magic Missile'}));
  await assert.rejects(executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest',target_id:'foe'}),/range|visible|target/i);
});

test('doppelganger joins after its victim dies, stores the corpse and betrays on dismissal',async()=>{
  const state=scene();state.combat.active=false;
  Object.assign(state.characters[0],{hp:0,dead:true,gear:[{name:'Mace'}]});
  Object.assign(state.characters[1],{hp:20,dyingRounds:0,ancestry:'Goblin',lightSource:'torch',lightRadius:6,gear:[{name:'Torch',lit:true,equipped:true}]});
  Object.assign(state.entities[1],{name:'Doppelganger',hp:20,maxHp:20,ac:12,attack:'1 dagger (close/near) +2 (1d4)',
    impersonationStarted:true,emulatedId:'priest',impersonatedCharacter:structuredClone(state.characters[0])});
  let result=await executeGameCommand(state,{type:'tick',elapsed_ms:1000});
  const impostor=result.state_json.characters.find(character=>character.companion?.kind==='doppelganger');
  assert.ok(impostor);assert.equal(impostor.name,'Priest');assert.equal(impostor.gearSlotsTotal,12);
  assert.equal(impostor.gear[0].bound,true);assert.ok(result.state_json.entities.some(entity=>entity.subtype==='character-corpse'));
  assert.ok(result.state_json.entities.some(entity=>entity.corpseOwnerId==='priest'&&entity.name==='Mace'));
  assert.equal(result.state_json.characters.find(character=>character.id==='priest').gear.length,0);
  await assert.rejects(executeGameCommand(result.state_json,{type:'edit_character',character_id:impostor.id,character_json:{stats:{STR:18}}}),/fixed/);
  result=await withRandom(.5,()=>executeGameCommand(result.state_json,{type:'dismiss',character_id:impostor.id}));
  assert.equal(result.state_json.characters.some(character=>character.id===impostor.id),false);
  assert.equal(result.state_json.entities.find(entity=>entity.id==='foe').impersonatedCharacter.name,'Friend');
  assert.equal(result.state_json.combat.surpriseRound,true);
});

test('Magic Missile reveals and surprises a lone disguised mimic even without other monsters',async()=>{
  const state=scene();state.combat.active=false;state.characters.length=1;
  Object.assign(state.characters[0],{className:'Wizard',stats:{INT:14},spellsKnown:'Magic Missile'});
  Object.assign(state.entities[1],{name:'Mimic',hostile:false,attitude:null,attitudeChecked:false});
  let result=await withRandom(.6,()=>executeGameCommand(state,{type:'spell',character_id:'priest',spell_name:'Magic Missile'}));
  result=await withRandom(.6,()=>executeGameCommand(result.state_json,{type:'resolve_spell',character_id:'priest',target_id:'foe'}));
  assert.equal(result.state_json.entities[1].disguiseRevealed,true);
  assert.equal(result.state_json.combat.active,true);assert.equal(result.state_json.combat.surpriseRound,true);
  assert.ok(!result.state_json.combat.surpriseParticipantIds.includes('foe'));
});

test('equipping a later identical sword activates one unique attack and keeps distinct rusty weapons separate',async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);state.characters.length=1;
  Object.assign(state.characters[0],{className:'Fighter',stats:{STR:14},equipmentInitialized:true,gear:[{name:'Shortsword'},{name:'Shortsword'},{name:'Rusty shortsword',damage:'1d4',attackBonus:-1},{name:'Torch',equipped:true,lit:true}],attacks:[]});
  let result=await executeGameCommand(state,{type:'equip',character_id:'priest',gear_index:1,equipped:true});
  let hero=result.state_json.characters[0];assert.equal(hero.gear[1].equipped,true);assert.notEqual(hero.gear[0].equipped,true);
  assert.equal(hero.attacks.filter(text=>/^Shortsword:/i.test(text)).length,1);assert.ok(hero.attacks.some(text=>/^Rusty shortsword: -1, 1d4/i.test(text)));
  const entities=scene().entities;entities[1].x=3;
  result=await withRandom(.6,()=>executeGameCommand({...result.state_json,entities},{type:'attack',character_id:'priest',monster_id:'foe',attack_index:0}));
  assert.ok(result.state_json.entities[1].hp<100);
});

test('armor equips only one proficient suit, preserves hand items, and cannot change in combat',async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);state.characters.length=1;
  Object.assign(state.characters[0],{className:'Fighter',stats:{DEX:10},gear:[{name:'Leather armor'},{name:'Plate armor'},{name:'Greatsword',equipped:true}],equipmentInitialized:true});
  let result=await executeGameCommand(state,{type:'normalize'});assert.equal(result.state_json.characters[0].armorClass,15);
  result=await executeGameCommand(result.state_json,{type:'equip',character_id:'priest',gear_index:0,equipped:true});
  assert.equal(result.state_json.characters[0].armorClass,11);assert.equal(result.state_json.characters[0].gear[2].equipped,true);
  result=await executeGameCommand(result.state_json,{type:'equip',character_id:'priest',gear_index:0,equipped:false});
  assert.equal(result.state_json.characters[0].armorClass,10);
  const fight=scene();fight.characters[0].gear.push({name:'Plate armor'});
  await assert.rejects(executeGameCommand(fight,{type:'equip',character_id:'priest',gear_index:1,equipped:true}),/Armor cannot/);
});

test('forbidden equipment is rejected and gear reordering cannot create or remove items',async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);state.characters.length=1;
  Object.assign(state.characters[0],{className:'Wizard',equipmentInitialized:true,gear:[{name:'Dagger'},{name:'Shield'},{name:'Shortsword'}]});
  await assert.rejects(executeGameCommand(state,{type:'equip',character_id:'priest',gear_index:1,equipped:true}),/cannot use shields/);
  await assert.rejects(executeGameCommand(state,{type:'equip',character_id:'priest',gear_index:2,equipped:true}),/cannot use that weapon/);
  const result=await executeGameCommand(state,{type:'reorder_gear',character_id:'priest',from_index:2,to_index:0});
  assert.deepEqual(result.state_json.characters[0].gear.map(item=>item.name),['Shortsword','Dagger','Shield']);
  await assert.rejects(executeGameCommand(state,{type:'reorder_gear',character_id:'priest',from_index:-1,to_index:0}),/existing gear/);
});

test('picking up floor treasure preserves every token color through normalization',async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);
  Object.assign(state.characters[0],{colorId:'red',colorValue:'#ff0000'});Object.assign(state.characters[1],{hp:10,dyingRounds:0,colorId:'green',colorValue:'#00ff00'});
  state.entities.push({id:'loot',type:'treasure',name:'Gem',kind:'gems',value:1,visible:true,roomId:'room',x:2,y:2});
  const result=await executeGameCommand(state,{type:'pickup',character_id:'priest',entity_id:'loot'});
  assert.deepEqual(result.state_json.characters.map(character=>character.colorValue),['#ff0000','#00ff00']);
});

test('parenthesized weapon variants keep separate named attacks',async()=>{
  const state=scene();state.combat.active=false;state.entities=state.entities.slice(0,1);state.characters.length=1;
  Object.assign(state.characters[0],{className:'Fighter',equipmentInitialized:true,gear:[{name:'Shortsword'},{name:'Shortsword (+1)',equipped:true,damage:'1d6+1'}]});
  const result=await executeGameCommand(state,{type:'normalize'});
  assert.equal(result.state_json.characters[0].attacks.length,2);
  assert.match(result.state_json.characters[0].attacks[1],/^Shortsword \(\+1\):/);
});
