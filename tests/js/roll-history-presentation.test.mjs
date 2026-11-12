import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { attackRollSegments } from '../../S3_content/src/combat-rules.js';
import { rollTextSegments, checkHistoryPresentation, reactionHistorySegments, burningHandsHistorySegments, historyMonsterColor } from '../../S3_content/src/roll-history.js';

const source = await readFile(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const actor = { id: 'hero', name: 'Shrigark', color: '#8250a0' };
const check = { firstRoll: 1, secondaryRoll: 20, roll: 20, modifier: 3, total: 23 };
const asEntry = segments => ({ segments, rollCard: segments[0].rollCard });

function history(entries = [], characters = [actor], entities = []) {
  const dom = new JSDOM('<button id="toggle"></button><ol hidden id="history"></ol>', { url: 'http://localhost/' });
  const state = { characters, entities, rollHistory: entries, luckEvents: [{ id: 'unchanged-luck', context: { damage: 7 } }] };
  const context = vm.createContext({ SERVER_RUNTIME: false, document: dom.window.document, window: dom.window,
    state, diceHistory: entries, rollTextSegments, checkHistoryPresentation, historyMonsterColor,
    ui: { diceHistory: dom.window.document.querySelector('#history'), diceHistoryToggle: dom.window.document.querySelector('#toggle') },
    canReadFeedback: (_state, entry) => !entry.privateCharacterId || entry.privateCharacterId === actor.id,
    getCharacterColorValue: character => character.color || '#be2d2d'
  });
  vm.runInContext(source.slice(source.indexOf("let diceHistoryRenderKey = ''"), source.indexOf('function characterSheetInteractionKey(')), context);
  vm.runInContext(source.slice(source.indexOf('function pushDiceHistory('), source.indexOf('function toggleDiceHistory(')), context);
  context.renderDiceHistory();
  return { dom, context, state, cards: dom.window.document.querySelector('#history').children };
}

function attack(overrides = {}) {
  return attackRollSegments({ character: actor, monster: { id: 'orc', name: 'Orc', ac: 10 }, weapon: 'Dagger',
    roll: check, ability: 'DEX', abilityModifier: 3, hit: true, damage: 4,
    damageRoll: { terms: [{ type: 'die', label: '1d4', value: 4, isMaximum: true }] }, ...overrides });
}

test('actor titlebar and action body retain rolled order, kept totals, extrema and keyboard hovers', () => {
  const view = history([asEntry(attack())]);
  try {
    const card = view.cards[0], result = card.querySelector('.roll-card-result');
    assert.equal(card.querySelector('h3').textContent, actor.name);
    assert.equal(card.style.getPropertyValue('--roll-color'), actor.color);
    assert.equal(result.textContent, "Attack: Dagger: 4 | 23 vs. the orc's AC 10, critical! 4 damage to the orc.");
    assert.equal(result.querySelector('em').textContent, 'Attack: ');
    assert.equal(result.querySelector('.die-minimum').textContent, '4');
    assert.equal(result.querySelector('strong.die-maximum').textContent, '23');
    const value = result.querySelector('strong');
    assert.equal(value.tabIndex, 0);
    value.focus();
    assert.match(view.dom.window.document.querySelector('[role="tooltip"]').textContent, /2d20 = \(1\)\(20\) \+3 DEX/);
    value.blur();
    assert.equal(view.dom.window.document.querySelector('[role="tooltip"]'), null);
    assert.equal(card.querySelectorAll('.roll-card-result').length, 1);
    assert.equal(result.querySelectorAll('strong')[1].textContent, '4');
  } finally { view.dom.window.close(); }
});

test('Hit, Miss and Fumble do not depend on parsing narrative; misses never show damage', () => {
  for (const [roll, hit, outcome] of [[12, true, 'Hit'], [2, false, 'Miss'], [1, false, 'Fumble!']]) {
    const segments = attack({ roll: { roll, modifier: 3, total: roll + 3 }, hit });
    assert.equal(segments[0].rollCard.outcome, outcome);
    const view = history([asEntry(segments)]);
    try {
      assert.ok(view.cards[0].textContent.includes(`AC 10, ${outcome === 'Hit' ? 'hits' : outcome.toLowerCase()}`));
      assert.equal(view.cards[0].textContent.includes('damage to the orc'), hit);
    } finally { view.dom.window.close(); }
  }
});

test('both tied totals stay bold after JSON restore and monster identities survive removal', () => {
  const segments = attack({ character: { id: 'monster', name: 'Giant Wasp', type: 'monster' },
    roll: { roll: 8, firstRoll: 8, secondaryRoll: 8, modifier: 2, total: 10 } });
  const entry = JSON.parse(JSON.stringify({ ...asEntry(segments), actorColor: '#be2d2d' }));
  const view = history([entry]);
  try {
    assert.equal(view.cards[0].querySelector('h3').textContent, 'Giant wasp');
    assert.deepEqual([...view.cards[0].querySelectorAll('.roll-card-result:first-of-type strong')].slice(0, 2).map(node => node.textContent), ['10', '10']);
  } finally { view.dom.window.close(); }
});

test('spellcasting shows the canonical spell name, DC and explicit Success or Failure', () => {
  for (const [roll, total, expected] of [[20, 23, 'Success'], [1, 30, 'Failure'], [8, 11, 'Success'], [7, 10, 'Failure']]) {
    const result = { roll, total, modifier: total - roll };
    const segments = rollTextSegments('Detailed spell math.', result);
    Object.assign(segments[0].rollCard, checkHistoryPresentation(result, 'Burning Hands cast', {
      type: 'Spellcasting', actionName: 'Burning Hands', dc: 11, actorId: actor.id
    }));
    const view = history([asEntry(segments)]);
    try {
      assert.equal(view.cards[0].querySelector('.roll-card-result').textContent, `Spellcasting: Burning Hands DC 11: ${total}, ${expected.toLowerCase()}.`);
    } finally { view.dom.window.close(); }
  }
});

test('Search uses structured found records and Stealth accepts the integration-owned DC', () => {
  const search = rollTextSegments('Not parsed for outcomes.', check);
  Object.assign(search[0].rollCard, checkHistoryPresentation({ ...check, found: [] }, 'Search'));
  const stealth = rollTextSegments('Not parsed for outcomes.', check);
  Object.assign(stealth[0].rollCard, checkHistoryPresentation(check, 'Stealth', { dc: 15 }));
  const view = history([asEntry(search), asEntry(stealth)]);
  try {
    assert.equal(view.cards[0].querySelector('.roll-card-result').textContent, 'Search: 4 | 23, nothing found.');
    assert.equal(view.cards[1].querySelector('.roll-card-result').textContent, 'Stealth: 4 | 23 vs. DC 15, success.');
    assert.equal(checkHistoryPresentation({ found: [{ name: 'Chest' }, { subtype: 'door', secret: true }] }, 'Search').resultText, 'Found: Chest, secret door.');
  } finally { view.dom.window.close(); }
});

test('Burning Hands release preserves actual per-target damage, dead names, d12 hovers and legacy details', () => {
  const outcome = { rolls: [12], damage: 12, message: 'The Web burns.', hits: [
    { id: 'one', name: 'Orc', damage: 12, defeated: true },
    { id: 'two', name: 'Wraith', damage: 6 }, { id: 'three', name: '<script>', damage: 12, dead: true }
  ] };
  const before = structuredClone(outcome), segments = burningHandsHistorySegments(actor, outcome, 12);
  const view = history([asEntry(segments)]);
  try {
    assert.equal(view.cards[0].querySelector('h3').textContent, actor.name);
    assert.equal(view.cards[0].querySelector('.roll-card-result').textContent, 'Shrigark released Burning Hands: 12 damage to Orc, 6 damage to Wraith, 12 damage to <script>.');
    assert.ok(view.cards[0].textContent.includes('Orc dies. <script> dies.'));
    assert.equal(view.cards[0].querySelector('script'), null);
    const value = view.cards[0].querySelector('strong.die-maximum');
    value.focus();
    const tip = view.dom.window.document.querySelector('[role="tooltip"]').textContent;
    assert.match(tip, /1d12 = 12 = 12/); assert.match(tip, /The Web burns/);
    assert.deepEqual(outcome, before);
  } finally { view.dom.window.close(); }
});

test('CHA shared-language attitudes and uncomprehending speech use structured metadata', () => {
  for (const understood of [true, false]) {
    const segments = reactionHistorySegments({ actor, monster: { id: 'orc', name: 'Orc' }, talk: true, understood,
      result: { message: '2d6 = (1 + 6) +2 CHA = 9', rolls: [1, 6], modifier: 2, total: 9, attitude: 'neutral' } });
    const view = history([asEntry(segments)]);
    try {
      assert.equal(view.cards[0].querySelector('.roll-card-result').textContent, 'CHA: 9');
      assert.equal(view.cards[0].querySelector('.roll-card-detail').textContent, understood
        ? 'Shrigark talks to Orc. Orc feels neutral.' : "Shrigark talks to Orc, but Orc doesn't understand.");
    } finally { view.dom.window.close(); }
  }
});

test('history snapshots preserve source metadata, private audiences, legacy entries and Luck events', () => {
  const view = history([{ label: 'Legacy', detail: 'Old saved result.' }]);
  try {
    const segments = attack(), before = structuredClone(segments), luck = structuredClone(view.state.luckEvents);
    view.context.pushDiceHistory('Attack', 'Legacy attack narrative.', actor.id, segments, actor.id, { targetAC: 17 });
    assert.equal(view.state.rollHistory[0].rollCard.targetAC, 17);
    assert.equal(view.state.rollHistory[0].privateCharacterId, actor.id);
    assert.deepEqual(segments, before);
    assert.deepEqual(view.state.luckEvents, luck);
    assert.ok(view.state.rollHistory[0].segments.every(part => !Object.hasOwn(part, 'rollCard')));
    view.context.pushDiceHistory('Illusion', 'Secret spell.', actor.id, segments, 'someone-else');
    assert.equal(view.cards.length, 2);
    assert.equal(view.cards[1].querySelector('.roll-card-detail').textContent, 'Old saved result.');
    assert.equal(view.dom.window.document.querySelector('#toggle').hidden, true);
  } finally { view.dom.window.close(); }
});

test('monster headings match token colors and keep their event color after removal', () => {
  for (const [monster, expected] of [
    [{ hostile: true }, '#be2d2d'], [{ attitude: 'neutral' }, '#df9696'],
    [{ mimicDisguise: true }, '#e0bc2f'], [{ impersonatedCharacter: { colorValue: '#123456' } }, '#123456']
  ]) {
    const creature = { id: 'monster', type: 'monster', name: 'Monster', ...monster };
    const view = history([], [actor], [creature]);
    try {
      view.context.pushDiceHistory('Attack', 'Attack details.', creature.id, attack({ character: creature }));
      assert.equal(view.state.rollHistory[0].actorColor, expected);
      view.state.entities = [];
      view.context.renderDiceHistory();
      assert.equal(view.cards[0].style.getPropertyValue('--roll-color'), expected);
      assert.equal(view.cards[0].querySelector('h3').textContent, 'Monster');
    } finally { view.dom.window.close(); }
  }
});

test('saved empty-target cards cannot reintroduce fictional AC; common and proper targets keep their articles', () => {
  const empty = attack({ monster: { name: 'nothing', ac: 10 }, hit: false,
    roll: { roll: 5, modifier: 2, total: 7 } });
  assert.equal(Object.hasOwn(empty[0].rollCard, 'targetAC'), false);
  const legacyEmpty = structuredClone(empty);
  legacyEmpty[0].rollCard.targetAC = 10;
  const proper = attack({ monster: { name: 'Kragol', isNamed: true, ac: 10 } });
  assert.equal(proper[0].rollCard.targetName, 'Kragol');
  const partyTarget = attack({ monster: { name: 'Ad', partyMember: true, armorClass: 11 } });
  assert.equal(partyTarget[0].rollCard.targetName, 'Ad');
  const view = history([asEntry(legacyEmpty), asEntry(proper), asEntry(partyTarget)]);
  try {
    assert.equal(view.cards[0].querySelector('.roll-card-result').textContent, 'Attack: Dagger: 7 vs. nothing, miss.');
    assert.ok(view.cards[1].textContent.includes("vs. Kragol's AC 10"));
    assert.ok(view.cards[2].textContent.includes("vs. Ad's AC 11"));
  } finally { view.dom.window.close(); }
});
