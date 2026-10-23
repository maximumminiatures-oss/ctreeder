import test from 'node:test';
import assert from 'node:assert/strict';
import { abilityLore, fieldLore } from '../../S3_content/src/sheet-field-lore.js';
import { ALIGNMENT_LORE, DEITY_LORE, sheetLore } from '../../S3_content/src/sheet-lore.js';

const wordCount = text => text.trim().split(/\s+/).length;
const concise = text => {
  assert.equal(typeof text, 'string');
  assert.ok(text.trim().length > 0);
  assert.ok(wordCount(text) <= 20, `${wordCount(text)} words: ${text}`);
};

test('reviewed ability wording is preserved through short names, full names, and field lookups', () => {
  for (const [key, name] of [['STR', 'Strength'], ['DEX', 'Dexterity'], ['CON', 'Constitution'],
    ['INT', 'Intelligence'], ['WIS', 'Wisdom'], ['CHA', 'Charisma']]) {
    assert.ok(abilityLore(key).startsWith(`${name}:`));
    assert.equal(abilityLore(key), abilityLore(` ${name.toUpperCase()} `));
    assert.equal(fieldLore(key, 18), abilityLore(key));
    assert.equal(fieldLore(name), abilityLore(key));
  }
  assert.match(abilityLore('STR'), /Adds gear slots\./);
  assert.match(abilityLore('INT'), /wizard/);
  assert.match(abilityLore('WIS'), /priest/);
});

test('all six base ancestries preserve reviewed prose, including descriptions longer than twenty words', () => {
  const ancestries = ['Dwarf', 'Elf', 'Goblin', 'Halfling', 'Half-Orc', 'Human'];
  assert.equal(new Set(ancestries.map(name => fieldLore('Ancestry', name))).size, 6);
  ancestries.forEach(name => assert.ok(fieldLore('Ancestry', name).length > 0));
  for (const name of ['Fighter', 'Priest', 'Thief', 'Wizard']) concise(fieldLore('Class', name));
  assert.match(fieldLore('Ancestry', 'Half-Orc'), /cunning with blades/);
  assert.ok(wordCount(fieldLore('Ancestry', 'Halfling')) > 20);
  assert.equal(fieldLore('Ancestry', 'half_orc'), fieldLore('Ancestry', 'Half-Orc'));
  assert.equal(fieldLore('Ancestry', 'HalfOrc'), fieldLore('Ancestry', 'Half-Orc'));
  assert.equal(fieldLore('Class', 'Cleric'), fieldLore('Class', 'Priest'));
  assert.equal(fieldLore('Class', 'Rogue'), fieldLore('Class', 'Thief'));
});

test('all twenty rulebook backgrounds have distinct, concise summaries and normalize apostrophes', () => {
  const backgrounds = ['Urchin', 'Wanted', 'Cult Initiate', "Thieves' Guild", 'Banished', 'Orphaned', "Wizard's Apprentice",
    'Jeweler', 'Herbalist', 'Barbarian', 'Mercenary', 'Sailor', 'Acolyte', 'Soldier', 'Ranger', 'Scout', 'Minstrel', 'Scholar', 'Noble', 'Chirurgeon'];
  const descriptions = backgrounds.map(name => fieldLore('Background', name));
  assert.equal(new Set(descriptions).size, 20);
  descriptions.forEach(concise);
  assert.equal(fieldLore('Background', 'Thieves\u2019 Guild'), fieldLore('Background', "Thieves' Guild"));
  assert.equal(fieldLore('Background', 'Wizards Apprentice'), fieldLore('Background', "Wizard's Apprentice"));
  assert.notEqual(fieldLore('Background', 'Acolyte'), fieldLore('Title', 'Acolyte'));
});

