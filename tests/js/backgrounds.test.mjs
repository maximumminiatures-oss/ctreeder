import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backgroundKey, canonicalBackground, weightedBackgroundChoice, nobleName, initializeCharacterBackground,
  orphanBackgroundLore, createBackgroundCatalog } from '../../S3_content/src/backgrounds.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { fieldLore } from '../../S3_content/src/sheet-field-lore.js';

const titles = JSON.parse(readFileSync(new URL('../../S3_content/data/noble-titles.json', import.meta.url)));
const content = JSON.parse(readFileSync(new URL('../../S3_content/data/shadowdark-content.json', import.meta.url)));
const catalog = createBackgroundCatalog(content.monsters, titles);
const hero = (background, extra = {}) => ({ id: 'hero', lineageId: 'lineage', name: 'Erd', ancestry: 'Half-Orc', className: 'Priest',
  background, hp: 5, maxHitPoints: 5, stats: { STR: 10, WIS: 12 }, bonuses: [], gear: [], ...extra });

test('Minstrel is a legacy alias for Entertainer, while other background names are preserved', () => {
  assert.equal(backgroundKey(' Minstrel '), 'entertainer');
  assert.equal(canonicalBackground('Minstrel'), 'Entertainer');
  assert.equal(canonicalBackground('Orphaned'), 'Orphaned');
  const character = hero('Minstrel');
  initializeCharacterBackground(character, catalog);
  assert.equal(character.background, 'Entertainer'); assert.equal(character.raw.background, 'Entertainer');
  assert.equal(fieldLore('Background', 'Minstrel'), fieldLore('Background', 'Entertainer'));
});

test('orphan guardians have nonnegative intelligence, correct articles, and stable per-character wording', () => {
  for (const [guardian, expected] of [['oni', 'an oni'], ['sea hag', 'a sea hag'], ['unicorn', 'a unicorn']]) {
    const character = hero('Orphan');
    initializeCharacterBackground(character, { guardians: [{ name: guardian, sourceName: guardian, intelligence: 0 }], random: () => 0 });
    assert.equal(orphanBackgroundLore(character), `You were raised by ${expected}.`);
    assert.equal(fieldLore('Background', character.background, character), `You were raised by ${expected}.`);
    initializeCharacterBackground(character, { ...catalog, random: () => { throw new Error('must not reroll'); } });
    assert.equal(orphanBackgroundLore(character), `You were raised by ${expected}.`);
  }
  assert.ok(catalog.guardians.length > 80);
  assert.ok(catalog.guardians.every(guardian => guardian.intelligence >= 0));
  assert.equal(new Set(catalog.guardians.map(guardian => guardian.name)).size, catalog.guardians.length);
});

test('weighted draws respect exact fractional boundaries and choose culture before title', () => {
  const options = [{ name: 'A', weight: .5 }, { name: 'B', weight: 1 }, { name: 'C', weight: 2 }];
  assert.equal(weightedBackgroundChoice(options, () => 0).name, 'A');
  assert.equal(weightedBackgroundChoice(options, () => .5 / 3.5).name, 'B');
  assert.equal(weightedBackgroundChoice(options, () => 1.5 / 3.5).name, 'C');
  assert.equal(weightedBackgroundChoice(options, () => 1).name, 'C');
  assert.equal(weightedBackgroundChoice([], () => 0), null);
  const character = hero('Noble'); let rolls = [0, 0];
  initializeCharacterBackground(character, { ...catalog, random: () => rolls.shift() });
  assert.equal(character.backgroundDetails.nobility.culture, 'England & Western Feudal Ranks');
  assert.equal(character.name, 'Monarch Erd'); assert.equal(rolls.length, 0);
});

test('noble names preserve supplied case, accents, prefix/suffix placement, and joining grammar', () => {
  for (const [text, position, joiner, expected] of [['Sir', 'prefix', '', 'Sir Erd'],
    ['heir apparent', 'suffix', 'the', 'Erd the heir apparent'], ['peer', 'suffix', 'a', 'Erd a peer'],
    ['kuge', 'suffix', 'of the', 'Erd of the kuge'], ['Kurfürst', 'prefix', '', 'Kurfürst Erd'],
    ['grande de España', 'suffix', 'a', 'Erd a grande de España']]) {
    assert.equal(nobleName('Erd', { text, position, joiner }), expected);
  }
  assert.equal(catalog.cultures.length, 23);
  assert.equal(catalog.cultures.flatMap(culture => culture.titles).length, 312);
});

test('background details and noble names survive repeated normalization/save cycles without duplicate titles or stat changes', () => {
  let state = { characters: [hero('Noble')], entities: [], tiles: [], rooms: [], map: { width: 1, height: 1 }, player: {}, visibility: {} };
  initializeCharacterBackground(state.characters[0], catalog);
  const original = structuredClone(state.characters[0]);
  for (let index = 0; index < 5; index++) {
    normalizeCharacterState(state);
    state = hydrateDungeonState(serializeDungeonState(state));
    initializeCharacterBackground(state.characters[0], catalog);
    assert.equal(state.characters[0].name, original.name);
    assert.deepEqual(state.characters[0].backgroundDetails, original.backgroundDetails);
    assert.deepEqual(state.characters[0].stats, { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 12, CHA: 10 });
    assert.deepEqual(state.characters[0].bonuses, []);
    assert.equal(state.characters[0].hp, 5);
  }
});

test('saved results persist across changed party IDs and name edits retain one existing title', () => {
  const character = hero('Noble'); initializeCharacterBackground(character, catalog);
  const title = structuredClone(character.backgroundDetails.nobility);
  character.id = 'loaded-again'; character.name = 'Dor';
  initializeCharacterBackground(character, catalog);
  assert.equal(character.name, nobleName('Dor', title));
  initializeCharacterBackground(character, catalog);
  assert.equal(character.name, nobleName('Dor', title));
  assert.equal(character.backgroundDetails.nobility.culture, title.culture);
});

test('companions and discs do not gain invented adventurer backgrounds or name decorations', () => {
  for (const extra of [{ companion: { kind: 'friendly' } }, { summon: { kind: 'floating-disc' } }, { impersonation: { name: 'Erd' } }]) {
    const character = hero('Noble', extra), original = structuredClone(character);
    initializeCharacterBackground(character, catalog);
    assert.deepEqual(character, original);
  }
});
