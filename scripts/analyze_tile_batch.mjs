import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { isReviewableAsset, dimensions, topPlacementAt } from '../tools/tile-debugger/model.mjs';
import { LEARNED_TILE_RULES } from '../tools/tile-debugger/learned-rules.mjs';
import { CRYPT_RULES } from '../S3_content/src/crypts.js';

const args = process.argv.slice(2), output = args.pop();
if (!args.length || !output) throw new Error('Usage: node scripts/analyze_tile_batch.mjs example.json [example.json ...] report.json');
const sources = [], grouped = new Map();
for (const input of args) {
  const bytes = readFileSync(input), scene = JSON.parse(bytes);
  sources.push({ path: resolve(input), sha256: createHash('sha256').update(bytes).digest('hex') });
  const catalog = new Map(scene.assets.map(asset => [asset.id, asset]));
  for (const tile of scene.placements) {
    const asset = catalog.get(tile.asset);
    if (!asset || !isReviewableAsset(asset)) continue;
    const key = `${asset.id}:${asset.digest}`;
    if (!grouped.has(key)) grouped.set(key, { asset, instances: [] });
    const [w, h] = dimensions(tile), context = {};
    for (const [side, point] of Object.entries({ north: [tile.x + w / 2, tile.y - .5],
      east: [tile.x + w + .5, tile.y + h / 2], south: [tile.x + w / 2, tile.y + h + .5],
      west: [tile.x - .5, tile.y + h / 2] })) {
      context[side] = topPlacementAt(scene.placements.filter(other => other.id !== tile.id), ...point)?.asset || 'paper floor';
    }
    grouped.get(key).instances.push({ source: resolve(input), x: tile.x, y: tile.y, turn: tile.turn,
      flipX: tile.flipX, flipY: tile.flipY, movement: tile.movement, lightShape: tile.lightShape,
      annotations: tile.annotations, context });
  }
}
const assets = [...grouped.values()].map(({ asset, instances }) => {
  const fingerprints = new Set(instances.map(tile => JSON.stringify({ movement: tile.movement,
    lightShape: tile.lightShape, annotations: Object.fromEntries(Object.entries(tile.annotations).map(([key, rule]) =>
      [key, { movement: rule.movement, light: rule.light }])) })));
  return { asset: asset.id, digest: asset.digest, width: asset.w, height: asset.h,
    learned: LEARNED_TILE_RULES[asset.id]?.digest === asset.digest, ruleVariants: fingerprints.size,
    explicitMovementEdits: instances.reduce((n, tile) => n + Object.values(tile.annotations).filter(rule => rule.editedMovement).length, 0),
    explicitLightEdits: instances.reduce((n, tile) => n + Object.values(tile.annotations).filter(rule => rule.editedLight).length, 0),
    instances };
});
const report = {
  scope: ['organic', 'crypt'], sources,
  summary: { assets: assets.length, organicAssets: assets.filter(asset => !asset.asset.startsWith('crypt ')).length,
    cryptAssets: assets.filter(asset => asset.asset.startsWith('crypt ')).length,
    conflictingAssets: assets.filter(asset => asset.ruleVariants > 1).map(asset => asset.asset) },
  cryptDesignRules: { implementationStatus: 'Implemented locally; not deployed by this analysis.',
    dungeonProbability: CRYPT_RULES.dungeonChance, hallwayShare: CRYPT_RULES.hallwayRatio,
    hallwayShareBasis: 'Non-entrance hallway route count, with safe-space placement limits.',
    deadEndShareOfCryptHallways: CRYPT_RULES.deadEndRatio, cryptPlacement: 'Always in a tiny chamber containing only the crypt.',
    doorPlacement: 'One tile outside the crypt footprint, as corrected on pages 5 and 6.',
    monsters: 'Only explicit undead tags; no fallback to untagged monsters.', doorTrapChance: CRYPT_RULES.doorTrapChance,
    symmetricAlcoves: 'Most crypt chambers should form mirrored pairs along crypt hallways.',
    deadEndTermination: 'A dead-end crypt hallway terminates in a tiny crypt chamber.',
    movementAndLight: 'The new crypt placements have no explicit movement/light annotations; defaults are not confirmed rules.' },
  assets
};
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.summary, report: resolve(output) }, null, 2));
