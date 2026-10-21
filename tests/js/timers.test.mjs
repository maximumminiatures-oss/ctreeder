import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTimers, syncElapsedTime, advanceTorchTime, hasLiveTimedLight, TORCH_DURATION_MS } from '../../S3_content/src/timers.js';
import { syncEquipmentLight, ensureEquipment } from '../../S3_content/src/equipment.js';
import { collectLightSources } from '../../S3_content/src/light-geometry.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';

test('an imported lit torch expires at one real hour without depending on UI/main cleanup', () => {
  const hero = { id: 'hero', hp: 10, maxHitPoints: 10, x: 2, y: 2, lightSource: 'torch', lightRadius: 6,
    gear: [{ name: 'Torch' }, { name: 'Torch' }], equipmentInitialized: false };
  ensureEquipment(hero);
  const state = { characters: [hero], entities: [], player: { x: 2, y: 2, torchLit: true, lightRadius: 6 }, timers: { lastTickAt: 1000 } };
  assert.equal(hasLiveTimedLight(state), true); assert.equal(collectLightSources(state).length, 1);
  assert.equal(syncElapsedTime(state, 1000 + TORCH_DURATION_MS - 1).expired, false);
  assert.equal(hero.lightRadius, 6);
  assert.equal(syncElapsedTime(state, 1000 + TORCH_DURATION_MS).expired, true);
  assert.equal(hero.lightRadius, 0); assert.equal(state.player.torchLit, false);
  assert.deepEqual(collectLightSources(state), []); assert.equal(hasLiveTimedLight(state), false);
  assert.equal(hero.gear.length, 1, 'only the burning torch is consumed');
  assert.equal(syncElapsedTime(state, 1000 + 2 * TORCH_DURATION_MS).expired, false);
  assert.equal(hero.gear.length, 1, 'unused torch never auto-lights or burns again');
  const restored = hydrateDungeonState(serializeDungeonState(state));
  ensureEquipment(restored.characters[0]); assert.equal(restored.characters[0].lightRadius, 0);
});

test('all held, covered, stowed and dropped burning lights expire together without spare oil or duplicate fuel consumption', () => {
  const hero = { id: 'hero', x: 2, y: 2, hp: 10, lightSpellLit: true, gear: [
    { name: 'Torch', lit: true, equipped: false }, { name: 'Torch', lit: false },
    { name: 'Lantern', lit: true, covered: true, equipped: true }, { name: 'Oil flask' }] };
  syncEquipmentLight(hero);
  const state = { characters: [hero], player: {}, entities: [
    { id: 'torch', subtype: 'dropped-equipment', lightSource: 'torch', lightRadius: 6, gearItem: { name: 'Torch', lit: true } },
    { id: 'lantern', subtype: 'dropped-equipment', lightSource: 'lantern', lightRadius: 12, gearItem: { name: 'Lantern', lit: true } }] };
  assert.equal(advanceTorchTime(state, TORCH_DURATION_MS).expired, true);
  assert.equal(hero.gear.filter(item => item.name === 'Torch').length, 1);
  assert.equal(hero.gear.find(item => item.name === 'Oil flask').name, 'Oil flask');
  assert.ok(hero.gear.every(item => !item.lit)); assert.equal(hero.lightSpellLit, false);
  assert.equal(state.entities.length, 1); assert.equal(state.entities[0].gearItem.lit, false);
  assert.equal(hasLiveTimedLight(state), false);
});

test('monster, item and stationary spell lights advance the shared timer even if no character holds a light', () => {
  for (const source of [{ type: 'monster', lightSpellLit: true, lightSource: 'light-spell', lightRadius: 6 },
    { subtype: 'spell-light', lightSpellLit: true, lightSource: 'light-spell', lightRadius: 6 },
    { subtype: 'dropped-equipment', gearItem: { name: 'Dagger', lightSpellLit: true } },
    { type: 'monster', gear: [{ name: 'Dagger', lightSpellLit: true }] }]) {
    const state = { characters: [], player: {}, entities: [{ id: 'source', x: 2, y: 2, ...source }], timers: { lastTickAt: 1000 } };
    assert.equal(hasLiveTimedLight(state), true);
    assert.equal(syncElapsedTime(state, 2000).expired, false); assert.equal(state.timers.torchElapsedMs, 1000);
    assert.equal(syncElapsedTime(state, 1000 + TORCH_DURATION_MS).expired, true);
    assert.equal(hasLiveTimedLight(state), false);
  }
});

test('a preview-only player light does not start a timer and darkness pauses an unfinished timer', () => {
  const state = { characters: [], entities: [], player: { torchLit: true, lightRadius: 6 }, timers: { lastTickAt: 1000, torchElapsedMs: 4000 } };
  assert.equal(ensureTimers(state).lightEverLit, false);
  assert.equal(syncElapsedTime(state, 2000).expired, false); assert.equal(state.timers.torchElapsedMs, 4000);
});
