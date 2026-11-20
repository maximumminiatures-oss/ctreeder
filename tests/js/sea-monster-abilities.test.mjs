import {defeatMonster} from '../../S3_content/src/interactions.js';
import {ensureMonsterGear} from '../../S3_content/src/companions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import data from '../../S3_content/src/water-habitat-data.js';
import {createEmptyDungeonState,getTile} from '../../S3_content/src/state-schema.js';
import {makeSeaVariant} from '../../S3_content/src/water-habitats.js';
import {monsterAbilityDefinitions,castMonsterAbility} from '../../S3_content/src/monster-abilities.js';
import {holySparkActive,advanceSeaMonsterEffects} from '../../S3_content/src/sea-monster-abilities.js';
import {listMagicEffects,endMagicEffect,dismissSummon} from '../../S3_content/src/magic-effect-registry.js';
import {elementalDamage} from '../../S3_content/src/elemental-effects.js';
function scene(){
 const state=createEmptyDungeonState(1);
 for(const tile of state.tiles)if(tile.x<10&&tile.y<10){tile.type='floor';tile.meta.slowWater=true;}
 const caster={id:'druid',type:'monster',name:'Sea Druid',x:4,y:4,hp:31,maxHp:31,I:4,W:3,level:7,gear:[]};
 const hero={id:'hero',name:'Hero',x:6,y:4,hp:30,maxHitPoints:30,stats:{},gear:[]};
 state.characters=[hero];state.entities=[caster];return {state,caster,hero};
}
test('compiled habitat policy exactly matches its authored JSON',()=>{
 assert.deepEqual(data,JSON.parse(readFileSync(new URL('../../S3_content/data/water-habitats.json',import.meta.url))));
});
test('Sea Druid Boil Water uses the printed +5 casting bonus and applies fire damage through water rules',()=>{
 const {state,caster,hero}=scene();const entry=monsterAbilityDefinitions(caster).find(e=>e[0]==='boilWater');let modifier;
 const text=castMonsterAbility(state,caster,entry,[hero],{check:bonus=>{modifier=bonus;return {roll:12,total:12+bonus};},
  random:()=>.99,harm:(target,amount,source)=>{const actual=elementalDamage(target,amount,source,state).total;target.hp-=actual;return actual;}});
 assert.equal(modifier,5);assert.equal(hero.hp,24);assert.match(text,/6 fire damage/);
});
test('failed Sea spells are lost just like other monster spells',()=>{
 const {state,caster,hero}=scene();const entry=monsterAbilityDefinitions(caster).find(e=>e[0]==='boilWater');
 castMonsterAbility(state,caster,entry,[hero],{check:()=>({roll:1,total:25})});
 assert.deepEqual(caster.failedMonsterSpells,['boilWater']);assert.equal(hero.hp,30);
});
test('Summon Shark uses an unoccupied water cell and a five-round dispellable summon record',()=>{
 const {state,caster}=scene();const entry=monsterAbilityDefinitions(caster).find(e=>e[0]==='summonShark');
 const catalog=JSON.parse(readFileSync(new URL('../../S3_content/data/shadowdark-content.json',import.meta.url))).monsters;
 castMonsterAbility(state,caster,entry,[caster],{catalog,random:()=>0,check:()=>({roll:14,total:19})});
 const shark=state.entities.find(m=>m.name==='Shark');assert.ok(shark);
 assert.equal(getTile(state,shark.x,shark.y).meta.slowWater,true);
 assert.equal(shark.hp,catalog.find(m=>m.slug==='shark').hp);
 const effect=listMagicEffects(state).find(e=>e.spell==='summon shark');assert.ok(effect);
 advanceSeaMonsterEffects(state,4,dismissSummon);assert.ok(state.entities.some(e=>e.id===shark.id));
 advanceSeaMonsterEffects(state,1,dismissSummon);assert.equal(state.entities.some(e=>e.id===shark.id),false);
 assert.equal(state.spellEffects.length,0);
});
test('Sea Priest Holy Spark is a five-round lightning weapon buff and can be dispelled',()=>{
 const {state,caster}=scene();caster.name='Sea Priest';const entry=monsterAbilityDefinitions(caster)[0];let modifier;
 castMonsterAbility(state,caster,entry,[caster],{check:bonus=>{modifier=bonus;return {roll:13,total:13+bonus};}});
 assert.equal(modifier,3);assert.equal(holySparkActive(caster),true);
 const effect=listMagicEffects(state).find(e=>e.spell==='holy spark');assert.ok(effect);
 endMagicEffect(state,effect.id);assert.equal(holySparkActive(caster),false);
 const priest=makeSeaVariant({name:'Priest',abilities:{'Holy Flame':'Weapons ignite and deal an additional 1d6 fire damage.'}});
 assert.match(priest.abilities['Holy Spark'],/lightning/);
});

test('summoned shark acts after its druid, has no generated loot, and expiry preserves a real acquired dagger',()=>{
 const {state,caster,hero}=scene();state.combat={active:true,turnIndex:0,turnOrder:[{id:caster.id,type:'monster'},{id:hero.id,type:'character'}],monsterIds:[caster.id]};
 const catalog=JSON.parse(readFileSync(new URL('../../S3_content/data/shadowdark-content.json',import.meta.url))).monsters;
 const entry=monsterAbilityDefinitions(caster).find(e=>e[0]==='summonShark');
 castMonsterAbility(state,caster,entry,[caster],{catalog,random:()=>0,check:()=>({roll:14,total:19})});
 const shark=state.entities.find(e=>e.name==='Shark');assert.deepEqual(state.combat.turnOrder.map(e=>e.id),[caster.id,shark.id,hero.id]);
 assert.equal(ensureMonsterGear(shark).length,0);
 shark.gear.push({id:'real-dagger',name:'Dagger',type:'weapon',slots:1});
 const result=defeatMonster(state,shark);assert.equal(result.loot,null);
 const corpse=state.entities.find(e=>e.conjuredSourceId===shark.id);assert.ok(corpse);
 hero.gear.push({id:'collected-body',name:'Shark meat',conjuredSourceId:shark.id});
 advanceSeaMonsterEffects(state,5,dismissSummon);
 assert.equal(state.entities.some(e=>e.id===shark.id||e.conjuredSourceId===shark.id),false);
 assert.equal(hero.gear.some(e=>e.conjuredSourceId===shark.id),false);
 assert.equal(state.entities.filter(e=>e.gearItem?.id==='real-dagger').length,1);
});
