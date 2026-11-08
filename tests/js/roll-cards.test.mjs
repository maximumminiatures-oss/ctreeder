import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckRollCard, rollTextSegments, damageRollSegments } from '../../S3_content/src/roll-history.js';
import { attackRollSegments } from '../../S3_content/src/combat-rules.js';

const text = parts => parts.map(part => part.text).join('');
const resultFlags = card => card.results.map(({ tooltip, ...result }) => result);
const attack = overrides => ({
  character: { id: 'dor', name: 'Dor' }, monster: { name: 'Orc' }, weapon: 'war hammer',
  roll: { firstRoll: 19, roll: 19, modifier: 2, total: 21 }, ability: 'STR', abilityModifier: 2,
  hit: true, damage: 4,
  damageRoll: { terms: [{ type: 'die', label: '1d6', value: 4, sign: 1 }] },
  ...overrides
});

test('check card helper is pure and accepts integration-owned labels and identity', () => {
  const check = { roll: 12, firstRoll: 12, modifier: -3, total: 9 };
  const before = structuredClone(check);
  const tooltip = [{ text: '1d20 = 12 -3 = 9' }];
  const card = createCheckRollCard(check, {
    heading: 'DEX', actorId: 'dor', actorName: 'Dor', type: 'Saving Throw', tooltip
  });
  assert.deepEqual(card, {
    heading: 'DEX', actorId: 'dor', actorName: 'Dor', type: 'Saving Throw',
    results: [{ value: 9, bold: true, minimum: false, maximum: false, tooltip }], damage: null
  });
  assert.deepEqual(check, before);
});

for (const [mode, values, selected, modifier, expected] of [
  ['advantage', [1, 20], 20, 4, [5, 24]],
  ['advantage', [20, 1], 20, -3, [17, -2]],
  ['disadvantage', [20, 1], 1, 4, [24, 5]],
  ['disadvantage', [1, 20], 1, -3, [-2, 17]]
]) {
  test(`${mode} card retains rolled order ${values} and adds modifier ${modifier} to each die`, () => {
    const roll = { firstRoll: values[0], secondaryRoll: values[1], roll: selected,
      modifier, total: selected + modifier, checkMode: mode };
    const parts = attackRollSegments(attack({ roll, hit: false }));
    const card = parts[0].rollCard;
    assert.deepEqual(resultFlags(card), values.map((value, index) => ({
      value: expected[index], bold: value === selected, minimum: value === 1, maximum: value === 20
    })));
    const tooltip = parts.find(part => part.tooltip).tooltip;
    for (const result of card.results) assert.strictEqual(result.tooltip, tooltip);
    assert.equal(card.damage, null);
  });
}

for (const mode of ['advantage', 'disadvantage']) {
  test(`${mode} ties select both card totals without changing legacy die emphasis`, () => {
    const check = { firstRoll: 20, secondaryRoll: 20, roll: 20, modifier: -2, total: 18, checkMode: mode };
    const parts = rollTextSegments('Mage casts: 1d20 = (20) -2 = 18.', check);
    assert.deepEqual(resultFlags(parts[0].rollCard), [
      { value: 18, bold: true, minimum: false, maximum: true },
      { value: 18, bold: true, minimum: false, maximum: true }
    ]);
    assert.equal(parts.filter(part => part.text === '20' && part.bold).length, 1);
    const attackParts = attackRollSegments(attack({ roll: check }));
    assert.deepEqual(resultFlags(attackParts[0].rollCard), resultFlags(parts[0].rollCard));
    assert.equal(attackParts.find(part => part.tooltip).tooltip.filter(part => part.die && part.bold).length, 1);
  });
}

test('structured text checks attach only metadata, leaving labels for main integration', () => {
  const check = { firstRoll: 1, secondaryRoll: 20, roll: 20, modifier: 2, total: 22 };
  const before = structuredClone(check);
  const parts = rollTextSegments('Mage casts: 1d20 = (20) +2 = 22.', check);
  const { rollCard, ...first } = parts[0];
  assert.deepEqual(first, { text: 'Mage casts: ' });
  assert.equal(text(parts), 'Mage casts: 2d20 = (1)(20) +2 = 22.');
  assert.deepEqual([rollCard.heading, rollCard.actorId, rollCard.actorName, rollCard.type, rollCard.damage],
    [null, null, null, null, null]);
  assert.equal(text(rollCard.results[0].tooltip), text(parts));
  assert.ok(rollCard.results[0].tooltip.every(part => !Object.hasOwn(part, 'rollCard')));
  assert.deepEqual(JSON.parse(JSON.stringify(parts)), parts);
  assert.deepEqual(check, before);
});

