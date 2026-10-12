import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [input, output, mode] = process.argv.slice(2);
const scene = JSON.parse(readFileSync(input, 'utf8'));
const rules = mode === '--merge' ? { ...(await import(pathToFileURL(resolve(output)).href)).DOOR_LIGHT_RULES } : {};
for (const tile of scene.placements) {
  if (!/^door-(?:secret-[123](?:-open)?|closed|open)\.png$/.test(tile.asset)) continue;
  const shared = scene.shadowRules?.[tile.asset];
  const paths = (shared?.paths || tile.shadowPaths || []).map(path => path.points);
  const edges = [];
  for (const [key, rule] of Object.entries(tile.annotations || {})) {
    if (!rule.editedLight || !rule.light || key.startsWith('p:')) continue;
    const [kind, x, y] = key.split(':');
    edges.push([[Number(x), Number(y)], [Number(x) + (kind === 'h' ? 1 : 0), Number(y) + (kind === 'v' ? 1 : 0)]]);
  }
  rules[tile.asset.replace(/\.png$/, '')] = { w: tile.w, h: tile.h, paths, edges };
}
writeFileSync(output, '// Generated from reviewed door lighting exports; newer matching assets override older rules.\nexport const DOOR_LIGHT_RULES = ' + JSON.stringify(rules, null, 2) + ';\n');
console.log(`Compiled ${Object.keys(rules).length} door lighting rules.`);
