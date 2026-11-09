import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { castAnimateDead, resolveAnimateDead, animateDeadPresentation, animateDeadRemains, animateDeadSlotsAvailable,
  advanceAnimatedDeadTime, cleanupAnimatedDead, isAnimatedDead, animatedDeadController, effectiveTurnOwner,
  syncAnimatedDeadState,
  ANIMATE_DEAD_DAY_MS } from '../../S3_content/src/animate-dead.js';
import { defeatMonster } from '../../S3_content/src/interactions.js';
import { archiveSlainCharacter, buildMonsterCompanion, nativeAttackLines } from '../../S3_content/src/companions.js';
import { normalizeCharacterState, setCharacterHp } from '../../S3_content/src/characters.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { createFloatingDiscs } from '../../S3_content/src/floating-disc.js';
import { createTierTwoUi } from '../../S3_content/src/tier-two-ui.js';
import { listMagicEffects, endMagicEffect } from '../../S3_content/src/magic-effect-registry.js';

const monsters = JSON.parse(readFileSync(new URL('../../S3_content/data/shadowdark-content.json', import.meta.url))).monsters;
const tableTwo = JSON.parse(readFileSync(new URL('../../S3_content/monsters-2.json', import.meta.url)));
const options = { monsters };
const checkRoll = roll => modifier => ({ roll, modifier, total: roll + modifier });
function scene() {
  const cells = Array.from({ length: 49 }, (_, i) => `${i % 7},${Math.floor(i / 7)}`);
  const caster = { id: 'guest-wizard', name: 'Wizard', hp: 20, maxHitPoints: 20, x: 3, y: 3,
    roomId: 'r', className: 'Wizard', level: 5, stats: { INT: 14 }, gear: [], raw: {} };
  return { seed: 42, level: 3, map: { width: 7, height: 7 },
    tiles: cells.map((_, i) => ({ x: i % 7, y: Math.floor(i / 7), type: 'floor', roomId: 'r' })),
    rooms: [], entities: [], characters: [caster], player: { x: 3, y: 3 }, activeCharacterId: caster.id,
    visibility: { visibleNow: new Set(cells), exploredEver: new Set(cells) }, combat: { active: false } };
}
function body(state, name = 'Bugbear', x = 4, y = 3) {
  const source = structuredClone(monsters.find(monster => monster.name === name && (monster.source || []).includes('core')) ||
    monsters.find(monster => monster.name === name));
  const corpse = { id: `body-${state.entities.length}`, type: 'treasure', subtype: 'corpse-loot',
    name: `Dead ${name}`, monsterName: name, x, y, roomId: 'r', visible: true, corpseLoot: true, collected: false };
  state.entities.push(corpse);
  return { corpse, source };
}
function cast(state, roll = 14) {
  return castAnimateDead(state, state.characters[0], { ...options, checkRoll: checkRoll(roll) });
}
function raise(state, corpse, form = 'Zombie') {
  return resolveAnimateDead(state, state.characters[0], { form, targetId: corpse.id }, options).undead;
}
function reload(state) {
  const loaded = hydrateDungeonState(JSON.parse(JSON.stringify(serializeDungeonState(state))));
  syncAnimatedDeadState(loaded);
  return loaded;
}
function slainBody(state, gear, extra = {}) {
  const source = { ...structuredClone(monsters.find(monster => monster.slug === 'bugbear')),
    id: 'fallen-bugbear', type: 'monster', x: 4, y: 3, roomId: 'r', gear, ...extra };
  state.entities.push(source);
  defeatMonster(state, source);
  return state.entities.find(entity => entity.subtype === 'corpse-loot');
}
const equipmentDrops = state => state.entities.filter(entity => entity.subtype === 'dropped-equipment' && !entity.collected);

test('actual corpse records resolve by snapshot, defeated source ID, or legacy catalog name without reading gear', () => {
  for (const provenance of ['snapshot', 'id', 'legacy']) {
    const state = scene(), { corpse, source } = body(state);
    if (provenance === 'snapshot') { corpse.corpseSource = source; corpse.monsterName = 'Unknown'; }
    if (provenance === 'id') {
      corpse.sourceMonsterId = 'slain-bugbear'; corpse.monsterName = 'Unknown';
      state.entities.push({ ...source, id: corpse.sourceMonsterId, type: 'monster', defeated: true, hp: 0 });
    }
    const gear = { id: 'separate-gear', type: 'treasure', subtype: 'dropped-equipment', name: 'Unique Mace', gearItem: { name: 'Unique Mace', magicBonus: 5 } };
    state.entities.push(gear);
    const before = structuredClone(gear);
    assert.equal(animateDeadRemains(state, state.characters[0], options).length, 1);
    cast(state); const undead = raise(state, corpse);
    assert.equal(undead.ancestry, 'Bugbear Zombie');
    assert.equal(undead.companion.animateDead.originalMonsterName, 'Bugbear');
    assert.deepEqual(gear, before);
    assert.equal(undead.gear.length, 0);
  }
});

