import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const library = JSON.parse(fs.readFileSync(new URL('../../S3_content/spells/tier-2.json', import.meta.url), 'utf8'));
const priestSpells = ['augury', 'bless', 'blind-deafen', 'cleansing-weapon', 'smite', 'zone-of-truth'];
const spell = slug => library.find(entry => entry.slug === slug);

test('six priest entries retain metadata and consistent description paragraphs', () => {
  for (const slug of priestSpells) {
    const entry = spell(slug);
    assert.ok(entry, slug);
    assert.equal(entry.tier, 2);
    assert.ok(entry.classes.includes('priest'));
    assert.equal(entry.description, entry.paragraphs.join('\n\n'));
  }
});

test('Blind/Deafen critical offers two targets or both senses, never increased range', () => {
  const text = spell('blind-deafen').description;
  assert.match(text, /two targets or both blindness and deafness on one target/);
  assert.match(text, /Range does not increase/);
  assert.match(text, /becomes blinded or deafened/);
  assert.match(text, /DC 12/);
  assert.match(text, /later Focus checks cannot grant or change it/);
});

test('Zone of Truth permits one question each successful Focus round and critical range twelve', () => {
  const text = spell('zone-of-truth').description;
  assert.match(text, /one question on each successful Focus round/);
  assert.match(text, /initial casting check increases the range to twelve squares/);
});

test('Augury critical clarifies guidance; priest damage descriptions do not imply fire hooks', () => {
  assert.match(spell('augury').description, /natural 20.*clearer and more specific/);
  assert.match(spell('bless').description, /gains a Luck Token/);
  assert.match(spell('smite').description, /1d6 radiant damage, not fire damage/);
  assert.match(spell('cleansing-weapon').description, /1d4 radiant damage, or 1d6 against undead/);
  assert.match(spell('cleansing-weapon').description, /does not ignite webs or burn treasure/);
});
