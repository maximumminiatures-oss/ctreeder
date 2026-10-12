import test from 'node:test';
import assert from 'node:assert/strict';
import { blankScene, createPlacement, transformPoint } from '../../tools/tile-debugger/model.mjs';
import { composeStudyPose, learnAdjacentTiles, buildAdjacencyDraft, adjacentGeometryKey, organicAssetFamily, studyCellGeometry } from '../../tools/tile-debugger/adjacency-draft.mjs';
import { STUDY_TRANSFORMS } from '../../tools/tile-debugger/study.mjs';
import { parseOrganicSignature, transformOrganicSignature } from '../../S3_content/src/organic-tiles.js';

const asset = name => ({ id: name, name, w: 1, h: 1, digest: name });
const centerArt = asset('org-blocks-NWoNExSExSWxNoExSxWx-test.png');
const edgeArt = asset('org-free-NWxNExSEoSWxNxExSoWx-test.png');
const cornerArt = asset('org-free-NWxNExSEoSWxNxExSxWx-test.png');
const assets = [centerArt, edgeArt, cornerArt];
const at = (art, x, y, id) => createPlacement(art, x, y, id);
const unit = pose => ({ x: 0, y: 0, w: 1, h: 1, ...pose });
const worldSignature = tile => transformOrganicSignature(parseOrganicSignature(tile.asset), tile.turn, tile.flipX, tile.flipY);

function fixture() {
  const source = blankScene(), target = blankScene();
  source.study = { id: 'original', page: 0 }; target.study = { id: 'original', page: 1 };
  source.placements.push(at(centerArt, 5, 5, 'study-source'),
    at(edgeArt, 5, 4, 'edge-example'), at(cornerArt, 4, 4, 'corner-example'));
  target.placements.push(at(centerArt, 10, 10, 'study-target'));
  return { source, target };
}

test('study pose composition preserves every rotation and reflection, including vertical flips', () => {
  const poses = [...STUDY_TRANSFORMS, ...STUDY_TRANSFORMS.map(pose => ({ ...pose, flipY: true }))];
  for (const inner of poses) for (const outer of poses) {
    const combined = composeStudyPose(inner, outer);
    for (const point of [[0, 0], [1, 0], [1, 1], [0, 1], [.2, .7]]) {
      const expected = transformPoint(unit(outer), transformPoint(unit(inner), point));
      const actual = transformPoint(unit(combined), point);
      assert.ok(actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-12));
    }
  }
});

test('observed neighbors follow clockwise rotations onto the correct edge and vertex', () => {
  const { source, target } = fixture(); target.placements[0].turn = 1;
  const { study, report } = buildAdjacencyDraft(source, target, assets, 'draft');
  const edge = study.pages[0].placements.find(tile => tile.x === 11 && tile.y === 10);
  const corner = study.pages[0].placements.find(tile => tile.x === 11 && tile.y === 9);
  assert.equal(edge.asset, edgeArt.id); assert.equal(worldSignature(edge).sides.west, 'o');
  assert.equal(corner.asset, cornerArt.id); assert.equal(worldSignature(corner).corners.sw, 'o');
  assert.equal(report.predictions.find(item => item.x === 11 && item.y === 10).method, 'observed full topology');
});

test('asymmetric observed patterns mirror their edge ends and diagonal caps', () => {
  const { source, target } = fixture(); target.placements[0].flipX = true;
  const { study, report } = buildAdjacencyDraft(source, target, assets, 'mirrored');
  const edge = study.pages[0].placements.find(tile => tile.x === 10 && tile.y === 9);
  const corner = study.pages[0].placements.find(tile => tile.x === 11 && tile.y === 9);
  assert.equal(edge.asset, edgeArt.id);
  assert.equal(worldSignature(edge).corners.se, 'x'); assert.equal(worldSignature(edge).corners.sw, 'o');
  assert.equal(corner.asset, cornerArt.id); assert.equal(worldSignature(corner).corners.sw, 'o');
  assert.equal(report.predictions.find(item => item.x === 10 && item.y === 9).method, 'mirrored observed full topology');
  assert.equal(report.predictions.find(item => item.x === 11 && item.y === 9).method, 'mirrored observed full topology');
});