test('defeatMonster and archiveSlainCharacter output can be animated without replacing original character stats', () => {
  const state = scene();
  const original = { ...structuredClone(monsters.find(monster => monster.slug === 'bugbear')), id: 'foe', type: 'monster', x: 4, y: 3, hp: 0 };
  state.entities.push(original);
  defeatMonster(state, original);
  const corpse = state.entities.find(entity => entity.subtype === 'corpse-loot');
  cast(state); assert.equal(raise(state, corpse).name, 'Bugbear Zombie');
  const other = scene(), character = { id: 'fallen-elf', name: 'Nim', ancestry: 'Elf', hp: 0, maxHitPoints: 60,
    stats: { STR: 18 }, dead: true, x: 4, y: 3, gear: [{ name: 'Original Sword' }] };
  other.characters.push(character);
  const archived = archiveSlainCharacter(other, character);
  cast(other); assert.equal(raise(other, archived, 'Skeleton').ancestry, 'Elf Skeleton');
  assert.equal(character.maxHitPoints, 60); assert.equal(character.gear[0].name, 'Original Sword');
});

test('naked Skeleton and canonical Shadowdark Zombie stats and talents survive normalization without creating gear', () => {
  for (const form of ['Skeleton', 'Zombie']) {
    const state = scene(), { corpse } = body(state);
    corpse.corpseSource = { name: 'Bugbear', tags: ['humanoid'], level: 20, hp: 200, ac: 25, attack: '9 claws +20 (9d12)' };
    const source = monsters.find(monster => monster.slug === form.toLowerCase());
    const expected = buildMonsterCompanion({ ...structuredClone(source), maxHp: source.hp }, { kind: 'animate-dead' });
    cast(state); const undead = raise(state, corpse, form);
    assert.equal(undead.hp, 11); assert.equal(undead.maxHitPoints, 11); assert.equal(undead.level, 2);
    assert.equal(undead.armorClass, form === 'Skeleton' ? 10 : 8);
    assert.deepEqual(undead.stats, expected.stats);
    assert.deepEqual(undead.baseAttacks, form === 'Skeleton' ? ['claw: +1, 1, close'] : nativeAttackLines(source));
    assert.deepEqual(undead.gear, []);
    assert.deepEqual(undead.companion.source.talents, source.talents);
    assert.equal(undead.companion.source.attack.includes('Hieb'), false);
    assert.equal(undead.x, corpse.x); assert.equal(undead.y, corpse.y);
    normalizeCharacterState(state);
    const saved = reload(state).characters.find(isAnimatedDead);
    assert.equal(saved.armorClass, undead.armorClass); assert.equal(saved.hp, 11);
    assert.deepEqual(saved.stats, undead.stats); assert.deepEqual(saved.baseAttacks, undead.baseAttacks);
    assert.deepEqual(saved.companion.source.talents, source.talents);
  }
});

test('raw monster-table JSON is accepted and missing normal stat blocks reject before rolling', () => {
  const state = scene(), { corpse, source } = body(state); corpse.corpseSource = source;
  const rawOptions = { monsters: tableTwo, checkRoll: checkRoll(14) };
  castAnimateDead(state, state.characters[0], rawOptions);
  const undead = resolveAnimateDead(state, state.characters[0], { form: 'zombie', targetId: corpse.id }, rawOptions).undead;
  assert.equal(undead.hp, 11); assert.equal(undead.armorClass, 8); assert.equal(undead.level, 2);
  const missing = scene(); body(missing);
  assert.throws(() => castAnimateDead(missing, missing.characters[0], { monsters: [], checkRoll: () => assert.fail('must not roll') }), /stat block/);
});

