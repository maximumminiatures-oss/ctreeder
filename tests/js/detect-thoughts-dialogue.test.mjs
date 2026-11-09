import test from 'node:test';
import assert from 'node:assert/strict';
import { monsterThought, DEAD_VERBS, DEAD_NOUNS } from '../../S3_content/src/dead-dialogue.js';
import { castFocusedSpell, resolveFocusedSpell, maintainTierTwoFocus, detectThoughtsModifiers } from '../../S3_content/src/wizard-tier-two-focus.js';

const sequence = (...values) => () => values.shift() ?? 0;
const fractionFor = (entries, text) => {
  const index = entries.findIndex(entry => entry.text === text);
  return (entries.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0) + entries[index].weight / 2) /
    entries.reduce((sum, entry) => sum + entry.weight, 0);
};
const checkRoll = modifier => ({ roll: 12, total: 12 + modifier, modifier });

function scene() {
  const caster = { id: 'wizard', name: 'Badzog', className: 'Wizard', hp: 20, stats: { INT: 14 }, raw: {} };
  const target = { id: 'foe', name: 'Wasp, Giant', type: 'monster', hp: 10, W: 0 };
  const state = { characters: [caster], entities: [target] };
  castFocusedSpell(state, caster, 'detect thoughts', { checkRoll });
  return { state, caster, target };
}

test('all six authored thought patterns reuse weighted vocabulary and format ordinary monster names', () => {
  const expected = [
    'The giant wasp is thinking about when it hated my personality.',
    'I wonder if my personality hated my personality.',
    'I think those adventurers hated my personality.',
    'Personality is my personality.',
    'I just wish I had some of my personality.',
    'By my personality and my personality I will show those fools!'
  ];
  for (let index = 0; index < expected.length; index++) {
    assert.equal(monsterThought({}, { name: 'Wasp, Giant' }, { rng: sequence((index + .5) / 6) }), expected[index]);
  }
  assert.equal(monsterThought({}, { name: 'Kragol', isNamed: true }, { rng: () => 0 }),
    'The Kragol is thinking about when it hated my personality.');
});

test('thought words preserve dynamic plurals and expand gift verbs without leaking placeholders', () => {
  const noun = fractionFor(DEAD_NOUNS, '[class_name]s');
  assert.equal(monsterThought({}, { name: 'Bandit' }, { classes: ['Thief'],
    rng: sequence(4.5 / 6, 0, noun, 0) }), 'I just wish I had some of my thieves.');
  assert.equal(monsterThought({}, { name: 'Bandit' }, {
    rng: sequence(2.5 / 6, fractionFor(DEAD_VERBS, 'gave a [noun] to'), fractionFor(DEAD_NOUNS, 'chair'), 0, 0)
  }), 'I think those adventurers gave a chair to my personality.');
});

test('each insight dialogue has an exact 50 percent flavor boundary', () => {
  let nonUseful = 0;
  for (let index = 0; index < 100; index++) {
    const { state, caster, target } = scene();
    const result = resolveFocusedSpell(state, caster, { targetId: target.id, canTarget: () => true,
      random: sequence(index / 100) });
    if (result.dialogs[0].nonUseful) nonUseful++;
    assert.equal(result.dialogs[0].nonUseful, index < 50);
  }
  assert.equal(nonUseful, 50);
});

test('flavor thoughts preserve bonuses, one Luck Token per casting, Focus and resistance timing', () => {
  const { state, caster, target } = scene();
  let luck = 0;
  const options = { checkRoll, random: () => 0, grantLuck: () => luck++ };
  const first = resolveFocusedSpell(state, caster, { ...options, targetId: target.id, canTarget: () => true });
  assert.ok(first.dialogs[0].nonUseful);
  const second = maintainTierTwoFocus(state, caster, options);
  assert.ok(second.dialogs[0].nonUseful);
  assert.deepEqual(detectThoughtsModifiers(state, caster, target), { armorClass: 1, attack: 1, damage: 1 });
  const restored = JSON.parse(JSON.stringify(state)), restoredCaster = restored.characters[0];
  const third = maintainTierTwoFocus(restored, restoredCaster, options);
  assert.ok(third.dialogs[0].nonUseful);
  assert.equal(luck, 1);
  const damage = maintainTierTwoFocus(restored, restoredCaster, { reason: 'damage', checkRoll,
    random: () => assert.fail('A distraction check must not read new thoughts.') });
  assert.deepEqual(damage.dialogs, []);
  assert.equal(restoredCaster.focusSpell.focusedRounds, 3);
  assert.deepEqual(maintainTierTwoFocus(restored, restoredCaster, options).dialogs, []);
  assert.equal(luck, 1);
});

test('useful thoughts retain natural articles and proper names', () => {
  for (const [name, extra, expected] of [['Oni', {}, 'an oni'], ['Kragol', { isNamed: true }, 'Kragol']]) {
    const { state, caster, target } = scene();
    Object.assign(target, { name, ...extra });
    const result = resolveFocusedSpell(state, caster, { targetId: target.id, canTarget: () => true, random: () => .5 });
    assert.equal(result.dialogs[0].text, `You peer into the mind of ${expected} and learn some interesting stuff.`);
  }
});
