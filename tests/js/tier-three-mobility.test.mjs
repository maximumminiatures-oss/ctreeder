import test from 'node:test';
import assert from 'node:assert/strict';
import { castTierThreeMobilitySpell, resolveTierThreeMobilitySpell, tierThreeMobilityPresentation,
  mobilityMovementSquares, mobilityPassesDoor, mobilityImmuneToWeb, mobilityCanDirectlyTarget,
  mobilityActionBlock, canSenseWithGaseousForm, canEndMobilityMovement, resolveMobilityExpiry } from '../../S3_content/src/tier-three-mobility.js';
import { isGaseousForm, isIncorporeal, ignoresNormalRestraints } from '../../S3_content/src/conditions.js';
import { TRANSFORMATION_SPELLS, transformationMovementRules, advanceTransformationRounds,
  interceptTransformationHit } from '../../S3_content/src/transformation-spells.js';
import { characterMovementBudget, combatStepBlock } from '../../S3_content/src/combat-rules.js';
import { movementStepCost } from '../../S3_content/src/terrain-movement.js';
import { avoidsFalling } from '../../S3_content/src/pits.js';
import { canDirectlyTarget } from '../../S3_content/src/concealment.js';
import { canTargetAtRange, planClickMovement, hasReadyOffensiveSpell } from '../../S3_content/src/targeting.js';
import { recomputeVisibility, isTilePerceived } from '../../S3_content/src/visibility.js';
import { collectLightSources } from '../../S3_content/src/light-geometry.js';
import { isMonsterCurrentlyVisible } from '../../S3_content/src/monster-perception.js';
import { visibleDungeonEntities } from '../../S3_content/src/render.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { listMagicEffects } from '../../S3_content/src/magic-effect-registry.js';
import { elementalDamage } from '../../S3_content/src/elemental-effects.js';

