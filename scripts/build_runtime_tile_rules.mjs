import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ORGANIC_LIGHTING_RULES } from '../tools/tile-debugger/organic-lighting-drafts.mjs';
import { LEARNED_PLACEMENT_RULES } from '../tools/tile-debugger/learned-placement-rules.mjs';
import { LEARNED_TILE_RULES, LEARNED_FEATURE_RULES } from '../tools/tile-debugger/learned-rules.mjs';
import { ORGANIC_ASSET_SIGNATURES } from '../S3_content/src/organic-asset-geometry.js';

function parseOrganicSignature(value) {
  const pairs=[...(ORGANIC_ASSET_SIGNATURES[value] || value).matchAll(/(NW|NE|SE|SW|N|E|S|W)([ox])/g)];
  if(pairs.length!==8) return null;
  const names={N:'north',E:'east',S:'south',W:'west'},sides={},corners={};
  for(const [,key,value] of pairs) if(names[key]) sides[names[key]]=value; else corners[key.toLowerCase()]=value;
  return {sides,corners};
}

const [profilePath, outputPath, evidenceRoot, manifestPath] = process.argv.slice(2);
if (!evidenceRoot) throw Error('Usage: node scripts/build_runtime_tile_rules.mjs all-cell-profiles.json output.js evidence-folder');
const profiles = JSON.parse(readFileSync(profilePath));
const rules = {}, halls = [];
const sideKeys = ['north', 'east', 'south', 'west'];
const directions = [[0,-1],[1,0],[0,1],[-1,0]];
const edgeKeys = (x,y) => [`h:${x}:${y}`,`v:${x+1}:${y}`,`h:${x}:${y+1}`,`v:${x}:${y}`];
const examples = new Map();
function example(source) {
  if(!examples.has(source.file)) {
    const candidates=[join(evidenceRoot,source.file),join(evidenceRoot,'archive','2026-10-09','exports',source.file)];
    const path=candidates.find(existsSync);
    if(!path) throw Error(`Missing artist example: ${source.file}`);
    const bytes=readFileSync(path);
    if(createHash('sha256').update(bytes).digest('hex')!==source.sha256) throw Error(`Changed artist example: ${source.file}`);
    examples.set(source.file,JSON.parse(bytes));
  }
  return examples.get(source.file);
}

