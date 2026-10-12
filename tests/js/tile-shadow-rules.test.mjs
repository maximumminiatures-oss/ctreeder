import test from 'node:test';
import assert from 'node:assert/strict';
import { blankScene, createPlacement, transformPoint, addShadowPath, shadowPaths,
  validateScene, exportScene, lightSegments, canMoveToken, CELL, dimensions } from '../../tools/tile-debugger/model.mjs';
import { mergeShadowPaths, sameShadowTrace, setAssetShadowPaths, applyAssetShadowRule,
  applyShadowRules } from '../../tools/tile-debugger/shadow-paths.mjs';
import { buildPlacementGapPages } from '../../tools/tile-debugger/review-study.mjs';
import { buildLightingReviewPages } from '../../tools/tile-debugger/review-study.mjs';
import { applyOrganicLightingRules } from '../../tools/tile-debugger/lighting-rules.mjs';
import { STUDY_TRANSFORMS } from '../../tools/tile-debugger/study.mjs';

const art = (id = 'org-hall-test.png', w = 3, h = 2) => ({ id, name: id, w, h,
  digest: id, pixelWidth: w * CELL, pixelHeight: h * CELL });
const path = (id, points) => ({ id, points });

test('repeated shadow traces retain the fewest points without discarding separate interior lines', () => {
  const detailed = path('detailed', [[0,0],[.5,0],[1,0],[1,1],[0,1],[0,0]]);
  const simple = path('simple', [[0,0],[1,0],[1,1],[0,1],[0,0]]);
  const interior = path('inside', [[.2,.4],[.8,.4]]);
  assert.equal(sameShadowTrace(detailed, simple), true);
  assert.equal(sameShadowTrace(simple, interior), false);
  assert.deepEqual(mergeShadowPaths([detailed, interior, simple, detailed]), [simple, interior]);
  assert.deepEqual(mergeShadowPaths([detailed, interior, simple], { single: true }), [interior]);
  const reversed = path('reverse', [[1,1],[.5,.5],[0,0]]);
  const diagonal = path('diagonal', [[0,0],[1,1]]);
  assert.deepEqual(mergeShadowPaths([reversed, diagonal]), [diagonal]);
  assert.equal(sameShadowTrace(diagonal, path('nearby', [[0,.2],[1,1.2]])), false);
});

test('artist corrections override inferred traces even when the artist uses more points', () => {
  const guess = { ...path('guess',[[0,0],[1,1]]), source:'inferred' };
  const artist = { ...path('artist',[[0,0],[.5,.5],[1,1]]), source:'artist' };
  assert.deepEqual(mergeShadowPaths([guess,artist,guess]),[artist]);
  const asset=art(),scene=blankScene(),tile=createPlacement(asset,3,3);scene.placements.push(tile);
  const learned={ [asset.id]:{digest:asset.digest,w:asset.w,h:asset.h,source:'inferred',revision:'v1',paths:[guess]} };
  applyShadowRules(scene,[asset],learned);
  assert.equal(tile.shadowSource,'inferred');
  const output=exportScene(scene,[asset]),restored=validateScene(output,[asset]);
  assert.equal(restored.shadowRules[asset.id].source,'inferred');
  assert.equal(restored.placements[0].shadowPaths[0].source,'inferred');
  applyShadowRules(restored,[asset],{[asset.id]:{...learned[asset.id],source:'artist',paths:[artist]}});
  assert.equal(restored.placements[0].shadowPaths[0].id,'artist');
  assert.equal(restored.placements[0].shadowSource,'artist');
});

test('full-black light profiles clear partial edge and vertex defaults without changing movement or manual edits', () => {
  const asset=art('org-blocks-NWoNEoSEoSWoNoEoSoWo.png',1,1),scene=blankScene();
  const tile=createPlacement(asset,9,8);scene.placements.push(tile);
  const movement=Object.fromEntries(Object.entries(tile.annotations).map(([key,value])=>[key,value.movement]));
  tile.annotations['v:0:0'].editedLight=true;tile.annotations['v:0:0'].light=false;
  const profiles={[asset.id]:{digest:asset.digest,w:1,h:1,lightEdges:['h:0:0','v:0:0'],explicitLight:{}}};
  applyOrganicLightingRules(scene,[asset],profiles);
  assert.equal(tile.movement,true);
  for(const [key,rule]of Object.entries(tile.annotations)){
    assert.equal(rule.movement,movement[key]);assert.equal(rule.light,key==='h:0:0');
  }
  addShadowPath(scene,[[9.2,8.2],[9.2,8.8]],tile,'pen');
  assert.equal(lightSegments(scene).length,6,'four bounds, pen line and the measured full-black edge');
  assert.equal(validateScene(exportScene(scene,[asset]),[asset]).placements[0].annotations['h:0:0'].profileLight,true);
  const changed=structuredClone(tile);changed.digest='other';scene.placements=[changed];
  const before=structuredClone(changed);
  assert.equal(applyOrganicLightingRules(scene,[asset],profiles),0);assert.deepEqual(changed,before);
});

