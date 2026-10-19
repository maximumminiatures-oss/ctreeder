import test from 'node:test';
import assert from 'node:assert/strict';
import { isSleeping, isProne, isIncorporeal, putToSleep, wakeCreature, standCreature, conditionAttackMode, phaseStepAllowed } from '../../S3_content/src/conditions.js';
import { forceHeldDoor, advancePortalRounds, sleepSquare } from '../../S3_content/src/control-spells.js';
import { castWizardTierOne, resolveWizardTierOne } from '../../S3_content/src/wizard-tier-one.js';
import { resetBurningLights, releaseUnequippedTorches } from '../../S3_content/src/light-lifecycle.js';
import { findPursuitStep } from '../../S3_content/src/pursuit.js';
import { attackRollSegments } from '../../S3_content/src/combat-rules.js';
import { stealableGear, selectStealTarget, takeStolenItem } from '../../S3_content/src/thievery.js';

const check = (roll = 13, modifier = 2) => ({ roll, firstRoll: roll, secondaryRoll: null, modifier, total: roll + modifier });
function scene() {
  const caster = { id: 'mage', name: 'Mage', className: 'Wizard', stats: { INT: 14 }, level: 1, hp: 5, x: 7, y: 7, gear: [], spellsKnown: 'Sleep, Hold Portal' };
  const state = { map: { width: 15, height: 15 }, tiles: Array.from({ length: 225 }, (_, i) => ({ x: i % 15, y: Math.floor(i / 15), type: 'floor' })),
    characters: [caster], entities: [], player: { x: 7, y: 7 }, visibility: { visibleNow: new Set(), exploredEver: new Set() }, decor: {} };
  return { state, caster };
}

test('Sleep is centered, spares the caster, affects allies, and respects level and undead immunity', () => {
  const { state, caster } = scene();
  state.characters.push({ id: 'ally', name: 'Ally', x: 8, y: 7, hp: 4, level: 1 });
  state.entities.push(...[
    { id: 'near', name: 'Bandit', x: 10, y: 10, level: 2 },
    { id: 'outside', name: 'Bandit', x: 11, y: 7, level: 1 },
    { id: 'strong', name: 'Bandit', x: 8, y: 8, level: 3 },
    { id: 'dead', name: 'Skeleton', tags: ['undead'], x: 6, y: 7, level: 1 }
  ].map(entity => ({ ...entity, type: 'monster', hp: 5 })));
  const result = castWizardTierOne(state, caster, 'sleep', { checkRoll: () => check() });
  assert.deepEqual(result.targets.map(target => target.id).sort(), ['ally', 'near']);
  assert.equal(isSleeping(caster), false); assert.equal(isSleeping(state.characters[1]), true);
  assert.equal(caster.pendingSpell, null);
  assert.deepEqual(sleepSquare(caster), { x: 4, y: 4, size: 7 });
});

test('Sleep critical offers level four or a centered 13 by 13 square and walls block it', () => {
  for (const choice of ['level', 'area']) {
    const { state, caster } = scene();
    state.entities.push({ id: 'strong', type: 'monster', name: 'Bandit', hp: 5, x: 8, y: 7, level: 4 },
      { id: 'far', type: 'monster', name: 'Bandit', hp: 5, x: 13, y: 7, level: 1 },
      { id: 'wall', type: 'monster', name: 'Bandit', hp: 5, x: 7, y: 9, level: 1 });
    state.tiles.find(tile => tile.x === 7 && tile.y === 8).type = 'wall';
    castWizardTierOne(state, caster, 'sleep', { checkRoll: () => check(20) });
    const result = resolveWizardTierOne(state, caster, { choice });
    assert.deepEqual(result.targets.map(target => target.id), [choice === 'level' ? 'strong' : 'far']);
    assert.equal(result.area.size, choice === 'area' ? 13 : 7);
  }
});

test('Hold Portal stores the casting total, ends when forced, and expires without opening the door', () => {
  const { state, caster } = scene();
  const door = { id: 'door', subtype: 'door', type: 'feature', x: 9, y: 7, wallSide: 'east', doorState: 'open' };
  state.entities.push(door);
  castWizardTierOne(state, caster, 'hold portal', { checkRoll: () => check() });
  resolveWizardTierOne(state, caster, { targetId: door.id });
  assert.equal(door.doorState, 'closed'); assert.equal(door.holdPortal.dc, 15);
  assert.equal(forceHeldDoor(door, { name: 'Orc', stats: { STR: 14 } }, () => check(10, 2)).opened, false);
  assert.equal(forceHeldDoor(door, { name: 'Orc', stats: { STR: 14 } }, () => check(13, 2)).opened, true);
  assert.equal(door.holdPortal, undefined); assert.equal(door.doorState, 'open');
  door.holdPortal = { rounds: 2 }; door.doorState = 'closed'; advancePortalRounds(state, 2);
  assert.equal(door.holdPortal, undefined); assert.equal(door.doorState, 'closed');
});

test('sleeping creatures are prone; waking leaves prone and standing spends half movement', () => {
  const creature = { id: 'a', focusSpell: { spell: 'detect magic' } };
  putToSleep(creature, 'mage'); assert.equal(isSleeping(creature), true); assert.equal(isProne(creature), true);
  assert.equal(creature.focusSpell, null); assert.throws(() => standCreature(creature, 6, 6), /Sleeping/);
  wakeCreature(creature); assert.equal(isSleeping(creature), false); assert.equal(isProne(creature), true);
  assert.throws(() => standCreature(creature, 6, 2), /3 movement/);
  assert.equal(standCreature(creature, 6, 6), 3); assert.equal(isProne(creature), false);
});

