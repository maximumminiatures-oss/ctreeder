import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlind, conditionAttackMode, conditionAllowsBackstab } from '../../S3_content/src/conditions.js';
import { hasDarkvision, darkvisionObservers, canSeeWithDarkvision, collectDarkvisionTiles, partyDarkvisionReveals } from '../../S3_content/src/darkvision.js';
import { isFeatureCurrentlyVisible, isMonsterCurrentlyVisible, isMonsterTileIlluminated, monsterCanSeeTarget, monsterCanAmbush } from '../../S3_content/src/monster-perception.js';
import { collectLightSources } from '../../S3_content/src/light-geometry.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

function scene() {
  const hero = { id: 'hero', hp: 10, x: 1, y: 3, lightRadius: 6, conditions: {} };
  const monster = { id: 'foe', type: 'monster', name: 'Orc', hp: 8, x: 4, y: 3, conditions: {} };
  const treasure = { id: 'loot', type: 'treasure', x: 4, y: 3, visible: true };
  const state = { map: { width: 16, height: 8 },
    tiles: Array.from({ length: 128 }, (_, i) => ({ x: i % 16, y: Math.floor(i / 16), type: 'floor' })),
    characters: [hero], entities: [monster, treasure], rooms: [], player: { x: 1, y: 3 },
    visibility: { visibleNow: new Set(['4,3']), exploredEver: new Set(['4,3']) } };
  return { state, hero, monster, treasure };
}

test('canonical blind condition grants melee and ranged advantage, with normal cancellation', () => {
  const target = { conditions: { blind: { source: 'blind/deafen', casterId: 'priest' } } };
  assert.equal(isBlind(target), true);
  assert.equal(conditionAllowsBackstab(target), true);
  for (const melee of [true, false]) {
    assert.deepEqual(conditionAttackMode(target, { melee, close: false }), { doubleRoll: true, disadvantage: false });
    assert.deepEqual(conditionAttackMode(target, { melee, disadvantage: true }), { doubleRoll: false, disadvantage: false });
  }
  target.conditions.blind = false;
  assert.equal(isBlind(target), false);
  assert.deepEqual(conditionAttackMode(target), { doubleRoll: false, disadvantage: false });
});

test('deafness alone does not disable sight or grant attack advantage', () => {
  const { state, hero, monster, treasure } = scene();
  hero.conditions.deaf = { source: 'blind/deafen' };
  assert.equal(isBlind(hero), false);
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
  assert.equal(isFeatureCurrentlyVisible(state, treasure), true);
  assert.deepEqual(conditionAttackMode(hero), { doubleRoll: false, disadvantage: false });
});

test('blind human cannot see illuminated monsters or features, even as an explicit viewer', () => {
  const { state, hero, monster, treasure } = scene();
  hero.conditions.blind = true;
  for (const options of [{}, { viewer: hero }]) {
    assert.equal(isMonsterCurrentlyVisible(state, monster, options), false);
    assert.equal(isFeatureCurrentlyVisible(state, treasure, options), false);
  }
});

test('blindness blocks darkvision without removing the intrinsic capability', () => {
  const { state, hero, monster } = scene();
  hero.companion = { kind: 'friendly' };
  assert.equal(canSeeWithDarkvision(state, hero, monster), true);
  hero.conditions.blind = { source: 'blind/deafen' };
  assert.equal(hasDarkvision(hero), true);
  assert.deepEqual(darkvisionObservers(state), []);
  assert.equal(canSeeWithDarkvision(state, hero, monster, { hasLineOfSight: () => true }), false);
  assert.equal(partyDarkvisionReveals(state, monster), false);
  assert.deepEqual(collectDarkvisionTiles(state), []);
  delete hero.conditions.blind;
  assert.equal(canSeeWithDarkvision(state, hero, monster), true);
});

test('blind monster cannot see a target or initiate a sight-based ambush', () => {
  const { state, hero, monster } = scene();
  monster.stealthState = { attempted: true, revealed: false };
  assert.equal(monsterCanSeeTarget(state, monster, hero), true);
  monster.conditions.blind = true;
  assert.equal(monsterCanSeeTarget(state, monster, hero), false);
  assert.equal(monsterCanAmbush(state, monster, hero, { canAttackAfterMove: () => true }), false);
});

test('sighted observers can see using a blind character light; ownership still filters viewers', () => {
  const { state, hero, monster, treasure } = scene();
  const other = { id: 'other', hp: 8, x: 2, y: 3, conditions: {} };
  state.characters.push(other);
  const before = structuredClone(collectLightSources(state));
  hero.conditions.blind = true;
  assert.deepEqual(collectLightSources(state), before);
  assert.equal(hero.lightRadius, 6);
  assert.equal(isMonsterTileIlluminated(state, monster), true);
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
  assert.equal(isFeatureCurrentlyVisible(state, treasure), true);
  state.viewerCharacterIds = new Set(['hero']);
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
  assert.equal(isFeatureCurrentlyVisible(state, treasure), false);
  state.viewerCharacterIds = new Set(['other']);
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
});

test('blind cat-eyes observer cannot reveal dark features or monsters', () => {
  const { state, hero, monster, treasure } = scene();
  hero.lightRadius = 0;
  state.visibility.visibleNow.clear();
  hero.transformationEffects = [{ spell: 'alter self', rounds: 5, features: ['cat-eyes'] }];
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
  assert.equal(isFeatureCurrentlyVisible(state, treasure), true);
  hero.conditions.blind = true;
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
  assert.equal(isFeatureCurrentlyVisible(state, treasure), false);
});

test('no-party preview observer also respects blindness', () => {
  const { state, monster, treasure } = scene();
  state.characters = [];
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
  state.player.conditions = { blind: true };
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
  assert.equal(isFeatureCurrentlyVisible(state, treasure), false);
});

test('source-tagged blind and deaf conditions survive save/load without losing a held light', () => {
  const { state, hero } = scene();
  hero.className = 'Priest'; hero.maxHitPoints = 10;
  hero.conditions = { blind: { source: 'blind/deafen', casterId: 'priest', focusId: 'focus-1' },
    deaf: { source: 'blind/deafen', casterId: 'priest', focusId: 'focus-1' } };
  hero.focusSpell = { spell: 'zone of truth', tier: 2, id: 'focus-2', targetIds: ['foe'] };
  const restored = hydrateDungeonState(serializeDungeonState(state)).characters[0];
  assert.deepEqual(restored.conditions, hero.conditions);
  assert.deepEqual(restored.focusSpell, hero.focusSpell);
  assert.equal(isBlind(restored), true);
  assert.equal(restored.lightRadius, hero.lightRadius);
});
