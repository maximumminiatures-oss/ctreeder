import test from 'node:test';
import assert from 'node:assert/strict';
import { makeUnderpass, routeStep, routeOf, reachableRoutes, routeKey, addUnderpasses } from '../../S3_content/src/underpasses.js';
import { canMoveBetweenTiles, movePlayer, collectLoot, searchForTraps, disarmTrap } from '../../S3_content/src/interactions.js';
import { hasLineOfSightFrom, recomputeVisibility, isTileVisible } from '../../S3_content/src/visibility.js';
import { canTargetAtRange, planClickMovement } from '../../S3_content/src/targeting.js';
import { characterOccupant, combatStepBlock } from '../../S3_content/src/combat-rules.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { canTouchCharacter } from '../../S3_content/src/spell-effects.js';
import { findPursuitStep } from '../../S3_content/src/pursuit.js';
import { applyBurningHands } from '../../S3_content/src/burning-hands.js';
import { generateDungeon } from '../../S3_content/src/generator.js';

function crossingScene() {
  const width = 15, height = 11;
  const tiles = Array.from({ length: width * height }, (_, i) => {
    const x = i % width, y = Math.floor(i / width);
    return { x, y, type: (x === 7 && y > 0 && y < 10 || y === 5 && x > 0 && x < 14 ||
      y === 1 && x >= 1 && x <= 13 || (x === 1 || x === 13) && y >= 1 && y <= 5) ? 'floor' : 'wall', meta: {} };
  });
  const route = makeUnderpass('lower', Array.from({ length: 11 }, (_, i) => ({ x: i + 2, y: 5 })),
    { x: 7, y: 5 }, [{ x: 1, y: 5 }, { x: 13, y: 5 }]);
  const hero = { id: 'hero', name: 'Hero', x: 6, y: 5, routeId: 'lower', hp: 10, maxHitPoints: 10, lightSource: 'torch', lightRadius: 6,
    className: 'Fighter', gear: [{ name: 'Torch', lit: true, equipped: true }], stats: { STR: 12 } };
  return hydrateDungeonState({ seed: 1, map: { width, height }, tiles, underpasses: [route], entities: [], rooms: [], halls: [], decor: {}, generation: {},
    characters: [hero], player: { ...hero, torchLit: true }, activeCharacterId: 'hero' });
}
const steps = state => (from, to) => canMoveBetweenTiles(state, from.x, from.y, to.x, to.y, { routeId: from.routeId }).ok;

test('crossing has two independent nodes; stairs alone change routes and the complete graph stays reachable', () => {
  const state = crossingScene();
  assert.equal(routeStep(state, { x: 7, y: 5, routeId: 'lower' }, { x: 7, y: 4 }), null);
  assert.equal(routeStep(state, { x: 7, y: 5, routeId: '' }, { x: 8, y: 5 }), null);
  assert.equal(routeStep(state, { x: 6, y: 5, routeId: 'lower' }, { x: 7, y: 5 }).routeId, 'lower');
  assert.equal(routeStep(state, { x: 7, y: 4, routeId: '' }, { x: 7, y: 5 }).routeId, '');
  assert.equal(routeStep(state, { x: 1, y: 5, routeId: '' }, { x: 2, y: 5 }).routeId, 'lower');
  assert.equal(routeStep(state, { x: 2, y: 5, routeId: 'lower' }, { x: 1, y: 5 }).routeId, '');
  const reached = reachableRoutes(state, { x: 1, y: 5, routeId: '' }, steps(state));
  for (const tile of state.tiles.filter(tile => tile.type === 'floor')) {
    assert.ok(reached.has(routeKey({ ...tile, routeId: routeOf(state, tile) })), JSON.stringify(tile));
  }
  assert.ok(reached.has('lower|7,5')); assert.ok(reached.has('|7,5'));
});

test('torchlight, sight, direct spells, area targeting and touch cannot cross the two levels', () => {
  const state = crossingScene(), hero = state.characters[0];
  recomputeVisibility(state);
  assert.equal(isTileVisible(state, 7, 5, 'lower'), true);
  assert.equal(isTileVisible(state, 7, 5, ''), false);
  assert.equal(isTileVisible(state, 7, 4, ''), false);
  const above = { id: 'above', x: 7, y: 5, routeId: '', hp: 10 };
  const below = { ...above, routeId: 'lower' };
  assert.equal(hasLineOfSightFrom(state, hero.x, hero.y, above.x, above.y, { source: hero, target: above }), false);
  assert.equal(canTargetAtRange(state, hero, above, 12, { requireLight: false }), false);
  assert.equal(canTargetAtRange(state, hero, below, 12, { requireLight: false }), true);
  assert.equal(canTouchCharacter(state, hero, above), false);
  assert.equal(canTouchCharacter(state, hero, below), true);
  Object.assign(hero, { x: 7, y: 4, routeId: '' }); Object.assign(state.player, hero);
  recomputeVisibility(state);
  assert.equal(isTileVisible(state, 7, 5, ''), true);
  assert.equal(isTileVisible(state, 7, 5, 'lower'), false);
  assert.equal(isTileVisible(state, 8, 5, 'lower'), false);
});

