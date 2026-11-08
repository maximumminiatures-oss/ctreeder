import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { castIllusion, resolveIllusion, maintainIllusion, dismissIllusion, cleanupIllusions, syncIllusionStealth,
  touchIllusions, inspectIllusion, illusionAttack } from '../../S3_content/src/illusion.js';
import { isStealthed } from '../../S3_content/src/concealment.js';

const monsters = JSON.parse(await readFile(new URL('../../S3_content/data/shadowdark-content.json', import.meta.url))).monsters;
const check = (roll = 12, modifier = 4) => ({ roll, firstRoll: roll, modifier, total: roll + modifier, checkMode: 'normal' });
function scene() {
  const width = 24, height = 20;
  const caster = { id: 'caster', name: 'Badzog', className: 'Wizard', ancestry: 'Half-Orc', level: 5, x: 5, y: 5,
    hp: 50, stats: { INT: 18, DEX: 10 }, gear: [], raw: {}, spellsKnown: 'Illusion' };
  return { map: { width, height }, tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    characters: [caster], entities: [], activeCharacterId: caster.id, combat: { active: false } };
}
function place(state, form, x = 8, y = 5) {
  const caster = state.characters[0];
  resolveIllusion(state, caster, { option: form }, { monsters });
  return resolveIllusion(state, caster, { x, y, confirmed: true }, { monsters, moraleCheck: () => check(5, 0) }).projection;
}

test('Illusion uses DC13 INT and initial critical automatically permits two independent duplicate projections', () => {
  const state = scene(), caster = state.characters[0];
  assert.equal(castIllusion(state, caster, { checkRoll: () => check(8) }).succeeded, false);
  assert.ok(caster.failedSpellKeys.includes('illusion')); caster.failedSpellKeys = [];
  castIllusion(state, caster, { checkRoll: () => check(20) });
  const one = place(state, 'floor'), two = place(state, 'floor', 12, 5);
  assert.deepEqual(caster.focusSpell.illusionIds, [one.id, two.id]); assert.equal(caster.pendingSpell, null);
  dismissIllusion(state, one); assert.deepEqual(caster.focusSpell.illusionIds, [two.id]);
  dismissIllusion(state, two); assert.equal(caster.focusSpell, null);
});

test('all five creature forms preserve source stats while the behemoth is AC20, 60HP and all stats18', () => {
  for (const form of ['horrible behemoth', 'skeleton', 'marilith', 'vampire', 'tyrannosaurus']) {
    const state = scene(), caster = state.characters[0]; castIllusion(state, caster, { checkRoll: () => check() });
    const actor = place(state, form);
    assert.equal(actor.illusion.footprint, form === 'horrible behemoth' ? 3 : 1);
    if (form === 'horrible behemoth') { assert.equal(actor.armorClass, 20); assert.equal(actor.hp, 60); assert.ok(Object.values(actor.stats).every(score => score === 18)); }
    else { const source = monsters.find(monster => monster.name.toLowerCase() === form); assert.equal(actor.hp, source.hp); assert.equal(actor.armorClass, source.ac); }
    assert.equal(actor.companion.kind, 'illusion'); assert.deepEqual(actor.gear, []);
  }
});

test('behemoth arrival immediately checks eligible nearby morale without damaging any creature', () => {
  const state = scene(), caster = state.characters[0];
  state.entities.push({ id: 'orc', type: 'monster', name: 'Orc', x: 11, y: 5, hp: 10, W: 0 });
  castIllusion(state, caster, { checkRoll: () => check() }); const actor = place(state, 'horrible behemoth');
  assert.equal(state.entities[0].moraleFlight.casterId, actor.id); assert.equal(state.entities[0].hp, 10);
});

test('behemoth morale never checks player characters or recruited party monsters', () => {
  const state = scene(), caster = state.characters[0];
  const ally = { id: 'ally', type: 'monster', name: 'Orc', x: 10, y: 5, hp: 10, W: 0 };
  state.characters.push(ally);
  // A stale entity mirror must not turn a party member into a morale subject.
  state.entities.push({ ...ally }, { id: 'enemy', type: 'monster', name: 'Bandit', x: 11, y: 5, hp: 10, W: 0 });
  castIllusion(state, caster, { checkRoll: () => check() });
  resolveIllusion(state, caster, { option: 'horrible behemoth' }, { monsters });
  let rolls = 0;
  const result = resolveIllusion(state, caster, { x: 8, y: 5, confirmed: true }, {
    monsters, moraleCheck: () => { rolls++; return check(1, 0); }
  });
  assert.equal(rolls, 1);
  assert.deepEqual(result.morale.map(event => event.id), ['enemy']);
  assert.equal(ally.moraleFlight, undefined);
  assert.equal(state.entities[0].moraleFlight, undefined);
  assert.equal(result.privateCharacterId, caster.id);
});

