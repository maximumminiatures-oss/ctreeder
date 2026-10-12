import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL, blankScene, createPlacement, sortAssets, transformPoint, features,
  dimensions, canMoveToken, lightPolygon, lightSegments, toggleRules, exportScene, validateScene,
  brushCells, applyBrush, applyLearnedRules, applyLearnedFeatures,
  addShadowPath, shadowPaths, inverseTransformPoint } from '../../tools/tile-debugger/model.mjs';
import { LEARNED_TILE_RULES, LEARNED_FEATURE_RULES } from '../../tools/tile-debugger/learned-rules.mjs';
import { buildTileStudy, STUDY_TRANSFORMS } from '../../tools/tile-debugger/study.mjs';
import { isPointInPolygon, computeLightPolygonFromSegments } from '../../S3_content/src/light-geometry.js';

const asset = (id, w = 1, h = 1) => ({ id, name: id, w, h, digest: id, pixelWidth: w * CELL, pixelHeight: h * CELL });
const black = asset('1-black.png');
const rock = asset('org-blocks-NWxNExSExSWxNxExSxWx.png');
const floor = asset('org-free-NWxNExSExSWxNxExSxWx.png');

test('off-grid open shadow paths block light but never movement', () => {
  const scene = blankScene(); scene.token = { x: 3, y: 4, torch: true, radius: 6 };
  assert.equal(addShadowPath(scene, [[5.2,2.1]]), null);
  const path = addShadowPath(scene, [[5.2,2.1],[5.2,2.1],[5.2,7.8],[6.6,8.2]], null, 'pen');
  assert.equal(path.points.length, 3);
  assert.equal(lightSegments(scene).length, 6, 'two segments, not a closed shape');
  const polygon = lightPolygon(scene);
  assert.equal(isPointInPolygon([4.5*CELL,4.5*CELL],polygon), true);
  assert.equal(isPointInPolygon([6.5*CELL,4.5*CELL],polygon), false);
  scene.token.x=4;
  assert.equal(canMoveToken(scene,1,0), true);
  assert.deepEqual(validateScene(exportScene(scene,[]),[]).shadowPaths, scene.shadowPaths);
});

test('tile-attached shadow paths follow every flip and rotation and persist', () => {
  const art = asset('wall-detail.png', 3, 2), native = [[.3,.2],[1.7,.65],[2.4,1.8]];
  for (let turn=0;turn<4;turn++) for(const flipX of [false,true]) for(const flipY of [false,true]) {
    const scene=blankScene(), tile=createPlacement(art,5,6,'wall');
    Object.assign(tile,{turn,flipX,flipY}); scene.placements.push(tile);
    const world=native.map(point=>transformPoint(tile,point));
    for(let i=0;i<native.length;i++) assert.ok(inverseTransformPoint(tile,world[i]).every((v,a)=>Math.abs(v-native[i][a])<1e-10));
    addShadowPath(scene,world,tile,'wall-shadow');
    assert.ok(shadowPaths(scene)[0].points.every((p,i)=>p.every((v,a)=>Math.abs(v-world[i][a])<1e-10)));
    const restored=validateScene(exportScene(scene,[art]),[art]);
    assert.deepEqual(restored.placements[0].shadowPaths,tile.shadowPaths);
    tile.x++;
    assert.equal(shadowPaths(scene)[0].points[0][0],world[0][0]+1);
  }
});

test('shadow path validation rejects malformed and out-of-bounds data', () => {
  for(const points of [[[1,1]],[[1,1],[NaN,2]],[[1,1],[33,2]]]) {
    const scene=blankScene();scene.shadowPaths=[{id:'bad',points}];
    assert.throws(()=>validateScene(scene,[]),/Invalid shadow/);
  }
  const scene=blankScene();scene.shadowPaths=[{id:'same',points:[[1,1],[2,2]]},{id:'same',points:[[2,2],[3,3]]}];
  assert.throws(()=>validateScene(scene,[]),/Duplicate shadow/);
});