test('stacked tokens and treasure have independent occupancy and interaction', () => {
  const state = crossingScene(), hero = state.characters[0];
  state.characters.push({ id: 'above', x: 7, y: 5, routeId: '', hp: 10 });
  state.entities.push({ id: 'orc', type: 'monster', x: 7, y: 5, routeId: '', hp: 10 });
  state.combat.active = true;
  assert.equal(characterOccupant(state, 7, 5, hero.id), undefined);
  assert.equal(Boolean(combatStepBlock(state, hero, 7, 5)), false);
  assert.equal(movePlayer(state, 1, 0).moved, true);
  assert.equal(hero.routeId, 'lower'); assert.equal(hero.x, 7);
  state.entities.push({ id: 'gold', type: 'treasure', x: 7, y: 5, routeId: '', value: 10 });
  assert.equal(collectLoot(state, 'gold').collected, 0);
});

test('save/load preserves route identities and separate explored cells; pursuit uses stairs, not the intersection', () => {
  const state = crossingScene(); recomputeVisibility(state);
  const loaded = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(loaded.characters[0].routeId, 'lower');
  assert.ok(loaded.visibility.routeExplored.lower.has('7,5'));
  assert.ok(!loaded.visibility.routeExplored['']?.has('7,5'));
  const foe = { x: 7, y: 5, routeId: '' }, target = { x: 7, y: 5, routeId: 'lower' };
  const step = findPursuitStep(loaded, foe, target, {
    canStep: (x, y, nx, ny, point) => steps(loaded)(point, { x: nx, y: ny }),
    canAttackFrom: (x, y) => Math.hypot(x - target.x, y - target.y) <= 1
  });
  assert.deepEqual([step.x, step.y, step.routeId], [7, 4, '']);
});

test('generator adds a connected lower loop without deleting any original upper node', () => {
  const state = crossingScene(); state.underpasses = []; state.characters = []; state.entities = [];
  for (const tile of state.tiles) if (tile.y === 5 && tile.x > 1 && tile.x < 13 && tile.x !== 7) tile.type = 'wall';
  state.player = { x: 1, y: 5, routeId: '' };
  const baseline = reachableRoutes(state, state.player, steps(state));
  addUnderpasses(state, new SeededRng(1), { canStand: tile => tile?.type === 'floor', canStep: steps(state) });
  assert.equal(state.underpasses.length, 1);
  const reached = reachableRoutes(state, state.player, steps(state));
  assert.ok([...baseline].every(cell => reached.has(cell)));
  assert.ok(state.underpasses[0].lowerCells.every(cell => reached.has(routeKey({ ...cell, routeId: state.underpasses[0].id }))));
});

test('room-facing underpasses reserve normal doorway tiles and keep both stair footprints outside rooms', () => {
  for (const vertical of [false, true]) {
    const state = crossingScene(); state.underpasses = []; state.characters = []; state.entities = [];
    state.rooms = [{ id: 'west', x: 0, y: 3, width: 4, height: 5 }, { id: 'east', x: 11, y: 3, width: 4, height: 5 }];
    for (const tile of state.tiles) {
      const room = state.rooms.find(room => tile.x >= room.x && tile.x < room.x + room.width && tile.y >= room.y && tile.y < room.y + room.height);
      tile.roomId = room?.id || null;
      tile.type = room || tile.x === 7 && tile.y > 0 && tile.y < 10 || tile.y === 1 && tile.x > 0 && tile.x < 14 ||
        [1, 13].includes(tile.x) && tile.y > 0 && tile.y < 4 ? 'floor' : 'wall';
    }
    state.player = { x: 1, y: 5, routeId: '' };
    if (vertical) {
      state.map = { width: 11, height: 15 };
      state.tiles = state.tiles.map(tile => ({ ...tile, x: tile.y, y: tile.x })).sort((a, b) => a.y - b.y || a.x - b.x);
      state.rooms = state.rooms.map(room => ({ ...room, x: room.y, y: room.x, width: room.height, height: room.width }));
      state.player = { x: 5, y: 1, routeId: '' };
    }
    const canStep = (a, b) => canMoveBetweenTiles(state, a.x, a.y, b.x, b.y, { routeId: a.routeId, ignoreClosedDoors: true }).ok;
    const center = vertical ? { x: 5, y: 7 } : { x: 7, y: 5 };
    addUnderpasses(state, new SeededRng(1), { canStand: tile => tile?.type === 'floor' &&
      (tile.roomId || tile.x === center.x && tile.y === center.y), canStep });
    assert.equal(state.underpasses.length, 1);
    const route = state.underpasses[0], doors = state.entities.filter(entity => entity.subtype === 'door');
    assert.equal(doors.length, 2);
    assert.deepEqual(doors.map(door => door.wallSide).sort(), vertical ? ['north', 'south'] : ['east', 'west']);
    for (const door of doors) {
      assert.equal(door.routeId, '');
      assert.equal(state.tiles[door.y * state.map.width + door.x].roomId, null);
      assert.ok(route.portals.some(portal => portal.upper.x === door.x && portal.upper.y === door.y));
    }
    for (const art of route.art.filter(item => item.asset.startsWith('stairs-'))) {
      const width = art.turn % 2 ? art.h : art.w, height = art.turn % 2 ? art.w : art.h;
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        assert.equal(state.tiles[(art.y + dy) * state.map.width + art.x + dx].roomId, null);
        assert.ok(!doors.some(door => door.x === art.x + dx && door.y === art.y + dy));
      }
    }
    const reached = reachableRoutes(state, state.player, canStep);
    assert.ok(route.lowerCells.every(cell => reached.has(routeKey({ ...cell, routeId: route.id }))));
  }
});

