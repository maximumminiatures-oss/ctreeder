import test from 'node:test';
import assert from 'node:assert/strict';
import { castEnergyProtection, resolveEnergyProtection, maintainEnergyProtection, syncEnergyProtection } from '../../S3_content/src/energy-protection.js';
import { elementalDamage } from '../../S3_content/src/elemental-effects.js';
import { listMagicEffects, endMagicEffect } from '../../S3_content/src/magic-effect-registry.js';

const actor = id => ({ id, name: id, hp: 10, maxHitPoints: 10, stats: { INT: 14 }, gear: [], raw: {}, x: 1, y: 1, className: 'Wizard' });
function scene() { const caster = actor('caster'), target = actor('target'); return { caster, target, state: { characters: [caster, target], entities: [], areaSpells: [], map: { width: 3, height: 3 }, tiles: [] } }; }
const roll = value => ({ checkRoll: () => ({ roll: value, total: value + 2 }) });
function apply(state, caster, target, energy = 'fire') {
  resolveEnergyProtection(state, caster, { option: energy });
  return resolveEnergyProtection(state, caster, { targetId: target.id }, { canTouch: () => true });
}

test('ordinary Protection From Energy grants immunity only to its selected type', () => {
  const { state, caster, target } = scene();
  assert.equal(castEnergyProtection(state, caster, roll(12)).succeeded, true);
  apply(state, caster, target);
  assert.equal(elementalDamage(target, 19, 'fire').total, 0);
  assert.equal(elementalDamage(target, 19, 'cold').total, 19);
  assert.equal(target.raw.spellEffects[0].focusId, caster.focusSpell.id);
  caster.focusSpell = null; syncEnergyProtection(state);
  assert.equal(elementalDamage(target, 19, 'fire').total, 19);
});

test('initial critical chooses two creatures or two distinct energies, never both', () => {
  for (const choice of ['targets', 'energies']) {
    const { state, caster, target } = scene();
    castEnergyProtection(state, caster, roll(20));
    resolveEnergyProtection(state, caster, { choice });
    if (choice === 'energies') {
      resolveEnergyProtection(state, caster, { option: 'fire' });
      assert.throws(() => resolveEnergyProtection(state, caster, { option: 'fire' }), /different/);
      apply(state, caster, target, 'lightning');
      assert.equal(elementalDamage(target, 5, 'electricity').total, 0);
      assert.equal(elementalDamage(target, 5, 'fire').total, 0);
      assert.equal(caster.pendingSpell, null);
    } else {
      apply(state, caster, target);
      assert.ok(caster.pendingSpell);
      resolveEnergyProtection(state, caster, { targetId: caster.id }, { canTouch: () => true });
      assert.equal(elementalDamage(caster, 5, 'fire').total, 0);
    }
  }
});

test('Focus twenties do not offer new choices; ordinary failure ends without losing spell', () => {
  const { state, caster, target } = scene();
  castEnergyProtection(state, caster, roll(12)); apply(state, caster, target);
  maintainEnergyProtection(state, caster, roll(20));
  assert.equal(caster.pendingSpell, null);
  assert.equal(caster.focusSpell.maxTargets, 1);
  maintainEnergyProtection(state, caster, roll(2));
  assert.equal(caster.focusSpell, null);
  assert.ok(!caster.failedSpellKeys?.includes('protection from energy'));
  assert.equal(elementalDamage(target, 8, 'fire').total, 8);
});

test('Dispel removes just one protected creature and retains the other', () => {
  const { state, caster, target } = scene();
  castEnergyProtection(state, caster, roll(20)); resolveEnergyProtection(state, caster, { choice: 'targets' });
  apply(state, caster, target);
  resolveEnergyProtection(state, caster, { targetId: caster.id }, { canTouch: () => true });
  const effects = listMagicEffects(state).filter(effect => effect.spell === 'protection from energy');
  assert.equal(effects.length, 2);
  endMagicEffect(state, effects.find(effect => effect.targetId === target.id).id);
  assert.equal(elementalDamage(target, 8, 'fire').total, 8);
  assert.equal(elementalDamage(caster, 8, 'fire').total, 0);
  assert.deepEqual(caster.focusSpell.targetIds, [caster.id]);
});

test('protection survives JSON save/load but disappears when its caster is dying', () => {
  const { state, caster, target } = scene();
  castEnergyProtection(state, caster, roll(12)); apply(state, caster, target, 'cold');
  const loaded = JSON.parse(JSON.stringify(state)); syncEnergyProtection(loaded);
  assert.equal(elementalDamage(loaded.characters[1], 7, 'frost').total, 0);
  loaded.characters[0].hp = 0; syncEnergyProtection(loaded);
  assert.equal(elementalDamage(loaded.characters[1], 7, 'frost').total, 7);
});
