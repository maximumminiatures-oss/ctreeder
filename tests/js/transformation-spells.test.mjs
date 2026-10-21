import test from 'node:test';
import assert from 'node:assert/strict';
import { castTransformationSpell, resolveTransformationSpell, ALTER_SELF_OPTIONS, alterSelfOptionEligible, foeFormOptions,
  transformationEffect, hasAlterSelfFeature, advanceTransformationRounds, syncTransformationEffects, maintainLevitationFocus,
  transformationMovementRules, transformationDarkvisionRadius, transformationInvisible, transformationAttackDisadvantage,
  transformationAttackOptions, remainingClawAttacks, spendClawAttack, interceptMirrorImageHit, interceptTransformationHit,
  mirrorImagePaintTokens, validateMistyStepDestination } from '../../S3_content/src/transformation-spells.js';
import { isParalyzed, conditionAutomaticCritical, conditionAllowsBackstab, conditionAttackMode } from '../../S3_content/src/conditions.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';

function scene() {
  const caster = { id: 'wizard', name: 'Wizard', className: 'Wizard', ancestry: 'Elf', level: 6, hp: 200, maxHitPoints: 200,
    stats: { INT: 16, STR: 9 }, x: 3, y: 3, roomId: 'room', routeId: '', colorValue: '#ff6600', gear: [], bonuses: [] };
  const state = { seed: 1, level: 1, map: { width: 20, height: 12 }, tiles: Array.from({ length: 240 }, (_, i) =>
    ({ x: i % 20, y: Math.floor(i / 20), type: 'floor', roomId: 'room', meta: {} })), rooms: [], entities: [], characters: [caster],
    activeCharacterId: caster.id, player: { x: 3, y: 3, roomId: 'room', routeId: '', torchLit: false }, decor: {},
    combat: { active: true, round: 1, actionUsed: true }, visibility: { visibleNow: new Set(), exploredEver: new Set() } };
  return { state, caster };
}
const check = value => modifier => ({ roll: value, total: value + modifier, modifier, firstRoll: value });
const cast = (state, caster, spell, roll = 12) => castTransformationSpell(state, caster, spell, { rollCheck: check(roll), random: () => .1 });
const pick = (state, caster, option) => resolveTransformationSpell(state, caster, { option });

test('Tier 2 checks use DC12, preserve pending actions, fail normally, and natural 1 applies the normal mishap table', () => {
  const { state, caster } = scene();
  const result = cast(state, caster, 'alter self');
  assert.equal(result.check.modifier, 3); assert.equal(result.succeeded, true); assert.equal(caster.pendingSpell.phase, 'options');
  assert.throws(() => cast(state, caster, 'misty step'), /pending/); assert.equal(state.combat.actionUsed, true);
  caster.pendingSpell = null;
  assert.equal(cast(state, caster, 'misty step', 2).succeeded, false);
  assert.ok(caster.failedSpellKeys.includes('misty step')); assert.throws(() => cast(state, caster, 'misty step'), /unavailable/);
  const mishap = cast(state, caster, 'mirror image', 1);
  assert.equal(mishap.mishaps.length, 1); assert.ok(caster.failedSpellKeys.includes('mirror image'));
});

test('Alter Self exposes stable options and uses sequential distinct critical picks before applying either feature', () => {
  const { state, caster } = scene();
  assert.ok(ALTER_SELF_OPTIONS.every(option => option.key && option.label && option.description));
  cast(state, caster, 'alter self', 20);
  resolveTransformationSpell(state, caster, { choice: 'options' });
  pick(state, caster, 'spider-legs');
  assert.equal(caster.pendingSpell.phase, 'options'); assert.equal(hasAlterSelfFeature(caster, 'spider-legs'), false);
  assert.equal(alterSelfOptionEligible(state, caster, 'spider-legs'), false);
  assert.throws(() => pick(state, caster, 'spider-legs'), /different/);
  pick(state, caster, 'goat-legs');
  const rules = transformationMovementRules(state, caster);
  assert.equal(rules.crossesPits, true); assert.equal(rules.passesCreatures, true); assert.equal(rules.multiplier, 2);
  assert.equal(rules.passesStatues, false); assert.equal(rules.passesPillars, false);
  assert.equal(caster.pendingSpell, null); assert.equal(transformationEffect(caster, 'alter self').rounds, 5);
});

