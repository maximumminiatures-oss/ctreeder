import test from 'node:test';
import assert from 'node:assert/strict';
import { ancestryKey, ancestryTalents, ancestryTalentRows, isRepresentedAncestryBonus, elfFarsightChoice,
  ancestryAttackModifiers, ancestryCastingBonus, hasAncestryTrait } from '../../S3_content/src/ancestry.js';
import { extractShadowdarkCharacters, normalizeCharacterState } from '../../S3_content/src/characters.js';
import { initializeImportChoices, classAttackBonus, beginLevelUp } from '../../S3_content/src/class-progression.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { activateHalflingInvisibility, revealAfterOffense, neverSurprised } from '../../S3_content/src/concealment.js';
import { castingBonus } from '../../S3_content/src/spell-effects.js';

function hero(ancestry = 'Half-Orc', extra = {}) {
  return { id: 'hero', name: 'Hero', ancestry, className: 'Fighter', level: 1, hp: 10, maxHitPoints: 10, XP: 10,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 14, WIS: 12, CHA: 10 }, gear: [], bonuses: [], levels: [], raw: {}, ...extra };
}
const elfBonus = (bonusName, bonusTo, extra = {}) => ({ sourceType: 'Ancestry', sourceName: 'Elf', name: 'FarSight', bonusName, bonusTo, bonusAmount: 1, ...extra });

test('Mighty is intrinsic, applies exactly once to melee including unarmed, and never applies to ranged attacks', () => {
  const character = hero();
  assert.deepEqual(ancestryAttackModifiers(character), { attack: 1, damage: 1 });
  character.bonuses = [{ sourceType: 'Ancestry', sourceName: 'Half-Orc', name: 'Mighty', bonusName: 'Plus1ToHit', bonusTo: 'Melee attacks', bonusAmount: 1 }];
  assert.deepEqual(ancestryAttackModifiers(character), { attack: 1, damage: 1 });
  assert.deepEqual(ancestryAttackModifiers(character, { ranged: true }), { attack: 0, damage: 0 });
  assert.equal(classAttackBonus(character, false), 0, 'ancestry metadata is not also a class talent');
  character.bonuses.push({ sourceType: 'Class', name: 'Plus1ToHit', bonusTo: 'Melee and ranged attacks', bonusAmount: 1 });
  assert.equal(classAttackBonus(character, false), 1);
});

test('Elf Farsight recognizes imported ranged/casting choices, numeric bonus records, and explicit saved choices without granting both', () => {
  for (const bonus of [elfBonus('Plus1ToRangedAttacks', 'RangedWeapons'), elfBonus('AttackBonus', 'RangedWeapons', { name: 'AttackBonus' }),
    elfBonus('AttackBonus', 'RangedWeapons', { name: 'AttackBonus', bonusAmount: undefined })]) {
    const character = hero('Elf', { bonuses: [bonus] });
    assert.equal(elfFarsightChoice(character), 'ranged');
    assert.deepEqual(ancestryAttackModifiers(character, { ranged: true }), { attack: 1, damage: 0 });
    assert.equal(ancestryCastingBonus(character), 0);
    assert.equal(isRepresentedAncestryBonus(character, bonus), true);
  }
  for (const bonus of [elfBonus('Plus1ToCastingSpells', 'Spellcasting'), elfBonus('Spellcasting', 'Spellcasting', { name: 'Spellcasting' }),
    elfBonus('Spellcasting', 'Spellcasting', { name: 'Spellcasting', bonusAmount: undefined })]) {
    const character = hero('Elf', { bonuses: [bonus, structuredClone(bonus)] });
    assert.equal(elfFarsightChoice(character), 'casting');
    assert.equal(ancestryCastingBonus(character), 1);
    assert.equal(castingBonus(character, 'wizard'), 1, 'duplicate imported records do not add a second Farsight');
    assert.equal(ancestryAttackModifiers(character, { ranged: true }).attack, 0);
  }
  const unknown = hero('Elf');
  assert.equal(elfFarsightChoice(unknown), '');
  assert.equal(ancestryCastingBonus(unknown), 0);
  assert.match(ancestryTalents(unknown)[0].text, /choice not recorded/);
  unknown.ancestryChoices = { farsight: 'ranged' };
  assert.equal(elfFarsightChoice(unknown), 'ranged');
  unknown.bonuses = [elfBonus('Spellcasting', 'Spellcasting')];
  assert.equal(elfFarsightChoice(unknown), 'ranged', 'explicit selection overrides stale imported metadata');
  assert.equal(castingBonus(unknown, 'wizard'), 0);
  delete unknown.ancestryChoices;
  unknown.bonuses.push(elfBonus('AttackBonus', 'RangedWeapons'));
  assert.equal(elfFarsightChoice(unknown), '', 'contradictory records do not grant both effects');
});

