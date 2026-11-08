import test from 'node:test';
import assert from 'node:assert/strict';
import { extractShadowdarkCharacters, normalizeCharacterState } from '../../S3_content/src/characters.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { listMagicEffects, endMagicEffect } from '../../S3_content/src/magic-effect-registry.js';
import { dispelMagicOptions } from '../../S3_content/src/dispel-magic.js';
import { resolveIllusion } from '../../S3_content/src/illusion.js';
import { ancestryAttackModifiers, ancestryTalents } from '../../S3_content/src/ancestry.js';
import { beginPartyRest, advancePartyRest, buildRestWatchOrder, restingParty,
  restSupplyStatus, restWatchSchedule, restWatchCharacters, interruptPartyRest } from '../../S3_content/src/rest.js';

const clone = value => structuredClone(value);
const actor = (id, extra = {}) => ({ id, name: id, className: 'Wizard', ancestry: '', level: 5,
  x: 4, y: 4, roomId: 'room', routeId: '', hp: 10, maxHitPoints: 20, XP: 12,
  stats: { STR: 10, DEX: 10, CON: 10, INT: 14, WIS: 10, CHA: 10 },
  gear: [], conditions: {}, raw: {}, ...extra });
const creature = (id, form = 'horrible behemoth', footprint = 3) => actor(id, {
  name: form, x: 6, y: 6,
  illusion: { id, casterId: 'caster', kind: 'creature', form, footprint }
});
const area = (id, kind = 'floor') => ({ id, type: 'feature', subtype: 'illusion', name: `Illusory ${kind}`,
  x: 7, y: 7, width: 3, height: 3, routeId: '',
  illusion: { id, casterId: 'caster', kind } });
function scene(projections = [creature('first'), area('second')]) {
  const state = createEmptyDungeonState(17);
  state.map = { width: 16, height: 16 };
  state.rooms = [{ id: 'room' }];
  const caster = actor('caster', { ancestry: 'Half-Orc',
    focusSpell: { id: 'illusion-focus', spell: 'illusion', tier: 3,
      illusionIds: projections.map(projection => projection.id), castingTotal: 23 } });
  caster.raw.focusSpell = clone(caster.focusSpell);
  state.characters = [caster, ...projections.filter(projection => projection.illusion.kind === 'creature')];
  state.entities = projections.filter(projection => projection.illusion.kind !== 'creature');
  state.activeCharacterId = caster.id;
  return { state, caster };
}
const effects = state => listMagicEffects(state).filter(effect => effect.spell === 'illusion');
const reload = state => hydrateDungeonState(JSON.parse(JSON.stringify(serializeDungeonState(state))));

test('normalization and repeated saves retain illusion records, source floor IDs and original ancestry', () => {
  let { state } = scene();
  const source = state.characters[1];
  source.illusionStealthIds = ['floor-one', 'floor-two'];
  source.ancestry = 'Half-Orc';
  source.illusion.form = 'elf';
  const expectedIllusion = clone(source.illusion), expectedAncestry = ancestryTalents(source);
  state.characters = extractShadowdarkCharacters(JSON.stringify(state.characters));
  state.characters[1].gear.push({ name: 'Dagger', type: 'weapon', equipped: true, damage: '1d4' });
  for (let pass = 0; pass < 3; pass++) {
    normalizeCharacterState(state);
    state = reload(state);
    const projection = state.characters.find(character => character.id === 'first');
    assert.deepEqual(projection.illusion, expectedIllusion);
    assert.deepEqual(projection.raw.illusion, expectedIllusion);
    assert.notEqual(projection.illusion, projection.raw.illusion);
    assert.deepEqual(projection.illusionStealthIds, ['floor-one', 'floor-two']);
    assert.deepEqual(projection.raw.illusionStealthIds, ['floor-one', 'floor-two']);
    assert.notEqual(projection.illusionStealthIds, projection.raw.illusionStealthIds);
    assert.equal(projection.ancestry, 'Half-Orc');
    assert.deepEqual(ancestryTalents(projection), expectedAncestry);
    assert.deepEqual(ancestryAttackModifiers(projection), { attack: 1, damage: 1 });
    assert.equal(projection.gear[0].name, 'Dagger');
    assert.deepEqual(state.characters[0].focusSpell.illusionIds, ['first', 'second']);
    assert.deepEqual(state.entities[0].illusion, area('second').illusion);
  }
});

