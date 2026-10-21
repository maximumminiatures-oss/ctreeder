import test from 'node:test';
import assert from 'node:assert/strict';
import { castInvisibility, resolveInvisibility, INVISIBILITY_CRITICAL_CHOICES } from '../../S3_content/src/invisibility.js';
import { isInvisible, revealAfterOffense, activateHalflingInvisibility } from '../../S3_content/src/concealment.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

function scene() {
  const state=createEmptyDungeonState(1);state.map={width:7,height:7};
  state.tiles=Array.from({length:49},(_,i)=>({x:i%7,y:Math.floor(i/7),type:'floor'}));
  const caster={id:'wizard',name:'Wizard',className:'Wizard',hp:8,x:3,y:3,stats:{INT:12},gear:[],raw:{}};
  state.characters=[caster,{id:'friend',name:'Friend',hp:8,x:4,y:3,stats:{},gear:[],raw:{}}];state.entities=[];return {state,caster};
}
const critical=modifier=>({roll:20,total:20+modifier,modifier});
test('Invisibility adds a two-distinct-target critical and persists the remaining choice through save/load',()=>{
  const {state,caster}=scene();assert.ok(INVISIBILITY_CRITICAL_CHOICES.some(([key])=>key==='targets'));
  castInvisibility(state,caster,{checkRoll:critical});resolveInvisibility(state,caster,{choice:'targets'});
  assert.equal(resolveInvisibility(state,caster,{targetId:'friend'}).remaining,1);
  assert.equal(caster.pendingSpell.phase,'targeting');assert.ok(isInvisible(state.characters[1]));
  assert.throws(()=>resolveInvisibility(state,caster,{targetId:'friend'}),/different/);
  const loaded=hydrateDungeonState(serializeDungeonState(state)),wizard=loaded.characters.find(character=>character.id==='wizard');
  assert.equal(resolveInvisibility(loaded,wizard,{targetId:'wizard'}).remaining,0);assert.equal(wizard.pendingSpell,null);
  for(const character of loaded.characters)assert.equal(character.invisibility.breakOnOffense,true);
});
test('Wizard Invisibility still ends on offense; Halfling invisibility remains after offense',()=>{
  const {state,caster}=scene();castInvisibility(state,caster,{checkRoll:critical});resolveInvisibility(state,caster,{choice:'duration'});
  resolveInvisibility(state,caster,{targetId:'wizard'});assert.equal(caster.invisibility.rounds,20);
  revealAfterOffense(caster);assert.equal(isInvisible(caster),false);
  const halfling={id:'halfling',name:'Halfling',ancestry:'Halfling',hp:8};activateHalflingInvisibility(halfling);
  revealAfterOffense(halfling);assert.equal(isInvisible(halfling),true);
});
