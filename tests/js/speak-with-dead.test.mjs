import test from 'node:test';
import assert from 'node:assert/strict';
import { castSpeakWithDead, resolveSpeakWithDead, speakWithDeadPresentation, speakWithDeadTargets,
  speakWithDeadCorpseSource, SPEAK_WITH_DEAD_DAY_MS } from '../../S3_content/src/speak-with-dead.js';
import { answerDeadQuestion, deadQuestionMenu, deadPlural, deadNumber, deadRemainingMonsters, deadRemainingTreasure,
  deadTreasureCategory, deadReminiscence, deadWeightedChoice, DEAD_VERBS, DEAD_ADJECTIVES, DEAD_NOUNS } from '../../S3_content/src/dead-dialogue.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { generateDungeon } from '../../S3_content/src/generator.js';

const check = roll => modifier => ({ roll, modifier, total: roll + modifier });
const caster = state => state.characters[0];
function scene(spellClass = 'Wizard') {
  const width = 20, height = 20;
  return { map: { width, height }, level: 5, seed: 3, rooms: [], halls: [], decor: {},
    arcaneTime: { elapsedMs: 0 }, visibility: { visibleNow: new Set(), exploredEver: new Set() },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', meta: {} })),
    characters: [{ id: 'caster', name: 'Badzog', className: spellClass, class: spellClass, level: 5, ancestry: 'Human',
      hp: 20, maxHitPoints: 20, x: 4, y: 4, stats: { INT: 14, WIS: 16 }, gear: [], raw: {}, spellsKnown: 'Speak With Dead' }],
    player: { x: 4, y: 4 }, entities: [
      { id: 'dead-orc', type: 'monster', name: 'Orc', I: -1, hp: 0, defeated: true, x: 5, y: 4 },
      { id: 'corpse', type: 'treasure', subtype: 'corpse-loot', corpseLoot: true, monsterName: 'Orc', name: 'Dead Orc', x: 5, y: 4,
        sourceMonsterId: 'dead-orc', corpseSource: { name: 'Orc', I: -1 }, revealed: true },
      { id: 'enemy', type: 'monster', name: 'Water Elemental', I: -1, hp: 20, x: 19, y: 19 },
      { id: 'enemy2', type: 'monster', name: 'Water Elemental', hp: 20, x: 18, y: 19 },
      { id: 'enemy3', type: 'monster', name: 'Frog, Giant', hp: 2, x: 18, y: 18 },
      { id: 'hidden-gem', type: 'treasure', kind: 'gems', name: 'Chipped Ruby', value: 170, visible: false },
      { id: 'hidden-weapon', type: 'treasure', kind: 'weapon', name: 'Chipped Dagger', value: 20, visible: false }
    ] };
}
function cast(state, roll = 12, options = {}) { return castSpeakWithDead(state, caster(state), { checkRoll: check(roll), ...options }); }
function target(state) { return resolveSpeakWithDead(state, caster(state), { targetId: 'corpse' }); }
function ask(state, option) { return resolveSpeakWithDead(state, caster(state), { option }, { rng: () => .1 }); }

test('wizard INT and priest WIS use tier 3 DC 13, including casting bonuses', () => {
  const wizard = scene();
  assert.equal(cast(wizard, 10).succeeded, false);
  assert.ok(caster(wizard).failedSpellKeys.includes('speak with dead'));
  assert.equal(caster(wizard).spellPenance?.['speak with dead'], undefined);
  const priest = scene('Priest');
  const result = cast(priest, 10);
  assert.equal(result.succeeded, true);
  assert.equal(result.check.modifier, 3);
  assert.match(result.message, /DC 13/);
  assert.equal(caster(priest).pendingSpell.questionsTotal, 3);
  const bonus = scene();
  caster(bonus).bonuses = [{ name: 'Spellcasting', bonusTo: 'Wizard spellcasting', bonusAmount: 1 }];
  assert.equal(cast(bonus, 10).succeeded, true);
});

test('initial natural 20 automatically grants six questions, never a critical picker', () => {
  const state = scene(); cast(state, 20); target(state);
  assert.equal(caster(state).pendingSpell.questionsTotal, 6);
  assert.equal(speakWithDeadPresentation(state, caster(state)).choices, undefined);
  assert.match(speakWithDeadPresentation(state, caster(state)).title, /dead orc six questions/);
  for (let i = 0; i < 6; i++) assert.equal(ask(state, 'monster_count').questionsRemaining, 5 - i);
  assert.equal(caster(state).pendingSpell.phase, 'complete');
  assert.throws(() => ask(state, 'monster_count'), /All questions/);
  assert.match(speakWithDeadPresentation(state, caster(state)).detail, /three of my fellows/);
  assert.deepEqual(speakWithDeadPresentation(state, caster(state)).options.map(item => item.key), ['__finish__']);
});