test('duration critical lasts ten rounds and expired transformation ancestry restores even after normalization', () => {
  const { state, caster } = scene();
  cast(state, caster, 'alter self', 20); resolveTransformationSpell(state, caster, { choice: 'duration' }); pick(state, caster, 'cat-eyes');
  assert.equal(transformationDarkvisionRadius(caster), 12); assert.equal(caster.lightRadius, undefined);
  advanceTransformationRounds(state, 9); assert.equal(transformationDarkvisionRadius(caster), 12);
  advanceTransformationRounds(state, 1); assert.equal(transformationDarkvisionRadius(caster), 0);
  assert.equal(caster.ancestry, 'Elf');
});

test('Gills removes water slowdown and toggles invisibility only in water without ending unrelated invisibility', () => {
  const { state, caster } = scene(); cast(state, caster, 'alter self'); pick(state, caster, 'gills');
  assert.equal(transformationMovementRules(state, caster).ignoresWater, true);
  assert.equal(transformationInvisible(state, caster), false);
  state.tiles[3 * 20 + 3].meta.slowWater = true; syncTransformationEffects(state);
  assert.equal(transformationInvisible(state, caster), true); assert.equal(caster.invisibility.source, 'alter-self-gills');
  caster.x = 4; syncTransformationEffects(state); assert.equal(caster.invisibility, undefined);
  caster.invisibility = { source: 'halfling', rounds: 3 }; caster.x = 3; syncTransformationEffects(state);
  advanceTransformationRounds(state, 5); assert.equal(caster.invisibility.source, 'halfling');
});

test('Claws grant exactly two INT attacks per round and survive saves without refunding a spent attack', () => {
  const { state, caster } = scene(); cast(state, caster, 'alter self'); pick(state, caster, 'claws');
  const attack = transformationAttackOptions(state, caster)[0];
  assert.deepEqual([attack.bonus, attack.damageExpression, attack.attacksPerRound], [3, '1d6', 2]);
  assert.equal(spendClawAttack(state, caster).actionComplete, false);
  const restored = hydrateDungeonState(serializeDungeonState(state)), wizard = restored.characters[0];
  assert.equal(remainingClawAttacks(restored, wizard), 1);
  assert.equal(spendClawAttack(restored, wizard).actionComplete, true);
  assert.throws(() => spendClawAttack(restored, wizard), /No claw/);
  restored.combat.round++; assert.equal(remainingClawAttacks(restored, wizard), 2);
});

function foe(state, extra = {}) {
  const monster = { id: 'orc', name: 'Orc', type: 'monster', x: 4, y: 3, hp: 30, routeId: '', attack: 'Spear +7 (1d6) or Axe +9 (2d8)', ...extra };
  state.entities.push(monster); state.visibility.visibleNow.add(`${monster.x},${monster.y}`);
  return monster;
}
test('Foe Form is available outside combat for an illuminated visible foe and never exposes hidden foes', () => {
  const { state, caster } = scene(); state.combat.active = false;
  const monster = foe(state); caster.lightRadius = 6;
  assert.equal(foeFormOptions(state, caster).length, 1);
  monster.stealthState = { attempted: true, revealed: false }; assert.equal(foeFormOptions(state, caster).length, 0);
  delete monster.stealthState; caster.lightRadius = 0;
  assert.equal(foeFormOptions(state, caster).length, 0);
});

test('Foe Form copies ancestry and highest damage, never the monster hit bonus, then restores ancestry on expiry/recast', () => {
  const { state, caster } = scene(); const monster = foe(state); caster.lightRadius = 6;
  cast(state, caster, 'alter self'); pick(state, caster, 'foe-form'); assert.equal(caster.pendingSpell.phase, 'targeting');
  resolveTransformationSpell(state, caster, { targetId: monster.id });
  assert.equal(caster.ancestry, 'Orc'); assert.equal(transformationAttackDisadvantage(monster, caster), true);
  const attack = transformationAttackOptions(state, caster, { attackBonus: 2 })[0];
  assert.equal(attack.name, 'Axe'); assert.equal(attack.damageExpression, '2d8'); assert.equal(attack.bonus, 2);
  normalizeCharacterState(state); const wizard = state.characters[0]; advanceTransformationRounds(state, 5);
  assert.equal(wizard.ancestry, 'Elf');
  cast(state, wizard, 'alter self'); pick(state, wizard, 'foe-form'); resolveTransformationSpell(state, wizard, { targetId: monster.id });
  cast(state, wizard, 'alter self'); pick(state, wizard, 'goat-legs'); assert.equal(wizard.ancestry, 'Elf');
});

