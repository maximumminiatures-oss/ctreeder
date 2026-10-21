import test from 'node:test';
import assert from 'node:assert/strict';
import { castFaithSpell,resolveFaithSpell,maintainFocus,advanceFaithRounds,faithArmorBonus,holyWeaponBonus,
  protectionDisadvantage,blocksMindControl,protectionName,chooseUndeadFleeStep,restoreMonsterSpellStats } from '../../S3_content/src/faith-spells.js';
import { canMoveBetweenTiles, collectLoot } from '../../S3_content/src/interactions.js';
import { hydrateDungeonState,serializeDungeonState } from '../../S3_content/src/persistence.js';

function scene() {
  const priest={id:'p',name:'Priest',className:'Priest',level:2,alignment:'Lawful',stats:{WIS:14},hp:10,maxHitPoints:10,x:2,y:2,
    gear:[{name:'Holy symbol'},{name:'Mace',equipped:true}],spellsKnown:'Shield of Faith, Holy Weapon, Protection from Evil, Turn Undead'};
  return {map:{width:12,height:7},seed:1,level:1,tiles:Array.from({length:84},(_,i)=>({x:i%12,y:Math.floor(i/12),type:'floor',roomId:'r',meta:{}})),
    rooms:[{id:'r',x:0,y:0,width:12,height:7}],entities:[],characters:[priest],player:{x:2,y:2},combat:{active:true,round:1},decor:{}};
}
const roll=value=>modifier=>({roll:value,total:value+modifier,modifier});
function random(value,fn) {const original=Math.random;Math.random=()=>value;try{return fn();}finally{Math.random=original;}}

test('old saved monsters recover alignment and CHA from source data without overwriting explicit stats',()=>{
  const state=scene();state.entities=[{type:'monster',name:'Zombie'},{type:'monster',name:'Zombie',alignment:'Neutral',chaModifier:3}];
  restoreMonsterSpellStats(state,[{name:'Zombie',AL:'C',Ch:'-2'}]);
  assert.equal(state.entities[0].alignment,'C');assert.equal(state.entities[0].chaModifier,-2);
  assert.equal(state.entities[1].alignment,'Neutral');assert.equal(state.entities[1].chaModifier,3);
});

test('Shield of Faith affects only caster, does not stack, offers both critical effects and expires',()=>{
  const state=scene(),priest=state.characters[0];
  castFaithSpell(state,priest,'shield of faith',{checkRoll:roll(12)});
  assert.equal(faithArmorBonus(priest),2);
  castFaithSpell(state,priest,'shield of faith',{checkRoll:roll(20)});
  resolveFaithSpell(state,priest,{choice:'bonus'}); assert.equal(faithArmorBonus(priest),4);
  advanceFaithRounds(state,4);assert.equal(faithArmorBonus(priest),4);
  advanceFaithRounds(state,1);assert.equal(faithArmorBonus(priest),0);
  castFaithSpell(state,priest,'shield of faith',{checkRoll:roll(20)});
  resolveFaithSpell(state,priest,{choice:'duration'});assert.equal(priest.faithEffects[0].rounds,10);
});

test('Holy Weapon waits for one equipped weapon, checks close/critical range and expires on that item',()=>{
  for(const choice of [null,'bonus','duration','range']) {
    const state=scene(),priest=state.characters[0];
    state.characters.push({id:'f',name:'Friend',hp:10,x:choice==='range'?4:3,y:2,gear:[{name:'Dagger',equipped:true},{name:'Spear',equipped:false}]});
    castFaithSpell(state,priest,'holy weapon',{checkRoll:roll(choice?20:12)});
    if(choice)resolveFaithSpell(state,priest,{choice});
    assert.equal(holyWeaponBonus(state.characters[1].gear[0]),0);
    resolveFaithSpell(state,priest,{targetId:'f'});
    assert.equal(holyWeaponBonus(state.characters[1].gear[0]),choice==='bonus'?2:1);
    assert.equal(holyWeaponBonus(state.characters[1].gear[1]),0);
    advanceFaithRounds(state,choice==='duration'?10:5);
    assert.equal(holyWeaponBonus(state.characters[1].gear[0]),0);
    assert.throws(()=>resolveFaithSpell(state,priest,{targetId:'f'}),/pending/);
  }
  const state=scene(),priest=state.characters[0];
  castFaithSpell(state,priest,'holy weapon',{checkRoll:roll(12)});
  state.characters.push({id:'f',hp:10,x:4,y:2,gear:[{name:'Spear',equipped:true}]});
  assert.throws(()=>resolveFaithSpell(state,priest,{targetId:'f'}),/range/);
  state.tiles[2*12+3].type='wall';state.characters[1].x=3;
  assert.throws(()=>resolveFaithSpell(state,priest,{targetId:'f'}),/range/);
});

test('protection applies alignment penalties, exempts caster, blocks mind control and is stopped by walls',()=>{
  const state=scene(),priest=state.characters[0],chaotic={id:'c',alignment:'Chaotic',x:3,y:2};
  castFaithSpell(state,priest,'protection from evil',{checkRoll:roll(12)});
  assert.equal(protectionDisadvantage(state,chaotic),true);
  assert.equal(protectionDisadvantage(state,priest),false);
  assert.equal(blocksMindControl(state,chaotic,'Beguile'),true);
  assert.equal(blocksMindControl(state,chaotic,'possess'),true);
  assert.equal(blocksMindControl(state,chaotic,'fireball'),false);
  state.tiles[2*12+3].type='wall';assert.equal(protectionDisadvantage(state,chaotic),false);
  state.tiles[2*12+3].type='floor';priest.alignment='Chaotic';
  castFaithSpell(state,priest,'protection from evil',{checkRoll:roll(12)});
  assert.equal(protectionName(priest),'Protection from Good');
  assert.equal(protectionDisadvantage(state,chaotic),false);
  assert.equal(protectionDisadvantage(state,{...chaotic,alignment:'Neutral'}),true);
});