test('studies prioritize every unknown organic/crypt art variant and omit other assets', () => {
  const id = 'org-free-NWoNEoSEoSWoNxEoSxWo.png';
  const known = { ...asset(id), digest: LEARNED_TILE_RULES[id].digest };
  const variants = Array.from({ length: 40 }, (_, i) => asset(`org-free-NWxNExSExSWxNxExSxWx${i}.png`));
  const macro = asset('org-hall-example.png', 4, 3), crypt = asset('crypt 1.png', 1, 2);
  const study = buildTileStudy([known, black, asset('junk.png'), ...variants, macro, crypt], LEARNED_TILE_RULES, 'test-study');
  const firstPass = study.pages.filter(page => page.name.startsWith('All variants'));
  assert.deepEqual(new Set(firstPass.flatMap(page => page.placements.map(tile => tile.asset))), new Set(study.unknownAssets));
  assert.equal(firstPass.reduce((n, page) => n + page.placements.length, 0), 42);
  assert.ok(!study.unknownAssets.includes(known.id) && !study.unknownAssets.includes(black.id));
  assert.equal(study.pages.slice(firstPass.length).flatMap(page => page.placements).filter(tile => tile.asset === macro.id).length, 8);
  assert.equal(STUDY_TRANSFORMS.length, 8);
});

test('study placements leave two blank grid cells on every side in every orientation', () => {
  const list = Array.from({ length: 35 }, (_, i) => asset(`org-hall-example-${i}.png`, i % 4 + 1, i % 3 + 1));
  const study = buildTileStudy(list, {}, 'clearance-study');
  for (const page of study.pages) {
    for (const [index, tile] of page.placements.entries()) {
      const [w, h] = dimensions(tile);
      assert.ok(tile.x >= 2 && tile.y >= 2 && tile.x + w <= page.width - 2 && tile.y + h <= page.height - 2);
      for (const other of page.placements.slice(index + 1)) {
        const [ow, oh] = dimensions(other);
        assert.ok(tile.x + w + 4 <= other.x || other.x + ow + 4 <= tile.x ||
          tile.y + h + 4 <= other.y || other.y + oh + 4 <= tile.y);
      }
    }
    assert.deepEqual(validateScene(page, list).study, page.study);
  }
});

test('crypt assets remain pending independently of unrelated decorative assets', () => {
  assert.deepEqual(exportScene(blankScene(), [asset('crypt 3.png', 1, 2), asset('junk.png')]).needsConfirmation, ['crypt 3.png']);
});

test('learned assets lose pending dots without changing placed geometry', () => {
  const id = 'org-free-NWoNEoSEoSWoNxEoSxWo.png';
  const known = { ...asset(id), digest: LEARNED_TILE_RULES[id].digest };
  const scene = blankScene(), tile = createPlacement(known, 3, 4);
  tile.turn = 1; tile.flipX = true; scene.placements.push(tile);
  const geometry = structuredClone(tile);
  assert.equal(applyLearnedRules(scene, [known], LEARNED_TILE_RULES), 1);
  assert.deepEqual(tile, { ...geometry, confirmed: true });
  assert.deepEqual(exportScene(scene, [known]).needsConfirmation, []);
  assert.equal(applyLearnedRules(scene, [known], LEARNED_TILE_RULES), 0);
  const fresh = blankScene();
  assert.equal(applyLearnedRules(fresh, [known], LEARNED_TILE_RULES), 1);
  assert.equal(fresh.assetRules[id].annotations['v:0:0'].light, true);
});

test('changed artwork and conflicting annotations keep learned assets pending', () => {
  const id = 'org-free-NWoNEoSEoSWoNxEoSxWo.png';
  const changedArt = asset(id);
  assert.equal(applyLearnedRules(blankScene(), [changedArt], LEARNED_TILE_RULES), 0);
  const known = { ...changedArt, digest: LEARNED_TILE_RULES[id].digest };
  const scene = blankScene(), tile = createPlacement(known, 3, 4);
  tile.annotations['v:0:0'].light = false; scene.placements.push(tile);
  assert.equal(applyLearnedRules(scene, [known], LEARNED_TILE_RULES), 0);
  assert.deepEqual(exportScene(scene, [known]).needsConfirmation, [id]);
  assert.equal(tile.annotations['v:0:0'].light, false);
});

