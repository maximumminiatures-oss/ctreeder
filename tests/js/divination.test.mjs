import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingTreasureValue, remainingMonsterCount, auguryAssessment, zoneTruthAnswer, ZONE_TRUTH_COLORS } from '../../S3_content/src/divination.js';
import { unweightedTreasureNames, createTreasureDetails } from '../../S3_content/src/treasure.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { generateDungeon } from '../../S3_content/src/generator.js';
import { castPriestTierTwoSpell, resolvePriestTierTwoSpell } from '../../S3_content/src/priest-tier-two.js';

const hero = (id, overrides = {}) => ({ id, level: 1, hp: 10, maxHitPoints: 10, ...overrides });
const foe = (id, overrides = {}) => ({ id, type: 'monster', roomId: id, level: 1, hp: 10, maxHp: 10, ...overrides });
const loot = (id, value, overrides = {}) => ({ id, type: 'treasure', value, ...overrides });
function baseline() {
  return { level: 1, characters: [1, 2, 3, 4].map(id => hero(`hero-${id}`)),
    entities: [foe('room-a'), foe('room-b'), foe('room-c'), foe('room-d'), loot('loot', 4000)],
    rooms: ['entrance', 'room-a', 'room-b', 'room-c', 'room-d'].map(id => ({ id })),
    generation: { entranceRoomId: 'entrance', treasureActualGp: 4000, treasureTargetGp: 4000 } };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('remaining treasure sums current entity GP including hidden, charred, ash and coins without nested duplication', () => {
  const state = freeze({ partyAssets: { gold: 900 }, entities: [
    loot('hidden', 50, { visible: false, revealed: false, gearItem: { value: 500 } }),
    loot('charred', 20, { charred: true, originalValue: 40 }), loot('ash', 0),
    loot('turned-ash', 0.01), loot('collected', 900, { collected: true }), loot('destroyed', 600, { destroyed: true }),
    { id: 'coins', type: 'treasure', coinBreakdown: { gold: 2, silver: 3, copper: 4 } },
    { id: 'legacy-gear', type: 'treasure', gearItem: { value: 7 } },
    loot('canonical-zero', 0, { gearItem: { value: 80 } }), loot('negative', -10),
    loot('invalid', Infinity), loot('nan', 'not a price'),
    { type: 'monster', value: 500, gear: [{ value: 500 }] }, { type: 'feature', value: 100 }
  ] });
  assert.equal(remainingTreasureValue(state), 79.35);
  assert.equal(remainingTreasureValue(), 0);
});

test('literal monster count includes sleepers, charm, friends and living companions, excluding dead/discs/departed', () => {
  const state = freeze({ entities: [foe('alive'), foe('dead', { defeated: true }), foe('zero', { hp: 0 }),
    foe('sleep', { conditions: { sleeping: true } }), foe('charm', { charm: { remainingMs: 100 } }),
    foe('left', { leftPeacefully: true }), foe('departing', { departing: true }), foe('friendly', { attitude: 'friendly' })],
  characters: [hero('ordinary'), hero('disc', { summon: { kind: 'floating-disc' }, hp: 0 }),
    hero('friend', { companion: { kind: 'friendly', sourceMonsterId: 'friendly' } }),
    hero('charmed', { companion: { kind: 'charmed', sourceMonsterId: 'charm' } }),
    hero('double', { companion: { kind: 'doppelganger', sourceMonsterId: 'infiltrator' } }),
    hero('dead-friend', { dead: true, companion: { kind: 'friendly', sourceMonsterId: 'dead-friend-source' } })] });
  assert.equal(remainingMonsterCount(state), 6);
  assert.equal(remainingMonsterCount(), 0);
});

test('Augury baseline is Possibly for four healthy matching-level PCs regardless of dungeon room count', () => {
  for (const count of [1, 4, 20]) {
    const state = baseline();
    state.entities = Array.from({ length: count }, (_, index) => foe(`room-${index}`)).concat(loot('loot', 4000));
    state.rooms = Array.from({ length: count + 1 }, (_, index) => ({ id: `room-${index}` }));
    const result = auguryAssessment(freeze(state));
    assert.equal(result.answer, 'possibly');
    assert.equal(result.metrics.threatRatio, 1);
    assert.match(result.explanation, /heuristic, not a simulated outcome/);
    assert.ok(result.assumptions.some(value => value.includes('not simulated')));
  }
});

test('Augury thresholds are strict above 1.5 and below its inverse; boundary values stay Possibly', () => {
  for (const [enemyLevel, expected] of [[1.5, 'possibly'], [1.5001, 'no'], [2 / 3, 'possibly'], [0.66, 'yes']]) {
    const state = baseline();
    state.entities.filter(entity => entity.type === 'monster').forEach(enemy => { enemy.level = enemyLevel; });
    assert.equal(auguryAssessment(state).answer, expected, `${enemyLevel}`);
  }
});

test('Augury uses health and present readiness, not just character count or maximum HP', () => {
  const state = baseline();
  state.characters.forEach(character => { character.hp = 5; });
  assert.equal(auguryAssessment(state).answer, 'no');
  state.entities = [loot('loot', 4000)];
  state.characters.forEach(character => { character.hp = 1; });
  const wounded = auguryAssessment(state);
  assert.equal(wounded.answer, 'no');
  assert.match(wounded.explanation, /recover before risking traps/);
  state.characters.forEach(character => { character.hp = 2.5; });
  assert.equal(auguryAssessment(state).answer, 'no', 'quarter-health boundary is conservative');
  state.characters.forEach(character => { character.hp = 3; });
  assert.equal(auguryAssessment(state).answer, 'yes');
  state.characters.forEach(character => { character.conditions = { sleeping: true }; });
  assert.equal(auguryAssessment(state).answer, 'no');
  assert.equal(auguryAssessment(state).metrics.sleepingPartyCount, 4);
});

test('no treasure advises No; safe known opposition with treasure advises Yes, with explicit trap uncertainty', () => {
  const state = baseline();
  state.entities = [];
  assert.equal(auguryAssessment(state).answer, 'no');
  state.entities.push(loot('loot', 4000));
  assert.equal(auguryAssessment(state).answer, 'yes');
  assert.match(auguryAssessment(state).explanation, /traps may still be dangerous/);
  state.characters = [];
  assert.equal(auguryAssessment(state).answer, 'no');
});

test('sleeping enemies still count; peaceful and actively charmed monsters are not enemy threats', () => {
  const state = baseline();
  state.entities.filter(entity => entity.type === 'monster').forEach(enemy => { enemy.conditions = { sleeping: true }; });
  assert.equal(auguryAssessment(state).answer, 'possibly');
  state.entities.filter(entity => entity.type === 'monster').forEach(enemy => { enemy.charm = { remainingMs: 100 }; });
  assert.equal(auguryAssessment(state).answer, 'yes');
  assert.equal(remainingMonsterCount(state), 4);
  state.entities.filter(entity => entity.type === 'monster').forEach(enemy => { enemy.charm.remainingMs = 0; });
  assert.equal(auguryAssessment(state).answer, 'possibly', 'expired charm is not safety');
  state.entities.filter(entity => entity.type === 'monster').forEach(enemy => { enemy.attitude = 'friendly'; });
  assert.equal(auguryAssessment(state).answer, 'yes');
});

test('real companions add support, discs do not, and infiltrating doppelgangers add threats instead', () => {
  const state = baseline();
  state.characters.push(hero('disc', { level: 100, summon: { kind: 'floating-disc' } }));
  assert.equal(auguryAssessment(state).metrics.partyStrength, 4);
  state.characters.push(hero('ally', { level: 4, companion: { kind: 'friendly', sourceMonsterId: 'ally-source' } }));
  state.entities.push(foe('ally-source'));
  assert.equal(auguryAssessment(state).metrics.partyStrength, 8);
  assert.equal(auguryAssessment(state).metrics.enemyCount, 4);
  assert.equal(auguryAssessment(state).answer, 'yes');
  state.characters.at(-1).companion.kind = 'charmed';
  assert.equal(auguryAssessment(state).metrics.partyStrength, 8);
  state.characters.at(-1).companion = { kind: 'doppelganger', sourceMonsterId: 'ally-source', source: { level: 3 } };
  assert.equal(auguryAssessment(state).metrics.partyStrength, 4);
  assert.equal(auguryAssessment(state).metrics.enemyCount, 5);
});

test('Augury accounts for cleared encounter groups and scarce remaining treasure without averaging away a dangerous peak', () => {
  const state = baseline();
  state.entities.filter(entity => entity.type === 'monster').slice(0, 3).forEach(enemy => { enemy.defeated = true; enemy.hp = 0; });
  assert.equal(auguryAssessment(state).metrics.remainingEncounterFraction, 0.25);
  assert.equal(auguryAssessment(state).answer, 'yes');
  state.entities.find(entity => entity.type === 'treasure').value = 100;
  assert.equal(auguryAssessment(state).answer, 'possibly');
  state.entities.find(entity => entity.type === 'treasure').value = 4000;
  state.entities.find(entity => entity.type === 'monster' && !entity.defeated).level = 2;
  assert.equal(auguryAssessment(state).answer, 'possibly', 'remaining boss pressure blocks an optimistic Yes');
});

test('critical Augury keeps the same decision and mechanics, adding clearer actionable guidance only', () => {
  const state = freeze(baseline());
  const ordinary = auguryAssessment(state), critical = auguryAssessment(state, { critical: true });
  assert.equal(critical.answer, ordinary.answer);
  assert.deepEqual(critical.metrics, ordinary.metrics);
  assert.deepEqual(critical.assumptions, ordinary.assumptions);
  assert.match(critical.explanation, /Recover, scout, and reassess/);
  assert.equal(critical.message, `Possibly. ${critical.explanation}`);
  assert.ok(critical.explanation.length > ordinary.explanation.length);
  assert.equal(critical.critical, true);
});

test('priest engine adapter preserves critical Augury guidance and the complete message', () => {
  const state = baseline(), caster = state.characters[0];
  caster.name = 'Dor'; caster.className = 'Priest'; caster.stats = { WIS: 10 };
  const cast = castPriestTierTwoSpell(state, caster, 'augury', {
    checkRoll: modifier => ({ roll: 20, firstRoll: 20, modifier, total: 20 + modifier })
  });
  assert.equal(cast.critical, true);
  const result = resolvePriestTierTwoSpell(state, caster, { question: 'continue' }, {
    auguryAssessment: (dungeon, priest, question, pending) => auguryAssessment(dungeon, { critical: pending.critical })
  });
  assert.equal(result.answer, 'possibly');
  assert.equal(result.critical, true);
  assert.equal(result.clearerExplanation, true);
  assert.match(result.message, /^Possibly\./);
  assert.match(result.message, /Recover, scout, and reassess/);
  assert.equal(caster.pendingSpell, null);
});

test('Zone treasure estimates stay within +/-10 percent for large, zero and copper-sized values', () => {
  for (const treasureValue of [0, 0.01, 0.03, 1, 123.45, 4000]) for (const random of [0, 0.5, 1]) {
    const state = freeze({ entities: [loot('loot', treasureValue)] });
    const result = zoneTruthAnswer(state, foe('speaker'), 'treasure', { rng: () => random });
    assert.equal(result.treasureValue, treasureValue);
    assert.ok(result.estimate + 1e-9 >= treasureValue * 0.9);
    assert.ok(result.estimate - 1e-9 <= treasureValue * 1.1);
    assert.equal(result.reply, `Our treasure? Oh. The total gold piece value is probably about: ${result.estimate} gold pieces.`);
    assert.equal(result.message, result.reply);
  }
});

test('Zone monster count uses the exact ASCII-apostrophe reply and performs no random roll', () => {
  const result = zoneTruthAnswer(freeze(baseline()), foe('speaker'), 'monsters', { rng: () => { throw new Error('Unexpected random roll.'); } });
  assert.equal(result.monsterCount, 4);
  assert.equal(result.reply, "My friends? Well, there are 4 of them you haven't slain.");
});

test('all twenty colors have equal intervals and deterministic RNG injection, including inclusive RNG endpoint', () => {
  assert.equal(ZONE_TRUTH_COLORS.length, 20);
  assert.equal(new Set(ZONE_TRUTH_COLORS).size, 20);
  for (let index = 0; index < 20; index++) {
    const result = zoneTruthAnswer(freeze({}), null, 'color', { rng: () => (index + 0.5) / 20 });
    assert.equal(result.color, ZONE_TRUTH_COLORS[index]);
    assert.equal(result.reply, `Oh, thanks for asking. I like ${result.color}.`);
  }
  assert.equal(zoneTruthAnswer({}, null, 'color', { rng: () => 1 }).color, ZONE_TRUTH_COLORS.at(-1));
  assert.deepEqual(zoneTruthAnswer({}, null, 'color', { rng: new SeededRng(42) }), zoneTruthAnswer({}, null, 'color', { rng: new SeededRng(42) }));
});

test('unweighted catalog flattens real treasure combinations and de-duplicates repeated weapon categories', () => {
  const state = freeze({ rulesData: { weapons: [{ name: 'test sword' }], gear: [{ name: 'test supply' }] } });
  const names = unweightedTreasureNames(state);
  assert.ok(names.length > 2000);
  assert.equal(names.length, new Set(names).size);
  for (const name of ['test sword', 'test supply', 'a box of rotten salt', 'holy royal plate of Ord', 'fake shiv', 'g.p. pouch']) {
    assert.equal(names.filter(candidate => candidate === name).length, 1, name);
  }
  assert.deepEqual(unweightedTreasureNames({ ...state, level: 1 }), unweightedTreasureNames({ ...state, level: 10 }));
  for (const index of [0, 1, 2, 3, 99, 999, names.indexOf('test sword'), names.indexOf('holy royal plate of Ord'), names.length - 1]) {
    const result = zoneTruthAnswer(state, null, 'desired_treasure', { rng: () => (index + 0.5) / names.length });
    assert.equal(result.item, names[index]);
    assert.equal(result.reply, `${names[index]}.`);
  }
  assert.equal(zoneTruthAnswer(state, null, 'desired_treasure', { rng: () => 1 }).item, names.at(-1));
});

test('catalog enumeration leaves normal weighted treasure generation and RNG state untouched', () => {
  const state = freeze({ level: 4 });
  const expectedRng = new SeededRng(42), actualRng = new SeededRng(42);
  const expected = Array.from({ length: 50 }, () => createTreasureDetails(state, expectedRng));
  unweightedTreasureNames(state);
  const actual = Array.from({ length: 50 }, () => createTreasureDetails(state, actualRng));
  assert.deepEqual(actual, expected);
  assert.equal(actualRng.state, expectedRng.state);
});

test('secret question reveals through existing door flags, reports IDs, leaves ordinary/found doors and unrelated state alone', () => {
  const state = createEmptyDungeonState(42, 1);
  state.player.x = 1; state.player.y = 1;
  getTile(state, 1, 1).roomId = 'unrelated-room';
  const secret = { id: 'secret', type: 'feature', subtype: 'door', secret: true, roomId: 'room-a', wallSide: 'north' };
  state.entities = [secret, { ...secret, id: 'found', secretFound: true }, { ...secret, id: 'revealed', revealed: true },
    { ...secret, id: 'ordinary', secret: false }, loot('loot', 500)];
  const before = structuredClone(state);
  const answer = zoneTruthAnswer(state, foe('speaker'), 'secret_doors');
  assert.deepEqual(answer.secretDoorIds, ['secret']);
  assert.equal(answer.reply, "Oh, I'll mark them on your map.");
  assert.equal(secret.secretFound, true);
  assert.equal(secret.visible, true);
  assert.equal(secret.revealed, true);
  assert.notEqual(getTile(state, state.player.x, state.player.y).roomId, secret.roomId);
  assert.deepEqual(secret.secretFoundSide, { x: 0, y: 1 }, 'remote north-wall marker faces into the door room, not toward the player');
  assert.equal(secret.secretFoundRoomId, 'room-a', 'remote reveal uses the door room instead of the unrelated player room');
  assert.deepEqual(state.player, before.player);
  assert.deepEqual(state.entities.slice(1), before.entities.slice(1));
  assert.deepEqual(state.characters, before.characters);
  assert.deepEqual(state.timers, before.timers);
  assert.equal(zoneTruthAnswer(state, null, 'secret_doors').reply, "There aren't any more secrets.");
});

test('unsupported questions and invalid RNG reject without mutation; question aliases are accepted', () => {
  const state = freeze(baseline());
  assert.throws(() => zoneTruthAnswer(state, null, 'unrecognized'), /supported/);
  for (const value of [-1, 1.01, NaN, Infinity, '0.5']) assert.throws(() => zoneTruthAnswer(state, null, 'color', { rng: () => value }), RangeError);
  assert.equal(zoneTruthAnswer(state, null, 'remaining_monsters').question, 'monsters');
  assert.equal(zoneTruthAnswer(state, null, 'favorite-color', { rng: () => 0 }).question, 'color');
});

test('real generated state retains its budget/value contract through read-only divination', () => {
  const state = generateDungeon(564643, 1, { monsterTable: [{ name: 'Test foe', level: 1, hp: 10, ac: 10 }],
    architecturePattern: 'chain', reviewedLayouts: false, underpasses: false, pits: false });
  state.characters = baseline().characters;
  const before = structuredClone(state);
  assert.ok(state.rooms.length > 1);
  const total = state.entities.filter(entity => entity.type === 'treasure' && !entity.collected)
    .reduce((sum, entity) => sum + Math.max(0, Number(entity.value) || 0), 0);
  assert.equal(remainingTreasureValue(state), Math.round(total * 100) / 100);
  const assessment = auguryAssessment(state, { critical: true });
  assert.ok(['yes', 'no', 'possibly'].includes(assessment.answer));
  assert.ok(assessment.metrics.budgetGp > 0);
  zoneTruthAnswer(state, null, 'treasure', { rng: () => 0.5 });
  zoneTruthAnswer(state, null, 'monsters');
  assert.deepEqual(state, before);
});
