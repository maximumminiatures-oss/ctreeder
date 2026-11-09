import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { buildMonsterCompanion } from '../../S3_content/src/companions.js';
import { activeAreaSpells } from '../../S3_content/src/area-spells.js';
import { listMagicEffects } from '../../S3_content/src/magic-effect-registry.js';
import { ongoingSpellTemplates } from '../../S3_content/src/spell-template-art.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

const clone = value => JSON.parse(JSON.stringify(value));
const member = (state, id = 'wizard') => state.characters.find(actor => actor.id === id);
const circles = state => (state.areaSpells || []).filter(area => area.spell === 'magic circle');
const effects = state => listMagicEffects(state).filter(effect => effect.spell === 'magic circle');
function hero(id, x, y, extra = {}) {
  return { id, name: id, className: 'Wizard', ancestry: 'Human', level: 5, hp: 80, maxHitPoints: 80,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 14, WIS: 18, CHA: 10 },
    x, y, routeId: '', roomId: 'room', spellsKnown: 'Magic Circle, Dispel Magic', gear: [],
    lightSpellLit: true, lightRadius: 6, lightSource: 'light-spell', ...extra };
}
function scene() {
  const width = 20, height = 14;
  return { seed: 456, level: 3, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }], entities: [],
    visibility: { exploredEver: Array.from({ length: width * height }, (_, i) => `${i % width},${Math.floor(i / width)}`) },
    characters: [hero('wizard', 8, 6)], activeCharacterId: 'wizard',
    player: { x: 8, y: 6, routeId: '', roomId: 'room', torchLit: false },
    wanderingMonsters: { numerator: 0, denominator: 6 }, combat: { active: false } };
}
function undead(id, x, y) {
  const actor = buildMonsterCompanion({ id: `${id}-source`, name: 'Bound Skeleton', tags: ['undead'],
    hp: 30, maxHp: 30, ac: 12, level: 1, S: 2, D: 0, C: 0, I: 0, W: 0, Ch: 0,
    x, y, routeId: '', roomId: 'room', attack: '1 claw +20 (1d4)', gear: [], languages: ['Common'] },
  { id, kind: 'summoned', controllerId: 'wizard' });
  actor.ancestry = 'Human';
  actor.raw = clone(actor);
  return actor;
}
async function command(state, values, random = .5) {
  const previous = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state, { character_id: 'wizard', ...values }); }
  finally { Math.random = previous; }
}
async function castCircle(state = scene(), tags = ['undead']) {
  let result = await command(state, { type: 'spell', spell_name: 'Magic Circle' }, tags.length === 2 ? .999 : .5);
  for (const option of tags) result = await command(result.state_json, { type: 'resolve_spell', option });
  return result;
}
function combat(state, actorId, monsterIds = []) {
  state.combat = { active: true, round: 1, turnIndex: 0, movementRemaining: 6, movementBudget: 6, actionUsed: false,
    turnOrder: [{ type: 'character', id: actorId }, ...monsterIds.map(id => ({ type: 'monster', id }))],
    playerOrderIds: [actorId], monsterIds };
}

test('actual Magic Circle commands use DC13 INT, resolve a tag, and expose one live art/dispel area', async () => {
  let result = await command(scene(), { type: 'spell', spell_name: 'Magic Circle' });
  let caster = member(result.state_json);
  assert.equal(caster.pendingSpell.spell, 'magic circle');
  assert.equal(caster.pendingSpell.maxTags, 1);
  assert.equal(caster.pendingSpell.castingTotal, 13);
  assert.equal(circles(result.state_json).length, 0);
  await assert.rejects(() => command(result.state_json, { type: 'resolve_spell', option: 'humanoid' }), /approved/);
  result = await command(result.state_json, { type: 'resolve_spell', option: 'undead' });
  caster = member(result.state_json);
  const [zone] = circles(result.state_json);
  assert.deepEqual([zone.x, zone.y, zone.width, zone.height], [5, 3, 7, 7]);
  assert.deepEqual(zone.tags, ['undead']);
  assert.equal(zone.casterId, caster.id);
  assert.equal(caster.focusSpell.areaId, zone.id);
  assert.equal(caster.pendingSpell, null);
  assert.deepEqual(caster.raw.focusSpell, caster.focusSpell);
  assert.deepEqual(activeAreaSpells(result.state_json).map(area => area.id), [zone.id]);
  assert.deepEqual(ongoingSpellTemplates(result.state_json).map(area => area.id), [zone.id]);
  assert.equal(effects(result.state_json).length, 1);
  assert.equal(effects(result.state_json)[0].kind, 'area');
});