test('deleting part of a draft stays authoritative across reload and later draft revisions', () => {
  const asset=art(),scene=blankScene(),tile=createPlacement(asset,3,3);scene.placements.push(tile);
  const paths=[{...path('left',[[.2,.1],[.2,1.8]]),source:'inferred'},
    {...path('right',[[2.8,.1],[2.8,1.8]]),source:'inferred'}];
  const defaults={[asset.id]:{digest:asset.digest,w:asset.w,h:asset.h,source:'inferred',revision:'v1',paths}};
  applyShadowRules(scene,[asset],defaults);
  setAssetShadowPaths(scene,tile,[paths[0]]);
  assert.equal(scene.shadowRules[asset.id].edited,true);
  assert.equal(scene.shadowRules[asset.id].source,'inferred','authorship is not promoted by deletion');
  const restored=validateScene(exportScene(scene,[asset]),[asset]);
  applyShadowRules(restored,[asset],{[asset.id]:{...defaults[asset.id],revision:'v2'}});
  assert.deepEqual(restored.placements[0].shadowPaths,[paths[0]]);
  delete restored.shadowRules[asset.id].edited;
  delete restored.shadowRules[asset.id].revision;
  applyShadowRules(restored,[asset],defaults);
  assert.deepEqual(restored.placements[0].shadowPaths,[paths[0]],'legacy deletion without a revision is also protected');
});

test('lighting review pages use only lighting uncertainties and native poses with blank clearance', () => {
  const pending=art('org-detail.png',1,1),known=art('org-known.png',1,1),macro=art('org-hall-detail.png',3,2);
  const profiles=Object.fromEntries([pending,known,macro].map(asset=>[asset.id,{digest:asset.digest,
    reviewReasons:asset===known?[]:['draft']} ]));
  const review=buildLightingReviewPages([pending,known,macro],profiles,'lighting-test');
  assert.deepEqual(new Set(review.lightingAssets),new Set([pending.id,macro.id]));
  assert.equal(review.pages.flatMap(page=>page.placements).length,2);
  assert.ok(review.pages.every(page=>page.name.startsWith('lighting')));
  assert.ok(review.pages.flatMap(page=>page.placements).every(tile=>tile.turn===0&&!tile.flipX&&!tile.flipY));
});

test('completed placement and lighting evidence creates no repetitive review pages', () => {
  const asset=art('org-complete.png',1,1);
  const profiles={[asset.id]:{digest:asset.digest,reviewReasons:[],reviewed:true}};
  assert.deepEqual(buildLightingReviewPages([asset],profiles,'complete').pages,[]);
  assert.deepEqual(buildPlacementGapPages([asset],profiles,'complete').pages,[]);
});

test('one tile shadow definition follows all matching copies and newly placed copies in native coordinates', () => {
  const asset = art(), scene = blankScene(), native = [[-.05,.2],[1.5,.2],[3.08,1.9]];
  scene.placements = STUDY_TRANSFORMS.map((pose, i) => Object.assign(createPlacement(asset, 3 + i * 3, 4, `tile-${i}`), pose));
  const owner = scene.placements[3];
  addShadowPath(scene, native.map(point => transformPoint(owner, point)), owner, 'shared');
  assert.deepEqual(scene.shadowRules[asset.id].paths[0].points, native);
  for (const tile of scene.placements) assert.deepEqual(tile.shadowPaths[0].points, native);
  for (const tile of scene.placements) {
    const world = shadowPaths(scene).find(trace => trace.tileId === tile.id).points;
    assert.deepEqual(world, native.map(point => transformPoint(tile, point)));
  }
  const fresh = createPlacement(asset, 3, 9, 'fresh');
  assert.equal(applyAssetShadowRule(scene, fresh), true);
  assert.deepEqual(fresh.shadowPaths, owner.shadowPaths);
  fresh.shadowPaths[0].points[0][0] = 99;
  assert.equal(owner.shadowPaths[0].points[0][0], -.05, 'copies do not share mutable arrays');
  const restored = validateScene(exportScene(scene, [asset]), [asset]);
  assert.deepEqual(restored.shadowRules[asset.id], scene.shadowRules[asset.id]);
  assert.deepEqual(restored.placements[3].shadowPaths, owner.shadowPaths);
});

test('canonical empty rules survive reopening and do not resurrect inherited shadows', () => {
  const asset = art(), scene = blankScene(), tile = createPlacement(asset, 3, 3);
  scene.placements.push(tile);
  const learned = { [asset.id]: { digest: asset.digest, w: 3, h: 2,
    paths: [path('learned', [[0,0],[1,1]])] } };
  assert.equal(applyShadowRules(scene, [asset], learned), 1);
  setAssetShadowPaths(scene, tile, []);
  const restored = validateScene(exportScene(scene, [asset]), [asset]);
  applyShadowRules(restored, [asset], learned);
  assert.deepEqual(restored.shadowRules[asset.id].paths, []);
  assert.deepEqual(restored.placements[0].shadowPaths, []);
  assert.equal(applyAssetShadowRule(restored, createPlacement({ ...asset, digest: 'changed' }, 6, 6)), false);
  assert.equal(applyAssetShadowRule(restored, createPlacement({ ...asset, w: 4 }, 6, 6)), false);
  const changed = blankScene(); changed.placements.push(createPlacement({ ...asset, digest: 'changed' }, 3, 3));
  applyShadowRules(changed, [{ ...asset, digest: 'changed' }], learned);
  assert.equal(changed.shadowRules[asset.id], undefined);
  tile.shadowPaths = [path('stale-art', [[0,0],[1,1]])];
  const changedAsset = { ...asset, digest: 'changed' };
  const reopened = validateScene(exportScene(scene, [asset]), [changedAsset]);
  applyShadowRules(reopened, [changedAsset], learned);
  assert.equal(reopened.placements[0].shadowPaths, undefined, 'old artwork paths cannot acquire a new digest during validation');
});