test('touch target validates corpse source, Intelligence threshold, diagonals, walls, routes and stale IDs', () => {
  const state = scene();
  assert.deepEqual(speakWithDeadTargets(state, caster(state)).map(entry => entry.key), ['corpse']);
  state.entities[1].corpseSource.I = -2;
  assert.equal(speakWithDeadTargets(state, caster(state)).length, 1);
  state.entities[1].corpseSource.I = -3;
  assert.throws(() => cast(state), /Intelligence modifier/);
  state.entities[1].corpseSource.I = -2;
  state.entities[1].y = 5;
  assert.equal(speakWithDeadTargets(state, caster(state)).length, 1);
  state.tiles[4 * 20 + 5].type = 'wall';
  assert.equal(speakWithDeadTargets(state, caster(state)).length, 0);
  state.tiles[4 * 20 + 5].type = 'floor';
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 5, y: 5 }], upperCrossings: [{ x: 5, y: 5 }], portals: [], artVersion: 2 }];
  state.entities[1].routeId = 'lower';
  assert.equal(speakWithDeadTargets(state, caster(state)).length, 0);
  delete state.entities[1].routeId;
  cast(state);
  assert.throws(() => resolveSpeakWithDead(state, caster(state), { targetId: 'enemy' }), /valid corpse/);
  target(state);
  state.entities[1].collected = true;
  assert.throws(() => ask(state, 'monster_count'), /no longer available/);
  assert.equal(caster(state).pendingSpell.questionsAsked, 0);
});

test('corpse snapshots remain valid after monster removal, legacy corpses use source ID or catalog and character corpses use INT score', () => {
  const state = scene(), corpse = state.entities[1];
  state.entities = state.entities.filter(entity => entity.id !== 'dead-orc');
  assert.equal(speakWithDeadCorpseSource(state, corpse).I, -1);
  delete corpse.corpseSource;
  assert.equal(speakWithDeadTargets(state, caster(state)).length, 0);
  const monsters = [{ 'Monster Name': 'Orc', '**I**': '-2' }];
  assert.equal(speakWithDeadTargets(state, caster(state), { monsters }).length, 1);
  assert.equal(speakWithDeadCorpseSource(state, corpse, { monsters }), monsters[0]);
  corpse.subtype = 'character-corpse'; corpse.corpseLoot = false;
  corpse.characterCorpse = { name: 'Erd', stats: { INT: 6 } };
  assert.equal(speakWithDeadTargets(state, caster(state)).length, 1);
  corpse.characterCorpse.stats.INT = 3;
  assert.equal(speakWithDeadTargets(state, caster(state)).length, 0);
});

test('each answer including repeated questions consumes exactly one question, invalid client keys do not', () => {
  const state = scene(); cast(state); target(state);
  assert.throws(() => ask(state, 'monster_count:water%20elemental'), /available question/);
  assert.equal(caster(state).pendingSpell.questionsAsked, 0);
  const first = ask(state, 'monster_count'); assert.equal(first.count, 3);
  state.entities.find(item => item.id === 'enemy').hp = 0;
  assert.equal(ask(state, 'monster_count').count, 2);
  assert.equal(ask(state, 'monster_count').questionsRemaining, 0);
  assert.equal(caster(state).pendingSpell.answers.length, 3);
  resolveSpeakWithDead(state, caster(state), { dismiss: true });
  assert.equal(caster(state).pendingSpell, null);
  assert.equal(caster(state).raw.pendingSpell, null);
});

test('repeat failures within 24 game hours use tier 3 wizard mishaps or priest penance, with exact expiry', () => {
  for (const spellClass of ['Wizard', 'Priest']) {
    const state = scene(spellClass); cast(state);
    resolveSpeakWithDead(state, caster(state), { dismiss: true });
    state.arcaneTime.elapsedMs = 5 * 60 * 60 * 1000;
    let calls = 0;
    const result = cast(state, 5, { rollMishaps: (_state, _caster, spell, options) => {
      calls++; assert.equal(spell, 'Speak With Dead'); assert.equal(options.tier, 3); return [{ name: 'Test Mishap' }];
    } });
    assert.equal(result.criticalFailure, true);
    assert.equal(result.repeated, true);
    assert.equal(calls, spellClass === 'Wizard' ? 1 : 0);
    if (spellClass === 'Priest') assert.deepEqual(caster(state).spellPenance['speak with dead'], { paid: false });
  }
  const fresh = scene();
  caster(fresh).raw.speakWithDeadCastTimes = [0];
  fresh.arcaneTime.elapsedMs = SPEAK_WITH_DEAD_DAY_MS;
  assert.equal(cast(fresh, 5).criticalFailure, false);
  assert.deepEqual(caster(fresh).raw.speakWithDeadCastTimes, [SPEAK_WITH_DEAD_DAY_MS]);
});

