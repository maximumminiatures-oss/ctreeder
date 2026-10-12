import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateDungeon, generateClassicDungeon } from '../../S3_content/src/generator.js';
import { doorApproachTiles } from '../../S3_content/src/door-geometry.js';
import { enforceSecretDoorApproaches, traverseDoorApproaches } from '../../S3_content/src/secret-door-placement.js';
import { canMoveBetweenTiles } from '../../S3_content/src/interactions.js';

const assets = JSON.parse(readFileSync(new URL('../../S3_content/data/organic-assets.json', import.meta.url)));
const key = point => `${point.x},${point.y}`;

function corridor() {
  const state = { map: { width: 12, height: 3 }, player: { x: 1, y: 1 }, generation: {},
    tiles: Array.from({ length: 36 }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12),
      type: i >= 12 && i < 24 ? 'floor' : 'wall', roomId: i % 12 < 4 ? 'near' : i % 12 > 7 ? 'far' : null })),
    entities: [
      { id: 'near-door', subtype: 'door', roomId: 'near', hallId: 'hall', x: 4, y: 1, wallSide: 'east', doorSpriteId: 'door3', doorState: 'open' },
      { id: 'far-door', subtype: 'door', roomId: 'far', hallId: 'hall', x: 7, y: 1, wallSide: 'west', doorSpriteId: 'door-secret-2', doorState: 'closed', secret: true, searchDc: 13 }
    ] };
  const canStep = (a, b) => a.y === 1 && b.y === 1 && a.x >= 0 && b.x >= 0 && a.x < 12 && b.x < 12;
  return { state, canStep };
}

test('hall-first secrets move to the room-first end without moving rooms or hall tiles', () => {
  const { state, canStep } = corridor();
  const geometry = JSON.stringify(state.tiles), oldPositions = state.entities.map(door => [door.x, door.y]);
  const result = enforceSecretDoorApproaches(state, canStep);
  assert.deepEqual(result.relocated, [{ from: 'far-door', to: 'near-door' }]);
  assert.deepEqual(result.doors, [{ id: 'near-door', roomSteps: 2, hallSteps: 3 }]);
  assert.equal(state.entities[0].doorSpriteId, 'door-secret-2');
  assert.equal(state.entities[0].searchDc, 13);
  assert.equal(state.entities[0].doorState, 'closed');
  assert.equal(state.entities[1].secret, false);
  assert.equal(state.entities[1].visible, true);
  assert.equal(JSON.stringify(state.tiles), geometry);
  assert.deepEqual(state.entities.map(door => [door.x, door.y]), oldPositions);
});

test('a secret with no reachable, room-first partner becomes an ordinary usable door', () => {
  const { state, canStep } = corridor();
  state.entities.shift();
  state.entities[0].normalDoorSpriteId = 'door4';
  state.entities[0].doorState = 'locked';
  const result = enforceSecretDoorApproaches(state, canStep);
  assert.deepEqual(result.ordinary, ['far-door']);
  assert.equal(state.entities[0].secret, false);
  assert.equal(state.entities[0].doorSpriteId, 'door4');
  assert.equal(state.entities[0].doorState, 'locked');
});

test('equal-distance approaches and physically blocked room sides cannot become secret doors', () => {
  for (const blocked of [false, true]) {
    const { state, canStep } = corridor();
    state.player = { x: 6, y: 1 };
    state.entities = [state.entities[1]];
    const step = (a, b) => canStep(a, b) && (!blocked || b.x !== 8);
    if (!blocked) state.player = { x: 7, y: 0 };
    const diagonal = (a, b) => (!blocked && a.x === 7 && a.y === 0 && [7, 8].includes(b.x) && b.y === 1) || step(a, b);
    enforceSecretDoorApproaches(state, diagonal);
    assert.equal(state.entities[0].secret, false);
  }
});

test('room-first secrets remain searchable in sequence with all unknown secrets closed', () => {
  const { state, canStep } = corridor();
  Object.assign(state.entities[0], { secret: true, doorSpriteId: 'door-secret-1' });
  state.entities.pop();
  const result = enforceSecretDoorApproaches(state, canStep);
  assert.equal(result.ordinary.length, 0);
  assert.equal(result.relocated.length, 0);
  const visibleArea = traverseDoorApproaches(state, canStep, state.entities);
  assert.ok(visibleArea.has(key(doorApproachTiles(state.entities[0]).room)));
  assert.ok(!visibleArea.has(key(doorApproachTiles(state.entities[0]).hall)));
});

function verifyRuntimeDistances(state) {
  const traversable = { ...state, entities: state.entities.map(entity => entity.subtype === 'door' ? { ...entity, doorState: 'open' } : entity) };
  const canStep = (a, b) => canMoveBetweenTiles(traversable, a.x, a.y, b.x, b.y).ok;
  const distances = traverseDoorApproaches(state, canStep);
  let pending = state.entities.filter(door => door.secret === true);
  for (const door of pending) {
    const sides = doorApproachTiles(door);
    assert.ok(distances.get(key(sides.room)) < distances.get(key(sides.hall)), `seed ${state.seed}, ${door.id}: room must be closer`);
  }
  while (pending.length) {
    const area = traverseDoorApproaches(state, canStep, pending);
    const next = pending.filter(door => !area.has(key(doorApproachTiles(door).room)));
    assert.ok(next.length < pending.length, `seed ${state.seed}: secrets prevent discovery from the room side`);
    pending = next;
  }
}

test('seed 564643 keeps its spiral-stair layout and replaces the far-side secret', () => {
  const state = generateDungeon(564643, 1, { organicAssets: assets });
  assert.equal(state.rooms[0].reviewedTemplate, 'hall-stair-entrance');
  assert.deepEqual([state.player.x, state.player.y], [6, 14]);
  assert.equal(state.entities.find(door => door.id === 'door-23-20').secret, false);
  assert.equal(state.entities.find(door => door.id === 'door-23-18').secret, true);
  assert.equal(state.generation.connectivityValid, true);
  verifyRuntimeDistances(state);
});

test('secret approach checks cover varied seeds, levels, reviewed layouts and classic generation', () => {
  let secrets = 0;
  for (const [index, seed] of [1, 2, 7, 11, 42, 101, 310, 919, 2048, 6565, 9218, 564643].entries()) {
    const state = generateDungeon(seed, index % 5 + 1, { organicAssets: assets });
    verifyRuntimeDistances(state);
    secrets += state.entities.filter(door => door.secret).length;
  }
  for (const pattern of ['organic', 'organicHybrid', 'innerWalls', 'waterLogged', 'angled', 'maze']) {
    verifyRuntimeDistances(generateDungeon(564643, 2, { organicAssets: assets, architecturePattern: pattern }));
  }
  verifyRuntimeDistances(generateClassicDungeon(564643, 1));
  assert.ok(secrets > 6, 'Secret doors should remain a normal rare feature.');
});
