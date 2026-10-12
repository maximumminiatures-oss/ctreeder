import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateDungeon, generateClassicDungeon } from '../../S3_content/src/generator.js';
import { addCryptHallways, CRYPT_RULES, isUndeadMonster } from '../../S3_content/src/crypts.js';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { canMoveBetweenTiles } from '../../S3_content/src/interactions.js';
import { hasLineOfSightFrom } from '../../S3_content/src/visibility.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { maybeSpawnWanderingMonster } from '../../S3_content/src/wandering.js';

const readData = name => JSON.parse(readFileSync(new URL(`../../S3_content/${name}`, import.meta.url)));
const organicAssets = readData('data/organic-assets.json');
const trapTable = readData('traps.json');
const monsterTable = readData('monsters-2.json');
const options = { cryptHallways: true, monsterTable, trapTable, organicAssets };
const openingDelta = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

test('crypt creatures require an explicit undead tag, not a name or similar tag', () => {
  assert.equal(isUndeadMonster({ name: 'Skeleton', tags: ['humanoid'] }), false);
  assert.equal(isUndeadMonster({ tags: ['not-undead'] }), false);
  assert.equal(isUndeadMonster({ tags: 'undead' }), false);
  assert.equal(isUndeadMonster({ tags: [' UnDead '] }), true);
  assert.ok(monsterTable.some(isUndeadMonster));
});

test('the crypt roll is deterministic and approximately twenty percent', () => {
  let enabled = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const first = createEmptyDungeonState(seed);
    const second = createEmptyDungeonState(seed);
    const result = addCryptHallways(first);
    assert.equal(result.enabled, addCryptHallways(second).enabled);
    if (result.enabled) enabled++;
  }
  assert.ok(enabled >= 170 && enabled <= 230, `enabled ${enabled}/1000`);
  const state = generateDungeon(1, 2, { cryptHallways: false });
  const geometry = JSON.stringify({ tiles: state.tiles, rooms: state.rooms, halls: state.halls, entities: state.entities, decor: state.decor });
  addCryptHallways(state, { cryptHallways: false });
  assert.equal(JSON.stringify({ tiles: state.tiles, rooms: state.rooms, halls: state.halls, entities: state.entities, decor: state.decor }), geometry);
});

test('crypt chambers include their threshold and use two or three cells according to the artwork', () => {
  let cryptHalls = 0, allHalls = 0, deadEnds = 0;
  const rotations = new Set();
  for (const architecturePattern of ['processional', 'organic', 'maze', 'angled', 'waterLogged']) {
    for (let seed = 1; seed <= 15; seed++) {
      const state = generateDungeon(seed, 2, { ...options, architecturePattern });
      assert.equal(state.generation.connectivityValid, true, `${architecturePattern} seed ${seed}`);
      const info = state.generation.crypts;
      assert.ok(info.roomIds.length > 0, `${architecturePattern} seed ${seed}`);
      cryptHalls += info.hallwayIds.length; allHalls += info.totalHallways; deadEnds += info.deadEndHallwayIds.length;
      for (const hall of state.halls.filter(hall => hall.crypt)) {
        assert.equal(hall.cryptRoomIds.length, hall.deadEnd ? 3 : 2);
        const doors = hall.cryptRoomIds.map(id => state.entities.find(entity => entity.crypt && entity.roomId === id));
        assert.equal(Math.abs(doors[0].x - doors[1].x) + Math.abs(doors[0].y - doors[1].y), 2);
        const middle = getTile(state, (doors[0].x + doors[1].x) / 2, (doors[0].y + doors[1].y) / 2);
        assert.equal(middle.hallId, hall.id);
        assert.equal(doors[0].x === doors[1].x || doors[0].y === doors[1].y, true);
        const terminal = state.rooms.find(room => room.id === hall.cryptRoomIds.at(-1));
        assert.equal(terminal.terminalCrypt, Boolean(hall.deadEnd));
      }
      for (const room of state.rooms.filter(room => room.crypt)) {
        const tiles = state.tiles.filter(tile => tile.roomId === room.id);
        const length=['crypt 7','crypt 8'].includes(room.cryptAsset)?3:2;
        assert.equal(tiles.length, length); assert.equal(room.width * room.height, length);
        assert.ok(tiles.every(tile => tile.type === 'floor' && tile.meta.crypt));
        const placement = state.decor.crypts.find(item => item.roomId === room.id);
        rotations.add(placement.rotationTurns);
        const doors = state.entities.filter(entity => entity.subtype === 'door' && entity.roomId === room.id);
        assert.equal(doors.length, 1);
        const door = doors[0], [dx, dy] = openingDelta[room.opening];
        assert.equal(getTile(state, door.x, door.y).roomId, room.id);
        assert.equal(getTile(state, door.x - dx, door.y - dy).roomId, room.id);
        assert.ok(['closed', 'locked'].includes(door.doorState));
        assert.equal(door.orientation, dx ? 'vertical' : 'horizontal');
        for (const tile of tiles) for (const [nx, ny] of Object.values(openingDelta)) {
          const neighbor = getTile(state, tile.x + nx, tile.y + ny);
          if (neighbor.roomId === room.id || (neighbor.x === door.x && neighbor.y === door.y)) continue;
          if(tile.x===door.x&&tile.y===door.y&&nx===dx&&ny===dy)continue;
          assert.equal(neighbor.type, 'wall'); assert.equal(neighbor.meta.cryptWall, true);
        }
        assert.equal(state.decor.junk.some(item => item.x < room.x + room.width && item.x + item.widthTiles > room.x &&
          item.y < room.y + room.height && item.y + item.heightTiles > room.y), false);
      }
    }
  }
  assert.deepEqual([...rotations].sort(), [0, 1, 2, 3]);
  assert.ok(cryptHalls / allHalls > .43 && cryptHalls / allHalls < .57);
  assert.ok(deadEnds / cryptHalls > .43 && deadEnds / cryptHalls < .57);
});

