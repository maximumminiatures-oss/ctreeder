import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateDungeon, generateClassicDungeon, dungeonEntrancePoint, dungeonTraversalDistances,
  isDungeonTraversalCell, isSafeDungeonArrival } from '../../S3_content/src/generator.js';
import { canMoveBetweenTiles } from '../../S3_content/src/interactions.js';
import { routeStep, routeOf, routeKey, pitTraversalNeighbors } from '../../S3_content/src/underpasses.js';
import { livingFloorMonsters, MAX_FLOOR_MONSTERS } from '../../S3_content/src/floor-limits.js';
import { getTile } from '../../S3_content/src/state-schema.js';
import { getOrganicTileData } from '../../S3_content/src/organic-tiles.js';
import { hasRangedMonsterAttack } from '../../S3_content/src/reviewed-layouts.js';

const data = name => JSON.parse(readFileSync(new URL(`../../S3_content/${name}`, import.meta.url)));
const organicAssets = data('data/organic-assets.json');
const monsterTable = data('monsters-2.json');
const trapTable = data('traps.json');
const steps = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const patterns = ['processional', 'cross', 'hub', 'symmetricWings', 'chain', 'web', 'symmetry',
  'almostSymmetry', 'fortress', 'forked', 'boring', 'almostBoring', 'maze', 'gallery',
  'waterLogged', 'angled', 'organic', 'organicHybrid', 'innerWalls'];

// Doors can be opened and pits deliberately climbed; neither permits crossing a wall.
function actualMovementDistances(state, start = dungeonEntrancePoint(state)) {
  const first = { x: start.x, y: start.y, routeId: routeOf(state, start) };
  const distances = new Map([[routeKey(first), 0]]), queue = [first];
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i], neighbors = [];
    for (const [dx, dy] of steps) {
      const to = routeStep(state, from, { x: from.x + dx, y: from.y + dy });
      if (!to || distances.has(routeKey(to)) || !isDungeonTraversalCell(state, to)) continue;
      if (canMoveBetweenTiles(state, from.x, from.y, to.x, to.y,
        { routeId: from.routeId, creature: from, ignoreClosedDoors: true }).ok) neighbors.push(to);
    }
    for (const to of pitTraversalNeighbors(state, from)) {
      if (!isDungeonTraversalCell(state, to)) continue;
      const upper = from.routeId ? to : from;
      if (canMoveBetweenTiles(state, from.x, from.y, to.x, to.y,
        { routeId: upper.routeId, creature: upper, ignoreClosedDoors: true, ignoreUnderpasses: true, ignorePits: true }).ok) neighbors.push(to);
    }
    for (const to of neighbors) if (!distances.has(routeKey(to))) {
      distances.set(routeKey(to), distances.get(routeKey(from)) + 1); queue.push(to);
    }
  }
  return distances;
}

