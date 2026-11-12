import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { placeDungeonDownstairs } from '../../S3_content/src/generator.js';
import { buildNextLevelState, buildPreviousLevelState, downstairsIn, dungeonAscentStatus,
  snapshotDungeonFloor, restoreDungeonFloor, stairsAtMapPoint } from '../../S3_content/src/dungeon-descent.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { checkFloorArrivalEncounters, maybeSpawnWanderingMonster } from '../../S3_content/src/wandering.js';
import { trimDisposableRemains, livingFloorMonsters } from '../../S3_content/src/floor-limits.js';

function floor(seed = 1, level = 1) {
  const state = createEmptyDungeonState(seed, level);
  state.rooms = [{ id: 'start' }, { id: 'end' }];
  state.generation.entranceRoomId = 'start';
  for (let y = 2; y <= 7; y++) for (let x = 2; x <= 20; x++) Object.assign(getTile(state, x, y),
    { type: 'floor', roomId: x < 8 ? 'start' : x > 14 ? 'end' : null, hallId: x >= 8 && x <= 14 ? 'hall' : null });
  state.entities = [{ id: 'up', type: 'feature', subtype: 'door', doorKind: 'stairs-up', x: 3, y: 3, roomId: 'start', doorState: 'open' }];
  state.player.x = 4; state.player.y = 4; state.player.roomId = 'start';
  placeDungeonDownstairs(state);
  return state;
}
function gather(state, direction = 'down') {
  const stairs = direction === 'up' ? state.entities.find(entity => entity.doorKind === 'stairs-up') : downstairsIn(state);
  const cells = state.tiles.filter(tile => tile.type === 'floor' && tile.roomId === stairs.roomId && (tile.x !== stairs.x || tile.y !== stairs.y));
  state.characters.forEach((member, index) => Object.assign(member, cells[index], { routeId: '' }));
  return state;
}
function party(state) {
  state.characters = [{ id: 'hero', name: 'Tester', stats: { STR: 12 }, className: 'Fighter', level: 1,
    hp: 5, maxHitPoints: 8, gear: [{ name: 'Torch', lit: true }], lightSource: 'torch', lightRadius: 6 }];
  state.activeCharacterId = 'hero';
  return gather(state);
}

test('floor snapshots preserve exact tile metadata and fog without recursive party or floor copies', () => {
  const state = party(floor());
  getTile(state, 5, 4).meta = { reviewed: { asset: 'test', lightSegments: [[0, 0, 1, 1]] } };
  state.visibility.exploredEver.add('5,4');
  state.visibility.exploredInnerWallInteriors = new Set(['4,4']);
  state.visibility.routeExplored = { '': new Set(['5,4']) };
  state.visibility.closedDoorExploredSides.set('door-1', new Set(['top']));
  state.dungeonFloors = { 9: { mustNotRecur: true } };
  const raw = snapshotDungeonFloor(state), loaded = restoreDungeonFloor(JSON.parse(JSON.stringify(raw)));
  assert.equal(raw.characters, undefined); assert.equal(raw.dungeonFloors, undefined);
  assert.ok(raw.tileRuns.length < state.tiles.length / 2);
  assert.deepEqual(loaded.tiles, state.tiles);
  assert.ok(loaded.visibility.exploredEver.has('5,4'));
  assert.ok(loaded.visibility.routeExplored[''].has('5,4'));
  assert.ok(loaded.visibility.exploredInnerWallInteriors.has('4,4'));
  assert.ok(loaded.visibility.closedDoorExploredSides.get('door-1').has('top'));
});

test('ascending and descending restore seeds, loot, monsters, traps, secrets and changed party clocks after save/load', () => {
  const first = party(floor(42));
  first.entities.push({ id: 'dead', type: 'monster', name: 'Pirate', hp: 0, defeated: true },
    { id: 'loot', type: 'treasure', collected: true, name: 'Sword' },
    { id: 'trap', type: 'trap', x: 11, y: 4, revealed: true, triggered: true },
    { id: 'secret', type: 'feature', subtype: 'door', revealed: true, doorState: 'open', doorKind: 'secret', x: 12, y: 4 });
  first.visibility.exploredEver.add('17,3'); first.timers.torchElapsedMs = 12000;
  let second = buildNextLevelState(first, { seed: 99, generate: floor });
  second.entities.push({ id: 'dropped', type: 'treasure', name: 'Rope', x: 6, y: 6 });
  second.visibility.exploredEver.add('6,6'); second.characters[0].hp = 3;
  second.characters[0].gear.push({ name: 'Dagger' }); second.timers.torchElapsedMs = 28000;
  second = hydrateDungeonState(serializeDungeonState(second));
  const up = buildPreviousLevelState(gather(second, 'up'));
  assert.equal(up.seed, 42); assert.equal(up.level, 1);
  assert.equal(up.characters[0].hp, 3); assert.equal(up.characters[0].gear.at(-1).name, 'Dagger');
  assert.equal(up.timers.torchElapsedMs, 28000); assert.ok(up.visibility.exploredEver.has('17,3'));
  assert.ok(up.entities.find(entity => entity.id === 'dead').defeated);
  assert.ok(up.entities.find(entity => entity.id === 'loot').collected);
  assert.ok(up.entities.find(entity => entity.id === 'trap').triggered);
  assert.equal(up.entities.find(entity => entity.id === 'secret').doorState, 'open');
  assert.ok(up.characters.every(member => member.roomId === downstairsIn(up).roomId));
  const again = buildNextLevelState(gather(up), { generate: () => { throw new Error('Must not regenerate a visited floor.'); } });
  assert.equal(again.seed, 99); assert.ok(again.entities.some(entity => entity.id === 'dropped'));
  assert.ok(again.visibility.exploredEver.has('6,6')); assert.equal(again.dungeonFloors[2], undefined);
  assert.equal(dungeonAscentStatus(first).reason, 'first-level');
});