test('area fire and magical darkness do not affect the other route at a shared crossing', () => {
  const state = crossingScene(), hero = state.characters[0];
  const above = { id: 'above', type: 'monster', name: 'Orc', x: 7, y: 5, routeId: '', hp: 20 };
  const below = { ...above, id: 'below', routeId: 'lower' };
  state.entities.push(above, below);
  applyBurningHands(state, hero, { random: () => .99 });
  assert.equal(above.hp, 20); assert.equal(below.hp, 14);
  Object.assign(hero, { x: 7, y: 4, routeId: '' }); Object.assign(state.player, hero);
  state.characters.push({ id: 'suppressor', x: 7, y: 5, routeId: 'lower', hp: 10, wizardEffects: [{ type: 'light-suppression', rounds: 10 }] });
  recomputeVisibility(state);
  assert.equal(isTileVisible(state, 7, 5, ''), true);
  assert.equal(isTileVisible(state, 7, 5, 'lower'), false);
});

test('incorporeal movement passes through walls without accidentally changing levels', () => {
  const state = crossingScene(), hero = state.characters[0];
  Object.assign(hero, { x: 7, y: 5, routeId: '', conditions: { incorporeal: true } }); Object.assign(state.player, hero);
  assert.equal(movePlayer(state, 1, 0).moved, true);
  assert.equal(hero.routeId, ''); assert.equal(state.player.x, 8);
  const loaded = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(loaded.characters[0].routeId, '');
});

test('an upper door, pit and hidden monster cannot block or reveal a lower token moving in darkness', () => {
  const state = crossingScene(), hero = state.characters[0];
  hero.lightRadius = 0; state.player.torchLit = false;
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', doorState: 'closed', orientation: 'horizontal', wallSide: 'north',
    x: 7, y: 5, routeId: '', visible: true }, { id: 'pit', type: 'feature', subtype: 'pit', x: 7, y: 5, routeId: '' },
    { id: 'orc', type: 'monster', name: 'Orc', x: 7, y: 5, routeId: '', hp: 20, visible: false });
  assert.equal(canMoveBetweenTiles(state, 6, 5, 7, 5, { routeId: 'lower' }).ok, true);
  const moved = movePlayer(state, 1, 0);
  assert.equal(moved.moved, true); assert.ok(!moved.trapSprung);
  assert.equal(moved.message, 'Moved through darkness.');
  assert.equal(state.entities.at(-1).visible, false);
});

test('vertical stair art and navigation rotate together without connecting the crossing', () => {
  const state = crossingScene(), rotate = point => ({ x: point.y, y: point.x });
  state.map = { width: 11, height: 15 };
  state.tiles = state.tiles.map(tile => ({ ...tile, ...rotate(tile) })).sort((a, b) => a.y - b.y || a.x - b.x);
  const old = state.underpasses[0];
  state.underpasses = [makeUnderpass('lower', old.lowerCells.map(rotate), rotate(old.upperCrossings[0]), old.portals.map(p => rotate(p.upper)), 'vertical')];
  for (const point of [state.player, ...state.characters]) Object.assign(point, rotate(point));
  assert.equal(state.underpasses[0].art[0].turn, 1);
  assert.equal(movePlayer(state, 0, 1).moved, true);
  assert.equal(state.characters[0].routeId, 'lower');
  assert.equal(movePlayer(state, 1, 0).moved, false);
  assert.equal(movePlayer(state, 0, 1).moved, true);
  const reached = reachableRoutes(state, { x: 5, y: 1, routeId: '' }, steps(state));
  assert.ok(reached.has('lower|5,7')); assert.ok(reached.has('|5,7'));
});

