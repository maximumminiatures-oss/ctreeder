import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { enchantedEquipment, identifyMagicItem } from '../../S3_content/src/magic-items.js';

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

const SPELLS = 'Augury, Bless, Blind/Deafen, Cleansing Weapon, Smite, Zone of Truth, Holy Weapon, Protection from Evil';
function scene() {
  const width = 15, height = 15;
  return {
    seed: 123, level: 2, map: { width, height }, generation: { entranceRoomId: 'room', treasureTargetGp: 1000 },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }],
    visibility: { exploredEver: Array.from({ length: width * height }, (_, i) => `${i % width},${Math.floor(i / width)}`) },
    entities: [{ id: 'stairs', type: 'stairs', subtype: 'up', x: 3, y: 7, roomId: 'room' },
      { id: 'foe', type: 'monster', name: 'Runtime Sentinel', hp: 100, maxHp: 100, ac: 8, x: 5, y: 7, roomId: 'room',
        hostile: false, attitude: 'neutral', attitudeChecked: true, visible: true, attack: '1 claw +0 (1d4)',
        languages: 'Common', level: 2, tags: ['humanoid'], W: 0, I: 0, movement: '0',
        stealthState: { attempted: true, revealed: true } },
      { id: 'treasure', type: 'treasure', name: 'Coins', value: 100, x: 9, y: 9, roomId: 'room' }],
    characters: [{ id: 'priest', name: 'Dor', ancestry: 'Half-Orc', className: 'Priest', level: 4,
      alignment: 'Lawful', languages: 'Common', stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 12, CHA: 10 },
      spellsKnown: SPELLS, hp: 50, maxHitPoints: 50, x: 3, y: 7, roomId: 'room', luckTokens: 0, luckToken: false,
      equipmentInitialized: true, lightSource: 'torch', lightRadius: 6,
      gear: [{ name: 'Mace', type: 'weapon', equipped: true, quantity: 1 }, { name: 'Torch', lit: true, equipped: true, quantity: 1 }] }],
    player: { x: 3, y: 7, roomId: 'room', torchLit: true, lightSource: 'torch', lightRadius: 6 }, activeCharacterId: 'priest',
    combat: { active: false, round: 1, turnIndex: 0, movementRemaining: 6, actionUsed: false,
      turnOrder: [{ type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }], playerOrderIds: ['priest'], monsterIds: ['foe'] }
  };
}
async function withRandom(value, fn) {
  const original = Math.random;
  Math.random = typeof value === 'function' ? value : () => value;
  try { return await fn(); } finally { Math.random = original; }
}
const actor = state => state.characters.find(character => character.id === 'priest');
const foe = state => state.entities.find(entity => entity.id === 'foe');
const weapon = state => actor(state).gear.find(item => item.name === 'Mace');
const rawState = result => result.state_json || result;
const command = (state, values, random = .5) => withRandom(random, () => executeGameCommand(rawState(state), { character_id: 'priest', ...values }));
const cast = (state, name, random = .5) => command(state, { type: 'spell', spell_name: name }, random);
const resolve = (state, selection, random = .5) => command(state, { type: 'resolve_spell', ...selection }, random);
const tick = (state, random = .5) => command(state, { type: 'tick', elapsed_ms: 10000 }, random);
function wisdom(state, score) {
  actor(state).stats.WIS = score;
  if (actor(state).raw?.stats) actor(state).raw.stats.WIS = score;
}
async function castBlind(state, mode = 'blind', initial = .5, choice = null, targetId = 'foe') {
  let result = await cast(state, 'Blind/Deafen', initial);
  if (choice) result = await resolve(result, { choice });
  if (actor(result.state_json).pendingSpell?.phase === 'options') result = await resolve(result, { option: mode });
  return resolve(result, { target_id: targetId });
}

