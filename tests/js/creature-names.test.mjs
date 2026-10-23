import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGuardianPool, creatureTypeName, indefiniteArticle } from '../../S3_content/src/creature-names.js';

test('creature type names use ordinary noun case and reorder category commas without mutating raw identifiers', () => {
  for (const [input, expected] of [['Hag, Sea', 'sea hag'], ['Wasp, Giant', 'giant wasp'], ['Giant, Cloud', 'cloud giant'],
    ['Elemental, Air', 'air elemental'], ['Dragon, Black, Adult', 'adult black dragon'], ['Drow, Priestess', 'drow priestess'],
    ['Demon, Marilith', 'marilith'], ['Demon, Vrock', 'vrock'], ['The Tarrasque', 'tarrasque'], ['  SEA   HAG ', 'sea hag']])
    assert.equal(creatureTypeName(input), expected);
  for (const name of ['Cubi', 'Domini', 'Principi', 'Merfolk', 'Mushroomfolk']) assert.equal(creatureTypeName(name), name.toLowerCase());
  assert.equal(creatureTypeName(null), '');
  assert.equal(creatureTypeName({ name: 'Oni' }), '');
});

test('guardian prose chooses articles by pronunciation for oni, sea hag, elf, unicorn, and common exceptions', () => {
  for (const [name, article] of [['Oni', 'an'], ['Hag, Sea', 'a'], ['Elf', 'an'], ['Unicorn', 'a'], ['Invisible Stalker', 'an'],
    ['Hourglass Spirit', 'an'], ['Honest Knight', 'an'], ['European Dragon', 'a'], ['One-Eyed Giant', 'a'],
    ['Undead Mage', 'an'], ['Unknown Creature', 'an'], ['The Tarrasque', 'a'], ['Cubi', 'a'], ['Merfolk', 'a']])
    assert.equal(indefiniteArticle(name), article, name);
  assert.equal(`You were raised by ${indefiniteArticle('Oni')} ${creatureTypeName('Oni')}.`, 'You were raised by an oni.');
  assert.equal(`You were raised by ${indefiniteArticle('Hag, Sea')} ${creatureTypeName('Hag, Sea')}.`, 'You were raised by a sea hag.');
});

test('guardian eligibility uses recorded INT modifiers, includes zero, and excludes missing, negative, or malformed values', () => {
  const pool = buildGuardianPool([
    { name: 'Oni', I: '+2' }, { name: 'Guard', I: 0 }, { name: 'Acolyte', I: '-1' }, { name: 'Rat', I: -3 },
    { name: 'Missing' }, { name: 'Empty', I: '' }, { name: 'Spaces', I: ' ' }, { name: 'Null', I: null },
    { name: 'Boolean', I: false }, { name: 'Array', I: [] }, { name: 'NaN', I: NaN }, { name: 'Infinity', I: Infinity },
    { name: 'Malformed', I: '+1 INT' }, { name: 'Fraction', I: .5 }, { name: 'Fraction String', I: '1.5' }, null,
    { I: 3 }, { name: 'Elf', I: ' +1 ' }, { 'Monster Name': 'Hag, Sea', '**I**': '+1' }, { name: 'Wizard', intelligence: 2 }
  ]);
  assert.deepEqual(pool, [
    { name: 'elf', sourceName: 'Elf', intelligence: 1 }, { name: 'guard', sourceName: 'Guard', intelligence: 0 },
    { name: 'oni', sourceName: 'Oni', intelligence: 2 }, { name: 'sea hag', sourceName: 'Hag, Sea', intelligence: 1 },
    { name: 'wizard', sourceName: 'Wizard', intelligence: 2 }
  ]);
});

test('guardian types are unique, sorted, and retain the first eligible raw source record without changing inputs', () => {
  const monsters = [{ name: 'Hag, Sea', I: -1 }, { name: 'Sea Hag', I: '+1', slug: 'sea-hag' },
    { name: 'Hag, Sea', I: '+2', slug: 'other-hag' }, { name: 'ONI', I: 2 }, { name: 'Oni', I: 2 },
    { name: 'Demon, Marilith', I: 3 }, { name: 'Marilith', I: 3 }];
  const before = structuredClone(monsters);
  assert.deepEqual(buildGuardianPool(monsters), [
    { name: 'marilith', sourceName: 'Demon, Marilith', intelligence: 3 },
    { name: 'oni', sourceName: 'ONI', intelligence: 2 }, { name: 'sea hag', sourceName: 'Sea Hag', intelligence: 1 }
  ]);
  assert.deepEqual(monsters, before);
  assert.deepEqual(buildGuardianPool(null), []);
});

test('the complete local catalog yields the documented guardian list without changing game names or IDs', async () => {
  const catalog = JSON.parse(await readFile(new URL('../../S3_content/data/shadowdark-content.json', import.meta.url), 'utf8'));
  const pool = buildGuardianPool(catalog.monsters);
  assert.equal(catalog.monsters.length, 557);
  assert.equal(pool.length, 95);
  assert.equal(new Set(pool.map(entry => entry.name)).size, 95);
  assert.deepEqual(pool.map(entry => entry.name), pool.map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'en')));
  for (const name of ['oni', 'sea hag', 'elf', 'unicorn', 'cubi', 'domini', 'principi', 'merfolk', 'mushroomfolk', 'tarrasque']) {
    const entry = pool.find(entry => entry.name === name);
    assert.ok(entry, name);
    assert.ok(entry.intelligence >= 0);
    assert.ok(catalog.monsters.some(monster => monster.name === entry.sourceName && Number(monster.I) === entry.intelligence));
  }
  assert.equal(pool.filter(entry => /marilith/.test(entry.name)).length, 1);
  assert.equal(catalog.monsters.find(monster => monster.slug === 'the-tarrasque').name, 'The Tarrasque');
  const report = await readFile(new URL('../../docs/ORPHAN_GUARDIANS.md', import.meta.url), 'utf8');
  const rows = report.split('\n').filter(line => /^\| [a-z]/.test(line));
  assert.equal(rows.length, pool.length);
  for (const entry of pool) assert.ok(rows.includes(`| ${entry.name} | +${entry.intelligence} | ${entry.sourceName} |`), entry.name);
});
