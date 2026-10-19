import test from 'node:test';
import assert from 'node:assert/strict';
import { movementStepCost, isSlowWaterTile, movementOverlayRadius } from '../../S3_content/src/terrain-movement.js';
import { canMoveBetweenTiles } from '../../S3_content/src/interactions.js';
import { REVIEWED_LAYOUTS } from '../../S3_content/src/reviewed-layout-data.js';
import { applyReviewedLayout, poseLayout } from '../../S3_content/src/reviewed-layouts.js';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { planClickMovement } from '../../S3_content/src/targeting.js';
import { combatStepBlock } from '../../S3_content/src/combat-rules.js';

function scene() {
  return { map:{width:7,height:3}, tiles:Array.from({length:21},(_,i)=>({x:i%7,y:Math.floor(i/7),type:Math.floor(i/7)===1?'floor':'wall',meta:{}})),
    entities:[],characters:[{id:'hero',name:'Hero',x:1,y:1,hp:10}],player:{x:1,y:1,torchLit:true},
    visibility:{visibleNow:new Set(Array.from({length:7},(_,x)=>x+',1'))},decor:{canals:[{assetKey:'canal-center-piece',x:2,y:1,blocksMovement:true}]},combat:{movementRemaining:3}};
}

test('legacy blocked canal water is walkable and costs two only when leaving it',()=>{
  const state=scene();
  assert.equal(canMoveBetweenTiles(state,1,1,2,1).ok,true);
  assert.equal(canMoveBetweenTiles(state,2,1,3,1).ok,true);
  assert.equal(movementStepCost(state,1,1),1);
  assert.equal(movementStepCost(state,2,1),2);
  assert.equal(movementOverlayRadius(state,2,1,6),3);
  assert.equal(movementOverlayRadius(state,1,1,6),6);
  assert.equal(canMoveBetweenTiles(state,2,1,2,0).ok,false);
  state.decor.wells=[{x:3,y:1,widthTiles:1,heightTiles:1,blocksMovement:true}];
  assert.equal(canMoveBetweenTiles(state,2,1,3,1).ok,false);
});

test('water pathfinding uses weighted budgets and prevents ending on an ally after a two-point step',()=>{
  const state=scene(),hero=state.characters[0];
  assert.equal(planClickMovement(state,hero,3,1,3).length,2);
  assert.deepEqual(planClickMovement(state,hero,3,1,2),[]);
  assert.equal(planClickMovement(state,hero,2,1,1).length,1);
  hero.x=2; state.characters.push({id:'friend',name:'Friend',x:3,y:1}); state.combat.movementRemaining=2;
  assert.match(combatStepBlock(state,hero,3,1),/can't end turn/);
  hero.x=1;state.characters[1].x=2;
  assert.match(combatStepBlock(state,hero,2,1),/can't end turn/);
});

test('reviewed water converts in every rotation/reflection without making bridges or pillars slow',()=>{
  for(const source of REVIEWED_LAYOUTS.filter(layout=>/canal/.test(layout.id))) for(let turn=0;turn<4;turn++) for(const flip of [false,true]) {
    const state=createEmptyDungeonState(1),layout=poseLayout(source,turn,flip);
    const {isolated}=applyReviewedLayout(state,layout,5,5,'r',null,new SeededRng(1));
    assert.ok(isolated.every(([x,y])=>!isSlowWaterTile(state,x,y)));
    let water=0;
    for(const tile of state.tiles) if(isSlowWaterTile(state,tile.x,tile.y)) {
      water++;
      assert.equal(canMoveBetweenTiles(state,tile.x,tile.y,tile.x,tile.y).ok,true,source.id+':'+tile.x+','+tile.y);
    }
    assert.ok(water>0);
    for(const item of state.decor.reviewed.filter(p=>/bridge/.test(p.assetKey))) assert.equal(isSlowWaterTile(state,item.x,item.y),false);
  }
});

test('old reviewed water flags and anonymous edges are migrated without unblocking unrelated terrain',()=>{
  const state=scene(); state.decor.canals=[];
  state.decor.reviewed=[{assetKey:'canal-center-piece',x:2,y:1,gridWidthTiles:1,gridHeightTiles:1}];
  state.decor.reviewedMovement=[[[2,1],[2,2]],[[3,1],[3,2]],[[4,1],[4,2]]];
  getTile(state,2,1).meta.layoutBlocks=true;
  assert.equal(canMoveBetweenTiles(state,1,1,2,1).ok,true);
  assert.equal(canMoveBetweenTiles(state,2,1,3,1).ok,true);
  assert.equal(canMoveBetweenTiles(state,3,1,4,1).ok,false);
});