test('legacy duplicate tile definitions simplify once and digest or dimension mismatches stay isolated', () => {
  const asset = art(), scene = blankScene();
  const first = createPlacement(asset, 3, 3), second = createPlacement(asset, 8, 3);
  first.shadowPaths = [path('complex', [[0,0],[.5,.5],[1,1]])];
  second.shadowPaths = [path('simple', [[0,0],[1,1]])];
  scene.placements.push(first, second);
  applyShadowRules(scene, [asset]);
  assert.equal(first.shadowPaths[0].id, 'simple');
  assert.deepEqual(first.shadowPaths, second.shadowPaths);
  const other = createPlacement({ ...asset, digest: 'other' }, 12, 3);
  scene.placements.push(other);
  setAssetShadowPaths(scene, first, [path('new', [[0,.5],[1,.5]])]);
  assert.equal(other.shadowPaths, undefined);
});

test('custom pen geometry replaces coarse default lighting but preserves explicit light and movement rules', () => {
  const asset = art('org-blocks-NWoNEoSEoSWoNoEoSoWo.png', 1, 1), scene = blankScene();
  const tile = createPlacement(asset, 9, 8); scene.placements.push(tile);
  tile.lightShape = 'pillar';
  addShadowPath(scene, [[9.3,8.2],[9.3,8.8]], tile, 'pen');
  assert.equal(lightSegments(scene).length, 5, 'four map bounds plus the precise pen line');
  tile.annotations['h:0:0'].light = true;
  tile.annotations['h:0:0'].editedLight = true;
  assert.equal(lightSegments(scene).length, 6, 'explicit edge remains authoritative');
  assert.equal(canMoveToken(scene, 1, 0), false);
  const black = art('1-black.png', 1, 1), locked = blankScene();
  const wall = createPlacement(black, 9, 8); locked.placements.push(wall);
  addShadowPath(locked, [[9.3,8.2],[9.3,8.8]], wall, 'pen');
  assert.equal(lightSegments(locked).length, 9, 'locked black tile still blocks on all four sides');
});

test('fresh placement studies include all unknown art variants and all eight poses, omitting demonstrated placements', () => {
  const known = art('org-known.png', 1, 1), unknown = [art('org-free-a.png', 1, 1), art('org-free-a2.png', 1, 1), art('org-hall-b.png', 2, 3)];
  const { pages, unknownAssets } = buildPlacementGapPages([known, ...unknown, art('junk.png')],
    { [known.id]: { digest: known.digest } }, 'gaps-test');
  assert.deepEqual(new Set(unknownAssets), new Set(unknown.map(asset => asset.id)));
  const centers = pages.flatMap(page => page.placements);
  assert.equal(centers.length, 24);
  for (const asset of unknown) {
    const poses = centers.filter(tile => tile.asset === asset.id).map(tile => `${tile.turn}:${tile.flipX}`);
    assert.deepEqual(new Set(poses), new Set(STUDY_TRANSFORMS.map(pose => `${pose.turn}:${pose.flipX}`)));
  }
  for (const page of pages) for (const [i, tile] of page.placements.entries()) {
    const [w,h] = dimensions(tile);
    assert.ok(tile.x >= 2 && tile.y >= 2 && tile.x + w <= page.width - 2 && tile.y + h <= page.height - 2);
    for (const other of page.placements.slice(i + 1)) {
      const [ow,oh] = dimensions(other);
      assert.ok(tile.x + w + 4 <= other.x || other.x + ow + 4 <= tile.x || tile.y + h + 4 <= other.y || other.y + oh + 4 <= tile.y);
    }
  }
  const scene = blankScene();
  const output = exportScene(scene, [known, ...unknown], { [known.id]: { digest: known.digest } });
  assert.ok(!output.needsPlacementConfirmation.includes(known.id));
  assert.ok(output.needsConfirmation.includes(known.id), 'placement confidence does not imply lighting confidence');
  scene.reviewed[unknown[0].id] = unknown[0].digest;
  assert.ok(exportScene(scene, unknown).needsPlacementConfirmation.includes(unknown[0].id),
    'known lighting does not imply placement confidence');
  scene.placementReviewed[unknown[0].id] = unknown[0].digest;
  const restored = validateScene(exportScene(scene, unknown), unknown);
  assert.ok(!exportScene(restored, unknown).needsPlacementConfirmation.includes(unknown[0].id));
});
