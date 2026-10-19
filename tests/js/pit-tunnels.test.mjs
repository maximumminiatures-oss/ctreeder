import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { makePitTunnel, addPitFeatures } from '../../S3_content/src/pit-tunnels.js';
import { pitAtBottom, ropeDescents, descendWithRope, climbFromPit, fallIntoPit, pitArt, ropeRescues } from '../../S3_content/src/pits.js';
import { routeStep, reachableRoutes, routeKey } from '../../S3_content/src/underpasses.js';
import { canMoveBetweenTiles, movePlayer } from '../../S3_content/src/interactions.js';
import { hasLineOfSightFrom, recomputeVisibility, isTileVisible } from '../../S3_content/src/visibility.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { generateDungeon } from '../../S3_content/src/generator.js';

function scene() {
  const state = createEmptyDungeonState(1, 1);
  state.rooms = [{ id: 'west', x: 2, y: 2, width: 5, height: 5 }, { id: 'east', x: 14, y: 2, width: 5, height: 5 }];
  for (const tile of state.tiles) {
    const room = state.rooms.find(room => tile.x >= room.x && tile.y >= room.y && tile.x < room.x + 5 && tile.y < room.y + 5);
    Object.assign(tile, { type: room ? 'floor' : 'wall', roomId: room?.id || null, meta: {} });
  }
  const pits = [4, 16].map((x, i) => ({ id: `pit-${i}`, type: 'feature', subtype: 'pit', routeId: '', x, y: 4,
    cells: [{ x, y: 4 }], roomId: i ? 'east' : 'west', revealed: true, visible: true }));
  state.entities = pits;
  const route = makePitTunnel(state, 'pit-route', pits, Array.from({ length: 13 }, (_, i) => ({ x: i + 4, y: 4 })));
  for (const cell of route.lowerCells) getTile(state, cell.x, cell.y).type = 'floor';
  state.underpasses = [route];
  const hero = { id: 'hero', name: 'Hero', className: 'Fighter', x: 3, y: 4, routeId: '', roomId: 'west',
    hp: 50, maxHitPoints: 50, stats: { STR: 14 }, gear: [{ name: 'Rope', totalUnits: 1 }], conditions: {}, raw: {}, bonuses: [], lightRadius: 6, lightSource: 'torch' };
  state.characters = [hero]; state.activeCharacterId = hero.id;
  Object.assign(state.player, hero, { torchLit: true });
  return { state, hero, pits, route };
}
const options = state => ({ canStep: (x, y, nx, ny, creature) => canMoveBetweenTiles(state, x, y, nx, ny, { creature, routeId: creature?.routeId, ignorePits: true }).ok,
  check: () => ({ total: 20, roll: 18 }) });

test('rope descent is deliberate and damage-free; lower passage leads to another pit requiring STR ascent', () => {
  const { state, hero, pits } = scene();
  assert.equal(movePlayer(state, 1, 0).moved, false);
  assert.equal(ropeDescents(state, hero, options(state)).length, 1);
  descendWithRope(state, hero, pits[0].id, options(state));
  assert.equal(hero.hp, 50); assert.equal(hero.routeId, 'pit-route'); assert.equal(pitAtBottom(state, hero), pits[0]);
  for (let i = 0; i < 12; i++) assert.equal(movePlayer(state, 1, 0).moved, true);
  assert.equal(hero.x, 16); assert.equal(pitAtBottom(state, hero), pits[1]);
  const failed = climbFromPit(state, hero, { ...options(state), check: () => ({ total: 1 }) });
  assert.equal(failed.escaped, false); assert.equal(hero.routeId, 'pit-route');
  const result = climbFromPit(state, hero, options(state));
  assert.equal(result.escaped, true); assert.equal(hero.routeId, ''); assert.equal(hero.roomId, 'east');
});

