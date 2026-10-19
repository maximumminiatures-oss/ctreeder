import test from 'node:test';
import assert from 'node:assert/strict';
import { planRestScene, restTourFrame } from '../../S3_content/src/rest-scene.js';
import { beginPartyRest, advancePartyRest, cancelPartyRest } from '../../S3_content/src/rest.js';

function scene(count=3) {
  const state={map:{width:11,height:11},tiles:[],rooms:[{id:'r'}],entities:[],combat:{active:false},player:{},
    characters:Array.from({length:count},(_,i)=>({id:`p${i}`,name:`P${i}`,hp:5,maxHitPoints:8,x:3+i%5,y:4,roomId:'r',
      stats:{CON:10},gear:[{name:'Torch',quantity:3},{name:'Rations',quantity:1}]})),visibility:{exploredEver:new Set(),visibleNow:new Set()}};
  for(let y=0;y<11;y++)for(let x=0;x<11;x++) {
    const floor=x>=2&&x<=8&&y>=2&&y<=8;
    state.tiles.push({x,y,type:floor?'floor':'wall',roomId:floor?'r':null,meta:{}});
    if(floor)state.visibility.exploredEver.add(`${x},${y}`);
  }
  return state;
}
const restFor=state=>({roomId:'r',participantIds:state.characters.filter(c=>!c.summon).map(c=>c.id)});

test('camp uses explored safe room center, with unique placements and discs outside eight characters',()=>{
  const state=scene(8);state.characters.push({id:'disc',roomId:'r',summon:{kind:'floating-disc',casterId:'p0'}});
  const plan=planRestScene(state,restFor(state),100);
  assert.deepEqual([plan.x,plan.y],[5,5]);assert.equal(new Set(plan.placements.map(p=>`${p.x},${p.y}`)).size,9);
  for(const place of plan.placements.slice(0,8))assert.equal(Math.max(Math.abs(place.x-5),Math.abs(place.y-5)),1);
  assert.equal(Math.max(Math.abs(plan.placements[8].x-5),Math.abs(plan.placements[8].y-5)),2);
});

test('partial exploration, traps, terrain blocks and living monsters constrain every placement',()=>{
  const state=scene();state.visibility.exploredEver=new Set([...state.visibility.exploredEver].filter(key=>Number(key.split(',')[0])<=5));
  state.entities.push({type:'trap',x:4,y:5},{type:'monster',x:3,y:5});state.tiles[4*11+4].meta.layoutBlocks=true;
  const plan=planRestScene(state,restFor(state));
  for(const point of [plan,...plan.placements]) {
    assert.ok(point.x<=5);assert.notEqual(`${point.x},${point.y}`,'4,5');assert.notEqual(`${point.x},${point.y}`,'3,5');assert.notEqual(`${point.x},${point.y}`,'4,4');
  }
});

test('Alarm visits discovered room-side exits, rotates all four sides and returns to its camp slot',()=>{
  const state=scene();
  for(const [side,x,y]of[['north',5,1],['east',9,5],['south',5,9],['west',1,5]]) {
    state.entities.push({id:side,type:'feature',subtype:'door',wallSide:side,x,y,doorState:'closed'});
    state.visibility.exploredEver.add(`${x},${y}`);
  }
  state.entities.push({id:'secret',type:'feature',subtype:'door',wallSide:'north',x:3,y:1,secret:true,doorState:'closed'});
  const rest={...restFor(state),alarm:{casterId:'p0'}};const plan=planRestScene(state,rest,100);
  assert.equal(plan.markers.length,4);assert.deepEqual(plan.markers.map(m=>m.rotation).sort(),[0,1,2,3]);
  assert.deepEqual(plan.route[0],plan.route.at(-1));assert.equal(plan.route[0].x,plan.placements[0].x);
  assert.equal(restTourFrame(plan,100).active,true);assert.equal(restTourFrame(plan,100+plan.durationMs).active,false);
  assert.equal(restTourFrame(plan,100+plan.durationMs).markers.length,4);
});

test('rest gathers the real tokens and delays hours until Alarm tour finishes; resumption does not rerun it',()=>{
  const state=scene();state.entities.push({type:'feature',subtype:'door',wallSide:'north',x:5,y:1,doorState:'closed'});
  state.visibility.exploredEver.add('5,1');state.preparedAlarm={roomId:'r',casterId:'p0',encounterDivisor:2};
  beginPartyRest(state,{safe:true,now:100});const duration=state.rest.scene.durationMs;
  assert.ok(duration>=2500);assert.equal(advancePartyRest(state,{now:100+duration}),null);
  assert.equal(state.rest.hours,0);advancePartyRest(state,{now:100+duration+1000});assert.equal(state.rest.hours,1);
  for(const place of state.rest.scene.placements) {
    const character=state.characters.find(c=>c.id===place.characterId);assert.equal(character.x,place.x);assert.equal(character.y,place.y);
  }
  cancelPartyRest(state);
  const resumedAt=100+duration+1100;beginPartyRest(state,{safe:true,now:resumedAt});
  assert.equal(restTourFrame(state.rest.scene,resumedAt).active,false);
  assert.equal(state.rest.nextHourAt,resumedAt+1000);
});

test('unexplored exits and unknown secret doors get no Alarm marker',()=>{
  const state=scene();state.entities.push({type:'feature',subtype:'door',wallSide:'north',x:5,y:1,doorState:'closed'});
  const plan=planRestScene(state,{...restFor(state),alarm:{casterId:'p0'}});
  assert.equal(plan.markers.length,0);assert.equal(plan.durationMs,0);
});
