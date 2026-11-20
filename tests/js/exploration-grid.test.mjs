import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEmptyDungeonState} from '../../S3_content/src/state-schema.js';
import {recomputeVisibility} from '../../S3_content/src/visibility.js';
import {collectLightSources} from '../../S3_content/src/light-geometry.js';
import {organicExplorationArea} from '../../S3_content/src/organic-exploration.js';
import {ORGANIC_EXPLORATION_MASKS} from '../../S3_content/src/organic-exploration-data.js';
import {tileRulePoint} from '../../S3_content/src/reviewed-tile-rules.js';
import {setOrganicTileMeta} from '../../S3_content/src/organic-tiles.js';
import {rememberLightPolygons,isTileFullyExplored} from '../../S3_content/src/exploration-memory.js';
function scene(){const s=createEmptyDungeonState(19);s.map={width:12,height:8};s.tiles=Array.from({length:96},(_,i)=>({x:i%12,y:Math.floor(i/12),type:'floor',meta:{}}));s.entities=[];s.characters=[{id:'light',x:5,y:3,visualX:1,visualY:3,lightRadius:1,lightSource:'torch',hp:10}];s.activeCharacterId='light';s.player.torchLit=false;return s;}
const memory=s=>JSON.stringify({memory:s.visibility.explorationMemory,ever:[...s.visibility.exploredEver].sort(),routes:Object.fromEntries(Object.entries(s.visibility.routeExplored).map(([r,k])=>[r,[...k].sort()])),doorSides:[...s.visibility.closedDoorExploredSides]});
test('animated light stays smooth while permanent geometry and coarse memory use only actual positions',()=>{
 const s=scene();let polygons=recomputeVisibility(s);const initial=memory(s);
 assert.equal(collectLightSources(s)[0].x,1);assert.equal(collectLightSources(s,{logical:true})[0].x,5);
 assert.ok(s.visibility.visibleNow.has('1,3'));assert.equal(s.visibility.exploredEver.has('1,3'),false);
 const first=polygons[0].polygon;
 for(let i=1;i<=40;i++){s.characters[0].visualX=1+i/10;polygons=recomputeVisibility(s);assert.equal(memory(s),initial);}
 assert.notDeepEqual(polygons[0].polygon,first);
 delete s.characters[0].visualX;delete s.characters[0].visualY;s.characters[0].x=8;recomputeVisibility(s);assert.notEqual(memory(s),initial);
});
test('all generated organic masks match their source artwork digest and native dimensions',()=>{
 for(const [asset,mask]of Object.entries(ORGANIC_EXPLORATION_MASKS)){
  const bytes=readFileSync(new URL('../../S3_content/assets/'+asset,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),mask.digest,asset+' needs mask rebuild');
  assert.equal(bytes.readUInt32BE(16),mask.w);assert.equal(bytes.readUInt32BE(20),mask.h);
 }
});
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const remember=(s,p)=>rememberLightPolygons(s,[{source:{routeId:''},polygon:p.map(([x,y])=>[x*54,y*54])}]);
test('organic completion excludes opaque rock across rotations and flips',()=>{
 for(let turn=0;turn<4;turn++)for(const flipX of [false,true])for(const flipY of [false,true]){
  const s=scene(),tile=s.tiles[13];setOrganicTileMeta(tile,'org-free-NWoNEoSEoSWoNoEoSoWx.png',{rotationTurns:turn,flipX,flipY});
  const required=organicExplorationArea(s,tile);assert.ok(required.length);
  const mask=ORGANIC_EXPLORATION_MASKS['org-free-NWoNEoSEoSWoNoEoSoWx.png'];
  for(const polygon of mask.shape)rememberLightPolygons(s,[{source:{routeId:''},polygon:polygon[0].map(point=>tileRulePoint({x:54,y:54,w:54,h:54,turn,flipX,flipY},point))}]);
  assert.equal(isTileFullyExplored(s,1,1),true,JSON.stringify({turn,flipX,flipY}));
 }
});
test('even a microscopic unseen gap within transparent organic floor prevents completion',()=>{
 const s=scene(),tile=s.tiles[13];setOrganicTileMeta(tile,'org-free-NWoNEoSEoSWoNoEoSoWx.png');
 // This pixel and all eight neighbors are fully transparent in the source PNG.
 const x=1+10.5/54,y=1+10.5/54,gap=1e-6;
 remember(s,rect(1,1,x-1-gap,1));remember(s,rect(x+gap,1,2-x-gap,1));
 remember(s,rect(1,1,1,y-1-gap));remember(s,rect(1,y+gap,1,2-y-gap));
 assert.equal(isTileFullyExplored(s,1,1),false);
 remember(s,rect(x-gap,y-gap,gap*2,gap*2));assert.equal(isTileFullyExplored(s,1,1),true);
});


test('a visual-only view of one closed-door side does not permanently explore that side',()=>{
 const s=scene();s.characters[0].lightRadius=2;s.entities=[{id:'door',type:'feature',subtype:'door',x:3,y:3,orientation:'vertical',doorState:'closed'}];
 recomputeVisibility(s);
 assert.ok(s.visibility.closedDoorVisibleSides.get('door')?.has('left'));
 assert.equal(s.visibility.closedDoorExploredSides.get('door')?.has('left')||false,false);
 assert.ok(s.visibility.closedDoorExploredSides.get('door')?.has('right'));
 assert.equal(isTileFullyExplored(s,3,3),false);
 delete s.characters[0].visualX;delete s.characters[0].visualY;s.characters[0].x=1;recomputeVisibility(s);
 assert.equal(isTileFullyExplored(s,3,3),true);
});
test('changed exploration eligibility is not hidden by a repeated-light cache hit',()=>{
 const s=scene();let allowed=false;
 const lights=[{source:{routeId:''},polygon:[[54,54],[108,54],[108,108],[54,108]]}];
 rememberLightPolygons(s,lights,{allowed:()=>allowed});assert.equal(isTileFullyExplored(s,1,1),false);
 allowed=true;rememberLightPolygons(s,lights,{allowed:()=>allowed});assert.equal(isTileFullyExplored(s,1,1),true);
});
