import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { formatFieldName } from '../../S3_content/src/ui-text.js';
import { normalizeWeaponSpacing } from '../../S3_content/src/equipment.js';

const source = fs.readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../S3_content/styles.css', import.meta.url), 'utf8');

test('attack controls remain borderless with a separate keyboard-focus indicator', () => {
  assert.match(styles, /body :is\(\.controls-panel, \.map-panel, \.modal-card, \.turn-card-layer\) :is\(button, \.toolbar-button\)\.attack-roll-button\s*\{\s*border: 0 !important;/);
  assert.match(styles, /\.attack-roll-button:hover:not\(:focus-visible\)\s*\{\s*outline: none;/);
  assert.match(styles, /\.attack-roll-button:focus-visible\s*\{\s*outline: 1px dotted #666;/);
});

function load(context, name, next) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf(`\nfunction ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${name} remains available`);
  vm.runInContext(source.slice(start, end), context);
}
function runtime(extra = {}) {
  const context = vm.createContext({ formatFieldName,
    getWeaponProfileFromText: value => {
      const key = normalizeWeaponSpacing(value).match(/\b(?:warhammer|shortsword|longsword|dagger)\b/)?.[0];
      return key ? { key } : null;
    },
    normalizeEquipmentName: normalizeWeaponSpacing, ...extra });
  load(context, 'formatWeaponMasteryDescription', 'formatTalentSpellTextForSheet');
  load(context, 'formatTalentSpellTextForSheet', 'isSpellCheckText');
  load(context, 'formatPartyAssetsText', 'updatePartyAssetsUi');
  return context;
}

test('mastery presentation canonicalizes weapon names without changing descriptions in stored bonuses', () => {
  const context = runtime();
  for (const weapon of ['warhammer', 'WARHAMMER', 'war hammer', 'War Hammer']) {
    const description = `${weapon} mastery`;
    const bonus = Object.freeze({ description });
    assert.equal(context.formatWeaponMasteryDescription(bonus.description), 'Warhammer mastery');
    assert.equal(bonus.description, description);
    for (const line of [`Fighter 1: ${weapon}`, `Fighter 3: ${weapon} mastery`,
      `Fighter 3: Weapon Mastery: ${weapon}`, `Fighter 3: ${weapon}: Weapon Mastery`]) {
      assert.match(context.formatTalentSpellTextForSheet(line), /^Fighter [13]: Warhammer mastery$/);
    }
  }
  assert.equal(context.formatWeaponMasteryDescription('rusty short sword mastery.'), 'Rusty Shortsword mastery.');
  for (const text of ['Armor mastery: +1 AC with Heavy', 'Grit: Strength', '+1 wizard spellcasting checks', 'Cast Burning Hands at advantage'])
    assert.equal(context.formatWeaponMasteryDescription(text), text);
});

test('advancement choices show title-case labels but submit exact original option values', () => {
  const dom = new JSDOM('<div id="advancement-modal" data-character-id="fighter"><section></section></div>');
  const event = { id: 'level-3', level: 3, initial: false, completed: false, hpGain: 4, hpRolls: [4], conModifier: 0,
    tasks: [{ id: 'mastery', type: 'mastery' }, { id: 'magic', type: 'magic-item' }] };
  const bonus = Object.freeze({ progression: true, gainedAtLevel: 3, description: 'war hammer mastery' });
  const character = { id: 'fighter', name: 'Dagger', className: 'Fighter', stats: { INT: 12 }, title: 'Knight',
    advancements: [event], bonuses: [bonus] };
  const options = {
    mastery: Object.freeze([Object.freeze({ value: 'war hammer', label: 'war hammer' }), Object.freeze({ value: 'rusty short sword', label: 'rusty short sword' })]),
    'magic-item': Object.freeze(['weapon', 'armor', 'wand', 'potion', 'scroll'].map(value => Object.freeze({ value, label: value })))
  };
  const submitted = [];
  const context = runtime({ document: dom.window.document, state: { characters: [character] }, sharedCommandPending: 0,
    ownsCharacter: () => true, isCombatActive: () => false, restInProgress: () => false,
    advancementContext: () => ({}), advancementOptions: (_character, _event, task) => options[task.type],
    submitAdvancementChoice: (_character, _event, task, value) => submitted.push({ task: task.type, value }),
    formatModifier: value => `${value >= 0 ? '+' : ''}${value}`, STAT_NAMES: {}, GRIT_DESCRIPTIONS: {} });
  load(context, 'renderAdvancement', 'syncAdvancementUi');
  try {
    context.renderAdvancement();
    const names = [...dom.window.document.querySelectorAll('.advancement-spell-name')];
    assert.deepEqual(names.map(node => node.textContent), ['Warhammer', 'Rusty Shortsword', 'Weapon', 'Armor', 'Wand', 'Potion', 'Scroll']);
    assert.equal(names[0].closest('.advancement-spell').dataset.choiceValue, 'war hammer');
    names[0].click(); names[4].click();
    assert.deepEqual(submitted, [{ task: 'mastery', value: 'war hammer' }, { task: 'magic-item', value: 'wand' }]);
    assert.equal(character.name, 'Dagger'); assert.equal(bonus.description, 'war hammer mastery');
    assert.ok([...dom.window.document.querySelectorAll('p')].some(node => node.textContent === 'Warhammer mastery'));
    assert.equal(options.mastery[0].label, 'war hammer');
  } finally { dom.window.close(); }
});

test('Party Assets text is shared by sidebar, shop and sell while exact coin details remain available', () => {
  const dom = new JSDOM('<div id="assets"></div>');
  const assets = Object.freeze({ gold: 23, silver: 4, copper: 7 });
  const context = runtime({ state: { partyAssets: assets }, ensurePartyAssets: () => assets,
    ui: { partyAssetsSummary: dom.window.document.getElementById('assets') } });
  load(context, 'formatMoneyParts', 'formatPartyAssetsText');
  load(context, 'updatePartyAssetsUi', 'isLivingCharacter');
  try {
    assert.equal(context.formatPartyAssetsText(assets), 'Party Assets: 23 Gold');
    assert.equal(context.formatPartyAssetsText(), 'Party Assets: 0 Gold');
    context.updatePartyAssetsUi();
    assert.equal(context.ui.partyAssetsSummary.textContent, 'Party Assets: 23 Gold');
    assert.equal(context.ui.partyAssetsSummary.title, '23 gp, 4 sp, 7 cp');
    assert.deepEqual(assets, { gold: 23, silver: 4, copper: 7 });
    const shop = source.slice(source.indexOf('function openStartingRoomShop('), source.indexOf('function createSdDismissPanel('));
    const sell = source.slice(source.indexOf('function openSellTreasurePanel('), source.indexOf('function ', source.indexOf('function openSellTreasurePanel(') + 10));
    assert.match(shop, /partyCoins\.textContent = formatPartyAssetsText\(ensurePartyAssets\(\)\)/);
    assert.match(shop, /partyCoins\.title = formatMoneyParts\(ensurePartyAssets\(\)\)/);
    assert.match(sell, /assets\.textContent = formatPartyAssetsText\(ensurePartyAssets\(\)\)/);
    assert.match(sell, /assets\.title = formatMoneyParts\(ensurePartyAssets\(\)\)/);
  } finally { dom.window.close(); }
});
