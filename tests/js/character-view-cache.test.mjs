import test from 'node:test';
import assert from 'node:assert/strict';
import {characterViewSignature} from '../../S3_content/src/character-view-cache.js';
import {normalizeCharacterState} from '../../S3_content/src/characters.js';
test('movement mirrored by character normalization preserves the sheet fingerprint without mutating data',()=>{
 const s={characters:[{id:'hero',name:'Ad',className:'Fighter',ancestry:'Human',level:1,hp:8,maxHitPoints:8,stats:{STR:12},gear:[],x:2,y:2,roomId:'room',raw:{}}]};
 normalizeCharacterState(s);normalizeCharacterState(s);normalizeCharacterState(s);
 const before=characterViewSignature(s.characters[0],{});s.characters[0].x=3;s.characters[0].y=4;normalizeCharacterState(s);
 const saved=structuredClone(s.characters[0]);assert.equal(characterViewSignature(s.characters[0],{}),before);assert.deepEqual(s.characters[0],saved);
 s.characters[0].raw.x=9;s.characters[0].visualX=3.25;s.characters[0].raw.visualY=4.5;assert.equal(characterViewSignature(s.characters[0],{}),before);
});
test('HP, ancestry, gear, talents, ownership, combat and room changes still invalidate presentation',()=>{
 const hero={id:'hero',name:'Ad',x:2,y:2,roomId:'start',hp:8,ancestry:'Human',gear:[],bonuses:[],raw:{stats:{STR:12}}},context={owned:true,combat:false};
 const before=characterViewSignature(hero,context);
 for(const update of [c=>c.hp--,c=>c.ancestry='Elf',c=>c.gear.push({name:'Lantern'}),c=>c.bonuses.push({name:'Mastery'}),c=>c.raw.stats.STR++,c=>c.roomId='other']){
  const clone=structuredClone(hero);update(clone);assert.notEqual(characterViewSignature(clone,context),before);
 }
 assert.notEqual(characterViewSignature(hero,{...context,owned:false}),before);assert.notEqual(characterViewSignature(hero,{...context,combat:true}),before);
});
