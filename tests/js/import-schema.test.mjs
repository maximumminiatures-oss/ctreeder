import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractShadowdarkCharacters, normalizeCharacterState } from '../../S3_content/src/characters.js';
import { initializeImportChoices, classAttackBonus, beginLevelUp, resolveAdvancement } from '../../S3_content/src/class-progression.js';
import { classTalentForRoll } from '../../S3_content/src/import-talents.js';
import { ancestryTalents } from '../../S3_content/src/ancestry.js';
import { castingBonus } from '../../S3_content/src/spell-effects.js';
import { selectedSpellCastingAdvantage } from '../../S3_content/src/wizard-mishaps.js';

const scores = () => ({ STR: 15, DEX: 12, CON: 11, INT: 16, WIS: 14, CHA: 9 });
const hero = (className = 'Priest', extra = {}) => ({ id: 'hero', name: 'Hero', className, ancestry: 'Human', level: 1,
  stats: scores(), rolledStats: scores(), hp: 7, maxHitPoints: 9,
  gear: [{ name: 'Holy Symbol', custom: 'keep' }], languages: 'Common, Celestial', bonuses: [], levels: [], raw: {}, ...extra });
const sequence = (...values) => { let index = 0; return () => values[index++] ?? values.at(-1); };
const spells = JSON.parse(fs.readFileSync(new URL('../../S3_content/spells/tier-1.json', import.meta.url)));

test('local talent tables cover every 2d6 result for all four classes', () => {
  const expected = {
    fighter: ['mastery','attack','attack','attack','attack','stat','stat','stat','armor','armor','wild'],
    priest: ['spell-advantage','attack-choice','attack-choice','attack-choice','attack-choice','casting','casting','casting','stat','stat','wild'],
    thief: ['initiative','backstab','backstab','backstab','stat','stat','stat','stat','attack','attack','wild'],
    wizard: ['magic-item','casting-or-int','casting-or-int','casting-or-int','casting-or-int','casting-or-int','spell-advantage','spell-advantage','extra-spell','extra-spell','wild']
  };
  for (const [key, values] of Object.entries(expected)) assert.deepEqual(values.map((_, index) => classTalentForRoll(key, index + 2)), values);
});

test('fresh human priest rolls native class and extra talents, ignores imported TALENT outcomes, and preserves identity', () => {
  for (const [STR, DEX, ranged] of [[15,12,false], [12,15,true], [12,12,true]]) {
    const character = hero(); Object.assign(character.stats, { STR, DEX }); Object.assign(character.rolledStats, { STR, DEX });
    character.ambitionTalentLevel = { level: 1, talentRolledName: 'CreateMagicItem', talentRolledDesc: 'Imported result must not control the roll' };
    character.levels = [{ level: 1, HitPointRoll: 6, talentRolledName: 'StatBonus', talentRolledDesc: '+2 Strength' }];
    character.bonuses = [{ sourceType: 'Ambition', sourceName: 'Priest', name: 'AttackBonus', bonusTo: 'Priest', bonusAmount: 99 },
      { sourceType: 'Class', sourceCategory: 'Talent', name: 'InitiativeAdvantage', bonusTo: 'Initiative' },
      { sourceType: 'Class', sourceCategory: 'Ability', name: 'ExtraLanguage', bonusTo: 'Languages', bonusName: 'Celestial' }];
    const before = structuredClone(character);
    initializeImportChoices(character, { random: sequence(.5,.5,.2,.2) });
    const event = character.advancements[0];
    assert.equal(event.talentRoll.total, 8); assert.equal(event.ambitionTalentRoll.total, 4);
    assert.equal(classAttackBonus(character, ranged), 1); assert.equal(classAttackBonus(character, !ranged), 0);
    assert.equal(castingBonus(character), 1); assert.ok(!character.bonuses.some(bonus => bonus.name === 'InitiativeAdvantage'));
    assert.match(ancestryTalents(character)[0].text, new RegExp(`Ambitious: \\+1 to ${ranged ? 'ranged' : 'melee'} attacks`));
    assert.equal(ancestryTalents(character)[0].tooltip, 'Humans gain an extra talent at 1st level.');
    for (const field of ['stats','hp','maxHitPoints','ancestry','name','gear','languages']) assert.deepEqual(character[field], before[field], field);
    const stable = structuredClone(character); initializeImportChoices(character, { random: () => assert.fail('must not reroll') });
    assert.deepEqual(character, stable);
    const state = { characters: [JSON.parse(JSON.stringify(character))] };
    for (let index = 0; index < 3; index++) normalizeCharacterState(state);
    assert.equal(classAttackBonus(state.characters[0], ranged), 1); assert.equal(state.characters[0].hp, 7);
  }
});