test('prone modifies melee and ranged checks and opposing roll modes cancel', () => {
  const prone = { conditions: { prone: true } };
  assert.deepEqual(conditionAttackMode(prone), { doubleRoll: true, disadvantage: false });
  assert.deepEqual(conditionAttackMode(prone, { melee: false, close: false }), { doubleRoll: false, disadvantage: true });
  assert.deepEqual(conditionAttackMode(prone, { melee: false, close: true }), { doubleRoll: false, disadvantage: false });
  assert.deepEqual(conditionAttackMode(prone, { disadvantage: true }), { doubleRoll: false, disadvantage: false });
});

test('rest sleepers and watchers use the same sleeping condition', () => {
  const state = { rest: { phase: 'sleeping', hours: 0, participantIds: ['a','b'], watchOrderIds: ['a','b'] } };
  assert.equal(isSleeping({ id: 'a' }, state), false); assert.equal(isSleeping({ id: 'b' }, state), true);
  state.rest.hours = 2; assert.equal(isSleeping({ id: 'a' }, state), true); assert.equal(isSleeping({ id: 'b' }, state), false);
});

test('incorporeal movement crosses solids, remains bounded, and shortest pursuit can route around corners', () => {
  const { state } = scene();
  assert.equal(isIncorporeal({}), false);
  assert.equal(phaseStepAllowed(state, 0, 0, -1, 0), false);
  assert.equal(phaseStepAllowed(state, 1, 1, 2, 2), true);
  const step = findPursuitStep(state, { x: 2, y: 2 }, { x: 4, y: 2 }, {
    canStep: (x, y, nx, ny) => !(nx === 3 && ny >= 1 && ny <= 3),
    canAttackFrom: (x, y) => x === 4 && y === 2
  });
  assert.ok(step); assert.notEqual(step.x, 3);
});

test('reset removes burning torches but not spares, extinguishes stowed lanterns, and preserves magical Light', () => {
  const character = { gear: [{ name: 'Torch', lit: true }, { name: 'Torch', lit: false }, { name: 'Lantern', lit: true, equipped: false }], lightSpellLit: true };
  const state = { characters: [character], entities: [{ subtype: 'dropped-equipment', gearItem: { name: 'Torch', lit: true } },
    { subtype: 'dropped-equipment', gearItem: { name: 'Torch' }, lightSource: 'torch' },
    { subtype: 'dropped-equipment', gearItem: { name: 'Lantern', lit: true }, lightSource: 'lantern', lightRadius: 12 }] };
  resetBurningLights(state);
  assert.equal(character.gear.filter(item => item.name === 'Torch').length, 1);
  assert.equal(character.gear[1].lit, false); assert.equal(character.lightSpellLit, true);
  assert.equal(state.entities.length, 1); assert.equal(state.entities[0].lightRadius, undefined);
});

test('unequipping a torch drops exactly one item with a fifty percent extinguish chance', () => {
  for (const random of [.1, .9]) {
    const torch = { name: 'Torch', lit: true, equipped: false }, character = { gear: [torch] }, drops = [];
    releaseUnequippedTorches(character, [torch], item => drops.push(item), () => random);
    assert.equal(character.gear.length, 0); assert.equal(drops.length, 1); assert.equal(drops[0].lit, random >= .5);
  }
});

test('attack segments mark the chosen advantage die, minimum/maximum dice, and colored actor identity', () => {
  const parts = attackRollSegments({ character: { id: 'a', name: 'Shrigark' }, monster: { name: 'Darkmantle' }, weapon: 'Dagger',
    roll: { firstRoll: 20, secondaryRoll: 1, roll: 1, total: 4, modifier: 3, checkMode: 'disadvantage' }, ability: 'DEX', abilityModifier: 3, hit: false });
  assert.equal(parts[0].characterId, 'a');
  const tooltip = parts.find(part=>part.tooltip).tooltip;
  assert.equal(tooltip.find(part => part.text === '20').maximum, true);
  assert.equal(tooltip.find(part => part.text === '1').minimum, true);
  assert.equal(tooltip.find(part => part.text === '1').bold, true);
  assert.match(tooltip.map(part=>part.text).join(''), /2d20 = \(20\)\(1\)/);
  assert.match(parts.map(part => part.text).join(''), /at disadvantage.*\n4 Miss!/);
});

test('stealing reuses the original roll, excludes equipped armor, and removes only the chosen gear', () => {
  const { state, caster } = scene();
  const monster = { id: 'orc', type: 'monster', name: 'Orc', x: 8, y: 7, hp: 4, W: 1,
    gear: [{ name: 'Chainmail', type: 'armor', equipped: true }, { name: 'Dagger', type: 'weapon', equipped: true }, { name: 'Rope' }] };
  state.entities.push(monster); state.visibility.visibleNow.add('8,7');
  caster.pendingSteal = { check: check(16, 3) };
  assert.deepEqual(stealableGear(monster).map(entry => entry.index), [1, 2]);
  selectStealTarget(state, caster, monster);
  assert.throws(() => takeStolenItem(state, caster, 0), /cannot be stolen/);
  const result = takeStolenItem(state, caster, 2); assert.equal(result.item.name, 'Rope');
  assert.equal(monster.gear.length, 2); assert.equal(caster.pendingSteal, null);
});