for (const measured of profiles.assets) {
  const { id, digest, w, h } = measured;
  const fit = LEARNED_PLACEMENT_RULES[id], light = ORGANIC_LIGHTING_RULES[id];
  if (!fit || fit.digest !== digest || fit.w !== w || fit.h !== h) throw Error(`Unreviewed/stale placement: ${id}`);
  const bytes = readFileSync(new URL(`../S3_content/assets/${id}`, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw Error(`Changed artwork: ${id}`);
  if (id.startsWith('crypt ')) continue;
  if (!light?.reviewed || light.digest !== digest || light.w !== w || light.h !== h) throw Error(`Unreviewed/stale lighting: ${id}`);
  const known = LEARNED_TILE_RULES[id], partial = LEARNED_FEATURE_RULES[id];
  const movement = {};
  if (known?.digest === digest) {
    for (const key of known.movementFeatures) movement[key] = true;
    for (let y=0;y<=h;y++) for(let x=0;x<=w;x++) {
      for(const key of [`p:${x}:${y}`, ...(x<w?[`h:${x}:${y}`]:[]), ...(y<h?[`v:${x}:${y}`]:[])]) movement[key] ||= false;
    }
  }
  if (partial?.digest === digest) Object.assign(movement, partial.movement);
  const scene=example(fit.source);
  const authored=scene.placements.filter(tile=>tile.asset===id && tile.digest===digest && tile.w===w && tile.h===h);
  const demonstrated=authored.find(tile=>tile.id.startsWith('study-')) || authored.at(-1);
  if(demonstrated) for(const [key,rule] of Object.entries(demonstrated.annotations)) {
    if(id.startsWith('org-hall-') || rule.editedMovement) movement[key]=rule.movement;
  }
  const cells = measured.cells.map(cell => {
    const signature = (w===1 && h===1 && parseOrganicSignature(id)) || parseOrganicSignature(cell.signature);
    const edges = edgeKeys(cell.x, cell.y);
    const sides = sideKeys.map((side,index) => movement[edges[index]] ?? signature.sides[side] === 'o');
    return { x:cell.x,y:cell.y,sides,corners:['nw','ne','se','sw'].map(c=>signature.corners[c] === 'o') };
  });
  if(w===1 && h===1) {
    edgeKeys(0,0).forEach((key,i)=>movement[key] ??= cells[0].sides[i]);
    ['p:0:0','p:1:0','p:1:1','p:0:1'].forEach((key,i)=>movement[key] ??= cells[0].corners[i]);
  }
  const lightEdges = new Set(light.lightEdges);
  for(const [key,value] of Object.entries(light.explicitLight)) value ? lightEdges.add(key) : lightEdges.delete(key);
  rules[id] = { digest,w,h,kind:known?.digest === digest ? (known.movement?'blocks':'free') : id.startsWith('org-blocks-')?'blocks':'free',
    cells,movement,lightEdges:[...lightEdges],paths:light.paths.map(path=>({points:path.points,source:path.source || light.source})),
    revision:light.revision,placementSource:fit.source };
  if (!id.startsWith('org-hall-')) continue;
  const cellMap = new Map(cells.map(c=>[`${c.x},${c.y}`,c]));
  const ports = [];
  for(const cell of cells) for(let side=0;side<4;side++) {
    const [dx,dy]=directions[side];
    const measuredCell=measured.cells.find(c=>c.x===cell.x&&c.y===cell.y);
    const openArt=parseOrganicSignature(measuredCell.signature).sides[sideKeys[side]]==='x';
    if(openArt && !cell.sides[side] && !cellMap.has(`${cell.x+dx},${cell.y+dy}`)) ports.push([sideKeys[side],cell.x,cell.y]);
  }
  if(ports.length<2) throw Error(`Hall has fewer than two openings: ${id}`);
  const seen=new Set(), queue=[ports[0].slice(1)];
  while(queue.length) {
    const [x,y]=queue.shift(),key=`${x},${y}`;
    if(seen.has(key)) continue;
    seen.add(key);
    const cell=cellMap.get(key);
    for(let side=0;side<4;side++) {
      const [dx,dy]=directions[side],next=cellMap.get(`${x+dx},${y+dy}`);
      if(next && !cell.sides[side] && !next.sides[(side+2)%4]) queue.push([next.x,next.y]);
    }
  }
  if(!ports.every(([,x,y])=>seen.has(`${x},${y}`))) throw Error(`Artist movement rules disconnect hall openings: ${id}`);
  const centers=[...seen].map(key=>measured.cells.find(c=>`${c.x},${c.y}`===key)?.walkPoint);
  if(centers.some(point=>!point)) throw Error(`Hall route enters a fully black cell: ${id}`);
  halls.push({ id,kind:'hall',organicMacro:true,width:w,height:h,floor:[...seen].map(key=>key.split(',').map(Number)),ports,
    centers,
    placements:[{asset:id,w,h,x:0,y:0,turn:0,flipX:false,flipY:false,movement:false,lightShape:'edges',annotations:{}}],doors:[] });
}
writeFileSync(outputPath,'// Generated from reviewed tile exports and current artwork. Rebuild with scripts/build_runtime_tile_rules.mjs.\n'+
  'export const REVIEWED_TILE_RULES = '+JSON.stringify(rules)+';\n'+
  'export const ORGANIC_HALL_LAYOUTS = '+JSON.stringify(halls)+';\n');
if(manifestPath) writeFileSync(manifestPath,JSON.stringify(Object.keys(rules).sort(),null,2)+'\n');
console.log(JSON.stringify({assets:Object.keys(rules).length,halls:halls.map(({id,floor,ports})=>({id,cells:floor.length,ports}))},null,2));
