import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLightSources, computeLightPolygon, isTileIlluminated, isTileTouchedByLightPolygon } from '../../S3_content/src/light-geometry.js';
import { searchForTraps } from '../../S3_content/src/interactions.js';
import { canTargetAtRange } from '../../S3_content/src/targeting.js';

function scene() {
  const torch = { id: 'torch-bearer', hp: 10, x: 2, y: 4, visualX: 2.05, lightRadius: 6, routeId: '', gear: [] };
  const searcher = { id: 'searcher', hp: 10, x: 9, y: 4, lightRadius: 0, routeId: '', gear: [] };
  return { map: { width: 15, height: 10 }, tiles: Array.from({ length: 150 }, (_, i) => ({ x: i % 15, y: Math.floor(i / 15), type: 'floor', roomId: 'room' })),
    rooms: [], characters: [torch, searcher], activeCharacterId: searcher.id, entities: [], decor: {},
    player: { x: 9, y: 4, routeId: '', roomId: 'room', torchLit: false } };
}

test('exact illumination accepts a real narrow torch-edge sliver missed by every legacy tile sample', () => {
  const state = scene(), tile = state.tiles[4 * 15 + 9];
  const polygon = computeLightPolygon(state, collectLightSources(state)[0]);
  assert.equal(isTileTouchedByLightPolygon(tile, polygon), false, 'old point samples all miss the illuminated sliver');
  assert.equal(isTileIlluminated(state, 9, 4, state.player), true);
  assert.equal(isTileIlluminated(state, 10, 4), false);
});

test('a character without a light can search a tile illuminated only by another character torch edge', () => {
  const state = scene();
  const trap = { id: 'trap', type: 'trap', name: 'Needle', x: 9, y: 4, routeId: '', roomId: 'room',
    revealed: false, dc: 1, trigger: 'touch', effect: 'needle' };
  state.entities.push(trap);
  const result = searchForTraps(state, 99);
  assert.equal(result.darknessMessage, undefined); assert.deepEqual(result.found, [trap]);
  assert.equal(trap.revealed, true);
});

test('a partly illuminated monster can be directly attacked even when no legacy tile samples are visible', () => {
  const state = scene();
  state.visibility = { visibleNow: new Set(), exploredEver: new Set() };
  const target = { id: 'edge-monster', type: 'monster', name: 'Edge monster', hp: 10, x: 9, y: 4, routeId: '' };
  state.entities.push(target);
  assert.equal(canTargetAtRange(state, state.characters[0], target, 12, { directAttack: true }), true);
});

test('exact illumination preserves wall/void, suppression, and explicit underpass route restrictions', () => {
  const state = scene();
  state.tiles[4 * 15 + 9].type = 'wall'; assert.equal(isTileIlluminated(state, 9, 4), false);
  state.tiles[4 * 15 + 9].type = 'void'; assert.equal(isTileIlluminated(state, 9, 4), false);
  state.tiles[4 * 15 + 9].type = 'floor';
  state.characters[1].wizardEffects = [{ type: 'light-suppression', rounds: 2 }];
  assert.equal(isTileIlluminated(state, 9, 4, state.player), false);
  state.characters[1].wizardEffects = [];
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 9, y: 4 }], upperCrossings: [{ x: 9, y: 4 }], portals: [], art: [], artVersion: 2 }];
  assert.equal(isTileIlluminated(state, 9, 4, { x: 9, y: 4, routeId: '' }), true);
  assert.equal(isTileIlluminated(state, 9, 4, { x: 9, y: 4, routeId: 'lower' }), false);
});
