import test from 'node:test';
import assert from 'node:assert/strict';
import { rollTextSegments, damageRollSegments } from '../../S3_content/src/roll-history.js';

test('legacy explicit dice groups gain minimum and maximum colors without interpreting markup', () => {
  const parts = rollTextSegments('<img> Burning Hands: 2d6 = (1 + 6) = 7 damage.');
  assert.equal(parts.find(part => part.text === '1').minimum, true);
  assert.equal(parts.find(part => part.text === '6').maximum, true);
  assert.equal(parts.map(part => part.text).join(''), '<img> Burning Hands: 2d6 = (1 + 6) = 7 damage.');
});

test('structured checks replace a selected-only old roll with both advantage dice and one bold chosen die', () => {
  const parts = rollTextSegments('Mage casts: 1d20 = (20) +2 = 22.', { firstRoll: 1, secondaryRoll: 20, roll: 20, modifier: 2, total: 22 });
  assert.equal(parts.map(part => part.text).join(''), 'Mage casts: 2d20 = (1)(20) +2 = 22.');
  assert.equal(parts.find(part => part.text === '20').bold, true);
  assert.equal(parts.find(part => part.text === '1').minimum, true);
});

test('damage history exposes raw dice after removing expand, preserving modifiers and extremes', () => {
  const parts = damageRollSegments('Dagger', { expression: '1d4+2', terms: [{ type: 'die', value: 4, sign: 1, isMaximum: true }, { type: 'flat', value: 2, sign: 1 }], total: 6 });
  assert.equal(parts.map(part => part.text).join(''), 'Dagger\n1d4+2 = 4 + 2 = 6');
  assert.equal(parts.find(part => part.text === '4').maximum, true);
});