test('explicitly revoked learned confirmations survive export and reload', () => {
  const id = 'org-blocks-NWxNExSExSWxNxExSxWx.png';
  const known = { ...asset(id), digest: LEARNED_TILE_RULES[id].digest };
  const scene = blankScene(); scene.unreviewed[id] = known.digest;
  const reloaded = validateScene(exportScene(scene, [known]), [known]);
  assert.equal(applyLearnedRules(reloaded, [known], LEARNED_TILE_RULES), 0);
  assert.deepEqual(exportScene(reloaded, [known]).needsConfirmation, [id]);
});

test('workbench asset order matches the requested common/organic/size groups', () => {
  const big = asset('org-hall-3x3.png', 3, 3), small = asset('org-hall-2x2.png', 2, 2);
  const list = sortAssets([asset('z-other.png'), big, asset('large-other.png', 5, 5), small, floor, black, asset('door-closed.png')]);
  assert.deepEqual(list.map(a => a.id), [black.id, 'door-closed.png', floor.id, big.id, small.id, 'large-other.png', 'z-other.png']);
});

const macroId = Object.keys(LEARNED_FEATURE_RULES)[0], macroRules = LEARNED_FEATURE_RULES[macroId];
const learnedMacro = { ...asset(macroId, 3, 7), digest: macroRules.digest };

test('partial macro evidence inherits only annotated properties without confirming the asset', () => {
  const tile = createPlacement(learnedMacro, 6, 6), before = structuredClone(tile);
  assert.equal(applyLearnedFeatures(tile, learnedMacro, LEARNED_FEATURE_RULES), 55);
  assert.equal(Object.values(tile.annotations).filter(rule => rule.movement).length, 30);
  assert.equal(Object.values(tile.annotations).filter(rule => rule.light).length, 25);
  for (const [key, rule] of Object.entries(tile.annotations)) {
    assert.equal(rule.movement, macroRules.movement[key] ?? before.annotations[key].movement);
    assert.equal(rule.light, macroRules.light[key] ?? before.annotations[key].light);
    assert.equal(rule.editedMovement, false);
    assert.equal(rule.editedLight, false);
  }
  assert.equal(tile.confirmed, false);
  const scene = blankScene(); scene.placements.push(tile);
  assert.equal(applyLearnedRules(scene, [learnedMacro], {}, LEARNED_FEATURE_RULES), 0);
  assert.deepEqual(exportScene(scene, [learnedMacro]).needsConfirmation, [macroId]);
  assert.deepEqual(validateScene(exportScene(scene, [learnedMacro]), [learnedMacro]).placements[0], tile);
});

test('macro inheritance preserves manual edits, unrelated rules, and explicitly confirmed templates', () => {
  const scene = blankScene(), tile = createPlacement(learnedMacro, 6, 6);
  tile.annotations['v:2:0'].editedLight = true;
  tile.annotations['h:1:0'].editedMovement = true;
  tile.annotations['v:1:0'].light = true;
  scene.placements.push(tile);
  applyLearnedRules(scene, [learnedMacro], {}, LEARNED_FEATURE_RULES);
  assert.equal(tile.annotations['v:2:0'].light, false);
  assert.equal(tile.annotations['v:2:0'].movement, true);
  assert.equal(tile.annotations['h:1:0'].movement, false);
  assert.equal(tile.annotations['h:1:0'].light, true);
  assert.equal(tile.annotations['v:1:0'].light, true);
  const restored = validateScene(exportScene(scene, [learnedMacro]), [learnedMacro]);
  applyLearnedRules(restored, [learnedMacro], {}, LEARNED_FEATURE_RULES);
  assert.deepEqual(restored.placements[0], tile);
  const confirmed = blankScene(); confirmed.reviewed[macroId] = learnedMacro.digest;
  confirmed.placements.push(createPlacement(learnedMacro, 6, 6));
  assert.equal(applyLearnedRules(confirmed, [learnedMacro], {}, LEARNED_FEATURE_RULES), 0);
});

test('partial macro rules are guarded by artwork digest, dimensions, and asset identity', () => {
  for (const changed of [{ ...learnedMacro, digest: 'new-art' }, { ...learnedMacro, w: 2 },
    { ...learnedMacro, id: 'other.png', name: 'other.png' }]) {
    const tile = createPlacement(changed, 6, 6), before = structuredClone(tile);
    assert.equal(applyLearnedFeatures(tile, changed, LEARNED_FEATURE_RULES), 0);
    assert.deepEqual(tile, before);
  }
});