function scene() {
  const caster = { id: 'wizard', name: 'Wizard', className: 'Wizard', ancestry: 'Elf', hp: 100, maxHitPoints: 100,
    stats: { INT: 16 }, level: 5, x: 3, y: 3, routeId: '', roomId: 'room', gear: [], bonuses: [], colorValue: '#22aacc' };
  const state = { seed: 1, level: 1, map: { width: 16, height: 12 }, tiles: Array.from({ length: 192 }, (_, i) =>
    ({ x: i % 16, y: Math.floor(i / 16), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [], entities: [], characters: [caster], activeCharacterId: caster.id,
    player: { x: 3, y: 3, routeId: '', roomId: 'room', torchLit: false }, decor: {},
    combat: { active: true, round: 1, movementRemaining: 6 },
    visibility: { visibleNow: new Set(), exploredEver: new Set() } };
  return { state, caster };
}
const check = roll => modifier => ({ roll, total: roll + modifier, modifier, firstRoll: roll });
const cast = (state, caster, spell, roll = 13) => castTierThreeMobilitySpell(state, caster, spell,
  { rollCheck: check(roll), random: () => 0 });
const monsterAt = (state, x, y, extra = {}) => {
  const monster = { id: 'monster', name: 'Orc', type: 'monster', hp: 20, x, y, routeId: '', ...extra };
  state.entities.push(monster); return monster;
};

test('Fly uses DC13 Tier3 casting, is self-only, lasts five rounds, and grants six flight squares', () => {
  const { state, caster } = scene(); caster.movementSquares = 3;
  const result = castTierThreeMobilitySpell(state, caster, 'fly', { rollCheck: check(10) });
  assert.equal(result.succeeded, true); assert.equal(result.check.total, 13);
  assert.deepEqual(result.targetIds, [caster.id]); assert.equal(caster.pendingSpell, null);
  assert.equal(caster.transformationEffects[0].rounds, 5); assert.equal(caster.focusSpell, undefined);
  assert.equal(characterMovementBudget(caster), 6); assert.equal(mobilityMovementSquares(caster), 6);
  const rules = transformationMovementRules(state, caster);
  for (const key of ['flying','crossesPits','passesCreatures','ignoresWater','ignoresFloorTraps','immuneToMelee','canPickUpGear','canMeleeAttack'])
    assert.equal(rules[key], true, key);
  assert.equal(rules.passesDoors, false); assert.equal(rules.passesPillars, false);
  assert.equal(avoidsFalling(caster), true);
  state.tiles[3 * 16 + 3].meta.slowWater = true;
  assert.equal(movementStepCost(state, 3, 3, caster), 1);
  assert.equal(interceptTransformationHit(state, caster, { melee: true }).reason, 'fly');
  assert.equal(interceptTransformationHit(state, caster, { melee: false }).intercepted, false);
  assert.equal(mobilityActionBlock(caster, { weaponAttack: true, gearAction: true }), '');
});

test('Fly initial critical offers exactly duration or movement, never both, without entering the Tier2 spell set', () => {
  assert.deepEqual([...TRANSFORMATION_SPELLS], ['alter self','levitate','mirror image','misty step']);
  for (const [choice, rounds, movement] of [['duration',10,6], ['movement',5,12]]) {
    const { state, caster } = scene(); cast(state, caster, 'fly', 20);
    assert.equal(caster.transformationEffects, undefined); assert.equal(caster.pendingSpell.phase, 'critical');
    assert.deepEqual(tierThreeMobilityPresentation(state, caster).choices.map(option => option.key), ['duration','movement']);
    assert.throws(() => resolveTierThreeMobilitySpell(state, caster, { choice: 'both' }), /valid critical/);
    resolveTierThreeMobilitySpell(state, caster, { choice });
    assert.equal(caster.transformationEffects[0].rounds, rounds); assert.equal(characterMovementBudget(caster), movement);
    assert.equal(tierThreeMobilityPresentation(state, caster), null);
    assert.throws(() => resolveTierThreeMobilitySpell(state, caster, { choice }), /pending/);
  }
});

test('Tier3 failures lose the spell, natural one invokes higher mishaps, and pending casts are atomic', () => {
  const { state, caster } = scene();
  assert.equal(cast(state, caster, 'fly', 9).succeeded, false);
  assert.deepEqual(caster.failedSpellKeys, ['fly']); assert.throws(() => cast(state, caster, 'fly'), /unavailable/);
  const result = cast(state, caster, 'gaseous form', 1);
  assert.equal(result.succeeded, false); assert.equal(result.mishaps.length, 3);
  assert.ok(result.mishaps.every(mishap => mishap.tier === 3));
  const fresh = scene(); cast(fresh.state, fresh.caster, 'fly', 20);
  const before = structuredClone(fresh.caster);
  assert.throws(() => cast(fresh.state, fresh.caster, 'gaseous form'), /pending/);
  assert.deepEqual(fresh.caster, before);
});

test('Gaseous Form applies ten rounds, or twenty automatically on its initial critical, without becoming wall-phasing', () => {
  for (const [roll, rounds] of [[13,10],[20,20]]) {
    const { state, caster } = scene();
    caster.conditions = { tied: true, restrained: true, webs: ['web'], bound: true };
    const result = cast(state, caster, 'gaseous form', roll);
    assert.equal(result.succeeded, true); assert.equal(caster.pendingSpell, null);
    assert.equal(caster.transformationEffects[0].rounds, rounds); assert.equal(characterMovementBudget(caster), 6);
    assert.equal(isGaseousForm(caster), true); assert.equal(isIncorporeal(caster), false);
    assert.equal(ignoresNormalRestraints(caster), true); assert.equal(mobilityImmuneToWeb(caster), true);
    assert.deepEqual(caster.conditions, {});
    const rules = transformationMovementRules(state, caster);
    for (const flag of ['canPickUpGear','canMeleeAttack','canWeaponAttack','canCastSpells','canUseGear']) assert.equal(rules[flag], false);
    for (const flag of ['spellcasting','weaponAttack','gearAction']) assert.match(mobilityActionBlock(caster, { [flag]: true }), /Gaseous Form/);
    assert.throws(() => cast(state, caster, 'fly'), /Gaseous Form/);
    assert.equal(mobilityPassesDoor(caster, { subtype: 'door', doorState: 'closed' }), true);
    assert.equal(mobilityPassesDoor(caster, { subtype: 'door', doorState: 'locked' }), true);
    for (const door of [{ subtype: 'wall' }, { subtype: 'wall-of-force' }, { subtype: 'door', wallOfForce: true }, { subtype: 'door', secret: true }])
      assert.equal(mobilityPassesDoor(caster, door), false);
  }
});

test('gas cannot be directly targeted at any range, including spells and magic detection; square AoE aiming stays independent', () => {
  const { state, caster } = scene(), attacker = monsterAt(state, 4, 3);
  cast(state, caster, 'gaseous form'); attacker.magicDetectedIds = [caster.id];
  for (const range of [1,6,12]) {
    assert.equal(canDirectlyTarget(caster, range, attacker), false);
    assert.equal(mobilityCanDirectlyTarget(caster, { melee: range === 1 }), false);
    assert.equal(canTargetAtRange(state, attacker, caster, range, { requireLight: false }), false);
  }
  assert.equal(canTargetAtRange(state, attacker, { x: caster.x, y: caster.y, routeId: '' }, 6, { requireLight: false }), true);
  assert.equal(interceptTransformationHit(state, caster, { melee: false }).reason, 'gaseous form');
  assert.equal(interceptTransformationHit(state, caster, { areaEffect: true }).intercepted, false);
  assert.equal(interceptTransformationHit(state, caster, { areaEffect: true, melee: true }).intercepted, false);
});

test('central damage pipeline halves gas AoE only with explicit source context, never merely for a spell or element name', () => {
  const { state, caster } = scene(); cast(state, caster, 'gaseous form');
  assert.equal(elementalDamage(caster, 9, { damageType: 'fire', areaEffect: true }).total, 4);
  assert.equal(elementalDamage(caster, 9, { damageType: 'fire' }).total, 9);
  assert.equal(elementalDamage(caster, 9, 'fireball').total, 9);
  advanceTransformationRounds(state, 10);
  assert.equal(elementalDamage(caster, 9, { damageType: 'fire', areaEffect: true }).total, 9);
});

test('gas sensing perceives six-square terrain and monsters through darkness without emitting light or penetrating walls', () => {
  const { state, caster } = scene(); cast(state, caster, 'gaseous form');
  const near = monsterAt(state, 8, 3), far = monsterAt(state, 10, 3, { id: 'far' });
  assert.equal(collectLightSources(state).length, 0);
  assert.equal(canSenseWithGaseousForm(state, caster, { x: 9, y: 3, routeId: '' }), true);
  assert.equal(canSenseWithGaseousForm(state, caster, { x: 9, y: 4, routeId: '' }), false);
  recomputeVisibility(state);
  assert.equal(state.visibility.visibleNow.size, 0);
  assert.equal(isTilePerceived(state, 9, 3), true); assert.equal(isTilePerceived(state, 10, 3), false);
  assert.equal(isMonsterCurrentlyVisible(state, near), true); assert.equal(isMonsterCurrentlyVisible(state, far), false);
  assert.ok(visibleDungeonEntities(state, { darkness: true }).includes(near));
  assert.equal(collectLightSources(state).length, 0); assert.equal(caster.lightRadius, undefined);
  state.tiles[3 * 16 + 6].type = 'wall';
  assert.equal(canSenseWithGaseousForm(state, caster, near), false);
  recomputeVisibility(state); assert.equal(isTilePerceived(state, 8, 3), false);
});

test('gas sensing is viewer- and route-scoped, and does not inherit twelve-square companion vision', () => {
  const { state, caster } = scene(); caster.companion = { kind: 'orc' }; cast(state, caster, 'gaseous form');
  const target = monsterAt(state, 10, 3);
  recomputeVisibility(state); assert.equal(isTilePerceived(state, 10, 3), false);
  assert.equal(isMonsterCurrentlyVisible(state, target), false);
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 4, y: 3 }], upperCrossings: [{ x: 4, y: 3 }], portals: [] }];
  assert.equal(canSenseWithGaseousForm(state, caster, { x: 4, y: 3, routeId: 'lower' }), false);
  state.viewerCharacterIds = new Set(['other']); recomputeVisibility(state);
  assert.equal(isTilePerceived(state, 4, 3), false);
});

