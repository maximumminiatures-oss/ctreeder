import test from 'node:test';
import assert from 'node:assert/strict';
import { castCureWounds, resolveCureWounds, canTouchCharacter, cureWoundsDiceCount, priestCastingBonus } from '../../S3_content/src/spell-effects.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

function scene() {
  const caster = { id: 'priest', name: 'Priest', className: 'Priest', level: 1, stats: { WIS: 14 }, hp: 3, maxHitPoints: 10, x: 2, y: 2, gear: [] };
  const target = { id: 'friend', name: 'Friend', hp: 0, maxHitPoints: 20, dyingRounds: 3, x: 3, y: 3, gear: [] };
  return { seed: 1, map: { width: 7, height: 7 }, characters: [caster, target], tiles: Array.from({ length: 49 }, (_, i) => ({ x: i % 7, y: Math.floor(i / 7), type: 'floor' })), entities: [], rooms: [], player: { x: 2, y: 2 }, visibility: {} };
}
const check = roll => modifier => ({ roll, total: roll + modifier, modifier, firstRoll: roll });

test('healing scales from caster level and restores dying allies without overhealing', () => {
  const state = scene(), [caster, target] = state.characters;
  assert.deepEqual([1,2,3,4,10].map(level => cureWoundsDiceCount({ level })), [1,2,2,3,6]);
  const result = castCureWounds(state, caster, target.id, { rollCheck: check(12), random: () => .99 });
  assert.equal(result.healing.healed, 6);
  assert.equal(target.hp, 6);
  assert.equal(target.dyingRounds, 0);
  target.hp = 19;
  assert.equal(castCureWounds(state, caster, target.id, { rollCheck: check(12), random: () => .99 }).healing.healed, 1);
});

test('self and diagonal touch work but walls, doors, distant and dead targets do not', () => {
  const state = scene(), [caster, target] = state.characters;
  assert.equal(canTouchCharacter(state, caster, caster), true);
  assert.equal(canTouchCharacter(state, caster, target), true);
  state.tiles[2 * 7 + 3].type = 'wall';
  assert.equal(canTouchCharacter(state, caster, target), false);
  state.tiles[2 * 7 + 3].type = 'floor';
  target.y = 2;
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 3, y: 2, doorState: 'closed' });
  assert.throws(() => castCureWounds(state, caster, target.id), /touch range/);
  state.entities = [];
  target.x = 5;
  assert.throws(() => castCureWounds(state, caster, target.id), /touch range/);
  target.x = 3; target.dead = true;
  assert.throws(() => castCureWounds(state, caster, target.id), /living or dying/);
  assert.equal(target.hp, 0);
});

test('failed casts heal nothing; natural one records penance even with a huge modifier', () => {
  const state = scene(), [caster, target] = state.characters;
  const outcome = castCureWounds(state, caster, target.id, { rollCheck: check(2) });
  assert.equal(outcome.succeeded, false);
  assert.equal(target.hp, 0);
  assert.deepEqual(caster.failedSpellKeys, ['cure wounds']);
  caster.failedSpellKeys = [];
  castCureWounds(state, caster, target.id, { rollCheck: () => ({ roll: 1, total: 101, modifier: 100 }) });
  assert.deepEqual(caster.spellPenance, { 'cure wounds': { paid: false } });
});

test('critical healing waits for a persisted choice and cannot be replayed or rerolled', () => {
  for (const choice of ['double-dice', 'double-total']) {
    let state = scene(), [caster, target] = state.characters;
    const result = castCureWounds(state, caster, target.id, { rollCheck: check(20) });
    assert.equal(result.critical, true);
    assert.equal(target.hp, 0);
    assert.throws(() => castCureWounds(state, caster, target.id), /pending/);
    state = hydrateDungeonState(serializeDungeonState(state));
    [caster, target] = state.characters;
    assert.throws(() => resolveCureWounds(state, caster, 'made-up'), /Choose/);
    const healing = resolveCureWounds(state, caster, choice, () => .99);
    assert.equal(healing.total, 12);
    assert.equal(healing.rolls.length, choice === 'double-dice' ? 2 : 1);
    assert.equal(target.hp, 12);
    assert.equal(caster.pendingSpell, null);
    assert.throws(() => resolveCureWounds(state, caster, choice), /no critical/);
  }
});

test('dead targets cannot be resurrected while a critical choice is pending', () => {
  const state = scene(), [caster, target] = state.characters;
  castCureWounds(state, caster, target.id, { rollCheck: check(20) });
  target.dead = true;
  assert.match(resolveCureWounds(state, caster, 'double-total').message, /cannot resurrect/);
  assert.equal(target.hp, 0);
  assert.equal(caster.pendingSpell, null);
});

test('imported spellcasting bonuses contribute without unrelated or wizard bonuses', () => {
  assert.equal(priestCastingBonus({ bonuses: [
    { bonusName: 'Plus1ToCastingSpells', bonusTo: 'Spellcasting', bonusAmount: 1 },
    { bonusName: 'Spellcasting', bonusTo: '+2 priest spellcasting' },
    { bonusName: 'Spellcasting', bonusTo: '+3 wizard spellcasting' },
    { bonusName: 'Attacks', bonusAmount: 5 }
  ] }), 3);
  assert.equal(priestCastingBonus({levels:[{level:1,talentRolledName:'Spellcasting',talentRolledDesc:'+1 to priest spellcasting checks'}]}),1);
  assert.equal(priestCastingBonus({levels:[{level:1,talentRolledName:'Spellcasting',talentRolledDesc:'+1 to priest spellcasting checks'}],
    bonuses:[{sourceType:'Class',gainedAtLevel:1,bonusName:'Spellcasting',bonusTo:'+1 priest spellcasting'}]}),1);
});
