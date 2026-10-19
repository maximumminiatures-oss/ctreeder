import test from 'node:test';
import assert from 'node:assert/strict';
import { createFloatingDiscs, followFloatingDiscs, advanceFloatingDiscTime, floatingDiscSlotsAvailable, DISC_HOUR_MS } from '../../S3_content/src/floating-disc.js';
import { castWizardTierOne, resolveWizardTierOne } from '../../S3_content/src/wizard-tier-one.js';
import { beginPartyRest, advancePartyRest, interruptPartyRest, cancelPartyRest, restSupplyStatus, restWatchSchedule } from '../../S3_content/src/rest.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { setCharacterHp, getCharacterGearFreeSlots, normalizeCharacterState } from '../../S3_content/src/characters.js';
import { equipItem } from '../../S3_content/src/equipment.js';
import { characterOccupant } from '../../S3_content/src/combat-rules.js';
import { applyBurningHands } from '../../S3_content/src/burning-hands.js';
import { rollWizardMishaps } from '../../S3_content/src/wizard-mishaps.js';

const roll = value => modifier => ({ roll: value, modifier, total: value + modifier });
function scene() {
  return { map: { width: 15, height: 9 }, tiles: Array.from({ length: 135 }, (_, i) => ({ x: i % 15, y: Math.floor(i / 15), type: 'floor', roomId: 'r' })),
    entities: [], rooms: [{ id: 'r' }], player: {}, combat: { active: false },
    visibility: { exploredEver: new Set(Array.from({ length: 135 }, (_, i) => `${i % 15},${Math.floor(i / 15)}`)) },
    characters: [{ id: 'wizard', name: 'Wizard', hp: 7, maxHitPoints: 8, x: 2, y: 2, roomId: 'r', className: 'Wizard',
      stats: { INT: 14 }, gear: [{ name: 'Torch', quantity: 6 }, { name: 'Rations', quantity: 3 }] }] };
}

test('Alarm halves checks, critical quarters them, and one casting covers an unfinished rest', () => {
  const state = scene(), caster = state.characters[0];
  castWizardTierOne(state, caster, 'alarm', { checkRoll: roll(20) });
  assert.equal(state.preparedAlarm.encounterDivisor, 4);
  beginPartyRest(state, { safe: false, now: 0 });
  assert.equal(state.rest.alarm.encounterDivisor, 4);
  advancePartyRest(state, { now: 1000 });
  interruptPartyRest(state, roll(20));
  castWizardTierOne(state, caster, 'alarm', { checkRoll: roll(12) });
  beginPartyRest(state, { safe: true, now: 2000 });
  assert.equal(state.rest.hours, 1);
  assert.equal(state.rest.alarm.encounterDivisor, 4);
  advancePartyRest(state, { now: 10000 });
  caster.gear = [{ name: 'Rations', quantity: 1 }, { name: 'Torch', quantity: 3 }];
  beginPartyRest(state, { safe: true, now: 11000 });
  assert.equal(state.rest.alarm, undefined);
});

test('Alarm during voting persists but sleeping and combat reject new casting', () => {
  const state = scene(), caster = state.characters[0];
  beginPartyRest(state, { requiredMemberIds: ['solo', 'friend'] });
  castWizardTierOne(state, caster, 'alarm', { checkRoll: roll(12) });
  assert.equal(state.rest.alarm.encounterDivisor, 2);
  cancelPartyRest(state);
  beginPartyRest(state, { requiredMemberIds: ['solo', 'friend'] });
  assert.equal(state.rest.alarm.encounterDivisor, 2);
  state.rest.phase = 'sleeping';
  assert.throws(() => castWizardTierOne(state, caster, 'alarm'), /preparing rest/);
  state.rest.phase = 'interrupted'; state.combat.active = true;
  assert.throws(() => castWizardTierOne(state, caster, 'alarm'), /outside combat/);
});

