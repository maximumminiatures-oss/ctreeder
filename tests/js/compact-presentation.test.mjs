import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { abilityScoreModifier } from '../../S3_content/src/characters.js';
import { attackRollSegments } from '../../S3_content/src/combat-rules.js';
import { rollTextSegments } from '../../S3_content/src/roll-history.js';

const source = await readFile(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const armorContext = vm.createContext({
  isIllusionCreature: () => false, mageArmorEffect: character => character.mageArmor,
  abilityScoreModifier, formatModifier: value => value < 0 ? String(value) : `+${value}`,
  faithArmorBonus: character => character.faith || 0, nativeGear: () => [],
  getArmorMasteryTarget: () => '', getArmorProfile: item => item.profile,
  isArmorItem: item => Boolean(item.profile), canUseArmor: () => true,
  magicBonus: item => item?.magic?.bonus || 0,
  revealedMagicBonus: item => item?.magic?.identified ? item.magic.bonus || 0 : 0,
  classArmorBonus: (character, key) => key === 'shield' ? character.shieldTalent || 0 : character.armorTalent || 0,
  characterHasShield: character => character.gear.some(item => item.shield && item.equipped),
  canUseShield: () => true, shouldReadyShield: () => true, isShieldItem: item => item.shield
});
vm.runInContext(source.slice(source.indexOf('function characterArmorCalculation('), source.indexOf('function rebuildCharacterArmorClass(')), armorContext);

test('AC display and tooltip use the same numerical contributions, omitting zero bonuses', () => {
  const character = { stats: { DEX: 14 }, armorTalent: 1, gear: [
    { name: 'Leather Armor', equipped: true, profile: { key: 'leather', ac: 11 } },
    { name: 'Shield', equipped: true, shield: true }
  ] };
  const result = armorContext.characterArmorCalculation(character);
  assert.equal(result.total, 16);
  assert.equal(result.parts.join(', '), '+2 DEX, +1 Talent, +1 armor, +2 shield');
  character.gear = []; character.stats.DEX = 10;
  const unarmored = armorContext.characterArmorCalculation(character);
  assert.equal(unarmored.total, 10); assert.equal(unarmored.parts.length, 0);
});

test('Mage Armor tooltips retain negative DEX but replace AC exactly, including critical wording', () => {
  const character = { stats: { DEX: 6 }, gear: [] };
  assert.equal(armorContext.characterArmorCalculation(character).total, 8);
  assert.equal(armorContext.characterArmorCalculation(character).parts.join(', '), '-2 DEX');
  for (const ac of [14, 18]) {
    character.mageArmor = { armorClass: ac };
    const result = armorContext.characterArmorCalculation(character);
    assert.equal(result.total, ac);
    assert.equal(result.parts.join(', '), ac === 18 ? '-2 DEX, Crit Mage Armor sets to 18!' : '-2 DEX, Mage Armor sets to 14');
  }
});

test('unidentified armor works without disclosing its enchantment in the numerical tooltip', () => {
  const item = { name: 'Magic Leather Armor', equipped: true, profile: { key: 'leather', ac: 11 }, magic: { bonus: 2 } };
  const character = { stats: { DEX: 10 }, gear: [item] };
  assert.equal(armorContext.characterArmorCalculation(character).total, 13);
  assert.equal(armorContext.characterArmorCalculation(character).parts.join(', '), '+1 armor');
  item.magic.identified = true;
  assert.equal(armorContext.characterArmorCalculation(character).parts.join(', '), '+1 armor, +2 Magic');
});

test('roll cards render actor stripes, original-order totals, ties, damage, and safe rich hovers', () => {
  const dom = new JSDOM('<ol hidden id="history"></ol>', { url: 'http://localhost/' });
  try {
    const segments = attackRollSegments({ character: { id: 'a', name: 'Shrigark' }, monster: { name: 'Stingbat' }, weapon: 'Dagger',
      roll: { firstRoll: 1, secondaryRoll: 20, roll: 20, total: 23, modifier: 3, checkMode: 'advantage' },
      ability: 'DEX', abilityModifier: 3, hit: true, damage: 4,
      damageRoll: { terms: [{ type: 'die', label: '1d4', value: 4, isMaximum: true }] } });
    const tie = rollTextSegments('A safe <script> label', { roll: 8, firstRoll: 8, secondaryRoll: 8, modifier: 2, total: 10 });
    Object.assign(tie[0].rollCard, { heading: 'Dexterity', actorId: 'a', actorName: 'Shrigark', type: 'Saving Throw' });
    const context = vm.createContext({ SERVER_RUNTIME: false, document: dom.window.document, window: dom.window,
      state: { characters: [{ id: 'a', name: 'Shrigark' }] },
      diceHistory: [{ label: 'Attack', segments }, { label: 'Dexterity', segments: tie }, { label: 'Legacy', detail: 'Old saved result.' }],
      ui: { diceHistory: dom.window.document.querySelector('#history') },
      canReadFeedback: () => true, getCharacterColorValue: () => '#a02080'
    });
    vm.runInContext(source.slice(source.indexOf("let diceHistoryRenderKey = ''"), source.indexOf('function characterSheetInteractionKey(')), context);
    context.renderDiceHistory();
    const list = dom.window.document.querySelector('#history'), cards = list.children;
    assert.equal(list.hidden, false); assert.equal(cards.length, 3);
    assert.equal(cards[0].style.getPropertyValue('--roll-color'), '#a02080');
    assert.equal(cards[0].querySelector('h3').textContent, 'Dagger');
    assert.equal(cards[0].querySelector('.roll-card-actor').textContent, 'Shrigark');
    assert.equal(cards[0].querySelector('.roll-card-result').textContent, 'Attack: 4 | 23');
    assert.equal(cards[0].querySelector('.die-minimum').textContent, '4');
    assert.equal(cards[0].querySelector('.die-maximum').textContent, '23');
    assert.equal(cards[0].querySelectorAll('.roll-card-result')[1].textContent, 'Damage: 4');
    assert.equal(cards[1].querySelectorAll('.roll-card-result strong').length, 2);
    assert.equal(cards[2].querySelector('.roll-card-detail').textContent, 'Old saved result.');
    assert.equal(dom.window.document.querySelector('script'), null);
  } finally { dom.window.close(); }
});