test('initial runtime critical requires two distinct broad tags and never accepts a species', async () => {
  let result = await command(scene(), { type: 'spell', spell_name: 'Magic Circle' }, .999);
  assert.equal(member(result.state_json).pendingSpell.maxTags, 2);
  result = await command(result.state_json, { type: 'resolve_spell', option: 'demons' });
  assert.deepEqual(member(result.state_json).pendingSpell.tags, ['fiend']);
  assert.equal(circles(result.state_json).length, 0);
  await assert.rejects(() => command(result.state_json, { type: 'resolve_spell', option: 'devil' }), /different/);
  await assert.rejects(() => command(result.state_json, { type: 'resolve_spell', option: 'human' }), /approved/);
  result = await command(result.state_json, { type: 'resolve_spell', option: 'elementals' });
  assert.deepEqual(circles(result.state_json)[0].tags, ['fiend', 'primordial']);
  assert.equal(member(result.state_json).pendingSpell, null);
});

test('actual movement traps a source-tagged undead companion but permits interior steps and ordinary humans', async () => {
  const state = scene();
  state.characters.push(undead('inside', 5, 7), undead('outside', 4, 5),
    hero('human', 5, 8, { className: 'Fighter', spellsKnown: '' }));
  let result = await castCircle(state);
  result = await command(result.state_json, { type: 'move', character_id: 'inside', dx: 1, dy: 0 });
  assert.equal(member(result.state_json, 'inside').x, 6);
  result = await command(result.state_json, { type: 'move', character_id: 'inside', dx: -1, dy: 0 });
  result = await command(result.state_json, { type: 'move', character_id: 'inside', dx: -1, dy: 0 });
  assert.equal(member(result.state_json, 'inside').x, 5);
  assert.match(result.message, /Magic Circle blocks/);
  result = await command(result.state_json, { type: 'move', character_id: 'outside', dx: 1, dy: 0 });
  assert.equal(member(result.state_json, 'outside').x, 4);
  assert.match(result.message, /Magic Circle blocks/);
  result = await command(result.state_json, { type: 'move', character_id: 'human', dx: -1, dy: 0 });
  assert.equal(member(result.state_json, 'human').x, 4);
  assert.equal(member(result.state_json, 'inside').ancestry, 'Human');
  assert.ok(result.state_json.characters.every(actor => !actor.moraleFlight));
  const original = clone(circles(result.state_json)[0]);
  result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
  assert.equal(member(result.state_json).x, 9);
  assert.deepEqual(circles(result.state_json)[0], original);
});

test('authoritative companion attacks cannot harm anyone inside, including a native monster target', async () => {
  const state = scene();
  state.characters.push(undead('attacker', 5, 6), hero('friend', 6, 6, { className: 'Fighter', spellsKnown: '' }));
  let result = await castCircle(state);
  combat(result.state_json, 'attacker');
  const before = clone(result.state_json);
  await assert.rejects(() => command(result.state_json,
    { type: 'attack', character_id: 'attacker', target_id: 'friend', confirmed: true, attack_index: 0 }, .8), /Magic Circle prevents/);
  assert.deepEqual(result.state_json, before, 'rejected authoritative commands leave the submitted snapshot unchanged');
  const foe = { id: 'foe', type: 'monster', name: 'Circle Target', tags: ['fiend'], hp: 30, maxHp: 30,
    ac: 10, x: 6, y: 5, routeId: '', roomId: 'room', visible: true, hostile: true,
    attitude: 'combat', attitudeChecked: true, attack: '1 claw +0 (1d4)', stealthState: { attempted: true, revealed: true } };
  result.state_json.entities.push(foe);
  await assert.rejects(() => command(result.state_json,
    { type: 'attack', character_id: 'attacker', monster_id: 'foe', attack_index: 0 }, .8), /Magic Circle prevents/);
});

