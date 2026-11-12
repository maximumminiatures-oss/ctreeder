import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { initializeImportChoices } from '../../S3_content/src/class-progression.js';
import { buildMonsterCompanion } from '../../S3_content/src/companions.js';
import { historyMonsterColor } from '../../S3_content/src/roll-history.js';

const root = new URL('../../S3_content/', import.meta.url);
const source = await readFile(new URL('src/main.js', root), 'utf8');
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene() {
  const width = 7, height = 7;
  return {
    seed: 123, level: 1, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room' })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }],
    visibility: { exploredEver: Array.from({ length: width * height }, (_, i) => `${i % width},${Math.floor(i / width)}`) },
    entities: [{ id: 'foe', type: 'monster', name: 'Stingbat', hp: 40, maxHp: 40, ac: 10, level: 1,
      x: 3, y: 2, roomId: 'room', visible: true, hostile: true, attitude: 'combat', attitudeChecked: true,
      attack: '1 claw +0 (1d4)', stealthState: { attempted: true, revealed: true } }],
    characters: [{ id: 'hero', name: 'Shrigark', className: 'Wizard', ancestry: 'Goblin', level: 1,
      hp: 40, maxHitPoints: 40, armorClass: 10, x: 2, y: 2, roomId: 'room',
      stats: { STR: 10, DEX: 14, INT: 14, CON: 10, WIS: 10, CHA: 10 }, spellsKnown: 'Burning Hands, Light',
      lightSpellLit: true, lightSource: 'light-spell', lightRadius: 12,
      equipmentInitialized: true, gear: [{ name: 'Dagger', type: 'weapon', equipped: true, slots: 1 }] }],
    player: { x: 2, y: 2, roomId: 'room', torchLit: true, lightSource: 'light-spell', lightRadius: 12 },
    activeCharacterId: 'hero', rollHistory: [], timers: { lightEverLit: true, lastTickAt: Date.now() },
    wanderingMonsters: { numerator: 0, denominator: 6 },
    combat: { active: true, round: 1, turnIndex: 0, actionUsed: false, movementRemaining: 6,
      turnOrder: [{ type: 'character', id: 'hero' }, { type: 'monster', id: 'foe' }],
      playerOrderIds: ['hero'], monsterIds: ['foe'] }
  };
}

async function command(state, value, random = .5) {
  const previous = Math.random;
  Math.random = typeof random === 'function' ? random : () => random;
  try { return await executeGameCommand(state, { character_id: 'hero', ...value }); }
  finally { Math.random = previous; }
}

function renderedHistory(state) {
  const view = new JSDOM('<ol id="history"></ol>');
  const context = vm.createContext({ state, diceHistory: JSON.parse(JSON.stringify(state.rollHistory)),
    SERVER_RUNTIME: false, document: view.window.document, window: view.window,
    ui: { diceHistory: view.window.document.querySelector('#history') },
    canReadFeedback: () => true, historyMonsterColor, getCharacterColorValue: () => '#a02080'
  });
  vm.runInContext(source.slice(source.indexOf("let diceHistoryRenderKey = ''"), source.indexOf('function characterSheetInteractionKey(')), context);
  context.renderDiceHistory();
  return { view, cards: view.window.document.querySelector('#history').children };
}

for (const [name, random, total, outcome, damage] of [
  ['hit', .6, 15, 'hits.', true], ['miss', .1, 5, 'miss.', false],
  ['critical', .999, 22, 'critical!', true], ['fumble', 0, 3, 'fumble!', false]
]) {
  test(`authoritative ${name} renders the actor, Dagger total vs target AC, resolution and only actual damage`, async () => {
    const normalized = await command(scene(), { type: 'normalize' });
    const attackIndex = normalized.state_json.characters[0].attacks.findIndex(text => /^Dagger:/i.test(text));
    assert.ok(attackIndex >= 0, 'the fixture must have an equipped dagger attack');
    const result = await command(normalized.state_json, { type: 'attack', monster_id: 'foe', attack_index: attackIndex }, random);
    const entry = result.state_json.rollHistory.find(entry => entry.label === 'Attack');
    assert.equal(entry.rollCard.results[0].value, total);
    assert.equal(Boolean(entry.rollCard.damage), damage);
    assert.equal(result.state_json.combat.actionUsed, true);
    const rendered = renderedHistory({ ...result.state_json, rollHistory: [entry] });
    try {
      const card = rendered.cards[0], body = card.querySelector('.roll-card-result');
      assert.equal(card.querySelector('h3').textContent, 'Shrigark');
      assert.equal(body.querySelector('em').textContent, 'Attack: ');
      assert.equal(body.textContent, `Attack: Dagger: ${total} vs. the stingbat's AC 10, ${outcome}${damage ? ` ${entry.rollCard.damage.value} damage to the stingbat.` : ''}`);
      assert.equal(body.querySelector('strong').textContent, String(total));
      assert.equal(Boolean(body.querySelector('.die-minimum')), name === 'fumble');
      assert.equal(Boolean(body.querySelector('.die-maximum')), name === 'critical');
      assert.ok(body.querySelector('strong').getAttribute('aria-label').includes('To hit:'));
    } finally { rendered.view.window.close(); }
  });
}

