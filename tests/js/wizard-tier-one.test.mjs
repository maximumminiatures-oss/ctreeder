import test from 'node:test';
import assert from 'node:assert/strict';
import { castWizardTierOne, resolveWizardTierOne, maintainDetectMagic, refreshMagicDetection, identifyGear, mageArmorEffect } from '../../S3_content/src/wizard-tier-one.js';
import { advanceWizardTime } from '../../S3_content/src/wizard-mishaps.js';
import { magicPotion, magicScroll, enchantedEquipment } from '../../S3_content/src/magic-items.js';
import { queueFallingDamage, resolveFallingDamage } from '../../S3_content/src/falling.js';
import { canTargetAtRange } from '../../S3_content/src/targeting.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
const roll=value=>modifier=>({roll:value,total:value+modifier,modifier});

test('Mage Armor is immediate and self-only, with automatic AC 18 on a critical and no Focus change', () => {
  for (const natural of [12, 20]) {
    const state = scene(), caster = state.characters[0];
    caster.focusSpell = { spell: 'detect magic', radius: 6 };
    const outcome = castWizardTierOne(state, caster, 'mage armor', { checkRoll: roll(natural) });
    assert.equal(outcome.succeeded, true);
    assert.equal(mageArmorEffect(caster).armorClass, natural === 20 ? 18 : 14);
    assert.equal(mageArmorEffect(caster).rounds, 10);
    assert.equal(caster.pendingSpell, undefined);
    assert.equal(caster.focusSpell.spell, 'detect magic');
    assert.equal(caster.invisibility, undefined);
    assert.equal(mageArmorEffect(state.entities[0]), null);
  }
});

test('Mage Armor survives saves, refreshes without stacking and expires on the tenth round', () => {
  const state = scene(), caster = state.characters[0];
  castWizardTierOne(state, caster, 'mage armor', { checkRoll: roll(20) });
  advanceWizardTime(state, 40000, { rounds: 4 });
  assert.equal(mageArmorEffect(caster).rounds, 6);
  castWizardTierOne(state, caster, 'mage armor', { checkRoll: roll(12) });
  assert.equal(caster.wizardEffects.filter(effect => effect.type === 'mage-armor').length, 1);
  assert.equal(mageArmorEffect(caster).armorClass, 14);
  const loaded = hydrateDungeonState(serializeDungeonState(state));
  advanceWizardTime(loaded, 90000, { rounds: 9 });
  assert.equal(mageArmorEffect(loaded.characters[0]).rounds, 1);
  advanceWizardTime(loaded, 10000, { rounds: 1 });
  assert.equal(mageArmorEffect(loaded.characters[0]), null);
});

