import {makeUnderpass} from '../../S3_content/src/underpasses.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {computeLightPolygon,withLightPolygonCache} from '../../S3_content/src/light-geometry.js';
import {lightPolygonCacheStats,reuseExactLightPolygon,LIGHT_POLYGON_CACHE_LIMIT,LIGHT_POLYGON_CACHE_BYTES} from '../../S3_content/src/light-polygon-cache.js';
import {createEmptyDungeonState} from '../../S3_content/src/state-schema.js';
import {setInnerWallTileMeta} from '../../S3_content/src/inner-walls.js';
function scene(){
 const s=createEmptyDungeonState(7);s.map={width:12,height:10};s.tiles=Array.from({length:120},(_,i)=>({x:i%12,y:Math.floor(i/12),type:i%12===0||i%12===11||i<12||i>=108?'wall':'floor',meta:{}}));
 s.entities=[{id:'door',type:'feature',subtype:'door',x:5,y:4,orientation:'vertical',doorState:'closed'}];s.decor={columns:[]};return s;
}
const source={x:3,y:4,radius:6};
test('identical shadow inputs reuse geometry across visibility passes without caching perception',()=>{
 const s=scene(),first=withLightPolygonCache(s,()=>computeLightPolygon(s,source));
 const second=withLightPolygonCache(s,()=>computeLightPolygon(s,{...source}));assert.equal(first,second);
 s.viewerCharacterIds=new Set(['different-viewer']);s.visibility.visibleNow.clear();
 assert.equal(computeLightPolygon(s,source),first);assert.equal(s.visibility.visibleNow.size,0);
 assert.ok(lightPolygonCacheStats(s).hits>=2);
});
test('door, pillar, wall, source, radius and visual-center changes always match uncached exact shadows',()=>{
 const s=scene();let light={...source};
 const actions=[()=>{},()=>s.entities[0].doorState='open',()=>s.entities[0].doorState='closed',
  ()=>s.decor.columns.push({x:4,y:4,blocksMovement:true}),()=>s.decor.columns[0].x=6,
  ()=>setInnerWallTileMeta(s.tiles[4*12+4],'1x1-wall-e.png'),
  ()=>s.tiles[3*12+4].type='wall',()=>light={...light,x:3.2},()=>light={...light,radius:8},
  ()=>s.tiles[4*12+3].meta.visualCenter=[.6,.4]];
 for(const change of actions){change();const cached=withLightPolygonCache(s,()=>computeLightPolygon(s,light));
  const direct=computeLightPolygon(s,light,{cache:false});assert.deepEqual(cached,direct);
  assert.deepEqual(computeLightPolygon(s,light,{ignorePillars:true}),computeLightPolygon(s,light,{ignorePillars:true,cache:false}));}
});
test('recruited/native route changes use the exact blocking segments for that route',()=>{
 const s=scene();s.underpasses=[makeUnderpass('lower',[{x:3,y:4},{x:4,y:4},{x:5,y:4}],{x:4,y:4},[{x:2,y:4},{x:6,y:4}])];
 for(const routeId of ['', 'lower']){
  const light={...source,routeId};assert.deepEqual(computeLightPolygon(s,light),computeLightPolygon(s,light,{cache:false}));
 }
});
test('geometry memo is bounded and scoped to the current world; eviction recomputes correctly',()=>{
 const s={},polygon=[[0,0],[1,0],[1,1]],segments=[[[0,0],[1,1]]];let calls=0;
 const compute=()=>{calls++;return polygon.map(p=>[...p]);};
 for(let x=0;x<1000;x++)reuseExactLightPolygon(s,[x,0],6,segments,compute);
 const stats=lightPolygonCacheStats(s);assert.ok(stats.entries<=LIGHT_POLYGON_CACHE_LIMIT);assert.ok(stats.estimatedBytes<=LIGHT_POLYGON_CACHE_BYTES);
 assert.deepEqual(reuseExactLightPolygon(s,[0,0],6,segments,compute),polygon);assert.equal(calls,1001);
 reuseExactLightPolygon({},[0,0],6,segments,compute);assert.equal(calls,1002);
});
