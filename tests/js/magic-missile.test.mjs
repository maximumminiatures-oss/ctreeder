import test from 'node:test';
import assert from 'node:assert/strict';
import { castMagicMissile, chooseMagicMissile, fireMagicMissile, dismissMagicMissiles } from '../../S3_content/src/magic-missile.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { canAimAtSquare } from '../../S3_content/src/targeting.js';

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

function blindScene() {
  const wizard = { ...caster(), x: 2, y: 3, routeId: '' };
  const state = { map: { width: 20, height: 10 }, tiles: Array.from({ length: 200 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20), type: 'floor', meta: {} })),
    characters: [wizard], entities: [], player: { x: 2, y: 3 }, decor: {},
    visibility: { visibleNow: new Set(), exploredEver: new Set() }, combat: { active: true, actionUsed: true } };
  return { state, wizard };
}

test('a correct blind guess automatically damages a hidden monster once without another casting check or action', () => {
  const { state, wizard } = blindScene();
  const hidden = { ...enemy('hidden'), x: 6, y: 3, routeId: '', stealthed: true, invisibility: { rounds: 3 }, I: 0 };
  state.entities.push(hidden); castMagicMissile(state, wizard, { rollCheck: check(12) });
  let rolls = 0;
  assert.equal(canAimAtSquare(state, wizard, { x: 6, y: 3 }, 12), true);
  assert.equal(wizard.pendingSpell.spent.length, 0, 'aiming does not expose an identity or consume a missile');
  const result = fireMagicMissile(wizard, { x: 6, y: 3, blind: true }, { state, canTarget: () => false, random: () => { rolls++; return .99; } });
  assert.equal(result.damage, 4); assert.equal(result.hit, true); assert.equal(result.targetId, hidden.id);
  assert.equal(result.guessedMonster, hidden); assert.equal(result.guessedMonster.I, 0);
  assert.equal(hidden.hp, 16); assert.equal(rolls, 1); assert.equal(state.combat.actionUsed, true);
  assert.equal(wizard.pendingSpell, null);
  assert.throws(() => fireMagicMissile(wizard, { x: 6, y: 3, blind: true }, { state }), /no Magic Missiles/);
});

test('an empty blind guess consumes one missile, rolls no damage and reveals no other hidden monster', () => {
  const { state, wizard } = blindScene(), hidden = { ...enemy('elsewhere'), x: 7, y: 3, routeId: '', stealthed: true };
  state.entities.push(hidden); castMagicMissile(state, wizard, { rollCheck: check(20) }); chooseMagicMissile(wizard, 'two-missiles');
  const result = fireMagicMissile(wizard, { x: 6, y: 3, blind: true }, { state, random: () => { throw new Error('must not roll'); } });
  assert.equal(result.hit, false); assert.equal(result.damage, 0); assert.equal(result.targetId, null); assert.equal(result.guessedMonster, null);
  assert.equal(hidden.hp, 20); assert.equal(wizard.pendingSpell.remaining, 1);
  assert.equal(wizard.pendingSpell.spent[0].targetId, null);
  const hit = fireMagicMissile(wizard, { x: 7, y: 3, blind: true }, { state, random: () => 0 });
  assert.equal(hit.damage, 1); assert.equal(wizard.pendingSpell, null);
});

test('blind guesses obey Far 12, clear walls and doors, integer coordinates and route validation without spending invalid shots', () => {
  const { state, wizard } = blindScene(); castMagicMissile(state, wizard, { rollCheck: check(12) });
  for (const square of [{ x: 15, y: 3 }, { x: 14, y: 4 }, { x: -1, y: 3 }, { x: 3.5, y: 3 }, { x: 4, y: 3, routeId: 'lower' }])
    assert.throws(() => fireMagicMissile(wizard, { ...square, blind: true }, { state }), /Pick a square/);
  state.tiles[3 * 20 + 4].type = 'wall';
  assert.throws(() => fireMagicMissile(wizard, { x: 6, y: 3, blind: true }, { state }), /clear line/);
  state.tiles[3 * 20 + 4].type = 'floor';
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', internal: true, x: 4, y: 3, orientation: 'vertical', doorState: 'closed' });
  assert.throws(() => fireMagicMissile(wizard, { x: 6, y: 3, blind: true }, { state }), /clear line/);
  assert.equal(wizard.pendingSpell.remaining, 1); assert.equal(wizard.pendingSpell.spent.length, 0);
});

test('blind resolution never hits a stacked monster on another floor and does not leak its identity', () => {
  const { state, wizard } = blindScene();
  state.underpasses = [{ id: 'lower', artVersion: 2, lowerCells: [{ x: 4, y: 3 }, { x: 5, y: 3 }],
    upperCrossings: [{ x: 4, y: 3 }, { x: 5, y: 3 }], portals: [], art: [] }];
  const lower = { ...enemy('lower-enemy'), x: 5, y: 3, routeId: 'lower' }; state.entities.push(lower);
  castMagicMissile(state, wizard, { rollCheck: check(12) });
  const miss = fireMagicMissile(wizard, { x: 5, y: 3, blind: true }, { state });
  assert.equal(miss.hit, false); assert.equal(miss.guessedMonster, null); assert.equal(lower.hp, 20);
  const upper = { ...enemy('upper-enemy'), x: 5, y: 3, routeId: '' }; state.entities.push(upper);
  castMagicMissile(state, wizard, { rollCheck: check(12) });
  const hit = fireMagicMissile(wizard, { x: 5, y: 3, blind: true }, { state, random: () => .99 });
  assert.equal(hit.guessedMonster, upper); assert.equal(upper.hp, 16); assert.equal(lower.hp, 20);
});

test('a blind square still requires authoritative state and direct target validation remains unchanged', () => {
  const { state, wizard } = blindScene(), hidden = { ...enemy('foe'), x: 5, y: 3 };
  castMagicMissile(state, wizard, { rollCheck: check(12) });
  assert.throws(() => fireMagicMissile(wizard, { x: 5, y: 3, blind: true }, targetOptions), /Pick a square/);
  assert.throws(() => fireMagicMissile(wizard, hidden, { state, canTarget: () => false }), /visible/);
  assert.equal(wizard.pendingSpell.remaining, 1);
});