test('native monster turns are protected, while an unselected family can still deal damage', async () => {
  for (const selected of [true, false]) {
    let result = await castCircle();
    result.state_json.entities.push({ id: 'foe', type: 'monster', name: 'Circle Attacker',
      tags: [selected ? 'undead' : 'fiend'], hp: 100, maxHp: 100, ac: 12, x: 9, y: 6, routeId: '', roomId: 'room',
      level: 1, S: 0, D: 0, C: 0, I: 0, W: 0, Ch: 0, visible: true, hostile: true,
      attitude: 'combat', attitudeChecked: true, attack: '1 claw +20 (1d4)',
      stealthState: { attempted: true, revealed: true } });
    combat(result.state_json, 'wizard', ['foe']);
    result = await command(result.state_json, { type: 'end_turn' }, .8);
    assert.equal(member(result.state_json).hp === 80, selected);
    if (selected) {
      assert.match(result.state_json.combat.log.join(' '), /Magic Circle prevents/);
      assert.equal(result.state_json.rollHistory.some(entry => entry.label === 'Attack'), false);
    } else assert.ok(result.state_json.rollHistory.some(entry => entry.label === 'Attack'));
  }
});

test('actual Dispel Magic removes the whole circle and its owning Focus, then releases trapped movement', async () => {
  const state = scene();
  state.characters.push(hero('dispeller', 9, 6), undead('trapped', 5, 7));
  let result = await castCircle(state);
  const areaId = circles(result.state_json)[0].id;
  result = await command(result.state_json, { type: 'spell', character_id: 'dispeller', spell_name: 'Dispel Magic' });
  result = await command(result.state_json, { type: 'resolve_spell', character_id: 'dispeller', x: 5, y: 7 });
  assert.equal(member(result.state_json, 'dispeller').pendingSpell.phase, 'effects');
  const [effect] = effects(result.state_json);
  assert.equal(effect.targetId, areaId);
  result = await command(result.state_json, { type: 'resolve_spell', character_id: 'dispeller', option: effect.id });
  assert.deepEqual(circles(result.state_json), []);
  assert.deepEqual(effects(result.state_json), []);
  assert.equal(member(result.state_json).focusSpell, null);
  assert.equal(member(result.state_json).raw.focusSpell, null);
  assert.deepEqual(ongoingSpellTemplates(result.state_json), []);
  result = await command(clone(result.state_json), { type: 'move', character_id: 'trapped', dx: -1, dy: 0 });
  assert.equal(member(result.state_json, 'trapped').x, 4);
});

test('saved Focus uses INT at exact DC13, later twenties do not upgrade, and ordinary failure does not lose the spell', async () => {
  let result = await castCircle();
  const original = clone(circles(result.state_json)[0]);
  for (const random of [.5, .999]) {
    result = await command(clone(result.state_json), { type: 'normalize' });
    result = await command(clone(result.state_json), { type: 'tick', elapsed_ms: 10000 }, random);
    const caster = member(result.state_json);
    assert.equal(caster.focusSpell.lastCheck, random === .5 ? 13 : 22);
    assert.equal(caster.focusSpell.spell, 'magic circle');
    assert.equal(caster.pendingSpell, null);
    assert.deepEqual(caster.raw.focusSpell, caster.focusSpell);
    assert.deepEqual(circles(result.state_json), [original]);
    assert.equal(effects(result.state_json).length, 1);
  }
  result = await command(clone(result.state_json), { type: 'tick', elapsed_ms: 10000 }, .45);
  const caster = member(result.state_json);
  assert.equal(caster.focusSpell, null, '10 + INT 2 fails even though WIS is 18');
  assert.equal(caster.failedSpellKeys.includes('magic circle'), false);
  assert.deepEqual(circles(result.state_json), []);
  assert.ok(result.state_json.rollHistory.some(entry => entry.label === 'Focus' && /12 vs DC 13/.test(entry.detail)));
  result = await command(clone(result.state_json), { type: 'spell', spell_name: 'Magic Circle' });
  assert.equal(member(result.state_json).pendingSpell.spell, 'magic circle');
});

