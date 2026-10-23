import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { extractShadowdarkCharacters, normalizeCharacterState } from '../../S3_content/src/characters.js';

const source=readFileSync(new URL('../../S3_content/src/main.js',import.meta.url),'utf8');
const loader=source.slice(source.indexOf('async function loadLocalTestParty('),source.indexOf('async function generateAndRender('));
const fixture=[['Shrigark','Thief',3],['Badzog','Wizard',5],['Ad','Fighter',6]].map(([name,cls,hp])=>({name,class:cls,maxHitPoints:hp,stats:{STR:10,DEX:10,CON:12,INT:14,WIS:10,CHA:10},gear:[],spellsKnown:'None'}));

async function preview(url,extra={}) {
  let fetched=0;
  const state={characters:[]};
  const context=vm.createContext({SERVER_RUNTIME:false,URLSearchParams,location:new URL(url),state,
    isSharedRoom:()=>false,fetch:async()=>{fetched++;return{ok:true,json:async()=>structuredClone(fixture)};},
    extractShadowdarkCharacters,normalizeCharacterState,TIER_TWO_SPELLS:new Set(['Acid Arrow']),
    PRIEST_TIER_TWO_SPELLS:new Set(['Bless']),findSpellRecord:name=>({name}),
    putCharacterFirst(){},placeCharactersNearStartingStairs(){},initializeImportedCharacterLight(){},
    ensureCharacterPresentation(){},syncPlayerToActiveCharacter(){},setStatus(message){throw new Error(message);},console,...extra});
  vm.runInContext(loader,context); await context.loadLocalTestParty(); return {state,fetched};
}

test('60 HP is granted only to the explicit Tier 2 localhost fixture, never to ordinary imports', async()=>{
  const before=JSON.stringify(fixture);
  const normal=await preview('http://127.0.0.1:5057/site/?test-party=three');
  assert.deepEqual(normal.state.characters.map(c=>c.hp),[3,5,6]);
  const tier=await preview('http://127.0.0.1:5057/site/?test-party=three&tier-two-test=one');
  assert.deepEqual(tier.state.characters.map(c=>c.hp),[60,60,60]);
  assert.deepEqual(tier.state.characters.map(c=>c.maxHitPoints),[60,60,60]);
  assert.equal(JSON.stringify(fixture),before);
  for(const [url,extra]of[
    ['https://ctreeder.com/site/?test-party=three&tier-two-test=one',{}],
    ['http://127.0.0.1:5057/site/?tier-two-test=one',{}],
    ['http://127.0.0.1:5057/site/?test-party=three&tier-two-test=one&room=shared',{}],
    ['http://127.0.0.1:5057/site/?test-party=three&tier-two-test=one',{SERVER_RUNTIME:true}],
    ['http://127.0.0.1:5057/site/?test-party=three&tier-two-test=one',{isSharedRoom:()=>true}]
  ])assert.equal((await preview(url,extra)).fetched,0,url);
});

test('Tier 2 priest preview changes only its derived class, spells and equipment, never original HP or exports', async()=>{
  const before=JSON.stringify(fixture);
  const result=await preview('http://127.0.0.1:5057/site/?test-party=three&priest-test=two');
  const priest=result.state.characters.find(character=>character.name==='Badzog');
  assert.equal(priest.className,'Priest');
  assert.equal(priest.level,4);
  assert.match(priest.spellsKnown,/Bless/);
  assert.ok(priest.gear.some(item=>item.name==='Holy Symbol'));
  assert.deepEqual(result.state.characters.map(character=>character.hp),[3,5,6]);
  assert.equal(JSON.stringify(fixture),before);
  assert.equal((await preview('https://ctreeder.com/site/?test-party=three&priest-test=two')).fetched,0);
});
