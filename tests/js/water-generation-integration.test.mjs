import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateDungeon,generateClassicDungeon,isSafeDungeonArrival} from '../../S3_content/src/generator.js';
import {isSlowWaterTile} from '../../S3_content/src/terrain-movement.js';
import {waterHabitat} from '../../S3_content/src/water-habitats.js';
import {layoutContainsWater} from '../../S3_content/src/reviewed-layouts.js';
import {REVIEWED_LAYOUTS} from '../../S3_content/src/reviewed-layout-data.js';
import {dungeonArrivalPositions} from '../../S3_content/src/dungeon-descent.js';
const data=name=>JSON.parse(readFileSync(new URL('../../S3_content/'+name,import.meta.url)));
const monsters=data('monsters-4.json'),organic=data('data/organic-assets.json');
for(const category of ['none','low','medium','high','water-dungeon']){
 test('actual generated '+category+' floors retain connectivity, valid stairs and habitat placements',()=>{
  for(const architecturePattern of ['processional','organic']){
   const state=generateDungeon(90419,4,{architecturePattern,waterCategory:category,monsterTable:monsters,
    organicAssets:organic,underpasses:false,pits:false,partySize:4});
   const plan=state.generation.waterPlan;
   assert.equal(plan.category,category);assert.equal(state.generation.connectivityValid,true);
   assert.ok(plan.actualTiles>=plan.targetTiles||plan.placementLimited);
   assert.equal(dungeonArrivalPositions(state,4).length,4);
   assert.ok(state.entities.some(e=>e.doorKind==='stairs-up'));
   assert.ok(state.entities.some(e=>e.doorKind==='stairs-down'));
   for(const monster of state.entities.filter(e=>e.type==='monster')){
    const habitat=waterHabitat(monster),wet=isSlowWaterTile(state,monster.x,monster.y);
    if(habitat.bound)assert.equal(wet,true,monster.name);
    if(habitat.averse)assert.equal(wet,false,monster.name);
    if(category==='water-dungeon')assert.ok(!habitat.averse&&(habitat.eligible||monster.tags?.includes('undead')),monster.name);
    if(category==='none')assert.equal(habitat.prefersWater||habitat.bound,false,monster.name);
   }
   if(category==='none'){
    assert.equal(plan.actualTiles,0);
    assert.ok(state.rooms.every(room=>!room.reviewedTemplate||!layoutContainsWater(REVIEWED_LAYOUTS.find(t=>t.id===room.reviewedTemplate))));
   }
  }
 });
}
test('water category stays deterministic across repeated generation and wet arrivals are allowed',()=>{
 const options={waterCategory:'water-dungeon',reviewedLayouts:false,underpasses:false,pits:false,partySize:4};
 const first=generateDungeon(42,2,options),second=generateDungeon(42,2,options);
 assert.deepEqual(first.tiles,second.tiles);
 assert.deepEqual(first.generation.waterPlan,second.generation.waterPlan);
 const wet=dungeonArrivalPositions(first,4).filter(p=>isSlowWaterTile(first,p.x,p.y));
 assert.ok(wet.length,'fixture must exercise an actually wet arrival');
 assert.ok(wet.every(p=>isSafeDungeonArrival(first,p,{allowWater:true})));
});
test('the deepest classic water floor has upstairs and no downstairs',()=>{
 const state=generateClassicDungeon(61019,10,{waterCategory:'water-dungeon'});
 assert.ok(state.entities.some(e=>e.doorKind==='stairs-up'));
 assert.equal(state.entities.some(e=>e.doorKind==='stairs-down'),false);
});