test('critical pending tags and the original cast anchor survive authoritative normalize/save roundtrips', async () => {
  let result = await command(scene(), { type: 'spell', spell_name: 'Magic Circle' }, .999);
  result = await command(result.state_json, { type: 'resolve_spell', option: 'undead' });
  for (let pass = 0; pass < 2; pass++) result = await command(clone(result.state_json), { type: 'normalize' });
  assert.equal(member(result.state_json).pendingSpell.maxTags, 2);
  assert.deepEqual(member(result.state_json).pendingSpell.tags, ['undead']);
  result = await command(result.state_json, { type: 'resolve_spell', option: 'construct' });
  result = await command(clone(result.state_json), { type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(circles(result.state_json)[0].anchor, { x: 8, y: 6 });
  assert.deepEqual(circles(result.state_json)[0].tags, ['undead', 'construct']);
  assert.equal(member(result.state_json).x, 9);
});

test('authoritative Focus natural one loses Magic Circle, applies tier-three mishaps and cannot restore its saved area', async () => {
  let result = await castCircle();
  result = await command(clone(result.state_json), { type: 'tick', elapsed_ms: 10000 }, .001);
  const caster = member(result.state_json);
  assert.equal(caster.focusSpell, null);
  assert.equal(caster.failedSpellKeys.includes('magic circle'), true);
  assert.equal(caster.lastWizardMishaps[0].tier, 3);
  assert.equal(caster.lastWizardMishaps[0].name, 'Devastation');
  assert.deepEqual(circles(result.state_json), []);
  result = await command(clone(result.state_json), { type: 'normalize' });
  assert.deepEqual(circles(result.state_json), []);
  assert.deepEqual(effects(result.state_json), []);
  await assert.rejects(() => command(result.state_json, { type: 'spell', spell_name: 'Magic Circle' }), /not available/);
});

test('Luck restores failed Magic Circle Focus and the original area without new tag choices or a new anchor', async () => {
  for (const tags of [['undead'], ['undead', 'construct']]) for (const reroll of [.5, .999]) {
    const state = scene();
    member(state).luckToken = true;
    state.characters.push(undead('outside', 4, 5));
    let result = await castCircle(state, tags);
    const originalArea = clone(circles(result.state_json)[0]);
    const originalFocus = clone(member(result.state_json).focusSpell);
    result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
    result = await command(clone(result.state_json), { type: 'tick', elapsed_ms: 10000 }, .45);
    assert.equal(member(result.state_json).focusSpell, null);
    assert.equal(member(result.state_json).failedSpellKeys.includes('magic circle'), false);
    assert.deepEqual(circles(result.state_json), []);
    assert.deepEqual(effects(result.state_json), []);
    result = await command(clone(result.state_json), { type: 'normalize' });
    result = await command(result.state_json, { type: 'move', dx: 1, dy: 0 });
    assert.equal(member(result.state_json).x, 10);
    result = await command(clone(result.state_json), { type: 'luck' }, reroll);
    const caster = member(result.state_json);
    assert.equal(caster.focusSpell.id, originalFocus.id);
    assert.equal(caster.focusSpell.areaId, originalArea.id);
    assert.equal(caster.focusSpell.lastCheck, reroll === .5 ? 13 : 22);
    assert.equal(caster.pendingSpell, null);
    assert.equal(caster.luckToken, reroll === .999);
    assert.equal(caster.luckTokens, reroll === .999 ? 1 : 0);
    assert.deepEqual(caster.raw.focusSpell, caster.focusSpell);
    assert.deepEqual(circles(result.state_json), [originalArea]);
    assert.deepEqual(circles(result.state_json)[0].tags, tags);
    assert.deepEqual(circles(result.state_json)[0].anchor, { x: 8, y: 6 });
    assert.equal(caster.x, 10, 'Luck must not relocate the caster to the original cast location');
    assert.equal(effects(result.state_json).length, 1);
    assert.deepEqual(activeAreaSpells(result.state_json).map(area => area.id), [originalArea.id]);
    assert.deepEqual(ongoingSpellTemplates(result.state_json).map(area => area.id), [originalArea.id]);
    result = await command(clone(result.state_json), { type: 'normalize' });
    result = await command(result.state_json, { type: 'move', character_id: 'outside', dx: 1, dy: 0 });
    assert.equal(member(result.state_json, 'outside').x, 4);
    assert.match(result.message, /Magic Circle blocks/);
    assert.deepEqual(circles(result.state_json), [originalArea]);
    await assert.rejects(() => command(result.state_json, { type: 'resolve_spell', option: 'fiend' }), /no critical or pending spell/i);
  }
});