test('authoritative Bless targets self after casting, grants one Luck Token, and cannot duplicate it', async () => {
  let result = await cast(scene(), 'Bless');
  assert.equal(actor(result.state_json).pendingSpell.spell, 'bless');
  assert.equal(actor(result.state_json).luckTokens, 0, 'casting alone does not grant luck before target selection');
  result = await resolve(result, { target_id: 'priest' });
  assert.equal(actor(result.state_json).luckTokens, 1);
  assert.equal(actor(result.state_json).luckToken, true);
  assert.equal(actor(result.state_json).pendingSpell, null);
  const second = await cast(result, 'Bless');
  const before = structuredClone(second.state_json);
  await assert.rejects(() => resolve(second, { target_id: 'priest' }), /already.*Luck Token/i);
  assert.deepEqual(second.state_json, before, 'invalid resolution does not mutate the supplied snapshot');
  assert.equal(actor(second.state_json).pendingSpell.spell, 'bless');
});

test('authoritative critical Bless grants luck to two distinct nearby party members, never twice to one target', async () => {
  const state = scene();
  state.characters.push({ id: 'ally', name: 'Ad', className: 'Fighter', ancestry: 'Halfling', level: 1, hp: 20, maxHitPoints: 20,
    x: 4, y: 8, roomId: 'room', stats: { STR: 10, DEX: 10, WIS: 10 }, gear: [], luckTokens: 0, luckToken: false });
  let result = await cast(state, 'Bless', .999);
  assert.equal(actor(result.state_json).pendingSpell.phase, 'critical');
  result = await resolve(result, { choice: 'targets' });
  result = await resolve(result, { target_id: 'priest' });
  assert.equal(actor(result.state_json).luckTokens, 1);
  assert.equal(actor(result.state_json).pendingSpell.remaining, 1);
  await assert.rejects(() => resolve(result, { target_id: 'priest' }), /different|distinct/i);
  assert.equal(actor(result.state_json).pendingSpell.remaining, 1);
  result = await resolve(result, { target_id: 'ally' });
  assert.equal(actor(result.state_json).luckTokens, 1);
  assert.equal(result.state_json.characters.find(character => character.id === 'ally').luckTokens, 1);
  assert.equal(actor(result.state_json).pendingSpell, null);
});

test('authoritative Smite automatically hits and deals exactly four damage at rng .5, without an attack roll', async () => {
  let result = await cast(scene(), 'Smite');
  assert.equal(foe(result.state_json).hp, 100);
  result = await resolve(result, { target_id: 'foe' });
  assert.equal(foe(result.state_json).hp, 96);
  assert.equal(actor(result.state_json).pendingSpell, null);
  await assert.rejects(() => resolve(result, { target_id: 'foe' }));
  assert.equal(foe(result.state_json).hp, 96);
});

test('authoritative Cleansing Weapon lasts five rounds and expires through saved tick commands', async () => {
  let result = await cast(scene(), 'Cleansing Weapon');
  result = await resolve(result, { target_id: 'priest' });
  assert.equal(weapon(result.state_json).cleansingWeapon.rounds, 5);
  for (let remaining = 4; remaining >= 1; remaining--) {
    result = await tick(result);
    assert.equal(weapon(result.state_json).cleansingWeapon.rounds, remaining);
  }
  result = await tick(result);
  assert.equal(weapon(result.state_json).cleansingWeapon, undefined);
});

