import test from 'node:test';
import assert from 'node:assert/strict';
import { rollWizardMishaps, hasWizardEffect, processWizardTurn, advanceWizardTime, wizardCastingMode,
  spellLockRemaining, recoverWizardSpells, SPELL_WEEK_MS, isLightSuppressedAt } from '../../S3_content/src/wizard-mishaps.js';
import { collectLightSources } from '../../S3_content/src/light-geometry.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';

function scene() {
  return { characters: [{ id: 'wizard', name: 'Wizard', hp: 20, maxHitPoints: 20, stats: { CON: 14 }, x: 6, y: 4,
    gear: [{ name: 'Torch', lit: true, equipped: true, quantity: 2 }], failedSpellKeys: ['magic missile'], lightRadius: 6 },
  { id: 'friend', name: 'Friend', hp: 10, maxHitPoints: 10, x: 3, y: 4, gear: [] }], player: {}, entities: [] };
}
function mishap(state, number, rest = .99) {
  let first = true;
  return rollWizardMishaps(state, state.characters[0], 'Magic Missile', {
    random: () => { if (first) { first = false; return (number - .5) / 12; } return rest; },
    knownSpells: ['Magic Missile', 'Light', 'Sleep']
  });
}

test('devastation applies two table effects without recursive devastation', () => {
  const state = scene();
  const results = rollWizardMishaps(state, state.characters[0], 'Magic Missile', { random: () => 0 });
  assert.deepEqual(results.map(result => result.roll), [1, 2, 2]);
  assert.equal(state.characters[0].hp, 18);
});

test('explosion, refraction and slipped hand inflict actual damage on the correct character', () => {
  for (const [number, expected] of [[2, [12, 10]], [3, [16, 10]], [4, [20, 6]]]) {
    const state = scene();
    mishap(state, number);
    assert.deepEqual(state.characters.map(character => character.hp), expected);
  }
  const state = scene(); state.characters.length = 1;
  assert.match(mishap(state, 4)[0].detail, /No ally/);
});

test('mind wound requires a week of game time plus successful rest in either order', () => {
  for (const restFirst of [true, false]) {
    const state = scene(), wizard = state.characters[0];
    mishap(state, 5);
    assert.equal(spellLockRemaining(wizard, 'Magic Missile'), SPELL_WEEK_MS);
    if (restFirst) recoverWizardSpells(wizard);
    advanceWizardTime(state, SPELL_WEEK_MS - 1);
    assert.deepEqual(wizard.failedSpellKeys, ['magic missile']);
    advanceWizardTime(state, 1);
    if (!restFirst) {
      assert.deepEqual(wizard.failedSpellKeys, ['magic missile']);
      recoverWizardSpells(wizard);
    }
    assert.deepEqual(wizard.failedSpellKeys, []);
  }
});

test('discorporation removes one real gear unit, including its equipped/lit state', () => {
  const state = scene(), wizard = state.characters[0];
  mishap(state, 6);
  assert.equal(wizard.gear[0].quantity, 1);
  assert.equal(wizard.gear[0].lit, false);
  assert.equal(wizard.gear[0].equipped, false);
  mishap(state, 6);
  assert.deepEqual(wizard.gear, []);
  assert.match(mishap(state, 6)[0].detail, /no gear/);
});

test('spell worm loses a random spell each turn until DC12 CON passes; losses persist until rest', () => {
  const state = scene(), wizard = state.characters[0];
  mishap(state, 7);
  const check = total => () => ({ total, roll: total - 2, modifier: 2 });
  assert.match(processWizardTurn(wizard, ['Light'], { check: check(11), random: () => 0 }), /failed/);
  assert.equal(hasWizardEffect(wizard, 'spell-worm'), true);
  assert.match(processWizardTurn(wizard, ['Sleep'], { check: check(12), random: () => 0 }), /passed/);
  assert.equal(hasWizardEffect(wizard, 'spell-worm'), false);
  assert.deepEqual(wizard.failedSpellKeys, ['magic missile', 'light', 'sleep']);
  recoverWizardSpells(wizard);
  assert.deepEqual(wizard.failedSpellKeys, []);
});

test('harmonic failure loses a random known spell', () => {
  const state = scene();
  mishap(state, 8);
  assert.deepEqual(state.characters[0].failedSpellKeys, ['magic missile', 'sleep']);
});

test('suppression follows the caster, includes dropped and magical sources, and ends after ten rounds', () => {
  const state = scene(), wizard = state.characters[0];
  state.characters[1].lightRadius = 6;
  state.entities.push({ subtype: 'dropped-equipment', x: 5, y: 4, lightRadius: 6 });
  mishap(state, 9);
  assert.equal(collectLightSources(state).length, 0);
  wizard.x = 20;
  assert.equal(isLightSuppressedAt(state, 20, 4), true);
  assert.equal(isLightSuppressedAt(state, 6, 4), false);
  assert.equal(collectLightSources(state).length, 2);
  advanceWizardTime(state, 90000, { rounds: 9 });
  assert.equal(hasWizardEffect(wizard, 'light-suppression'), true);
  advanceWizardTime(state, 10000, { rounds: 1 });
  assert.equal(hasWizardEffect(wizard, 'light-suppression'), false);
  assert.equal(collectLightSources(state).length, 3);
});

test('outside lights cannot reveal tiles within suppression or leak them into explored history', () => {
  const state = scene();
  state.map = { width: 24, height: 9 };
  state.tiles = Array.from({ length: 216 }, (_, i) => ({ x: i % 24, y: Math.floor(i / 24), type: 'floor' }));
  state.rooms = [];
  state.visibility = { visibleNow: new Set(), exploredEver: new Set(), visitedRoomIds: new Set() };
  state.characters[0].x = 9;
  state.characters[1].x = 18; state.characters[1].lightRadius = 6;
  mishap(state, 9);
  recomputeVisibility(state);
  assert.equal(state.visibility.visibleNow.has('14,4'), false);
  assert.equal(state.visibility.exploredEver.has('14,4'), false);
  assert.equal(state.visibility.visibleNow.has('18,4'), true);
});

test('screaming checks each of exactly three rounds; glow and instability last ten rounds', () => {
  const state = scene(), wizard = state.characters[0];
  for (const number of [10, 11, 12]) mishap(state, number);
  let checks = 0;
  advanceWizardTime(state, 100000, { rounds: 10, onScream: () => checks++ });
  assert.equal(checks, 3);
  assert.equal(hasWizardEffect(wizard, 'purple-glow'), false);
  assert.equal(hasWizardEffect(wizard, 'unstable'), false);
});

test('instability cancels innate Magic Missile advantage, affects only the same tier, and persists in saves', () => {
  const state = scene();
  mishap(state, 12);
  const restored = hydrateDungeonState(serializeDungeonState(state)).characters[0];
  assert.deepEqual(wizardCastingMode(restored, 1, true), { doubleRoll: false, disadvantage: false });
  assert.deepEqual(wizardCastingMode(restored, 1, false), { doubleRoll: false, disadvantage: true });
  assert.deepEqual(wizardCastingMode(restored, 2, true), { doubleRoll: true, disadvantage: false });
});
