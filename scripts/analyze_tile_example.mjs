import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createPlacement } from '../tools/tile-debugger/model.mjs';

const input = process.argv[2], output = process.argv[3];
if (!input) throw new Error('Usage: node scripts/analyze_tile_example.mjs input.json [analysis.json]');
const source = readFileSync(input), scene = JSON.parse(source);
const assets = new Map(scene.assets.map(asset => [asset.id, asset]));
const halls = new Map(), edited = [], bodyEdits = [];
for (const tile of scene.placements) {
  const base = createPlacement(assets.get(tile.asset), tile.x, tile.y, tile.id);
  if (base.movement !== tile.movement || base.lightShape !== tile.lightShape) {
    bodyEdits.push({ asset: tile.asset, x: tile.x, y: tile.y, movement: tile.movement, lightShape: tile.lightShape });
  }
  for (const [key, rule] of Object.entries(tile.annotations)) {
    for (const property of ['movement', 'light']) {
      if (rule[property === 'movement' ? 'editedMovement' : 'editedLight']) {
        edited.push({ asset: tile.asset, x: tile.x, y: tile.y, key, property, blocks: rule[property] });
      }
    }
  }
  if (tile.asset.startsWith('org-hall-')) {
    if (!halls.has(tile.asset)) halls.set(tile.asset, []);
    halls.get(tile.asset).push(tile);
  }
}
const hallRules = [...halls].map(([asset, instances]) => {
  const explicitConstraints = {}, differences = [], movementOnlyAsExported = new Set();
  for (const key of Object.keys(instances[0].annotations)) {
    for (const property of ['movement', 'light']) {
      const states = instances.map(tile => ({ x: tile.x, y: tile.y, blocks: tile.annotations[key][property],
        edited: tile.annotations[key][property === 'movement' ? 'editedMovement' : 'editedLight'] }));
      const explicit = states.filter(state => state.edited);
      if (explicit.length) explicitConstraints[`${key}/${property}`] = explicit;
      if (states.some(state => state.blocks !== states[0].blocks)) differences.push({ key, property, states });
    }
    if (instances.some(tile => tile.annotations[key].movement && !tile.annotations[key].light)) movementOnlyAsExported.add(key);
  }
  return { asset, digest: assets.get(asset).digest, width: instances[0].w, height: instances[0].h,
    instances: instances.map(tile => ({ x: tile.x, y: tile.y, turn: tile.turn, flipX: tile.flipX, flipY: tile.flipY })),
    explicitConstraints, movementOnlyAsExported: [...movementOnlyAsExported], differences,
    confirmed: scene.reviewed?.[asset] === assets.get(asset).digest };
});
const report = {
  source: resolve(input), sha256: createHash('sha256').update(source).digest('hex'),
  summary: { placements: scene.placements.length, assets: assets.size,
    blackTiles: scene.placements.filter(tile => tile.asset === '1-black.png').length,
    hallPlacements: [...halls.values()].reduce((sum, list) => sum + list.length, 0), hallAssetTypes: halls.size,
    editedMovementConstraints: edited.filter(rule => rule.property === 'movement').length,
    editedLightConstraints: edited.filter(rule => rule.property === 'light').length },
  unfinishedAreasReportedByAuthor: ['top-left', 'bottom-right'],
  interpretation: [
    'The unfinished areas are not negative layout examples.',
    'Organic room boundaries use one artwork frontier against solid black exterior, not two decorative rings.',
    'Movement-blocking organic pieces participate in room boundaries and interior variation.',
    'Macro hall footprints need internal connectivity and independent movement/light rules; rectangular image size does not imply an entirely passable footprint.',
    'Manual edited flags are explicit evidence. Unedited default values and differing repeated instances still need confirmation.',
    'This report does not change the generator or promote unconfirmed assets to universal rules.'
  ],
  hallRules, explicitEdits: edited, bodyEdits,
  hallAssetsStillNeedingConfirmation: hallRules.filter(rule => !rule.confirmed || rule.differences.length).map(rule => rule.asset)
};
if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ ...report.summary, analysis: output ? resolve(output) : null,
  differingHallAssets: hallRules.filter(rule => rule.differences.length).map(rule => rule.asset) }, null, 2));
