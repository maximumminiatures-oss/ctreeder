import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { formatRulesMessage } from '../../S3_content/src/rules-message.js';

const context = {
  rulesData: { weapons: [{ name: 'bastard sword' }, { name: 'rusty shortsword' }] },
  monsters: [{ name: 'Orc' }, { name: 'Giant Wasp' }, { name: 'Bandit' }, { name: 'Wolf' }],
  spells: new Map([['burning hands', { name: 'Burning Hands' }], ['protection from evil', { name: 'Protection from Evil' }]])
};
const format = (message, extra = {}) => formatRulesMessage(message, { ...context, ...extra });

test('plain rules messages initialize the cache without catalogs', () => {
  assert.equal(formatRulesMessage('out of range with Dagger'), 'Out of range with dagger.');
});

test('sentences beginning with roll totals keep subsequent prose and dice notation lowercase', () => {
  assert.equal(format('Dor attacks Kragol with a Warhammer.\n21 hits for 4 damage'),
    'Dor attacks Kragol with a warhammer.\n21 hits for 4 damage.');
  assert.equal(format('1d20 = 12.\n8 misses'), '1d20 = 12.\n8 misses.');
});

test('ordinary rule terms become lowercase except at sentence starts; acronyms and dice remain intact', () => {
  assert.equal(format('Out of range with Dagger'), 'Out of range with dagger.');
  assert.equal(format('the Goblin Wizard has Strength 12, DEX +2, AC 14 and HP 7 at Level 3'),
    'The goblin wizard has strength 12, DEX +2, AC 14 and HP 7 at level 3.');
  assert.equal(format('Fighter needs a Wisdom check. dexterity helps the Thief! constitution save? charisma +1'),
    'Fighter needs a wisdom check. Dexterity helps the thief! Constitution save? Charisma +1.');
  assert.equal(format('a Lawful Soldier carries a Crossbow; the Chaotic Elf is a Minstrel'),
    'A lawful soldier carries a crossbow; the chaotic elf is a minstrel.');
  assert.equal(format('roll 1d20 + DEX vs DC 15; Damage 2d6 + STR'), 'Roll 1d20 + DEX vs DC 15; Damage 2d6 + STR.');
});

test('plurals and compound ordinary terms normalize without matching substrings', () => {
  assert.equal(format('the Elves and Dwarves carry Daggers and Staves; the Thieves face Giant Wasps and Wolves'),
    'The elves and dwarves carry daggers and staves; the thieves face giant wasps and wolves.');
  assert.equal(format('the Half-Orc carries a Bastard Sword and a Rusty Shortsword'),
    'The half-orc carries a bastard sword and a rusty shortsword.');
  assert.equal(format('the Wizardry researcher found a clubfooted swordsman'),
    'The Wizardry researcher found a clubfooted swordsman.');
});

test('actual character names override ordinary terminology except an unambiguous generic item use', () => {
  const state = { characters: [{ name: 'Dagger', className: 'Wizard', ancestry: 'Goblin' }, { name: 'Strength' },
    { name: 'Fighter' }, { name: 'iRook' }] };
  assert.equal(format('Dagger attacks the Orc with a Dagger', { state }), 'Dagger attacks the orc with a dagger.');
  assert.equal(format('heal Dagger, then Dagger equips Dagger', { state }), 'Heal Dagger, then Dagger equips dagger.');
  assert.equal(format("Dagger's HP is 2; Strength protects Fighter", { state }), "Dagger's HP is 2; Strength protects Fighter.");
  assert.equal(format('iRook heals Dagger', { state }), 'iRook heals Dagger.');
  assert.equal(format('use a Strength check to help Strength', { state }), 'Use a strength check to help Strength.');
});

test('regex-special, accented and multiword character names remain exact and do not reinterpret text', () => {
  const state = { characters: [{ name: 'A+B' }, { name: 'The Goblin' }, { name: 'Elan [2]' }, { name: '\u00c9lan' }] };
  assert.equal(format('A+B helps The Goblin and Elan [2] with a Dagger', { state }), 'A+B helps The Goblin and Elan [2] with a dagger.');
  assert.equal(format('\u00c9lan is a Wizard', { state }), '\u00c9lan is a wizard.');
});

test('spell proper names remain canonical while ordinary light and web nouns stay lowercase', () => {
  assert.equal(format('the Wizard casts burning hands on the Orc'), 'The wizard casts Burning Hands on the orc.');
  assert.equal(format('protection from evil ends when the Priest loses focus'),
    'Protection from Evil ends when the priest loses focus.');
  assert.equal(format('the Wizard casts silence, then cannot cast Web'), 'The wizard casts Silence, then cannot cast Web.');
  assert.equal(format('the torch has no light. escape the web with a Strength action'),
    'The torch has no light. Escape the web with a strength action.');
});

test('unique monster names are protected using the same metadata as attack narratives', () => {
  for (const metadata of [{ properName: true }, { isUnique: true }, { isNamed: true },
    { metadata: { isUnique: true } }, { meta: { isUnique: true } }]) {
    const state = { entities: [{ type: 'monster', name: 'Bandit', ...metadata }] };
    assert.equal(format('the Orc flees from Bandit', { state }), 'The orc flees from Bandit.');
  }
  const state = { entities: [{ type: 'monster', name: 'Orc', uniqueName: 'Dagger' },
    { type: 'monster', name: 'Bandit', properName: 'Lady Strength' }] };
  assert.equal(format('the Orc attacks Dagger and Lady Strength with a Dagger', { state }),
    'The orc attacks Dagger and Lady Strength with a dagger.');
  assert.equal(format('the Bandit boss moves', { state: { entities: [{ type: 'monster', name: 'Bandit', boss: true }] } }),
    'The bandit boss moves.');
});