test('a projection form never supplies ancestry and floor-exit ID clearing persists', () => {
  let { state } = scene([creature('first', 'goblin', 1)]);
  state.characters[0].illusionStealthIds = ['floor-one', 'floor-two'];
  state = reload(state);
  assert.equal(state.characters[1].ancestry, '');
  assert.deepEqual(ancestryTalents(state.characters[1]), []);
  state.characters[0].illusionStealthIds = ['floor-two'];
  state = reload(state);
  assert.deepEqual(state.characters[0].illusionStealthIds, ['floor-two']);
  state.characters[0].illusionStealthIds = [];
  state = reload(state);
  assert.deepEqual(state.characters[0].illusionStealthIds, []);
  assert.deepEqual(state.characters[0].raw.illusionStealthIds, []);
});

test('catalog exposes one plain stable descriptor per projection with centered creature and top-left area bounds', () => {
  const { state } = scene([creature('large'), creature('small', 'elf', 1), area('floor'), area('pit', 'pit')]);
  const before = JSON.stringify(state), catalog = effects(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(catalog.length, 4);
  assert.equal(new Set(catalog.map(effect => effect.id)).size, 4);
  assert.deepEqual(effects(JSON.parse(before)), catalog);
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog);
  const large = catalog.find(effect => effect.targetId === 'large');
  assert.deepEqual({ kind: large.kind, x: large.x, y: large.y, width: large.width, height: large.height },
    { kind: 'summon', x: 5, y: 5, width: 3, height: 3 });
  assert.equal(large.name, 'Illusion (Horrible Behemoth)');
  assert.equal(large.displayName, large.name);
  assert.equal(large.casterId, 'caster');
  const small = catalog.find(effect => effect.targetId === 'small');
  assert.deepEqual([small.x, small.y, small.width, small.height], [6, 6, 1, 1]);
  for (const kind of ['floor', 'pit']) {
    const effect = catalog.find(effect => effect.targetId === kind);
    assert.equal(effect.kind, 'area');
    assert.deepEqual([effect.x, effect.y, effect.width, effect.height], [7, 7, 3, 3]);
    assert.equal(effect.name, `Illusion (${kind === 'floor' ? 'Floor' : 'Pit'})`);
  }
  assert.equal(catalog.some(effect => effect.kind === 'focus'), false);
});

test('Dispel options select the edge of a three-square creature and each whole area', () => {
  const { state, caster } = scene();
  caster.pendingSpell = { spell: 'dispel magic', selected: { x: 5, y: 5, routeId: '' }, usedEffectIds: [], usedTargetIds: [] };
  assert.deepEqual(dispelMagicOptions(state, caster).map(effect => effect.targetId), ['first']);
  caster.pendingSpell.selected = { x: 9, y: 9, routeId: '' };
  assert.deepEqual(dispelMagicOptions(state, caster).map(effect => effect.targetId), ['second']);
  caster.pendingSpell.selected.routeId = 'underpass';
  assert.deepEqual(dispelMagicOptions(state, caster), []);
});

for (const kind of ['creature', 'floor', 'pit']) {
  test(`critical duplicate ${kind} projections are independent under one Focus across save/load`, () => {
    const make = id => kind === 'creature' ? creature(id) : area(id, kind);
    let { state } = scene([make('first'), make('second')]);
    state.raw = { characters: clone(state.characters), entities: clone(state.entities) };
    const projection = [...state.characters, ...state.entities].find(actor => actor.id === 'first');
    const originalProjection = clone(projection);
    state.combat = { active: true, turnIndex: 1,
      turnOrder: [{ id: 'first' }, { id: 'caster' }, { id: 'second' }],
      characterIds: ['first', 'caster', 'second'], monsterIds: [] };
    let ended = 0;
    const options = { onFocusEnd: () => ended++ };
    const first = effects(state).find(effect => effect.targetId === 'first');
    endMagicEffect(state, first.id, options);
    assert.equal(ended, 0);
    assert.deepEqual(state.characters[0].focusSpell.illusionIds, ['second']);
    assert.deepEqual(state.characters[0].raw.focusSpell.illusionIds, ['second']);
    assert.equal([...state.characters, ...state.entities].some(actor => actor.id === 'first'), false);
    assert.equal([...state.raw.characters, ...state.raw.entities].some(actor => actor.id === 'first'), false);
    assert.deepEqual(projection, originalProjection, 'dismissal must not deal damage, mark death or mutate the projection');
    assert.equal(state.entities.some(entity => entity.subtype === 'character-corpse' || entity.type === 'treasure'), false);
    assert.equal(state.combat.turnIndex, 0);
    assert.deepEqual(state.combat.turnOrder.map(entry => entry.id), ['caster', 'second']);
    assert.equal(state.characters[0].XP, 12);
    assert.throws(() => endMagicEffect(state, first.id, options), /no longer active/);
    state = reload(state);
    assert.equal(effects(state).length, 1);
    const second = effects(state)[0];
    assert.equal(second.targetId, 'second');
    endMagicEffect(state, second.id, options);
    assert.equal(ended, 1);
    assert.equal(state.characters[0].focusSpell, null);
    assert.equal(state.characters[0].raw.focusSpell, null);
    state = reload(state);
    assert.deepEqual(effects(state), []);
    assert.deepEqual(state.characters.map(character => character.id), ['caster']);
    assert.deepEqual(state.entities, []);
    assert.equal(state.characters[0].ancestry, 'Half-Orc');
    assert.deepEqual(ancestryAttackModifiers(state.characters[0]), { attack: 1, damage: 1 });
  });
}