test('natural one is critical on first casting and uses the real higher-tier mishap table', () => {
  const state = scene();
  const result = cast(state, 1, { random: () => .99 });
  assert.equal(result.criticalFailure, true);
  assert.ok(result.mishaps.length);
  assert.equal(result.mishaps[0].tier, 3);
});

test('pending session, unlocked questions, answers, and repeat-cast history survive actual run serialization', () => {
  let state = scene(); cast(state, 20); target(state); ask(state, 'monster_types'); ask(state, 'treasure_types');
  state = hydrateDungeonState(serializeDungeonState(state));
  const view = speakWithDeadPresentation(state, caster(state));
  assert.equal(caster(state).pendingSpell.questionsAsked, 2);
  assert.equal(caster(state).pendingSpell.questionsTotal, 6);
  assert.ok(view.options.some(entry => entry.key === 'monster_count:water%20elemental'));
  assert.ok(view.options.some(entry => entry.key === 'treasure_names:weapons'));
  assert.equal(ask(state, 'monster_count:water%20elemental').count, 2);
  resolveSpeakWithDead(state, caster(state), { dismiss: true });
  state = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(cast(state, 5, { rollMishaps: () => [] }).criticalFailure, true);
});

test('unavailable, incapacitated, and silenced casters do not roll or create a repeated-cast penalty', () => {
  const state = scene(); caster(state).dead = true;
  assert.throws(() => cast(state), /conscious/);
  delete caster(state).dead; caster(state).failedSpellKeys = ['speak with dead'];
  assert.throws(() => cast(state), /unavailable/);
  assert.equal(caster(state).raw.speakWithDeadCastTimes, undefined);
});

test('truth answers include neutral and curious living monsters, excluding companions, charm, friendly, departed and dead records', () => {
  const state = scene();
  state.entities.push({ id: 'friendly', type: 'monster', hp: 5, attitude: 'friendly' },
    { id: 'charmed', type: 'monster', hp: 5, charm: { remainingMs: 100 } },
    { id: 'companion-original', type: 'monster', hp: 5 }, { id: 'neutral', type: 'monster', name: 'Sphinx', hp: 5, attitude: 'neutral' },
    { id: 'curious', type: 'monster', name: 'Elf', hp: 5, attitude: 'curious' },
    { id: 'departed', type: 'monster', name: 'Dragon', hp: 5, attitude: 'curious', leftPeacefully: true });
  state.characters.push({ id: 'companion', companion: { sourceMonsterId: 'companion-original' } });
  assert.equal(deadRemainingMonsters(state).length, 5);
  const answer = answerDeadQuestion(state, {}, 'monster_count');
  assert.equal(answer.reply, 'There are five of my fellows left on this dungeon level.');
  const session = {};
  answerDeadQuestion(state, session, 'monster_types');
  assert.deepEqual(session.monsterTypes, ['elf', 'giant frog', 'sphinx', 'water elemental']);
  assert.equal(answerDeadQuestion(state, session, 'monster_count:water%20elemental').reply, 'There are still two water elementals left on this dungeon level.');
  assert.equal(answerDeadQuestion(state, session, 'monster_count:sphinx').count, 1);
  assert.equal(answerDeadQuestion(state, session, 'monster_count:elf').count, 1);
});

test('secret doors reveal once through the normal helper, with no fabricated client door IDs', () => {
  const state = scene();
  state.entities.push({ id: 'secret', type: 'feature', subtype: 'door', secret: true, x: 18, y: 1, roomId: 'distant', wallSide: 'east' });
  const answer = answerDeadQuestion(state, {}, 'secret_doors');
  assert.deepEqual(answer.secretDoorIds, ['secret']);
  assert.equal(answer.reply, 'Yes. I have revealed them on your map.');
  assert.equal(state.entities.at(-1).secretFound, true);
  assert.equal(answerDeadQuestion(state, {}, 'secret_doors').reply, 'No.');
});

