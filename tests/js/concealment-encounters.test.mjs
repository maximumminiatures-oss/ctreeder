import test from 'node:test';
import assert from 'node:assert/strict';
import {activateHalflingInvisibility, advanceConcealmentRounds, isInvisible, isHiddenMonster, makeInvisible, revealAfterOffense, surpriseParticipants, updateMonsterStealth, canDirectlyTarget} from '../../S3_content/src/concealment.js';
import {reactionAttitude, reactionSpeaker, resolveReaction, automaticallyHostile, processMorale, initializeMorale, suspiciousProvoked} from '../../S3_content/src/encounters.js';
import {buildMonsterCompanion, recordCompanionDamage, companionLeaves, initializeDisguises, concealedMimic, archiveSlainCharacter} from '../../S3_content/src/companions.js';

const hero=(id='hero',extra={})=>({id,name:id,ancestry:'Halfling',hp:8,maxHitPoints:8,x:1,y:1,stats:{WIS:10,CHA:14},languages:'Common',...extra});
const monster=(id='foe',extra={})=>({id,name:'Bandit',type:'monster',hp:12,maxHp:12,x:5,y:1,D:2,W:1,I:0,S:1,attack:'1 dagger +2 (1d4)',...extra});

test('halfling invisibility is one resource, lasts three rounds and survives attacking',()=>{
  const character=hero();activateHalflingInvisibility(character);
  revealAfterOffense(character);assert.equal(isInvisible(character),true);
  assert.throws(()=>activateHalflingInvisibility(character),/unavailable/);
  const state={characters:[character]};advanceConcealmentRounds(state,2);assert.equal(character.invisibility.rounds,1);
  advanceConcealmentRounds(state);assert.equal(isInvisible(character),false);assert.equal(character.halflingInvisibilityUsed,true);
});
test('wizard invisibility breaks on offense; direct ranged attacks cannot target invisible creatures',()=>{
  const character=hero();makeInvisible(character,{source:'spell',rounds:10,breakOnOffense:true});
  assert.equal(canDirectlyTarget(character,6),false);assert.equal(canDirectlyTarget(character,1),true);
  revealAfterOffense(character);assert.equal(isInvisible(character),false);
});
test('impostors cannot activate copied ancestry powers',()=>{
  assert.throws(()=>activateHalflingInvisibility(hero('fake',{companion:{kind:'doppelganger'}})),/unavailable/);
});
test('monster stealth rolls once, remains hidden and is revealed by later higher Wisdom',()=>{
  const foe=monster(),state={entities:[foe],characters:[hero()]};let calls=0;
  const options={random:()=>{calls++;return .55;}};
  updateMonsterStealth(state,options);assert.equal(foe.stealthState.total,14);assert.equal(isHiddenMonster(foe),true);
  updateMonsterStealth(state,options);assert.equal(calls,1);
  state.characters.push(hero('sage',{stats:{WIS:18}}));updateMonsterStealth(state,options);
  assert.equal(isHiddenMonster(foe),false);assert.equal(calls,1);
});
test('only hidden participants, initiator and goblins act during surprise',()=>{
  const a=hero(),b=hero('b',{ancestry:'Human'}),g=hero('g',{ancestry:'Goblin'}),foe=monster();makeInvisible(a);
  assert.deepEqual(surpriseParticipants({characters:[a,b,g],entities:[foe]},foe,{forcedSurprisedIds:[a.id,b.id,g.id]}),['g','foe']);
});
test('reaction table covers all boundaries and talking uses only the chosen CHA modifier',()=>{
  assert.deepEqual([0,6,7,8,9,10,11,12,20].map(reactionAttitude),['hostile','hostile','suspicious','suspicious','neutral','curious','curious','friendly','friendly']);
  const foe=monster(),state={characters:[hero(),hero('sage',{stats:{CHA:18}}),hero('far',{x:30,stats:{CHA:20}})]};
  const speaker=reactionSpeaker(state,foe);assert.equal(speaker.id,'sage');
  assert.equal(resolveReaction(state,foe,{talk:true,speaker,random:()=>.5}).total,12);
  assert.equal(resolveReaction(state,foe,{talk:false,speaker,random:()=>.5}).total,8);
});
test('automatic hostility respects animals and intelligence thresholds',()=>{
  assert.equal(automaticallyHostile(monster('d',{name:'Demon',I:5})),true);
  assert.equal(automaticallyHostile(monster('u',{tags:['undead'],I:-1})),true);
  assert.equal(automaticallyHostile(monster('u',{tags:['undead'],I:0})),false);
  assert.equal(automaticallyHostile(monster('a',{name:'Wolf',I:-4})),false);
  assert.equal(automaticallyHostile(monster('a',{name:'Abomination',I:-4})),true);
});
test('suspicious creatures ignore invisible nearby characters',()=>{
  const character=hero(),foe=monster('foe',{x:3,attitude:'suspicious'});makeInvisible(character);
  assert.equal(suspiciousProvoked({characters:[character]},foe),false);
  delete character.invisibility;assert.equal(suspiciousProvoked({characters:[character]},foe),true);
});
test('morale uses the highest nearby Wisdom and excludes immune creatures',()=>{
  const hurt=monster('hurt',{hp:5}),wise=monster('wise',{W:4}),undead=monster('z',{tags:['undead'],W:9});
  const state={characters:[hero()],entities:[hurt,wise,undead],combat:{active:true}};
  const [result]=processMorale(state,{random:()=>0});assert.equal(result.modifier,4);
  assert.equal(hurt.moraleFlight.rounds,5);assert.equal(wise.moraleFlight.rounds,5);assert.equal(undead.moraleFlight,undefined);
  assert.equal(processMorale(state,{random:()=>0}).length,0);
});
test('population morale triggers once when a group of three falls below half',()=>{
  const state={characters:[hero()],entities:[monster('a'),monster('b'),monster('c')],combat:{active:true}};initializeMorale(state);
  state.entities[0].defeated=true;assert.equal(processMorale(state).length,0);
  state.entities[1].defeated=true;assert.equal(processMorale(state,{random:()=>0}).length,1);
});
test('friendly companions retain native statistics and cumulative damage despite healing',()=>{
  const character=buildMonsterCompanion(monster(),{controllerId:'hero',random:()=>0});
  assert.equal(character.companion.gearCapacity,12);assert.equal(character.stats.STR,12);
  recordCompanionDamage(character,5);character.hp=12;recordCompanionDamage(character,3);assert.equal(character.companion.departurePending,true);
  const state={characters:[character],entities:[]};assert.match(companionLeaves(state,character),/tearful goodbye/);
  assert.equal(state.characters.length,0);assert.equal(state.entities.some(entity=>entity.departing),true);assert.equal(state.entities.some(entity=>entity.subtype==='dropped-equipment'),true);
});
test('disguises and corpse storage never overwrite the original character',()=>{
  const mimic=monster('m',{name:'Mimic'}),doppel=monster('d',{name:'Doppelganger'}),state={seed:1,entities:[mimic,doppel]};
  initializeDisguises(state);assert.equal(concealedMimic(mimic),true);assert.equal(doppel.hostile,false);
  const original=hero('original',{gear:[{name:'Sword'}],dead:true,hp:0});state.characters=[original];
  const corpse=archiveSlainCharacter(state,original);assert.equal(corpse.characterCorpse.gear.length,1);assert.equal(original.gear.length,1);
  const fake=buildMonsterCompanion(doppel,{kind:'doppelganger',impersonated:original});
  assert.equal(fake.name,original.name);assert.equal(fake.companion.gearCapacity,12);assert.equal(fake.gear[0].bound,true);
});