test('removing an old projection cannot end a newer Focus or another caster projection', () => {
  const { state, caster } = scene();
  caster.focusSpell = { id: 'new-focus', spell: 'illusion', illusionIds: ['second'] };
  const other = actor('other', { focusSpell: { id: 'other-focus', spell: 'illusion', illusionIds: ['third'] } });
  const third = creature('third');
  third.illusion.casterId = 'other';
  state.characters.push(other, third);
  const beforeOther = clone(other);
  endMagicEffect(state, effects(state).find(effect => effect.targetId === 'first').id);
  assert.deepEqual(caster.focusSpell, { id: 'new-focus', spell: 'illusion', illusionIds: ['second'] });
  assert.deepEqual(other, beforeOther);
  assert.equal(effects(state).length, 2);
});

for (const phase of ['options', 'placement']) {
  test(`removing the only placed critical projection retains its Focus while ${phase} remains`, () => {
    let { state, caster } = scene([creature('first')]);
    state.tiles = Array.from({ length: 256 }, (_, index) => ({ x: index % 16, y: Math.floor(index / 16),
      type: 'floor', roomId: 'room', meta: {} }));
    caster.pendingSpell = { spell: 'illusion', tier: 3, phase, focusId: caster.focusSpell.id, remaining: 1,
      ...(phase === 'placement' ? { form: 'floor' } : {}) };
    const pending = clone(caster.pendingSpell), focusId = caster.focusSpell.id;
    let ended = 0;
    const options = { onFocusEnd: () => ended++ };
    endMagicEffect(state, effects(state)[0].id, options);
    assert.equal(ended, 0);
    assert.equal(caster.focusSpell.id, focusId);
    assert.deepEqual(caster.focusSpell.illusionIds, []);
    assert.deepEqual(caster.raw.focusSpell, caster.focusSpell);
    assert.deepEqual(caster.pendingSpell, pending);
    assert.deepEqual(effects(state), []);
    state = reload(state);
    caster = state.characters.find(character => character.id === 'caster');
    assert.equal(caster.focusSpell.id, focusId);
    assert.deepEqual(caster.focusSpell.illusionIds, []);
    assert.deepEqual(caster.pendingSpell, pending);
    if (phase === 'options') resolveIllusion(state, caster, { option: 'floor' });
    const { projection } = resolveIllusion(state, caster, { x: 8, y: 8, confirmed: true });
    assert.equal(caster.focusSpell.id, focusId);
    assert.deepEqual(caster.focusSpell.illusionIds, [projection.id]);
    assert.equal(caster.pendingSpell, null);
    assert.equal(effects(state).length, 1);
    endMagicEffect(state, effects(state)[0].id, options);
    assert.equal(ended, 1);
    assert.equal(caster.focusSpell, null);
  });
}

