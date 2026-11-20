import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rollFloorWealthTarget,floorWealthTarget,prepareStartingWealth,finalizeStartingWealth,auditStartingWealth,inventoryWealthCopper,FloorWealthAllocationError} from '../../S3_content/src/treasure-generation.js';
import {generateDungeon,generateClassicDungeon,dungeonTraversalDistances,dungeonEntrancePoint} from '../../S3_content/src/generator.js';
import {SeededRng} from '../../S3_content/src/rng.js';
import {ensureMonsterGear,buildMonsterCompanion,companionLeaves,monsterInventoryFromCharacter} from '../../S3_content/src/companions.js';
import {defeatMonster,collectLoot,searchForTraps} from '../../S3_content/src/interactions.js';
import {normalizeCharacterState,getCharacterCoinBagSlots,getUsedGearSlots} from '../../S3_content/src/characters.js';
import {serializeDungeonState,hydrateDungeonState} from '../../S3_content/src/persistence.js';
import {seedLeprechaunGold} from '../../S3_content/src/leprechaun.js';
import {magicPotion,placeMagicTreasure,enchantedEquipment,highestMagicSaleValue} from '../../S3_content/src/magic-items.js';
import {recomputeVisibility} from '../../S3_content/src/visibility.js';
import {takeStolenItem,selectStealTarget,stealableGear} from '../../S3_content/src/thievery.js';

const data=name=>JSON.parse(readFileSync(new URL('../../S3_content/'+name,import.meta.url)));
function scene(){return {seed:1,level:1,map:{width:7,height:7},generation:{entranceRoomId:'room'},rooms:[{id:'room',x:0,y:0,width:7,height:7}],halls:[],
 tiles:Array.from({length:49},(_,i)=>({x:i%7,y:Math.floor(i/7),type:'floor',roomId:'room',meta:{}})),entities:[],characters:[],
 player:{x:2,y:2,roomId:'room',torchLit:true,lightRadius:6},visibility:{visibleNow:new Set(),exploredEver:new Set(),visitedRoomIds:new Set()}};}
const table=(id='table',value=200)=>({id,type:'treasure',name:'gold ring',kind:'jewelry',value,slots:1,x:2,y:3,roomId:'room',visible:false,revealed:false,searchDc:10});
const foe=(extra={})=>({id:'foe',type:'monster',name:'Pirate',x:2,y:3,roomId:'room',S:0,W:0,hp:10,level:1,attack:'1 dagger +3 (1d4)',...extra});
function finish(s){prepareStartingWealth(s,new SeededRng(121));return finalizeStartingWealth(s,new SeededRng(94),{targetGp:4400});}
function hero(s){s.characters=[{id:'hero',name:'Hero',className:'Thief',level:1,ancestry:'Human',x:2,y:2,roomId:'room',hp:10,maxHitPoints:10,stats:{STR:20,DEX:12,CON:10,INT:10,WIS:10,CHA:10},gear:[{name:'Torch',type:'sundry',lit:true,equipped:true,slots:1}],lightSource:'torch',lightRadius:6,raw:{},equipmentInitialized:true,armorEquipmentInitialized:true,gold:0,silver:0,copper:0}];s.activeCharacterId='hero';normalizeCharacterState(s);recomputeVisibility(s);return s.characters[0];}

test('generation target has exact minimum/maximum and a 4400 GP long-run expectation per level',()=>{
 for(const level of [1,2,5,10]){
  assert.equal(rollFloorWealthTarget(level,{nextFloat:()=>0}),4000*level);
  assert.equal(rollFloorWealthTarget(level,{nextFloat:()=>1}),6000*level);
 }
 let sum=0;
 for(let seed=0;seed<20000;seed++) {const value=floorWealthTarget(seed,1);assert.ok(value>=4000&&value<=6000);sum+=value;}
 assert.ok(Math.abs(sum/20000-4400)<10,String(sum/20000));
});