test('Fly and gas can transit enemy tokens but cannot select or end movement on a creature', () => {
  for (const spell of ['fly','gaseous form']) {
    const { state, caster } = scene(); cast(state, caster, spell);
    const monster = monsterAt(state, 4, 3);
    for (const tile of state.tiles) if (tile.y !== 3) tile.type = 'wall';
    state.visibility.visibleNow = new Set(state.tiles.map(tile => `${tile.x},${tile.y}`));
    assert.equal(combatStepBlock(state, caster, 4, 3), '');
    assert.deepEqual(planClickMovement(state, caster, 4, 3, 6), []);
    assert.deepEqual(planClickMovement(state, caster, 5, 3, 2), [{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }]);
    caster.x = monster.x; assert.equal(canEndMobilityMovement(state, caster), false);
    state.combat.movementRemaining = 1; caster.x = 3;
    assert.match(combatStepBlock(state, caster, 4, 3), /can't end turn/);
  }
});

test('expiry falls on the current pit with existing falling machinery, even when a safe adjacent rim exists', () => {
  const { state, caster } = scene(); cast(state, caster, 'fly');
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 3, routeId: '' });
  let callback = 0;
  const ended = advanceTransformationRounds(state, 5, { random: () => 0,
    onTransformationEnded: (current, actor, effect, landing) => {
      callback++; assert.equal(actor, caster); assert.equal(effect.spell, 'fly'); assert.equal(landing.fall.damage, 3);
    } });
  assert.equal(callback, 1); assert.equal(ended[0].landing.fall.damage, 3);
  assert.deepEqual([caster.x,caster.y,caster.hp], [3,3,97]);
  assert.equal(caster.conditions.sinkhole, 'pit'); assert.equal(caster.conditions.prone, true);
});