test('no rope, incapacitation, other-route entrances or occupied pit bottoms cannot descend', () => {
  const { state, hero, pits } = scene();
  hero.gear = []; assert.throws(() => descendWithRope(state, hero, pits[0].id, options(state)), /rope/);
  hero.gear = [{ name: 'Rope' }]; hero.conditions.paralyzed = true;
  assert.equal(ropeDescents(state, hero, options(state)).length, 0);
  delete hero.conditions.paralyzed;
  state.characters.push({ id: 'blocked', x: 4, y: 4, hp: 10, routeId: 'pit-route' });
  assert.equal(ropeDescents(state, hero, options(state)).length, 0);
});

test('rope rescue only reaches a character below that particular pit, never another connected pit', () => {
  const { state, hero } = scene();
  const helper = { ...structuredClone(hero), id: 'helper' }; state.characters.push(helper);
  descendWithRope(state, hero, 'pit-0', options(state));
  assert.equal(ropeRescues(state, helper, options(state)).length, 1);
  for (let i = 0; i < 12; i++) assert.equal(movePlayer(state, 1, 0).moved, true);
  assert.equal(ropeRescues(state, helper, options(state)).length, 0);
});

test('a fall enters the connected lower route, still deals 3d6 damage and leaves the victim prone', () => {
  const { state, hero, pits } = scene(); hero.x = 4;
  fallIntoPit(state, pits[0], hero, { random: () => 0 });
  assert.equal(hero.hp, 47); assert.equal(hero.routeId, 'pit-route'); assert.equal(hero.conditions.prone, true);
  assert.equal(movePlayer(state, 1, 0).moved, false);
  delete hero.conditions.prone; assert.equal(movePlayer(state, 1, 0).moved, true);
});

test('lower turns stay connected, cannot cut corners, and never share sight with upper rooms', () => {
  const { state, hero } = scene();
  descendWithRope(state, hero, 'pit-0', options(state));
  assert.equal(hasLineOfSightFrom(state, 4, 4, 5, 4, { source: hero, targetRouteId: '' }), false);
  assert.equal(routeStep(state, hero, { x: 4, y: 3 }), null);
  recomputeVisibility(state); assert.equal(isTileVisible(state, 5, 4, ''), false);
  const restored = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(restored.underpasses[0].kind, 'pit-tunnel'); assert.equal(restored.characters[0].routeId, 'pit-route');
  const reached = reachableRoutes(state, { x: 3, y: 4, routeId: '' }, (a, b) => canMoveBetweenTiles(state, a.x, a.y, b.x, b.y, { routeId: a.routeId }).ok);
  assert.ok(reached.has('|18,6')); assert.ok(reached.has('pit-route|10,4'));
});

test('pit rims support narrow, wide, tall and large room footprints', () => {
  const { state } = scene();
  for (const [width, height] of [[1, 1], [1, 5], [5, 1], [6, 4], [4, 6]]) {
    const pit = { subtype: 'pit', cells: Array.from({ length: width * height }, (_, i) => ({ x: 20 + i % width, y: 10 + Math.floor(i / width) })) };
    assert.equal(pitArt(state, pit).length, width * height);
  }
});

test('generated pit networks preserve independent route topology and physically reach all lower cells and bonus rooms', () => {
  let networks = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const state = generateDungeon(seed, 1, { pits: false });
    const canStep = (a, b) => canMoveBetweenTiles(state, a.x, a.y, b.x, b.y, { routeId: a.routeId, ignoreClosedDoors: true }).ok;
    addPitFeatures(state, new SeededRng(seed), { chance: 1, canStep });
    const route = state.underpasses.find(item => item.kind === 'pit-tunnel');
    if (!route) continue;
    networks++;
    const reached = reachableRoutes(state, state.player, (a, b) => canMoveBetweenTiles(state, a.x, a.y, b.x, b.y, { routeId: a.routeId, ignoreClosedDoors: true }).ok);
    for (const cell of route.lowerCells) assert.ok(reached.has(routeKey({ ...cell, routeId: route.id })), `seed ${seed}`);
    const bonus = state.rooms.find(room => room.id === state.generation.pitNetwork.bonusRoomId);
    if (bonus) assert.ok(reached.has(`|${bonus.x},${bonus.y}`), `bonus ${seed}`);
  }
  assert.ok(networks >= 5, networks);
});