test('all fixed-price equipment gets table treasure to fill the budget without repricing magic or bolts',()=>{
 const s=scene();s.entities=[{...table('bolts',2000),kind:'gear',gearItem:{name:'Crossbow Bolts',quantity:18,totalUnits:18,value:100,slots:1}},
  {...table('magic',100),kind:'magic',gearItem:magicPotion('healing-2')}];
 const magic=structuredClone(s.entities[1].gearItem);const audit=finish(s);
 assert.equal(audit.totalGp,4400);assert.ok(audit.eligibleShare>=.8);assert.equal(audit.challengedShare,.9);
 assert.equal(s.entities[0].value,.9);assert.equal(s.entities[0].gearItem.value,.05);assert.deepEqual(s.entities[1].gearItem,magic);
 assert.ok(s.entities.some(e=>e.visible&&e.searchDc===0&&e.kind!=='gear'));
});

test('starting inventories, death and reload conserve wealth and do not create a second random reward',()=>{
 let s=scene();s.entities=[foe(),table()];const audit=finish(s);const native=ensureMonsterGear(s.entities[0]).find(i=>i.name==='Dagger');assert.equal(native.value,1);
 s=hydrateDungeonState(serializeDungeonState(s));const monster=s.entities.find(e=>e.type==='monster');const count=s.entities.length;
 const before=auditStartingWealth(s).totalGp;const drop=defeatMonster(s,monster);assert.equal(drop.defeated,true);assert.equal(drop.loot,null);
 assert.equal(auditStartingWealth(s).totalGp,before);assert.equal(before,audit.totalGp);
 const once=s.entities.length;assert.equal(defeatMonster(s,monster).defeated,false);assert.equal(s.entities.length,once);assert.ok(once>count);
});

test('carried table treasure can actually be stolen, and is not regenerated on death',()=>{
 const s=scene();s.entities=[foe({gear:[{name:'Pearl',treasureItem:true,value:1200,quantity:1,totalUnits:1,slots:1,generationMutable:true}]}),table()];finish(s);const h=hero(s),monster=s.entities[0];
 h.pendingSteal={phase:'targeting',check:{total:30}};selectStealTarget(s,h,monster);
 const index=stealableGear(monster).find(e=>e.item.name==='Pearl').index;const before=auditStartingWealth(s).totalGp;
 const {item}=takeStolenItem(s,h,index);h.gear.push(item);const value=inventoryWealthCopper(item)/100;
 assert.equal(Math.round((auditStartingWealth(s).totalGp+value)*100),Math.round(before*100));
 defeatMonster(s,monster);assert.ok(!s.entities.some(e=>e.type==='treasure'&&e.name==='Pearl'));
});

test('search concealment is enforced at pickup and a successful search genuinely reveals the cache',()=>{
 const s=scene();s.entities=[table()];finish(s);hero(s);const hidden=s.entities.find(e=>e.visible===false);
 assert.equal(collectLoot(s,hidden.id).collected,0);assert.notEqual(hidden.collected,true);
 const original=Math.random;Math.random=()=>.95;
 try {const result=searchForTraps(s,20);assert.ok(result.found.some(e=>e.id===hidden.id));} finally{Math.random=original;}
 assert.equal(collectLoot(s,hidden.id).collected,1);
});

test('starting leprechaun gold is counted, remains real coins through recruitment and departure, and never duplicates',()=>{
 const s=scene();s.level=3;s.entities=[foe({name:'Leprechaun',S:2,gear:[]}),table()];const m=s.entities[0];
 prepareStartingWealth(s,{nextFloat:()=>.5,nextInt:()=>10});
 assert.equal(m.genuineGold,500);assert.equal(m.genuineGoldAllocated,true);
 const fake=s.entities.find(e=>e.gearItem?.foolsGold);assert.equal(fake.value,400);
 assert.equal(m.gear.find(i=>i.coinBreakdown).coinBreakdown.gold,500);
 assert.ok(getUsedGearSlots(m.gear,{useStoredSlots:true})<=14);
 finalizeStartingWealth(s,new SeededRng(4),{targetGp:13200});
 const total=auditStartingWealth(s).totalGp;assert.equal(total,13200);
 const id=m.id;const c=buildMonsterCompanion(m,{random:()=>0,id:'friend'});assert.equal(c.gold,500);assert.ok(!c.gear.some(i=>i.coinBreakdown));
 s.entities=s.entities.filter(e=>e.id!==id);s.characters=[c];companionLeaves(s,c);
 assert.ok(s.entities.some(e=>e.coinBreakdown?.gold===500));
 const returned=s.entities.find(e=>e.id===id);defeatMonster(s,returned);
 assert.equal(s.entities.filter(e=>e.coinBreakdown?.gold===500).length,1);
 assert.equal(s.entities.filter(e=>e.gearItem?.foolsGold).length,1);
});

