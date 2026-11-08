import test from 'node:test';
import assert from 'node:assert/strict';
import { findStealTarget, validStealTarget, stealableGear, selectStealTarget, takeStolenItem } from '../../S3_content/src/thievery.js';
import { canTargetAtRange } from '../../S3_content/src/targeting.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';

function scene({ lit = true } = {}) {
  const thief = { id: 'thief', name: 'Thief', x: 2, y: 2, hp: 10, gear: [], lightRadius: lit ? 12 : 0 };
  const ally = { id: 'ally', name: 'Ally', x: 3, y: 2, hp: 10, stats: { WIS: 12 }, gear: [{ name: 'Dagger', type: 'weapon' }] };
  const monster = { id: 'monster', type: 'monster', name: 'Pirate', x: 2, y: 3, hp: 4, W: 1,
    attack: '1 dagger +7 (1d4+4)', gear: [{ name: 'Dagger', type: 'weapon' }] };
  const state = { map: { width: 7, height: 7 },
    tiles: Array.from({ length: 49 }, (_, i) => ({ x: i % 7, y: Math.floor(i / 7), type: 'floor' })),
    rooms: [], underpasses: [], entities: [monster], characters: [thief, ally],
    player: { x: 2, y: 2, torchLit: false },
    visibility: { visibleNow: new Set(), exploredEver: new Set(), visitedRoomIds: new Set() } };
  recomputeVisibility(state);
  return { state, thief, ally, monster };
}

function ready(thief, total = 20) {
  thief.pendingSteal = { phase: 'targeting', check: { total } };
}

test('lookup returns live party characters and monsters, never other entities', () => {
  const { state, ally, monster } = scene();
  state.entities.push({ id: 'loot', type: 'treasure' });
  assert.equal(findStealTarget(state, ally.id), ally);
  assert.equal(findStealTarget(state, monster.id), monster);
  assert.equal(findStealTarget(state, 'loot'), null);
  assert.equal(findStealTarget(state, 'missing'), null);
  assert.equal(findStealTarget({}, undefined), null);
});

test('adjacent party can be targeted in darkness and concealment, but monsters retain direct targeting', () => {
  const { state, thief, ally, monster } = scene({ lit: false });
  ally.stealthed = true; ally.invisible = true;
  assert.equal(canTargetAtRange(state, thief, ally, 1, { directAttack: true }), false);
  assert.equal(validStealTarget(state, thief, ally), true);
  assert.equal(validStealTarget(state, thief, monster), false);
  ready(thief);
  selectStealTarget(state, thief, ally);
  assert.equal(takeStolenItem(state, thief, 0).monster, ally);

  const lit = scene();
  assert.equal(validStealTarget(lit.state, lit.thief, lit.monster), true);
  lit.monster.stealthState = { attempted: true, revealed: false };
  assert.equal(validStealTarget(lit.state, lit.thief, lit.monster), false);
});

test('self, non-party characters, non-monsters, discs, illusions and dead targets are rejected', () => {
  const { state, thief, ally, monster } = scene();
  assert.equal(validStealTarget(state, thief, thief), false);
  assert.equal(validStealTarget(state, thief, { ...thief }), false);
  assert.equal(validStealTarget(state, thief, { ...ally, id: 'outsider' }), false);
  assert.equal(validStealTarget(state, thief, null), false);
  const loot = { id: 'loot', type: 'treasure', x: 3, y: 2, hp: 10 };
  state.entities.push(loot);
  assert.equal(validStealTarget(state, thief, loot), false);
  for (const source of [ally, monster]) {
    for (const flags of [{ dead: true }, { slain: true }, { defeated: true }, { hp: 0 },
      { hp: -1 }, { summon: { kind: 'floating-disc' } }, { illusion: { kind: 'creature' } }]) {
      const target = { ...source, ...flags };
      const collection = source === ally ? state.characters : state.entities;
      collection.push(target);
      assert.equal(validStealTarget(state, thief, target), false, JSON.stringify(flags));
      collection.pop();
    }
  }
});

test('one-square reach includes diagonals but still requires line of sight and the same route', () => {
  const { state, thief, ally, monster } = scene();
  for (const target of [ally, monster]) {
    Object.assign(target, { x: 3, y: 3 });
    assert.equal(validStealTarget(state, thief, target), true);
    target.x = 4;
    assert.equal(validStealTarget(state, thief, target), false);
    Object.assign(target, { x: 3, y: 2 });
  }
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 2, y: 2,
    doorState: 'closed', orientation: 'vertical', wallSide: 'west' });
  assert.equal(validStealTarget(state, thief, ally), false);
  state.entities.pop();
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 3, y: 2 }],
    upperCrossings: [{ x: 3, y: 2 }], portals: [] }];
  ally.routeId = 'lower';
  assert.equal(validStealTarget(state, thief, ally), false);
  monster.routeId = 'lower';
  assert.equal(validStealTarget(state, thief, monster), false);
});

test('selection needs a completed DC 15 check and uses party WIS scores or monster WIS modifiers', () => {
  const { state, thief, ally, monster } = scene();
  for (const pending of [undefined, { phase: 'targeting' }, { check: { total: 14 } }, { check: { total: NaN } }]) {
    thief.pendingSteal = pending;
    assert.throws(() => selectStealTarget(state, thief, ally), /adjacent creature/);
  }
  ally.stats.WIS = 20; ally.W = 50;
  ready(thief, 15);
  assert.match(selectStealTarget(state, thief, ally).message, /Choose one item/);
  assert.equal(thief.pendingSteal.phase, 'gear');
  assert.equal(thief.pendingSteal.targetId, ally.id);
  monster.W = 6; monster.stats = { WIS: 1 };
  ready(thief, 15);
  assert.match(selectStealTarget(state, thief, monster).message, /15 vs DC 16/);
  assert.equal(thief.pendingSteal, null);
});