test('animation transfers only actual uncollected corpse equipment and restores original equipped flags', () => {
  let state = scene();
  const mace = { instanceId: 'one-mace', name: 'Spiked Mace', type: 'weapon', equipped: true,
    nativeMonsterWeapon: true, attackBonus: 3, damage: '1d6', slots: 1 };
  const mail = { instanceId: 'one-mail', name: 'Chainmail', type: 'armor', equipped: true, ac: 13, slots: 2 };
  const spare = { instanceId: 'spare', name: 'Dagger', type: 'weapon', equipped: false, damage: '1d4', slots: 1 };
  const collected = { instanceId: 'claimed', name: 'Shield', type: 'armor', equipped: true };
  const moved = { instanceId: 'moved', name: 'Lantern', equipped: false };
  const corpse = slainBody(state, [mace, mail, spare, collected, moved]);
  const drops = equipmentDrops(state);
  for (let i = 0; i < drops.length; i++) {
    assert.deepEqual(drops[i].corpseEquipment, { corpseId: corpse.id, equipped: [true, true, false, true, false][i] });
    assert.equal(drops[i].gearItem.equipped, false);
  }
  drops[3].collected = true;
  drops[4].x = 5;
  const unrelated = { ...structuredClone(drops[0]), id: 'unrelated-mace', corpseEquipment: { corpseId: 'other-body', equipped: true } };
  state.entities.push(unrelated);
  const claimedSnapshot = structuredClone(drops[3]), movedSnapshot = structuredClone(drops[4]), unrelatedSnapshot = structuredClone(unrelated);
  cast(state); const undead = raise(state, corpse, 'Skeleton');
  assert.deepEqual(undead.gear.map(item => item.instanceId), ['one-mace', 'one-mail', 'spare']);
  assert.deepEqual(undead.gear.map(item => item.equipped), [true, true, false]);
  assert.equal(undead.gear[0].attackBonus, undefined);
  assert.equal(undead.gear[0].nativeMonsterWeapon, undefined);
  assert.equal(undead.gear[0].damage, '1d6');
  assert.equal(undead.companion.animateDead.corpseArmorClass, 13);
  assert.deepEqual(undead.companion.animateDead.inheritedGearIds, drops.slice(0, 3).map(loot => loot.id));
  for (const loot of drops.slice(0, 3)) {
    assert.equal(loot.collected, true); assert.equal(loot.gearItem, undefined);
    assert.equal(loot.animateDeadConsumed.animatedId, undead.id);
  }
  assert.deepEqual(drops[3], claimedSnapshot); assert.deepEqual(drops[4], movedSnapshot); assert.deepEqual(unrelated, unrelatedSnapshot);
  state = reload(state);
  const saved = state.characters.find(isAnimatedDead);
  assert.deepEqual(saved.gear, saved.raw.gear);
  assert.deepEqual(saved.gear.map(item => item.equipped), [true, true, false]);
  assert.deepEqual(saved.companion.animateDead.inheritedGearIds, undead.companion.animateDead.inheritedGearIds);
});

test('no equipment is regenerated from corpse snapshots or stolen source equipment', () => {
  for (const form of ['Skeleton', 'Zombie']) {
    const state = scene(), corpse = slainBody(state, []);
    corpse.corpseSource.gear = [{ name: 'Ghost Sword', equipped: true }];
    corpse.corpseSource.carriedGear = [{ name: 'Ghost Shield', equipped: true }];
    cast(state); const undead = raise(state, corpse, form);
    assert.deepEqual(undead.gear, []);
    assert.deepEqual(undead.companion.source.gear, []);
    assert.deepEqual(undead.companion.source.carriedGear, []);
    assert.deepEqual(undead.raw.gear, []);
  }
});

test('both forms inherit gear only within STR carrying capacity and leave excess real loot on the ground', () => {
  for (const [form, capacity] of [['Skeleton', 12], ['Zombie', 14]]) {
    const state = scene();
    const full = { name: 'Iron Spikes', totalUnits: capacity * 10, quantity: capacity * 10, equipped: false };
    const corpse = slainBody(state, [full, { name: 'Chainmail', type: 'armor', ac: 13, equipped: true, slots: 2 }]);
    cast(state); const undead = raise(state, corpse, form);
    assert.equal(undead.stats.STR, capacity); assert.equal(undead.companion.gearCapacity, capacity);
    assert.deepEqual(undead.gear.map(item => item.name), ['Iron Spikes']);
    const remaining = equipmentDrops(state);
    assert.equal(remaining.length, 1); assert.equal(remaining[0].name, 'Chainmail');
    assert.equal(remaining[0].gearItem.equipped, false);
    assert.deepEqual(remaining[0].corpseEquipment, { corpseId: corpse.id, equipped: true });
    normalizeCharacterState(state);
    assert.equal(state.characters.find(isAnimatedDead).gearSlotsUsed, capacity);
  }
});

test('archived character gear preserves equipped provenance and item metadata but never copies collected gear', () => {
  let state = scene();
  const item = { id: 'original-item-id', instanceId: 'enchanted', name: 'Silver Sword', type: 'weapon', equipped: true,
    damage: '1d8', attackBonus: 2, magic: { identified: false, bonus: 2, element: 'cold', elementDice: '1d4' },
    magicSuppression: { remainingMs: 20000 }, custom: { owner: 'Nim', engraving: 'Remember' }, quantity: 1, totalUnits: 1, slots: 1 };
  const fallen = { id: 'fallen-elf', name: 'Nim', ancestry: 'Elf', hp: 0, maxHitPoints: 60, dead: true, armorClass: 17,
    x: 4, y: 3, roomId: 'r', gear: [item, { name: 'Claimed Shield', equipped: true }] };
  state.characters.push(fallen);
  const corpse = archiveSlainCharacter(state, fallen);
  const drops = equipmentDrops(state);
  drops[0].fireDamage = { scorched: true }; drops[1].collected = true;
  const original = structuredClone(item);
  cast(state); const undead = raise(state, corpse, 'Zombie');
  assert.deepEqual(undead.gear, [{ ...item, fireDamage: { scorched: true } }]);
  assert.deepEqual(item, original);
  assert.equal(undead.companion.animateDead.corpseArmorClass, 17);
  assert.equal(undead.gear[0].equipped, true);
  state = reload(state);
  assert.deepEqual(state.characters.find(isAnimatedDead).gear[0], undead.gear[0]);
  undead.gear[0].custom.owner = 'Changed';
  assert.equal(item.custom.owner, 'Nim');
});