test('an over-capacity leprechaun gold cache is placed hidden nearby without overloading or losing its wealth',()=>{
 const s=scene();s.level=3;s.entities=[foe({name:'Leprechaun',S:-3,gear:[]}),table()];prepareStartingWealth(s,{nextFloat:()=>.99,nextInt:()=>10});
 const m=s.entities[0];assert.equal(m.genuineGold,800);assert.ok(getUsedGearSlots(m.gear,{useStoredSlots:true})<=4);
 assert.ok(s.entities.some(e=>e.coinBreakdown?.gold===800&&!e.visible));
 finalizeStartingWealth(s,new SeededRng(4),{targetGp:13200});const total=auditStartingWealth(s).totalGp;defeatMonster(s,m);assert.equal(auditStartingWealth(s).totalGp,total);
});

test('all-coin variable wealth retains denomination and accounts for every copper',()=>{
 const s=scene();s.entities=[{...table('copper',100),kind:'coin-cache',coinBreakdown:{gold:0,silver:0,copper:10000}}];const result=finish(s);
 assert.equal(result.totalGp,4400);const pouch=s.entities.find(e=>e.id==='copper');assert.equal(pouch.coinBreakdown.gold,0);assert.equal(pouch.coinBreakdown.silver,0);
 hero(s);pouch.visible=true;pouch.revealed=true;pouch.coinBreakdown.copper=700;pouch.value=7;pouch.slots=6;
 assert.equal(collectLoot(s,pouch.id).collected,1);assert.equal(s.characters[0].copper,700);assert.equal(s.characters[0].gold,0);assert.equal(getCharacterCoinBagSlots(s.characters[0]),6);
});

test('vampire coffins are created once at ten GP and five slots, and included before the allocation',()=>{
 const s=scene();s.level=5;s.entities=[foe({name:'Vampire'}),table()];prepareStartingWealth(s,new SeededRng(121));
 const coffin=s.entities.find(e=>e.gearItem?.coffin);assert.ok(coffin);assert.equal(coffin.value,10);assert.equal(coffin.gearItem.costGp,10);assert.equal(coffin.slots,5);
 const count=s.entities.length;prepareStartingWealth(s,new SeededRng(2));assert.equal(s.entities.length,count);
 const result=finalizeStartingWealth(s,new SeededRng(23),{targetGp:22000});assert.equal(result.totalGp,22000);assert.equal(coffin.value,10);
});

test('impossible fixed native wealth is rejected rather than silently repriced or exempted from limits',()=>{
 const s=scene();s.entities=[foe({gear:[{name:'Plate Mail',quantity:100,totalUnits:100,slots:3}]}),table()];
 prepareStartingWealth(s,new SeededRng(2));assert.throws(()=>finalizeStartingWealth(s,new SeededRng(2),{targetGp:4400}),FloorWealthAllocationError);
 assert.equal(s.entities[0].gear[0].value,130);
});

test('actual generated floors across depths, geometry, water, and classic paths meet every value quota',()=>{
 const content=data('data/shadowdark-content.json'),organic=data('data/organic-assets.json');
 for(const level of [1,3,5,10])for(const seed of [19,123,408]){
  const options={monsterTable:data(`monsters-${level}.json`),rulesData:data('data/rules-data.json'),contentCatalog:content,trapTable:data('traps.json'),organicAssets:organic,
    innerWallAssets:data('data/inner-wall-assets.json'),bossMonsterTable:data(`monsters-${Math.min(10,level+1)}.json`),
    architecturePattern:seed===19?'organic':seed===123?'processional':'waterLogged',waterCategory:seed===408?'water-dungeon':undefined};
  for(const generate of [generateDungeon,...(seed===19?[generateClassicDungeon]:[])]){
   const s=generate(seed,level,options);const audit=auditStartingWealth(s);
   assert.equal(audit.totalGp,floorWealthTarget(seed,level));assert.ok(audit.totalGp>=4000*level&&audit.totalGp<=6000*level);
   assert.ok(audit.eligibleShare>=.8);assert.ok(Math.abs(audit.challengedShare-.9)<.00001);assert.ok(audit.carriedGp>=0);
   const saved=hydrateDungeonState(serializeDungeonState(s));assert.deepEqual(auditStartingWealth(saved),audit);
   assert.deepEqual(saved.generation.startingWealth,s.generation.startingWealth);
  }
 }
});


