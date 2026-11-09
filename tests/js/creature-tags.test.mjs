import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CREATURE_TAGS, canonicalCreatureTag, canonicalCreatureTags, creatureTags, hasCreatureTag, creatureMatchesTags
} from '../../S3_content/src/creature-tags.js';
import { buildMonsterCompanion } from '../../S3_content/src/companions.js';

test('approved broad families are the entire selector; humanoids and species are not choices', () => {
  assert.deepEqual(CREATURE_TAGS.map(([key]) => key), [
    'fiend', 'fey', 'undead', 'primordial', 'celestial', 'aberration', 'animal', 'construct',
    'dragon', 'giant', 'monstrosity', 'ooze', 'plant', 'shapechanger'
  ]);
  assert.ok(Object.isFrozen(CREATURE_TAGS));
  assert.ok(CREATURE_TAGS.every(Object.isFrozen));
  for (const rejected of ['humanoid', 'human', 'elf', 'goblinoid', 'orc', 'dwarf', 'snake', 'wolf',
    'horror', 'outsider', 'underdark', 'swarm', 'demon lord', 'fire elemental', null, {}, 12]) {
    assert.equal(canonicalCreatureTag(rejected), null, String(rejected));
  }
});

test('singular/plural raw tags and approved subtypes canonicalize without fuzzy name matching', () => {
  for (const [raw, expected] of [
    [' Fiends ', 'fiend'], ['DEMON', 'fiend'], ['devils', 'fiend'], ['Fey', 'fey'], ['Undead', 'undead'],
    ['Primordials', 'primordial'], ['elemental', 'primordial'], ['elementals', 'primordial'],
    ['Celestials', 'celestial'], ['angel', 'celestial'], ['angels', 'celestial'],
    ['Aberrations', 'aberration'], ['Animals', 'animal'], ['beast', 'animal'],
    ['Constructs', 'construct'], ['golems', 'construct'], ['Dragons', 'dragon'], ['Giants', 'giant'],
    ['Monstrosities', 'monstrosity'], ['Oozes', 'ooze'], ['Plants', 'plant'], ['Shapechangers', 'shapechanger']
  ]) assert.equal(canonicalCreatureTag(raw), expected, raw);
  assert.deepEqual(canonicalCreatureTags('devil, fiend; undead|angel'), ['fiend', 'undead', 'celestial']);
  assert.deepEqual(canonicalCreatureTags(['golem', 'construct', 'elf', 'elemental']), ['primordial', 'construct']);
  assert.deepEqual(canonicalCreatureTags(undefined), []);
});

test('actual/raw/companion tags combine read-only; player ancestry never supplies a tag', () => {
  const actor = { name: 'Human', ancestry: 'Elf', tags: ['devil', 'humanoid'], raw: { tags: ['undead'] },
    companion: { source: { name: 'Angel', tags: ['golem'], raw: { tags: ['elemental'] } } } };
  const before = structuredClone(actor);
  assert.deepEqual(creatureTags(actor), ['fiend', 'undead', 'primordial', 'construct']);
  assert.equal(hasCreatureTag(actor, 'golems'), true);
  assert.equal(hasCreatureTag(actor, 'elf'), false);
  assert.equal(creatureMatchesTags(actor, ['fey', 'construct']), true);
  assert.equal(creatureMatchesTags(actor, ['animal']), false);
  assert.deepEqual(actor, before);
  for (const ancestry of ['Human', 'Undead', 'Dragon', 'Golem', 'Fiend']) {
    assert.deepEqual(creatureTags({ name: 'Skeleton', ancestry, className: 'Monster',
      abilities: { Possess: 'An undead demon takes control.' } }), []);
  }
  assert.deepEqual(creatureTags({ raw: { companion: { source: { tags: ['undead'] } } } }), ['undead']);
  assert.deepEqual(creatureTags(null), []);
});

test('recruited or summoned undead companions retain actual source tags independent of ancestry', () => {
  const source = { id: 'skeleton', name: 'Skeleton', tags: ['undead'], hp: 7, ac: 13,
    x: 2, y: 2, S: 1, D: 1, C: 1, I: -3, W: 0, Ch: -2, gear: [], languages: [] };
  const companion = buildMonsterCompanion(source, { id: 'summoned', controllerId: 'wizard', kind: 'summoned' });
  companion.ancestry = 'Human';
  companion.name = 'Old Friend';
  assert.deepEqual(creatureTags(companion), ['undead']);
  assert.equal(hasCreatureTag(JSON.parse(JSON.stringify(companion)), 'undead'), true);
  companion.companion.source.tags = ['animal'];
  companion.ancestry = 'Undead';
  assert.deepEqual(creatureTags(companion), ['animal']);
});

test('all ten existing catalogs are read canonically without rewriting any records', () => {
  const seen = new Set();
  for (let tier = 1; tier <= 10; tier++) {
    const records = JSON.parse(readFileSync(new URL(`../../S3_content/monsters-${tier}.json`, import.meta.url), 'utf8'));
    const before = structuredClone(records);
    for (const record of records) {
      assert.deepEqual(creatureTags(record), canonicalCreatureTags(record.tags));
      for (const tag of creatureTags(record)) seen.add(tag);
    }
    assert.deepEqual(records, before);
  }
  assert.deepEqual([...seen].sort(), CREATURE_TAGS.map(([key]) => key).sort());
});
