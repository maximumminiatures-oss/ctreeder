import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

const DAY = 24 * 60 * 60 * 1000;
const snapshot = result => result.state_json || result;
const actor = result => snapshot(result).characters.find(character => character.id === 'caster');
const pending = result => actor(result).pendingSpell;
const corpse = result => snapshot(result).entities.find(entity => entity.subtype === 'corpse-loot');
const entities = result => snapshot(result).entities;

function monster(id, name, x, y, extra = {}) {
  return { id, name, type: 'monster', hp: 20, maxHp: 20, ac: 10, x, y, roomId: x < 12 ? 'room' : 'distant', level: 1, I: 0, W: 0,
    visible: true, hostile: false, attitude: 'neutral', attitudeChecked: true, movement: '0',
    attack: '1 claw +0 (1d4)', languages: 'Common', stealthState: { attempted: true, revealed: true }, ...extra };
}

function scene({ spellClass = 'Wizard', intelligence = -2, stats = {} } = {}) {
  const width = 24, height = 16;
  return { seed: 456, level: 5, map: { width, height }, generation: { entranceRoomId: 'room' },
    rooms: [{ id: 'room', x: 0, y: 0, width: 12, height }, { id: 'distant', x: 12, y: 0, width: 12, height }], halls: [], decor: {},
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: i % width < 12 ? 'room' : 'distant', meta: {} })),
    visibility: { exploredEver: ['2,6'] }, arcaneTime: { elapsedMs: 0, crawlRemainderMs: 0 },
    timers: { torchElapsedMs: 0, torchDurationMs: 3600000, lightEverLit: true, nextWanderingCheckMs: DAY * 2 },
    characters: [{ id: 'caster', name: 'Dor', className: spellClass, ancestry: 'Human', level: 5,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 14, WIS: 18, CHA: 10, ...stats }, hp: 80, maxHitPoints: 80,
      x: 2, y: 6, roomId: 'room', spellsKnown: 'Speak With Dead', equipmentInitialized: true,
      lightSource: 'torch', lightRadius: 6,
      gear: [{ name: 'Dagger', type: 'weapon', equipped: true, quantity: 1, slots: 1 },
        { name: 'Torch', type: 'sundry', lit: true, equipped: true, quantity: 1, slots: 1 }] }],
    activeCharacterId: 'caster', player: { x: 2, y: 6, roomId: 'room', torchLit: true, lightSource: 'torch', lightRadius: 6 },
    combat: { active: false }, wanderingMonsters: { numerator: 0, denominator: 6 },
    entities: [monster('fallen', 'Runtime Fallen', 3, 6, { hp: 1, maxHp: 1, ac: 1, I: intelligence }),
      monster('neutral', 'Sphinx', 18, 14), monster('curious', 'Elf', 20, 14, { attitude: 'curious' }),
      monster('friendly', 'Ogre', 22, 14, { attitude: 'friendly' }),
      monster('charmed', 'Wight', 21, 14, { charm: { remainingMs: DAY } }),
      { id: 'dagger', type: 'treasure', kind: 'weapon', name: 'Chipped Dagger', value: 20, x: 20, y: 10, roomId: 'room', visible: false },
      { id: 'armor', type: 'treasure', kind: 'platemail', name: 'Plate Mail', value: 950, x: 21, y: 10, roomId: 'room', visible: false },
      { id: 'unseen-ground', type: 'treasure', kind: 'gems', name: 'Chipped Ruby', value: 170,
        x: 22, y: 10, roomId: 'room', visible: true, revealed: true, groundTreasure: true },
      { id: 'known-ground', type: 'treasure', kind: 'gems', name: 'Diamond', value: 5000,
        x: 2, y: 7, roomId: 'room', visible: true, revealed: true, groundTreasure: true },
      { id: 'taken', type: 'treasure', kind: 'weapon', name: 'Sword', value: 3000, x: 20, y: 11, collected: true },
      { id: 'destroyed', type: 'treasure', kind: 'clothing', name: 'Robe', value: 2000, x: 21, y: 11, destroyed: true },
      { id: 'secret', type: 'feature', subtype: 'door', secret: true, secretFound: false, revealed: false,
        visible: false, doorState: 'closed', wallSide: 'east', x: 23, y: 2, roomId: 'room' }]
  };
}

async function command(state, values, random = .5) {
  const previous = Math.random;
  Math.random = typeof random === 'function' ? random : () => random;
  try { return await executeGameCommand(snapshot(state), { character_id: 'caster', ...values }); }
  finally { Math.random = previous; }
}
const cast = (state, random = .5) => command(state, { type: 'spell', spell_name: 'Speak With Dead' }, random);
const resolve = (state, values) => command(state, { type: 'resolve_spell', ...values });
const ask = (state, option) => resolve(state, { option });