test('ordinary lower halls use the exported straight pieces; the under-wall art requires an explicit preserved wall', () => {
  for (const axis of ['horizontal', 'vertical']) {
    const point = n => axis === 'horizontal' ? { x: n, y: 5 } : { x: 5, y: n };
    const cells = Array.from({ length: 13 }, (_, i) => point(i + 2));
    const route = makeUnderpass('test', cells, point(8), [point(1), point(15)], axis);
    assert.equal(route.art.some(item => item.asset === 'tunnel-below-wall'), false);
    assert.equal(route.art.filter(item => item.asset === 'tunnel-below').length, 1);
    assert.ok(route.art.some(item => item.asset === 'stairs-down-straight-1x2'));
    for (const art of route.art.filter(item => item.asset.startsWith('stairs-down-straight'))) assert.equal(art.turn, axis === 'horizontal' ? 0 : 1);
    const preserved = makeUnderpass('test', cells, point(8), [point(1), point(15)], axis, { wallCrossings: [point(5)] });
    assert.deepEqual(preserved.art.filter(item => item.asset === 'tunnel-below-wall').map(item => [item.x, item.y]), [[point(5).x, point(5).y]]);
  }
});

test('loading an older underpass replaces unnecessary gray wall art without changing its route', () => {
  const state = crossingScene(), route = state.underpasses[0];
  delete route.artVersion;
  for (const art of route.art) if (art.asset.startsWith('stairs-down-straight')) art.asset = 'tunnel-below-wall';
  const loaded = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(loaded.underpasses[0].artVersion, 2);
  assert.equal(loaded.underpasses[0].art.some(item => item.asset === 'tunnel-below-wall'), false);
  assert.deepEqual(loaded.underpasses[0].lowerCells, route.lowerCells);
  assert.equal(loaded.characters[0].routeId, 'lower');
});

test('searching and disarming do not reach traps on the other level', () => {
  const state = crossingScene();
  state.entities.push({ id: 'above-trap', type: 'trap', x: 7, y: 5, routeId: '', roomId: null, dc: 1, searchDc: 1, revealed: false, visible: false },
    { id: 'below-trap', type: 'trap', x: 7, y: 5, routeId: 'lower', roomId: null, dc: 1, searchDc: 1, revealed: false, visible: false });
  state.player.roomId = null;
  const result = searchForTraps(state, 99);
  assert.deepEqual(result.found.map(entity => entity.id), ['below-trap']);
  state.entities[0].revealed = true;
  assert.equal(disarmTrap(state, 'above-trap', 99).disarmed, false);
});

test('an upper statue cannot block movement or torchlight in the passage underneath it', () => {
  const state = crossingScene(), hero = state.characters[0];
  state.decor.reviewed = [{ assetKey: 'statue-1x1-n', x: 7, y: 5, gridWidthTiles: 1, gridHeightTiles: 1, routeId: '' }];
  state.tiles[5 * 15 + 7].meta.layoutBlocks = true;
  assert.equal(canMoveBetweenTiles(state, 6, 5, 7, 5, { routeId: 'lower' }).ok, true);
  assert.equal(hasLineOfSightFrom(state, 6, 5, 8, 5, { source: hero, targetRouteId: 'lower' }), true);
  recomputeVisibility(state);
  assert.equal(isTileVisible(state, 8, 5, 'lower'), true);
});

test('generated crossings retain every traversable upper tile and both lower exits across many seeds', () => {
  let count = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const state = generateDungeon(seed, 1);
    if (!state.underpasses.length) continue;
    count++;
    const reached = reachableRoutes(state, state.player, (a, b) => canMoveBetweenTiles(state, a.x, a.y, b.x, b.y,
      { routeId: a.routeId, ignoreClosedDoors: true }).ok);
    for (const route of state.underpasses) {
      assert.ok(route.lowerCells.every(cell => reached.has(routeKey({ ...cell, routeId: route.id }))), `seed ${seed}`);
      if (route.kind !== 'pit-tunnel') assert.ok(route.upperCrossings.every(cell => reached.has(routeKey({ ...cell, routeId: '' }))), `seed ${seed} upper crossing`);
      assert.ok(route.portals.every(portal => reached.has(routeKey({ ...portal.upper, routeId: '' }))), `seed ${seed} exit`);
    }
  }
  assert.ok(count >= 5, `${count} generated underpasses`);
});