test('unfound treasure values round to nearest 100, categories merge shields and armor, dynamic value answers use 100-GP ranges', () => {
  const state = scene();
  state.entities.push({ id: 'known', type: 'treasure', name: 'Known Ruby', kind: 'gems', value: 500, revealed: true, found: true },
    { id: 'collected', type: 'treasure', value: 999, collected: true }, { id: 'destroyed', type: 'treasure', value: 999, destroyed: true },
    { id: 'shield', type: 'treasure', kind: 'shield', value: 450, name: 'Iron Shield' },
    { id: 'armor', type: 'treasure', kind: 'platemail', value: 500, name: 'Dented Plate Mail' });
  const session = {};
  assert.equal(deadRemainingTreasure(state).length, 4);
  assert.equal(answerDeadQuestion(state, session, 'treasure_value').estimate, 1100);
  const categories = answerDeadQuestion(state, session, 'treasure_types');
  assert.ok(categories.reply.includes('two shields or suits of armor'));
  assert.deepEqual(session.treasureCategories, ['armor', 'gems', 'weapons']);
  const cheap = answerDeadQuestion(state, session, 'treasure_value:weapons');
  assert.deepEqual([cheap.low, cheap.high], [1, 100]);
  const armor = answerDeadQuestion(state, session, 'treasure_value:armor');
  assert.deepEqual([armor.low, armor.high], [900, 1000]);
  state.entities.find(item => item.id === 'hidden-weapon').collected = true;
  assert.match(answerDeadQuestion(state, session, 'treasure_value:weapons').reply, /none left/);
});

test('treasure detail reveals real magic names without identifying the item and groups identical names', () => {
  const state = scene(), session = {};
  state.entities.push({ id: 'ruby2', type: 'treasure', kind: 'gems', name: 'Chipped Ruby', value: 170 },
    { id: 'magic-axe', type: 'treasure', kind: 'magic', value: 210, name: 'Magic Greataxe',
      gearItem: { type: 'weapon', name: 'Magic Greataxe', magic: { kind: 'weapon', trueName: '+1 Greataxe', identified: false } } });
  answerDeadQuestion(state, session, 'treasure_types');
  assert.equal(answerDeadQuestion(state, session, 'treasure_names:gems').reply, 'There are two chipped rubies.');
  assert.match(answerDeadQuestion(state, session, 'treasure_names:weapons').reply, /a \+1 greataxe/);
  assert.equal(state.entities.at(-1).gearItem.magic.identified, false);
  assert.equal(deadTreasureCategory({ kind: 'magic', gearItem: { magic: { kind: 'armor' } } }), 'armor');
});

test('English quantities and plural grammar cover user examples and compound names', () => {
  for (const [single, plural] of [['thief', 'thieves'], ['elf', 'elves'], ['dwarf', 'dwarves'], ['sphinx', 'sphinxes'],
    ['mushroomfolk', 'mushroomfolk'], ['chainmail', 'chainmail'], ['iron spikes', 'iron spikes'], ['torch', 'torches'],
    ['chipped ruby', 'chipped rubies'], ['giant frog', 'giant frogs'], ['potion of healing', 'potions of healing'],
    ['thieves', 'thieves'], ['elves', 'elves'], ['sphinxes', 'sphinxes']]) assert.equal(deadPlural(single), plural);
  assert.equal(deadNumber(6), 'six'); assert.equal(deadNumber(21), 'twenty-one'); assert.equal(deadNumber(123), 'one hundred twenty-three');
});

function fractionFor(entries, text) {
  const index = entries.findIndex(entry => entry.text === text); assert.ok(index >= 0, text);
  return (entries.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0) + entries[index].weight / 2) /
    entries.reduce((sum, entry) => sum + entry.weight, 0);
}

test('flavor uses exact authored weights, dynamic nouns and avoids duplicate I in the second sentence', () => {
  assert.equal(DEAD_VERBS.find(entry => entry.text === 'hated').weight, 10);
  assert.equal(DEAD_VERBS.find(entry => entry.text === 'secretly ate').weight, 5);
  assert.equal(DEAD_VERBS.find(entry => entry.text === 'sniffed').weight, 2);
  assert.equal(DEAD_ADJECTIVES.find(entry => entry.text === "St. Terragnis's").weight, 2);
  assert.equal(DEAD_NOUNS.find(entry => entry.text === '[gear_name]s').weight, 2);
  const rolls = [fractionFor(DEAD_VERBS, 'loved'), fractionFor(DEAD_ADJECTIVES, 'my'), fractionFor(DEAD_NOUNS, '[class_name]s'), 1,
    fractionFor(DEAD_VERBS, 'liked'), fractionFor(DEAD_NOUNS, '[ancestry_name]s'), 0];
  const reply = deadReminiscence({ characters: [] }, { classes: ['Thief'], ancestries: ['Elf'], rng: () => rolls.shift() });
  assert.equal(reply, 'When I was alive, I loved my thieves. I also liked elves.');
  assert.equal(deadWeightedChoice([{ text: 'first', weight: 10 }, { text: 'last', weight: 2 }], () => 1).text, 'last');
  assert.throws(() => deadWeightedChoice(DEAD_VERBS, () => -1), /Invalid/);
});

