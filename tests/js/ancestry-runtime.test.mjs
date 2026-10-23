import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)), { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene({ ancestry = 'Half-Orc', weapon = 'Dagger', distance = 1, bonuses = [], ancestryChoices = {} } = {}) {
  return {
    seed: 123, level: 1, map: { width: 10, height: 8 }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: 80 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width: 10, height: 8 }],
    visibility: { exploredEver: Array.from({ length: 80 }, (_, i) => `${i % 10},${Math.floor(i / 10)}`) },
    entities: [{ id: 'stairs', type: 'stairs', subtype: 'up', x: 2, y: 3, roomId: 'room' },
      { id: 'lamp', type: 'feature', subtype: 'dropped-equipment', name: 'Magic lamp', lightSource: 'magic', lightRadius: 12, x: 2, y: 4, roomId: 'room', visible: true },
      { id: 'foe', type: 'monster', name: 'Target', hp: 100, maxHp: 100, ac: 1, x: 2 + distance, y: 3,
        roomId: 'room', hostile: false, attitude: 'neutral', attitudeChecked: true, visible: true, attack: '1 claw +0 (1d4)' }],
    characters: [{ id: 'hero', name: 'Hero', ancestry, ancestryChoices, className: 'Fighter', level: 1,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 14, WIS: 18, CHA: 10 }, hp: 50, maxHitPoints: 50, x: 2, y: 3,
      roomId: 'room', lightSpellLit: true, equipmentInitialized: true, armorEquipmentInitialized: true,
      bonuses, levels: [], attacks: weapon ? [`${weapon}: +7, 1d20+7`] : [],
      gear: weapon ? [{ name: weapon, type: 'weapon', totalUnits: 1, equipped: true },
        ...(weapon.includes('bow') ? [{ name: weapon === 'Crossbow' ? 'Crossbow bolts' : 'Arrows', totalUnits: 20, type: 'sundry' }] : [])] : [] }],
    player: { x: 2, y: 3, roomId: 'room', torchLit: false }, activeCharacterId: 'hero', combat: { active: false }
  };
}
async function fixedRandom(fn) {
  const previous = Math.random;
  Math.random = () => .5;
  try { return await fn(); } finally { Math.random = previous; }
}
async function attack(input, { empty = false, beforeAttack } = {}) {
  let result = await fixedRandom(() => executeGameCommand(input, { type: 'normalize' }));
  const first = structuredClone(result.state_json.characters[0].attacks);
  for (let i = 0; i < 3; i++) result = await fixedRandom(() => executeGameCommand(result.state_json, { type: 'normalize' }));
  assert.deepEqual(result.state_json.characters[0].attacks, first, 'normalizing must not accumulate ancestry or imported attack bonuses');
  if (beforeAttack) beforeAttack(result.state_json.characters[0]);
  const foe = result.state_json.entities.find(entity => entity.id === 'foe');
  result = await fixedRandom(() => executeGameCommand(result.state_json, { type: empty ? 'attack_empty' : 'attack',
    character_id: 'hero', monster_id: empty ? undefined : 'foe', x: foe.x, y: foe.y, attack_index: 0 }));
  const entry = result.state_json.rollHistory.find(entry => entry.type === 'Attack' || /attacks|backstabs/.test(entry.detail || '')) || result.state_json.rollHistory[0];
  assert.ok(Array.isArray(entry?.segments), `Expected attack roll history: ${result.message}`);
  const toHit = Number(entry.segments.find(part => part.bold && Array.isArray(part.tooltip))?.text);
  return { result, toHit, damage: 100 - result.state_json.entities.find(entity => entity.id === 'foe').hp, entry };
}

test('authoritative Half-Orc melee synthesis ignores imported aggregate attacks and applies Mighty once with class bonuses', async () => {
  const bonuses = [{ sourceType: 'Ancestry', sourceName: 'Half-Orc', name: 'Mighty', bonusName: 'Plus1ToHit', bonusTo: 'Melee attacks', bonusAmount: 1 },
    { sourceType: 'Class', sourceName: 'Fighter', name: 'Plus1ToHit', bonusTo: 'Melee and ranged attacks', bonusAmount: 1 }];
  const outcome = await attack(scene({ weapon: 'Shortsword', bonuses }));
  assert.equal(outcome.toHit, 13, '11 roll +1 class +1 Mighty');
  assert.equal(outcome.damage, 5, '1d6 (4) +1 Mighty, without copying the imported +7');
  assert.deepEqual(outcome.result.state_json.characters[0].bonuses, bonuses);
});

