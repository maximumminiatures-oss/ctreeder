import test from 'node:test';
import assert from 'node:assert/strict';
import { MONSTER_LANGUAGES, automaticMonsterLanguages, ensureMonsterLanguages, initializeMonsterLanguages,
  normalizeLanguages } from '../../S3_content/src/monster-languages.js';
import { creatureLanguages, reactionSpeaker, resolveReaction } from '../../S3_content/src/encounters.js';

test('automatic languages follow the supplied name rules, including reordered and compound names', () => {
  const examples = {
    Dwarvish: ['Duergar', 'Azer'], Elvish: ['Elf', 'Drow Priest', 'Fairy'],
    Giant: ['Giant, Frost', 'Ogre', 'Troll, Frost', 'Cyclops', 'Oni'],
    Goblin: ['Bugbear', 'Goblin', 'Hobgoblin', 'Worg'], Merran: ['Merfolk', 'Sahuagin', 'Siren', 'Deep One'],
    Orcish: ['Orc'], Reptilian: ['Lizardfolk', 'Viperian, Wizard', 'Kobold, Sorcerer', 'Naga, Bone', 'Salamander'],
    Sylvan: ['Centaur', 'Dryad', 'Fairy', 'Leprechaun', 'Ettercap', 'Gnome, Deep', 'Hag, Sea', 'Treant', 'Unicorn', "Will-o'-Wisp"],
    Thanian: ['Minotaur', 'Beastman', 'Manticore', 'Gorgon', 'Harpy', 'Medusa', 'Phoenix', 'Sphinx', 'Strangler'],
    Celestial: ['Angel', 'Archangel'], Diabolic: ['Demon', 'Fiend', 'Devil, Barbed', 'Archdevil', 'Hell Hound', 'Nightmare', 'Oni', 'Rakshasa'],
    Draconic: ['Dragon, Red', 'Coatl', 'Couatl', 'Hydra', 'Wyvern'],
    Primordial: ['Elder Thing', 'Elemental, Fire', 'Azer', 'Cloaker', 'Chuul', 'Brain Eater', 'Djinni', 'Efreeti', 'Gargoyle',
      'Invisible Stalker', 'Kraken', 'Rime Walker', 'Void Spawn', 'Roper'],
    Common: ['Apprentice', 'Archmage', 'Bandit', 'Assassin', 'Berserker', 'Cultist', 'Doppelganger', 'Druid', 'Ghost', 'Ghast',
      'Ghoul', 'Golem, Iron', 'Guard', 'Knight', 'Mage', 'Mummy', 'Peasant', 'Pirate', 'Priest', 'Reaver', 'Scarecrow', 'Shadow',
      'Skeleton', 'Soldier', 'Thug', 'Thief', 'Vampire, Ancient', 'Werewolf', 'Wererat', 'Wight', 'Wraith', 'Zombie']
  };
  for (const [language, names] of Object.entries(examples)) for (const name of names)
    assert.ok(automaticMonsterLanguages({ name }).includes(language), `${name}: ${language}`);
  assert.deepEqual(automaticMonsterLanguages({ name: 'Oni' }), ['Giant', 'Diabolic']);
  assert.deepEqual(automaticMonsterLanguages({ name: 'Azer' }), ['Dwarvish', 'Primordial']);
});

test('listed language-less creatures and animals get no automatic language; positive INT may add one', () => {
  const names = ['Gray Ooze','Grick','Griffon','Grimlow','Ochre Jelly','Stingbat','Ankheg','Animated Armor','Basilisk',
    'Black Pudding','Cave Brute','Bulette','Cave Creeper','Chimera','Cockatrice','Darkmantle','Gelatinous Cube','Otyugh',
    'Primordial Slime','Owlbear','Purple Worm','Remorhaz','Roc','Rot Flower','Rust Monster','Shambling Mound',
    'Tyrannosaurus','Panther','Pegasus','Scorpion, Giant','Smilodon','Vulture','Wolf, Dire','Wasp, Giant','Shark',
    'Snake, Giant','Crocodile','Piranha, Swarm','Scarab, Swarm','Crab, Giant','Centipede','Ape','Camel','Leech, Giant',
    'Mastiff','Spider, Giant','Ape, Snow','Mammoth','Moose','Manta Ray, Giant','Rhinoceros','Badger','Hippopotamus',
    'Lion','Bear, Cave','Bat, Vampire','Jellyfish','Boar','Hippogriff','Dung Beetle, Giant','Elephant','Rat, Giant','Frog, Giant','Gorilla','Horse','Octopus, Giant'];
  for (const name of names) assert.deepEqual(automaticMonsterLanguages({ name }), [], name);
  assert.deepEqual(ensureMonsterLanguages({ name: 'Animated Armor', I: 1 }, { random: () => 0 }), ['Common']);
});