async function slay(state) {
  const setup = structuredClone(state);
  const bystanders = setup.entities.filter(entity => entity.type === 'monster' && entity.id !== 'fallen');
  // Defeat the corpse donor in isolation, then add the whole-level query fixtures without starting a second encounter.
  setup.entities = setup.entities.filter(entity => entity.type !== 'monster' || entity.id === 'fallen');
  let result = await command(setup, { type: 'normalize' });
  const index = actor(result).attacks.findIndex(attack => /^dagger\b/i.test(attack));
  assert.ok(index >= 0, 'normalization synthesizes the equipped dagger attack');
  result = await command(result, { type: 'attack', monster_id: 'fallen', attack_index: index });
  assert.ok(entities(result).find(entity => entity.id === 'fallen').defeated);
  assert.ok(corpse(result), 'the authoritative defeat path creates the actual corpse');
  assert.equal(snapshot(result).combat.active, false, JSON.stringify(snapshot(result).combat));
  snapshot(result).entities.push(...bystanders);
  return command(result, { type: 'normalize' });
}

async function startQuestions(state, random = .5) {
  let result = await cast(state, random);
  assert.equal(pending(result)?.spell, 'speak with dead');
  assert.equal(pending(result).phase, 'targeting');
  return resolve(result, { target_id: corpse(result).id });
}

test('authoritative defeat preserves a corpse source snapshot and Speak With Dead honors the -2 Intelligence boundary', async () => {
  for (const intelligence of [-2, -3]) {
    let result = await slay(scene({ intelligence }));
    assert.equal(corpse(result).sourceMonsterId, 'fallen');
    assert.equal(corpse(result).corpseSource.name, 'Runtime Fallen');
    assert.equal(corpse(result).corpseSource.I, intelligence);
    if (intelligence === -3) {
      const before = structuredClone(snapshot(result));
      await assert.rejects(() => cast(result), /Intelligence modifier.*-2/);
      assert.deepEqual(snapshot(result), before, 'rejected casting cannot mutate the supplied snapshot');
    } else {
      const saved = structuredClone(snapshot(result));
      saved.entities = saved.entities.filter(entity => entity.id !== 'fallen');
      result = await startQuestions(saved);
      assert.equal(pending(result).questionsTotal, 3);
      assert.equal(pending(result).targetId, corpse(result).id);
      result = await ask(result, 'monster_count');
      assert.equal(result.message, 'There are two of my fellows left on this dungeon level.');
    }
  }
});

test('authoritative questions include neutral and curious types, reject locked follow-ups, consume repeats and preserve saves', async () => {
  let result = await startQuestions(await slay(scene()));
  const before = structuredClone(snapshot(result));
  await assert.rejects(() => ask(result, 'monster_count:sphinx'), /available question/);
  assert.deepEqual(snapshot(result), before);
  result = await ask(result, 'monster_types');
  assert.deepEqual(pending(result).monsterTypes, ['elf', 'sphinx']);
  assert.match(result.message, /one elf and one sphinx/);
  result = await command(structuredClone(snapshot(result)), { type: 'normalize' });
  assert.equal(pending(result).questionsAsked, 1);
  result = await ask(result, 'monster_count:sphinx');
  assert.equal(result.message, 'There is still one sphinx left on this dungeon level.');
  result = await ask(result, 'monster_count:sphinx');
  assert.equal(pending(result).questionsAsked, 3);
  assert.equal(pending(result).phase, 'complete');
  assert.equal(pending(result).answers.length, 3);
  await assert.rejects(() => ask(result, 'monster_count'), /All questions/);
  result = await ask(result, '__finish__');
  assert.equal(pending(result), null);
});

test('authoritative natural twenty grants six questions with current treasure totals, type menus, ranges and secret-door answers', async () => {
  let result = await startQuestions(await slay(scene()), .999);
  assert.equal(pending(result).questionsTotal, 6);
  assert.equal(pending(result).phase, 'questions', 'there is no unapproved critical-choice phase');
  await assert.rejects(() => ask(result, 'treasure_names:weapons'), /available question/);
  result = await ask(result, 'treasure_value');
  assert.equal(result.message, "There's about 1,100 gp worth of loot left on this dungeon level.");
  result = await ask(result, 'treasure_types');
  assert.deepEqual(pending(result).treasureCategories, ['armor', 'gems', 'weapons']);
  result = await ask(result, 'treasure_value:armor');
  assert.equal(result.message, 'Their total is worth between 900 and 1,000 gp.');
  result = await ask(result, 'treasure_names:weapons');
  assert.equal(result.message, 'There is a chipped dagger.');
  result = await ask(result, 'secret_doors');
  assert.equal(result.message, 'Yes. I have revealed them on your map.');
  assert.equal(entities(result).find(entity => entity.id === 'secret').secretFound, true);
  result = await ask(result, 'secret_doors');
  assert.equal(result.message, 'No.');
  assert.equal(pending(result).questionsAsked, 6);
  assert.equal(pending(result).lastAnswer, 'No.');
  assert.equal(pending(result).phase, 'complete');
});

