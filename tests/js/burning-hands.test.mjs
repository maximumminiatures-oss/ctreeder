import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBurningHands, castBurningHands, chooseBurningHands, releaseBurningHands } from '../../S3_content/src/burning-hands.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

function scene() {
  return { map: { width: 9, height: 9 }, tiles: Array.from({ length: 81 }, (_, i) => ({ x: i % 9, y: Math.floor(i / 9), type: 'floor' })),
    rooms: [], player: { x: 4, y: 4 }, characters: [
      { id: 'wizard', name: 'Wizard', x: 4, y: 4, hp: 12, maxHitPoints: 12, stats: { INT: 14 }, gear: [{ name: 'Rope' }] },
      { id: 'ally', name: 'Ally', x: 5, y: 5, hp: 12, maxHitPoints: 12, gear: [] }
    ], entities: [
      { id: 'foe', name: 'Foe', type: 'monster', x: 5, y: 4, hp: 12 },
      { id: 'far', name: 'Far Foe', type: 'monster', x: 6, y: 4, hp: 12 }
    ] };
}
const check = roll => modifier => ({ roll, modifier, total: roll + modifier });

test('Burning Hands casts first, shares one damage roll across adjacent creatures, and spares its caster', () => {
  const state = scene(), caster = state.characters[0];
  castBurningHands(state, caster, { rollCheck: check(12) });
  assert.equal(state.entities[0].hp, 12);
  assert.equal(caster.pendingSpell.phase, 'targeting');
  const result = releaseBurningHands(state, caster, { random: () => .99 });
  assert.equal(result.rolls.length, 1);
  assert.equal(state.characters[0].hp, 12);
  assert.equal(state.characters[1].hp, 6);
  assert.equal(state.entities[0].hp, 6);
  assert.equal(state.entities[1].hp, 12);
  assert.deepEqual(caster.gear, [{ name: 'Rope' }]);
  assert.equal(caster.pendingSpell, null);
  assert.throws(() => releaseBurningHands(state, caster), /not ready/);
});

test('all three critical choices persist and apply the chosen dice or circular radius', () => {
  for (const [choice, dice, sides, farHp] of [['two-d6', 2, 6, 12], ['one-d12', 1, 12, 12], ['double-radius', 1, 6, 6]]) {
    let state = scene(), caster = state.characters[0];
    castBurningHands(state, caster, { rollCheck: check(20) });
    assert.equal(caster.pendingSpell.phase, 'critical');
    assert.throws(() => releaseBurningHands(state, caster), /not ready/);
    chooseBurningHands(caster, choice);
    assert.throws(() => chooseBurningHands(caster, 'one-d12'), /no critical/);
    state = hydrateDungeonState(serializeDungeonState(state)); caster = state.characters[0];
    const result = releaseBurningHands(state, caster, { random: () => .99 });
    assert.equal(result.damage, dice * sides);
    assert.equal(state.entities[1].hp, farHp);
  }
});

test('walls and closed doors block flames, even with doubled radius', () => {
  const state = scene(), caster = state.characters[0];
  state.tiles[4 * 9 + 5].type = 'wall';
  let result = applyBurningHands(state, caster, { radius: 2, random: () => .99 });
  assert.ok(!result.hits.some(hit => hit.id === 'far'));
  state.tiles[4 * 9 + 5].type = 'floor';
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 5, y: 4, wallSide: 'east', doorState: 'closed' });
  result = applyBurningHands(state, caster, { radius: 2, random: () => .99 });
  assert.ok(!result.hits.some(hit => hit.id === 'far'));
});

test('fire changes exposed treasure and explicitly flammable features, never carried equipment', () => {
  const state = scene();
  state.entities.push(
    { id: 'wood', type: 'treasure', kind: 'shield', name: 'wooden shield', value: 12, x: 5, y: 4 },
    { id: 'rope', type: 'treasure', kind: 'gear', name: 'rope', value: 1, x: 4, y: 5 },
    { id: 'curtain', type: 'feature', name: 'Curtain', flammable: true, x: 3, y: 4 },
    { id: 'unmarked', type: 'feature', name: 'Stone urn', x: 4, y: 3 });
  const result = applyBurningHands(state, state.characters[0], { random: () => .5 });
  assert.equal(state.entities.find(item => item.id === 'wood').name, 'charred wooden shield');
  assert.equal(state.entities.find(item => item.id === 'wood').value, 6);
  assert.equal(state.entities.find(item => item.id === 'rope').name, 'ash pile');
  assert.equal(state.entities.find(item => item.id === 'curtain').burning, true);
  assert.equal(state.entities.find(item => item.id === 'unmarked').burning, undefined);
  assert.equal(result.damagedTreasure.length, 2);
  assert.equal(state.characters[0].gear[0].name, 'Rope');
});

test('failure loses Burning Hands; redirected mishaps use fire damage rather than Magic Missile damage', () => {
  const state = scene(), caster = state.characters[0];
  let first = true;
  const result = castBurningHands(state, caster, { rollCheck: check(1), random: () => first ? (first = false, (3 - .5) / 12) : .99 });
  assert.equal(result.mishaps[0].roll, 3);
  assert.equal(result.mishaps[0].damage, 6);
  assert.equal(caster.hp, 6);
  assert.equal(state.characters[1].hp, 6);
  assert.equal(state.entities[0].hp, 6);
  assert.deepEqual(caster.failedSpellKeys, ['burning hands']);
  assert.equal(caster.pendingSpell, undefined);
});