for (const holderKind of ['monster gear', 'dropped gear', 'corpse gear']) {
  test(`authoritative isolated Cleansing Weapon timer expires on ${holderKind} without another active buff`, async () => {
    const state = scene();
    const item = { name: 'Mace', type: 'weapon', quantity: 1, equipped: true,
      cleansingWeapon: { casterId: 'priest', rounds: 1, diceCount: 1, damageType: 'radiant', magical: true } };
    if (holderKind === 'monster gear') foe(state).gear = [item];
    else if (holderKind === 'dropped gear') state.entities.push({ id: 'dropped-mace', type: 'feature', subtype: 'dropped-equipment',
      name: 'Mace', x: 8, y: 8, roomId: 'room', visible: true, gearItem: item });
    else state.entities.push({ id: 'corpse', type: 'feature', subtype: 'corpse', name: 'Fallen adventurer',
      x: 8, y: 8, roomId: 'room', visible: true,
      characterCorpse: { id: 'fallen', name: 'Fallen', className: 'Fighter', dead: true, hp: 0, gear: [item] } });
    const heldItem = snapshot => holderKind === 'monster gear' ? foe(snapshot).gear[0]
      : holderKind === 'dropped gear' ? snapshot.entities.find(entity => entity.id === 'dropped-mace').gearItem
      : snapshot.entities.find(entity => entity.id === 'corpse').characterCorpse.gear[0];
    let result = await command(state, { type: 'normalize' });
    assert.equal(heldItem(result.state_json).cleansingWeapon.rounds, 1, 'normalization retains the active item effect');
    for (const character of result.state_json.characters) {
      assert.ok(!character.focusSpell);
      assert.ok(!character.faithEffects?.length && !character.potionEffects?.length && !character.transformationEffects?.length);
      assert.ok(!character.gear.some(gear => gear.holyWeapon || gear.cleansingWeapon), 'no party-held buff enables the timer accidentally');
    }
    result = await tick(result);
    assert.equal(heldItem(result.state_json).cleansingWeapon, undefined, holderKind);
    assert.equal(heldItem(result.state_json).name, 'Mace', 'expiry removes the buff, not its gear');
  });
}

test('authoritative Cleansing Weapon adds 1d6 against undead or 1d4 otherwise, stacking Holy Weapon and Mighty', async () => {
  for (const [tags, expectedDamage] of [[['undead'], 10], [['humanoid'], 9]]) {
    const state = scene(); foe(state).tags = tags; foe(state).x = 4;
    let result = await cast(state, 'Holy Weapon');
    result = await resolve(result, { target_id: 'priest' });
    result = await cast(result, 'Cleansing Weapon');
    result = await resolve(result, { target_id: 'priest' });
    assert.equal(weapon(result.state_json).holyWeapon.bonus, 1);
    assert.equal(weapon(result.state_json).cleansingWeapon.diceCount, 1);
    // Mace 1d6 (4) + Mighty (1) + Holy Weapon (1) + radiant 1d6 (4) / 1d4 (3).
    const attackIndex = actor(result.state_json).attacks.findIndex(attack => /^mace\b/i.test(attack));
    assert.ok(attackIndex >= 0, 'the equipped mace has a synthesized attack');
    result = await command(result, { type: 'attack', monster_id: 'foe', attack_index: attackIndex });
    assert.equal(foe(result.state_json).hp, 100 - expectedDamage, tags.join(','));
    assert.ok(result.state_json.rollHistory.some(entry => /cleansing weapon/i.test(JSON.stringify(entry))), 'radiant dice remain in roll details');
  }
});

test('authoritative fire resistance does not halve Cleansing Weapon radiant damage on a flaming weapon', async () => {
  for (const [resistant, expectedDamage] of [[false, 12], [true, 7]]) {
    const state = scene(); foe(state).x = 4;
    const mace = enchantedEquipment({ name: 'Mace', costGp: 6 }, 'weapon', 1);
    identifyMagicItem(mace); mace.equipped = true;
    Object.assign(mace.magic, { element: 'fire', elementDice: '1d4' });
    actor(state).gear[0] = mace;
    if (resistant) foe(state).gear = [{ name: 'Fire-resistant armor', type: 'armor', equipped: true, magic: { resistance: 'fire' } }];
    let result = await cast(state, 'Cleansing Weapon');
    result = await resolve(result, { target_id: 'priest' });
    const attackIndex = actor(result.state_json).attacks.findIndex(attack => /\bmace\b/i.test(attack));
    assert.ok(attackIndex >= 0);
    result = await command(result, { type: 'attack', monster_id: 'foe', attack_index: attackIndex });
    // Ordinary damage: 1d6 (4) +1 Mighty +1 magic +1d4 fire (3) =9; radiant is an additional 3.
    assert.equal(foe(result.state_json).hp, 100 - expectedDamage, resistant ? 'floor(9/2) +3 radiant' : '9 +3 radiant');
  }
});

