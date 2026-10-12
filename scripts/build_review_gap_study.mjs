import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPlacementGapPages } from '../tools/tile-debugger/review-study.mjs';
import { buildAdjacencyDraft } from '../tools/tile-debugger/adjacency-draft.mjs';
import { blankScene, validateScene, applyLearnedRules } from '../tools/tile-debugger/model.mjs';
import { applyShadowRules } from '../tools/tile-debugger/shadow-paths.mjs';
import { LEARNED_PLACEMENT_RULES } from '../tools/tile-debugger/learned-placement-rules.mjs';
import { LEARNED_TILE_RULES, LEARNED_FEATURE_RULES } from '../tools/tile-debugger/learned-rules.mjs';
import { LEARNED_SHADOW_RULES } from '../S3_content/src/tile-shadow-rules.js';

const [catalogUrl, output, profilesPath, shadowsReport, ...inputs] = process.argv.slice(2);
if (!inputs.length) throw Error('Usage: node scripts/build_review_gap_study.mjs catalog-url output.json profiles.json shadow-report.json exports.json [...]');
const reportPath = output.replace(/\.json$/,'-inference.json');
if (existsSync(output) || existsSync(reportPath)) throw Error('Study exists; preserve it and choose a new filename.');
const { assets } = await (await fetch(catalogUrl)).json(), catalog=new Map(assets.map(a=>[a.id,a]));
const profiles = JSON.parse(readFileSync(profilesPath)), shadows = JSON.parse(readFileSync(shadowsReport));
const sources=[],provenance=[],skipped=[];
for (const input of inputs) {
  const bytes=readFileSync(input),raw=JSON.parse(bytes);
  raw.placements=raw.placements.filter(tile=>{
    const current=catalog.get(tile.asset),valid=current&&current.w===tile.w&&current.h===tile.h;
    if(!valid)skipped.push({source:basename(input),asset:tile.asset});return valid;
  });
  sources.push(validateScene(raw,assets));provenance.push({file:basename(input),sha256:createHash('sha256').update(bytes).digest('hex')});
}
const id=basename(output,'.json'), packed=buildPlacementGapPages(assets,LEARNED_PLACEMENT_RULES,id), reports=[];
const pages=packed.pages.map((target,index)=>{
  const {study,report}=buildAdjacencyDraft(sources,target,assets,id,{includeAuthoredTiles:true,cellProfiles:profiles.assets,pageNumber:index+1});
  const page=study.pages[0];page.name=`Placement gaps ${index+1}`;page.study={id,page:index};
  page.notes='Neighbor placements are tentative inferences. Correct them and export the page.';
  reports.push(report);return page;
});
const current=structuredClone(sources.at(-1));
const mapped=new Set(shadows.associations.filter(item=>item.source===provenance.at(-1).file).map(item=>item.pathId));
current.shadowPaths=current.shadowPaths.filter(path=>!mapped.has(path.id));
current.shadowRules=structuredClone(LEARNED_SHADOW_RULES);applyShadowRules(current,assets,LEARNED_SHADOW_RULES);
current.name='Organic rooms: shadow review';current.study={id,page:pages.length};pages.push(current);
const blank=blankScene();blank.name='Blank room canvas';blank.study={id,page:pages.length};pages.push(blank);
for(const page of pages) {
  applyLearnedRules(page,assets,LEARNED_TILE_RULES,LEARNED_FEATURE_RULES);
  applyShadowRules(page,assets,LEARNED_SHADOW_RULES);validateScene(page,assets);
}
const book={version:1,id,name:'Organic placement gaps and shadow review',scope:['organic','crypt'],clearance:2,
  unknownAssets:packed.unknownAssets,sourceExports:provenance,pages};
writeFileSync(output,JSON.stringify(book,null,2)+'\n');
writeFileSync(reportPath,JSON.stringify({sources:provenance,skipped,placementPages:reports,
  roomInferences:['Organic boundary pieces occupy the room perimeter; the area outside the room stays solid black.',
    'Movement-blocking organic pieces can be used within rooms and at irregular perimeter joins.',
    'Macro halls may bend smoothly and use their own native-coordinate shadow contours.',
    'Door approaches need open centers and filled corners on the adjacent room or hall artwork.'],
  associatedMapShadowLines:mapped.size,remainingMapShadowLines:current.shadowPaths.map(p=>p.id)},null,2)+'\n');
console.log(JSON.stringify({output,pages:pages.map(page=>({name:page.name,tiles:page.placements.length})),
  unknownAssets:packed.unknownAssets,authoredSources:reports[0]?.sourceExamples,predictedNeighbors:reports.reduce((n,r)=>n+r.addedPlacements,0)},null,2));