test('macro light and movement constraints follow all rotations and reflections independently', () => {
  for (const pose of STUDY_TRANSFORMS) {
    const scene = blankScene(), tile = createPlacement(learnedMacro, 6, 6);
    Object.assign(tile, pose); applyLearnedFeatures(tile, learnedMacro, LEARNED_FEATURE_RULES); scene.placements.push(tile);
    const lines = lightSegments(scene).slice(4);
    assert.equal(lines.length, 25);
    const normalized = line => JSON.stringify(line.map(point => point.join(',')).sort());
    const lit = new Set(lines.map(normalized));
    for (const feature of features(tile).filter(feature => feature.kind === 'edge')) {
      const points = feature.points.map(point => transformPoint(tile, point).map(value => value * CELL));
      assert.equal(lit.has(normalized(points)), macroRules.light[feature.key] === true, feature.key);
      if (!macroRules.movement[feature.key]) continue;
      const [a, b] = feature.points;
      const horizontal = a[1] === b[1];
      const from = transformPoint(tile, [(a[0] + b[0]) / 2 - (horizontal ? 0 : .5),
        (a[1] + b[1]) / 2 - (horizontal ? .5 : 0)]);
      const to = transformPoint(tile, [(a[0] + b[0]) / 2 + (horizontal ? 0 : .5),
        (a[1] + b[1]) / 2 + (horizontal ? .5 : 0)]);
      scene.token.x = from[0] - .5; scene.token.y = from[1] - .5;
      assert.equal(canMoveToken(scene, to[0] - from[0], to[1] - from[1]), false, feature.key);
    }
  }
});

test('rotating and flipping tiles transforms the same grid used by annotations', () => {
  const tile = createPlacement(asset('rectangle.png', 3, 2), 5, 8, 'test');
  tile.turn = 1; tile.flipX = true;
  assert.deepEqual(dimensions(tile), [2, 3]);
  assert.deepEqual(transformPoint(tile, [0, 0]), [7, 11]);
  assert.deepEqual(transformPoint(tile, [3, 2]), [5, 8]);
  assert.equal(features(tile).filter(f => f.kind === 'vertex').length, 12);
  assert.equal(features(tile).filter(f => f.kind === 'edge').length, 17);
});

test('solid black is locked against movement/light edits and stays locked on import', () => {
  const scene = blankScene(), tile = createPlacement(black, 9, 8);
  scene.placements.push(tile);
  assert.equal(toggleRules(tile, [], 'movement'), false);
  assert.equal(canMoveToken(scene, 1, 0), false);
  tile.movement = false; tile.lightShape = 'none'; tile.locked = false;
  const restored = validateScene(scene, [black]);
  assert.equal(restored.placements[0].movement, true);
  assert.equal(restored.placements[0].lightShape, 'solid');
  assert.equal(restored.placements[0].locked, true);
});

test('edge annotations independently block light and movement including rotated edges', () => {
  const scene = blankScene(), tile = createPlacement(floor, 9, 8);
  scene.placements.push(tile);
  toggleRules(tile, ['v:0:0'], 'movement');
  assert.equal(canMoveToken(scene, 1, 0), false);
  assert.equal(isPointInPolygon([10.5 * CELL, 8.5 * CELL], lightPolygon(scene)), true);
  toggleRules(tile, ['v:0:0'], 'light');
  assert.equal(isPointInPolygon([10.5 * CELL, 8.5 * CELL], lightPolygon(scene)), false);
  tile.turn = 1;
  assert.equal(canMoveToken(scene, 1, 0), true);
  toggleRules(tile, ['v:0:0'], 'movement');
  assert.equal(tile.annotations['v:0:0'].movement, false);
});

test('isolated blocks use pillar light but cannot be entered', () => {
  const scene = blankScene(); scene.placements.push(createPlacement(rock, 10, 8));
  assert.equal(scene.placements[0].lightShape, 'pillar');
  assert.equal(isPointInPolygon([12.5 * CELL, 8.5 * CELL], lightPolygon(scene)), false);
  assert.equal(isPointInPolygon([12.5 * CELL, 7.5 * CELL], lightPolygon(scene)), true);
  scene.token.x = 9; assert.equal(canMoveToken(scene, 1, 0), false);
});

