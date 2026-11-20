import {dropFromCeiling} from '../../S3_content/src/ceiling-movement.js';
import {syncTransformationEffects} from '../../S3_content/src/transformation-spells.js';
import {reconcileMovementBudget} from '../../S3_content/src/combat-rules.js';
import {monsterAttackDamageSource} from '../../S3_content/src/monster-attacks.js';
import {elementalWeaponDamage} from '../../S3_content/src/elemental-effects.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyDungeonState,getTile} from '../../S3_content/src/state-schema.js';
import {waterEncounterTable,waterSpawnPlacement,waterHabitat,makeSeaVariant} from '../../S3_content/src/water-habitats.js';
import {waterStepBlock,isImmersed,isOnCeiling,commitWaterMovement,quenchImmersedEffects} from '../../S3_content/src/water-rules.js';
import {movementStepCost} from '../../S3_content/src/terrain-movement.js';
import {canMoveBetweenTiles,movePlayer} from '../../S3_content/src/interactions.js';
import {characterMovementBudget,combatStepBlock} from '../../S3_content/src/combat-rules.js';
import {elementalDamage,elementalSaveOptions} from '../../S3_content/src/elemental-effects.js';
import {serializeDungeonState,hydrateDungeonState} from '../../S3_content/src/persistence.js';
import {applyTierThreeBlast} from '../../S3_content/src/tier-three-spells.js';
import {castFocusedSpell,resolveFocusedSpell,maintainTierTwoFocus} from '../../S3_content/src/wizard-tier-two-focus.js';

function scene(){
 const state=createEmptyDungeonState(1);state.map={width:12,height:10};
 state.tiles=Array.from({length:120},(_,i)=>({x:i%12,y:Math.floor(i/12),type:'floor',roomId:'r',meta:{}}));
 state.rooms=[{id:'r',x:0,y:0,width:12,height:10}];state.entities=[];
 state.player={x:4,y:4,roomId:'r',torchLit:true,lightRadius:12};
 const hero={id:'hero',name:'Climber',className:'Wizard',level:5,hp:40,maxHitPoints:40,x:4,y:4,roomId:'r',
  lightRadius:12,lightSource:'torch',stats:{STR:10,DEX:10,CON:10,INT:14,WIS:10,CHA:10},gear:[{name:'Torch',lit:true}],raw:{}};
 state.characters=[hero];state.activeCharacterId=hero.id;return {state,hero};
}
const wet=(state,x,y)=>{getTile(state,x,y).meta.slowWater=true;};
const pool=[{name:'Ghost',tags:['undead']},{name:'Mummy',tags:['undead']},{name:'Vampire Spawn',tags:['undead']},
 {name:'Aboleth',movement:'near (swim)'},{name:'Crab, Giant'},{name:'Pirate'},{name:'Sahuagin'},{name:'Orc'}];
