import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { placeDungeonDownstairs, isSafeDungeonArrival } from '../../S3_content/src/generator.js';
import { buildNextLevelState, buildPreviousLevelState, downstairsIn, snapshotDungeonFloor } from '../../S3_content/src/dungeon-descent.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { maintainTierTwoFocus } from '../../S3_content/src/wizard-tier-two-focus.js';
import { castIllusion, resolveIllusion, cleanupIllusions } from '../../S3_content/src/illusion.js';
import { illusionsAt, illusionBlocksMonsterStep } from '../../S3_content/src/illusion-geometry.js';

function floor(seed = 1, level = 1) {
  const state = createEmptyDungeonState(seed, level);
  state.rooms = [{ id: 'start', x: 2, y: 2, width: 6, height: 6 }, { id: 'end', x: 15, y: 2, width: 6, height: 6 }];
  state.generation.entranceRoomId = 'start';
  for (let y = 2; y <= 7; y++) for (let x = 2; x <= 20; x++) Object.assign(getTile(state, x, y),
    { type: 'floor', roomId: x < 8 ? 'start' : x > 14 ? 'end' : null, hallId: x >= 8 && x <= 14 ? 'hall' : null });
  state.entities = [{ id: 'up', type: 'feature', subtype: 'door', doorKind: 'stairs-up', x: 3, y: 3, roomId: 'start', doorState: 'open' },
    { id: 'reused-monster', type: 'monster', name: `Floor ${level} monster`, hp: 20, x: 6, y: 6, roomId: 'start' }];
  state.player = { x: 4, y: 4, roomId: 'start', torchLit: true, lightRadius: 6 };
  placeDungeonDownstairs(state);
  return state;
}
function gather(state, up = false) {
  const stairs = up ? state.entities.find(entity => entity.doorKind === 'stairs-up') : downstairsIn(state);
  const cells = state.tiles.filter(tile => tile.roomId === stairs.roomId && isSafeDungeonArrival(state, tile));
  state.characters.forEach((member, index) => Object.assign(member, { x: cells[index].x, y: cells[index].y, roomId: stairs.roomId, routeId: '' }));
  return state;
}
function party() {
  const state = floor();
  state.characters = ['caster', 'friend'].map((id, index) => ({ id, name: id, className: 'Wizard', level: 5,
    stats: { STR: 12, INT: 18 }, hp: 30, maxHitPoints: 30, gear: [], x: 16 + index, y: 3, roomId: 'end', routeId: '', raw: {} }));
  state.activeCharacterId = 'caster';
  return state;
}
const focus = extra => ({ id: 'focus', spell: 'acid arrow', tier: 2, targeted: true, damageDice: 1, ...extra });

test('old-floor creature Focus cannot bind reused destination IDs, including raw mirrors', () => {
  for (const references of [{ targetIds: ['reused-monster'] }, { targetId: 'reused-monster' }, { centerId: 'reused-monster' }]) {
    const state = gather(party()), caster = state.characters[0];
    caster.focusSpell = focus(references); caster.raw.focusSpell = structuredClone(caster.focusSpell);
    const before = structuredClone(state);
    const next = buildNextLevelState(state, { generate: floor });
    assert.deepEqual(state, before, 'reference filtering must not mutate the old floor or its cache');
    assert.equal(next.characters[0].focusSpell, null);
    assert.equal(next.characters[0].raw.focusSpell, null);
    assert.equal(maintainTierTwoFocus(next, next.characters[0]), null);
    assert.equal(next.entities.find(entity => entity.id === 'reused-monster').hp, 20);
  }
});

test('mixed Focus references retain only travelling party IDs and cannot restore a suspended old-floor targeting action', () => {
  const state = gather(party()), caster = state.characters[0];
  caster.focusSpell = focus({ targetIds: ['friend', 'reused-monster'], targetId: 'reused-monster', centerId: 'caster',
    usedTargetIds: ['friend', 'reused-monster'], lastCheck: 19, remainingMs: 12345,
    suspendedPendingSpell: { targetId: 'reused-monster' } });
  caster.raw.focusSpell = structuredClone(caster.focusSpell);
  const next = buildNextLevelState(state, { generate: floor });
  const carried = next.characters[0].focusSpell;
  assert.deepEqual(carried.targetIds, ['friend']); assert.deepEqual(carried.usedTargetIds, ['friend']);
  assert.equal(carried.targetId, undefined); assert.equal(carried.centerId, 'caster');
  assert.equal(carried.suspendedPendingSpell, undefined);
  assert.equal(carried.lastCheck, 19); assert.equal(carried.remainingMs, 12345);
  assert.deepEqual(next.characters[0].raw.focusSpell, carried);
});

test('self and party-centered Focus survive in both directions, including companion source and raw mirrors', () => {
  for (const references of [{ targetIds: ['friend'] }, { targetId: 'caster' }, { centerId: 'friend' }, {}]) {
    const state = gather(party()), caster = state.characters[0];
    caster.focusSpell = { spell: 'protection from evil', radius: 2, ...references };
    caster.companion = { kind: 'friendly', sourceMonsterId: 'old-source', source: { id: 'old-source', focusSpell: focus({ targetIds: ['friend', 'reused-monster'] }) } };
    caster.raw.focusSpell = structuredClone(caster.focusSpell);
    const next = buildNextLevelState(state, { generate: floor });
    assert.deepEqual(next.characters[0].focusSpell, caster.focusSpell);
    assert.deepEqual(next.characters[0].companion.source.focusSpell.targetIds, ['friend']);
    assert.deepEqual(next.characters[0].raw.companion, next.characters[0].companion);
    const returned = buildPreviousLevelState(gather(next, true));
    assert.deepEqual(returned.characters[0].focusSpell, caster.focusSpell);
  }
});

