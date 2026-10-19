import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHigherMishap, advanceArcanePhenomena, ordBalanceOptions, resolveOrdBalance, processArcanaLoop } from '../../S3_content/src/higher-mishaps.js';
import { rollWizardMishaps, wizardCastingMode, advanceWizardTime, recoverWizardSpells } from '../../S3_content/src/wizard-mishaps.js';
import { isRaving, availableHands, blocksSpellTier, forgottenSpells, isShrouded, attackDamageMultiplier } from '../../S3_content/src/arcane-effects.js';
import { characterMovementBudget } from '../../S3_content/src/combat-rules.js';
import { ensureEquipment, equipItem } from '../../S3_content/src/equipment.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

const sequence = (...values) => { let index=0;return()=>values[index++]??.5; };
function scene(){
  const hero={id:'hero',name:'Hero',className:'Wizard',ancestry:'Human',hp:100,maxHitPoints:100,level:5,stats:{STR:12,DEX:12,CON:12,INT:14,WIS:12,CHA:10},
    x:10,y:10,roomId:'r',gear:[],equipmentInitialized:true,spellsKnown:'Magic Missile, Fireball, Wish',bonuses:[],wizardEffects:[],raw:{}};
  return {map:{width:24,height:24},tiles:Array.from({length:576},(_,i)=>({x:i%24,y:Math.floor(i/24),type:'floor',roomId:'r'})),rooms:[{id:'r',x:0,y:0,width:24,height:24}],
    characters:[hero,{...structuredClone(hero),id:'ally',name:'Ally',x:11}],entities:[{id:'foe',name:'Foe',type:'monster',hp:100,x:12,y:10}],
    visibility:{visibleNow:new Set(),exploredEver:new Set()},player:{x:10,y:10},combat:{active:false},activeCharacterId:'hero'};
}
const tier=name=>/wish/i.test(name)?5:/fireball/i.test(name)?3:1;
function fixed(value,fn){const previous=Math.random;Math.random=()=>value;try{return fn();}finally{Math.random=previous;}}

test('higher-tier Devastation uses the appropriate table twice without recursion',()=>{
  const state=scene(),caster=state.characters[0],random=sequence(0,0,.5,.5,.5,.99);
  const results=rollWizardMishaps(state,caster,'Wish',{tier:5,random,knownSpells:['Magic Missile','Fireball','Wish']});
  assert.equal(results.length,3);assert.equal(results[1].name,'Pyroclastic extrusion');assert.equal(results[2].name,'Shred');
  assert.equal(state.entities.filter(entity=>entity.subtype==='arcane-shred').length,1);
});

test('tier-three blast damages nearby allies/enemies; tier-five fire respects equipped resistance',()=>{
  for(const table of [3,5]){
    const state=scene();state.characters[0].gear=[{equipped:true,magic:{resistance:'fire'}}];
    const result=applyHigherMishap(state,state.characters[0],'Test',2,{tier:table,random:()=>.5,canSee:()=>true});
    assert.equal(result.hits.length,3);assert.equal(state.entities[0].hp,table===3?92:85);
    assert.equal(state.characters[0].hp,table===3?92:93);
  }
});

test('duplicate refraction and incantation substitution persist forced targets without new casting checks',()=>{
  const state=scene(),caster=state.characters[0];
  applyHigherMishap(state,caster,'Fireball',3,{tier:3});
  assert.deepEqual(state.arcaneSpellEvents.map(event=>event.targetIds),[['hero'],['ally']]);
  applyHigherMishap(state,caster,'Fireball',4,{tier:3,knownSpells:['Magic Missile'],targets:[state.entities[0]],random:()=>0,resolveForcedSpell:()=> 'Applied'});
  assert.equal(state.arcaneSpellEvents.at(-1).spell,'Magic Missile');assert.equal(state.arcaneSpellEvents.at(-1).resolved,true);
});