test('magic ammunition is valued once per bundle rather than once per individual arrow',()=>{
 const item=enchantedEquipment({name:'Arrows',costGp:1,quantity:20,stackSize:20,slots:1},'ammunition',1);
 assert.equal(item.value,201);assert.equal(inventoryWealthCopper(item),20100);
 item.totalUnits=10;item.quantity=10;assert.equal(inventoryWealthCopper(item),10050);
});


test('ending recruitment returns the current physical wallet rather than restoring stale source gold',()=>{
 const s=scene(),m=foe({gear:[{name:'700 CP',coinBreakdown:{gold:0,silver:0,copper:700},quantity:1,slots:6,value:7}]});
 const c=buildMonsterCompanion(m,{random:()=>0,kind:'charmed'});assert.equal(c.copper,700);assert.equal(c.gear.length,0);
 c.copper=347;c.silver=11;c.gold=2;
 const inventory=monsterInventoryFromCharacter(c);assert.deepEqual(inventory[0].coinBreakdown,{gold:2,silver:11,copper:347});
 assert.equal(inventory[0].slots,3);assert.equal(inventoryWealthCopper(inventory[0]),657);
 assert.equal(c.copper,347);
});


test('named table adjectives do not freeze prices or force otherwise valid authored geometry to regenerate',()=>{
 const s=scene();s.entities=[foe({gear:[{name:'enchanted ruby',treasureItem:true,treasureKind:'gems',value:20000,quantity:1,totalUnits:1,slots:0,generationMutable:true}]}),table()];
 const result=finish(s);assert.equal(result.totalGp,4400);assert.ok(s.entities[0].gear[0].value<4400);
});


test('magic budgets count the highest available sale without changing the item or identification',()=>{
 const low=magicPotion('invisibility'),original=structuredClone(low);
 assert.equal(low.value,80);assert.equal(highestMagicSaleValue(low),100);assert.equal(inventoryWealthCopper(low),10000);assert.deepEqual(low,original);
 const high=magicPotion('vitality');assert.equal(highestMagicSaleValue(high),500);
 assert.equal(highestMagicSaleValue(magicPotion('healing-1')),50);
 const identified={...low,magic:{...low.magic,identified:true}};assert.equal(highestMagicSaleValue(identified),80);
 assert.equal(highestMagicSaleValue({name:'Torch',value:.5}),null);
 const pending={...low,magic:{...low.magic,pricePending:true}};assert.equal(highestMagicSaleValue(pending),null);
});

test('the floor cap and challenged share reserve the higher sale offer while preserving printed magic prices',()=>{
 const s=scene(),item=magicPotion('invisibility');s.entities=[table(),{...table('potion',80),kind:'magic',gearItem:item}];
 prepareStartingWealth(s,new SeededRng(10));const audit=finalizeStartingWealth(s,new SeededRng(5),{targetGp:6000});
 assert.equal(audit.totalGp,6000);assert.equal(audit.challengedShare,.9);assert.equal(s.generation.startingWealth.valuation,'highest-possible-sale-value');
 assert.equal(item.value,80);assert.equal(item.magic.identified,false);assert.equal(s.entities.find(e=>e.id==='potion').value,80);
 const saved=hydrateDungeonState(serializeDungeonState(s));assert.equal(auditStartingWealth(saved).totalGp,6000);
 assert.equal(saved.generation.startingWealth.totalGp,6000);
});

test('magic placement uses its reserved best sale cost before selecting an item',()=>{
 const s=scene();s.rulesData={weapons:[],armor:[],gear:[]};s.entities=Array.from({length:5},(_,i)=>table('cache-'+i,20));
 placeMagicTreasure(s,{nextFloat:()=>.95,nextInt:()=>0},[],{budgetGp:81,rebalance:false,valueOfMagic:highestMagicSaleValue});
 const items=s.entities.filter(e=>e.gearItem?.magic);assert.equal(items.length,1);
 assert.equal(items[0].gearItem.magic.potion,'healing-1');assert.equal(highestMagicSaleValue(items[0].gearItem),50);
});