test('existing loaded characters never receive native rolls, score rebasing, or talent recovery', () => {
  const raw = hero('Priest', { bonuses: [{ sourceType: 'Class', sourceCategory: 'Talent', name: 'AttackBonus', bonusTo: 'Ranged attacks', bonusAmount: 1 }],
    levels: [{ level: 1, talentRolledName: 'Plus1ToHit', talentRolledDesc: '+1 melee or ranged attacks' }] });
  const state = { characters: extractShadowdarkCharacters(JSON.stringify(raw)) };
  for (let index = 0; index < 4; index++) normalizeCharacterState(state);
  assert.deepEqual(state.characters[0].bonuses, raw.bonuses); assert.deepEqual(state.characters[0].levels, raw.levels);
  assert.deepEqual(state.characters[0].advancements, []); assert.equal(classAttackBonus(state.characters[0], false), 0);
});

test('native wizard stat choice starts from rolledStats rather than imported talent totals', () => {
  const character = hero('Wizard', { ancestry: 'Half-Orc' }); character.stats.INT = 18; character.rolledStats.INT = 16;
  character.bonuses = [{ sourceType: 'Class', sourceCategory: 'Talent', name: 'PlusTwoIntOrPlusOneWizCasting', bonusName: 'StatBonus', bonusTo: 'INT:+2' },
    { sourceType: 'Ancestry', sourceName: 'Half-Orc', name: 'Mighty', bonusTo: 'Melee attacks', bonusAmount: 1 }];
  initializeImportChoices(character, { random: () => .2 });
  assert.equal(character.stats.INT, 16); assert.equal(character.bonuses[0].name, 'Mighty');
  resolveAdvancement(character, 'initial', 'talent', 'INT');
  assert.equal(character.stats.INT, 18); assert.equal(castingBonus(character, 'wizard'), 0);
  assert.equal(character.bonuses.filter(bonus => bonus.name === 'StatBonus').length, 1);
});

test('CON rebasing and native CON selection preserve base HP rolls, existing damage, and Dwarf Stout exactly once', () => {
  const character = hero('Fighter', { ancestry: 'Dwarf', hp: 6, maxHitPoints: 8,
    levels: [{ level: 1, HitPointRoll: 4, stoutHitPointRoll: 3 }], bonuses: [{ sourceType: 'Ancestry', sourceName: 'Dwarf', name: 'Stout', bonusTo: 'HP', bonusAmount: 2 },
      { sourceType: 'Class', sourceCategory: 'Talent', name: 'StatBonus', bonusTo: 'CON:+2' }] });
  character.stats.CON = 15; character.rolledStats.CON = 13;
  initializeImportChoices(character, { random: () => .5 });
  assert.equal(character.stats.CON, 13); assert.equal(character.maxHitPoints, 7); assert.equal(character.hp, 5);
  assert.equal(character.levels[0].HitPointRoll, 4); assert.equal(character.levels[0].stoutHitPointRoll, 3);
  resolveAdvancement(character, 'initial', 'talent', 'CON');
  assert.equal(character.stats.CON, 15); assert.equal(character.maxHitPoints, 8); assert.equal(character.hp, 6);
  const state = { characters: [character] };
  for (let index = 0; index < 4; index++) normalizeCharacterState(state);
  assert.equal(state.characters[0].maxHitPoints, 8); assert.equal(state.characters[0].hp, 6);
  assert.equal(state.characters[0].bonuses.filter(bonus => bonus.name === 'Stout').length, 1);
});

test('native human extra spell advantage has Ambition ownership and an exact chosen spell, with two base spell picks', () => {
  const character = hero('Wizard', { bonuses: [{ sourceType: 'Ambition', sourceCategory: 'Talent', name: 'AdvOnCastOneSpell', bonusTo: 'Charm Person' }] });
  initializeImportChoices(character, { random: sequence(.2,.2,.5,.5) });
  const event = character.advancements[0];
  assert.equal(event.tasks.filter(task => task.type === 'spell').length, 2);
  assert.equal(character.spellsKnown, ''); assert.ok(!character.bonuses.some(bonus => bonus.name === 'AdvOnCastOneSpell'));
  resolveAdvancement(character, 'initial', 'spell-1', 'Burning Hands', { spells });
  resolveAdvancement(character, 'initial', 'spell-2', 'Charm Person', { spells });
  resolveAdvancement(character, 'initial', 'ambition', 'Burning Hands', { spells });
  const bonus = character.bonuses.find(bonus => bonus.name === 'AdvantageOnSpellcasting');
  assert.equal(bonus.sourceType, 'Ambition'); assert.equal(bonus.bonusTo, 'Burning Hands');
  assert.equal(selectedSpellCastingAdvantage(character, 'Burning Hands'), true);
  assert.equal(selectedSpellCastingAdvantage(character, 'Charm Person'), false);
  assert.match(ancestryTalents(character)[0].text, /Ambitious: Advantage on casting Burning Hands/);
});