test('authoritative Half-Orc unarmed attacks and guessed empty-square attacks retain Mighty hit and flat damage', async () => {
  const outcome = await attack(scene({ weapon: null }));
  assert.equal(outcome.toHit, 12);
  assert.equal(outcome.damage, 2);
  const emptyState = scene({ weapon: null });
  emptyState.entities = emptyState.entities.filter(entity => entity.id !== 'foe');
  emptyState.entities.push({ id: 'foe', type: 'monster', hp: 100, ac: 1, name: 'Target', x: 8, y: 7, roomId: 'room', hostile: false, attitude: 'neutral', attitudeChecked: true });
  let normalized = await fixedRandom(() => executeGameCommand(emptyState, { type: 'normalize' }));
  const missed = await fixedRandom(() => executeGameCommand(normalized.state_json, { type: 'attack_empty', character_id: 'hero', x: 3, y: 3, attack_index: 0 }));
  assert.match(missed.state_json.rollHistory[0].detail, /12 misses/);
});

test('dagger and spear use Mighty in melee but not when thrown, including attacks at guessed dark squares', async () => {
  for (const [weapon, dieDamage] of [['Dagger', 3], ['Spear', 4]]) {
    const melee = await attack(scene({ weapon, distance: 1 }));
    assert.equal(melee.toHit, 12, `${weapon} melee to hit`);
    assert.equal(melee.damage, dieDamage + 1, `${weapon} melee damage`);
    const thrown = await attack(scene({ weapon, distance: 4 }));
    assert.equal(thrown.toHit, 11, `${weapon} thrown to hit`);
    assert.equal(thrown.damage, dieDamage, `${weapon} thrown damage`);
    const guessed = await attack(scene({ weapon, distance: 4 }), { empty: true });
    assert.equal(guessed.toHit, 11, `${weapon} guessed target uses the same ranged mode`);
    assert.equal(guessed.damage, dieDamage);
  }
});

test('Elf ranged Farsight stacks with class attacks once and applies only to ranged use of thrown weapons', async () => {
  const bonuses = [{ sourceType: 'Ancestry', sourceName: 'Elf', name: 'AttackBonus', bonusName: 'AttackBonus', bonusTo: 'RangedWeapons', bonusAmount: 1 },
    { sourceType: 'Class', sourceName: 'Fighter', name: 'Plus1ToHit', bonusTo: 'Melee and ranged attacks', bonusAmount: 1 }];
  const bow = await attack(scene({ ancestry: 'Elf', weapon: 'Shortbow', distance: 4, bonuses }));
  assert.equal(bow.toHit, 13);
  assert.equal(bow.damage, 3);
  const melee = await attack(scene({ ancestry: 'Elf', weapon: 'Spear', distance: 1, bonuses }));
  assert.equal(melee.toHit, 12);
  const thrown = await attack(scene({ ancestry: 'Elf', weapon: 'Spear', distance: 4, bonuses }));
  assert.equal(thrown.toHit, 13);
  assert.equal(thrown.damage, 4);
});

test('Elf casting Farsight stacks with class casting once across repeated normalization and the actual spell command', async () => {
  const input = scene({ ancestry: 'Elf' }), caster = input.characters[0];
  caster.className = 'Wizard'; caster.spellsKnown = 'Mage Armor';
  const bonus = { sourceType: 'Ancestry', sourceName: 'Elf', name: 'FarSight', bonusName: 'Plus1ToCastingSpells', bonusTo: 'Spellcasting', bonusAmount: 1 };
  caster.bonuses = [bonus, structuredClone(bonus), { sourceType: 'Class', sourceName: 'Wizard', name: 'WizardSpellcasting', bonusName: 'Spellcasting', bonusTo: 'wizard spellcasting checks', bonusAmount: 1 }];
  let result = await fixedRandom(() => executeGameCommand(input, { type: 'normalize' }));
  result = await fixedRandom(() => executeGameCommand(result.state_json, { type: 'normalize' }));
  result = await fixedRandom(() => executeGameCommand(result.state_json, { type: 'spell', character_id: 'hero', spell_name: 'Mage Armor' }));
  assert.match(result.state_json.rollHistory[0].detail, /15 vs DC 11/);
  assert.equal(result.state_json.characters[0].armorClass, 14);
});