test('legacy death drops are linked by source identity, not nearby names, and cannot be inherited twice', () => {
  for (const characterCorpse of [false, true]) {
    const state = scene();
    let corpse;
    if (characterCorpse) {
      const fallen = { id: 'fallen-elf', name: 'Nim', ancestry: 'Elf', hp: 0, x: 4, y: 3, roomId: 'r',
        gear: [{ name: 'Dagger', equipped: true }] };
      state.characters.push(fallen); corpse = archiveSlainCharacter(state, fallen);
    } else corpse = slainBody(state, [{ name: 'Spiked Mace', type: 'weapon', equipped: true, damage: '1d6' }]);
    const loot = equipmentDrops(state)[0]; delete loot.corpseEquipment;
    const duplicate = { ...structuredClone(loot), id: 'slain-gear-fallen-bugbear-other-0', corpseOwnerId: 'someone-else' };
    state.entities.push(duplicate);
    cast(state); const undead = raise(state, corpse);
    assert.equal(undead.gear.length, 1);
    assert.equal(Boolean(duplicate.collected), false);
    assert.equal(loot.collected, true); assert.equal(loot.gearItem, undefined);
    assert.throws(() => raise(state, corpse), /awaiting/);
  }
});

test('expiry and Dispel Magic drop all current gear with grave dust exactly once, preserving metadata and location', () => {
  for (const ending of ['expiry', 'dispel']) {
    let state = scene();
    const item = { instanceId: 'unique-mace', name: 'Spiked Mace', type: 'weapon', damage: '1d6', equipped: true,
      magic: { identified: true, bonus: 1 }, custom: { artwork: 'original' }, totalUnits: 1, slots: 1 };
    const corpse = slainBody(state, [item]);
    cast(state); const raised = raise(state, corpse, 'Skeleton');
    raised.gear.push({ instanceId: 'later-rope', name: 'Rope', equipped: false, quantity: 2, totalUnits: 2, slots: 1 });
    raised.raw.gear = structuredClone(raised.gear);
    state = reload(state);
    const undead = state.characters.find(isAnimatedDead);
    undead.x = 2; undead.y = 1; undead.roomId = 'next-room'; undead.routeId = 'lower';
    state.underpasses = [{ id: 'lower', artVersion: 2, lowerCells: [{ x: 2, y: 1 }], upperCrossings: [], portals: [] }];
    state.activeCharacterId = undead.id;
    const inventory = structuredClone(undead.gear);
    if (ending === 'expiry') advanceAnimatedDeadTime(state, ANIMATE_DEAD_DAY_MS);
    else {
      const effect = listMagicEffects(state).find(effect => effect.targetId === undead.id && effect.spell === 'animate dead');
      assert.ok(effect); endMagicEffect(state, effect.id);
    }
    const drops = equipmentDrops(state);
    assert.equal(drops.length, 2);
    assert.deepEqual(drops.map(loot => loot.gearItem), inventory.map(gear => ({ ...gear, equipped: false })));
    for (const loot of drops) {
      assert.equal(loot.x, 2); assert.equal(loot.y, 1); assert.equal(loot.routeId, 'lower'); assert.equal(loot.roomId, 'next-room');
      assert.equal(loot.corpseEquipment, undefined); assert.equal(loot.animateDeadSourceId, undead.id);
    }
    assert.equal(state.entities.filter(entity => entity.subtype === 'grave-dust').length, 1);
    assert.equal(state.characters.some(isAnimatedDead), false);
    assert.deepEqual(undead.gear, []); assert.deepEqual(undead.raw.gear, []);
    assert.equal(cleanupAnimatedDead(state, undead), null);
    advanceAnimatedDeadTime(state, ANIMATE_DEAD_DAY_MS);
    assert.equal(equipmentDrops(reload(state)).length, 2);
    assert.equal(state.entities.filter(entity => entity.subtype === 'grave-dust').length, 1);
  }
});

