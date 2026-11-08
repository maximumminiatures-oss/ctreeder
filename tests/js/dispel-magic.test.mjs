import test from 'node:test';
import assert from 'node:assert/strict';
import { castDispelMagic, resolveDispelMagic, dispelMagicOptions, dispelMagicPresentation } from '../../S3_content/src/dispel-magic.js';
import { listMagicEffects } from '../../S3_content/src/magic-effect-registry.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';

const check = roll => modifier => ({ roll, modifier, total: roll + modifier });
function scene() {
  const width = 28, height = 20;
  const state = { map: { width, height }, seed: 1, level: 3, rooms: [], halls: [], decor: {}, entities: [],
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', meta: {} })),
    visibility: { visibleNow: new Set(), exploredEver: new Set() },
    timers: { lightEverLit: true, torchElapsedMs: 0, torchDurationMs: 3600000 },
    characters: [{ id: 'wizard', name: 'Wizard', className: 'Wizard', level: 5, x: 4, y: 8,
      hp: 100, maxHitPoints: 100, stats: { INT: 14 }, gear: [], spellsKnown: 'Dispel Magic',
      lightSpellLit: true, lightSource: 'light-spell', lightRadius: 6,
      wizardEffects: [{ type: 'mage-armor', armorClass: 14, rounds: 10 }],
      faithEffects: [{ spell: 'shield of faith', bonus: 2, rounds: 5 }] },
      { id: 'ally', name: 'Ally', className: 'Fighter', x: 5, y: 8, hp: 20, maxHitPoints: 20, gear: [],
        conditions: { sleeping: { source: 'sleep', casterId: 'wizard' }, prone: true } }],
    activeCharacterId: 'wizard', player: { x: 4, y: 8, lightSource: 'light-spell', lightRadius: 6, torchLit: true } };
  recomputeVisibility(state); return state;
}
const caster = state => state.characters[0];
const cast = (state, roll = 11) => castDispelMagic(state, caster(state), { checkRoll: check(roll), random: () => .7 });
const chooseTarget = (state, targetId) => resolveDispelMagic(state, caster(state), { targetId });
const findEffect = (state, name) => dispelMagicOptions(state, caster(state)).find(effect => effect.spell?.toLowerCase() === name);

test('Dispel Magic uses DC 13 INT, records ordinary failure, and offers only the two approved initial critical choices', () => {
  const state = scene();
  assert.equal(cast(state, 10).succeeded, false);
  assert.ok(caster(state).failedSpellKeys.includes('dispel magic'));
  caster(state).failedSpellKeys = [];
  assert.equal(cast(state).succeeded, true);
  assert.equal(caster(state).pendingSpell.phase, 'targeting');
  resolveDispelMagic(state, caster(state), { dismiss: true });
  cast(state, 20);
  assert.deepEqual(dispelMagicPresentation(state, caster(state)).choices.map(choice => choice.key), ['effects', 'targets']);
  assert.throws(() => resolveDispelMagic(state, caster(state), { choice: 'range' }), /valid critical/);
});

test('selecting a visible target lists effects without changing them, and ending one preserves unrelated magic', () => {
  let state = scene(); cast(state); chooseTarget(state, 'wizard');
  assert.equal(caster(state).wizardEffects.length, 1);
  const effect = findEffect(state, 'mage armor'); assert.ok(effect);
  resolveDispelMagic(state, caster(state), { effectId: effect.id });
  assert.equal(caster(state).wizardEffects.length, 0);
  assert.equal(caster(state).faithEffects.length, 1);
  assert.equal(caster(state).lightSpellLit, true);
  assert.equal(caster(state).pendingSpell, null);
  state = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(caster(state).wizardEffects.length, 0, 'removed magic cannot reappear from a raw mirror');
});

test('dispel removes Sleep from only the chosen creature and leaves both creatures prone', () => {
  const state = scene();
  state.characters.push({ id: 'other-sleeper', hp: 20, x: 6, y: 8, conditions: { sleeping: { source: 'sleep', casterId: 'other' }, prone: true } });
  cast(state); chooseTarget(state, 'ally');
  const effect = findEffect(state, 'sleep'); assert.ok(effect);
  resolveDispelMagic(state, caster(state), { effectId: effect.id });
  assert.equal(state.characters[1].conditions.sleeping, undefined);
  assert.ok(state.characters[2].conditions.sleeping);
  assert.equal(state.characters[1].conditions.prone, true);
});

test('critical effects mode removes two selected effects from one target, never a different target', () => {
  const state = scene(); cast(state, 20);
  resolveDispelMagic(state, caster(state), { choice: 'effects' }); chooseTarget(state, 'wizard');
  resolveDispelMagic(state, caster(state), { effectId: findEffect(state, 'mage armor').id });
  assert.equal(caster(state).pendingSpell.remaining, 1);
  resolveDispelMagic(state, caster(state), { back: true });
  assert.throws(() => chooseTarget(state, 'ally'), /No eligible/);
  chooseTarget(state, 'wizard');
  resolveDispelMagic(state, caster(state), { effectId: findEffect(state, 'shield of faith').id });
  assert.equal(caster(state).pendingSpell, null);
});

test('critical targets mode requires two distinct targets, with one chosen effect removed from each', () => {
  const state = scene(); cast(state, 20);
  resolveDispelMagic(state, caster(state), { choice: 'targets' }); chooseTarget(state, 'wizard');
  resolveDispelMagic(state, caster(state), { effectId: findEffect(state, 'mage armor').id });
  assert.throws(() => chooseTarget(state, 'wizard'), /No eligible/);
  chooseTarget(state, 'ally');
  resolveDispelMagic(state, caster(state), { effectId: findEffect(state, 'sleep').id });
  assert.equal(caster(state).pendingSpell, null);
  assert.equal(caster(state).faithEffects.length, 1);
});

test('forged or stale effect IDs never remove a different effect or spend a pending use', () => {
  const state = scene(); cast(state); chooseTarget(state, 'wizard');
  assert.throws(() => resolveDispelMagic(state, caster(state), { effectId: '__proto__.wizardEffects' }), /no longer available/);
  const effect = findEffect(state, 'mage armor'); caster(state).wizardEffects = [];
  assert.throws(() => resolveDispelMagic(state, caster(state), { effectId: effect.id }), /no longer available/);
  assert.equal(caster(state).pendingSpell.remaining, 1);
  assert.equal(caster(state).faithEffects.length, 1);
});

test('targeting still requires circular Near6, illumination or perception, physical sight, and the same route', () => {
  const state = scene(); cast(state);
  assert.throws(() => resolveDispelMagic(state, caster(state), { x: 12, y: 8 }), /six squares/);
  assert.throws(() => resolveDispelMagic(state, caster(state), { x: 5, y: 8, routeId: 'lower' }), /same route/);
  state.tiles[8 * state.map.width + 5].type = 'wall';
  assert.throws(() => resolveDispelMagic(state, caster(state), { x: 6, y: 8 }), /line of sight/);
  assert.ok(listMagicEffects(state).length > 0);
});