test('character gear is not inferred or normalized; equipped armor and bound daggers are excluded', () => {
  const { ally } = scene();
  ally.attack = '1 sword +8 (1d8+5)'; ally.ac = '15 (leather armor)';
  delete ally.gear;
  assert.deepEqual(stealableGear(ally), []);
  assert.equal(ally.gear, undefined);
  ally.companion = { kind: 'doppelganger' };
  ally.gear = [{ name: 'Dagger', bound: true, equipped: true },
    { name: 'Leather Armor', equipped: true }, { name: 'Shield', type: 'armor', equipped: true },
    { name: 'Chainmail', equipped: false }, { name: 'Dagger', equipped: true, attackBonus: 2 }];
  const before = structuredClone(ally.gear);
  assert.deepEqual(stealableGear(ally).map(entry => entry.index), [3, 4]);
  assert.deepEqual(ally.gear, before);
});

test('taking party gear removes raw mirrors and preserves real enchantments and the existing monster return field', () => {
  const { state, thief, ally } = scene();
  const magic = { name: 'Dagger +2', instanceId: 'enchanted', type: 'weapon', equipped: true,
    attackBonus: 2, damage: '1d4+2', magic: { kind: 'weapon', bonus: 2 }, enchantments: ['Keen'] };
  ally.gear = [magic, { name: 'Rope', slots: 1 }];
  ally.raw = { gear: structuredClone(ally.gear) };
  ready(thief);
  selectStealTarget(state, thief, ally);
  const result = takeStolenItem(state, thief, 0);
  assert.equal(result.monster, ally);
  assert.deepEqual(result.item, { ...magic, equipped: false });
  assert.equal(result.item.attackBonus, 2);
  assert.deepEqual(ally.gear, [{ name: 'Rope', slots: 1 }]);
  assert.deepEqual(ally.raw.gear, ally.gear);
  assert.equal(ally.stolenGearNames, undefined);
  assert.equal(thief.pendingSteal, null);
  assert.deepEqual(JSON.parse(JSON.stringify(ally)).raw.gear, ally.gear);
});

test('native monster gear loses stat-block bonuses even on a companion; real magic gear retains bonuses', () => {
  for (const party of [false, true]) {
    const { state, thief, ally, monster } = scene();
    const source = party ? ally : monster;
    source.gear = [{ name: 'Dagger', type: 'weapon', equipped: true, nativeMonsterWeapon: true,
      attackBonus: 7, damage: '1d4+4' }];
    if (party) source.companion = { kind: 'friendly' };
    source.raw = { gear: structuredClone(source.gear) };
    ready(thief); selectStealTarget(state, thief, source);
    const { item } = takeStolenItem(state, thief, 0);
    assert.equal(item.attackBonus, undefined);
    assert.equal(item.nativeMonsterWeapon, undefined);
    assert.equal(item.damage, '1d4');
    assert.deepEqual(source.gear, []);
    assert.deepEqual(source.raw.gear, []);
    if (!party) assert.deepEqual(source.carriedGear, []);
    assert.deepEqual(stealableGear(source), []);
  }
  const { state, thief, monster } = scene();
  monster.gear[0].attackBonus = 2; monster.gear[0].magic = { bonus: 2 };
  ready(thief); selectStealTarget(state, thief, monster);
  assert.equal(takeStolenItem(state, thief, 0).item.attackBonus, 2);
});

test('explicit empty monster inventories stay empty before and after save/load', () => {
  const { state, thief, monster } = scene();
  monster.gear = []; monster.carriedGear = [];
  for (const source of [monster, JSON.parse(JSON.stringify(monster))]) {
    state.entities = [source]; ready(thief);
    assert.match(selectStealTarget(state, thief, source).message, /no gear/);
    assert.equal(thief.pendingSteal, null);
    assert.deepEqual(source.gear, []);
  }
});

test('taking revalidates live target membership, reach, life and item eligibility', () => {
  for (const change of [({ ally }) => { ally.x = 5; }, ({ ally }) => { ally.dead = true; },
    ({ state }) => { state.characters.pop(); }]) {
    const context = scene();
    ready(context.thief); selectStealTarget(context.state, context.thief, context.ally);
    change(context);
    assert.throws(() => takeStolenItem(context.state, context.thief, 0), /no longer within reach/);
    assert.equal(context.ally.gear.length, 1);
  }
  const { state, thief, ally } = scene();
  ready(thief); selectStealTarget(state, thief, ally);
  const replacement = structuredClone(ally);
  state.characters[1] = replacement;
  assert.equal(takeStolenItem(state, thief, 0).monster, replacement);
  assert.equal(ally.gear.length, 1);
  assert.deepEqual(replacement.gear, []);
  replacement.gear = [{ name: 'Dagger', bound: true }];
  thief.pendingSteal = { targetId: ally.id, phase: 'gear', check: { total: 20 } };
  assert.throws(() => takeStolenItem(state, thief, 0), /cannot be stolen/);
});
