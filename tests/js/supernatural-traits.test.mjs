import test from 'node:test';
import assert from 'node:assert/strict';
import { setCharacterHp } from '../../S3_content/src/characters.js';
import { recordLycanthropeDamage, progressLycanthropyAfterRest, hostileLycanthrope } from '../../S3_content/src/supernatural-traits.js';
import { removeAffliction } from '../../S3_content/src/creature-afflictions.js';
import { seedLeprechaunGold, expireLeprechaunGold, leprechaunTreasure } from '../../S3_content/src/leprechaun.js';

test('lycanthropy records a single source, transforms on rest, rejoins when healed, and restores the original character', () => {
  const actor = { id: 'hero', ancestry: 'Elf', alignment: 'Lawful', stats: { STR: 10, CON: 10 }, hp: 8, maxHitPoints: 8 };
  const wolf = { id: 'wolf', name: 'Werewolf', type: 'monster' };
  const state = { characters: [actor], entities: [] };
  assert.equal(recordLycanthropeDamage(actor, wolf, 6), false);
  assert.equal(recordLycanthropeDamage(actor, { ...wolf, id: 'fresh' }, 6), false);
  assert.equal(recordLycanthropeDamage(actor, wolf, 6, () => .999), true);
  assert.deepEqual(progressLycanthropyAfterRest(state, ['hero']), [actor]);
  assert.equal(actor.ancestry, 'Werewolf Elf');
  assert.equal(actor.stats.STR, 16);
  assert.equal(actor.alignment, 'Chaotic');
  setCharacterHp(actor, 0);
  assert.equal(hostileLycanthrope(actor), true);
  setCharacterHp(actor, 1);
  assert.equal(hostileLycanthrope(actor), false);
  removeAffliction(state, actor, 'lycanthropy');
  assert.deepEqual(actor.stats, { STR: 10, CON: 10 });
  assert.equal(actor.ancestry, 'Elf');
  assert.equal(actor.alignment, 'Lawful');
});

test('false gold expires independently of genuine leprechaun treasure', () => {
  const state = { characters: [], entities: [], arcaneTime: { elapsedMs: 0 } };
  const actor = { id: 'npc', type: 'monster', name: 'Leprechaun', x: 0, y: 0 };
  seedLeprechaunGold(state, actor, gearItem => state.entities.push({ gearItem }), () => 0);
  const fake = state.entities[0];
  assert.equal(fake.gearItem.value, 400);
  assert.equal(expireLeprechaunGold(state), false);
  state.arcaneTime.elapsedMs = 3600000;
  assert.equal(expireLeprechaunGold(state), true);
  assert.equal(fake.gearItem.name, 'Dead Bird');
  assert.equal(fake.gearItem.value, 0);
  assert.equal(leprechaunTreasure(state, actor).coinBreakdown.gold, 100);
});

test('Blood Drain permanently reduces Constitution and raises an eligible humanoid with their new stat block', async () => {
  const { applyBloodDrain, vampireKind, vampireBite, suppressesVampireSpellcasting } = await import('../../S3_content/src/supernatural-traits.js');
  const attacker = { name: 'Vampire', type: 'monster', hp: 10, maxHp: 52 };
  const hero = { name: 'Arda', ancestry: 'Elf', className: 'Wizard', level: 5, hp: 7, maxHitPoints: 13, alignment: 'Lawful',
    stats: { STR: 12, DEX: 12, CON: 1, INT: 16, WIS: 12, CHA: 10 }, spellsKnown: 'Light',
    bonuses: [{ name: 'Stat', bonusTo: 'DEX: +2' }, { name: 'Spellcasting', bonusTo: 'Wizard casting' }] };
  const result = applyBloodDrain(attacker, hero, { random: () => 0 });
  assert.equal(result.rose, 'vampire spawn');
  assert.equal(attacker.hp, 12);
  assert.equal(hero.ancestry, 'Elf Vampire Spawn');
  assert.deepEqual(hero.stats, { STR: 16, DEX: 16, CON: 16, INT: 8, WIS: 12, CHA: 14 });
  assert.equal(hero.hp, 20);
  assert.equal(hero.alignment, 'Chaotic');
  assert.equal(hero.ancestryChoices.farsight, 'ranged');
  assert.equal(suppressesVampireSpellcasting(hero), true);
  assert.equal(vampireBite(hero), 'Bite: +4, 1d8, close');
  const stronger = { ...hero, conditions: {}, ancestry: 'Human', level: 6, maxHitPoints: 57,
    stats: { STR: 9, DEX: 10, CON: 1, INT: 18, WIS: 13, CHA: 12 } };
  applyBloodDrain(attacker, stronger, { random: () => 0 });
  assert.equal(vampireKind(stronger), 'vampire');
  assert.equal(stronger.ancestry, 'Vampire');
  assert.equal(stronger.hp, 57);
  assert.equal(stronger.stats.INT, 18);
  assert.equal(stronger.stats.WIS, 13);
});