test('Levitate self uses Focus, escapes a lower pit, bypasses statues but not pillars, and blocks pickup/melee', () => {
  const { state, caster } = scene();
  const pit = { id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 3, routeId: '', lowerRouteId: 'lower' };
  state.entities.push(pit); state.underpasses = [{ id: 'lower', lowerCells: [{ x: 3, y: 3 }], upperCrossings: [{ x: 3, y: 3 }], portals: [], art: [], artVersion: 2 }];
  caster.routeId = 'lower';
  cast(state, caster, 'levitate'); assert.equal(caster.focusSpell.spell, 'levitate'); assert.equal(caster.routeId, '');
  const rules = transformationMovementRules(state, caster);
  for (const name of ['crossesPits','passesCreatures','ignoresWater','ignoresFloorTraps','passesStatues']) assert.equal(rules[name], true);
  assert.equal(rules.passesPillars, false); assert.equal(rules.canPickUpGear, false); assert.equal(rules.canMeleeAttack, false);
  assert.equal(interceptTransformationHit(state, caster, { melee: true }).intercepted, true);
  assert.equal(interceptTransformationHit(state, caster, { melee: false }).intercepted, false);
});

test('critical Levitate accepts only an additional party member within clear five-foot reach; lost Focus clears everyone', () => {
  const { state, caster } = scene();
  const ally = { id: 'ally', name: 'Ally', hp: 10, x: 4, y: 4, routeId: '' }; state.characters.push(ally);
  cast(state, caster, 'levitate', 20); resolveTransformationSpell(state, caster, { choice: 'target' });
  ally.x = 5; assert.throws(() => resolveTransformationSpell(state, caster, { targetId: ally.id }), /5 feet/);
  ally.x = 4; resolveTransformationSpell(state, caster, { targetId: ally.id });
  assert.ok(transformationEffect(ally, 'levitate')); assert.ok(transformationEffect(caster, 'levitate'));
  const failed = maintainLevitationFocus(state, caster, { rollCheck: check(2) });
  assert.equal(failed.succeeded, false); assert.ok(!caster.failedSpellKeys?.includes('levitate'));
  assert.equal(transformationEffect(ally, 'levitate'), null);
  cast(state, caster, 'levitate'); caster.hp = 0; syncTransformationEffects(state);
  assert.equal(caster.focusSpell, null); assert.equal(transformationEffect(caster, 'levitate'), null);
});

test('later Levitate Focus twenties never offer a critical; natural 1 still loses spell and effect', () => {
  const { state, caster } = scene(); cast(state, caster, 'levitate');
  maintainLevitationFocus(state, caster, { rollCheck: check(20) });
  assert.equal(caster.pendingSpell, null);assert.equal(caster.focusSpell.critical,false);
  maintainLevitationFocus(state, caster, { rollCheck: check(20), reason: 'damage' });
  assert.equal(caster.pendingSpell, null);
  const failed = maintainLevitationFocus(state, caster, { rollCheck: check(1), random: () => .1 });
  assert.equal(failed.succeeded, false); assert.equal(failed.mishaps.length, 1);
  assert.ok(caster.failedSpellKeys.includes('levitate')); assert.equal(transformationEffect(caster, 'levitate'), null);
});

test('casting another Focus spell or the death of the caster ends Levitate for its additional target too', () => {
  const { state, caster } = scene(), ally = { id: 'ally', name: 'Ally', hp: 10, x: 4, y: 3, routeId: '' };
  state.characters.push(ally);
  cast(state, caster, 'levitate', 20); resolveTransformationSpell(state, caster, { choice: 'target' });
  resolveTransformationSpell(state, caster, { targetId: ally.id });
  caster.focusSpell = { spell: 'detect magic' }; const ended = syncTransformationEffects(state);
  assert.equal(ended.length, 2); assert.equal(transformationEffect(ally, 'levitate'), null);
});

test('Mirror Image paints same-color translucent offsets, fills directions first, and only hits consume images', () => {
  const { state, caster } = scene(); caster.level = 10; cast(state, caster, 'mirror image', 20);
  resolveTransformationSpell(state, caster, { choice: 'duplicates' }, { random: () => .2 });
  const tokens = mirrorImagePaintTokens(caster);
  assert.equal(tokens.length, 10); assert.equal(new Set(tokens.slice(0, 8).map(token => token.direction)).size, 8);
  assert.ok(tokens.every(token => token.opacity === .5 && token.colorValue === caster.colorValue));
  assert.ok(tokens.every(token => tokens.filter(other => other.direction === token.direction).length <= 2));
  assert.equal(interceptMirrorImageHit(state, caster, { hit: false }).intercepted, false);
  assert.equal(mirrorImagePaintTokens(caster).length, 10);
  const hit = interceptMirrorImageHit(state, caster); assert.equal(hit.intercepted, true); assert.equal(hit.preventEffects, true);
  assert.equal(new Set(mirrorImagePaintTokens(caster).map(token => token.direction)).size, 8, 'destroy a doubled direction before removing a unique direction');
  assert.equal(caster.hp, 200);
  for (let i = 0; i < 9; i++) interceptMirrorImageHit(state, caster);
  assert.equal(interceptMirrorImageHit(state, caster).intercepted, false);
});