test('authoritative found/unfound answers count unseen renderable ground loot, but not collected, destroyed or explored ground loot', async () => {
  let result = await slay(scene());
  const state = snapshot(result);
  assert.ok(state.visibility.exploredEver.includes('2,7'), 'nearby ground treasure has actually been explored');
  assert.ok(!state.visibility.exploredEver.includes('22,10'), 'remote ground treasure has not been explored');
  assert.equal(entities(result).find(entity => entity.id === 'unseen-ground').revealed, true, 'generation-style renderability alone is not discovery');
  result = await startQuestions(result);
  result = await ask(result, 'treasure_types');
  assert.match(result.message, /one gem/);
  assert.doesNotMatch(result.message, /clothing/);
  result = await ask(result, 'treasure_names:gems');
  assert.equal(result.message, 'There is a chipped ruby.');
  const updated = structuredClone(snapshot(result));
  updated.entities.find(entity => entity.id === 'unseen-ground').found = true;
  result = await ask(updated, 'treasure_names:gems');
  assert.equal(result.message, 'There is none left that you have not found.', 'answers are recomputed from the latest authoritative state');
});

test('authoritative priest casts with WIS, not INT; an ordinary first failure loses the spell without penance', async () => {
  let result = await slay(scene({ spellClass: 'Priest', stats: { INT: 3, WIS: 18 } }));
  result = await cast(result, .4); // Natural 9 +4 WIS meets DC 13; INT would fail.
  assert.equal(pending(result)?.castingTotal, 13);
  assert.equal(pending(result).spellClass, 'priest');
  assert.match(result.message, /13 vs DC 13/);
  let failed = await slay(scene({ spellClass: 'Priest', stats: { INT: 18, WIS: 10 } }));
  failed = await cast(failed, .5); // Natural 11 +0 WIS fails; INT would pass.
  assert.equal(pending(failed), null);
  assert.ok(actor(failed).failedSpellKeys.includes('speak with dead'));
  assert.equal(actor(failed).spellPenance['speak with dead'], undefined);
  assert.match(failed.message, /11 vs DC 13/);
});

test('authoritative repeat-cast failures require priest penance before 24 hours, but not after a saved game-clock tick crosses the boundary', async () => {
  let result = await cast(await slay(scene({ spellClass: 'Priest' })));
  result = await resolve(result, { dismiss: true });
  const early = await cast(structuredClone(snapshot(result)), .3); // Natural 7 +4 WIS fails.
  assert.deepEqual(actor(early).spellPenance['speak with dead'], { paid: false });
  assert.match(early.message, /critical failure/);
  const beforeBoundary = structuredClone(snapshot(result));
  beforeBoundary.arcaneTime.elapsedMs = DAY - 15000;
  assert.ok(!actor(beforeBoundary).focusSpell && !actor(beforeBoundary).wizardEffects.length && !actor(beforeBoundary).transformationEffects.length,
    'elapsed time must advance even with no ongoing spell');
  const ticked = await command(beforeBoundary, { type: 'tick', elapsed_ms: 15000 });
  assert.equal(snapshot(ticked).arcaneTime.elapsedMs, DAY);
  const late = await cast(ticked, .3);
  assert.ok(actor(late).failedSpellKeys.includes('speak with dead'));
  assert.equal(actor(late).spellPenance['speak with dead'], undefined);
  assert.doesNotMatch(late.message, /critical failure/);
  assert.deepEqual(actor(late).raw.speakWithDeadCastTimes, [DAY]);
});

test('authoritative repeated wizard failure invokes the real tier 3 mishap handler instead of priest penance', async () => {
  let result = await cast(await slay(scene()));
  result = await resolve(result, { dismiss: true });
  let rolls = 0;
  result = await cast(result, () => ++rolls === 1 ? .45 : .999); // Natural 10 +2 fails; mishap 12 applies Uncontained Channeling.
  assert.equal(pending(result), null);
  assert.match(result.message, /critical failure/);
  assert.ok(actor(result).failedSpellKeys.includes('speak with dead'));
  assert.equal(actor(result).spellPenance['speak with dead'], undefined);
  assert.ok(actor(result).wizardEffects.some(effect => effect.type === 'unstable' && effect.rounds === 10 && effect.maxTier === 3),
    'the real higher-tier mishap modifies persisted wizard state');
});
