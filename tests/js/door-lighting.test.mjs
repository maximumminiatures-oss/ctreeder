import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';
import { computeLightPolygon, isPointInPolygon } from '../../S3_content/src/light-geometry.js';
import { doorLightSegments, doorRotationAngle } from '../../S3_content/src/door-geometry.js';
import { DOOR_LIGHT_RULES } from '../../S3_content/src/door-light-data.js';
import { renderDungeon } from '../../S3_content/src/render.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

const reviewedLine = [[-.0074, .5376], [1.0349, .5096]];

function scene(orientation, side = -1, angle = orientation === 'horizontal' ? 0 : Math.PI / 2) {
  const state = createEmptyDungeonState(7);
  state.map = { width: 11, height: 11 };
  state.tiles = Array.from({ length: 121 }, (_, i) => {
    const x = i % 11, y = Math.floor(i / 11);
    const border = x === 0 || y === 0 || x === 10 || y === 10;
    const divider = orientation === 'horizontal' ? y === 5 && x !== 5 : x === 5 && y !== 5;
    return { x, y, type: border || divider ? 'wall' : 'floor', roomId: 'room', meta: {} };
  });
  state.rooms = [{ id: 'room', x: 1, y: 1, width: 9, height: 9 }];
  state.entities = [{ id: 'internal', type: 'feature', subtype: 'door', x: 5, y: 5,
    roomId: 'room', internal: true, orientation, doorRotationAngle: angle, doorState: 'closed' }];
  state.player = { ...state.player, x: 5 + (orientation === 'vertical' ? side : 0),
    y: 5 + (orientation === 'horizontal' ? side : 0), roomId: 'room', torchLit: true, lightRadius: 4 };
  return state;
}

test('ordinary door rules use the latest artist bisector and explicitly empty open-door shadows', () => {
  assert.deepEqual(DOOR_LIGHT_RULES['door-closed'], { w: 1, h: 1, paths: [reviewedLine], edges: [] });
  assert.deepEqual(DOOR_LIGHT_RULES['door-open'], { w: 1, h: 1, paths: [], edges: [] });
  assert.ok(DOOR_LIGHT_RULES['door-secret-1'].edges.length);
  assert.ok(DOOR_LIGHT_RULES['door-secret-3-open'].paths.length);
});

test('reviewed door lighting rotates exactly with the displayed sprite in all four poses', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const orientation = Math.abs(Math.sin(angle)) > .5 ? 'vertical' : 'horizontal';
    const door = scene(orientation, -1, angle).entities[0];
    assert.equal(doorRotationAngle(door), angle);
    const expected = reviewedLine.map(([x, y]) => {
      const dx = (x - .5) * 54, dy = (y - .5) * 54;
      return [5.5 * 54 + dx * Math.cos(angle) - dy * Math.sin(angle),
        5.5 * 54 + dx * Math.sin(angle) + dy * Math.cos(angle)];
    });
    assert.deepEqual(doorLightSegments(door), [expected]);
    assert.deepEqual(doorLightSegments({ ...door, doorState: 'open' }), []);
  }
});

test('either side of an interior door illuminates without room/hall direction metadata', () => {
  for (const orientation of ['horizontal', 'vertical']) for (const side of [-1, 1]) {
    const state = scene(orientation, side);
    recomputeVisibility(state);
    const label = orientation === 'horizontal' ? side < 0 ? 'top' : 'bottom' : side < 0 ? 'left' : 'right';
    assert.equal(state.visibility.visibleNow.has('5,5'), true, `${orientation}/${label}`);
    assert.deepEqual([...state.visibility.closedDoorVisibleSides.get('internal')], [label]);
    const polygon = computeLightPolygon(state, { ...state.player, radius: 4 });
    const near = orientation === 'horizontal' ? [5.5, 5.5 + side * .25] : [5.5 + side * .25, 5.5];
    const far = orientation === 'horizontal' ? [5.5, 5.5 - side * .25] : [5.5 - side * .25, 5.5];
    assert.equal(isPointInPolygon(near.map(v => v * 54), polygon), true);
    assert.equal(isPointInPolygon(far.map(v => v * 54), polygon), false);
    assert.equal(state.visibility.visibleNow.has(orientation === 'horizontal' ? `5,${5 - side}` : `${5 - side},5`), false);
    state.entities[0].doorState = 'open';
    recomputeVisibility(state);
    assert.equal(state.visibility.visibleNow.has(orientation === 'horizontal' ? `5,${5 - side}` : `${5 - side},5`), true);
  }
});