test('drafts preserve artist work and keep inferred annotations tentative', () => {
  const { source, target } = fixture();
  source.placements[1].annotations['h:0:1'].editedLight = true;
  source.placements[1].confirmed = true;
  target.reviewed[centerArt.id] = centerArt.digest;
  const beforeSource = JSON.stringify(source), beforeTarget = JSON.stringify(target);
  const { study, report } = buildAdjacencyDraft(source, target, assets, 'isolated-draft');
  const scene = study.pages[0];
  assert.equal(JSON.stringify(source), beforeSource); assert.equal(JSON.stringify(target), beforeTarget);
  assert.deepEqual(scene.placements[0], target.placements[0]);
  assert.deepEqual(scene.reviewed, target.reviewed); assert.deepEqual(scene.study, { id: 'isolated-draft', page: 0 });
  assert.equal(report.tentative, true);
  for (const tile of scene.placements.slice(1)) {
    assert.equal(tile.confirmed, false);
    assert.ok(Object.values(tile.annotations).every(rule => !rule.editedLight && !rule.editedMovement));
    assert.ok(Math.abs(tile.x - 10) <= 1 && Math.abs(tile.y - 10) <= 1);
  }
});

test('existing adjacent placements are not overwritten or covered by suggestions', () => {
  const { source, target } = fixture(); target.placements.push(at(cornerArt, 10, 9, 'artist-neighbor'));
  const { study } = buildAdjacencyDraft(source, target, assets, 'preserve');
  assert.deepEqual(study.pages[0].placements.slice(0, 2), target.placements);
  assert.equal(study.pages[0].placements.filter(tile => tile.x === 10 && tile.y === 9).length, 1);
});

test('empty observed surroundings remain empty and unsupported centers are skipped', () => {
  const { source, target } = fixture(); source.placements.length = 1;
  const unknown = asset('org-legacy.png'); target.placements.push(at(unknown, 20, 20, 'study-legacy'));
  const { study, report } = buildAdjacencyDraft(source, target, [...assets, unknown], 'empty');
  assert.equal(study.pages[0].placements.length, 2); assert.equal(report.addedPlacements, 0);
  assert.equal(learnAdjacentTiles(source, assets).examples.length, 1);
});

test('hand-built room exports contribute adjacency evidence without study center IDs', () => {
  const { source } = fixture();
  source.placements[0].id = 'artist-center';
  assert.equal(learnAdjacentTiles(source, assets).examples.length, 0);
  const learned = learnAdjacentTiles(source, assets, { includeAuthoredTiles: true });
  assert.equal(learned.examples.length, 3);
  assert.ok(learned.examples.includes('artist-center'));
});

test('newer inspected examples add missing caps and override obsolete diagonal pieces', () => {
  const { source, target } = fixture(), corrected = structuredClone(source);
  source.placements = source.placements.filter(tile => tile.asset !== edgeArt.id);
  corrected.placements = corrected.placements.filter(tile => tile.asset !== cornerArt.id);
  const { study } = buildAdjacencyDraft([source, corrected], target, assets, 'corrected');
  assert.ok(study.pages[0].placements.some(tile => tile.x === 10 && tile.y === 9 && tile.asset === edgeArt.id));
  assert.ok(!study.pages[0].placements.some(tile => tile.x === 9 && tile.y === 9));
});

test('full topology preserves different diagonal rules for centers with the same local corner', () => {
  const { source, target } = fixture();
  const otherArt = asset('org-blocks-NWoNEoSExSWxNoExSxWx-test.png');
  const other = blankScene(); other.placements.push(at(otherArt, 5, 5, 'study-other'));
  const allAssets = [...assets, otherArt];
  const originalDraft = buildAdjacencyDraft([source, other], target, allAssets, 'original-shape').study.pages[0];
  assert.ok(originalDraft.placements.some(tile => tile.x === 9 && tile.y === 9));
  target.placements = [at(otherArt, 10, 10, 'study-target-other')];
  const otherDraft = buildAdjacencyDraft([source, other], target, allAssets, 'other-shape').study.pages[0];
  assert.ok(!otherDraft.placements.some(tile => tile.x === 9 && tile.y === 9));
});

test('equivalent symmetric transforms pool their votes without depending on art orientation', () => {
  const { source } = fixture(), reflected = structuredClone(source);
  Object.assign(reflected.placements[2], { turn: 3, flipX: true });
  assert.equal(adjacentGeometryKey([source.placements[2]], assets), adjacentGeometryKey([reflected.placements[2]], assets));
  const learned = learnAdjacentTiles([source, reflected], assets);
  const candidates = [...learned.fullTables.diagonal.values()].flatMap(bucket => [...bucket.options.values()]);
  assert.ok(candidates.some(option => option.layers[0]?.asset === cornerArt.id && option.count === 2));
});