test('two gear units disappear; stat collapse survives saves and restores only on successful rest',()=>{
  const state=scene(),caster=state.characters[0];caster.gear=[{name:'Torch',quantity:3,totalUnits:3,lit:true,equipped:true}];
  applyHigherMishap(state,caster,'Fireball',5,{tier:3,random:()=>0});assert.equal(caster.gear[0].totalUnits,1);assert.equal(caster.gear[0].lit,false);
  fixed(0,()=>applyHigherMishap(state,caster,'Fireball',6,{tier:3,random:()=>0}));assert.equal(caster.stats.STR,3);
  const saved=hydrateDungeonState(serializeDungeonState(state)).characters[0];assert.equal(saved.stats.STR,3);
  saved.stats.STR+=2;recoverWizardSpells(saved);assert.equal(saved.stats.STR,14);assert.ok(!saved.wizardEffects.some(effect=>effect.type==='stat-collapse'));
});

test('sinkhole rolls DEX for every nearby corporeal creature and can queue Feather Fall before damage',()=>{
  const state=scene(),caster=state.characters[0];state.characters[1].conditions={incorporeal:true};
  const result=fixed(0,()=>applyHigherMishap(state,caster,'Fireball',7,{tier:3,random:()=>0,queueFall:(target,event)=>{target.pendingFall=event;return true;}}));
  assert.equal(state.entities.at(-1).subtype,'arcane-sinkhole');assert.equal(result.falls.length,2);
  assert.equal(caster.hp,100);assert.equal(caster.pendingFall.damage,3);assert.ok(caster.conditions.prone);assert.ok(caster.conditions.sinkhole);
  assert.equal(characterMovementBudget(caster),0);assert.equal(state.characters[1].conditions.sinkhole,undefined);
});

test('petrification halves movement per leg, limits hands, and expires after 24 game hours rather than rest',()=>{
  const state=scene(),caster=state.characters[0];caster.className='Fighter';
  caster.wizardEffects=[{type:'petrified-limbs',limbs:['left arm','left leg'],remainingMs:86400000}];
  caster.gear=[{name:'Longsword',equipped:true},{name:'Shield',equipped:true},{name:'Crossbow'}];
  assert.equal(availableHands(caster),1);assert.equal(characterMovementBudget(caster),3);
  ensureEquipment(caster);assert.equal(caster.gear.filter(item=>item.equipped).length,1);assert.equal(equipItem(caster,2,true),false);
  equipItem(caster,1,true);assert.equal(caster.gear[0].equipped,false);assert.equal(caster.gear[1].equipped,true);
  recoverWizardSpells(caster);assert.equal(availableHands(caster),1);
  advanceWizardTime(state,86400000);assert.equal(availableHands(caster),2);assert.equal(characterMovementBudget(caster),6);
});

test('same-tier bans last until rest, raving expires on the right clock, and instability covers the right tiers',()=>{
  const state=scene(),caster=state.characters[0];
  applyHigherMishap(state,caster,'Fireball',9,{tier:3});assert.equal(blocksSpellTier(caster,3),true);assert.equal(blocksSpellTier(caster,2),false);
  fixed(0,()=>applyHigherMishap(state,caster,'Fireball',10,{tier:3,random:()=>0}));assert.equal(isRaving(caster),true);assert.equal(characterMovementBudget(caster),0);
  advanceWizardTime(state,10000,{rounds:1});assert.equal(isRaving(caster),false);
  fixed(0,()=>applyHigherMishap(state,caster,'Wish',9,{tier:5,random:()=>0}));assert.equal(isRaving(caster),true);
  advanceWizardTime(state,3599999,{rounds:0});assert.equal(isRaving(caster),true);
  advanceWizardTime(state,1,{rounds:0});assert.equal(isRaving(caster),false);
  applyHigherMishap(state,caster,'Fireball',12,{tier:3});assert.equal(wizardCastingMode(caster,2).disadvantage,true);assert.equal(wizardCastingMode(caster,4).disadvantage,false);
  applyHigherMishap(state,caster,'Wish',11,{tier:5});assert.equal(wizardCastingMode(caster,5).disadvantage,true);
  recoverWizardSpells(caster);assert.equal(blocksSpellTier(caster,3),false);
});