test('state monster names normalize without a catalog, while explicitly unique names remain untouched', () => {
  const state = { entities: [{ type: 'monster', name: 'Clockwork Sentinel' }, { type: 'monster', name: 'Giant Rat' },
    { type: 'monster', name: 'Grumthar the Unbowed', unique: true }] };
  assert.equal(format('the Clockwork Sentinel attacks a Giant Rat', { state, monsters: [] }),
    'The clockwork sentinel attacks a giant rat.');
  assert.equal(format('the Goblin sees Grumthar the Unbowed', { state }), 'The goblin sees Grumthar the Unbowed.');
});

test('character-specific ancestries, classes and backgrounds are ordinary rules text, not proper names', () => {
  const state = { characters: [{ name: 'Rook', ancestry: 'Viperian', className: 'Bard', background: 'Dungeon Surveyor', alignment: 'Neutral' }] };
  assert.equal(format('Rook is a Neutral Viperian Bard and Dungeon Surveyor', { state }),
    'Rook is a neutral viperian bard and dungeon surveyor.');
});

test('paths, URLs, opaque IDs, filenames and code spans are not rewritten', () => {
  const message = 'wizard_12 uses monster-dagger-1, Dagger.png, C:\\Wizard\\Dagger.png, /site/Wizard and https://example.test/Wizard?item=Dagger. `Wizard Dagger DEX`';
  assert.equal(format(message), `${message}.`);
  assert.equal(format('a Wizard updates `className` and `Level`'), 'A wizard updates `className` and `Level`.');
});

test('punctuation, decimals, newlines, empty values and plain-text safety remain predictable', () => {
  assert.equal(format('out of range with Dagger!'), 'Out of range with dagger!');
  assert.equal(format('pay 1.5 Gold for a Dagger'), 'Pay 1.5 Gold for a dagger.');
  assert.equal(format('a Wizard waits\na Priest moves'), 'A wizard waits\nA priest moves.');
  assert.equal(format('pick a Dagger:'), 'Pick a dagger:');
  assert.equal(format(''), ''); assert.equal(format(null), '');
  assert.equal(format('<img src=x onerror=alert(1)> a Wizard'), '<img src=x onerror=alert(1)> a wizard.');
});

test('cache invalidates on character renaming, unique metadata and spell lookup changes without mutating inputs', () => {
  const state = { characters: [{ name: 'Dagger' }], entities: [{ name: 'Bandit', type: 'monster' }] };
  const before = structuredClone(state);
  assert.equal(format('Dagger sees the Bandit', { state }), 'Dagger sees the bandit.');
  assert.deepEqual(state, before);
  state.characters[0].name = 'Rook'; state.entities[0].isUnique = true;
  assert.equal(format('Rook equips a Dagger near Bandit', { state }), 'Rook equips a dagger near Bandit.');
  const spells = new Map();
  assert.equal(format('Rook casts borrowed radiance', { state, spells }), 'Rook casts borrowed radiance.');
  spells.set('borrowed radiance', { name: 'Borrowed Radiance' });
  assert.equal(format('Rook casts borrowed radiance', { state, spells }), 'Rook casts Borrowed Radiance.');
});

test('setStatus formats only plain status/darkness text while preserving classes and locked-door refresh', () => {
  const source = fs.readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function setStatus('), end = source.indexOf('\nfunction delay(', start);
  assert.ok(start >= 0 && end > start);
  const dom = new JSDOM('<div id="status"></div><div id="darkness"></div>');
  const statusText = dom.window.document.getElementById('status'), darknessMessage = dom.window.document.getElementById('darkness');
  const state = { characters: [{ name: 'Dagger' }], entities: [] }, history = [{ text: 'Wizard attacks Orc with Dagger', bold: true }];
  let refreshes = 0;
  const runtime = vm.createContext({ state, rulesData: context.rulesData, shadowdarkContent: { monsters: context.monsters },
    monsterTable: [], spellLookup: context.spells, ui: { statusText, darknessMessage }, formatRulesMessage,
    updateLockedDoorUi: () => refreshes++, diceHistory: history });
  try {
    vm.runInContext(source.slice(start, end), runtime);
    runtime.setStatus({ message: 'Dagger needs a Strength check against the Orc', trapSprung: true, noFreeSlots: true,
      darknessMessage: 'the Wizard has no light' });
    assert.equal(statusText.textContent, 'Trap is Sprung! Dagger needs a strength check against the orc.');
    assert.ok(statusText.classList.contains('trap-sprung-status'));
    assert.ok(statusText.classList.contains('no-free-slots-status'));
    assert.equal(darknessMessage.textContent, 'The wizard has no light.');
    assert.deepEqual(history, [{ text: 'Wizard attacks Orc with Dagger', bold: true }]);
    runtime.setStatus('Out of range with Dagger');
    assert.equal(statusText.textContent, 'Out of range with dagger.');
    assert.equal(darknessMessage.textContent, '');
    assert.equal(statusText.classList.contains('trap-sprung-status'), false);
    assert.equal(refreshes, 2);
  } finally { dom.window.close(); }
});