test('marriage rolls cannot produce son or daughter even for a repeating RNG', () => {
  const marriage = fractionFor(DEAD_VERBS, 'got married to');
  for (const value of [0, .2, .3, .5, .999]) {
    let count = 0;
    const reply = deadReminiscence(scene(), { rng: () => ++count === 1 || count === 4 ? marriage : value });
    assert.doesNotMatch(reply, /got married to (?:my )?(?:son|daughter)(?=[ .])/);
  }
});

test('unseen renderable treasure still counts; only explored renderable treasure or explicit discovery is found', () => {
  const state = scene();
  const item = { id: 'ground', type: 'treasure', kind: 'weapon', name: 'Dagger', value: 20, x: 10, y: 10,
    visible: true, revealed: true, groundTreasure: true };
  state.entities = [item];
  assert.equal(deadRemainingTreasure(state).length, 1);
  item.revealed = false;
  assert.equal(deadRemainingTreasure(state).length, 1, 'visible is not a discovery flag');
  state.visibility.exploredEver.add('10,10');
  assert.equal(deadRemainingTreasure(state).length, 0);
  item.visible = false;
  assert.equal(deadRemainingTreasure(state).length, 1, 'a hidden item on explored floor remains unfound');
  item.darknessRevealed = true;
  assert.equal(deadRemainingTreasure(state).length, 0);
});

test('treasure exploration belongs to its underpass route, including darkvision memory and hydrated arrays', () => {
  const state = scene();
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 10, y: 10 }], upperCrossings: [{ x: 10, y: 10 }], portals: [] }];
  state.entities = [{ id: 'ground', type: 'treasure', x: 10, y: 10, routeId: 'lower', visible: true, revealed: true }];
  state.visibility.exploredEver.add('10,10');
  state.visibility.routeExplored = { '': new Set(['10,10']) };
  assert.equal(deadRemainingTreasure(state).length, 1);
  state.visibility.routeDarkvisionExplored = { lower: ['10,10'] };
  assert.equal(deadRemainingTreasure(state).length, 0);
});

test('real generation marks unseen ground treasure renderable before exploration, and it remains in the divination answers', () => {
  const state = generateDungeon(564643, 1, { monsterTable: [{ name: 'Test foe', level: 1, hp: 10, ac: 10 }],
    architecturePattern: 'chain', reviewedLayouts: false, underpasses: false, pits: false });
  state.visibility = { exploredEver: new Set(), visibleNow: new Set() };
  const ground = state.entities.filter(item => item.type === 'treasure' && item.groundTreasure && item.visible && item.revealed && !item.collected);
  assert.ok(ground.length > 0);
  const remaining = deadRemainingTreasure(state);
  for (const item of ground) assert.ok(remaining.includes(item));
  const item = ground[0];
  state.visibility.exploredEver.add(`${item.x},${item.y}`);
  assert.ok(!deadRemainingTreasure(state).includes(item));
});

test('gift flavor uses some for plural or mass gifts, not a thieves or a chainmail', () => {
  for (const [noun, expected] of [['friends', 'some friends'], ['armor', 'some armor'], ['chair', 'a chair'], ['everyone', 'everyone']]) {
    const rolls = [fractionFor(DEAD_VERBS, 'gave a [noun] to'), fractionFor(DEAD_NOUNS, noun),
      fractionFor(DEAD_ADJECTIVES, 'my'), fractionFor(DEAD_NOUNS, 'wife'), fractionFor(DEAD_VERBS, 'liked'), fractionFor(DEAD_NOUNS, 'food')];
    const text = deadReminiscence(scene(), { rng: () => rolls.shift() });
    assert.ok(text.startsWith(`When I was alive, I gave ${expected} to my wife.`), text);
  }
  const rolls = [fractionFor(DEAD_VERBS, 'gave a [noun] to'), fractionFor(DEAD_NOUNS, '[class_name]s'), 0,
    fractionFor(DEAD_ADJECTIVES, 'my'), fractionFor(DEAD_NOUNS, 'wife'), fractionFor(DEAD_VERBS, 'liked'), fractionFor(DEAD_NOUNS, 'food')];
  assert.match(deadReminiscence({ characters: [] }, { classes: ['Thief'], rng: () => rolls.shift() }), /gave some thieves to my wife/);
});