test('arrival checks every room, respects crypt eligibility and never exceeds forty living monsters', () => {
  const state = party(floor());
  state.floorTransitions = 1; state.wanderingMonsters = { numerator: 100, denominator: 1, spawnedCount: 0 };
  const monsters = [{ name: 'Pirate', hp: 4, ac: 11, attack: '1 dagger +1 (1d4)' }];
  assert.equal(checkFloorArrivalEncounters(state, monsters).length, 2);
  for (let n = 0; n < 30; n++) { state.floorTransitions++; checkFloorArrivalEncounters(state, monsters); }
  assert.equal(livingFloorMonsters(state).length, 40);
  assert.equal(maybeSpawnWanderingMonster(state, monsters, { forceEncounter: true, ignoreDarkness: true }).spawned, false);
});

test('feature trimming removes oldest disposable remains, never treasure, dropped equipment, doors or traps', () => {
  const state = floor();
  state.entities = Array.from({ length: 205 }, (_, index) => ({ id: `corpse-${index}`, type: 'feature', subtype: 'corpse-loot' }));
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door' }, { id: 'gear', type: 'treasure', subtype: 'dropped-equipment' },
    { id: 'trap', type: 'trap' }, { id: 'ash', type: 'treasure', name: 'Ash Pile', value: .01 });
  assert.equal(trimDisposableRemains(state), 6);
  assert.equal(state.entities.filter(entity => entity.type === 'feature').length, 200);
  for (const id of ['door', 'gear', 'trap', 'ash', 'corpse-204']) assert.ok(state.entities.some(entity => entity.id === id));
});

test('ordinary corpse tokens count toward the remains cap even when represented as collectible zero-value treasure', () => {
  const state = floor();
  state.entities = Array.from({ length: 220 }, (_, index) => ({ id: `remains-${index}`, type: 'treasure', subtype: 'corpse-loot', value: 0 }));
  state.entities.push({ id: 'loot', type: 'treasure', subtype: 'monster-loot', value: 50 });
  assert.equal(trimDisposableRemains(state), 20);
  assert.equal(state.entities.length, 201); assert.ok(state.entities.some(entity => entity.id === 'loot'));
});

test('a run begun above level one can visit an unvisited upper floor, arriving at its downstairs', () => {
  const state = gather(party(floor(88, 4)), 'up');
  const next = buildPreviousLevelState(state, { seed: 77, generate: floor });
  assert.equal(next.level, 3); assert.equal(next.seed, 77);
  assert.equal(next.characters[0].roomId, downstairsIn(next).roomId);
  const back = buildNextLevelState(next, { generate: () => { throw new Error('Must restore floor four.'); } });
  assert.equal(back.seed, 88); assert.equal(back.level, 4);
});

test('large reviewed stair artwork is clickable throughout its rotated footprint, not only at the token spawn', () => {
  const state = floor(); const stairs = state.entities[0]; stairs.hiddenStairSprite = true;
  state.decor.reviewed = [{ assetKey: '3x3stairs-black', x: 2, y: 2, gridWidthTiles: 3, gridHeightTiles: 4, rotationTurns: 1, roomId: 'start' }];
  assert.equal(stairsAtMapPoint(state, 5, 4), stairs);
  assert.equal(stairsAtMapPoint(state, 6, 4), null);
  assert.equal(stairsAtMapPoint(state, 3, 3), stairs);
});

test('ordinary boundary stairs can be clicked on their visible room-side sprite in all directions', () => {
  for (const [wallSide, dx, dy] of [['north', 0, 1], ['south', 0, -1], ['east', -1, 0], ['west', 1, 0]]) {
    const stair = { id: 'up', doorKind: 'stairs-up', x: 10, y: 10, wallSide, hallDirection: wallSide,
      orientation: ['north', 'south'].includes(wallSide) ? 'horizontal' : 'vertical' };
    const state = { entities: [stair], decor: {} };
    assert.equal(stairsAtMapPoint(state, 10 + dx, 10 + dy), stair);
    assert.equal(stairsAtMapPoint(state, 10, 10), stair);
    assert.equal(stairsAtMapPoint(state, 10 - dx, 10 - dy), null);
  }
});

test('floor restore rejects invalid axes even if their product resembles a valid tile count', () => {
  for (const [width, height] of [[-5, -5], [.5, 50], [257, 1], [5, 0], ['5', 5]]) {
    assert.throws(() => restoreDungeonFloor({ map: { width, height }, tileRuns: [[25, { type: 'floor' }]] }), /invalid/);
  }
});
