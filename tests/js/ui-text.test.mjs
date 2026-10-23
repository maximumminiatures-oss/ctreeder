import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalWeaponSpelling, formatFieldName } from '../../S3_content/src/ui-text.js';

test('field names capitalize imported weapon spellings without changing their identity', () => {
  for (const name of ['warhammer', 'WARHAMMER', 'war hammer', 'war Hammer']) assert.equal(formatFieldName(name), 'Warhammer');
  assert.equal(formatFieldName('rusty short sword'), 'Rusty Shortsword');
  assert.equal(formatFieldName('+2 CROSSBOW'), '+2 Crossbow');
  assert.equal(formatFieldName('potion of healing II'), 'Potion of Healing II');
  assert.equal(formatFieldName('half-orc'), 'Half-Orc');
  assert.equal(formatFieldName('flint and steel'), 'Flint and Steel');
  assert.equal(formatFieldName(''), '');
});

test('weapon spelling canonicalization does not impose field capitalization on sentences', () => {
  assert.equal(canonicalWeaponSpelling('Dor attacks with a war hammer.'), 'Dor attacks with a warhammer.');
});