function verifyFloor(state, label) {
  const actual = actualMovementDistances(state), generated = dungeonTraversalDistances(state);
  assert.deepEqual([...generated].sort(), [...actual].sort(), `${label}: generation agrees with canMove`);
  const player = { ...state.player, routeId: routeOf(state, state.player) };
  assert.ok(actual.has(routeKey(player)), `${label}: spawn connects to upstairs`);
  const roomDistances = new Map();
  for (const tile of state.tiles) {
    const point = { x: tile.x, y: tile.y, routeId: '' };
    if (!isDungeonTraversalCell(state, point)) continue;
    assert.ok(actual.has(routeKey(point)), `${label}: unreachable floor ${routeKey(point)}`);
    if (tile.roomId) roomDistances.set(tile.roomId, Math.min(roomDistances.get(tile.roomId) ?? Infinity, actual.get(routeKey(point))));
  }
  for (const route of state.underpasses || []) for (const cell of route.lowerCells)
    assert.ok(actual.has(routeKey({ ...cell, routeId: route.id })), `${label}: lower route ${route.id}`);
  assert.equal(roomDistances.size, state.rooms.length, `${label}: every room reachable`);
  assert.equal(state.generation.connectivityValid, true, label);
  const stairs = state.entities.filter(entity => entity.doorKind === 'stairs-down');
  assert.equal(stairs.length, state.level < 10 ? 1 : 0, `${label}: downstairs guaranteed until ten`);
  if (stairs.length) {
    assert.ok(actual.has(routeKey(stairs[0])), `${label}: downstairs reachable`);
    roomDistances.delete(state.generation.entranceRoomId);
    const required = state.generation.downstairs.minArrivalCapacity;
    const capacities = new Map();
    for (const tile of state.tiles) {
      const point = { x: tile.x, y: tile.y, routeId: '' };
      if (!actual.has(routeKey(point)) || !tile.roomId) continue;
      if (routeKey(point) === routeKey(stairs[0]) || isSafeDungeonArrival(state, point, { ignoreOccupants: true }))
        capacities.set(tile.roomId, (capacities.get(tile.roomId) || 0) + 1);
    }
    const eligible = [...roomDistances].filter(([roomId]) => capacities.get(roomId) > required);
    assert.equal(roomDistances.get(stairs[0].roomId), Math.max(...eligible.map(([, distance]) => distance)), `${label}: farthest viable room`);
    const safe = state.tiles.filter(tile => tile.roomId === stairs[0].roomId && isSafeDungeonArrival(state, tile));
    assert.equal(state.generation.downstairs.arrivalCapacity, safe.length, `${label}: capacity excludes stairs and occupants`);
    assert.ok(safe.length >= required, `${label}: full party fits without using the stair cell`);
    assert.ok(state.tiles.some(tile => tile.roomId === stairs[0].roomId &&
      (tile.x === stairs[0].x && tile.y === stairs[0].y || isSafeDungeonArrival(state, tile, { ignoreOccupants: true }))), label);
  }
  assert.ok(livingFloorMonsters(state).length <= MAX_FLOOR_MONSTERS, `${label}: initial monster cap`);
}

const seeds = [7, 12, 28, 72, 95028, 205894, 435545, 564643, 791900, 902766];
for (const [patternIndex, architecturePattern] of patterns.entries()) test(`${architecturePattern}: complete physical floors, farthest stairs and capped monsters`, () => {
  for (let index = 0; index < 4; index++) {
    const seed = seeds[(patternIndex * 3 + index) % seeds.length], level = (patternIndex * 4 + index) % 10 + 1;
    const state = generateDungeon(seed, level, { architecturePattern, organicAssets, monsterTable });
    verifyFloor(state, `${architecturePattern}/${seed}/level-${level}`);
  }
});

test('known disconnected and flooded destinations retry deterministically, never returning missing downstairs', () => {
  for (const [architecturePattern, seed] of [['processional', 12], ['web', 28], ['innerWalls', 28]]) {
    const state = generateDungeon(seed, 3, { architecturePattern, organicAssets, monsterTable });
    verifyFloor(state, `retry/${architecturePattern}/${seed}`);
    assert.ok((state.generation.connectivityRetry?.attempt ?? 0) < 12);
    const repeated = generateDungeon(seed, 3, { architecturePattern, organicAssets, monsterTable });
    assert.deepEqual(repeated.generation.connectivityRetry, state.generation.connectivityRetry);
    assert.deepEqual(repeated.generation.downstairs, state.generation.downstairs);
  }
});

test('generation partySize reserves safe cells beyond the stair cell and defaults unknown parties to sixteen', () => {
  for (const partySize of [1, 4, 8, 16]) {
    const state = generateDungeon(7, 2, { partySize, organicAssets, monsterTable, trapTable });
    verifyFloor(state, `party-size/${partySize}`);
    assert.equal(state.generation.downstairs.minArrivalCapacity, partySize);
    assert.ok(state.generation.downstairs.arrivalCapacity >= partySize);
  }
  const unknown = generateDungeon(7, 2, { organicAssets, monsterTable, trapTable });
  assert.equal(unknown.generation.downstairs.minArrivalCapacity, 16);
  assert.ok(unknown.generation.downstairs.arrivalCapacity >= 16);
});

test('crypt pit-trap safety preserves reviewed artwork and reachable floors without changing the seed', () => {
  for (const seed of [4, 9]) {
    const options = { architecturePattern: 'waterLogged', organicAssets, monsterTable, trapTable };
    const before = generateDungeon(seed, 2, { ...options, cryptHallways: false });
    const after = generateDungeon(seed, 2, { ...options, cryptHallways: true });
    assert.equal(before.seed, seed);
    assert.equal(after.seed, seed);
    assert.equal(after.generation.connectivityRetry, undefined);
    for (const property of ['reviewed', 'reviewedMovement', 'reviewedLight', 'wells'])
      assert.deepEqual(after.decor[property], before.decor[property], `${seed}: preserve ${property}`);
    verifyFloor(before, `crypt-disabled/${seed}`);
    verifyFloor(after, `crypt-enabled/${seed}`);
  }
});

