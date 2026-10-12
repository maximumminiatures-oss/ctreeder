import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { buildAdjacencyDraft, adjacentGeometryKey, studyCellGeometry } from '../tools/tile-debugger/adjacency-draft.mjs';
import { validateScene } from '../tools/tile-debugger/model.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true,
  options: { page: { type: 'string', default: '2' }, source: { type: 'string', multiple: true, default: [] },
    profiles: { type: 'string' }, 'crypt-example': { type: 'string' } } });
const [input, originalStudy, catalogUrl, output] = positionals;
if (!output || positionals.length !== 4) throw new Error('Usage: node scripts/build_adjacency_draft.mjs page1.json original-study.json catalog-url output.json [--page 3] [--source corrected-page2.json] [--profiles cells.json] [--crypt-example example.json]');
const reportPath = output.replace(/\.json$/, '-inference.json');
if (existsSync(output) || existsSync(reportPath)) throw new Error('Draft already exists; choose a new filename to preserve its saved work.');
const bookBytes = readFileSync(originalStudy), book = JSON.parse(bookBytes), pageNumber = Number(values.page);
if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > book.pages.length) throw new Error('Study page unavailable.');
const knownCenters = new Set(book.pages.flatMap(page => page.placements.map(tile => tile.id)));
const response = await fetch(catalogUrl); if (!response.ok) throw new Error('Cannot read the local asset catalog.');
const { assets } = await response.json();
const profileBytes = values.profiles ? readFileSync(values.profiles) : null;
const profiles = profileBytes ? JSON.parse(profileBytes) : { version: 1, cellSize: 54, assets: [] };
if (profiles.version !== 1 || profiles.cellSize !== 54 || !Array.isArray(profiles.assets)) throw new Error('Invalid macro profiles.');
const cryptBytes = values['crypt-example'] ? readFileSync(values['crypt-example']) : null;
const cryptExample = cryptBytes ? JSON.parse(cryptBytes) : null;
const changedArtwork = [], sources = [], provenance = [];
for (const path of [input, ...values.source]) {
  const bytes = readFileSync(path), raw = JSON.parse(bytes);
  const centers = raw.placements.filter(tile => tile.id.startsWith('study-'));
  if (!centers.length || centers.some(tile => !knownCenters.has(tile.id))) throw new Error('Expected an inspected export from this study.');
  for (const asset of raw.assets) {
    const current = assets.find(item => item.id === asset.id);
    if (!current || current.w !== asset.w || current.h !== asset.h) throw new Error(`Asset unavailable or resized: ${asset.id}`);
    if (current.digest !== asset.digest) changedArtwork.push({ source: resolve(path), id: asset.id, exportedDigest: asset.digest, currentDigest: current.digest });
  }
  sources.push(validateScene(raw, assets));
  provenance.push({ path: resolve(path), sha256: createHash('sha256').update(bytes).digest('hex'), study: raw.study });
}
const target = validateScene(book.pages[pageNumber - 1], assets), id = basename(output, '.json');
const { study, report } = buildAdjacencyDraft(sources, target, assets, id, { pageNumber, cellProfiles: profiles.assets, cryptExample });
validateScene(study.pages[0], assets);
report.sources = provenance;
if (profileBytes) report.macroProfiles = { path: resolve(values.profiles), sha256: createHash('sha256').update(profileBytes).digest('hex') };
if (cryptBytes) report.cryptExampleSource = { path: resolve(values['crypt-example']), sha256: createHash('sha256').update(cryptBytes).digest('hex') };
report.originalStudy = { path: resolve(originalStudy), sha256: createHash('sha256').update(bookBytes).digest('hex') };
report.changedArtwork = changedArtwork;
report.targetArtworkUpdates = book.pages[pageNumber - 1].placements.filter(tile =>
  tile.digest !== assets.find(asset => asset.id === tile.asset)?.digest).map(tile => ({ id: tile.asset,
    originalDigest: tile.digest, currentDigest: assets.find(asset => asset.id === tile.asset).digest }));
// This is a regression replay of training examples, not an accuracy estimate for unseen art.
report.trainingReplay = sources.map((source, index) => {
  const template = structuredClone(source);
  template.placements = template.placements.filter(tile => tile.id.startsWith('study-'));
  const replay = buildAdjacencyDraft(sources, template, assets, `replay-${index}`, { varyAssets: false, cellProfiles: profiles.assets, cryptExample }).study.pages[0];
  const mismatches = [];
  let cells = 0;
  const visited = new Set();
  for (const center of template.placements) for (const cell of studyCellGeometry(center, assets, profiles.assets))
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = cell.x + dx, y = cell.y + dy, key = `${x},${y}`;
    if (visited.has(key) || template.placements.some(tile => {
      const w = tile.turn % 2 ? tile.h : tile.w, h = tile.turn % 2 ? tile.w : tile.h;
      return x >= tile.x && x < tile.x + w && y >= tile.y && y < tile.y + h;
    })) continue;
    visited.add(key);
    const layersAt = scene => scene.placements.filter(tile => tile.x === x && tile.y === y);
    const expected = layersAt(source), actual = layersAt(replay); cells++;
    if (adjacentGeometryKey(expected, assets) !== adjacentGeometryKey(actual, assets)) mismatches.push({ center: center.id, x, y,
      expected: expected.map(tile => tile.asset), actual: actual.map(tile => tile.asset) });
  }
  return { source: provenance[index].path, cells, matches: cells - mismatches.length, mismatches };
});
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, JSON.stringify(study, null, 2) + '\n');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: resolve(output), report: resolve(reportPath), sourceExamples: report.sourceExamples,
  targetTiles: report.targetTiles, addedPlacements: report.addedPlacements, edgePatterns: report.edgePatterns,
  cornerPatterns: report.cornerPatterns, changedArtwork: changedArtwork.map(item => item.id),
  unsupportedTargets: report.unsupportedTargets,
  trainingReplay: report.trainingReplay.map(item => ({ source: basename(item.source), cells: item.cells, matches: item.matches })),
  fallbackCases: report.predictions.filter(item => item.method === 'geometry fallback').length }, null, 2));