test('vampire recovery locks coffinless rest damage, supports Torpor, and recovers in a room with a coffin', async () => {
  const { recoverVampireAtRest, vampireInTorpor, hostileVampire, coffinGear } = await import('../../S3_content/src/supernatural-traits.js');
  const actor = { hp: 20, maxHitPoints: 20, gear: [], conditions: { vampirism: { kind: 'vampire spawn', lockedHp: 0 } } };
  const state = { characters: [actor], entities: [] };
  recoverVampireAtRest(state, actor, 'crypt', () => .99);
  assert.equal(actor.hp, 8);
  assert.equal(hostileVampire(actor), true);
  setCharacterHp(actor, 20);
  assert.equal(actor.hp, 8);
  recoverVampireAtRest(state, actor, 'crypt', () => .99);
  assert.equal(vampireInTorpor(actor), true);
  setCharacterHp(actor, 1);
  assert.equal(actor.hp, 0);
  state.entities.push({ roomId: 'crypt', gearItem: coffinGear() });
  assert.equal(recoverVampireAtRest(state, actor, 'crypt'), 'coffin');
  assert.equal(actor.hp, 20);
  assert.equal(vampireInTorpor(actor), false);
  assert.equal(hostileVampire(actor), false);
});

test('supernatural damage restrictions distinguish mundane weapons, silver and innate creature attacks', async () => {
  const { supernaturalAttackCanDamage } = await import('../../S3_content/src/supernatural-traits.js');
  const vampire = { name: 'Vampire', type: 'monster' };
  const human = { name: 'Bandit', tags: ['humanoid'] };
  assert.equal(supernaturalAttackCanDamage(vampire, human), false);
  assert.equal(supernaturalAttackCanDamage(vampire, human, { silver: true }), true);
  assert.equal(supernaturalAttackCanDamage(vampire, { tags: ['fey'] }), true);
  assert.equal(supernaturalAttackCanDamage(vampire, { tags: ['undead'], level: 4 }), false);
  assert.equal(supernaturalAttackCanDamage(vampire, { tags: ['undead'], level: 5 }), true);
});

test('vampires ignore undead afflictions and poisons while lycanthropes can receive them', async () => {
  const { inflictMonsterCondition, applyMonsterStrikeEffect } = await import('../../S3_content/src/monster-abilities.js');
  const ghost = { id: 'ghost', name: 'Ghost', tags: ['undead'] };
  const spider = { id: 'spider', name: 'Giant Spider', tags: ['animal'] };
  const vampire = { name: 'Hero', stats: { CON: 16 }, conditions: { vampirism: { kind: 'vampire' } } };
  const lycanthrope = { name: 'Hero', conditions: { lycanthropy: { kind: 'werewolf', transformed: true } } };
  assert.equal(inflictMonsterCondition(vampire, 'possess', ghost), false);
  assert.equal(inflictMonsterCondition(vampire, 'poison', spider), false);
  applyMonsterStrikeEffect({}, ghost, vampire, { name: 'life drain' });
  assert.equal(vampire.stats.CON, 16);
  assert.equal(inflictMonsterCondition(lycanthrope, 'possess', ghost), true);
  assert.equal(inflictMonsterCondition(lycanthrope, 'toxin', spider), true);
});
