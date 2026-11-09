import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Printed pages 51-53 list the spells. Floating Disk uses the approved Disc spelling.
const expected = {
  1: {
    wizard: ['Alarm', 'Burning Hands', 'Charm Person', 'Detect Magic', 'Feather Fall', 'Floating Disc', 'Hold Portal', 'Light', 'Mage Armor', 'Magic Missile', 'Protection from Evil', 'Sleep'],
    priest: ['Cure Wounds', 'Holy Weapon', 'Light', 'Protection from Evil', 'Shield Of Faith', 'Turn Undead']
  },
  2: {
    wizard: ['Acid Arrow', 'Alter Self', 'Detect Thoughts', 'Fixed Object', 'Hold Person', 'Invisibility', 'Knock', 'Levitate', 'Mirror Image', 'Misty Step', 'Silence', 'Web'],
    priest: ['Augury', 'Bless', 'Blind/Deafen', 'Cleansing Weapon', 'Smite', 'Zone of Truth']
  },
  3: {
    wizard: ['Animate Dead', 'Dispel Magic', 'Fabricate', 'Fireball', 'Fly', 'Gaseous Form', 'Illusion', 'Lightning Bolt', 'Magic Circle', 'Protection From Energy', 'Sending', 'Speak With Dead'],
    priest: ['Command', 'Lay To Rest', 'Mass Cure', 'Rebuke Unholy', 'Restoration', 'Speak With Dead']
  }
};

for (const [tier, classes] of Object.entries(expected)) {
  const records = JSON.parse(await readFile(new URL(`../../S3_content/spells/tier-${tier}.json`, import.meta.url), 'utf8'));
  for (const [className, names] of Object.entries(classes)) {
    test(`tier ${tier} ${className} catalog covers the complete rulebook list without duplicates`, () => {
      const selected = records.filter(record => record.classes.includes(className));
      assert.deepEqual(selected.map(record => record.name.toLowerCase()).sort(), names.map(name => name.toLowerCase()).sort());
      assert.equal(new Set(selected.map(record => record.slug)).size, selected.length);
      for (const record of selected) {
        assert.equal(record.tier, Number(tier));
        assert.ok(record.rangeBand && record.duration && record.description && record.paragraphs.length);
      }
    });
  }
}

test('Protection From Energy is its own Close-range wizard Focus spell, not part of Protection from Evil', async () => {
  const records = JSON.parse(await readFile(new URL('../../S3_content/spells/tier-3.json', import.meta.url), 'utf8'));
  const record = records.find(spell => spell.slug === 'protection-from-energy');
  assert.equal(record.name, 'Protection From Energy');
  assert.equal(record.duration, 'Focus');
  assert.equal(record.rangeBand, 'close');
  assert.deepEqual(record.classes, ['wizard']);
  assert.match(record.description, /fire, cold, or electricity/);
  assert.match(record.description, /immune/);
});