test('artist-specific corner exceptions stay with their named shape family', () => {
  const { source, target } = fixture();
  const otherArt = asset('org-blocks-other-NWoNExSExSWxNoExSxWx-test.png');
  const other = structuredClone(source); other.placements[0] = at(otherArt, 5, 5, 'study-other');
  source.placements = source.placements.filter(tile => tile.asset !== cornerArt.id);
  const { study, report } = buildAdjacencyDraft([source, other], target, [...assets, otherArt], 'family-exception');
  assert.ok(!study.pages[0].placements.some(tile => tile.x === 9 && tile.y === 9));
  assert.equal(report.predictions.find(item => item.x === 9 && item.y === 9).evidenceScope, 'asset family');
});

test('numbered art variants share a shape but remain distinct current assets in the draft', () => {
  const { source, target } = fixture();
  const base = asset('org-free-test-NWxNExSEoSWxNxExSoWx.png');
  const variants = [base, asset(base.id.replace('.png', '2.png')), asset(base.id.replace('.png', '3.png'))];
  source.placements[1] = at(base, 5, 4, 'edge-example');
  target.placements = [5, 15, 25].map((x, index) => at(centerArt, x, 10, `study-target-${index}`));
  const allAssets = [...assets, ...variants];
  assert.equal(organicAssetFamily(variants[0]), organicAssetFamily(variants[2]));
  const { study } = buildAdjacencyDraft(source, target, allAssets, 'variants', { pageNumber: 3 });
  const placed = study.pages[0].placements.filter(tile => variants.some(art => art.id === tile.asset));
  assert.equal(new Set(placed.map(tile => tile.asset)).size, 3);
  assert.ok(placed.every(tile => !tile.confirmed && variants.some(art => art.id === tile.asset && art.digest === tile.digest)));
  assert.equal(study.pages[0].name, '[Draft] Page 3 adjacent tiles');
});

function macroFixture() {
  const art = { ...asset('org-hall-test.png'), w: 2 };
  const profile = { id: art.id, digest: art.digest, w: 2, h: 1, cells: [
    { x: 0, y: 0, signature: 'NWxNEoSExSWxNoExSxWx' },
    { x: 1, y: 0, signature: 'NWoNExSExSWxNoExSxWx' }
  ] };
  const tile = at(art, 10, 10, 'study-macro');
  return { art, profile, tile, allAssets: [...assets, art] };
}

test('multi-cell geometry rotates and flips each boundary cell with the parent artwork', () => {
  const { tile, allAssets, profile } = macroFixture(); tile.turn = 1; tile.flipX = true;
  const cells = studyCellGeometry(tile, allAssets, [profile]);
  assert.deepEqual(cells.map(cell => [cell.x, cell.y]), [[10, 11], [10, 10]]);
  assert.ok(cells.every(cell => cell.data.sides.east === 'o'));
});

test('macro cardinal joins precede diagonal caps and never cover the macro footprint', () => {
  const { source, target } = fixture(), { tile, allAssets, profile } = macroFixture();
  target.placements = [tile];
  const { study, report } = buildAdjacencyDraft(source, target, allAssets, 'macro-draft', { cellProfiles: [profile] });
  const scene = study.pages[0];
  assert.deepEqual(scene.placements[0], tile);
  assert.equal(scene.placements.find(placed => placed.x === 11 && placed.y === 9).asset, edgeArt.id);
  assert.ok(scene.placements.slice(1).every(placed => !(placed.y === 10 && placed.x >= 10 && placed.x < 12)));
  assert.equal(report.targetTiles, 1); assert.deepEqual(report.unsupportedTargets, []);
});

test('macro example learning ignores interior cells covered by the center artwork', () => {
  const { tile, allAssets, profile } = macroFixture();
  const scene = blankScene(); scene.placements.push(tile, at(edgeArt, 11, 9, 'artist-macro-neighbor'));
  const learned = learnAdjacentTiles(scene, allAssets, { cellProfiles: [profile] });
  assert.equal(learned.examples.length, 1);
  for (const bucket of learned.tables.edge.values()) for (const option of bucket.options.values()) {
    for (const example of option.examples) {
      const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][example.index];
      assert.ok(!(example.y + dy === 10 && example.x + dx >= 10 && example.x + dx < 12));
    }
  }
  for (const bucket of learned.tables.diagonal.values()) for (const option of bucket.options.values()) {
    for (const example of option.examples) {
      const [dx, dy] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][example.index];
      assert.ok(example.x + dx < 10 || example.x + dx >= 12);
      assert.ok(example.y + dy < 10 || example.y + dy >= 11);
    }
  }
});

test('changed artwork invalidates measured macro geometry instead of silently reusing it', () => {
  const { tile, allAssets, profile } = macroFixture();
  profile.digest = 'obsolete';
  assert.throws(() => studyCellGeometry(tile, allAssets, [profile]), /Stale cell geometry/);
});