test('class titles and the Title field no longer have hover descriptions', () => {
  const groups = [
    ['Fighter', 'lawful', ['Squire', 'Cavalier', 'Knight', 'Thane', 'Lord/Lady']],
    ['Fighter', 'chaotic', ['Knave', 'Bandit', 'Slayer', 'Reaver', 'Warlord']],
    ['Fighter', 'neutral', ['Warrior', 'Barbarian', 'Battlerager', 'Warchief', 'Chieftain']],
    ['Priest', 'lawful', ['Acolyte', 'Crusader', 'Templar', 'Champion', 'Paladin']],
    ['Priest', 'chaotic', ['Initiate', 'Zealot', 'Cultist', 'Scourge', 'Chaos Knight']],
    ['Priest', 'neutral', ['Seeker', 'Invoker', 'Haruspex', 'Mystic', 'Oracle']],
    ['Thief', 'lawful', ['Footpad', 'Burglar', 'Rook', 'Underboss', 'Boss']],
    ['Thief', 'chaotic', ['Thug', 'Cutthroat', 'Shadow', 'Assassin', 'Wraith']],
    ['Thief', 'neutral', ['Robber', 'Outlaw', 'Rogue', 'Renegade', 'Bandit King/Queen']],
    ['Wizard', 'lawful', ['Apprentice', 'Conjurer', 'Arcanist', 'Mage', 'Archmage']],
    ['Wizard', 'chaotic', ['Adept', 'Channeler', 'Witch/Warlock', 'Diabolist', 'Sorcerer']],
    ['Wizard', 'neutral', ['Shaman', 'Seer', 'Warden', 'Sage', 'Druid']]
  ];
  for (const [, , names] of groups) names.forEach(name => assert.equal(fieldLore('Title', name), ''));
  assert.equal(fieldLore('Title'), '');
  assert.equal(fieldLore('Title', 'Lady'), fieldLore('Title', 'Lord/Lady'));
  assert.equal(fieldLore('Title', 'Warlock'), fieldLore('Title', 'Witch/Warlock'));
  assert.equal(fieldLore('Title', 'Bandit Queen'), fieldLore('Title', 'Bandit King/Queen'));
});

test('all popup field headings and common internal field aliases return concise text', () => {
  for (const field of ['Ancestry', 'Class', 'Alignment', 'Deity', 'Level', 'XP', 'Background', 'Stats', 'HP', 'AC',
    'Attacks', 'Gear', 'Gear Slots', 'Coins', 'GP', 'SP', 'CP', 'Free To Carry', 'Talents', 'Spells', 'TALENTS / SPELLS', 'Languages']) concise(fieldLore(field));
  for (const [alias, field] of [['className', 'Class'], ['maxHitPoints', 'HP'], ['armor_class', 'AC'], ['gearSlotsTotal', 'Gear Slots'],
    ['Equipment', 'Gear'], ['Experience Points', 'XP'], ['Gold Pieces', 'GP'], ['Total Coins', 'Coins'], ['FreeCarry', 'Free To Carry'],
    ['Talents and Spells', 'Talents / Spells']]) assert.equal(fieldLore(alias), fieldLore(field), alias);
  assert.match(fieldLore('Coins'), /10 silver or 100 copper/);
  assert.match(fieldLore('Free To Carry'), /up to 100 coins/);
});

test('reviewed fields remove Name help and use class-specific spellcasting help', () => {
  assert.equal(fieldLore('Name', 'Badzog'), '');
  assert.equal(fieldLore('Character Name', 'A very long name'), '');
  assert.equal(fieldLore('Spells', 'Wizard'), "Cast with intelligence, DC 10 plus the spell's tier to cast.");
  assert.equal(fieldLore('Spells', 'Priest'), "Cast with wisdom, DC 10 plus the spell's tier to cast.");
  assert.equal(fieldLore('Spells', 'Cleric'), fieldLore('Spells', 'Priest'));
  assert.equal(fieldLore('XP'), 'gained by selling treasure, socializing with friends and partying.');
  assert.equal(fieldLore('Gear'), 'This is your stuff. If you are strong you can carry more.');
  assert.equal(fieldLore('AC'), 'Armor Class. How hard are you to hit?');
  assert.equal(fieldLore('GP'), 'Gold pieces');
  assert.equal(fieldLore('SP'), 'Silver pieces');
  assert.equal(fieldLore('CP'), 'Copper pieces');
});

test('existing user-authored deity and alignment lore is preserved verbatim, including long passages and aliases', () => {
  for (const [value, text] of Object.entries(DEITY_LORE)) assert.equal(fieldLore('Deity', value), text);
  for (const [value, text] of Object.entries(ALIGNMENT_LORE)) assert.equal(fieldLore('Alignment', value), text);
  for (const value of ['Madeera', 'Shune', 'Saint Terrangis']) assert.equal(fieldLore('deity', value), sheetLore('Deity', value));
  assert.ok(wordCount(fieldLore('Deity', 'Gede')) > 20, 'the limit must not silently truncate existing custom lore');
});

test('unknown values use generic field help; unknown fields and prototype-like input do not leak object properties', () => {
  for (const field of ['Ancestry', 'Class', 'Background', 'Title', 'Deity', 'Alignment']) {
    assert.equal(fieldLore(field, 'Unknown Custom Value'), fieldLore(field));
    assert.equal(fieldLore(field, '__proto__'), fieldLore(field));
    assert.equal(fieldLore(field, 'constructor'), fieldLore(field));
    assert.equal(fieldLore(field, 'toString'), fieldLore(field));
  }
  for (const field of ['', null, undefined, 'not a field', '__proto__', 'constructor', 'toString']) assert.equal(fieldLore(field), '');
  for (const key of ['', null, undefined, 'Luck', 'constructor', '__proto__']) assert.equal(abilityLore(key), '');
});