function habitatScene(category,flooded=false,water=true){
 const {state}=scene();state.generation.waterPlan={category,wetRoomIds:water?['r']:[],floodedRoomIds:flooded?['r']:[]};return state;
}
test('water levels use the explicit list plus eligible undead, never every native swimmer',()=>{
 const state=habitatScene('water-dungeon');
 assert.deepEqual(waterEncounterTable(state,state.rooms[0],pool).map(m=>m.name),['Ghost','Crab, Giant','Pirate','Sahuagin']);
 const original=pool[0];assert.equal(waterEncounterTable(state,state.rooms[0],pool)[0],original);
});
test('aquatic-only restriction is room-specific; only none excludes water-preferring creatures',()=>{
 let state=habitatScene('high',true);
 assert.deepEqual(waterEncounterTable(state,state.rooms[0],pool).map(m=>m.name),['Crab, Giant','Pirate','Sahuagin']);
 state=habitatScene('high',false);
 assert.ok(waterEncounterTable(state,state.rooms[0],pool).some(m=>m.name==='Orc'));
 state=habitatScene('low',false);
 assert.ok(waterEncounterTable(state,state.rooms[0],pool).some(m=>m.name==='Pirate'));
 state=habitatScene('none',false,false);
 assert.deepEqual(waterEncounterTable(state,state.rooms[0],pool).map(m=>m.name),['Ghost','Mummy','Vampire Spawn','Aboleth','Crab, Giant','Orc']);
});
test('Sea fallback retains level-table entries and stats and changes only approved spell/summon text',()=>{
 const state=habitatScene('water-dungeon'),table=[{name:'Cultist',level:2,hp:9,weight:3,movement:'near'},
  {name:'Giant Snake',level:5,movement:'near (climb)'}];
 const variants=waterEncounterTable(state,state.rooms[0],table);
 assert.deepEqual(variants.map(m=>m.name),['Sea Cultist','Giant Sea Snake']);
 assert.equal(variants[0].hp,9);assert.equal(variants[0].weight,3);assert.match(variants[1].movement,/climb, swim/);
 assert.equal(table[0].name,'Cultist');
 const druid=makeSeaVariant({name:'Druid',talents:['Conjure Flames (INT Spell). DC 12. 2d6 damage.','Summon Bear. A loyal brown bear appears.'],movement:'near'});
 assert.match(druid.talents[0],/^Boil Water/);assert.match(druid.talents[1],/Summon Shark.*loyal shark/);
 const priest=makeSeaVariant({name:'Priest',abilities:{'Holy Flame':'Weapons deal 1d6 fire damage.'}});
 assert.equal(priest.abilities['Holy Spark'],'Weapons deal 1d6 lightning damage.');
});
test('water-only and water-averse step rules apply to real terrain queries, including companions',()=>{
 const {state}=scene();wet(state,4,4);wet(state,5,4);
 const fish={id:'fish',name:'Shark',type:'monster',movement:'near (swim)',x:4,y:4};
 assert.equal(canMoveBetweenTiles(state,4,4,5,4,{creature:fish}).ok,true);
 assert.equal(canMoveBetweenTiles(state,4,4,4,5,{creature:fish}).ok,false);
 const vampire={id:'vamp',name:'Vampire',type:'monster',movement:'near (climb)',x:4,y:5};
 assert.equal(canMoveBetweenTiles(state,4,5,4,4,{creature:vampire}).ok,false);
 vampire.transformationEffects=[{spell:'fly',rounds:2}];
 assert.equal(canMoveBetweenTiles(state,4,5,4,4,{creature:vampire}).ok,true);
 const companion={name:'Renamed',stats:{},companion:{source:fish}};
 assert.equal(waterHabitat(companion).bound,true);
});
test('wall-to-ceiling entry commits only after movement; ceiling persists across open water and save/load',()=>{
 const {state,hero}=scene();wet(state,4,4);wet(state,5,4);wet(state,6,4);
 getTile(state,3,4).type='wall';hero.transformationEffects=[{spell:'alter self',rounds:5,features:['spider-legs']}];
 assert.equal(movementStepCost(state,4,4,hero),1);
 assert.equal(canMoveBetweenTiles(state,4,4,5,4,{creature:hero}).ok,true);
 assert.equal(isOnCeiling(hero),false,'path queries cannot mutate the actor');
 const result=movePlayer(state,1,0,{deferVisibility:true});
 assert.equal(result.moved,true);assert.equal(result.message,'Climber climbs from wall to ceiling.');
 Object.assign(hero,{x:state.player.x,y:state.player.y});
 assert.equal(isOnCeiling(hero),true);assert.equal(movementStepCost(state,5,4,hero),1);
 assert.equal(isImmersed(state,hero),false);assert.equal(characterMovementBudget(hero),6);
 state.entities=[{id:'ground',type:'monster',name:'Goblin',x:6,y:4,hp:5}];state.combat.movementRemaining=1;
 assert.equal(combatStepBlock(state,hero,6,4),'');
 const loaded=hydrateDungeonState(serializeDungeonState(state));
 assert.equal(isOnCeiling(loaded.characters[0]),true);
 assert.equal(loaded.characters[0].gear[0].lit,true);
});
test('swimmers use full speed, ordinary walking is halved, and fire reduction stacks with resistance',()=>{
 const {state,hero}=scene();wet(state,4,4);
 assert.equal(movementStepCost(state,4,4,hero),2);
 hero.movement='double near (swim)';assert.equal(movementStepCost(state,4,4,hero),1);
 assert.equal(elementalDamage(hero,15,'fire',state).total,7);
 hero.gear.push({equipped:true,magic:{resistance:'fire'}});
 assert.equal(elementalDamage(hero,15,'fire',state).total,3);
 assert.equal(elementalDamage(hero,15,'lightning',state).total,15);
 assert.deepEqual(elementalSaveOptions(hero,'fire',{state}),{doubleRoll:true,disadvantage:false});
 assert.deepEqual(elementalSaveOptions(hero,'lightning',{state}),{doubleRoll:false,disadvantage:true});
 assert.deepEqual(elementalSaveOptions(hero,'lightning',{state,advantage:true}),{doubleRoll:false,disadvantage:false});
 hero.conditions={ceiling:true};assert.equal(elementalDamage(hero,15,'fire',state).total,7);
});
test('actual Fireball damage uses immersion separately for characters and monsters',()=>{
 const {state,hero}=scene();wet(state,4,4);
 state.entities=[{id:'orc',type:'monster',name:'Orc',hp:50,x:5,y:4}];wet(state,5,4);
 const result=applyTierThreeBlast(state,hero,'fireball',{x:4,y:4},{forced:true,random:()=>.99});
 assert.equal(result.hits.find(h=>h.id==='hero').damage,12);
 assert.equal(result.hits.find(h=>h.id==='orc').damage,12);
});
test('water cancels ongoing acid on only the immersed target and preserves other focus targets and torches',()=>{
 const {state,hero}=scene();
 const first={id:'first',name:'Orc',type:'monster',hp:50,x:6,y:4,visible:true};
 const second={...first,id:'second',name:'Goblin',x:7};state.entities=[first,second];
 const checkRoll=modifier=>({roll:20,total:20+modifier,modifier});
 castFocusedSpell(state,hero,'acid arrow',{checkRoll});
 resolveFocusedSpell(state,hero,{choice:'targets'});
 resolveFocusedSpell(state,hero,{targetId:'first',canTarget:()=>true,random:()=>0});
 resolveFocusedSpell(state,hero,{targetId:'second',canTarget:()=>true,random:()=>0});
 wet(state,first.x,first.y);first.conditions={hellfire:{sourceId:'balor'}};
 assert.equal(quenchImmersedEffects(state,first),true);
 assert.deepEqual(hero.focusSpell.targetIds,['second']);assert.equal(first.conditions.hellfire,undefined);
 const tick=maintainTierTwoFocus(state,hero,{checkRoll:modifier=>({roll:12,total:12+modifier,modifier}),random:()=>0});
 assert.deepEqual(tick.hits.map(h=>h.targetId),['second']);
 assert.equal(hero.gear[0].lit,true);
});