test('Astral Incision and Ord sacrifice permanently remove spells and retain loss through rest/save/load',()=>{
  const state=scene(),caster=state.characters[0];
  applyHigherMishap(state,caster,'Wish',3,{tier:5,knownSpells:['Magic Missile'],random:()=>0});
  assert.ok(!caster.spellsKnown.includes('Magic Missile'));assert.ok(forgottenSpells(caster).has('magic missile'));
  applyHigherMishap(state,caster,'Wish',10,{tier:5});assert.deepEqual(ordBalanceOptions(caster,tier).map(option=>option.name),['Fireball','Wish']);
  resolveOrdBalance(caster,{kind:'spell',name:'Fireball'},tier);recoverWizardSpells(caster);
  const saved=hydrateDungeonState(serializeDungeonState(state)).characters[0];assert.ok(!saved.spellsKnown.includes('Fireball'));assert.ok(forgottenSpells(saved).has('fireball'));
  saved.spellsKnown='Light, Sleep';saved.wizardEffects.push({type:'ord-balance',pending:true});
  assert.deepEqual(ordBalanceOptions(saved,tier).map(option=>option.name),['Light','Sleep']);
  saved.gear=[{name:'Magic dagger',magic:{kind:'weapon'},quantity:1}];
  assert.deepEqual(ordBalanceOptions(saved,tier).map(option=>option.name),['Magic dagger']);
  resolveOrdBalance(saved,{kind:'item',index:0,name:'Magic dagger'},tier);assert.equal(saved.gear.length,0);
});

test('Grimlow TTL, Gate countdown, dark-plasma multiplier and Shred growth are saved and advance once per round',()=>{
  const state=scene(),caster=state.characters[0],summons=[];
  applyHigherMishap(state,caster,'Wish',4,{tier:5,random:()=>0,summon:(origin,options)=>{summons.push(options);return 'Grimlow emerges.';}});assert.equal(summons[0].rounds,2);
  applyHigherMishap(state,caster,'Wish',5,{tier:5,random:()=>0});assert.equal(attackDamageMultiplier(caster),2);
  applyHigherMishap(state,caster,'Wish',6,{tier:5,random:()=>.5});
  applyHigherMishap(state,caster,'Wish',12,{tier:5});
  const shred=state.entities.at(-1);assert.equal(shred.radius,.27);assert.equal(isShrouded(state,10,10),true);assert.equal(isShrouded(state,11,10),false);
  advanceArcanePhenomena(state,0,{summon:()=>{throw new Error('Must not spawn on poll');}});assert.equal(shred.radius,.27);
  advanceArcanePhenomena(state,2,{summon:(origin,options)=>{summons.push(options);return 'Foe emerges.';}});assert.equal(shred.radius,2.27);assert.equal(summons.length,1);
  advanceArcanePhenomena(state,1,{summon:(origin,options)=>{summons.push(options);return 'Foe emerges.';}});assert.equal(summons[1].minimumLevel,8);
  advanceArcanePhenomena(state,1,{summon:()=>{throw new Error('Must spawn once');}});
  state.entities.push({id:'closed-gate',subtype:'arcane-gate',rounds:1,closed:true});
  advanceArcanePhenomena(state,2,{summon:()=>{throw new Error('A deliberately closed Gate cannot spawn later');}});
  const saved=hydrateDungeonState(serializeDungeonState(state));assert.equal(saved.entities.find(entity=>entity.subtype==='arcane-shred').radius,shred.radius);
});

test('runaway arcana checks each subsequent turn, retargets on failure, and ends on success without losing spells',()=>{
  const state=scene(),caster=state.characters[0];
  applyHigherMishap(state,caster,'Wish',7,{tier:5,random:()=>0,canSee:()=>true});assert.equal(state.arcaneSpellEvents.length,1);
  fixed(0,()=>processArcanaLoop(state,caster,{random:()=>0,canSee:()=>true}));assert.equal(state.arcaneSpellEvents.length,2);assert.ok(caster.spellsKnown.includes('Wish'));
  fixed(.99,()=>processArcanaLoop(state,caster));assert.ok(!caster.wizardEffects.some(effect=>effect.type==='arcana-loop'));
});