test('vertex movement prevents diagonal crossings without closing adjacent edges', () => {
  const scene = blankScene(), tile = createPlacement(floor, 9, 9);
  scene.placements.push(tile); toggleRules(tile, ['p:0:0'], 'movement');
  assert.equal(canMoveToken(scene, 1, 1), false);
  assert.equal(canMoveToken(scene, 1, 0), true);
  assert.equal(canMoveToken(scene, 0, 1), true);
});

test('outputs retain layers, annotations and pending assets; reopen rejects unsafe geometry', () => {
  const scene = blankScene(); scene.placements.push(createPlacement(floor, 2, 2), createPlacement(rock, 2, 2));
  toggleRules(scene.placements[0], ['h:0:1'], 'movement');
  scene.reviewed[floor.id] = floor.digest;
  const out = exportScene(scene, [floor, rock]);
  assert.deepEqual(out.needsConfirmation, [rock.id]);
  const restored = validateScene(out, [floor, rock]);
  assert.equal(restored.placements[0].annotations['h:0:1'].movement, true);
  assert.equal(restored.placements[1].asset, rock.id);
  out.placements[0].x = -1;
  assert.throws(() => validateScene(out, [floor, rock]), /outside/);
});

test('black paint fills every crossed cell without redundant black layers', () => {
  const scene = blankScene();
  const cells = brushCells([2.2, 3.2], [8.9, 3.8]);
  assert.equal(cells.length, 7);
  assert.equal(applyBrush(scene, 'paint', cells, black).changes, 7);
  assert.equal(applyBrush(scene, 'paint', cells, black).changes, 0);
  assert.ok(scene.placements.every(t => t.asset === black.id && t.locked && t.movement && t.lightShape === 'solid'));
  assert.deepEqual(brushCells([4, 4], [1, 1]), [[4, 4], [3, 3], [2, 2], [1, 1]]);
});

test('erase strokes remove only the initial top layer, including multi-cell art', () => {
  const scene = blankScene();
  scene.placements.push(createPlacement(black, 2, 2), createPlacement(black, 3, 2));
  const macro = createPlacement(asset('macro.png', 2, 1), 2, 2);
  scene.placements.push(macro);
  const eraseSource = [...scene.placements], visited = new Set();
  assert.equal(applyBrush(scene, 'erase', [[2, 2], [3, 2], [2, 2]], black, { eraseSource, visited }).changes, 1);
  assert.equal(scene.placements.length, 2);
  assert.equal(applyBrush(scene, 'erase', [[2, 2], [3, 2]], black).changes, 2);
  assert.equal(scene.placements.length, 0);
});

test('a populated paint stroke is one undo transaction and skips out-of-map cells', () => {
  const scene = blankScene(); let checkpoints = 0;
  const visited = new Set();
  const result = applyBrush(scene, 'paint', [[-1, 0], [0, 0], [1, 0], [1, 0], [99, 0]], black,
    { visited, beforeChange: () => checkpoints++ });
  assert.equal(result.changes, 2);
  assert.equal(checkpoints, 1);
  assert.equal(scene.placements.length, 2);
  assert.equal(applyBrush(scene, 'paint', [[1, 0]], black, { visited }).changes, 0);
});

test('painted examples can reopen beyond the former 2000-placement output limit', () => {
  const scene = blankScene(); scene.width = scene.height = 80;
  applyBrush(scene, 'paint', Array.from({ length: 2100 }, (_, i) => [i % 80, Math.floor(i / 80)]), black);
  assert.equal(validateScene(exportScene(scene, [black]), [black]).placements.length, 2100);
});

test('light culling and shared-edge deduplication preserve visibility of a dense map', () => {
  const scene = blankScene(); scene.width = scene.height = 50;
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
    if ((x < 3 || x > 14 || y < 3 || y > 14) || (x === 11 && y > 6)) scene.placements.push(createPlacement(black, x, y));
  }
  const full = computeLightPolygonFromSegments([8.5 * CELL, 8.5 * CELL], 6.5 * CELL, lightSegments(scene));
  const culled = lightPolygon(scene);
  for (let y = 2; y < 16; y++) for (let x = 2; x < 16; x++) {
    const point = [(x + .5) * CELL, (y + .5) * CELL];
    assert.equal(isPointInPolygon(point, culled), isPointInPolygon(point, full), `${x}, ${y}`);
  }
});
