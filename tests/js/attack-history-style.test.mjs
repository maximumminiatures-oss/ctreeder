import test from 'node:test';
import assert from 'node:assert/strict';
import { attackNarrative, attackRollSegments } from '../../S3_content/src/combat-rules.js';
import { formatRulesMessage } from '../../S3_content/src/rules-message.js';

const options = overrides => ({
  character: { id: 'dor', name: 'Dor', className: 'Fighter', colorValue: '#aa5533' },
  monster: { id: 'kragol', name: 'Kragol', partyMember: true }, weapon: 'Warhammer',
  roll: { roll: 19, firstRoll: 19, total: 21, modifier: 2 }, ability: 'STR', abilityModifier: 2,
  hit: true, damage: 4,
  damageRoll: { terms: [{ type: 'die', label: '1d6', value: 4, sign: 1 }] },
  ...overrides
});
const text = segments => segments.map(segment => segment.text).join('');

test('attack history uses sentence prose while preserving capitalized field labels and actor color identity', () => {
  const input = options(), before = structuredClone(input), parts = attackRollSegments(input);
  assert.equal(text(parts), 'Dor attacks Kragol with a warhammer.\n21 hits for 4 damage.');
  assert.deepEqual(parts[0], { text: 'Dor', bold: true, characterId: 'dor' });
  const hit = parts.find(part => part.text === '21'), damage = parts.find(part => part.text === '4');
  assert.equal(hit.bold, true); assert.equal(damage.bold, true);
  assert.equal(text(hit.tooltip), '1d20 = 19 +2 STR = To hit: 21');
  assert.equal(text(damage.tooltip), 'Warhammer: 1-6 (4)');
  assert.deepEqual(input, before);
});

test('misses, hits without damage, and zero damage are complete sentences', () => {
  assert.match(attackNarrative(options({ hit: false, damage: null })), /\n21 misses\.$/);
  assert.match(attackNarrative(options({ hit: true, damage: null })), /\n21 hits\.$/);
  assert.match(attackNarrative(options({ damage: 0 })), /\n21 hits for 0 damage\.$/);
  assert.match(attackNarrative(options({ hit: false, damage: 4 })), /\n21 misses\.$/);
});

test('split weapon spellings are joined in prose and title-cased only in field labels', () => {
  for (const [weapon, prose, label] of [['war hammer', 'warhammer', 'Warhammer'],
    ['RUSTY SHORT SWORD', 'rusty shortsword', 'Rusty Shortsword'], ['long bow', 'longbow', 'Longbow']]) {
    const parts = attackRollSegments(options({ weapon }));
    assert.ok(text(parts).includes(`with a ${prose}.`));
    assert.equal(parts.find(part => part.text === '4').tooltip[0].text, `${label}: `);
  }
});

test('disadvantage retains both dice, the chosen die, and minimum/maximum colors', () => {
  const parts = attackRollSegments(options({ hit: false, damage: null,
    roll: { roll: 1, firstRoll: 20, secondaryRoll: 1, total: 3, modifier: 2, checkMode: 'disadvantage' } }));
  assert.equal(text(parts), 'Dor attacks Kragol at disadvantage with a warhammer.\n3 misses.');
  const hover = parts.find(part => part.tooltip).tooltip;
  assert.match(text(hover), /^2d20 = \(20\)\(1\) \+2 STR/);
  assert.equal(hover.find(part => part.text === '20').maximum, true);
  assert.equal(hover.find(part => part.text === '1').minimum, true);
  assert.equal(hover.find(part => part.text === '1').bold, true);
});

test('backstabs retain all stacked weapon dice and their rich hover metadata', () => {
  const parts = attackRollSegments(options({ character: { id: 'thief', name: 'Shrigark' }, monster: { name: 'Stingbat' },
    weapon: 'Dagger', backstab: true, advantageReason: 'sleep', ability: 'DEX', abilityModifier: 3,
    roll: { roll: 18, firstRoll: 14, secondaryRoll: 18, total: 21, modifier: 3, checkMode: 'advantage' }, damage: 7,
    damageRoll: { terms: [
      { type: 'die', label: '1d4', value: 2, sign: 1 },
      { type: 'die', label: '1d4', value: 1, sign: 1, isMinimum: true },
      { type: 'die', label: '1d4', value: 4, sign: 1, isMaximum: true }
    ] } }));
  assert.equal(text(parts), 'Shrigark backstabs the stingbat with a dagger.\n21 hits for 7 damage.');
  const hovers = parts.filter(part => part.tooltip).map(part => part.tooltip);
  assert.match(text(hovers[0]), /^Advantage from sleep; 2d20 = \(14\)\(18\)/);
  assert.equal(text(hovers[1]), 'Dagger: 1d4 = (2) + 1d4 = (1) + 1d4 = (4) backstab = 7 damage');
  assert.equal(hovers[1].find(part => part.text === '1').minimum, true);
  assert.equal(hovers[1].find(part => part.text === '4').maximum, true);
});

test('aggregate damage colors still mark all-minimum and all-maximum weapon dice', () => {
  for (const maximum of [false, true]) {
    const value = maximum ? 6 : 1;
    const parts = attackRollSegments(options({ damage: value, damageRoll: { terms: [
      { type: 'die', label: '1d6', value, sign: 1, isMinimum: !maximum, isMaximum: maximum }
    ] } }));
    const damage = parts.find(part => part.text === String(value));
    assert.equal(damage.maximum, maximum); assert.equal(damage.minimum, !maximum);
  }
});

test('spell proper names and unique entities match plain-message casing without altering names or labels', () => {
  for (const metadata of [{ properName: true }, { isUnique: true }, { isNamed: true }, { unique: true },
    { metadata: { isUnique: true } }, { meta: { isUnique: true } },
    { metadata: { unique: true } }, { meta: { unique: true } }]) {
    const target = { id: 'foe', type: 'monster', name: 'Kragol', ...metadata };
    const narrative = attackNarrative(options({ monster: target }));
    assert.equal(narrative, 'Dor attacks Kragol with a warhammer.\n21 hits for 4 damage.');
    assert.equal(formatRulesMessage(narrative, { state: { characters: [options().character], entities: [target] } }), narrative);
  }
  for (const target of [{ name: 'Orc', metadata: { uniqueName: 'Kragol' } }, { name: 'Orc', meta: { uniqueName: 'Kragol' } }])
    assert.match(attackNarrative(options({ monster: target })), /^Dor attacks Kragol/);
  const spell = attackRollSegments(options({ monster: { name: 'Giant Wasp' }, spell: 'Magic Missile' }));
  assert.equal(text(spell), 'Dor attacks the giant wasp with Magic Missile.\n21 hits for 4 damage.');
  assert.equal(spell.find(part => part.text === '4').tooltip[0].text, 'Magic Missile: ');
  assert.match(attackNarrative(options({ character: { type: 'monster', name: 'Giant Wasp' } })), /^Giant wasp attacks Kragol/);
  assert.match(attackNarrative(options({ character: { type: 'monster', name: 'iKragol', isUnique: true } })), /^iKragol attacks/);
});
