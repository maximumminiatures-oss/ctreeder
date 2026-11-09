import test from 'node:test';
import assert from 'node:assert/strict';
import { DAMAGE_TYPES, normalizeDamageType, matchingDamageTypes } from '../../S3_content/src/damage-types.js';
import { ELEMENTS, matchingElements, elementalDamage } from '../../S3_content/src/elemental-effects.js';

test('damage tags normalize energy aliases without conflating sound and electricity', () => {
  assert.equal(normalizeDamageType('Electricity'), 'lightning');
  assert.equal(normalizeDamageType('sound'), 'thunder');
  assert.equal(normalizeDamageType('holy'), 'radiant');
  assert.equal(normalizeDamageType('magic'), 'force');
  assert.deepEqual(matchingDamageTypes('Thunder damage'), ['thunder']);
  assert.deepEqual(matchingDamageTypes('A thunderbolt'), ['lightning']);
  assert.deepEqual(matchingDamageTypes({ damageType: 'fire', name: 'Cold-shaped illusion' }), ['fire']);
  assert.equal(DAMAGE_TYPES.length, 13);
});

test('existing random treasure elements and elemental resistance retain their contracts', () => {
  assert.deepEqual(ELEMENTS, ['lightning', 'fire', 'cold', 'acid', 'poison']);
  assert.deepEqual(matchingElements('frost and venom'), ['cold', 'poison']);
  const actor = { gear: [{ equipped: true, magic: { resistance: 'electricity' } }] };
  assert.equal(elementalDamage(actor, 7, 'lightning').total, 3);
  assert.equal(elementalDamage(actor, 7, 'sound').total, 7);
  actor.gear[0].magic.resistance = 'thunder';
  assert.equal(elementalDamage(actor, 7, { damageType: 'sound' }).total, 3);
});
