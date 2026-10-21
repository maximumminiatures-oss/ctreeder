import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { beginLevelUp, resolveAdvancement } from '../../S3_content/src/class-progression.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';
import { fieldLore } from '../../S3_content/src/sheet-field-lore.js';
import { sheetLore } from '../../S3_content/src/sheet-lore.js';

const source = fs.readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const spells = [1, 2, 3, 4, 5].flatMap(tier => JSON.parse(fs.readFileSync(new URL(`../../S3_content/spells/tier-${tier}.json`, import.meta.url))));

function sheet() {
  const dom = new JSDOM(), opened = [];
  const context = vm.createContext({ document: dom.window.document, Node: dom.window.Node, fieldLore, sheetLore,
    findSpellRecord: name => spells.find(spell => spell.name.toLowerCase() === name.toLowerCase()),
    getSpellKey: name => String(typeof name === 'string' ? name : name.name).toLowerCase(),
    isCharacterSpellFailed: (character, name) => character?.failedSpells?.includes(name), ensureSpellLibraryLoaded: async () => {},
    OFFENSIVE_SPELLS: new Set(), renderSpellDetail: (spell, character) => opened.push({ spell, character }),
    setStatus: message => assert.fail(message) });
  // Exercise the private production functions without adding test exports or booting the game.
  for (const [name, next] of [['buildTalentSpellLines', 'getCharacterGearSlots'], ['createSpellButton', 'createSpellSummaryLine'],
    ['createSpellSummaryLine', 'createSdField'], ['createSdField', 'buildSheetLines'], ['buildSheetLines', 'createSdPanel'],
    ['updateTruncatedSheetTitles', 'reorderCharacterGear']]) {
    const start = source.indexOf(`function ${name}(`), end = source.indexOf(`\nfunction ${next}(`, start);
    assert.ok(start >= 0 && end > start, `production function ${name} is available`);
    vm.runInContext(source.slice(start, end), context);
  }
  return { dom, opened, context, document: dom.window.document };
}

function rows(document, count = 8) {
  return Array.from({ length: count }, (_, index) => {
    const row = document.createElement('span'); row.textContent = `Talent ${index + 1}`; return row;
  });
}

for (const className of ['Wizard', 'Priest']) test(`${className} level-two spell stays visible and clickable after eight talents without adding sheet rows`, async () => {
  const { dom, opened, context, document } = sheet();
  try {
    const picked = className === 'Wizard' ? 'Magic Missile' : 'Holy Weapon';
    const character = { id: 'caster', name: 'Caster', className, level: 1, XP: 10, hp: 5, maxHitPoints: 5,
      stats: { CON: 10, INT: 12, WIS: 12 }, bonuses: [], levels: [], gear: [],
      spellsKnown: className === 'Wizard' ? 'Sleep, Alarm' : 'Turn Undead, Light, Cure Wounds' };
    const event = beginLevelUp(character, { random: () => .5 });
    assert.equal(event.tasks.filter(task => task.type === 'spell').length, 1);
    resolveAdvancement(character, event.id, event.tasks[0].id, picked, { spells });
    const state = { characters: [character] }; normalizeCharacterState(state);
    const caster = state.characters[0];
    const summary = context.buildTalentSpellLines(caster).find(line => line.startsWith('Spells:'));
    const block = context.createTalentsContent(rows(document), summary, 'Languages: Common', caster);
    document.body.append(block);
    assert.equal(block.querySelectorAll('.sd-talents-list > div').length, 8);
    assert.equal(block.lastElementChild.className, 'sd-sheet-languages');
    assert.equal(block.lastElementChild.textContent, 'Languages: Common');
    assert.equal(block.querySelector('[style*="auto"]'), null);
    assert.equal(block.querySelector('.sd-line-prefix').title, fieldLore('Spells', className));
    const buttons = [...block.querySelectorAll('.spell-link-button')];
    const names = caster.spellsKnown.split(', ').sort((a, b) => a.localeCompare(b));
    assert.deepEqual(buttons.map(button => button.textContent), names);
    const button = buttons.find(button => button.textContent === picked);
    assert.ok(button && button.tagName === 'A');
    assert.equal(block.querySelector('.sd-spell-summary-line button'), null);
    button.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened.length, 1); assert.equal(opened[0].spell.name, picked); assert.equal(opened[0].character.id, caster.id);
  } finally { dom.window.close(); }
});