test('collapse preserves burning carried lights as stationary dropped equipment', () => {
  const state = scene();
  const corpse = slainBody(state, []);
  cast(state); const undead = raise(state, corpse, 'Skeleton');
  undead.gear.push({ name: 'Torch', slots: 1, lit: true, equipped: true },
    { name: 'Lantern', slots: 1, lit: true, equipped: false });
  const { gearDrops } = cleanupAnimatedDead(state, undead);
  assert.equal(gearDrops[0].lightSource, 'torch');
  assert.equal(gearDrops[0].lightRadius, 6);
  assert.equal(gearDrops[1].lightSource, 'lantern');
  assert.equal(gearDrops[1].lightRadius, 12);
  assert.ok(gearDrops.every(drop => drop.gearItem.lit && !drop.gearItem.equipped));
});

test('eligibility requires actual intact humanoid remains, visibility, close route and an unoccupied reachable corpse cell', () => {
  const rejected = [
    corpse => { corpse.remains = { limbsIntact: 2, headIntact: true }; },
    corpse => { corpse.remains = { limbsIntact: 4, headIntact: false }; },
    corpse => { corpse.collected = true; }, corpse => { corpse.buried = true; },
    corpse => { corpse.subtype = 'turned-ash'; }, corpse => { corpse.subtype = 'grave-dust'; },
    corpse => { corpse.animateDeadConsumed = {}; }, corpse => { corpse.monsterName = 'Zombie'; },
    corpse => { corpse.monsterName = 'Badger'; }, corpse => { corpse.x = 6; },
    (corpse, state) => { state.visibility.visibleNow.clear(); },
    (corpse, state) => { state.tiles[corpse.y * 7 + corpse.x].type = 'wall'; },
    (corpse, state) => { state.characters.push({ id: 'occupant', hp: 5, x: corpse.x, y: corpse.y }); },
    (corpse, state) => { corpse.routeId = 'lower'; state.underpasses = [{ id: 'lower', lowerCells: [{ x: 4, y: 3 }], upperCrossings: [], portals: [] }]; }
  ];
  for (const change of rejected) {
    const state = scene(), { corpse } = body(state); change(corpse, state);
    assert.equal(animateDeadRemains(state, state.characters[0], options).length, 0, String(change));
    assert.throws(() => castAnimateDead(state, state.characters[0], { ...options, checkRoll: () => assert.fail('invalid cast must not roll') }), /remains/);
  }
  const state = scene(), { corpse } = body(state, 'Elf', 4, 4);
  corpse.remains = { limbsIntact: 3, headIntact: true };
  assert.equal(animateDeadRemains(state, state.characters[0], options)[0], corpse);
});

test('initial critical offers two distinct bodies or two days; validates bodies and slots without losing the choice', () => {
  const state = scene(), first = body(state).corpse, second = body(state, 'Elf', 2, 3).corpse;
  cast(state, 20);
  assert.deepEqual(animateDeadPresentation(state, state.characters[0], options).choices.map(choice => choice.disabled), [false, false]);
  assert.throws(() => resolveAnimateDead(state, state.characters[0], { choice: 'damage' }, options), /two bodies/);
  resolveAnimateDead(state, state.characters[0], { choice: 'targets' }, options);
  const undead = raise(state, first);
  assert.equal(state.characters[0].pendingSpell.remaining, 1);
  assert.throws(() => raise(state, first), /unavailable/);
  const skeleton = raise(state, second, 'Skeleton');
  assert.equal(skeleton.name, 'Elf Skeleton'); assert.equal(undead.summon.remainingMs, ANIMATE_DEAD_DAY_MS);
  assert.equal(state.characters[0].pendingSpell, null);
  assert.equal(state.characters.length, 3);
  assert.throws(() => resolveAnimateDead(state, state.characters[0], { choice: 'duration' }, options), /awaiting/);
  for (const shortage of ['bodies', 'slots']) {
    const limited = scene(); body(limited); if (shortage === 'slots') body(limited, 'Elf', 2, 3);
    if (shortage === 'slots') while (limited.characters.length < 15) limited.characters.push({ id: `friend-${limited.characters.length}` });
    cast(limited, 20);
    assert.equal(animateDeadPresentation(limited, limited.characters[0], options).choices[0].disabled, true);
    assert.throws(() => resolveAnimateDead(limited, limited.characters[0], { choice: 'targets' }, options), /slots|bodies/);
    assert.equal(limited.characters[0].pendingSpell.phase, 'critical');
    resolveAnimateDead(limited, limited.characters[0], { choice: 'duration' }, options);
    const made = raise(limited, limited.entities[0]); assert.equal(made.summon.remainingMs, 2 * ANIMATE_DEAD_DAY_MS);
  }
});

