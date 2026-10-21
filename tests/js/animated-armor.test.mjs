import test from 'node:test';
import assert from 'node:assert/strict';
import { animatedArmorCanEnter, animatedArmorDisguiseAsset, concealedAnimatedArmor,
  initializeDisguises, shouldAnimatedArmorWait, updateAnimatedArmorDisguises, planWanderingArmorRetreat } from '../../S3_content/src/companions.js';
import { makeUnderpass } from '../../S3_content/src/underpasses.js';

const armor = extra => ({id:'armor',type:'monster',name:'Animated Armor',hp:12,x:4,y:4,I:-2,...extra});
const hero = extra => ({id:'hero',hp:8,x:2,y:4,...extra});

test('animated armor uses a stable statue disguise until an adjacent character reveals it', () => {
  const monster=armor(), state={seed:1,entities:[monster],characters:[hero()]}; initializeDisguises(state);
  assert.match(animatedArmorDisguiseAsset(monster),/^statue-1x1-[nesw]$/);
  assert.equal(monster.disguiseName,'Statue');
  assert.equal(concealedAnimatedArmor(monster),true); assert.deepEqual(monster.languages,[]);
  assert.equal(updateAnimatedArmorDisguises(state).length,0);
  state.characters[0].x=3; assert.deepEqual(updateAnimatedArmorDisguises(state).map(monster=>monster.id),['armor']);
  assert.equal(concealedAnimatedArmor(monster),false); assert.equal(monster.hostile,true);
  assert.equal(updateAnimatedArmorDisguises(state).length,0);
  const restored=JSON.parse(JSON.stringify(monster)); assert.equal(animatedArmorDisguiseAsset(restored),monster.statueAssetKey);
});

test('armor does not trigger across a wall, on another level, or for dead/asleep/summoned tokens', () => {
  for (const extra of [{hp:0},{conditions:{sleeping:{}}},{hp:1,summon:{kind:'floating-disc'}}]) {
    const state={entities:[armor()],characters:[hero({x:3,...extra})]}; assert.equal(updateAnimatedArmorDisguises(state).length,0);
  }
  const state={entities:[armor()],characters:[hero({x:3})]};
  assert.equal(updateAnimatedArmorDisguises(state,{hasLineOfSight:()=>false}).length,0);
  state.underpasses=[{id:'below',lowerCells:[{x:3,y:4},{x:4,y:4}],upperCrossings:[{x:3,y:4},{x:4,y:4}],portals:[]}];
  state.entities[0].routeId='';state.characters[0].routeId='below'; assert.equal(updateAnimatedArmorDisguises(state).length,0);
});

test('wandering armor waits outside the light and will not voluntarily enter a lit square while disguised', () => {
  const monster=armor(),state={entities:[monster],characters:[hero()]};
  assert.equal(shouldAnimatedArmorWait(state,monster),true);
  assert.equal(shouldAnimatedArmorWait(state,monster,{isIlluminated:()=>true}),false);
  assert.equal(animatedArmorCanEnter(state,monster,{x:3,y:4},{isIlluminated:()=>true}),false);
  monster.disguiseRevealed=true;
  assert.equal(shouldAnimatedArmorWait(state,monster),false);
  assert.equal(animatedArmorCanEnter(state,monster,{x:3,y:4},{isIlluminated:()=>true}),true);
});

function retreatScene() {
  return {map:{width:15,height:9},entities:[],characters:[],
    tiles:Array.from({length:135},(_,i)=>({x:i%15,y:Math.floor(i/15),type:'floor'}))};
}
const retreatOptions=extra=>({movement:6,isIlluminated:point=>point.x<8,
  canStep:(x,y,nx,ny)=>ny===4,...extra});

test('wandering armor retreats through lit intermediate cells to the closest reachable dark square',()=>{
  const state=retreatScene(),monster=armor({wandering:true});
  const plan=planWanderingArmorRetreat(state,monster,retreatOptions());
  assert.deepEqual([plan.x,plan.y],[8,4]);assert.equal(plan.cost,4);assert.equal(plan.escaped,true);
  assert.deepEqual(plan.steps.map(step=>step.x),[5,6,7,8]);assert.equal(monster.x,4);
  assert.deepEqual(plan.darkDestination,{x:8,y:4,routeId:''});
});

test('retreat progresses toward darkness beyond one movement budget and charges terrain on departure',()=>{
  const state=retreatScene(),monster=armor({wandering:true});
  const plan=planWanderingArmorRetreat(state,monster,retreatOptions({movement:2,stepCost:x=>x===4?2:1}));
  assert.deepEqual([plan.x,plan.y],[5,4]);assert.equal(plan.cost,2);assert.equal(plan.escaped,false);
  assert.equal(plan.remainingCost,3);assert.equal(plan.darkDestination.x,8);
  assert.equal(planWanderingArmorRetreat(state,monster,retreatOptions({movement:1,stepCost:()=>2})),null);
});

test('retreat stays outside character adjacency, honors geometry/occupancy, and does not move non-wandering or revealed statues',()=>{
  const state=retreatScene(),monster=armor({wandering:true});
  assert.equal(planWanderingArmorRetreat(state,monster,retreatOptions({canStep:()=>false})),null);
  assert.equal(planWanderingArmorRetreat(state,monster,retreatOptions({isIlluminated:()=>true})),null);
  state.characters=[hero({x:6})];
  assert.equal(planWanderingArmorRetreat(state,monster,retreatOptions()),null);
  state.characters=[hero({x:3})];
  assert.equal(planWanderingArmorRetreat(state,monster,retreatOptions()),null);
  state.characters=[];
  for(const extra of [{wandering:false},{disguiseRevealed:true},{conditions:{sleeping:{}}},{hp:0},{x:9}])
    assert.equal(planWanderingArmorRetreat(state,armor({wandering:true,...extra}),retreatOptions()),null);
});

test('retreat cannot turn into the upper route at an underpass crossing',()=>{
  const state=retreatScene();state.underpasses=[makeUnderpass('below',Array.from({length:11},(_,i)=>({x:i+2,y:4})),
    {x:7,y:4},[{x:1,y:4},{x:13,y:4}])];
  const monster=armor({x:6,routeId:'below',wandering:true});
  const plan=planWanderingArmorRetreat(state,monster,retreatOptions({isIlluminated:point=>point.x<9,canStep:()=>true}));
  assert.ok(plan);assert.ok(plan.steps.every(step=>step.y===4&&step.routeId==='below'));assert.equal(plan.x,9);
});