test('canonical ancestry rows match requested wording, while extra spells and spell advantage remain separate', () => {
  assert.equal(ancestryTalentRows, ancestryTalents);
  assert.equal(ancestryTalents(hero())[0].text, 'Mighty. +1 to attack and damage with melee weapons.');
  assert.equal(ancestryTalents(hero('Dwarf'))[0].text, 'Stout +2 HP. Upon gaining a level, roll new HP with advantage.');
  assert.equal(ancestryTalents(hero('Goblin'))[0].text, "Keen Senses: you can't be surprised.");
  assert.equal(ancestryTalents(hero('Halfling'))[0].text, 'Stealthy: Once per day become invisible for 3 rounds.');
  const character = hero('Elf');
  for (const bonus of [elfBonus('AdvOnCastOneSpell', 'Magic Missile'), elfBonus('Sleep', 'Tier:1, Spell:1', { name: 'Spell: Wizard, Tier 1' })])
    assert.equal(isRepresentedAncestryBonus(character, bonus), false);
});

test('Human Ambition displays only the actual recorded benefit, never reapplies stats, and retains mechanical attack bonuses', () => {
  const stat = { sourceType: 'Ambition', sourceName: 'Priest', name: 'StatBonus', bonusTo: 'WIS:+2' };
  const character = hero('Human', { bonuses: [stat], stats: { WIS: 14 } });
  const before = structuredClone(character);
  assert.equal(ancestryTalents(character)[0].text, 'Ambitious: +2 to Wisdom.');
  assert.equal(isRepresentedAncestryBonus(character, stat), true);
  character.bonuses = [{ ...stat, sourceType: 'Ancestry', sourceName: 'Human' }];
  assert.equal(ancestryTalents(character)[0].text, 'Ambitious: +2 to Wisdom.');
  character.bonuses = [stat];
  assert.deepEqual(character, before);
  const actualImport = { ...stat, sourceType: 'Ancestry', sourceName: 'Human Ambition', sourceCategory: 'Talent' };
  assert.equal(ancestryTalents({ ...character, bonuses: [actualImport] })[0].text, 'Ambitious: +2 to Wisdom.');
  assert.equal(isRepresentedAncestryBonus(character, actualImport), true);
  const attack = { sourceType: 'Ambition', sourceName: 'Fighter', name: 'Plus1ToHit', bonusTo: 'Melee and ranged attacks', bonusAmount: 1 };
  character.bonuses = [attack];
  assert.equal(isRepresentedAncestryBonus(character, attack), true);
  assert.equal(classAttackBonus(character, true), 1);
  assert.equal(classAttackBonus(character, false), 1);
  assert.doesNotMatch(ancestryTalents(character)[0].text, /Wisdom/);
  const unrelated = { sourceType: 'Class', sourceName: 'Fighter', name: 'StatBonus', bonusTo: 'WIS:+2' };
  assert.equal(isRepresentedAncestryBonus(character, unrelated), false);
});

test('fresh import choices remove only class-owned selections, preserving ancestry and ambition spell mechanics', () => {
  const ancestry = elfBonus('AdvOnCastOneSpell', 'Magic Missile', { name: 'AdvOnCastOneSpell' });
  const ambition = { sourceType: 'Ambition', sourceName: 'Wizard', name: 'Spell: Wizard, Tier 1', bonusName: 'Sleep', bonusTo: 'Tier:1, Spell:1' };
  const classSpell = { sourceType: 'Class', sourceName: 'Wizard', name: 'Spell: Wizard, Tier 1', bonusName: 'Light', bonusTo: 'Tier:1, Spell:1' };
  for (const extraClassTalent of [false, true]) {
    const character = hero('Elf', { className: 'Wizard', bonuses: [ancestry, ambition, classSpell], spellsKnown: 'Light, Sleep' });
    if (extraClassTalent) character.bonuses.push({ sourceType: 'Class', sourceName: 'Wizard', name: 'AdvOnCastOneSpell', bonusName: 'AdvOnCastOneSpell', bonusTo: 'Light' });
    initializeImportChoices(character);
    assert.ok(character.bonuses.includes(ancestry));
    assert.ok(character.bonuses.includes(ambition));
    assert.ok(!character.bonuses.includes(classSpell));
    assert.equal(character.spellsKnown, 'Sleep', 'the inherited spell is actually available, not only displayed');
    assert.equal(character.advancements[0].tasks.filter(task => task.type === 'spell-advantage').length, extraClassTalent ? 1 : 0);
  }
  const mastery = { sourceType: 'Ambition', name: 'WeaponMastery', bonusTo: 'Spear' };
  const fighter = hero('Human', { bonuses: [mastery] });
  initializeImportChoices(fighter);
  assert.ok(fighter.bonuses.includes(mastery));
  const human = hero('Human', { className: 'Wizard', bonuses: [ambition, classSpell], learnedScrollSpells: ['Feather Fall'], spellsKnown: 'Light, Sleep, Feather Fall' });
  initializeImportChoices(human);
  assert.equal(human.spellsKnown, 'Sleep, Feather Fall');
  assert.deepEqual(human.learnedScrollSpells, ['Feather Fall']);
  assert.deepEqual(human.raw.learnedScrollSpells, ['Feather Fall']);
});