test('authoritative Blind/Deafen uses DC 12, with failure below twelve and success at exactly twelve', async () => {
  const low = scene(); wisdom(low, 10);
  const failed = await cast(low, 'Blind/Deafen');
  assert.equal(actor(failed.state_json).pendingSpell, null);
  assert.ok(actor(failed.state_json).failedSpellKeys.includes('blind deafen'));
  assert.match(failed.message, /DC 12/);
  const passed = await castBlind(scene());
  assert.ok(foe(passed.state_json).conditions.blind);
  assert.equal(actor(passed.state_json).focusSpell.lastCheck, 12);
});

test('authoritative Blind Focus natural twenty never offers another critical, preserving initial choices', async () => {
  for (const initial of [.5, .999]) {
    let result = await castBlind(scene(), 'blind', initial, initial === .999 ? 'both' : null);
    assert.ok(foe(result.state_json).conditions.blind);
    assert.equal(Boolean(foe(result.state_json).conditions.deafened), initial === .999);
    result = await tick(result, .999);
    const caster = actor(result.state_json);
    assert.equal(caster.pendingSpell, null);
    assert.equal(caster.focusSpell.spell, 'blind deafen');
    assert.equal(caster.focusSpell.critical, initial === .999);
    assert.equal(caster.focusSpell.criticalChoice, initial === .999 ? 'both' : null);
    assert.equal(Boolean(foe(result.state_json).conditions.deafened), initial === .999);
  }
});

test('authoritative failed ordinary Focus removes Blind but does not lose the known spell', async () => {
  let result = await castBlind(scene());
  wisdom(result.state_json, 10);
  result = await tick(result);
  assert.equal(actor(result.state_json).focusSpell, null);
  assert.equal(foe(result.state_json).conditions?.blind, undefined);
  assert.ok(!actor(result.state_json).failedSpellKeys.includes('blind deafen'));
});

test('authoritative critical Blind Focus checks DC 12 at combat-turn start without skipping or upgrading', async () => {
  for (const { wis, random, succeeds, total } of [
    { wis: 10, random: .5, succeeds: false, total: 11 },
    { wis: 12, random: .5, succeeds: true, total: 12 },
    { wis: 10, random: .999, succeeds: true, total: 20 },
  ]) {
    let result = await castBlind(scene(), 'blind', .999, 'both');
    const state = result.state_json;
    wisdom(state, wis);
    state.characters.push({ id: 'ally', name: 'Ad', className: 'Fighter', ancestry: 'Halfling', level: 1, hp: 20, maxHitPoints: 20,
      x: 2, y: 7, roomId: 'room', stats: { STR: 10, DEX: 10, WIS: 10 }, gear: [] });
    state.activeCharacterId = 'ally';
    Object.assign(state.player, { x: 2, y: 7 });
    Object.assign(foe(state), { hostile: true, attitude: 'combat' });
    Object.assign(state.combat, { active: true, round: 2, turnIndex: 0, sideFirst: 'characters', actionUsed: false,
      turnOrder: [{ type: 'character', id: 'ally' }, { type: 'character', id: 'priest' }, { type: 'monster', id: 'foe' }],
      playerOrderIds: ['ally', 'priest'], pendingPlayerIds: [], monsterIds: ['foe'] });
    actor(state).focusSpell.lastTurn = '1:priest';
    const beforeHistory = state.rollHistory.length;
    result = await command(state, { type: 'end_turn', character_id: 'ally' }, random);
    const caster = actor(result.state_json);
    assert.equal(result.state_json.activeCharacterId, 'priest');
    const focusEntries = result.state_json.rollHistory.slice(0, result.state_json.rollHistory.length - beforeHistory)
      .filter(entry => /Focus.*DC 12/.test(JSON.stringify(entry)));
    assert.equal(focusEntries.length, 1, 'start-of-turn maintenance rolls once instead of preassigning lastTurn and skipping');
    assert.equal(Boolean(caster.focusSpell), succeeds, `${total} versus DC 12`);
    assert.equal(caster.pendingSpell, null, 'maintenance never creates a new critical-choice prompt');
    assert.equal(Boolean(foe(result.state_json).conditions?.blind), succeeds);
    assert.equal(Boolean(foe(result.state_json).conditions?.deafened), succeeds);
    if (succeeds) {
      assert.equal(caster.focusSpell.lastTurn, '2:priest');
      assert.equal(caster.focusSpell.lastCheck, total);
      assert.equal(caster.focusSpell.criticalChoice, 'both');
    }
  }
});

