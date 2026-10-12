import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { organicAssetFamily } from '../tools/tile-debugger/adjacency-draft.mjs';
import { isOrganicAsset, dimensions } from '../tools/tile-debugger/model.mjs';

const [catalogUrl, output, reportPath, ...inputs] = process.argv.slice(2);
if (!inputs.length) throw Error('Usage: node scripts/build_placement_knowledge.mjs catalog-url output.mjs report.json examples.json [...]');
const { assets } = await (await fetch(catalogUrl)).json(), catalog = new Map(assets.map(asset=>[asset.id,asset]));
const demonstrated = new Map(), sources = [];
for (const input of inputs) {
  const bytes = readFileSync(input), scene = JSON.parse(bytes);
  const source = { file: input.split(/[\\/]/).pop(), sha256: createHash('sha256').update(bytes).digest('hex') };
  sources.push(source);
  const centers = scene.placements.filter(tile=>tile.id.startsWith('study-'));
  for (const tile of centers.length ? centers : scene.placements) {
    const asset = catalog.get(tile.asset);
    if (!asset || !(isOrganicAsset(asset) || /^crypt \d+\.png$/i.test(asset.id))) continue;
    const [w,h] = dimensions(tile);
    const context = scene.placements.filter(other=>other.id!==tile.id && (isOrganicAsset(catalog.get(other.asset)||{name:''}) || other.asset==='door-closed.png'))
      .filter(other=>{const[ow,oh]=dimensions(other);return other.x<tile.x+w+1&&other.x+ow>tile.x-1&&other.y<tile.y+h+1&&other.y+oh>tile.y-1;});
    if (centers.length && !context.length) continue;
    demonstrated.set(organicAssetFamily(asset), { asset: asset.id, w:tile.w,h:tile.h,source,
      method: centers.length ? 'corrected-study-context' : 'authored-room-context', contextAssets:[...new Set(context.map(t=>t.asset))] });
  }
}
const rules = {}, unknown = [];
for (const asset of assets.filter(asset=>isOrganicAsset(asset)||/^crypt \d+\.png$/i.test(asset.id))) {
  const family = organicAssetFamily(asset), evidence = demonstrated.get(family);
  if (!evidence || evidence.w!==asset.w || evidence.h!==asset.h) { unknown.push({asset:asset.id,family,reason:'No demonstrated placement for this shape family.'});continue; }
  rules[asset.id]={digest:asset.digest,w:asset.w,h:asset.h,family,source:evidence.source,
    confidence:evidence.asset===asset.id?'demonstrated':'same-shape-art-variant'};
}
writeFileSync(output,'// Placement evidence is separate from complete movement/light confirmation.\nexport const LEARNED_PLACEMENT_RULES = '+JSON.stringify(rules,null,2)+';\n');
writeFileSync(reportPath,JSON.stringify({sources,knownAssets:Object.keys(rules).length,unknown,
  families:[...demonstrated.entries()].map(([family,evidence])=>({family,...evidence}))},null,2)+'\n');
console.log(JSON.stringify({knownAssets:Object.keys(rules).length,unknownAssets:unknown.length,unknownFamilies:new Set(unknown.map(a=>a.family)).size,unknown:unknown.map(a=>a.asset)},null,2));