test('original ancestry survives Foe Form, and native companions, discs, and impersonators never gain adventurer traits', () => {
  const character = hero('Orc', { transformationEffects: [{ spell: 'alter self', rounds: 3, originalAncestry: 'Half-Orc' }] });
  assert.equal(ancestryKey(character), 'half orc');
  assert.equal(ancestryAttackModifiers(character).damage, 1);
  for (const extra of [{ companion: { kind: 'friendly' } }, { companion: { kind: 'doppelganger' } }, { summon: { kind: 'floating-disc' } }, { impersonation: { name: 'Hero' } }]) {
    const fake = hero('Half-Orc', extra);
    assert.equal(ancestryKey(fake), '');
    assert.deepEqual(ancestryTalents(fake), []);
    assert.deepEqual(ancestryAttackModifiers(fake), { attack: 0, damage: 0 });
  }
});

test('raw imports and repeated normalization/save cycles preserve choices and source bonuses without accumulating effects', () => {
  const raw = hero('Elf', { ancestryChoices: { farsight: 'casting' }, bonuses: [elfBonus('Spellcasting', 'Spellcasting')], attacks: ['Dagger: +0, 1d4'] });
  delete raw.raw;
  const original = structuredClone(raw), character = extractShadowdarkCharacters(JSON.stringify(raw))[0];
  let state = { characters: [character], entities: [], tiles: [], rooms: [], map: { width: 1, height: 1 }, player: {}, visibility: {} };
  for (let i = 0; i < 5; i++) {
    normalizeCharacterState(state);
    state = hydrateDungeonState(serializeDungeonState(state));
    assert.equal(ancestryCastingBonus(state.characters[0]), 1);
    assert.deepEqual(state.characters[0].bonuses, original.bonuses);
    assert.deepEqual(state.characters[0].ancestryChoices, { farsight: 'casting' });
  }
  assert.deepEqual(raw, original);
});

test('Dwarf Stout, Goblin surprise immunity, and Halfling rest-gated invisibility remain intact', () => {
  const dwarf = hero('Dwarf'); let rolls = [0, .99];
  const event = beginLevelUp(dwarf, { random: () => rolls.shift() });
  assert.deepEqual(event.hpRolls, [1, 8]);
  assert.equal(dwarf.maxHitPoints, 18, 'starting +2 HP is not added a second time');
  const transformedDwarf = hero('Bandit', { transformationEffects: [{ spell: 'alter self', rounds: 1, originalAncestry: 'Dwarf' }] });
  rolls = [0, .99];
  assert.equal(beginLevelUp(transformedDwarf, { random: () => rolls.shift() }).hpGain, 8);
  assert.equal(hasAncestryTrait(hero('Goblin'), 'Keen Senses'), true);
  assert.equal(neverSurprised(hero('Goblin')), true);
  assert.equal(neverSurprised(hero('Bandit', { transformationEffects: [{ spell: 'alter self', rounds: 1, originalAncestry: 'Goblin' }] })), true);
  assert.equal(neverSurprised(hero('Goblin', { transformationEffects: [{ spell: 'alter self', rounds: 1, originalAncestry: 'Human' }] })), false);
  const halfling = hero('Halfling');
  activateHalflingInvisibility(halfling); revealAfterOffense(halfling);
  assert.equal(halfling.invisibility.rounds, 3);
  assert.throws(() => activateHalflingInvisibility(halfling), /unavailable/);
  const transformedHalfling = hero('Bandit', { transformationEffects: [{ spell: 'alter self', rounds: 1, originalAncestry: 'Halfling' }] });
  activateHalflingInvisibility(transformedHalfling);
  assert.equal(transformedHalfling.invisibility.rounds, 3);
});