function cryptFixture() {
  const crypt = { ...asset('crypt 1.png'), h: 2 }, black = asset('1-black.png'), door = asset('door-closed.png');
  const approach = asset('org-free-NWoNEoSEoSWoNxEoSxWo.png');
  const example = blankScene();
  example.placements.push(at(crypt, 5, 5, 'old-crypt'), at(door, 5, 5, 'old-door'),
    ...[[4, 5], [4, 6], [6, 5], [5, 7]].map(([x, y], i) => at(black, x, y, `old-wall-${i}`)));
  const target = blankScene(); target.placements.push(at(crypt, 10, 10, 'study-crypt'));
  return { example, target, allAssets: [...assets, crypt, black, door, approach] };
}

test('crypt studies build a tiny enclosed chamber with an entrance overlay and open approach', () => {
  const { source } = fixture(), { example, target, allAssets } = cryptFixture();
  const before = structuredClone(target.placements[0]);
  const { study, report } = buildAdjacencyDraft(source, target, allAssets, 'crypt-study', { cryptExample: example });
  const scene = study.pages[0];
  assert.deepEqual(scene.placements[0], before);
  assert.equal(scene.placements.filter(tile => tile.asset === '1-black.png').length, 9);
  assert.equal(scene.placements.filter(tile => tile.x === 10 && tile.y === 10).length, 2);
  assert.equal(scene.placements.find(tile => tile.x === 10 && tile.y === 9).asset, 'org-free-NWoNEoSEoSWoNxEoSxWo.png');
  assert.equal(report.addedPlacements, 11); assert.deepEqual(report.unsupportedTargets, []);
  assert.ok(scene.placements.slice(1).every(tile => !tile.confirmed));
});

test('crypt doors and approaches follow all rotations and reflections without moving the core', () => {
  const { source } = fixture(), { example, target, allAssets } = cryptFixture();
  for (const pose of STUDY_TRANSFORMS) {
    Object.assign(target.placements[0], pose);
    const center = target.placements[0];
    const mouth = transformPoint(center, [.5, .5]).map(Math.floor);
    const approach = transformPoint(center, [.5, -.5]).map(Math.floor);
    const scene = buildAdjacencyDraft(source, target, allAssets, 'rotated-crypt', { cryptExample: example }).study.pages[0];
    assert.deepEqual(scene.placements[0], center);
    assert.ok(scene.placements.some(tile => tile.asset === 'door-closed.png' && tile.x === mouth[0] && tile.y === mouth[1]));
    assert.ok(scene.placements.some(tile => tile.asset.startsWith('org-free-NWoNEoSEoSWo') && tile.x === approach[0] && tile.y === approach[1]));
    assert.equal(scene.placements.length, 12);
  }
});

test('crypt placement preserves existing authored entrance layers and needs a demonstrated chamber', () => {
  const { source } = fixture(), { example, target, allAssets } = cryptFixture();
  const authored = at(allAssets.find(asset => asset.id === 'door-closed.png'), 10, 10, 'artist-door');
  target.placements.push(authored);
  const scene = buildAdjacencyDraft(source, target, allAssets, 'authored-crypt', { cryptExample: example }).study.pages[0];
  assert.deepEqual(scene.placements[1], authored);
  assert.equal(scene.placements.filter(tile => tile.asset === 'door-closed.png').length, 1);
  const unsupported = buildAdjacencyDraft(source, target, allAssets, 'no-crypt-evidence');
  assert.deepEqual(unsupported.report.unsupportedTargets, ['study-crypt']);
  assert.equal(unsupported.report.addedPlacements, 0);
});

test('reviewed crypt examples put the door outside and supersede historical entrance overlays', () => {
  const { source } = fixture(), { example, target, allAssets } = cryptFixture();
  const corrected = structuredClone(example);
  corrected.placements.find(tile => tile.asset === 'door-closed.png').y--;
  for (const pose of STUDY_TRANSFORMS) {
    Object.assign(target.placements[0], pose);
    const center = target.placements[0], outside = transformPoint(center, [.5, -.5]).map(Math.floor);
    const { study, report } = buildAdjacencyDraft([source, corrected], target, allAssets,
      'corrected-crypt', { cryptExample: example });
    assert.deepEqual(report.cryptExample.entranceLocal, [0, -1]);
    const scene = study.pages[0];
    assert.equal(scene.placements.length, 11);
    assert.equal(scene.placements.filter(tile => tile.asset === '1-black.png').length, 9);
    assert.ok(scene.placements.some(tile => tile.asset === 'door-closed.png' && tile.x === outside[0] && tile.y === outside[1]));
    assert.equal(scene.placements.filter(tile => tile.asset.startsWith('org-free-')).length, 0);
    assert.deepEqual(scene.placements[0], center);
  }
});