test('board-area Focus ends even if the destination reuses its area ID or that ID equals a party ID', () => {
  for (const areaId of ['reused-area', 'caster']) {
    const state = gather(party()), caster = state.characters[0];
    caster.focusSpell = { spell: 'silence', areaId, targetIds: ['caster'] };
    caster.raw.focusSpell = structuredClone(caster.focusSpell);
    const next = buildNextLevelState(state, { generate: (seed, level) => ({ ...floor(seed, level), areaSpells: [{ id: areaId, spell: 'silence', casterId: 'caster' }] }) });
    assert.equal(next.characters[0].focusSpell, null); assert.equal(next.characters[0].raw.focusSpell, null);
  }
});

const monsters = [{ name: 'Skeleton', hp: 4, maxHp: 4, ac: 12, level: 1, attack: '1 claw +1 (1)', movement: 'near', gear: [], languages: [] }];
function projection(state, form, x, y) {
  const caster = state.characters[0];
  resolveIllusion(state, caster, { option: form }, { monsters });
  return resolveIllusion(state, caster, { x, y, confirmed: true }, { monsters }).projection;
}

test('mixed critical Illusion keeps the travelling creature but ends fixed floor/pit cover before geometry queries on return', () => {
  for (const kind of ['floor', 'pit']) {
    const state = party(), caster = state.characters[0];
    castIllusion(state, caster, { checkRoll: () => ({ roll: 20, total: 24 }) });
    const creature = projection(state, 'skeleton', 18, 4), fixed = projection(state, kind, 19, 6);
    const focusId = caster.focusSpell.id;
    gather(state);
    const before = structuredClone(state), snapshot = snapshotDungeonFloor(state);
    assert.equal(snapshot.characters, undefined);
    assert.ok(!snapshot.entities.some(entity => entity.id === fixed.id));
    assert.ok(!snapshot.entities.some(entity => entity.id === creature.id));
    let next = buildNextLevelState(state, { generate: floor });
    assert.deepEqual(state, before);
    assert.deepEqual(next.characters[0].focusSpell.illusionIds, [creature.id]);
    assert.equal(next.characters[0].focusSpell.id, focusId);
    assert.deepEqual(next.characters[0].raw.focusSpell, next.characters[0].focusSpell);
    assert.ok(!next.entities.some(entity => entity.id === fixed.id));
    cleanupIllusions(next);
    assert.ok(next.characters.some(member => member.id === creature.id), 'normal cleanup must retain the travelling party illusion');
    const moved = next.characters.find(member => member.id === creature.id);
    assert.ok(isSafeDungeonArrival(next, moved)); assert.equal(moved.roomId, 'start'); assert.equal(moved.routeId, '');
    assert.equal(moved.raw.x, moved.x); assert.equal(moved.raw.y, moved.y);
    next = hydrateDungeonState(serializeDungeonState(next)); cleanupIllusions(next);
    assert.ok(next.characters.some(member => member.id === creature.id));
    // Older caches may still contain a fixed projection from the same Focus ID.
    next.dungeonFloors[1].entities.push(structuredClone(fixed));
    const cached = structuredClone(next.dungeonFloors[1]);
    const back = buildPreviousLevelState(gather(next, true));
    assert.deepEqual(next.dungeonFloors[1], cached, 'restoring must not mutate the inactive cache');
    assert.ok(!back.entities.some(entity => entity.id === fixed.id));
    assert.equal(back.characters[0].focusSpell.id, focusId);
    assert.deepEqual(illusionsAt(back, fixed, kind), [], 'ended fixed projections must not supply cover before cleanup');
    assert.equal(illusionBlocksMonsterStep(back, { type: 'monster' }, fixed), false);
    assert.deepEqual(back.characters[0].focusSpell.illusionIds, [creature.id]);
    cleanupIllusions(back);
    assert.ok(back.characters.some(member => member.id === creature.id));
    assert.deepEqual(back.characters[0].focusSpell.illusionIds, [creature.id]);
    assert.ok(!back.dungeonFloors[2].entities.some(entity => entity.id === creature.id));
  }
});

test('fixed-only Illusion Focus ends rather than binding to a same-ID projection on the next floor', () => {
  const state = party(), caster = state.characters[0];
  castIllusion(state, caster, { checkRoll: () => ({ roll: 15, total: 19 }) });
  const fixed = projection(state, 'floor', 19, 6);
  const next = buildNextLevelState(gather(state), { generate: (seed, level) => ({ ...floor(seed, level), entities: [
    ...floor(seed, level).entities, structuredClone(fixed)
  ] }) });
  assert.equal(next.characters[0].focusSpell, null); assert.equal(next.characters[0].raw.focusSpell, null);
});
