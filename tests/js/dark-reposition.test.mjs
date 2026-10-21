import test from 'node:test';
import assert from 'node:assert/strict';
import { planDarkReposition } from '../../S3_content/src/pursuit.js';
import { makeUnderpass, routeStep, routeOf } from '../../S3_content/src/underpasses.js';

function scene() {return {map:{width:15,height:9},tiles:Array.from({length:135},(_,i)=>({x:i%15,y:Math.floor(i/15),type:'floor'}))};}
const creature=extra=>({x:4,y:4,I:0,darkGuess:{x:4,y:4,routeId:''},...extra});
const options=extra=>({movement:6,canStep:()=>true,canAttackFrom:(x,y)=>Math.hypot(x-1,y-4)<=6,
  isIlluminated:()=>false,...extra});

test('correctly guessed intelligent ranged monsters move to another unlit firing square within their budget',()=>{
  const state=scene(),foe=creature(),target={x:1,y:4};
  const plan=planDarkReposition(state,foe,target,options({preferRange:true,isIlluminated:(x,y)=>y!==4}));
  assert.deepEqual([plan.x,plan.y],[7,4]);assert.equal(plan.cost,3);assert.equal(plan.attackReady,true);
  assert.equal(plan.steps.length,3);assert.ok(plan.distance<=6);assert.equal(foe.x,4);
});

test('unintelligent, unguessed, already moved, lit and sleeping monsters do not reposition',()=>{
  const state=scene(),target={x:1,y:4};
  for(const foe of [creature({I:-1}),creature({darkGuess:null}),creature({x:5}),creature({conditions:{sleeping:{}}})])
    assert.equal(planDarkReposition(state,foe,target,options()),null);
  assert.equal(planDarkReposition(state,creature(),target,options({isIlluminated:()=>true})),null);
  assert.equal(planDarkReposition(state,creature(),target,options({movement:0})),null);
});

test('melee monsters can circle to an unlit adjacent square but never finish outside favored attack reach',()=>{
  const state=scene(),foe=creature({x:3,darkGuess:{x:3,y:4,routeId:''}}),target={x:2,y:4};
  const plan=planDarkReposition(state,foe,target,options({movement:3,
    canAttackFrom:(x,y)=>Math.max(Math.abs(x-target.x),Math.abs(y-target.y))<=1,
    isIlluminated:(x,y)=>x===3&&y===3}));
  assert.ok(plan);assert.ok(plan.steps.length>0);assert.ok(plan.cost<=3);
  assert.ok(Math.max(Math.abs(plan.x-target.x),Math.abs(plan.y-target.y))<=1);
  assert.notDeepEqual([plan.x,plan.y],[foe.x,foe.y]);assert.notDeepEqual([plan.x,plan.y],[3,3]);
});

test('wall and occupied-square callbacks remain authoritative; water costs are paid on departure',()=>{
  const state=scene(),foe=creature(),target={x:1,y:4};
  const plan=planDarkReposition(state,foe,target,options({preferRange:true,movement:3,
    canStep:(x,y,nx,ny)=>ny===4&&nx!==6,stepCost:(x)=>x===4?2:1}));
  assert.deepEqual([plan.x,plan.y],[5,4]);assert.equal(plan.cost,2);
  assert.equal(planDarkReposition(state,foe,target,options({canStep:()=>false})),null);
  assert.equal(planDarkReposition(state,foe,target,options({isIlluminated:(x,y)=>x!==4||y!==4})),null);
});

test('lower-route repositioning cannot turn through the crossing or attack the upper route',()=>{
  const state=scene();state.underpasses=[makeUnderpass('below',Array.from({length:11},(_,i)=>({x:i+2,y:4})),
    {x:7,y:4},[{x:1,y:4},{x:13,y:4}])];
  const foe=creature({x:7,routeId:'below',darkGuess:{x:7,y:4,routeId:'below'}}),target={x:3,y:4,routeId:'below'};
  const plan=planDarkReposition(state,foe,target,options({movement:2,preferRange:true}));
  assert.ok(plan);assert.ok(plan.steps.every(point=>point.y===4&&point.routeId==='below'));
  let position=foe;for(const step of plan.steps){assert.ok(routeStep(state,position,step));position=step;}
  assert.equal(routeOf(state,position),'below');
  assert.equal(planDarkReposition(state,foe,{...target,routeId:''},options({movement:2})),null);
});