test('only remaining placement owned by the same Focus can keep an empty Illusion Focus', () => {
  for (const pending of [
    { spell: 'illusion', phase: 'options', focusId: 'another-focus', remaining: 1 },
    { spell: 'illusion', phase: 'placement', focusId: 'illusion-focus', remaining: 0 },
    { spell: 'illusion', phase: 'ended', focusId: 'illusion-focus', remaining: 1 },
    { spell: 'fireball', phase: 'placement', focusId: 'another-focus', remaining: 1 }
  ]) {
    const { state, caster } = scene([creature('first')]);
    caster.pendingSpell = clone(pending);
    let ended = 0;
    endMagicEffect(state, effects(state)[0].id, { onFocusEnd: () => ended++ });
    assert.equal(caster.focusSpell, null);
    assert.equal(caster.raw.focusSpell, null);
    assert.equal(ended, 1);
    if (pending.spell !== 'illusion' || pending.focusId !== 'illusion-focus') assert.deepEqual(caster.pendingSpell, pending);
  }
});

test('ended and dead projections and bare Illusion Focus do not produce catalog entries', () => {
  const { state } = scene([creature('first'), area('second')]);
  state.characters[1].dead = true;
  state.entities[0].illusion.ended = true;
  assert.deepEqual(effects(state), []);
});

function restScene() {
  const { state, caster } = scene([creature('first'), creature('second')]);
  state.map = { width: 3, height: 3 };
  state.tiles = Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3),
    type: 'floor', roomId: 'room', meta: {} }));
  state.visibility.exploredEver = new Set(state.tiles.map(tile => `${tile.x},${tile.y}`));
  caster.x = 1;
  caster.y = 1;
  caster.gear = [{ name: 'Rations', quantity: 1 }, { name: 'Torch', quantity: 3 }];
  for (const projection of state.characters.slice(1)) {
    projection.roomId = 'elsewhere';
    projection.hp = 0;
    projection.pendingSpell = { spell: 'ignored' };
    projection.conditions.sinkhole = 'ignored';
  }
  return { state, caster };
}

test('illusions need no supplies, watch shifts, gathering or healing to start and finish rest', () => {
  const { state, caster } = restScene();
  const before = clone(state.characters.slice(1));
  assert.deepEqual(restSupplyStatus(state), { partySize: 1, torches: 3, rations: 1, reusing: false, sufficient: true });
  assert.deepEqual(restingParty(state).map(character => character.id), ['caster']);
  assert.deepEqual(buildRestWatchOrder(state.characters, ['first', 'caster', 'second']), ['caster']);
  assert.deepEqual(restWatchSchedule(state, ['first', 'caster', 'second']).map(shift => shift.characterIds), [['caster'], [], [], []]);
  beginPartyRest(state, { safe: true, now: 0, watchOrderIds: ['first', 'caster', 'second'] });
  assert.deepEqual(state.rest.participantIds, ['caster']);
  assert.deepEqual(state.rest.watchOrderIds, ['caster']);
  assert.deepEqual(restWatchCharacters(state, 1).map(character => character.id), ['caster']);
  advancePartyRest(state, { now: 8000 });
  assert.equal(state.rest.phase, 'completed');
  assert.deepEqual(state.rest.recoveredNames, ['caster']);
  assert.equal(caster.hp, 20);
  assert.deepEqual(state.characters.slice(1), before);
});

test('stale saved rest participant IDs do not give projections recovery or interruption checks', () => {
  const { state } = restScene();
  const before = clone(state.characters.slice(1));
  beginPartyRest(state, { safe: true, now: 0 });
  state.rest.participantIds.push('first', 'second');
  state.rest.watchOrderIds = ['first', 'caster', 'second'];
  let checks = 0;
  interruptPartyRest(state, () => { checks++; return { total: 15 }; }, { hour: 3 });
  assert.equal(checks, 1);
  assert.deepEqual(state.rest.interruptionChecks.map(check => check.characterId), ['caster']);
  state.rest.phase = 'sleeping';
  state.rest.safe = true;
  advancePartyRest(state, { now: 8000 });
  assert.deepEqual(state.rest.recoveredNames, ['caster']);
  assert.deepEqual(state.rest.failedNames, []);
  assert.deepEqual(state.characters.slice(1), before);
});

test('a real character dying during rest still appears in failed recovery', () => {
  const { state, caster } = restScene();
  beginPartyRest(state, { safe: true, now: 0 });
  caster.dead = true;
  caster.hp = 0;
  advancePartyRest(state, { now: 8000 });
  assert.deepEqual(state.rest.failedNames, ['caster']);
  assert.deepEqual(state.rest.recoveredNames, []);
  assert.equal(caster.hp, 0);
});