test('ceiling drops are free and damage-free; occupied ground shunts randomly to adjacent then nearest free floor',()=>{
 const {state,hero}=scene();hero.conditions={ceiling:true};wet(state,4,4);
 const hp=hero.hp;state.combat={movementBudget:6,movementRemaining:4,movementSpent:2,actionUsed:false};
 let result=dropFromCeiling(state,hero,{random:()=>0});
 assert.equal(hero.hp,hp);assert.equal(hero.conditions.ceiling,undefined);assert.equal(isImmersed(state,hero),true);
 assert.equal(state.combat.movementRemaining,4);assert.equal(state.combat.actionUsed,false);
 hero.conditions.ceiling=true;state.entities.push({id:'ground',type:'monster',x:4,y:4,hp:10});
 result=dropFromCeiling(state,hero,{random:()=>0});assert.deepEqual([hero.x,hero.y],[4,3]);
 hero.x=4;hero.y=4;hero.conditions.ceiling=true;
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)state.entities.push({id:dx+','+dy,type:'monster',x:4+dx,y:4+dy,hp:1});
 result=dropFromCeiling(state,hero,{random:()=>0});assert.equal(Math.max(Math.abs(hero.x-4),Math.abs(hero.y-4)),2);
 assert.equal(hero.hp,hp);
});
test('expired spider legs land automatically and changing movement modes never refunds spent movement',()=>{
 const {state,hero}=scene();hero.conditions={ceiling:true};hero.transformationEffects=[{spell:'alter self',rounds:0,features:['spider-legs']}];
 wet(state,4,4);syncTransformationEffects(state);assert.equal(hero.conditions.ceiling,undefined);assert.equal(isImmersed(state,hero),true);
 const combat={movementBudget:12,movementRemaining:5,movementSpent:7};reconcileMovementBudget(combat,6);
 assert.equal(combat.movementRemaining,0);reconcileMovementBudget(combat,12);assert.equal(combat.movementRemaining,5);
 hero.movement='double near (swim)';assert.equal(characterMovementBudget(hero,state),12);
});
test('Fire Dragon rend stays physical, Fire Elemental touch is fire; mixed weapon hits reduce only fire',()=>{
 const {state,hero}=scene();wet(state,4,4);
 const dragon=monsterAttackDamageSource({name:'Fire Dragon'},{name:'rend',segment:'2 rend +12 (2d10)'});
 const elemental=monsterAttackDamageSource({name:'Fire Elemental'},{name:'touch',segment:'2 touch +7 (2d8)'});
 assert.equal(elementalDamage(hero,12,dragon,state).total,12);assert.equal(elementalDamage(hero,12,elemental,state).total,6);
 hero.gear.push({name:'Ring',equipped:true,magic:{resistance:'fire'}});
 assert.equal(elementalWeaponDamage(hero,{physical:8,elemental:12,radiant:2},'fire',state).total,13);
});
