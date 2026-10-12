import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const [catalogUrl, output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length) throw new Error('Usage: node scripts/build_tile_feature_rules.mjs catalog-url output.mjs export.json [...]');
const response = await fetch(catalogUrl);
if (!response.ok) throw new Error('Cannot load the local asset catalog.');
const { assets } = await response.json(), catalog = new Map(assets.map(asset => [asset.id, asset]));
const rules = {};
for (const input of inputs) {
  const bytes = readFileSync(input), scene = JSON.parse(bytes);
  for (const tile of scene.placements.filter(tile => tile.asset.startsWith('org-hall-'))) {
    const asset = catalog.get(tile.asset);
    if (!asset || asset.digest !== tile.digest || asset.w !== tile.w || asset.h !== tile.h) throw new Error(`Changed artwork: ${tile.asset}`);
    const movement = {}, light = {};
    for (const [key, annotation] of Object.entries(tile.annotations)) {
      if (annotation.editedMovement) movement[key] = annotation.movement;
      if (annotation.editedLight) light[key] = annotation.light;
    }
    if (!Object.keys(movement).length && !Object.keys(light).length) continue;
    const source = { example: input.split(/[\\/]/).pop(), sha256: createHash('sha256').update(bytes).digest('hex') };
    const prior = rules[tile.asset];
    rules[tile.asset] = { digest: asset.digest, w: asset.w, h: asset.h,
      source, movement: { ...prior?.movement, ...movement }, light: { ...prior?.light, ...light } };
  }
}
writeFileSync(output, '// Generated from explicit artist annotations; unedited properties remain unknown.\n' +
  'export const LEARNED_FEATURE_RULES = ' + JSON.stringify(rules, null, 2) + ';\n');
console.log(JSON.stringify({ output: resolve(output), assets: Object.keys(rules).length,
  movementProperties: Object.values(rules).reduce((sum, rule) => sum + Object.keys(rule.movement).length, 0),
  lightProperties: Object.values(rules).reduce((sum, rule) => sum + Object.keys(rule.light).length, 0) }, null, 2));
