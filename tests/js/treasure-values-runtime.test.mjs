import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {syncTreasureGearUnitValue,createTreasureDetails,printedEquipmentUnitValue,rebalancePrintedTreasure} from '../../S3_content/src/treasure.js';
import {placeMagicTreasure,magicPotion} from '../../S3_content/src/magic-items.js';
import {SeededRng} from '../../S3_content/src/rng.js';
import {collectLoot} from '../../S3_content/src/interactions.js';
import {normalizeCharacterState,getCharacterCoinBagSlots} from '../../S3_content/src/characters.js';
import {serializeDungeonState,hydrateDungeonState} from '../../S3_content/src/persistence.js';
const root=new URL('../../S3_content/',import.meta.url),dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost/site/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,Image:dom.window.Image,__SD_SERVER_RUNTIME__:true});
globalThis.fetch=async input=>new Response(await readFile(new URL(String(input).replace(/^\.\//,''),root)),{headers:{'Content-Type':'application/json'}});
const {executeGameCommand}=await import('../../S3_content/src/main.js');
test.after(()=>dom.window.close());
function scene(){return {seed:1,level:1,map:{width:7,height:7},generation:{entranceRoomId:'room'},
 tiles:Array.from({length:49},(_,i)=>({x:i%7,y:Math.floor(i/7),type:'floor',roomId:'room',meta:{}})),rooms:[{id:'room',x:0,y:0,width:7,height:7}],halls:[],entities:[],
 visibility:{exploredEver:['2,2']},partyAssets:{gold:0,silver:0,copper:0},
 characters:Array.from({length:4},(_,i)=>({id:'hero-'+i,name:'Hero '+i,ancestry:'Human',className:'Fighter',level:1,XP:0,
 hp:10,maxHitPoints:10,x:2+i,y:2,roomId:'room',stats:{STR:12,DEX:12,CON:10,INT:10,WIS:10,CHA:10},gear:i===0?[{name:'Torch',quantity:1,slots:1,lit:true,equipped:true}]:[],lightSource:i===0?'torch':'',lightRadius:i===0?6:0,gold:0,silver:0,copper:i===0?700:0,raw:{},equipmentInitialized:true,armorEquipmentInitialized:true})),
 player:{x:2,y:2,roomId:'room',torchLit:true,lightRadius:6,lightSource:'torch'},activeCharacterId:'hero-0',combat:{active:false}};}
const pile=(value=2006.02,units=18)=>({id:'pile',type:'treasure',kind:'gear',subtype:'coin-cache',name:'Crossbow Bolts x'+units,
 x:2,y:2,roomId:'room',visible:true,revealed:true,value,slots:1,gearItem:{name:'Crossbow Bolts',type:'sundry',ammoType:'bolts',quantity:units,totalUnits:units,slots:1,value}});
const assetCopper=s=>s.partyAssets.gold*100+s.partyAssets.silver*10+s.partyAssets.copper;
test('ordinary treasure stores one bundle price on the floor and one unit price in gear',()=>{
 for(const units of [1,3,9,18,20]){
  const entity=pile(2006.02,units);syncTreasureGearUnitValue(entity);
  assert.equal(Math.round(entity.gearItem.value*units*100),200602);assert.equal(entity.gearItem.totalUnits,units);assert.equal(entity.value,2006.02);
 }
 const magic={value:1,gearItem:magicPotion('healing-1')},original=structuredClone(magic.gearItem);syncTreasureGearUnitValue(magic);assert.deepEqual(magic.gearItem,original);
});
test('initial equipment bundles and magic replacement keep ordinary per-unit values synchronized',()=>{
 const rules={gear:[{name:'Arrows',costGp:1,quantityDie:'1d20',stackSize:20,slots:1,ammoType:'arrows'}],weapons:[{name:'Arrows',costGp:1,quantityDie:'1d20',stackSize:20,slots:1,ammoType:'arrows'}]};
 const treasure=createTreasureDetails({level:1,rulesData:rules},{nextFloat:()=>.999,nextInt:()=>17});
 assert.equal(treasure.gearItem.totalUnits,17);assert.equal(Math.round(treasure.gearItem.value*17*100),Math.round(treasure.value*100));
 const s=scene();s.rulesData=rules;s.entities=Array.from({length:20},(_,i)=>({...pile(100,18),id:'pile-'+i}));placeMagicTreasure(s,new SeededRng(88));
 assert.equal(s.generation.treasureTargetGp,2000);
 for(const e of s.entities.filter(e=>!e.gearItem.magic)){assert.equal(e.gearItem.value,.05);assert.equal(Math.round(e.value*100),90);}
});
test('legacy bundle pickup, save/load, drop, pickup and sale conserve value and physical coins; XP is awarded once',async()=>{
 let s=scene();s.entities=[pile()];normalizeCharacterState(s);
 assert.equal(collectLoot(s,'pile').collected,1);assert.equal(s.characters[0].gear.find(i=>i.name==='Crossbow Bolts').totalUnits,18);
 s=hydrateDungeonState(serializeDungeonState(s));
 assert.equal(getCharacterCoinBagSlots(s.characters[0]),6);
 let result=await executeGameCommand(serializeDungeonState(s),{type:'drop_gear',character_id:'hero-0',gear_index:s.characters[0].gear.findIndex(i=>i.name==='Crossbow Bolts')});
 const dropped=result.state_json.entities.find(e=>e.subtype==='dropped-equipment'&&!e.collected);assert.ok(dropped);
 result=await executeGameCommand(result.state_json,{type:'pickup',character_id:'hero-0',entity_id:dropped.id});
 const actor=result.state_json.characters[0],index=actor.gear.findIndex(i=>i.name==='Crossbow Bolts');assert.ok(index>=0);assert.equal(actor.gear[index].totalUnits,18);
 result=await executeGameCommand(result.state_json,{type:'sell_treasure',character_id:'hero-0',items:[{index,name:'Crossbow Bolts'}],coins:{}});
 assert.equal(assetCopper(result.state_json),90);
 for(const hero of result.state_json.characters){assert.equal(hero.XP,0);assert.ok(Math.abs(hero.hiddenXp-.00225)<1e-9);assert.equal(hero.level,1);}
 assert.equal(result.state_json.characters[0].copper,700);assert.equal(getCharacterCoinBagSlots(result.state_json.characters[0]),6);
 await assert.rejects(()=>executeGameCommand(result.state_json,{type:'sell_treasure',character_id:'hero-0',items:[{index,name:'Crossbow Bolts'}],coins:{}}),/gear list changed/);
});


test('two valuable treasures award XP for their pile totals rather than multiplying an equipment bundle again',async()=>{
 const s=scene(),spikes=pile(2312.55,9),shield=pile(1391.98,1);
 Object.assign(spikes,{id:'spikes',name:'Iron Spikes x9'});Object.assign(spikes.gearItem,{name:'Iron Spikes',ammoType:undefined});
 Object.assign(shield,{id:'shield',name:'Shield'});Object.assign(shield.gearItem,{name:'Shield',ammoType:undefined});
 s.entities=[spikes,shield];normalizeCharacterState(s);
 assert.equal(collectLoot(s,'spikes').collected,1);assert.equal(collectLoot(s,'shield').collected,1);
 const items=s.characters[0].gear.flatMap((item,index)=>['Iron Spikes','Shield'].includes(item.name)?[{index,name:item.name}]:[]);
 const result=await executeGameCommand(serializeDungeonState(s),{type:'sell_treasure',character_id:'hero-0',items,coins:{}});
 assert.equal(assetCopper(result.state_json),1090);
 for(const hero of result.state_json.characters){assert.equal(hero.level,1);assert.equal(hero.XP,0);assert.ok(Math.abs(hero.hiddenXp-.02725)<1e-9);}
});


test('printed ordinary prices preserve bundles, silver, damage and magic exceptions',()=>{
 for(const [item,expected] of [[{name:'Crossbow Bolts'},.05],[{name:'Iron Spikes'},.1],[{name:'Rations'},1/6],[{name:'Caltrops'},.5],[{name:'pole'},.5],[{name:'Dagger',silver:true},10],[{name:'charred Leather Armor',fireDamage:{response:'charred',originalName:'Leather Armor x3'}},5]])assert.equal(printedEquipmentUnitValue(item),expected);
 assert.equal(printedEquipmentUnitValue({name:'Dagger',magic:{bonus:1}}),null);
 assert.equal(printedEquipmentUnitValue({name:'Dagger',treasureItem:true}),null);
 assert.equal(printedEquipmentUnitValue({name:'Dagger',tags:['magic gear']}),null);
});
test('budget redistribution protects printed gear and magic, retaining copper pouch denomination',()=>{
 const s=scene();const ordinary=pile(2000,18),magic={id:'magic',type:'treasure',value:100,gearItem:magicPotion('healing-2')};
 const copper={id:'coins',type:'treasure',kind:'coin-cache',name:'c.p. pouch',value:1900,coinBreakdown:{gold:0,silver:0,copper:190000}};
 s.entities=[ordinary,magic,copper];const before=structuredClone(magic);
 assert.equal(rebalancePrintedTreasure(s,4000),0);
 assert.equal(ordinary.value,.9);assert.deepEqual(magic,before);
 assert.equal(copper.coinBreakdown.gold,0);assert.equal(copper.coinBreakdown.silver,0);assert.equal(copper.coinBreakdown.copper,389910);
 assert.equal(copper.description,'Coins: 0 gp, 0 sp, 389910 cp.');
 assert.equal(s.generation.treasureActualGp,4000);
});


test('stealing a physical copper pouch adds copper to the wallet or leaves the whole pouch on the floor when full',async()=>{
 for(const full of [false,true]){
  const s=scene();s.characters[0].className='Thief';s.characters[0].copper=0;
  if(full)s.characters[0].gear.push({name:'Coffin',quantity:3,totalUnits:3,slots:5,coffin:true,type:'sundry'});
  normalizeCharacterState(s);
  s.characters[0].pendingSteal={phase:'gear',turnKey:'exploration',targetId:'coins-owner',check:{total:30}};
  s.entities=[{id:'coins-owner',type:'monster',name:'Pirate',x:2,y:3,roomId:'room',hp:10,W:0,attitude:'friendly',attitudeChecked:true,hostile:false,startingWealthAllocated:true,
    gear:[{name:'700 CP',coinBreakdown:{gold:0,silver:0,copper:700},value:7,quantity:1,totalUnits:1,slots:6}]}];
  const result=await executeGameCommand(serializeDungeonState(s),{type:'steal_take',character_id:'hero-0',gear_index:0});
  const actor=result.state_json.characters[0];assert.equal(actor.gold,0);assert.equal(actor.silver,0);
  assert.equal(actor.copper,full?0:700);assert.ok(!actor.gear.some(i=>i.coinBreakdown));
  assert.equal(result.state_json.entities.find(e=>e.id==='coins-owner')?.gear?.length,0,JSON.stringify(result.state_json.entities.map(e=>({id:e.id,name:e.name,defeated:e.defeated}))))
  const dropped=result.state_json.entities.find(e=>e.type==='treasure'&&e.coinBreakdown?.copper===700&&!e.collected);
  if(full){assert.ok(dropped);assert.equal(dropped.coinBreakdown.gold,0);assert.equal(dropped.value,7);}else assert.equal(dropped,undefined);
 }
});