test('Mage Armor failures use ordinary wizard loss/mishaps without replacing an existing effect', () => {
  for (const natural of [2, 1]) {
    const state = scene(), caster = state.characters[0];
    castWizardTierOne(state, caster, 'mage armor', { checkRoll: roll(20) });
    const outcome = castWizardTierOne(state, caster, 'mage armor', { checkRoll: roll(natural) });
    assert.equal(outcome.succeeded, false);
    assert.ok(caster.failedSpellKeys.includes('mage armor'));
    assert.equal(mageArmorEffect(caster).armorClass, 18);
    if (natural === 1) assert.ok(outcome.mishaps.length > 0);
  }
});
function scene() {
  return {seed:1,level:1,map:{width:16,height:8},generation:{entranceRoomId:'r'},rooms:[{id:'r',x:0,y:0,width:16,height:8}],
    tiles:Array.from({length:128},(_,i)=>({x:i%16,y:Math.floor(i/16),type:'floor',roomId:'r',meta:{}})),decor:{},player:{x:2,y:2},
    characters:[{id:'w',name:'Wizard',className:'Wizard',stats:{INT:14},hp:8,maxHitPoints:8,x:2,y:2,gear:[],spellsKnown:'Detect Magic, Charm Person, Feather Fall'}],
    entities:[{id:'bandit',type:'monster',name:'Bandit',tags:['humanoid'],level:2,hp:8,x:4,y:2}],combat:{active:true,round:1},
    visibility:{visibleNow:new Set(['2,2','4,2']),exploredEver:new Set()}};
}
test('Charm Person targets humanoids within Near, respects level and protection, and all critical choices', () => {
  for(const choice of ['duration','targets','level']) {
    const state=scene(),caster=state.characters[0];castWizardTierOne(state,caster,'charm person',{checkRoll:roll(20)});
    resolveWizardTierOne(state,caster,{choice});
    assert.equal(caster.pendingSpell.remaining,choice==='targets'?2:1);
    state.entities[0].level=choice==='level'?4:2;
    const result=resolveWizardTierOne(state,caster,{targetId:'bandit',random:()=>.99});
    assert.equal(result.days,choice==='duration'?16:8);assert.equal(result.target.hostile,false);
    assert.equal(result.target.charm.remainingMs,result.days*86400000);
  }
  const state=scene(),caster=state.characters[0];castWizardTierOne(state,caster,'charm person',{checkRoll:roll(12)});
  state.entities[0].name='Wolf';state.entities[0].tags=['animal'];assert.throws(()=>resolveWizardTierOne(state,caster,{targetId:'bandit'}),/humanoid/);
  state.entities[0].name='Bandit';state.entities[0].tags=['humanoid'];state.entities[0].level=3;
  assert.throws(()=>resolveWizardTierOne(state,caster,{targetId:'bandit'}),/level 2/);
  state.entities[0].level=2;caster.focusSpell={spell:'protection from evil',radius:6,opposes:['chaotic']};
  assert.throws(()=>resolveWizardTierOne(state,caster,{targetId:'bandit'}),/prevents/);
});
test('Detect Magic reveals magic traps, disguises and magic-carrying stealth but not mundane stealth', () => {
  const state=scene(),caster=state.characters[0];state.entities=[];
  for(const [id,name,extra]of[['trap','Rune trap',{type:'trap',tags:['Magic']}],['mimic','Mimic',{}],['doppel','Doppelganger',{}],
    ['magic','Thief',{gear:[magicPotion('healing-1')],stealthState:{attempted:true,revealed:false}}],['mundane','Thief',{stealthState:{attempted:true,revealed:false}}]]) {
    state.entities.push({id,name,type:'monster',x:4,y:2,hp:8,...extra});
  }
  castWizardTierOne(state,caster,'detect magic',{checkRoll:roll(12)});
  assert.equal(state.entities[0].revealed,true);assert.equal(state.entities[1].disguiseRevealed,true);assert.equal(state.entities[2].disguiseRevealed,true);
  assert.equal(state.entities[3].stealthState.revealed,true);assert.equal(state.entities[4].stealthState.revealed,false);
  maintainDetectMagic(state,caster,{reason:'next round',checkRoll:roll(12)});maintainDetectMagic(state,caster,{reason:'next round',checkRoll:roll(12)});
  assert.equal(state.entities[0].magicPropertiesKnown,true);
});
test('full barriers stop sensing; invisible targets sensed by the caster become valid ranged targets', () => {
  const state=scene(),caster=state.characters[0],target=state.entities[0];target.invisibility={rounds:3};
  state.visibility={visibleNow:new Set(['4,2'])};
  castWizardTierOne(state,caster,'detect magic',{checkRoll:roll(12)});
  assert.equal(canTargetAtRange(state,caster,target,6,{directAttack:true}),true);
  for(let y=0;y<8;y++)state.tiles[y*16+3].type='wall';refreshMagicDetection(state);
  assert.equal(caster.magicDetectedIds.length,0);
});
test('Detect Magic Focus twenties never offer a choice; initial critical persists until Focus ends', () => {
  const state=scene(),caster=state.characters[0];castWizardTierOne(state,caster,'detect magic',{checkRoll:roll(12)});
  maintainDetectMagic(state,caster,{reason:'next round',checkRoll:roll(20)});
  assert.equal(caster.pendingSpell,undefined);assert.equal(caster.focusSpell.radius,6);
  assert.equal(caster.focusSpell.critical,false);
  castWizardTierOne(state,caster,'detect magic',{checkRoll:roll(20)});
  resolveWizardTierOne(state,caster,{choice:'range'});
  maintainDetectMagic(state,caster,{reason:'next round',checkRoll:roll(20)});
  assert.equal(caster.pendingSpell,null);
  assert.equal(caster.focusSpell.radius,12);maintainDetectMagic(state,caster,{checkRoll:roll(2)});
  assert.equal(caster.focusSpell,null);assert.ok(!caster.failedSpellKeys.includes('detect magic'));
});
test('identification requires two successful checks and one failure loses Detect Magic', () => {
  const state=scene(),caster=state.characters[0];caster.gear=[enchantedEquipment({name:'shortsword',costGp:7},'weapon',2)];
  let calls=0;const checkRoll=modifier=>roll(++calls===1?12:2)(modifier);
  const failed=identifyGear(state,caster,0,{checkRoll});assert.equal(failed.succeeded,false);assert.equal(calls,2);assert.equal(caster.gear[0].name,'Magic Shortsword');
  assert.ok(caster.failedSpellKeys.includes('detect magic'));caster.failedSpellKeys=[];
  identifyGear(state,caster,0,{checkRoll:roll(12)});assert.equal(caster.gear[0].name,'+2 Shortsword');
});
test('an imported INT-or-casting talent does not grant both choices',()=>{
  const state=scene(),caster=state.characters[0];
  caster.levels=[{level:1,talentRolledName:'Plus2INTOrPlus1Casting',talentRolledDesc:'+2 to Intelligence stat or +1 to wizard spellcasting checks'}];
  caster.bonuses=[{name:'Plus2INTOrPlus1Casting',bonusName:'Plus2INTOrPlus1Casting',bonusTo:''},
    {name:'PlusTwoIntOrPlusOneWizCasting',bonusName:'StatBonus',bonusTo:'INT:+2'}];
  const result=castWizardTierOne(state,caster,'detect magic',{checkRoll:roll(13)});
  assert.equal(result.check.modifier,2);assert.equal(result.check.total,15);
});
test('Feather Fall is self-only, has no critical benefit, and negates authoritative falling damage', () => {
  const state=scene(),caster=state.characters[0];assert.throws(()=>castWizardTierOne(state,caster,'feather fall',{checkRoll:roll(12)}),/falling/);
  queueFallingDamage(caster,{sourceId:'pit',damage:20,manual:false});
  const loaded=hydrateDungeonState(serializeDungeonState(state));
  resolveFallingDamage(loaded,loaded.characters[0],true,{checkRoll:roll(20)});
  assert.equal(loaded.characters[0].hp,8);assert.equal(loaded.characters[0].pendingSpell,null);assert.equal(loaded.characters[0].pendingFall,null);
  assert.equal(loaded.combat.actionUsed,false);
});
test('a Feather Fall scroll can provide the falling reaction without requiring the known spell',()=>{
  const state=scene(),caster=state.characters[0];caster.spellsKnown='Detect Magic';
  caster.gear=[magicScroll({name:'Feather Fall',tier:1,classes:['wizard']})];
  queueFallingDamage(caster,{sourceId:'pit',damage:20,manual:false});
  resolveFallingDamage(state,caster,true,{checkRoll:roll(12)});
  assert.equal(caster.hp,8);assert.equal(caster.gear[0].name,'Blank paper');assert.equal(caster.gear[0].value,1);
  assert.equal(caster.spellsKnown,'Detect Magic');
});