test('spell summaries merge duplicate tiers and names, sorting numeric tiers then spell names', () => {
  const { dom, context } = sheet();
  try {
    const summary = context.createSpellSummaryLine('Spells: (Tier 3): Fireball; (Tier 1): Sleep, Alarm; (Tier 2): Web; (Tier 1): Magic Missile, alarm', {});
    assert.deepEqual([...summary.querySelectorAll('.sd-spell-tier-label')].map(node => node.textContent), ['Tier 1', 'Tier 2', 'Tier 3']);
    assert.deepEqual([...summary.querySelectorAll('.spell-link-button')].map(node => node.textContent), ['Alarm', 'Magic Missile', 'Sleep', 'Web', 'Fireball']);
    assert.equal(summary.querySelectorAll('.sd-spell-tier').length, 3);
    assert.equal(summary.querySelectorAll('.sd-spell-names').length, 3);
    assert.equal(summary.querySelectorAll('button').length, 0);
  } finally { dom.window.close(); }
});

test('failed spell links are gray-marked but still open their descriptions, never target immediately', async () => {
  const { dom, context, opened } = sheet();
  try {
    context.OFFENSIVE_SPELLS.add('magic missile');
    const summary = context.createSpellSummaryLine('Spells: (Tier 1): Magic Missile', { failedSpells: ['Magic Missile'] });
    const link = summary.querySelector('a');
    assert.ok(link.classList.contains('is-spell-lost'));
    link.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened[0].spell.name, 'Magic Missile');
  } finally { dom.window.close(); }
});

test('talent-only and attack blocks retain their original fixed rows and overflow tooltip behavior', () => {
  const { dom, context, document } = sheet();
  try {
    const block = context.buildSheetLines(rows(document, 10), 8);
    assert.equal(block.children.length, 8); assert.equal(block.querySelector('.sd-sheet-spells'), null);
    assert.equal(block.style.gridTemplateRows, '');
    assert.equal(block.lastElementChild.dataset.fullText, 'Talent 8\nTalent 9\nTalent 10');
    const empty = context.buildSheetLines([], 7); assert.equal(empty.children.length, 7);
    const none = context.buildSheetLines([context.createSpellSummaryLine('Spells: None', {})], 8);
    assert.equal(none.querySelector('.sd-sheet-spells'), null); assert.equal(none.children.length, 8);
  } finally { dom.window.close(); }
});

test('reviewed Name tooltip stays removed, AC heading keeps field help, and coin help survives truncation checks', () => {
  const { dom, context, document } = sheet();
  try {
    const name = context.createSdField('Name', 'Badzog', 'sd-name-box');
    const value = name.querySelector('.sd-sheet-value');
    Object.defineProperty(value, 'scrollWidth', { value: 100 });
    Object.defineProperty(value, 'clientWidth', { value: 1 });
    const ac = context.createSdField('AC', 14);ac.title = 'Armor: leather. Shield: none.';
    const coins = document.createElement('div');coins.className = 'sd-free-carry-text';
    coins.dataset.forceTooltip = 'true';coins.dataset.fullText = fieldLore('Coins');
    document.body.append(name, ac, coins);
    context.updateTruncatedSheetTitles(document.body);
    assert.equal(name.hasAttribute('title'), false);assert.equal(value.hasAttribute('title'), false);
    assert.equal(ac.querySelector('h3').title, 'Armor Class. How hard are you to hit?');
    assert.equal(ac.title, 'Armor: leather. Shield: none.');
    assert.equal(coins.title, fieldLore('Coins'));
  } finally { dom.window.close(); }
});
