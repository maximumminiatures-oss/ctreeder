import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { buildLightingReviewPages, buildPlacementGapPages } from '../tools/tile-debugger/review-study.mjs';
import { buildAdjacencyDraft } from '../tools/tile-debugger/adjacency-draft.mjs';
import { validateScene, applyLearnedRules } from '../tools/tile-debugger/model.mjs';
import { applyShadowRules } from '../tools/tile-debugger/shadow-paths.mjs';
import { applyOrganicLightingRules } from '../tools/tile-debugger/lighting-rules.mjs';
import { LEARNED_PLACEMENT_RULES } from '../tools/tile-debugger/learned-placement-rules.mjs';
import { LEARNED_TILE_RULES, LEARNED_FEATURE_RULES } from '../tools/tile-debugger/learned-rules.mjs';
import { LEARNED_SHADOW_RULES } from '../S3_content/src/tile-shadow-rules.js';

const {values,positionals}=parseArgs({allowPositionals:true,options:{'omit-room-map':{type:'boolean',default:false}}});
const [catalogUrl, analysisPath, modulePath, output, profilesPath, ...inputs] = positionals;
if (!inputs.length) throw Error('Usage: node scripts/build_lighting_review.mjs catalog-url analysis.json module.mjs study.json macro-profiles.json exports.json [...]');
const reportPath=output.replace(/\.json$/,'-inference.json');
if (existsSync(output)||existsSync(reportPath)) throw Error('Preserve existing studies; choose a new ID.');
const analysisBytes=readFileSync(analysisPath),analysis=JSON.parse(analysisBytes);
const revision=createHash('sha256').update(analysisBytes).digest('hex');
const {assets}=await(await fetch(catalogUrl)).json(),catalog=new Map(assets.map(a=>[a.id,a]));
const rules=Object.fromEntries(Object.entries(analysis.rules).map(([name,rule])=>[name,{...rule,revision,
  paths:rule.paths.map(path=>({...path,source:path.source || (rule.source==='inferred'?'inferred':'artist')}))}]));
const defaults={...LEARNED_SHADOW_RULES,...rules};
const sources=[],provenance=[],skipped=[];
for(const input of inputs){
  const bytes=readFileSync(input),raw=JSON.parse(bytes);
  raw.placements=raw.placements.filter(tile=>{
    const current=catalog.get(tile.asset),valid=current&&current.w===tile.w&&current.h===tile.h;
    if(!valid)skipped.push({file:basename(input),asset:tile.asset});return valid;
  });
  sources.push(validateScene(raw,assets));provenance.push({file:basename(input),sha256:createHash('sha256').update(bytes).digest('hex')});
}
const id=basename(output,'.json'),lighting=buildLightingReviewPages(assets,rules,id),fit=buildPlacementGapPages(assets,LEARNED_PLACEMENT_RULES,id);
const pages=lighting.pages,reports=[];
for(const page of pages)page.notes='Inferred light contours are drafts. Artist-drawn lines remain authoritative.';
const current=structuredClone(sources.at(-1));current.name='lighting rooms';
if(!values['omit-room-map'])pages.push(current);
for(const [index,target]of fit.pages.entries()){
  const {study,report}=buildAdjacencyDraft(sources,target,assets,id,{includeAuthoredTiles:true,
    cellProfiles:JSON.parse(readFileSync(profilesPath)).assets,pageNumber:index+1});
  const page=study.pages[0];page.name=`tile fit ${index+1}`;page.notes='Tentative adjacent pieces; correct the fit and export.';
  pages.push(page);reports.push(report);
}
for(const [index,page]of pages.entries()){
  page.study={id,page:index};
  applyLearnedRules(page,assets,LEARNED_TILE_RULES,LEARNED_FEATURE_RULES);
  applyOrganicLightingRules(page,assets,rules);
  applyShadowRules(page,assets,defaults);
  validateScene(page,assets);
}
writeFileSync(modulePath,'// Generated lighting drafts; inferred paths stay distinct from artist evidence.\nexport const ORGANIC_LIGHTING_RULES = '+JSON.stringify(rules,null,2)+';\n');
// Completed reviews need a coverage report, not an empty, unloadable study book.
if(pages.length)writeFileSync(output,JSON.stringify({version:1,id,name:'Organic lighting and tile fit',scope:['organic','crypt'],clearance:2,
  lightingAssets:lighting.lightingAssets,unknownAssets:fit.unknownAssets,sourceExports:provenance,pages},null,2)+'\n');
const complete=!lighting.lightingAssets.length&&!fit.unknownAssets.length;
writeFileSync(reportPath,JSON.stringify({complete,style:analysis.style,sourceAnalysis:{file:basename(analysisPath),sha256:revision},
  sources:provenance,skipped,lightingAssets:lighting.lightingAssets,tileFitAssets:fit.unknownAssets,tileFitReports:reports,
  artistAssets:analysis.assets.filter(a=>a.source==='artist').length,inferredAssets:analysis.assets.filter(a=>a.source==='inferred').length,
  preservedMapPaths:values['omit-room-map']?[]:current.shadowPaths.map(path=>path.id)},null,2)+'\n');
console.log(JSON.stringify({complete,pages:pages.map(page=>({name:page.name,tiles:page.placements.length})),
  lightingAssets:lighting.lightingAssets.length,tileFitAssets:fit.unknownAssets.length},null,2));
