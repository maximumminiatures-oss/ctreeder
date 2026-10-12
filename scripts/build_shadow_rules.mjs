import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { inverseTransformPoint, isOrganicAsset } from '../tools/tile-debugger/model.mjs';
import { mergeShadowPaths } from '../tools/tile-debugger/shadow-paths.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { single: { type: 'boolean', default: false } } });
const [catalogUrl, output, reportPath, ...inputs] = positionals;
if (!inputs.length) throw Error('Usage: node scripts/build_shadow_rules.mjs catalog-url output.js report.json export.json [...] [--single]');
const { assets } = await (await fetch(catalogUrl)).json();
const catalog = new Map(assets.map(asset => [asset.id, asset]));
const candidates = {}, associations = [], unresolved = [], sources = [], lightAnnotations = {};

function add(tile, path, source, method) {
  const asset = catalog.get(tile.asset);
  if (!asset || tile.digest !== asset.digest || tile.w !== asset.w || tile.h !== asset.h ||
    path.source === 'inferred' || !path.source && tile.shadowSource === 'inferred') return;
  candidates[tile.asset] ||= { digest: asset.digest, w: asset.w, h: asset.h, paths: [], examples: [] };
  candidates[tile.asset].paths.push(path);
  candidates[tile.asset].examples.push({ source, tileId: tile.id, pathId: path.id, method });
}

for (const input of inputs) {
  const bytes = readFileSync(input), scene = JSON.parse(bytes);
  const source = { file: input.split(/[\\/]/).pop(), sha256: createHash('sha256').update(bytes).digest('hex') };
  sources.push(source);
  const canonical = new Set();
  for (const [name, rule] of Object.entries(scene.shadowRules || {})) {
    const asset = catalog.get(name);
    if (!asset || rule.digest !== asset.digest || rule.w !== asset.w || rule.h !== asset.h) continue;
    if (rule.source === 'inferred') { canonical.add(name); continue; }
    // An exported shared definition is authoritative, including deliberate deletions.
    candidates[name] = { digest: rule.digest, w: rule.w, h: rule.h, paths: [], examples: [] };
    canonical.add(name);
    const tile = { asset: name, ...rule, id: `shared:${name}` };
    for (const path of rule.paths) add(tile, path, source.file, 'shared-rule');
  }
  for (const tile of scene.placements) {
    if (!canonical.has(tile.asset)) for (const path of tile.shadowPaths || []) add(tile, path, source.file, 'tile-owned');
    const asset = catalog.get(tile.asset);
    if (!asset || !isOrganicAsset(asset) || tile.digest !== asset.digest) continue;
    for (const [key,rule] of Object.entries(tile.annotations || {})) if (rule.editedLight) {
      (lightAnnotations[tile.asset] ||= {})[key] = rule.light === true;
    }
  }
  for (const path of scene.shadowPaths || []) {
    const owners = scene.placements.flatMap((tile, layer) => {
      const asset = catalog.get(tile.asset);
      if (!asset || !isOrganicAsset(asset) || asset.digest !== tile.digest) return [];
      const points = path.points.map(point => inverseTransformPoint(tile, point));
      const spill = points.map(([x,y]) => Math.max(0,-x,-y,x-tile.w,y-tile.h));
      if (Math.max(...spill) > .25) return [];
      return [{ tile, points, spill: spill.reduce((a,b)=>a+b,0)/spill.length, area: tile.w*tile.h, layer }];
    }).sort((a,b)=>a.spill-b.spill || a.area-b.area || b.layer-a.layer);
    const owner = owners[0];
    if (!owner) { unresolved.push({ source: source.file, pathId: path.id, reason: 'No organic tile contains this line within the 1/4-cell drawing tolerance.' }); continue; }
    add(owner.tile, { ...path, points: owner.points }, source.file, 'inferred-owner');
    associations.push({ source: source.file, pathId: path.id, tileId: owner.tile.id, asset: owner.tile.asset, spill: owner.spill });
  }
}
const rules = {};
for (const [name, rule] of Object.entries(candidates)) {
  rules[name] = { digest: rule.digest, w: rule.w, h: rule.h, paths: mergeShadowPaths(rule.paths, { single: values.single }) };
}
const report = { sources, policy: values.single ? 'one shortest line per asset' : 'preserve distinct lines; choose fewest points for repeated traces',
  associations, unresolved, rules, lightAnnotations, assets: Object.entries(rules).map(([asset,rule])=>({ asset,
    candidates: candidates[asset].paths.length, retained: rule.paths.length,
    points: rule.paths.reduce((n,path)=>n+path.points.length,0), examples: candidates[asset].examples })) };
writeFileSync(output, '// Generated from artist pen exports; exact names/digests guard reusable native-coordinate lines.\n' +
  'export const LEARNED_SHADOW_RULES = ' + JSON.stringify(rules,null,2) + ';\n');
writeFileSync(reportPath, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ assets: Object.keys(rules).length, retainedLines: Object.values(rules).reduce((n,r)=>n+r.paths.length,0),
  associatedMapLines: associations.length, unresolvedMapLines: unresolved.length, policy: report.policy },null,2));