test('form selection opens corpse targeting without options, and each critical body chooses its own form after save/load', () => {
  let state = scene();
  const first = body(state).corpse, second = body(state, 'Elf', 2, 3).corpse;
  cast(state, 20);
  resolveAnimateDead(state, state.characters[0], { choice: 'targets' }, options);
  let view = animateDeadPresentation(state, state.characters[0], options);
  assert.deepEqual(view.options, [{ key: 'skeleton', label: 'Skeleton' }, { key: 'zombie', label: 'Zombie' }]);
  resolveAnimateDead(state, state.characters[0], { form: 'skeleton' }, options);
  state = reload(state);
  view = animateDeadPresentation(state, state.characters[0], options);
  assert.equal(Object.hasOwn(view, 'options'), false);
  assert.equal(view.message, 'Pick a corpse to animate.');
  assert.deepEqual(view.targets, [{ key: first.id, label: 'Dead Bugbear' }, { key: second.id, label: 'Dead Elf' }]);
  const skeleton = resolveAnimateDead(state, state.characters[0], { targetId: first.id }, options).undead;
  assert.equal(skeleton.companion.animateDead.form, 'Skeleton');
  assert.equal(Object.hasOwn(state.characters[0].pendingSpell, 'form'), false);
  assert.equal(Object.hasOwn(state.characters[0].raw.pendingSpell, 'form'), false);
  state = reload(state);
  view = animateDeadPresentation(state, state.characters[0], options);
  assert.equal(view.options.length, 2); assert.equal(view.form, null); assert.equal(view.remaining, 1);
  assert.deepEqual(view.targets, [{ key: second.id, label: 'Dead Elf' }]);
  assert.throws(() => resolveAnimateDead(state, state.characters[0], { targetId: second.id }, options), /Choose Skeleton or Zombie/);
  resolveAnimateDead(state, state.characters[0], { form: 'zombie' }, options);
  assert.equal(Object.hasOwn(animateDeadPresentation(state, state.characters[0], options), 'options'), false);
  assert.equal(resolveAnimateDead(state, state.characters[0], { targetId: second.id }, options).undead.ancestry, 'Elf Zombie');
  assert.equal(animateDeadPresentation(state, state.characters[0], options), null);
});

test('reusable spell UI transitions from critical to form to corpse clicks and back to independent second form', async () => {
  const dom = new JSDOM('<main><div id="map"></div></main>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const state = scene(), caster = state.characters[0], first = body(state).corpse, second = body(state, 'Elf', 2, 3).corpse;
  const errors = [], submissions = [];
  cast(state, 20);
  const ui = createTierTwoUi({ getPresentation: () => animateDeadPresentation(state, caster, options),
    resolve: selection => {
      submissions.push(selection);
      return resolveAnimateDead(state, caster, { ...selection, form: selection.option || selection.form }, options);
    }, preview() {}, mapHost: document.getElementById('map'), status: message => errors.push(message) });
  const clickButton = async text => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === text);
    assert.ok(button, `Missing ${text} button`); button.click(); await Promise.resolve();
  };
  try {
    ui.sync(); assert.equal(ui.click(first.x, first.y, first.id), false);
    await clickButton('Two Bodies');
    assert.equal(ui.click(first.x, first.y, first.id), false);
    await clickButton('Skeleton');
    assert.deepEqual(submissions.at(-1), { option: 'skeleton' });
    assert.equal(document.querySelector('dialog'), null);
    assert.ok(document.querySelector('.tier-two-target-panel'));
    assert.equal(ui.click(first.x, first.y, first.id), true); await Promise.resolve();
    assert.ok(document.querySelector('dialog'));
    assert.equal(ui.click(second.x, second.y, second.id), false);
    await clickButton('Zombie');
    assert.equal(document.querySelector('dialog'), null);
    await clickButton('Dead Elf');
    assert.deepEqual(submissions.at(-1), { targetId: second.id });
    assert.equal(document.querySelector('.tier-two-target-panel'), null);
    assert.deepEqual(state.characters.filter(isAnimatedDead).map(actor => actor.ancestry), ['Bugbear Skeleton', 'Elf Zombie']);
    assert.deepEqual(errors, []);
  } finally { ui.close(); globalThis.document = previous; dom.window.close(); }
});

test('canonical animate-dead lifecycle identity survives HP restoration and saves; an expired revive reference cannot rejoin the party', () => {
  let state = scene(); const { corpse } = body(state); cast(state); const raised = raise(state, corpse);
  setCharacterHp(raised, 0);
  assert.equal(isAnimatedDead(raised), true); assert.equal(raised.companion.kind, 'animate-dead');
  state = reload(state);
  const saved = state.characters.find(actor => actor.id === raised.id);
  assert.equal(isAnimatedDead(saved), true); assert.equal(saved.raw.companion.kind, 'animate-dead');
  const remainingMs = saved.companion.animateDead.remainingMs;
  setCharacterHp(saved, 1);
  assert.equal(isAnimatedDead(saved), true);
  assert.equal(saved.companion.animateDead.remainingMs, remainingMs);
  assert.equal(saved.summon.kind, 'animate-dead');
  advanceAnimatedDeadTime(state, remainingMs);
  const dustCount = state.entities.filter(entity => entity.subtype === 'grave-dust').length;
  setCharacterHp(saved, 1); syncAnimatedDeadState(state);
  assert.equal(state.characters.some(actor => actor.id === saved.id), false);
  assert.equal(reload(state).characters.some(isAnimatedDead), false);
  assert.equal(state.entities.filter(entity => entity.subtype === 'grave-dust').length, dustCount);
});