test('a door can have both sides lit, and explored sides survive a save/load without becoming current light', () => {
  const state = scene('vertical');
  state.entities.push({ id: 'dropped', type: 'treasure', subtype: 'dropped-equipment', x: 6, y: 5,
    lightRadius: 4, lightSource: 'torch', torchLit: true, lit: true });
  recomputeVisibility(state);
  assert.deepEqual(new Set(state.visibility.closedDoorVisibleSides.get('internal')), new Set(['left', 'right']));
  const restored = hydrateDungeonState(serializeDungeonState(state));
  restored.player.torchLit = false;
  restored.entities.pop();
  recomputeVisibility(restored);
  assert.equal(restored.visibility.closedDoorVisibleSides.size, 0);
  assert.deepEqual(new Set(restored.visibility.closedDoorExploredSides.get('internal')), new Set(['left', 'right']));
});

test('closing an explored open door preserves the far-side exploration across save/load', () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const state = scene(orientation);
    state.entities[0].doorState = 'open';
    recomputeVisibility(state);
    const far = orientation === 'horizontal' ? [5.5, 5.75] : [5.75, 5.5];
    const wasLit = polygon => isPointInPolygon(far.map(value => value * 54), polygon);
    assert.equal(state.visibility.exploredLightPolygons.some(wasLit), true);
    state.entities[0].doorState = 'closed';
    recomputeVisibility(state);
    assert.equal(state.visibility.exploredLightPolygonsBeforeNow.some(wasLit), true);
    assert.equal(wasLit(computeLightPolygon(state, { ...state.player, radius: 4 })), false);

    const saved = serializeDungeonState(state);
    assert.equal(saved.visibility.lightGeometryVersion, state.visibility.lightGeometryVersion);
    const restored = hydrateDungeonState(saved);
    recomputeVisibility(restored);
    assert.equal(restored.visibility.exploredLightPolygonsBeforeNow.some(wasLit), true);
    assert.equal(wasLit(computeLightPolygon(restored, { ...restored.player, radius: 4 })), false);
  }
});

test('loading obsolete lighting still discards stale exploration polygons', () => {
  const state = scene('horizontal');
  state.entities[0].doorState = 'open';
  recomputeVisibility(state);
  const saved = serializeDungeonState(state);
  saved.visibility.lightGeometryVersion -= 1;
  saved.entities[0].doorState = 'closed';
  const restored = hydrateDungeonState(saved);
  recomputeVisibility(restored);
  assert.equal(restored.visibility.exploredLightPolygonsBeforeNow.length, 0);
  assert.equal(restored.visibility.exploredLightPolygons.some(polygon =>
    isPointInPolygon([5.5 * 54, 5.75 * 54], polygon)), false);
});

test('door fog never clears a rectangular half tile over the reviewed shadow polygon', () => {
  const state = scene('vertical');
  recomputeVisibility(state);
  const rectangles = [], stack = [];
  const context = { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '' };
  context.save = () => stack.push({ globalCompositeOperation: context.globalCompositeOperation,
    globalAlpha: context.globalAlpha, fillStyle: context.fillStyle });
  context.restore = () => Object.assign(context, stack.pop());
  context.fillRect = (...args) => rectangles.push({ args, op: context.globalCompositeOperation });
  const proxy = new Proxy(context, { get: (target, name) => name in target ? target[name] : () => {} });
  renderDungeon(state, { fogCtx: proxy }, { motionOnly: true });
  assert.equal(rectangles.some(({ args, op }) => op === 'destination-out' &&
    args[0] >= 5 * 54 && args[0] < 6 * 54 && args[1] >= 5 * 54 && args[1] < 6 * 54), false);
});

test('partial door exports replace matching rules without discarding secret doors', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'sd-door-rules-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'export.json'), output = join(directory, 'rules.mjs');
  const secret = DOOR_LIGHT_RULES['door-secret-1'];
  writeFileSync(output, `export const DOOR_LIGHT_RULES=${JSON.stringify({ 'door-secret-1': secret, 'door-open': { paths: ['old'] } })};`);
  writeFileSync(input, JSON.stringify({ placements: [{ asset: 'door-open.png', w: 1, h: 1, annotations: {},
    shadowPaths: [{ points: [[0, 0], [1, 1]] }] }], shadowRules: { 'door-open.png': { paths: [] } } }));
  execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/build_door_rules.mjs', import.meta.url)), input, output, '--merge']);
  const { DOOR_LIGHT_RULES: compiled } = await import(pathToFileURL(output).href);
  assert.deepEqual(compiled['door-secret-1'], secret);
  assert.deepEqual(compiled['door-open'], { w: 1, h: 1, paths: [], edges: [] });
  assert.match(readFileSync(output, 'utf8'), /newer matching assets/);
});