test('authoritative Blind senses clear when another Focus spell is cast or the caster dies', async () => {
  let result = await castBlind(scene(), 'blind', .999, 'both');
  result = await cast(result, 'Protection from Evil');
  assert.equal(actor(result.state_json).focusSpell.spell, 'protection from evil');
  assert.equal(foe(result.state_json).conditions?.blind, undefined);
  assert.equal(foe(result.state_json).conditions?.deafened, undefined);
  result = await castBlind(scene(), 'blind', .999, 'both');
  Object.assign(actor(result.state_json), { hp: 0, dead: true });
  if (actor(result.state_json).raw) Object.assign(actor(result.state_json).raw, { hp: 0, dead: true });
  result = await command(result, { type: 'normalize' });
  assert.equal(actor(result.state_json).focusSpell, null);
  assert.equal(foe(result.state_json).conditions?.blind, undefined);
  assert.equal(foe(result.state_json).conditions?.deafened, undefined);
});

test('authoritative Deafen immediately checks an affected focusing caster for distraction', async () => {
  const state = scene();
  state.characters.push({ id: 'wizard', name: 'Badzog', className: 'Wizard', ancestry: 'Human', hp: 30, maxHitPoints: 30,
    level: 4, stats: { INT: 10, WIS: 10, DEX: 10 }, x: 4, y: 7, roomId: 'room', gear: [],
    languages: 'Common', focusSpell: { spell: 'protection from evil', spellClass: 'wizard', radius: 1, centerId: 'wizard', opposes: ['chaotic'], critical: false } });
  let result = await cast(state, 'Blind/Deafen');
  result = await resolve(result, { option: 'deaf' });
  result = await resolve(result, { target_id: 'wizard' }, .01);
  const wizard = result.state_json.characters.find(character => character.id === 'wizard');
  assert.ok(wizard.conditions.deafened);
  assert.equal(wizard.focusSpell, null, 'failing the immediate distraction check ends existing Focus');
  assert.ok(result.state_json.rollHistory.some(entry => /Focus.*deaf|deaf.*Focus/i.test(JSON.stringify(entry))));
});