test('authoritative Burning Hands release renders damage for every target and deaths only for defeated targets', async () => {
  const state = scene();
  state.entities[0].hp = 3;
  state.entities.push(
    { ...structuredClone(state.entities[0]), id: 'survivor', name: 'Orc', hp: 8, x: 2, y: 3 },
    { ...structuredClone(state.entities[0]), id: 'dead-two', name: 'Rat', hp: 2, x: 2, y: 1 }
  );
  state.characters.push({ id: 'ally', name: 'Ad', className: 'Fighter', ancestry: 'Halfling', hp: 20, maxHitPoints: 20,
    x: 1, y: 2, roomId: 'room', stats: { STR: 10, DEX: 10, CON: 10 }, gear: [] });
  state.combat.turnOrder.splice(1, 0, { type: 'character', id: 'ally' });
  state.combat.playerOrderIds.push('ally');
  state.combat.monsterIds.push('survivor', 'dead-two');
  let result = await command(state, { type: 'spell', spell_name: 'Burning Hands' });
  const castEntry = result.state_json.rollHistory.find(entry => entry.rollCard?.type === 'Spellcasting');
  assert.ok(castEntry?.rollCard?.results?.length, JSON.stringify({ message: result.message, history: result.state_json.rollHistory }));
  const castView = renderedHistory({ ...result.state_json, rollHistory: [castEntry] });
  try {
    assert.equal(castView.cards[0].querySelector('.roll-card-result').textContent,
      `Spellcasting: Burning Hands DC 11: ${castEntry.rollCard.results[0].value}, success.`);
  } finally { castView.view.window.close(); }
  result = await command(result.state_json, { type: 'resolve_spell' }, .4);
  const release = result.state_json.rollHistory.find(entry => entry.rollCard?.type === 'Spell Release');
  assert.ok(release);
  assert.deepEqual(release.rollCard.targets.map(({ name, damage, dead }) => ({ name, damage, dead })), [
    { name: 'Ad', damage: 3, dead: false }, { name: 'Stingbat', damage: 3, dead: true },
    { name: 'Orc', damage: 3, dead: false }, { name: 'Rat', damage: 3, dead: true }
  ]);
  assert.equal(result.state_json.entities.find(entity => entity.id === 'survivor').hp, 5);
  assert.equal(result.state_json.characters.find(member => member.id === 'ally').hp, 17);
  assert.equal(result.state_json.characters[0].pendingSpell, null);
  const rendered = renderedHistory({ ...result.state_json, rollHistory: [release] });
  try {
    assert.equal(rendered.cards[0].querySelector('.roll-card-result').textContent,
      'Shrigark released Burning Hands: 3 damage to Ad, 3 damage to Stingbat, 3 damage to Orc, 3 damage to Rat.');
    assert.equal(rendered.cards[0].querySelector('.roll-card-detail').textContent, 'Stingbat dies. Rat dies.');
    assert.deepEqual([...rendered.cards[0].querySelectorAll('.roll-card-result strong')].filter(node => node.textContent === '3').map(node => node.textContent), ['3', '3', '3', '3']);
    assert.ok(!rendered.cards[0].textContent.includes('Orc dies'));
    assert.ok(!rendered.cards[0].textContent.includes('Ad dies'));
  } finally { rendered.view.window.close(); }
});

