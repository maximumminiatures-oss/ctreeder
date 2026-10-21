import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { buildMonsterCompanion } from '../../S3_content/src/companions.js';
import { collectLightSources, isTileIlluminated } from '../../S3_content/src/light-geometry.js';
import { recomputeVisibility, isTileVisible, isTilePerceived } from '../../S3_content/src/visibility.js';
import { visibleDungeonEntities, drawAnimatedArmorStatue, drawDarkvisionFog, renderDungeon } from '../../S3_content/src/render.js';
import { isFeatureCurrentlyVisible } from '../../S3_content/src/monster-perception.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { makeUnderpass } from '../../S3_content/src/underpasses.js';

function scene() {
  const state=createEmptyDungeonState(111);
  state.map={width:25,height:9};
  state.tiles=Array.from({length:225},(_,i)=>({x:i%25,y:Math.floor(i/25),type:'floor',meta:{}}));
  state.player={x:2,y:4,torchLit:false,lightRadius:0};
  state.characters=[buildMonsterCompanion({id:'friend',name:'Orc',type:'monster',hp:10,x:2,y:4,I:0})];
  return state;
}

test('darkvision reveals explored dim terrain and visible features, never physical light or hidden traps/doors',()=>{
  const state=scene();
  const entities=[{id:'foe',type:'monster',name:'Bandit',hp:8,x:8,y:4},
    {id:'gold',type:'treasure',x:9,y:4},{id:'trap',type:'trap',x:5,y:4},
    {id:'known-trap',type:'trap',x:6,y:5,revealed:true},
    {id:'secret',type:'feature',subtype:'door',x:6,y:0,secret:true,doorState:'closed'},
    {id:'unseen',type:'treasure',x:24,y:4}];
  state.entities=entities;recomputeVisibility(state);
  assert.equal(collectLightSources(state).length,0); assert.equal(state.visibility.visibleNow.size,0);
  assert.equal(state.visibility.routeVisible[''],undefined);assert.equal(isTileVisible(state,8,4),false);
  assert.equal(isTileIlluminated(state,8,4),false);assert.equal(isTilePerceived(state,8,4),true);
  assert.ok(state.visibility.exploredEver.has('8,4'));assert.ok(state.visibility.routeExplored[''].has('8,4'));
  const ids=visibleDungeonEntities(state,{darkness:true}).map(entity=>entity.id);
  assert.deepEqual(ids,['foe','gold','known-trap']);
  assert.equal(isFeatureCurrentlyVisible(state,entities[2]),false);
  assert.equal(state.visibility.darkvisionNow.has('6,0'),false);
});

test('walls, sleeping companions and local multiplayer viewer filters remove current vision, not remembered dim terrain',()=>{
  const state=scene();recomputeVisibility(state);
  assert.ok(state.visibility.darkvisionNow.has('8,4'));
  const companion=state.characters[0];companion.conditions={sleeping:{}};recomputeVisibility(state);
  assert.equal(state.visibility.darkvisionNow.size,0);
  assert.ok(state.visibility.routeDarkvisionExplored[''].has('8,4'));
  companion.conditions={};state.viewerCharacterIds=new Set(['someone-else']);recomputeVisibility(state);
  assert.equal(state.visibility.darkvisionNow.size,0);
  delete state.viewerCharacterIds;
  for(let y=0;y<state.map.height;y++)state.tiles[y*25+5].type='wall';
  recomputeVisibility(state);assert.equal(state.visibility.darkvisionNow.has('8,4'),false);
});

test('upper and lower route darkvision do not reveal each other at a shared crossing',()=>{
  const state=scene();state.map={width:15,height:9};
  state.tiles=Array.from({length:135},(_,i)=>({x:i%15,y:Math.floor(i/15),type:'floor',meta:{}}));
  state.underpasses=[makeUnderpass('below',Array.from({length:11},(_,i)=>({x:i+2,y:4})),
    {x:7,y:4},[{x:1,y:4},{x:13,y:4}])];
  Object.assign(state.characters[0],{x:6,y:4,routeId:'below'});
  state.entities=[{id:'above',type:'monster',name:'Orc',hp:8,x:7,y:4,routeId:''},
    {id:'below',type:'monster',name:'Orc',hp:8,x:7,y:4,routeId:'below'},
    {id:'upper-gold',type:'treasure',x:7,y:4,routeId:''},{id:'lower-gold',type:'treasure',x:7,y:4,routeId:'below'}];
  recomputeVisibility(state);
  assert.equal(isTilePerceived(state,7,4,{x:7,y:4,routeId:''}),false);
  assert.equal(isTilePerceived(state,7,4,{x:7,y:4,routeId:'below'}),true);
  assert.deepEqual(visibleDungeonEntities(state,{darkness:true}).map(entity=>entity.id),['below','lower-gold']);
  assert.ok(state.visibility.routeDarkvisionExplored.below.has('7,4'));
  assert.equal(state.visibility.routeDarkvisionExplored[''],undefined);
  const loaded=hydrateDungeonState(serializeDungeonState(state));
  assert.ok(loaded.visibility.routeDarkvisionExplored.below.has('7,4'));
  assert.equal(loaded.visibility.routeDarkvisionExplored[''],undefined);
});