test('fallback checks retain full math, natural extremes, and the first empty segment', () => {
  const parts = rollTextSegments('', { roll: 1, modifier: 20, total: 21 });
  assert.equal(parts[0].text, '');
  assert.equal(text(parts), '\n1d20 = 1 +20 = 21');
  assert.deepEqual(resultFlags(parts[0].rollCard), [
    { value: 21, bold: true, minimum: true, maximum: false }
  ]);
  assert.equal(parts[0].rollCard.results[0].tooltip.at(-1).bold, true);
});

test('unstructured text and damage-only text do not infer a check card or interpret markup', () => {
  assert.deepEqual(rollTextSegments('<img>'), [{ text: '<img>' }]);
  const parts = rollTextSegments('<img> Burning Hands: 2d6 = (1 + 6) = 7 damage.');
  assert.equal(text(parts), '<img> Burning Hands: 2d6 = (1 + 6) = 7 damage.');
  assert.ok(parts.every(part => !Object.hasOwn(part, 'rollCard')));
  assert.equal(parts.find(part => part.text === '1').minimum, true);
  assert.equal(parts.find(part => part.text === '6').maximum, true);
});

test('attack card labels, actor identity, narrative and rich hover segments are preserved', () => {
  const input = attack(), before = structuredClone(input);
  const parts = attackRollSegments(input), card = parts[0].rollCard;
  assert.equal(card.heading, 'Warhammer');
  assert.equal(card.actorId, 'dor');
  assert.equal(card.actorName, 'Dor');
  assert.equal(card.type, 'Attack');
  assert.deepEqual(resultFlags(card), [{ value: 21, bold: true, minimum: false, maximum: false }]);
  assert.equal(text(parts), 'Dor attacks the orc with a warhammer.\n21 hits for 4 damage.');
  const { rollCard, ...legacyActor } = parts[0];
  assert.deepEqual(legacyActor, { text: 'Dor', bold: true, characterId: 'dor' });
  assert.equal(text(card.results[0].tooltip), '1d20 = 19 +2 STR = To hit: 21');
  assert.strictEqual(card.damage.tooltip, parts.find(part => part.text === '4').tooltip);
  assert.equal(text(card.damage.tooltip), 'Warhammer: 1-6 (4)');
  assert.deepEqual(card.damage, { value: 4, bold: true, minimum: false, maximum: false,
    tooltip: parts.find(part => part.text === '4').tooltip });
  assert.deepEqual(input, before);
  const restored = JSON.parse(JSON.stringify(parts))[0].rollCard;
  assert.deepEqual(resultFlags(restored), resultFlags(card));
  assert.equal(text(restored.damage.tooltip), text(card.damage.tooltip));
});

test('spell and unarmed headings preserve naming conventions and monster actor display names', () => {
  const spell = attackRollSegments(attack({ spell: 'Magic Missile' }))[0].rollCard;
  assert.equal(spell.heading, 'Magic Missile');
  assert.equal(spell.type, 'Spellcasting');
  const unarmed = attackRollSegments(attack({ weapon: null,
    character: { id: 'wasp', type: 'monster', name: 'Giant Wasp' } }))[0].rollCard;
  assert.equal(unarmed.heading, 'Unarmed Strike');
  assert.equal(unarmed.actorId, 'wasp');
  assert.equal(unarmed.actorName, 'Giant wasp');
});

test('attack cards reuse detailed stacked math and actual total modifiers', () => {
  const parts = attackRollSegments(attack({
    roll: { firstRoll: 14, secondaryRoll: 18, roll: 18, modifier: 8, total: 26, checkMode: 'advantage' },
    magic: 2, hiddenMagic: 1, backstab: true, advantageReason: 'sleep', damage: 12,
    damageRoll: { terms: [
      { type: 'die', label: '1d6', value: 6, sign: 1, isMaximum: true },
      { type: 'flat', value: 6, sign: 1 }
    ], multiplier: 2, resistance: 'fire' }
  }));
  const card = parts[0].rollCard;
  assert.deepEqual(card.results.map(result => result.value), [22, 26]);
  assert.equal(text(card.results[0].tooltip),
    'Advantage from sleep; 2d20 = (14)(18) +2 STR +2 magic +3 other = To hit: 26');
  assert.equal(text(card.damage.tooltip), 'Warhammer: 1d6 = (6) + 6 x2 / 2 (fire resistance) backstab = 12 damage');
  assert.equal(card.damage.bold, true);
  assert.equal(card.damage.maximum, true);
});