test('Mirror Image minimum is one, default is floor half level, duration critical lasts ten rounds and persists poses', () => {
  for (const [level, count] of [[1,1],[3,1],[6,3]]) {
    const { state, caster } = scene(); caster.level = level; cast(state, caster, 'mirror image'); assert.equal(mirrorImagePaintTokens(caster).length, count);
  }
  const { state, caster } = scene(); cast(state, caster, 'mirror image', 20);
  resolveTransformationSpell(state, caster, { choice: 'duration' }, { random: () => .2 });
  const restored = hydrateDungeonState(serializeDungeonState(state));
  assert.deepEqual(mirrorImagePaintTokens(restored.characters[0]), mirrorImagePaintTokens(caster));
  advanceTransformationRounds(restored, 10); assert.equal(mirrorImagePaintTokens(restored.characters[0]).length, 0);
});

test('Misty Step bypasses walls/restraints, uses six-square circular range and atomically rejects bounds and other routes', () => {
  const { state, caster } = scene(); caster.conditions = { tied: { dc: 20 }, restrained: true };
  state.tiles[3 * 20 + 4].type = 'wall'; cast(state, caster, 'misty step');
  const before = serializeDungeonState(state);
  for (const selection of [{ x: -1, y: 3 }, { x: 20, y: 3 }, { x: 3.2, y: 3 }, { x: 10, y: 3 }, { x: 5, y: 3, routeId: 'lower' }])
    assert.throws(() => resolveTransformationSpell(state, caster, selection));
  assert.deepEqual(serializeDungeonState(state), before);
  const result = resolveTransformationSpell(state, caster, { x: 8, y: 3 });
  assert.equal(result.moved, true); assert.equal(caster.x, 8); assert.ok(!caster.conditions.tied && !caster.conditions.restrained);
  assert.equal(state.combat.actionUsed, true);
});

test('Misty Step critical doubles range to twelve but cannot jump between stacked underpass routes', () => {
  const { state, caster } = scene(); cast(state, caster, 'misty step', 20);
  resolveTransformationSpell(state, caster, { choice: 'range' });
  assert.doesNotThrow(() => validateMistyStepDestination(state, caster, { x: 15, y: 3 }));
  assert.throws(() => validateMistyStepDestination(state, caster, { x: 15, y: 4 }));
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 3, y: 3 }, { x: 4, y: 3 }], upperCrossings: [{ x: 3, y: 3 }, { x: 4, y: 3 }], portals: [] }];
  assert.throws(() => resolveTransformationSpell(state, caster, { x: 4, y: 3, routeId: 'lower' }));
});

test('known solid landing needs confirmation before 8d6 self damage; a changed destination is revalidated', () => {
  const { state, caster } = scene(); state.tiles[3 * 20 + 5].type = 'wall'; state.visibility.exploredEver.add('5,3');
  cast(state, caster, 'misty step'); const result = resolveTransformationSpell(state, caster, { x: 5, y: 3 });
  assert.equal(result.requiresConfirmation, true); assert.equal(result.prompt, 'really teleport into a solid wall?'); assert.equal(caster.hp, 200); assert.equal(caster.x, 3);
  assert.throws(() => resolveTransformationSpell(state, caster, { x: -1, y: 3, confirmed: true }));
  const hit = resolveTransformationSpell(state, caster, { x: 5, y: 3, confirmed: true }, { random: () => 0 });
  assert.equal(hit.damage, 8); assert.equal(caster.hp, 192); assert.equal(hit.moved, false); assert.equal(caster.pendingSpell, null);
});

test('unexplored solids warn only beside known tiles, while ordinary floor beside a known wall is safe', () => {
  const { state, caster } = scene(); state.tiles[3 * 20 + 5].type = 'wall';
  cast(state, caster, 'misty step'); const result = resolveTransformationSpell(state, caster, { x: 5, y: 3 }, { random: () => 0 });
  assert.equal(result.requiresConfirmation, undefined); assert.equal(result.damage, 8);
  state.visibility.exploredEver.add('5,3'); cast(state, caster, 'misty step');
  const safe = resolveTransformationSpell(state, caster, { x: 6, y: 3 });
  assert.equal(safe.requiresConfirmation, undefined); assert.equal(safe.damage, 0); assert.equal(safe.moved, true);
  state.tiles[3 * 20 + 7].type = 'wall'; state.visibility.exploredEver.add('8,3');
  cast(state, caster, 'misty step');
  const warning = resolveTransformationSpell(state, caster, { x: 7, y: 3 });
  assert.equal(warning.requiresConfirmation, true); assert.equal(warning.prompt, 'really teleport into a solid wall?');
});

