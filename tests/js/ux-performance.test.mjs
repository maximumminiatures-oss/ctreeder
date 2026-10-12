import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { movePlayer, clickEntity } from '../../S3_content/src/interactions.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';
import { computeLightPolygon, withLightPolygonCache } from '../../S3_content/src/light-geometry.js';
import { renderDungeon } from '../../S3_content/src/render.js';
import { loadLocalJson } from '../../S3_content/src/data-loader.js';

function scene() {
  const state = createEmptyDungeonState(42);
  state.map = { width: 12, height: 8 };
  state.tiles = Array.from({ length: 96 }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12),
    type: i % 12 > 0 && i % 12 < 11 && i >= 12 && i < 84 ? 'floor' : 'wall', roomId: 'room', meta: {} }));
  state.rooms = [{ id: 'room', x: 1, y: 1, width: 10, height: 6 }];
  state.player = { ...state.player, x: 3, y: 3, roomId: 'room', torchLit: true, lightRadius: 2 };
  state.entities = [{ id: 'door', type: 'feature', subtype: 'door', x: 4, y: 3, roomId: 'room',
    wallSide: 'east', hallDirection: 'east', orientation: 'vertical', doorState: 'locked' }];
  return state;
}

function drawingContext() {
  const operations = [];
  const context = { operations, fillStyle: '', globalCompositeOperation: 'source-over' };
  context.fillRect = (...args) => operations.push({ args, style: context.fillStyle, op: context.globalCompositeOperation });
  return new Proxy(context, { get: (target, name) => name in target ? target[name] : () => {} });
}

test('the loading map is solid black and does not draw a gray floor or tokens', () => {
  const state = scene(), context = drawingContext();
  renderDungeon(state, { backgroundCtx: context, topologyCtx: context, objectsCtx: context, fogCtx: context });
  assert.deepEqual(context.operations, [{ args: [0, 0, 12 * 54, 8 * 54], style: '#000000', op: 'source-over' }]);
});

test('unexplored fog starts completely opaque, including when the torch is out', () => {
  const state = scene();
  recomputeVisibility(state);
  const context = drawingContext();
  renderDungeon(state, { fogCtx: context }, { motionOnly: true });
  assert.deepEqual(context.operations[0], { args: [0, 0, 12 * 54, 8 * 54], style: '#000000', op: 'source-over' });
  const dark = drawingContext();
  renderDungeon(state, { fogCtx: dark }, { motionOnly: true, forceBlackout: true });
  assert.ok(dark.operations.some(entry => entry.args[0] === 10 * 54 && entry.style === 'rgba(0, 0, 0, 1)'));
});

test('visitors can open locked doors before importing; characters retain lock rules', () => {
  for (const torchLit of [true, false]) {
    const state = scene();
    state.player.torchLit = torchLit;
    for (let attempt = 0; attempt < 3 && state.entities[0].doorState !== 'open'; attempt++) movePlayer(state, 1, 0);
    assert.equal(state.entities[0].doorState, 'open');
    assert.equal(movePlayer(state, 1, 0).moved, true);
  }
  const clicked = scene();
  recomputeVisibility(clicked);
  assert.equal(clickEntity(clicked, 4, 3).message, 'Door opened.');
  const occupied = scene();
  occupied.characters = [{ id: 'hero', x: 3, y: 3 }];
  assert.equal(movePlayer(occupied, 1, 0).message, 'Locked.');
  assert.equal(occupied.entities[0].doorState, 'locked');
});

test('preview treasure clicks request a character instead of obsolete loot buttons', () => {
  for (const corpseLoot of [false, true]) {
    const state = scene();
    state.entities = [{ id: 'coins', type: 'treasure', x: 3, y: 3, roomId: 'room', visible: true, corpseLoot }];
    recomputeVisibility(state);
    assert.equal(clickEntity(state, 3, 3).message, 'import or load a character to pick up treasure.');
    assert.notEqual(state.entities[0].collected, true);
  }
});

test('deferred movement lighting waits for character synchronization and preserves standalone callers', () => {
  const state = scene();
  state.entities = [];
  recomputeVisibility(state);
  const visible = [...state.visibility.visibleNow];
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  assert.deepEqual([...state.visibility.visibleNow], visible);
  const polygons = recomputeVisibility(state);
  assert.ok(Array.isArray(polygons) && polygons.length > 0);
  assert.notDeepEqual([...state.visibility.visibleNow], visible);
  const before = [...state.visibility.visibleNow];
  assert.equal(movePlayer(state, 1, 0).moved, true);
  assert.notDeepEqual([...state.visibility.visibleNow], before);
});

test('light reuse is scoped to one pass, distinguishes options and invalidates for opening doors', () => {
  const state = scene(), source = { x: 3, y: 3, radius: 6 };
  const closed = withLightPolygonCache(state, () => {
    const first = computeLightPolygon(state, source);
    assert.equal(computeLightPolygon(state, { ...source }), first);
    assert.notEqual(computeLightPolygon(state, source, { ignorePillars: true }), first);
    return first;
  });
  state.entities[0].doorState = 'open';
  const open = withLightPolygonCache(state, () => computeLightPolygon(state, source));
  assert.notDeepEqual(open, closed);
  const seeded = withLightPolygonCache(state, () => computeLightPolygon(state, source), [{ source, polygon: open }]);
  assert.equal(seeded, open);
  assert.notEqual(computeLightPolygon(state, source), open);
  assert.throws(() => withLightPolygonCache(state, () => { throw new Error('test'); }));
  assert.notEqual(computeLightPolygon(state, source), open);
});

test('static JSON requests share in-flight/results but failed responses can be retried', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ value: 42 }) }; };
  try {
    const a = loadLocalJson('/test-static-data');
    assert.equal(a, loadLocalJson('/test-static-data'));
    assert.deepEqual(await a, { value: 42 });
    await loadLocalJson('/test-static-data');
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; return { ok: false, status: 503 }; };
    await assert.rejects(loadLocalJson('/test-retry-data'), /503/);
    globalThis.fetch = async () => { calls++; return { ok: true, json: async () => [] }; };
    assert.deepEqual(await loadLocalJson('/test-retry-data'), []);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