test('authoritative empty-square attack omits the fictional target AC and retains roll emphasis and hover details', async () => {
  const normalized = await command(scene(), { type: 'normalize' });
  const attackIndex = normalized.state_json.characters[0].attacks.findIndex(text => /^Dagger:/i.test(text));
  assert.ok(attackIndex >= 0);
  const result = await command(normalized.state_json, { type: 'attack_empty', x: 2, y: 3, attack_index: attackIndex }, .2);
  const entry = result.state_json.rollHistory.find(entry => entry.label === 'Attack');
  assert.equal(entry.rollCard.targetName, 'nothing');
  assert.equal(Object.hasOwn(entry.rollCard, 'targetAC'), false);
  assert.equal(entry.rollCard.damage, null);
  const rendered = renderedHistory({ ...result.state_json, rollHistory: [entry] });
  try {
    const body = rendered.cards[0].querySelector('.roll-card-result');
    assert.equal(rendered.cards[0].querySelector('h3').textContent, 'Shrigark');
    assert.equal(body.textContent, 'Attack: Dagger: 7 vs. nothing, miss.');
    assert.equal(body.querySelector('strong').textContent, '7');
    assert.ok(body.querySelector('strong').getAttribute('aria-label').includes('To hit:'));
    assert.ok(!body.textContent.includes('AC'));
  } finally { rendered.view.window.close(); }
});

function reactionScene() {
  const state = scene();
  state.combat.active = false;
  state.characters[0].languages = 'Common';
  state.characters[0].stats.CHA = 18;
  Object.assign(state.entities[0], { name: 'Peasant', hostile: false, attitude: null, attitudeChecked: false,
    languages: ['Dwarvish'], I: 0 });
  return state;
}

for (const preferActive of [true, false]) {
  test(`authoritative no-language automatic reaction attributes ${preferActive ? 'the nearby active character' : 'the closest eligible character'} without CHA`, async () => {
    const state = reactionScene();
    if (!preferActive) {
      Object.assign(state.characters[0], { x: 30, y: 30 });
      state.characters.push(
        { id: 'near', name: 'Ad', className: 'Fighter', ancestry: 'Halfling', hp: 20, maxHitPoints: 20,
          x: 2, y: 2, roomId: 'room', stats: { CHA: 18 }, languages: 'Common', gear: [],
          lightSpellLit: true, lightSource: 'light-spell', lightRadius: 12 },
        { id: 'farther', name: 'Dor', className: 'Fighter', ancestry: 'Human', hp: 20, maxHitPoints: 20,
          x: 1, y: 2, roomId: 'room', stats: { CHA: 18 }, languages: 'Common', gear: [] }
      );
    }
    const result = await command(state, { type: 'tick', elapsed_ms: 1000 });
    const monster = result.state_json.entities.find(entity => entity.id === 'foe');
    assert.equal(result.state_json.encounterPrompt ?? null, null);
    assert.deepEqual(monster.reaction, { rolls: [4, 4], modifier: 0, total: 8, speakerId: null });
    assert.equal(monster.attitude, 'suspicious');
    const entry = result.state_json.rollHistory.find(entry => entry.label === 'Reaction');
    const actorId = preferActive ? 'hero' : 'near', actorName = preferActive ? 'Shrigark' : 'Ad';
    assert.equal(entry.characterId, actorId);
    assert.equal(entry.rollCard.actorId, actorId);
    assert.equal(entry.rollCard.results[0].value, 8);
    assert.equal(entry.rollCard.summary, `${actorName} talks to Peasant, but Peasant doesn't understand.`);
    const rendered = renderedHistory({ ...result.state_json, rollHistory: [entry] });
    try {
      assert.equal(rendered.cards[0].querySelector('h3').textContent, actorName);
      assert.equal(rendered.cards[0].querySelector('.roll-card-detail').textContent, entry.rollCard.summary);
      assert.equal(rendered.cards[0].querySelector('.roll-card-result').textContent, 'CHA: 8');
    } finally { rendered.view.window.close(); }
  });
}

test('authoritative explicit No retains the shared speaker namebar but never claims speech or adds CHA', async () => {
  const state = reactionScene();
  state.entities[0].languages = ['Common'];
  let result = await command(state, { type: 'tick', elapsed_ms: 1000 });
  assert.equal(result.state_json.encounterPrompt.speakerId, 'hero');
  result = await command(result.state_json, { type: 'reaction', talk: false });
  const monster = result.state_json.entities.find(entity => entity.id === 'foe');
  assert.deepEqual(monster.reaction, { rolls: [4, 4], modifier: 0, total: 8, speakerId: null });
  const entry = result.state_json.rollHistory.find(entry => entry.label === 'Reaction');
  assert.equal(entry.rollCard.actorId, 'hero');
  assert.equal(entry.rollCard.summary, 'Peasant feels suspicious.');
  assert.ok(!entry.rollCard.summary.includes('talks'));
  const rendered = renderedHistory({ ...result.state_json, rollHistory: [entry] });
  try {
    assert.equal(rendered.cards[0].querySelector('h3').textContent, 'Shrigark');
    assert.equal(rendered.cards[0].querySelector('.roll-card-detail').textContent, 'Peasant feels suspicious.');
  } finally { rendered.view.window.close(); }
});

