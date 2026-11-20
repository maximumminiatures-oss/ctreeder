import test from 'node:test';
import assert from 'node:assert/strict';
import {WATER_PROFILES,chooseWaterProfile,applyDungeonWater} from '../../S3_content/src/water-generation.js';
import {SeededRng} from '../../S3_content/src/rng.js';
function scene(){return {map:{width:20,height:10},generation:{entranceRoomId:'a'},rooms:[{id:'a'},{id:'b'},{id:'c'},{id:'d'}],
 tiles:Array.from({length:200},(_,i)=>({x:i%20,y:Math.floor(i/20),type:'floor',roomId:'abcd'[Math.floor(i%20/5)],meta:{}})),decor:{},entities:[]};}
test('water category intervals exactly match 25/35/20/15/5 percent',()=>{
 const counts={};for(let roll=1;roll<=100;roll++){const name=chooseWaterProfile({nextInt:()=>roll}).category;counts[name]=(counts[name]||0)+1;}
 assert.deepEqual(counts,{none:25,low:35,medium:20,high:15,'water-dungeon':5});
});
for(const profile of WATER_PROFILES)test(profile.category+' water target is deterministic and preserves its cluster limit',()=>{
 const a=scene(),b=scene(),first=applyDungeonWater(a,new SeededRng(22),profile),second=applyDungeonWater(b,new SeededRng(22),profile);
 assert.deepEqual(a,b);assert.ok(Math.abs(first.actualTiles-Math.round(200*profile.fraction))<=4,'complete center neighborhoods stay within four tiles of the approximate target');assert.ok(first.groups<=profile.maxGroups);
 if(profile.category==='high')assert.ok(first.floodedRoomIds.length);
});
test('authored water exceeding a category is retained and allowed to exceed the target',()=>{
 const s=scene();s.tiles.slice(0,20).forEach(t=>t.meta.slowWater=true);
 const result=applyDungeonWater(s,new SeededRng(3),WATER_PROFILES[1]);
 assert.equal(result.authoredOvershoot,true);assert.equal(result.actualTiles,20);assert.equal(s.tiles.filter(t=>t.meta.slowWater).length,20);
 assert.deepEqual(s.decor.water,[]);
});