test('party capacity and bodies revalidate at resolution, pending spell mirrors and tombstones survive save/load', () => {
  let state = scene(), { corpse } = body(state);
  cast(state, 20); state = reload(state);
  let caster = state.characters[0]; assert.deepEqual(caster.pendingSpell, caster.raw.pendingSpell);
  resolveAnimateDead(state, caster, { choice: 'duration' }, options);
  resolveAnimateDead(state, caster, { form: 'skeleton' }, options);
  state = reload(state); caster = state.characters[0];
  assert.equal(animateDeadPresentation(state, caster, options).form, 'Skeleton');
  while (state.characters.length < 16) state.characters.push({ id: `friend-${state.characters.length}` });
  assert.throws(() => resolveAnimateDead(state, caster, { targetId: corpse.id }, options), /slot/);
  state.characters.pop();
  const made = resolveAnimateDead(state, caster, { targetId: corpse.id }, options).undead;
  assert.equal(made.ancestry, 'Bugbear Skeleton');
  state = reload(state);
  const saved = state.characters.find(isAnimatedDead);
  assert.deepEqual(saved.companion, saved.raw.companion);
  assert.deepEqual(saved.summon, saved.raw.summon);
  assert.equal(state.entities.find(entity => entity.id === corpse.id).animateDeadConsumed.animatedId, made.id);
  assert.equal(animateDeadRemains(state, state.characters[0], options).length, 0);
  const full = scene(); body(full); while (full.characters.length < 16) full.characters.push({ id: `friend-${full.characters.length}` });
  assert.throws(() => cast(full), /slot/);
  const reserved = scene(); body(reserved);
  while (reserved.characters.length < 15) reserved.characters.push({ id: `friend-${reserved.characters.length}` });
  reserved.characters[1].pendingSpell = { spell: 'floating disc', phase: 'critical' };
  assert.equal(animateDeadSlotsAvailable(reserved), 0); assert.throws(() => cast(reserved), /slot/);
});

test('casting is DC13 INT, honors recovery/pending guards, and dismissal cannot reroll a resolved casting', () => {
  const state = scene(); body(state);
  const failed = cast(state, 10);
  assert.equal(failed.succeeded, false); assert.equal(failed.check.total, 12);
  assert.deepEqual(state.characters[0].failedSpellKeys, ['animate dead']);
  assert.deepEqual(state.characters[0].raw.failedSpellKeys, ['animate dead']);
  assert.throws(() => cast(state), /recovery/);
  const fresh = scene(); body(fresh); const result = cast(fresh);
  assert.equal(result.succeeded, true); assert.equal(result.check.modifier, 2);
  assert.throws(() => cast(fresh), /pending/);
  resolveAnimateDead(fresh, fresh.characters[0], { dismiss: true }, options);
  assert.equal(fresh.characters[0].raw.pendingSpell, null);
  assert.throws(() => resolveAnimateDead(fresh, fresh.characters[0], { choice: 'duration' }, options), /awaiting/);
});

test('natural one uses tier-three mishaps even with a high total; locks, tier bans and Silence reject before rolling', () => {
  const state = scene(); body(state);
  const failed = castAnimateDead(state, state.characters[0], { ...options,
    checkRoll: () => ({ roll: 1, modifier: 98, total: 99 }), random: () => (9 - .5) / 12 });
  assert.equal(failed.succeeded, false); assert.equal(failed.critical, false);
  assert.equal(failed.mishaps[0].roll, 9); assert.match(failed.message, /Mishap 9/);
  assert.ok(state.characters[0].wizardEffects.some(effect => effect.type === 'spell-tier-ban' && effect.tier === 3));
  assert.equal(state.characters[0].pendingSpell, undefined);
  for (const setup of [
    caster => { caster.spellLocks = { 'animate dead': { remainingMs: 100 } }; },
    caster => { caster.wizardEffects = [{ type: 'spell-tier-ban', tier: 3, untilRest: true }]; }
  ]) {
    const locked = scene(); body(locked); setup(locked.characters[0]);
    assert.throws(() => cast(locked), /recovery/);
  }
  const silent = scene(); body(silent);
  silent.characters[0].focusSpell = { spell: 'silence', areaId: 'silent' };
  silent.areaSpells = [{ id: 'silent', spell: 'silence', casterId: 'guest-wizard', x: 2, y: 2, width: 3, height: 3, routeId: '' }];
  assert.throws(() => cast(silent), /impossible/);
});