for (const [values, minimum, maximum] of [
  [[1, 1], true, false], [[6, 6], false, true], [[1, 6], false, false]
]) {
  test(`damage card extrema aggregate dice ${values} without counting flat modifiers`, () => {
    const parts = attackRollSegments(attack({ damage: values[0] + values[1] + 2,
      damageRoll: { terms: [
        ...values.map(value => ({ type: 'die', label: '1d6', sign: 1, value,
          isMinimum: value === 1, isMaximum: value === 6 })),
        { type: 'flat', value: 2, sign: 1 }
      ] }
    }));
    assert.equal(parts[0].rollCard.damage.minimum, minimum);
    assert.equal(parts[0].rollCard.damage.maximum, maximum);
    assert.equal(parts[0].rollCard.damage.bold, true);
  });
}

test('zero and flat-only damage remain bold, while misses and damage-free hits omit damage', () => {
  for (const damageRoll of [undefined, { terms: [{ type: 'flat', value: 0, sign: 1 }] }]) {
    const card = attackRollSegments(attack({ damage: 0, damageRoll }))[0].rollCard;
    assert.equal(card.damage.value, 0);
    assert.equal(card.damage.bold, true);
    assert.equal(card.damage.minimum, false);
    assert.equal(card.damage.maximum, false);
  }
  for (const overrides of [{ hit: false }, { damage: null }, { damage: undefined }]) {
    assert.equal(attackRollSegments(attack(overrides))[0].rollCard.damage, null);
  }
});

test('standalone damage cards preserve raw terms, signs, multiplier and legacy segments without mutating the roll', () => {
  const roll = { expression: '2d6-2', multiplier: 2, total: 10, terms: [
    { type: 'die', label: '1d6', value: 1, sign: 1, isMinimum: true, isMaximum: false },
    { type: 'die', label: '1d6', value: 6, sign: 1, isMinimum: false, isMaximum: true },
    { type: 'flat', value: 2, sign: -1 }
  ] };
  const before = structuredClone(roll), parts = damageRollSegments('Burning Hands', roll);
  const { rollCard, ...first } = parts[0];
  const legacy = [first, ...parts.slice(1)];
  assert.deepEqual(first, { text: 'Burning Hands\n2d6-2 = ' });
  assert.equal(text(parts), 'Burning Hands\n2d6-2 = 1 + 6 - 2 x2 = 10');
  assert.deepEqual(rollCard, {
    heading: 'Burning Hands', actorId: null, actorName: null, type: 'Damage', results: [],
    damage: { value: 10, bold: true, minimum: false, maximum: false, tooltip: legacy }
  });
  assert.notStrictEqual(rollCard.damage.tooltip[0], parts[0]);
  assert.equal(rollCard.damage.tooltip.find(part => part.text === '1').minimum, true);
  assert.equal(rollCard.damage.tooltip.find(part => part.text === '6').maximum, true);
  assert.ok(parts.slice(1).every(part => !Object.hasOwn(part, 'rollCard')));
  assert.ok(rollCard.damage.tooltip.every(part => !Object.hasOwn(part, 'rollCard')));
  assert.deepEqual(JSON.parse(JSON.stringify(parts)), parts);
  assert.deepEqual(roll, before);
});

for (const [values, minimum, maximum] of [
  [[1, 1], true, false], [[6, 6], false, true], [[1, 6], false, false]
]) {
  test(`standalone damage extrema use actual dice ${values}, not total or flat terms`, () => {
    const parts = damageRollSegments('Damage', { expression: '2d6-20', total: -20 + values[0] + values[1], terms: [
      ...values.map(value => ({ type: 'die', value, sign: 1, isMinimum: value === 1, isMaximum: value === 6 })),
      { type: 'flat', value: 20, sign: -1, isMinimum: true, isMaximum: true }
    ] });
    const damage = parts[0].rollCard.damage;
    assert.equal(damage.minimum, minimum);
    assert.equal(damage.maximum, maximum);
    assert.equal(damage.bold, true);
    assert.equal(damage.value, -20 + values[0] + values[1]);
  });
}

test('standalone flat-only or absent dice never mark extremes and retain zero damage and default heading', () => {
  for (const terms of [undefined, [], [{ type: 'flat', value: 0, sign: 1, isMinimum: true, isMaximum: true }]]) {
    const parts = damageRollSegments('', { expression: '0', total: 0, terms });
    assert.equal(parts[0].rollCard.heading, 'Damage');
    assert.equal(parts[0].rollCard.damage.value, 0);
    assert.equal(parts[0].rollCard.damage.bold, true);
    assert.equal(parts[0].rollCard.damage.minimum, false);
    assert.equal(parts[0].rollCard.damage.maximum, false);
  }
  const unflagged = damageRollSegments(null, { expression: '1d6', total: 3,
    terms: [{ type: 'die', value: 3, sign: 1 }] })[0].rollCard;
  assert.equal(unflagged.damage.minimum, false);
  assert.equal(unflagged.damage.maximum, false);
});