test('Focus twenties never upgrade Protection; initial critical persists and ordinary failure only ends the effect',()=>{
  const state=scene(),priest=state.characters[0];
  castFaithSpell(state,priest,'protection from evil',{checkRoll:roll(12)});
  maintainFocus(state,priest,{checkRoll:roll(20)});assert.equal(priest.focusSpell.radius,1);
  assert.equal(priest.focusSpell.critical,false);
  castFaithSpell(state,priest,'protection from evil',{checkRoll:roll(20)});
  assert.equal(priest.focusSpell.radius,2);
  maintainFocus(state,priest,{checkRoll:roll(12)});assert.equal(priest.focusSpell.radius,2);
  maintainFocus(state,priest,{checkRoll:roll(2)});assert.equal(priest.focusSpell,null);
  assert.ok(!priest.failedSpellKeys?.includes('protection from evil'));
  castFaithSpell(state,priest,'protection from evil',{checkRoll:roll(12)});assert.equal(priest.focusSpell.radius,1);
  maintainFocus(state,priest,{checkRoll:roll(1)});
  assert.ok(priest.failedSpellKeys.includes('protection from evil'));
  assert.equal(priest.spellPenance['protection from evil'].paid,false);
});

test('Protection wizard mishap redirects the aura instead of dealing invented missile damage',()=>{
  const state=scene(),wizard=state.characters[0];wizard.className='Wizard';wizard.stats.INT=14;
  state.characters.push({id:'ally',name:'Ally',hp:10,x:4,y:2});
  random((4-.5)/12,()=>castFaithSpell(state,wizard,'protection from evil',{checkRoll:roll(1)}));
  assert.equal(wizard.hp,10);
  assert.equal(state.characters[1].hp,10);
  assert.equal(wizard.focusSpell.centerId,'ally');
});

test('Turn Undead uses explicit undead tags and CHA margins, creates one-copper ash and respects level',()=>{
  const state=scene(),priest=state.characters[0];
  state.entities=[{id:'z',type:'monster',name:'Zombie',tags:['undead'],level:2,hp:10,x:3,y:2,'**CH**':0},
    {id:'h',type:'monster',name:'Greater undead',tags:['undead'],level:3,hp:10,x:4,y:2,'**CH**':0},
    {id:'living',type:'monster',name:'Zombie impersonator',tags:['humanoid'],level:1,hp:10,x:3,y:3}];
  random(0,()=>castFaithSpell(state,priest,'turn undead',{checkRoll:roll(12)}));
  assert.equal(state.entities[0].hp,0);assert.equal(state.entities[0].defeated,true);
  assert.equal(state.entities[1].turnedUndead.rounds,5);
  assert.equal(state.entities[2].hp,10);
  assert.ok(state.entities.some(entity=>entity.name==='ash pile'&&entity.value===.01));
  const ash=state.entities.find(entity=>entity.name==='ash pile');
  state.activeCharacterId='p';
  assert.equal(collectLoot(state,ash.id).collected,1);
  const carried=state.characters[0].gear.find(item=>item.name==='ash pile');
  assert.equal(carried.value,.01);
  assert.equal(carried.corpseLoot,false);
  advanceFaithRounds(state,5);assert.equal(state.entities[1].turnedUndead,undefined);
});

test('Turn Undead critical choices independently double duration, range or lower the destruction threshold',()=>{
  for(const choice of ['duration','range','destroy']) {
    const state=scene(),priest=state.characters[0];
    state.entities=[{id:'z',type:'monster',name:'Zombie',tags:['undead'],level:choice==='destroy'?1:9,hp:10,x:choice==='range'?11:3,y:2,'**CH**':0}];
    castFaithSpell(state,priest,'turn undead',{checkRoll:roll(20)});
    assert.equal(state.entities[0].hp,10);
    random(.75,()=>resolveFaithSpell(state,priest,{choice}));
    if(choice==='destroy') assert.equal(state.entities[0].hp,0);
    else assert.equal(state.entities[0].turnedUndead.rounds,choice==='duration'?10:5);
  }
});

test('turned undead prefer a reachable hallway, never approach caster, and stop when cornered',()=>{
  const state=scene(),caster=state.characters[0],monster={x:5,y:2,roomId:'r'};
  state.tiles[1*12+5].hallId='h';
  const step=chooseUndeadFleeStep(state,monster,caster,(_x,_y,x,y)=>canMoveBetweenTiles(state,_x,_y,x,y).ok);
  assert.deepEqual([step.x,step.y],[5,1]);
  assert.ok(step.x>=monster.x);
  assert.equal(chooseUndeadFleeStep(state,monster,caster,()=>false),null);
});

test('focus and timed blessings survive save/load without losing weapon identity or duration',()=>{
  const state=scene(),priest=state.characters[0];
  castFaithSpell(state,priest,'shield of faith',{checkRoll:roll(12)});
  castFaithSpell(state,priest,'protection from evil',{checkRoll:roll(20)});
  castFaithSpell(state,priest,'holy weapon',{checkRoll:roll(12)});
  resolveFaithSpell(state,priest,{targetId:'p'});
  const restored=hydrateDungeonState(serializeDungeonState(state));
  assert.equal(faithArmorBonus(restored.characters[0]),2);
  assert.equal(restored.characters[0].focusSpell.radius,2);
  assert.equal(holyWeaponBonus(restored.characters[0].gear.find(item=>item.name==='Mace')),1);
});