test('each positive intelligence modifier adds one distinct language with Common weighted to 25 percent until acquired', () => {
  assert.deepEqual(ensureMonsterLanguages({ name: 'Orc', I: 1 }, { random: () => .249 }), ['Orcish', 'Common']);
  assert.deepEqual(ensureMonsterLanguages({ name: 'Orc', I: 1 }, { random: () => .25 }), ['Orcish', 'Dwarvish']);
  const many = ensureMonsterLanguages({ name: 'Archangel', '**I**': '+4' }, { random: () => 0 });
  assert.equal(many.length, 5); assert.equal(new Set(many).size, 5); assert.equal(many[1], 'Common');
  assert.equal(ensureMonsterLanguages({ name: 'Orc', I: 999 }, { random: () => .99 }).length, MONSTER_LANGUAGES.length);
  assert.deepEqual(ensureMonsterLanguages({ name: 'Orc', I: -1 }), ['Orcish']);
});

test('randomized language assignments survive serialization and repeated reads; old explicit lists are not rerolled', () => {
  const monster = { id: 'id-1', name: 'Oni', I: 3 }, duplicate = { ...monster };
  const languages = ensureMonsterLanguages(monster);
  assert.deepEqual(ensureMonsterLanguages(duplicate), languages);
  const restored = JSON.parse(JSON.stringify(monster));
  assert.deepEqual(ensureMonsterLanguages(restored, { random: () => { throw new Error('Rerolled'); } }), languages);
  assert.deepEqual(ensureMonsterLanguages({ name: 'Elf', I: 3, languages: 'Elvish, Common, ELVISH' }), ['Elvish','Common']);
  assert.deepEqual(ensureMonsterLanguages({ name: 'Elf', I: 3, languages: [] }), []);
  assert.deepEqual(ensureMonsterLanguages({ name: 'Elf', I: 3, raw: { languages: 'Sylvan' } }), ['Sylvan']);
  const state = { seed: 123, entities: [{ id:'new', type:'monster', name:'Drow', I:2 }] };
  initializeMonsterLanguages(state); const assigned = [...state.entities[0].languages]; initializeMonsterLanguages(state);
  assert.deepEqual(state.entities[0].languages, assigned);
  assert.deepEqual(normalizeLanguages('Angelic; Celestial; none'), ['Celestial']);
});

test('telepathic monsters speak every language even with low intelligence or a legacy list', () => {
  for (const name of ['Aboleth','Brain Eater','Mushroomfolk']) {
    assert.deepEqual(ensureMonsterLanguages({ name, I:-3, languages:['Common'] }), [...MONSTER_LANGUAGES]);
    assert.deepEqual(creatureLanguages({ name }, true), MONSTER_LANGUAGES.map(name => name.toLowerCase()));
  }
});

test('reaction chooses the highest-CHA conscious nearby speaker who actually shares a language', () => {
  const monster = { id:'orc', name:'Orc', I:0, x:0, y:0 };
  const character = (id, CHA, languages, extra = {}) => ({ id, x:1, y:0, hp:8, stats:{CHA}, languages, ...extra });
  const state = { characters:[character('best',18,'Common'), character('speaker',14,'Orcish'),
    character('sleep',20,'Orcish',{conditions:{sleeping:{}}}), character('far',20,'Orcish',{x:17})] };
  const speaker = reactionSpeaker(state, monster);
  assert.equal(speaker.id,'speaker'); assert.equal(resolveReaction(state,monster,{talk:true,speaker,random:()=>.5}).modifier,2);
  state.characters[1].languages = 'Common'; assert.equal(reactionSpeaker(state,monster),null);
  assert.equal(resolveReaction(state,monster,{talk:true,speaker:state.characters[0],random:()=>.5}).modifier,0);
});