test('Floating Disc has twenty slots, cannot equip weapons, and survives save/load without HP', () => {
  const state = scene(), [disc] = createFloatingDiscs(state, state.characters[0]);
  assert.equal(disc.colorValue, '#1b3e42');
  disc.colorValue = '#ff0000'; disc.colorId = 'red';
  normalizeCharacterState(state);
  assert.equal(state.characters.find(character => character.id === disc.id).colorValue, '#1b3e42');
  assert.equal(getCharacterGearFreeSlots(disc), 20);
  disc.gear = [{ name: 'Lantern', lit: true }, { name: 'Dagger', type: 'weapon' }];
  assert.equal(equipItem(disc, 1, true), false);
  assert.equal(equipItem(disc, 0, true), true);
  setCharacterHp(disc, 12);
  assert.equal(disc.hp, 0); assert.equal(disc.lightRadius, 12);
  const saved = hydrateDungeonState(serializeDungeonState(state)).characters[1];
  assert.equal(saved.gearSlotsTotal, 20); assert.equal(saved.summon.casterId, 'wizard');
  assert.equal(saved.summon.remainingMs, DISC_HOUR_MS);
  assert.equal(Boolean(characterOccupant(state, disc.x, disc.y, 'wizard')), false);
});

test('critical disc reserves a slot, requires two free slots for two discs, and supports two hours', () => {
  const state = scene(), caster = state.characters[0];
  while (state.characters.length < 15) state.characters.push({ id: `friend-${state.characters.length}` });
  castWizardTierOne(state, caster, 'floating disc', { checkRoll: roll(20) });
  assert.equal(floatingDiscSlotsAvailable(state), 0);
  assert.throws(() => resolveWizardTierOne(state, caster, { choice: 'two-discs' }), /two|2/);
  resolveWizardTierOne(state, caster, { choice: 'duration' });
  assert.equal(state.characters.length, 16); assert.equal(state.characters.at(-1).summon.remainingMs, DISC_HOUR_MS * 2);
  assert.throws(() => castWizardTierOne(state, caster, 'floating disc'), /full/);
});

test('discs stop in combat, catch up through darkness, ignore occupants, and path around walls', () => {
  const state = scene(), caster = state.characters[0], [disc] = createFloatingDiscs(state, caster);
  const canStep = (x, y, nx, ny) => nx >= 0 && nx < 15 && ny >= 0 && ny < 9 && !(nx === 5 && ny < 6);
  caster.x = 10; state.combat.active = true;
  assert.equal(followFloatingDiscs(state, canStep).length, 0); assert.equal(disc.x, 2);
  state.combat.active = false;
  for (let step = 0; step < 30; step++) followFloatingDiscs(state, canStep);
  assert.ok(Math.max(Math.abs(disc.x - caster.x), Math.abs(disc.y - caster.y)) <= 1);
  assert.ok(disc.x > 5);
});

test('disc time includes rest hours and a dying, dead or absent caster ends the summon', () => {
  for (const fate of ['dying', 'dead', 'absent', 'duration']) {
    const state = scene(), caster = state.characters[0], [disc] = createFloatingDiscs(state, caster);
    if (fate === 'dying') setCharacterHp(caster, 0);
    if (fate === 'dead') caster.dead = true;
    if (fate === 'absent') state.characters.shift();
    assert.equal(advanceFloatingDiscTime(state, fate === 'duration' ? DISC_HOUR_MS : 0)[0], disc);
  }
  const state = scene(), caster = state.characters[0]; caster.focusSpell = { spell: 'detect magic' };
  setCharacterHp(caster, 0); assert.equal(caster.focusSpell, null);
  caster.focusSpell = { spell: 'protection from evil' }; normalizeCharacterState(state);
  assert.equal(state.characters[0].focusSpell, null);
});

test('discs need no ration or watch but may carry the party supplies', () => {
  const state = scene(), caster = state.characters[0], [disc] = createFloatingDiscs(state, caster);
  disc.gear = caster.gear; caster.gear = [];
  assert.equal(restSupplyStatus(state).partySize, 1); assert.equal(restSupplyStatus(state).sufficient, true);
  beginPartyRest(state, { safe: true, now: 0 });
  assert.deepEqual(state.rest.participantIds, ['wizard']);
  assert.deepEqual(restWatchSchedule(state)[0].characterIds, ['wizard']);
  assert.equal(disc.gear.find(item => item.name === 'Torch').quantity, 3);
  assert.equal(disc.gear.find(item => item.name === 'Rations').quantity, 2);
});

test('discs are not creature targets for area damage or redirected mishaps', () => {
  const state = scene(), caster = state.characters[0]; createFloatingDiscs(state, caster);
  assert.deepEqual(applyBurningHands(state, caster).hits, []);
  const mishaps = rollWizardMishaps(state, caster, 'magic missile', { random: () => .26 });
  assert.match(mishaps[0].detail, /No ally/);
});