test('illusory attacks always roll one in normal mode and never roll or apply damage', () => {
  const state = scene(), caster = state.characters[0]; castIllusion(state, caster, { checkRoll: () => check() });
  const actor = place(state, 'horrible behemoth');
  state.entities.push({ id: 'orc', type: 'monster', name: 'Orc', x: 11, y: 5, hp: 10, ac: 1 });
  actor.invisibility = { rounds: 5 }; actor.conditions = { blind: true };
  const result = illusionAttack(state, actor);
  assert.equal(result.roll.roll, 1); assert.equal(result.roll.total, 11); assert.equal(result.roll.checkMode, 'normal');
  assert.match(result.attack, /^bile spit/); assert.equal(state.entities[0].hp, 10);
});

test('floor cover grants stealth only inside, rolls once on leaving, and preserves ancestry', () => {
  const state = scene(), caster = state.characters[0]; castIllusion(state, caster, { checkRoll: () => check() }); place(state, 'floor', 5, 5);
  assert.equal(syncIllusionStealth(state).length, 0); assert.equal(isStealthed(caster), true);
  caster.x = 8; let rolls = 0;
  assert.equal(syncIllusionStealth(state, { checkRoll: () => { rolls++; return check(3, 0); } }).length, 1);
  assert.equal(isStealthed(caster), false); syncIllusionStealth(state); assert.equal(rolls, 1); assert.equal(caster.ancestry, 'Half-Orc');
});

test('inspection uses the latest Focus total and touching exposes only the contacted projection', () => {
  const state = scene(), caster = state.characters[0]; castIllusion(state, caster, { checkRoll: () => check(20) });
  const one = place(state, 'floor'), two = place(state, 'pit', 12, 5);
  maintainIllusion(state, caster, { checkRoll: () => check(15) });
  const monster = { id: 'orc', type: 'monster', name: 'Orc', hp: 10, x: 5, y: 5, W: 0 };
  let result = inspectIllusion(state, monster, { ids: [one.id], checkRoll: () => check(18, 0) });
  assert.equal(result.dc, 19); assert.equal(result.exposed, false);
  result = inspectIllusion(state, monster, { ids: [one.id], checkRoll: () => check(19, 0) });
  assert.equal(result.exposed, true); assert.deepEqual(caster.focusSpell.illusionIds, [two.id]);
  monster.x = 12; touchIllusions(state, monster); assert.equal(caster.focusSpell, null);
});

test('Focus twenties never offer critical choices; ordinary failure ends projections without losing spell', () => {
  const state = scene(), caster = state.characters[0]; castIllusion(state, caster, { checkRoll: () => check() }); place(state, 'floor');
  maintainIllusion(state, caster, { checkRoll: () => check(20) });
  assert.equal(caster.pendingSpell, null); assert.equal(caster.focusSpell.illusionIds.length, 1);
  maintainIllusion(state, caster, { checkRoll: () => check(7) });
  assert.equal(state.entities.length, 0); assert.equal(caster.focusSpell, null); assert.ok(!caster.failedSpellKeys?.includes('illusion'));
});

test('caster sleep, death or another Focus ends all projections without corpses or loot', () => {
  for (const change of [caster => caster.hp = 0, caster => caster.conditions = { sleeping: true }, caster => caster.focusSpell = { spell: 'detect magic' }]) {
    const state = scene(), caster = state.characters[0]; castIllusion(state, caster, { checkRoll: () => check() }); place(state, 'skeleton');
    change(caster); cleanupIllusions(state); assert.equal(state.characters.length, 1); assert.deepEqual(state.entities, []);
  }
});

test('dismissed or missing projections do not leave an empty Focus behind', () => {
  const state = scene(), caster = state.characters[0]; castIllusion(state, caster, { checkRoll: () => check() });
  place(state, 'skeleton'); state.characters = state.characters.filter(member => !member.illusion);
  cleanupIllusions(state); assert.equal(caster.focusSpell, null);
});