test('selected spell advantage is record-local and exact, never a search over the whole sheet', () => {
  const character = hero('Wizard', { bonuses: [{ sourceType: 'Class', name: 'AdvantageOnSpellcasting', bonusTo: 'Burning Hands', bonusName: 'Charm Person' }],
    levels: [{ talentRolledDesc: 'Gain advantage on casting Charm Person.' }] });
  assert.equal(selectedSpellCastingAdvantage(character, 'Burning Hands'), true);
  assert.equal(selectedSpellCastingAdvantage(character, 'Charm Person'), false); assert.equal(selectedSpellCastingAdvantage(character, 'Hands'), false);
});

test('higher-level priest attack talents retain the explicit melee/ranged choice', () => {
  const character = hero('Priest', { level: 2, XP: 20 });
  const event = beginLevelUp(character, { random: sequence(.5,.2,.2) });
  assert.equal(event.talentRoll.total, 4); assert.equal(event.tasks[0].type, 'attack-choice'); assert.ok(!event.tasks[0].done);
});

test('malformed existing Ambition remains unrecorded instead of inventing a Priest talent', () => {
  const character = hero('Priest', { bonuses: [{ sourceType: 'Ambition', name: 'Spellcasting', bonusName: 'Spellcasting', bonusTo: 'Priest', bonusAmount: 1 }] });
  const before = JSON.stringify(character), rows = ancestryTalents(character);
  assert.match(rows[0].text, /choice not recorded/); assert.doesNotMatch(rows[0].text, /\+1.*Priest/);
  assert.equal(JSON.stringify(character), before);
});

test('both human wild-stat points retain Ambition ownership and update CON HP from one baseline', () => {
  for (const sameStat of [true, false]) {
    const character = hero('Fighter', { hp: 4, maxHitPoints: 4, levels: [{ level: 1, HitPointRoll: 4 }] });
    character.stats.CON = character.rolledStats.CON = 11;
    initializeImportChoices(character, { random: sequence(.2,.2,.99,.99) });
    resolveAdvancement(character, 'initial', 'ambition', 'points');
    resolveAdvancement(character, 'initial', 'ambition', 'CON');
    assert.equal(character.maxHitPoints, 5); assert.equal(character.hp, 5);
    assert.equal(character.bonuses.at(-1).sourceType, 'Ambition');
    resolveAdvancement(character, 'initial', 'ambition', sameStat ? 'CON' : 'STR');
    assert.equal(character.bonuses.filter(bonus => bonus.name === 'StatBonus' && bonus.sourceType === 'Ambition').length, 2);
    assert.equal(character.maxHitPoints, 5); assert.equal(character.hp, 5);
    assert.match(ancestryTalents(character)[0].text, sameStat ? /\+2 to Constitution/ : /\+1 to Constitution, \+1 to Strength/);
  }
});

test('a native human thief rerolls duplicate initiative but never rerolls on save/load', () => {
  const character = hero('Thief');
  initializeImportChoices(character, { random: sequence(0,0,0,0,.2,.2) });
  assert.equal(character.advancements[0].talentRoll.total, 2);
  assert.equal(character.advancements[0].ambitionTalentRoll.total, 4);
  assert.equal(character.bonuses.filter(bonus => bonus.name === 'InitiativeAdvantage').length, 1);
  assert.equal(character.bonuses.find(bonus => bonus.name === 'BackstabIncrease').sourceType, 'Ambition');
});

test('native score rebasing retains explicit non-talent ancestry stat effects and HP minimum floors', () => {
  const character = hero('Fighter', { ancestry: 'Elf', hp: 1, maxHitPoints: 1, levels: [{ level: 1, HitPointRoll: 1 }],
    bonuses: [{ sourceType: 'Ancestry', sourceCategory: 'Ability', sourceName: 'Elf', name: 'StatBonus', bonusTo: 'STR:+2' },
      { sourceType: 'Class', sourceCategory: 'Talent', name: 'StatBonus', bonusTo: 'CON:+2' }] });
  character.stats.STR = 17; character.rolledStats.STR = 15; character.stats.CON = 5; character.rolledStats.CON = 3;
  initializeImportChoices(character, { random: () => .5 });
  assert.equal(character.stats.STR, 17); assert.equal(character.stats.CON, 3);
  assert.equal(character.hp, 1); assert.equal(character.maxHitPoints, 1);
  resolveAdvancement(character, 'initial', 'talent', 'CON');
  assert.equal(character.hp, 1); assert.equal(character.maxHitPoints, 1);
  assert.equal(character.bonuses[0].sourceType, 'Ancestry');
});

test('Dwarf HP rebasing uses the higher recorded HP die without adding Stout HP again', () => {
  const character = hero('Fighter', { ancestry: 'Dwarf', hp: 4, maxHitPoints: 4,
    levels: [{ level: 1, HitPointRoll: 2, stoutHitPointRoll: 5 }] });
  character.stats.CON = 5; character.rolledStats.CON = 3;
  initializeImportChoices(character, { random: () => .2 });
  assert.equal(character.hp, 3); assert.equal(character.maxHitPoints, 3);
  assert.equal(character.levels[0].HitPointRoll, 2); assert.equal(character.levels[0].stoutHitPointRoll, 5);
});