test('two-day critical survives the first day and expires at exactly 48 game hours after a save', () => {
  let state = scene(); const { corpse } = body(state); cast(state, 20);
  resolveAnimateDead(state, state.characters[0], { choice: 'duration' }, options);
  raise(state, corpse);
  assert.equal(advanceAnimatedDeadTime(state, ANIMATE_DEAD_DAY_MS).length, 0);
  state = reload(state);
  assert.equal(state.characters.find(isAnimatedDead).summon.remainingMs, ANIMATE_DEAD_DAY_MS);
  assert.equal(advanceAnimatedDeadTime(state, ANIMATE_DEAD_DAY_MS - 1).length, 0);
  assert.equal(advanceAnimatedDeadTime(state, 1).length, 1);
});

test('expiry uses game time, survives save/load and leaves only non-loot grave dust exactly once', () => {
  let state = scene(); const { corpse } = body(state); cast(state); const made = raise(state, corpse);
  state.activeCharacterId = made.id;
  const treasures = state.entities.filter(entity => entity.type === 'treasure').length;
  advanceAnimatedDeadTime(state, 8 * 60 * 60 * 1000);
  state = reload(state);
  const saved = state.characters.find(isAnimatedDead);
  assert.equal(saved.summon.remainingMs, 16 * 60 * 60 * 1000);
  assert.equal(saved.raw.companion.animateDead.remainingMs, saved.summon.remainingMs);
  // The spell is not Focus and does not end early merely because the caster dies.
  state.characters[0].dead = true;
  assert.equal(advanceAnimatedDeadTime(state, 16 * 60 * 60 * 1000 - 1).length, 0);
  const expired = advanceAnimatedDeadTime(state, 1);
  assert.equal(expired.length, 1); assert.equal(expired[0].undead.id, made.id);
  assert.equal(expired[0].dust.type, 'feature'); assert.equal(expired[0].dust.subtype, 'grave-dust');
  assert.equal(expired[0].dust.corpseLoot, undefined); assert.equal(expired[0].dust.defeated, undefined);
  assert.equal(state.entities.filter(entity => entity.type === 'treasure').length, treasures);
  assert.equal(state.characters.some(isAnimatedDead), false); assert.equal(state.activeCharacterId, 'guest-wizard');
  assert.equal(advanceAnimatedDeadTime(state, ANIMATE_DEAD_DAY_MS).length, 0);
  assert.equal(cleanupAnimatedDead(state, made), null);
  assert.equal(reload(state).entities.filter(entity => entity.subtype === 'grave-dust').length, 1);
  assert.equal(animateDeadRemains(state, state.characters[0], options).length, 0);
  assert.throws(() => advanceAnimatedDeadTime(state, Infinity), /game-time/);
  assert.throws(() => advanceAnimatedDeadTime(state, -1), /game-time/);
});

test('ownership follows caster ID, not host, using backend ownership dictionary; Floating Disc uses the same caster', () => {
  let state = scene(); const { corpse } = body(state); cast(state); const made = raise(state, corpse);
  const [disc] = createFloatingDiscs(state, state.characters[0]);
  const ownership = { 'guest-wizard': 'guest-member', host: 'host-member' };
  const owner = animatedDeadController(state, made);
  assert.equal(owner.id, 'guest-wizard'); assert.equal(ownership[owner.id], 'guest-member');
  assert.equal(made.companion.controllerCharacterId, owner.id); assert.equal(made.summon.casterId, owner.id);
  assert.equal(disc.summon.casterId, owner.id); assert.equal(ownership[disc.summon.casterId], 'guest-member');
  assert.equal(effectiveTurnOwner(state, disc), owner); assert.equal(effectiveTurnOwner(state, made), made);
  assert.equal(Object.hasOwn(made, 'ownerPlayerId'), false);
  state = reload(state); const saved = state.characters.find(isAnimatedDead);
  assert.equal(animatedDeadController(state, saved), state.characters[0]);
  state.characters.shift(); assert.equal(animatedDeadController(state, saved), null);
});

test('expiry leaves initiative and combat resources to the parent turn lifecycle', () => {
  const state = scene(), { corpse } = body(state); cast(state); const undead = raise(state, corpse);
  state.combat = { active: true, round: 1, turnIndex: 0, turnOrder: [{ type: 'character', id: 'guest-wizard' }],
    actionUsed: true, movementRemaining: 2, movementBudget: 6 };
  state.activeCharacterId = undead.id;
  advanceAnimatedDeadTime(state, ANIMATE_DEAD_DAY_MS);
  assert.equal(state.combat.actionUsed, true); assert.equal(state.combat.movementRemaining, 2);
  assert.equal(state.activeCharacterId, 'guest-wizard');
  assert.deepEqual(state.combat.turnOrder, [{ type: 'character', id: 'guest-wizard' }]);
});