test('authoritative blinded monsters attack remembered adjacent squares at disadvantage without tracking a moving party member', async () => {
  for (const scenario of ['lower-die-miss', 'stationary-hit', 'moved-empty-miss']) {
    const state = scene(); wisdom(state, 18);
    state.combat.active = true;
    Object.assign(foe(state), { x: 4, y: 7, hostile: true, attitude: 'combat' });
    let result = await castBlind(state);
    const remembered = [{ x: 3, y: 7, routeId: '' }];
    assert.deepEqual(foe(result.state_json).blindTargetMemory, remembered);
    assert.ok(foe(result.state_json).conditions.blind);
    if (scenario === 'moved-empty-miss') {
      result = await command(result, { type: 'move', dx: 0, dy: -1 });
      assert.deepEqual([actor(result.state_json).x, actor(result.state_json).y], [3, 6]);
      assert.deepEqual(foe(result.state_json).blindTargetMemory, remembered, 'movement does not update unseen coordinates');
    }
    const hpBefore = actor(result.state_json).hp, historyBefore = result.state_json.rollHistory.length;
    const rolls = [.8, .15];
    const random = scenario === 'lower-die-miss' ? () => rolls.shift() ?? .5 : scenario === 'stationary-hit' ? .8 : .999;
    result = await command(result, { type: 'end_turn' }, random);
    const addedHistory = result.state_json.rollHistory.slice(0, result.state_json.rollHistory.length - historyBefore);
    const attacks = addedHistory.filter(entry => entry.label === 'Attack');
    assert.equal(attacks.length, 1, `the monster spends one turn attacking: ${JSON.stringify({ scenario, history: addedHistory, message: result.message })}`);
    assert.deepEqual([foe(result.state_json).x, foe(result.state_json).y], [4, 7], 'blindness does not permit chasing current coordinates');
    assert.deepEqual(foe(result.state_json).blindTargetMemory, remembered);
    assert.equal(result.state_json.combat.round, 2);
    assert.equal(result.state_json.combat.turnOrder[result.state_json.combat.turnIndex].id, 'priest');
    if (scenario === 'moved-empty-miss') {
      assert.equal(actor(result.state_json).hp, hpBefore, 'even a natural twenty cannot hit a creature outside the guessed square');
      assert.match(attacks[0].detail, /remembered square.*misses/i);
      assert.doesNotMatch(attacks[0].detail, /attacks Dor/i);
    } else {
      assert.match(attacks[0].detail, /attacks Dor at disadvantage/i);
      assert.equal(actor(result.state_json).hp, hpBefore - (scenario === 'stationary-hit' ? 4 : 0));
      if (scenario === 'lower-die-miss') assert.match(attacks[0].detail, /4 misses/i, 'disadvantage chooses four rather than seventeen');
    }
  }
});

test('authoritative Zone of Truth rejects combat and targets without a shared language', async () => {
  const combat = scene(); combat.combat.active = true;
  await assert.rejects(() => cast(combat, 'Zone of Truth'), /outside combat/i);
  const foreign = scene(); foe(foreign).languages = 'Draconic';
  const result = await cast(foreign, 'Zone of Truth');
  await assert.rejects(() => resolve(result, { target_id: 'foe' }), /shared language/i);
  assert.equal(actor(result.state_json).pendingSpell.spell, 'zone of truth');
});

test('authoritative Zone of Truth permits one question per successful Focus round and rejects unsupported questions', async () => {
  let result = await cast(scene(), 'Zone of Truth');
  result = await resolve(result, { target_id: 'foe' });
  assert.equal(actor(result.state_json).focusSpell.questionAvailable, true);
  await assert.rejects(() => resolve(result, { question: 'not_a_supported_question' }), /supported.*question/i);
  result = await resolve(result, { question: 'color' });
  assert.match(result.message, /I like/i);
  assert.equal(actor(result.state_json).focusSpell.questionsAsked, 1);
  assert.equal(actor(result.state_json).focusSpell.questionAvailable, false);
  await assert.rejects(() => resolve(result, { question: 'monsters' }), /Maintain Focus|another question/i);
  result = await tick(result);
  assert.equal(actor(result.state_json).focusSpell.questionAvailable, true);
  result = await resolve(result, { question: 'monsters' });
  assert.match(result.message, /1.*haven't slain/i);
  assert.equal(actor(result.state_json).focusSpell.questionsAsked, 2);
});

test('authoritative Augury resolves its assessment rather than leaving a pending spell or returning an empty result', async () => {
  let result = await cast(scene(), 'Augury');
  assert.equal(actor(result.state_json).pendingSpell.spell, 'augury');
  result = await resolve(result, { question: 'continue' });
  assert.equal(actor(result.state_json).pendingSpell, null);
  assert.match(result.message, /^(?:Yes|Possibly|No)\.$/);
  assert.ok(result.state_json.spellDialogMessages.some(dialog => dialog.text === result.message));
});

test('authoritative Augury natural twenty adds an explanation without a critical-choice phase', async () => {
  let result = await cast(scene(), 'Augury', .999);
  assert.equal(actor(result.state_json).pendingSpell.phase, 'options');
  result = await resolve(result, { question: 'continue' });
  assert.equal(actor(result.state_json).pendingSpell, null);
  assert.ok(result.state_json.spellDialogMessages.some(dialog => /heuristic/.test(dialog.text)));
});