test('expiry queues falling for the parent response flow and respects lower pit routes', () => {
  const { state, caster } = scene(); cast(state, caster, 'gaseous form');
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 3, routeId: '', lowerRouteId: 'lower' });
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 3, y: 3 }], upperCrossings: [{ x: 3, y: 3 }], portals: [] }];
  let event;
  advanceTransformationRounds(state, 10, { random: () => 0, queueFall: (actor, fall) => { event = fall; return true; } });
  assert.equal(event.damage, 3); assert.equal(caster.hp, 100); assert.equal(caster.routeId, 'lower');
  assert.equal(state.player.routeId, 'lower'); assert.equal(caster.lastPitFall.pending, true);
});

test('expiry on an overlapping creature chooses nearest reachable free square, never a wall or another route', () => {
  const { state, caster } = scene(); cast(state, caster, 'gaseous form'); monsterAt(state, 3, 3);
  state.tiles[2 * 16 + 3].type = 'wall';
  const effect = caster.transformationEffects[0]; caster.transformationEffects = [];
  const result = resolveMobilityExpiry(state, caster, effect);
  assert.equal(result.moved, true); assert.deepEqual([caster.x,caster.y], [2,3]);
  assert.equal(state.player.x, 2); assert.equal(caster.routeId, ''); assert.equal(canEndMobilityMovement(state, caster), true);
});

test('a wholly enclosed overlapping landing reports blocked instead of teleporting through solid walls', () => {
  const { state, caster } = scene(); cast(state, caster, 'fly'); monsterAt(state, 3, 3);
  for (const tile of state.tiles) if (tile.x !== 3 || tile.y !== 3) tile.type = 'wall';
  const ended = advanceTransformationRounds(state, 5);
  assert.equal(ended[0].landing.blocked, true);
  assert.deepEqual([caster.x,caster.y], [3,3]); assert.equal(caster.hp, 100);
});

test('expiry preserves another active flight, pit bridges, and ancestry; records save/load and appear in dispel registry', () => {
  const { state, caster } = scene(); cast(state, caster, 'fly');
  caster.transformationEffects.push({ spell: 'gaseous form', casterId: caster.id, rounds: 10, movementSquares: 6 });
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 3, routeId: '' });
  advanceTransformationRounds(state, 5); assert.equal(caster.hp, 100); assert.equal(caster.transformationEffects.length, 1);
  const restored = hydrateDungeonState(serializeDungeonState(state)), actor = restored.characters[0];
  assert.equal(isGaseousForm(actor), true); assert.equal(actor.ancestry, 'Elf');
  assert.ok(listMagicEffects(restored).some(effect => effect.spell === 'gaseous form'));
  restored.entities.find(entity => entity.id === 'pit').ropeBridges = [{ routeId: '', cells: [{ x: 3, y: 3 }] }];
  advanceTransformationRounds(restored, 5); assert.equal(actor.hp, 100); assert.equal(actor.conditions?.sinkhole, undefined);
});

test('parent utility targeting keys are ready only in targeting or placement phases', () => {
  for (const spell of ['protection from energy','animate dead','speak with dead','magic circle']) {
    assert.equal(hasReadyOffensiveSpell({ pendingSpell: { spell, phase: 'targeting' } }), true);
    assert.equal(hasReadyOffensiveSpell({ pendingSpell: { spell, phase: 'placement' } }), true);
    assert.equal(hasReadyOffensiveSpell({ pendingSpell: { spell, phase: 'critical' } }), false);
  }
});
