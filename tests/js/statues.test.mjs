import test from 'node:test';
import assert from 'node:assert/strict';
import { blankScene, createPlacement, validateScene, canMoveToken, lightSegments } from '../../tools/tile-debugger/model.mjs';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { applyReviewedLayout, poseLayout } from '../../S3_content/src/reviewed-layouts.js';
import { canMoveBetweenTiles } from '../../S3_content/src/interactions.js';
import { hasLineOfSightFrom, recomputeVisibility } from '../../S3_content/src/visibility.js';
import { computeLightPolygon, isPointInPolygon } from '../../S3_content/src/light-geometry.js';
import { reviewedTileLightSegments, STATUE_ASSET_KEYS } from '../../S3_content/src/reviewed-tile-rules.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { SeededRng } from '../../S3_content/src/rng.js';

const directions = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const asset = name => ({ id: name + '.png', name: name + '.png', w: 1, h: 1, digest: name });

test('every statue orientation blocks movement and uses the same small central shadow as a pillar in the workbench', () => {
  for (const name of STATUE_ASSET_KEYS) for (let turn = 0; turn < 4; turn++) for (const flipX of [false, true]) {
    const item = asset(name), scene = blankScene(), tile = createPlacement(item, 5, 5);
    Object.assign(tile, { turn, flipX }); scene.placements = [tile];
    assert.equal(tile.movement, true); assert.equal(tile.lightShape, 'pillar');
    for (const [dx, dy] of directions) { Object.assign(scene.token, { x: 5 + dx, y: 5 + dy }); assert.equal(canMoveToken(scene, -dx, -dy), false); }
    const shadows = lightSegments(scene).slice(4);
    assert.equal(shadows.length, 4);
    const runtime = reviewedTileLightSegments(name, { ...tile }).map(segment => segment.map(point => point.map(value => value * 54)));
    const canonical = lines => lines.map(line => line.map(point => point.map(n => Math.round(n * 1e6) / 1e6)).sort().join(';')).sort();
    assert.deepEqual(canonical(runtime), canonical(shadows));
    tile.movement = false; tile.lightShape = 'edges';
    const restored = validateScene(scene, [item]);
    assert.equal(restored.placements[0].movement, true); assert.equal(restored.placements[0].lightShape, 'pillar');
  }
});

test('generated and saved statues block all approaches and direct light, without making the whole tile opaque', () => {
  for (const name of STATUE_ASSET_KEYS) for (let turn = 0; turn < 4; turn++) {
    const state = createEmptyDungeonState(1); state.map = { width: 9, height: 9 };
    state.tiles = Array.from({ length: 81 }, (_, i) => ({ x: i % 9, y: Math.floor(i / 9), type: 'floor', meta: {} }));
    const source = { id: 'statue-room', width: 5, height: 5, floor: Array.from({ length: 25 }, (_, i) => [i % 5, Math.floor(i / 5)]),
      ports: [['west', 0, 2], ['east', 4, 2]], doors: [], placements: [{ asset: name + '.png', x: 2, y: 2, w: 1, h: 1,
        turn: 0, flipX: false, flipY: false, movement: false, lightShape: 'edges', annotations: {} }] };
    applyReviewedLayout(state, poseLayout(source, turn), 2, 2, 'room', null, new SeededRng(1));
    assert.equal(state.tiles[4 * 9 + 4].meta.layoutBlocks, true);
    const loaded = hydrateDungeonState(serializeDungeonState(state));
    loaded.decor.reviewedLight = []; loaded.decor.reviewedMovement = []; delete loaded.tiles[4 * 9 + 4].meta.layoutBlocks;
    for (const current of [state, loaded]) {
      for (const [dx, dy] of directions) assert.equal(canMoveBetweenTiles(current, 4 + dx, 4 + dy, 4, 4).ok, false);
      assert.equal(canMoveBetweenTiles(current, 4, 4, 4, 4).ok, false);
      assert.equal(hasLineOfSightFrom(current, 2, 4, 6, 4), false);
      const polygon = computeLightPolygon(current, { x: 2, y: 4, radius: 6 });
      assert.equal(isPointInPolygon([6.5 * 54, 4.5 * 54], polygon), false);
      assert.equal(isPointInPolygon([4.5 * 54, 4.1 * 54], polygon), true);
      assert.equal(canMoveBetweenTiles(current, 2, 2, 3, 2).ok, true);
    }
  }
});