test('intentional isolated canal banks and ranged sentries survive full-floor validation without retries', () => {
  for (const seed of [23757, 205894]) {
    const state = generateDungeon(seed, 2, { architecturePattern: 'processional', organicAssets,
      monsterTable, cryptHallways: false });
    const room = state.rooms.find(room => room.reviewedTemplate === 'divided-canal-room');
    assert.ok(room, `${seed}: retain authored divided canal room`);
    assert.ok(room.isolatedBankKeys.length > 0);
    assert.equal(state.generation.connectivityRetry, undefined);
    const distances = dungeonTraversalDistances(state);
    for (const key of room.isolatedBankKeys) {
      const [x, y] = key.split(',').map(Number), tile = getTile(state, x, y);
      assert.equal(tile.meta.encounterOnly, true, `${seed}: intentional encounter-only bank`);
      assert.equal(isDungeonTraversalCell(state, { x, y, routeId: '' }), false);
      assert.equal(distances.has(`|${key}`), false);
    }
    const sentries = state.entities.filter(entity => entity.type === 'monster' && entity.roomId === room.id &&
      room.isolatedBankKeys.includes(`${entity.x},${entity.y}`));
    assert.ok(sentries.length > 0, `${seed}: retain far-bank sentry`);
    assert.ok(sentries.every(entity => entity.canalSentry && hasRangedMonsterAttack(entity)));
    assert.equal(state.generation.bossRooms.includes(room.id), false);
    verifyFloor(state, `isolated-bank/${seed}`);
  }
});

test('reviewed 3x3 stair entrances grow from their real port or safely regenerate without opening corners', () => {
  let reviewed = 0;
  for (const seed of [95028, 102947, 205894, 435545, 564643, 776062, 791900]) {
    const state = generateDungeon(seed, 1, { architecturePattern: 'processional', organicAssets });
    verifyFloor(state, `stairs-entrance/${seed}`);
    if (state.rooms[0].reviewedTemplate === 'hall-stair-entrance') {
      reviewed++;
      assert.ok(state.halls.some(hall => hall.fromRoomId === state.rooms[0].id));
      assert.ok(state.entities.some(entity => entity.doorKind === 'stairs-up' && entity.hiddenStairSprite));
    } else assert.ok(state.generation.connectivityRetry);
  }
  assert.ok(reviewed > 0, 'retain valid reviewed stair art');
});

test('classic generation and reviewed-disabled fallback are validated after pits and lower routes', () => {
  for (const seed of [7, 12, 28, 564643]) for (const level of [1, 9, 10]) {
    verifyFloor(generateClassicDungeon(seed, level, { monsterTable }), `classic/${seed}/${level}`);
    verifyFloor(generateDungeon(seed, level, { architecturePattern: 'angled', organicAssets,
      monsterTable, reviewedLayouts: false }), `unreviewed/${seed}/${level}`);
  }
});

test('generated hallway mouths retain flat room jambs, including deterministic retries', () => {
  const corners = { north: ['nw', 'ne'], east: ['ne', 'se'], south: ['se', 'sw'], west: ['sw', 'nw'] };
  for (const architecturePattern of ['angled', 'organic']) for (const seed of [12, 28, 95028, 564643]) {
    const state = generateDungeon(seed, 1, { architecturePattern, organicAssets });
    for (const tile of state.tiles.filter(tile => tile.type === 'floor' && tile.roomId))
      for (const [index, side] of ['north', 'east', 'south', 'west'].entries()) {
        const [dx, dy] = steps[index], neighbor = getTile(state, tile.x + dx, tile.y + dy);
        if (neighbor?.type !== 'floor' || neighbor.roomId || !neighbor.hallId) continue;
        assert.equal(tile.meta?.angledWall, undefined, `${architecturePattern}/${seed}: diagonal hallway jamb`);
        const art = getOrganicTileData(tile);
        if (art && architecturePattern === 'organic') for (const corner of corners[side])
          assert.equal(art.corners[corner], 'o', `${architecturePattern}/${seed}: ${corner}`);
      }
  }
});