test('save/load retains explored route data and rebuilds darkvision without restoring fake illumination',()=>{
  const state=scene();recomputeVisibility(state);
  const saved=serializeDungeonState(state);
  assert.deepEqual(saved.visibility.visibleNow,[]);assert.ok(saved.visibility.routeExplored[''].includes('8,4'));
  const loaded=hydrateDungeonState(JSON.parse(JSON.stringify(saved)));
  loaded.player.torchLit=false;recomputeVisibility(loaded);
  assert.equal(collectLightSources(loaded).length,0);assert.equal(loaded.visibility.visibleNow.size,0);
  assert.ok(loaded.visibility.routeDarkvision[''].has('8,4'));
  loaded.characters[0].x=24;recomputeVisibility(loaded);
  assert.equal(loaded.visibility.darkvisionNow.has('8,4'),false);
  assert.ok(loaded.visibility.routeDarkvisionExplored[''].has('8,4'));
});

test('saving after a companion leaves a remote room preserves its dim terrain memory after reload',()=>{
  const state=scene();state.tiles.forEach(tile=>{tile.roomId='remote';});recomputeVisibility(state);
  state.characters[0].x=24;recomputeVisibility(state);
  assert.equal(state.visibility.darkvisionNow.has('8,4'),false);
  const saved=serializeDungeonState(state);
  assert.ok(saved.visibility.routeDarkvisionExplored[''].includes('8,4'));
  assert.equal(saved.visibility.routeDarkvision,undefined);assert.equal(saved.visibility.darkvisionNow,undefined);
  const loaded=hydrateDungeonState(JSON.parse(JSON.stringify(saved)));
  assert.equal(loaded.visibility.darkvisionNow.size,0);assert.deepEqual(loaded.visibility.routeDarkvision,{});
  assert.ok(loaded.visibility.routeDarkvisionExplored[''] instanceof Set);
  loaded.player.torchLit=false;recomputeVisibility(loaded);
  assert.equal(loaded.visibility.darkvisionNow.has('8,4'),false);
  assert.ok(loaded.visibility.routeDarkvisionExplored[''].has('8,4'));
  const calls=[],ctx=new Proxy({fillStyle:'',fillRect(...args){calls.push({style:this.fillStyle,args});}},
    {get:(object,key)=>key in object?object[key]:()=>{}});
  drawDarkvisionFog(loaded,ctx);
  assert.ok(calls.some(call=>call.style==='rgba(0, 0, 0, 0.45)'&&call.args[0]===8*54&&call.args[1]===4*54));
  delete saved.visibility.routeDarkvisionExplored;
  const legacy=hydrateDungeonState(saved);assert.deepEqual(legacy.visibility.routeDarkvisionExplored,{});
  saved.visibility.routeDarkvisionExplored={'':[null,{},42,'invalid','8,4']};
  const cleaned=hydrateDungeonState(saved);assert.deepEqual([...cleaned.visibility.routeDarkvisionExplored['']],['8,4']);
});

test('Animated Armor renders as a statue only while currently visible; revealed armor returns to a token',()=>{
  const state=scene(), armor={id:'armor',type:'monster',name:'Animated Armor',hp:10,x:5,y:4};state.entities=[armor];
  recomputeVisibility(state);assert.deepEqual(visibleDungeonEntities(state).map(entity=>entity.id),['armor']);
  const image={name:'statue'},calls=[];
  assert.equal(drawAnimatedArmorStatue(state,armor,{drawImage:(...args)=>calls.push(args)},image),true);
  assert.equal(calls[0][0],image);assert.deepEqual(calls[0].slice(1),[5*54,4*54,54,54]);
  armor.disguiseRevealed=true;assert.equal(drawAnimatedArmorStatue(state,armor,{drawImage:()=>assert.fail()},image),false);
  armor.disguiseRevealed=false;state.characters[0].x=24;recomputeVisibility(state);
  assert.deepEqual(visibleDungeonEntities(state),[]);
});

test('the rendered dim fog remembers remote rooms and motion frames remove newly unseen features',()=>{
  const state=scene();state.entities=[{id:'gold',type:'treasure',x:8,y:4}];recomputeVisibility(state);
  const fills=[],ctx=new Proxy({fillStyle:'',globalAlpha:1,globalCompositeOperation:'source-over',
    fillRect(...args){fills.push({style:this.fillStyle,args});}}, {get:(object,key)=>key in object?object[key]:()=>{}});
  drawDarkvisionFog(state,ctx);
  assert.ok(fills.some(call=>call.style==='rgba(0, 0, 0, 0.45)'&&call.args[0]===8*54&&call.args[1]===4*54));
  let clears=0;
  const objects=new Proxy({clearRect:()=>clears++},{get:(object,key)=>key in object?object[key]:()=>{}});
  renderDungeon(state,{objectsCtx:objects,fogCtx:ctx},{motionOnly:true});
  const first=clears;state.characters[0].x=24;recomputeVisibility(state);
  renderDungeon(state,{objectsCtx:objects,fogCtx:ctx},{motionOnly:true});
  assert.equal(clears,first+1);
});

test('Shred still obscures darkvision features and saved dim-memory arrays are restored as route-specific sets',()=>{
  const state=scene();
  state.visibility.routeDarkvisionExplored={'':['20,4']};
  state.entities=[{id:'shred',type:'feature',subtype:'arcane-shred',x:8,y:4,radius:2},
    {id:'hidden-gold',type:'treasure',x:8,y:4},{id:'foe',type:'monster',name:'Orc',hp:8,x:8,y:4}];
  recomputeVisibility(state);
  assert.ok(state.visibility.routeDarkvisionExplored[''] instanceof Set);
  assert.ok(state.visibility.routeDarkvisionExplored[''].has('20,4'));
  assert.equal(state.visibility.routeDarkvision[''].has('8,4'),false);
  assert.equal(visibleDungeonEntities(state).some(entity=>['hidden-gold','foe'].includes(entity.id)),false);
});