test('thief search records both totals and a discovery, then the illuminated adjacent lock can be opened without bumping it', async () => {
  const state = scene();
  state.combat.active = false;
  state.characters[0].className = 'Thief';
  state.entities = [{ id: 'secret', type: 'feature', subtype: 'door', secret: true, visible: false,
    searchDc: 11, lockPickDc: 8, breakDc: 8, x: 3, y: 2, wallSide: 'east', roomId: 'room', doorState: 'locked' }];
  await assert.rejects(() => command(state, { type: 'pick_lock' }), /No locked door selected/);
  const dice = [.55, .9];
  const result = await command(state, { type: 'search' }, () => dice.shift() ?? .6);
  const door = result.state_json.entities.find(entity => entity.id === 'secret');
  assert.equal(door.secretFound, true);
  assert.equal(door.searchDiscovery.characterId, 'hero');
  assert.equal(result.state_json.lockedDoorAction, null);

  const rendered = renderedHistory(result.state_json);
  try {
    const card = rendered.cards[0];
    assert.equal(card.querySelector('h3').textContent, 'Shrigark');
    assert.equal(card.querySelector('.roll-card-result').textContent, 'Search: 12 | 19 Success');
    assert.equal(card.querySelector('.roll-card-result strong').textContent, '19');
    assert.equal(card.querySelector('.roll-card-detail').textContent, 'Shrigark finds a secret door.');
  } finally { rendered.view.window.close(); }

  const unlocked = await command(result.state_json, { type: 'pick_lock' });
  assert.equal(unlocked.state_json.entities.find(entity => entity.id === 'secret').doorState, 'open');
});

test('fresh fighter mastery grants another greatsword, or drops it beside a fighter with a full pack', async () => {
  for (const full of [false, true]) {
    const state = scene(), fighter = state.characters[0];
    state.combat.active = false;
    state.entities = [];
    fighter.className = 'Fighter';
    fighter.gear = [{ name: 'Greatsword', type: 'weapon', equipped: true, slots: 2 }];
    if (full) fighter.gear.push(...Array.from({ length: 8 }, () => ({ name: 'Sack', slots: 1 })));
    initializeImportChoices(fighter, { random: () => .4 });
    const result = await command(state, { type: 'advance_choice', event_id: 'initial', task_id: 'mastery', value: 'greatsword' });
    const current = result.state_json.characters[0];
    assert.equal(current.gear.filter(item => item.name.toLowerCase() === 'greatsword').length, full ? 1 : 2);
    const drop = result.state_json.entities.find(item => item.subtype === 'dropped-equipment');
    assert.equal(Boolean(drop), full);
    if (full) {
      assert.equal(drop.gearItem.name.toLowerCase(), 'greatsword');
      assert.equal(drop.slots, 2);
      assert.equal(Math.abs(drop.x - current.x) + Math.abs(drop.y - current.y), 1);
    }
    assert.equal(current.bonuses.find(bonus => bonus.name === 'WeaponMastery').bonusTo, 'greatsword');
    const completed = await command(result.state_json, { type: 'advance_choice', event_id: 'initial', task_id: 'grit', value: 'STR' });
    assert.equal(completed.state_json.characters[0].advancements[0].completed, true);
  }
});

test('companion rename persists in the runtime without changing the native monster', async () => {
  const state = scene();
  state.combat.active = false;
  const monster = { ...state.entities[0], name: 'Goblin', tags: ['humanoid'], hostile: false };
  state.entities = [];
  state.characters.push(buildMonsterCompanion(monster, { id: 'goblin', controllerId: 'hero', random: () => 0 }));
  const result = await command(state, { type: 'rename_character', character_id: 'goblin', name: 'Torchbearer' });
  const normalized = await command(result.state_json, { type: 'normalize' });
  const companion = normalized.state_json.characters.find(character => character.id === 'goblin');
  assert.equal(companion.name, 'Torchbearer');
  assert.equal(companion.raw.name, 'Torchbearer');
  assert.equal(companion.companion.source.name, 'Goblin');
});