test('visible monster landings confirm then independently deal 8d6 to each creature; empty/hidden guesses do not leak warnings', () => {
  const { state, caster } = scene(); caster.lightRadius = 6; const monster = foe(state, { x: 6, hp: 100 });
  cast(state, caster, 'misty step'); const warning = resolveTransformationSpell(state, caster, { x: 6, y: 3 });
  assert.equal(warning.requiresConfirmation, true); assert.equal(warning.prompt, 'teleporting into a monster will have disastrous results. Proceed?');
  let rolls = 0;
  const result = resolveTransformationSpell(state, caster, { x: 6, y: 3, confirmed: true }, { random: () => rolls++ < 8 ? 0 : .99 });
  assert.equal(result.damage, 8); assert.equal(result.monsterDamage, 48); assert.equal(monster.hp, 52); assert.equal(result.moved, false);
  monster.stealthState = { attempted: true, revealed: false }; cast(state, caster, 'misty step');
  const hidden = resolveTransformationSpell(state, caster, { x: 6, y: 3 }, { random: () => 0 });
  assert.equal(hidden.requiresConfirmation, undefined); assert.equal(hidden.damage, 8);
});

test('unknown secret door landing is unharmed and grants a normalized Luck token or delegates its callback', () => {
  for (const custom of [false, true]) {
    const { state, caster } = scene();
    state.entities.push({ id: 'secret', type: 'feature', subtype: 'door', secret: true, x: 5, y: 3, routeId: '', doorState: 'closed' });
    cast(state, caster, 'misty step'); let called = 0;
    const result = resolveTransformationSpell(state, caster, { x: 5, y: 3 }, custom ? { onLuck: () => called++ } : {});
    assert.equal(result.damage, 0); assert.equal(result.moved, true); assert.equal(result.secretDoorId, 'secret');
    if (custom) assert.equal(called, 1);
    else {
      assert.equal(caster.luckToken, true); assert.equal(caster.raw.luckToken, true);
      const restored = hydrateDungeonState(serializeDungeonState(state)); assert.equal(restored.characters[0].luckToken, true);
    }
  }
});

test('Misty Step validates party occupancy and confirmation types atomically and accepts explicit client preflight confirmation', () => {
  const { state, caster } = scene();
  state.characters.push({ id: 'ally', hp: 10, x: 5, y: 3, routeId: '' });
  cast(state, caster, 'misty step');
  const before = serializeDungeonState(state);
  assert.throws(() => resolveTransformationSpell(state, caster, { x: 5, y: 3 }), /party member/);
  assert.throws(() => resolveTransformationSpell(state, caster, { x: 6, y: 3, confirmed: 'yes' }), /true or false/);
  assert.deepEqual(serializeDungeonState(state), before);
  state.tiles[3 * 20 + 6].type = 'wall'; state.tiles[3 * 20 + 7].type = 'wall';
  state.visibility.exploredEver.add('6,3'); state.visibility.exploredEver.add('7,3');
  const result = resolveTransformationSpell(state, caster, { x: 7, y: 3, confirmed: true }, { random: () => 0 });
  assert.equal(result.requiresConfirmation, undefined); assert.equal(result.damage, 8);
  assert.equal(caster.hp, 192); assert.equal(caster.x, 3);
});

test('Luck normalizes a raw fallback but an explicitly spent token stays spent', () => {
  const { state, caster } = scene(); caster.raw = { luckToken: true };
  normalizeCharacterState(state); assert.equal(state.characters[0].luckToken, true);
  state.characters[0].luckToken = false; state.characters[0].raw.luckToken = true;
  normalizeCharacterState(state); assert.equal(state.characters[0].luckToken, false);
});

test('paralysis condition hooks grant advantage, automatic critical and backstab eligibility', () => {
  const target = { conditions: { paralyzed: true } };
  assert.equal(isParalyzed(target), true); assert.equal(conditionAutomaticCritical(target), true); assert.equal(conditionAllowsBackstab(target), true);
  assert.equal(conditionAttackMode(target, { melee: false }).doubleRoll, true);
  assert.equal(conditionAttackMode(target, { melee: false, disadvantage: true }).doubleRoll, false);
});
