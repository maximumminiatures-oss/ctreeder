import test from 'node:test';
import assert from 'node:assert/strict';
import { castMagicMissile, chooseMagicMissile, fireMagicMissile, dismissMagicMissiles } from '../../S3_content/src/magic-missile.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';

const caster = () => ({ id: 'wizard', name: 'Wizard', hp: 12, maxHitPoints: 12, stats: { INT: 14 }, gear: [] });
const enemy = id => ({ id, name: id, type: 'monster', hp: 20 });
const check = roll => modifier => ({ roll, modifier, total: roll + modifier, firstRoll: roll });
const targetOptions = { canTarget: () => true, random: () => .99 };

test('normal casting has advantage and casting bonuses, but waits for a target before dealing damage', () => {
  const wizard = caster(), foe = enemy('foe');
  wizard.bonuses = [{ bonusName: 'Plus1ToCastingSpells', bonusAmount: 1 }];
  let mode;
  const result = castMagicMissile({ characters: [wizard] }, wizard, { rollCheck: (modifier, options) => {
    mode = options;
    return check(12)(modifier);
  } });
  assert.equal(result.check.modifier, 3);
  assert.deepEqual(mode, { doubleRoll: true, disadvantage: false });
  assert.equal(foe.hp, 20);
  assert.equal(wizard.pendingSpell.remaining, 1);
  assert.equal(fireMagicMissile(wizard, foe, targetOptions).damage, 4);
  assert.equal(foe.hp, 16);
  assert.equal(wizard.pendingSpell, null);
  assert.equal(wizard.lastMagicMissile.spent.length, 1);
  assert.throws(() => fireMagicMissile(wizard, foe, targetOptions), /no Magic Missiles/);
});

test('critical A supports two sequential 1d4 missiles at the same or different targets', () => {
  for (const sameTarget of [true, false]) {
    const wizard = caster(), first = enemy('first'), second = sameTarget ? first : enemy('second');
    castMagicMissile({ characters: [wizard] }, wizard, { rollCheck: check(20) });
    assert.equal(wizard.pendingSpell.phase, 'critical');
    assert.throws(() => fireMagicMissile(wizard, first, targetOptions), /no Magic Missiles/);
    chooseMagicMissile(wizard, 'two-missiles');
    assert.equal(wizard.pendingSpell.remaining, 2);
    fireMagicMissile(wizard, first, targetOptions);
    assert.equal(wizard.pendingSpell.remaining, 1);
    assert.equal(wizard.pendingSpell.spent.length, 1);
    fireMagicMissile(wizard, second, targetOptions);
    assert.equal(first.hp, sameTarget ? 12 : 16);
    assert.equal(wizard.lastMagicMissile.spent.length, 2);
    assert.equal(wizard.pendingSpell, null);
  }
});

test('critical B is one 1d8 missile, not doubled damage, and choices cannot be switched', () => {
  const wizard = caster(), foe = enemy('foe');
  castMagicMissile({ characters: [wizard] }, wizard, { rollCheck: check(20) });
  assert.throws(() => chooseMagicMissile(wizard, 'double-dice'), /Choose/);
  chooseMagicMissile(wizard, 'one-d8');
  assert.throws(() => chooseMagicMissile(wizard, 'two-missiles'), /no critical/);
  assert.equal(fireMagicMissile(wizard, foe, targetOptions).damage, 8);
  assert.equal(foe.hp, 12);
});

test('invalid, hidden, allied, dead and defeated targets do not spend missiles or roll damage', () => {
  const wizard = caster(), foe = enemy('foe');
  castMagicMissile({ characters: [wizard] }, wizard, { rollCheck: check(12) });
  for (const target of [null, wizard, { ...foe, hp: 0 }, { ...foe, defeated: true }, { ...foe, leftPeacefully: true }]) {
    assert.throws(() => fireMagicMissile(wizard, target, targetOptions), /living enemy/);
  }
  assert.throws(() => fireMagicMissile(wizard, foe, { canTarget: () => false }), /visible/);
  assert.equal(foe.hp, 20);
  assert.equal(wizard.pendingSpell.remaining, 1);
  dismissMagicMissiles(wizard);
  assert.equal(wizard.pendingSpell, null);
  assert.throws(() => dismissMagicMissiles(wizard), /no Magic Missile/);
});

test('partial missiles and critical choices survive a save/load without refunding spent missiles', () => {
  const wizard = caster(), foe = enemy('foe');
  castMagicMissile({ characters: [wizard] }, wizard, { rollCheck: check(20) });
  chooseMagicMissile(wizard, 'two-missiles');
  fireMagicMissile(wizard, foe, targetOptions);
  const restored = hydrateDungeonState(serializeDungeonState({ characters: [wizard], player: {}, entities: [foe] }));
  assert.equal(restored.characters[0].pendingSpell.remaining, 1);
  assert.equal(restored.entities[0].hp, 16);
  fireMagicMissile(restored.characters[0], restored.entities[0], targetOptions);
  assert.equal(restored.entities[0].hp, 12);
});

test('failure loses the spell; only a kept natural one causes mishaps', () => {
  const wizard = caster(), state = { characters: [wizard] };
  const fail = castMagicMissile(state, wizard, { rollCheck: check(3) });
  assert.equal(fail.succeeded, false);
  assert.deepEqual(fail.mishaps, []);
  assert.deepEqual(wizard.failedSpellKeys, ['magic missile']);
  assert.throws(() => castMagicMissile(state, wizard), /unavailable/);
  wizard.failedSpellKeys = [];
  const mishap = castMagicMissile(state, wizard, { rollCheck: check(1), random: () => .1 });
  assert.equal(mishap.mishaps[0].roll, 2);
  assert.equal(wizard.hp, 11);
  assert.equal(wizard.pendingSpell, undefined);
});