test('crypt content permits treasure and floor traps but only undead monsters and rare door traps', () => {
  let monsters = 0, treasure = 0, floorTraps = 0, doorTraps = 0, doors = 0;
  for (let seed = 1; seed <= 75; seed++) {
    const state = generateDungeon(seed, 2, options);
    const cryptIds = new Set(state.generation.crypts.roomIds);
    doors += state.entities.filter(entity => entity.crypt && entity.subtype === 'door').length;
    for (const entity of state.entities.filter(entity => cryptIds.has(entity.roomId))) {
      if (entity.type === 'monster') { assert.equal(isUndeadMonster(entity), true); monsters++; }
      if (entity.type === 'treasure') treasure++;
      if (entity.type === 'trap') {
        if (entity.targetType === 'door') doorTraps++;
        else if (entity.targetType === 'tile') floorTraps++;
      }
    }
    assert.equal(state.generation.bossRooms.some(id => cryptIds.has(id)), false);
  }
  assert.ok(monsters > 50); assert.ok(treasure > 50); assert.ok(floorTraps > 50);
  assert.ok(doorTraps > 0 && doorTraps / doors < .05, `${doorTraps}/${doors} doors trapped`);
  assert.equal(CRYPT_RULES.doorTrapChance, .02);
  const emptyLevel = generateDungeon(2, 1, { ...options, monsterTable: readData('monsters-1.json') });
  const cryptIds = new Set(emptyLevel.generation.crypts.roomIds);
  assert.equal(emptyLevel.entities.some(entity => entity.type === 'monster' && cryptIds.has(entity.roomId)), false);
});

test('closed crypt doors block movement and light; opening them admits both', () => {
  const state = generateDungeon(2, 2, options);
  const room = state.rooms.find(room => room.crypt);
  const door = state.entities.find(entity => entity.crypt && entity.roomId === room.id);
  const [dx, dy] = openingDelta[room.opening];
  const outside = { x: door.x + dx, y: door.y + dy }, inside = { x: door.x - dx, y: door.y - dy };
  assert.equal(canMoveBetweenTiles(state, outside.x, outside.y, door.x, door.y).ok, false);
  assert.equal(hasLineOfSightFrom(state, outside.x, outside.y, inside.x, inside.y), false);
  door.doorState = 'open';
  assert.equal(canMoveBetweenTiles(state, outside.x, outside.y, door.x, door.y).ok, true);
  assert.equal(canMoveBetweenTiles(state, door.x, door.y, inside.x, inside.y).ok, true);
  assert.equal(hasLineOfSightFrom(state, outside.x, outside.y, inside.x, inside.y), true);
});

test('saved crypts retain rooms, artwork, content and doors; classic maps support crypts', () => {
  const state = generateDungeon(2, 2, options);
  const restored = hydrateDungeonState(serializeDungeonState(state));
  assert.deepEqual(restored.rooms, state.rooms);
  assert.deepEqual(restored.halls, state.halls);
  assert.deepEqual(restored.decor.crypts, state.decor.crypts);
  assert.deepEqual(restored.entities, state.entities);
  assert.deepEqual(restored.generation.crypts, state.generation.crypts);
  const classic = generateClassicDungeon(2, 2, options);
  assert.equal(classic.generation.connectivityValid, true);
  assert.ok(classic.decor.crypts.length > 0);
});

test('wandering crypt encounters never fall back to an untagged generic creature', () => {
  const create = () => {
    const state = createEmptyDungeonState(7, 2);
    state.rooms = [{ id: 'crypt', crypt: true }];
    Object.assign(getTile(state, 4, 0), { type: 'floor', roomId: 'crypt' });
    state.player = { x: 0, y: 0, torchLit: true, lightRadius: 5 };
    state.visibility.visibleNow = new Set(['4,0']);
    state.wanderingMonsters = { numerator: 1, denominator: 1, spawnedCount: 0 };
    return state;
  };
  for (const table of [[], [{ name: 'Goblin', tags: ['humanoid'] }], [{ tags: ['undead'] }]]) {
    const state = create();
    assert.equal(maybeSpawnWanderingMonster(state, table).spawned, false);
    assert.equal(state.entities.length, 0);
  }
  const state = create();
  const result = maybeSpawnWanderingMonster(state, [{ name: 'Skeleton', tags: ['undead'], ac: 12 }]);
  assert.equal(result.spawned, true); assert.equal(result.entity.name, 'Skeleton');
  assert.equal(result.entity.ac, 12); assert.equal(isUndeadMonster(result.entity), true);
});

test('crypt additions do not change reviewed room and hall artwork', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const base = { ...options, architecturePattern: 'waterLogged' };
    const before = generateDungeon(seed, 2, { ...base, cryptHallways: false });
    const after = generateDungeon(seed, 2, base);
    assert.deepEqual(after.decor.reviewed, before.decor.reviewed);
    assert.deepEqual(after.decor.reviewedMovement, before.decor.reviewedMovement);
    assert.deepEqual(after.decor.reviewedLight, before.decor.reviewedLight);
    assert.deepEqual(after.decor.wells, before.decor.wells);
  }
});
