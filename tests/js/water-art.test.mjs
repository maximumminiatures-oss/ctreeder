import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildWaterArtwork,waterArtBounds,authoredWaterBounds,repairGeneratedWaterArtwork} from '../../S3_content/src/water-art.js';
import {serializeDungeonState,hydrateDungeonState} from '../../S3_content/src/persistence.js';
import {createEmptyDungeonState,getTile} from '../../S3_content/src/state-schema.js';
const key=(x,y)=>x+','+y;
function scene(){
 const s=createEmptyDungeonState(17);s.map={width:10,height:10};s.tiles=Array.from({length:100},(_,i)=>({x:i%10,y:Math.floor(i/10),type:'floor',meta:{}}));s.decor={water:[],reviewed:[],canals:[]};return s;
}
function patch(){return new Set(Array.from({length:9},(_,i)=>key(3+i%3,3+Math.floor(i/3))));}
const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
test('center regions receive the old explicit assets and correctly oriented edges/corners',()=>{
 const s=scene(),art=buildWaterArtwork(s,patch());assert.equal(art.length,9);
 const at=(x,y)=>art.find(t=>t.x===x&&t.y===y);
 assert.equal(at(4,4).assetKey,'water-c');
 for(const [x,y,d]of [[3,3,'nw'],[5,3,'ne'],[5,5,'se'],[3,5,'sw']]){assert.match(at(x,y).assetKey,/^water-nw-/);assert.equal(at(x,y).direction,d);}
 for(const [x,y,d]of [[4,3,'n'],[5,4,'e'],[4,5,'s'],[3,4,'w']]){assert.match(at(x,y).assetKey,/^water-nn-/);assert.equal(at(x,y).direction,d);}
 assert.ok(art.every(t=>t.flipX===false&&t.flipY===false&&t.rotationTurns===0&&t.nudgeX===0&&t.nudgeY===0));
});
test('a basic wall replaces its adjacent shoreline side',()=>{
 const s=scene();for(let y=3;y<=5;y++)getTile(s,2,y).type='wall';
 const art=buildWaterArtwork(s,patch());assert.equal(art.find(t=>t.x===3&&t.y===4).assetKey,'water-c');
 assert.equal(art.find(t=>t.x===3&&t.y===3).direction,'n');
});
test('generated shore fringes and centers never overlap other water, including authored art',()=>{
 const s=scene();s.decor.reviewed=[{assetKey:'water-nn-1',x:2.75,y:2.5,gridWidthTiles:1,gridHeightTiles:1.5,rotationTurns:1}];
 const original=structuredClone(s.decor.reviewed),wet=patch();wet.add('6,4');wet.add('6,5');wet.add('4,2');
 const art=buildWaterArtwork(s,wet),painted=authoredWaterBounds(s);
 assert.equal(new Set(art.map(t=>key(t.x,t.y))).size,art.length);
 for(const item of art)for(const r of item.clipRects||[waterArtBounds(item)]){
  assert.ok(painted.every(other=>!overlaps(r,other)),JSON.stringify({item,r}));painted.push(r);
 }
 assert.deepEqual(s.decor.reviewed,original);
});
test('legacy generated-art repair preserves water, exploration, party and physical money through save/load',()=>{
 const s=scene();s.generation.waterPlan={version:1,category:'medium'};
 for(const k of patch()){const [x,y]=k.split(',').map(Number);getTile(s,x,y).meta.slowWater=true;s.decor.water.push({x,y,variant:'nn',direction:'n',generatedWater:true});}
 s.characters=[{id:'hero',name:'Ad',className:'Fighter',hp:8,maxHitPoints:8,x:4,y:4,copper:700,gear:[],stats:{},raw:{}}];s.activeCharacterId='hero';s.player.x=4;s.player.y=4;s.visibility.exploredEver=new Set(['4,4']);
 const raw=serializeDungeonState(s),before=structuredClone(raw),loaded=hydrateDungeonState(raw);
 assert.deepEqual(raw,before);assert.equal(loaded.characters[0].copper,700);assert.equal(loaded.characters[0].hp,8);
 assert.deepEqual(loaded.tiles,raw.tiles);assert.deepEqual([...loaded.visibility.exploredEver],['4,4']);
 assert.equal(loaded.generation.waterPlan.artVersion,2);assert.ok(loaded.decor.water.every(t=>t.assetKey));
 const art=structuredClone(loaded.decor.water);repairGeneratedWaterArtwork(loaded);assert.deepEqual(loaded.decor.water,art);
});
test('all four flat edges keep the old half-tile native snap without vertical fallback flips',()=>{
 const source=readFileSync(new URL('../../S3_content/src/render.js',import.meta.url),'utf8');
 const names=['pickDeterministicImage','getImageTileSize','cardinalToRotationTurns','drawSnappedWaterFlatTile','getWaterImageAndRotation'];
 const image={naturalWidth:54,naturalHeight:81},context=vm.createContext({TILE_SIZE_PX:54,rendererAssets:{decor:{waterByKey:{'water-nn-1':image},waterFlat:[image]}},hashString:()=>1});
 for(const name of names){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+10);vm.runInContext(source.slice(start,end),context);}
 for(const [direction,expected]of [['n',[189,175.5]],['e',[202.5,189]],['s',[189,202.5]],['w',[175.5,189]]]){
  let point;const ctx={save(){},restore(){},translate(...args){point=args;},rotate(){},scale(x,y){assert.equal(y,1);},drawImage(){}};
  const spec=context.getWaterImageAndRotation({x:3,y:3,variant:'nn',direction,assetKey:'water-nn-1'},{seed:1});
  context.drawSnappedWaterFlatTile(ctx,image,3,3,spec.direction,spec.rotationTurns,spec.offsetXPx,spec.offsetYPx,spec.flipX,spec.flipY);assert.deepEqual(point,expected);
  assert.equal(context.getWaterImageAndRotation({x:3,y:3,variant:'nn',direction},{seed:1}).flipY,false);
 }
});

test('water animation reuses visibility polygons only within the same frame and recomputes after movement',async()=>{
 const source=readFileSync(new URL('../../S3_content/src/main.js',import.meta.url),'utf8');
 const start=source.indexOf('function animateLocalWaterStep('),end=source.indexOf('\nfunction ',start+10);
 const actor={id:'hero',x:4,y:4},state={characters:[actor]},motions=new Map(),renders=[],calculations=[];
 let clock=0;
 const context=vm.createContext({state,multiplayerSession:{},performance:{now:()=>0},WATER_STEP_DURATION_MS:320,
  localWaterMotions:motions,setSharedCharacterVisualPosition(){},clearSharedCharacterVisualPosition(){},
  nextAnimationFrame:async()=>{clock+=100;return clock;},
  recomputeVisibility:()=>{const polygons=[{frame:clock}];calculations.push(polygons);return polygons;},
  render:options=>renders.push(options)});
 vm.runInContext(source.slice(start,end),context);context.animateLocalWaterStep(actor,{x:3,y:4});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(motions.size,0);assert.equal(calculations.length,5);assert.equal(renders.length,5);
 for(let i=0;i<renders.length;i++)assert.equal(renders[i].lightPolygons,calculations[i]);
 assert.notEqual(renders[0].lightPolygons,renders[1].lightPolygons);
});
