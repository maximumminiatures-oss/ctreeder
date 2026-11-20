import {isSlowWaterTile} from './water-terrain.js';
import {hasLineOfSightFrom} from './visibility.js';
import {routeOf,sameRoute} from './underpasses.js';
import {MAX_FLOOR_MONSTERS,livingFloorMonsters} from './floor-limits.js';

export const SEA_MONSTER_ABILITIES=Object.freeze({
 'sea druid':[
  ['boilWater','Boil Water',12,'',0,0,{spell:'INT',dc:12,castingBonus:5,damage:[2,6],damageType:'fire'}],
  ['summonShark','Summon Shark',6,'',0,0,{spell:'INT',dc:14,castingBonus:5,self:true,sea:'summon'}]
 ],
 'sea priest':[
  ['holySpark','Holy Spark',0,'',0,0,{spell:'WIS',dc:13,castingBonus:3,self:true,sea:'spark'}]
 ]
});
export const holySparkActive=creature=>(creature?.spellEffects||[]).some(e=>
 e.spell==='holy spark'&&e.active!==false&&e.rounds>0);
export function sharkSummonCells(state,caster){
 if(livingFloorMonsters(state).length>=MAX_FLOOR_MONSTERS)return [];
 return state.tiles.filter(tile=>isSlowWaterTile(state,tile.x,tile.y)&&Math.hypot(tile.x-caster.x,tile.y-caster.y)<=6&&
  ![...(state.characters||[]),...(state.entities||[])].some(e=>sameRoute(state,caster,e)&&
   e.x===tile.x&&e.y===tile.y&&!e.defeated&&!e.collected)&&
  hasLineOfSightFrom(state,caster.x,caster.y,tile.x,tile.y,{source:caster,target:{...tile,routeId:routeOf(state,caster)}}));
}
export function seaAbilityAvailable(state,monster,entry){
 const kind=entry[6]?.sea;
 return kind==='spark'?!holySparkActive(monster):kind==='summon'?sharkSummonCells(state,monster).length>0:true;
}
export function applySeaMonsterAbility(state,caster,entry,{catalog=[],random=Math.random}={}){
 const kind=entry[6]?.sea;
 if(kind==='spark'){
  caster.spellEffects=(caster.spellEffects||[]).filter(e=>e.spell!=='holy spark');
  caster.spellEffects.push({id:crypto.randomUUID(),spell:'holy spark',kind:'self',sourceType:'monster',
   casterId:caster.id,targetId:caster.id,rounds:5});
  return caster.name+' casts Holy Spark. Their weapons deal an additional 1d6 lightning damage for five rounds.';
 }
 if(kind==='summon'){
  const cells=sharkSummonCells(state,caster),source=catalog.find(m=>m.slug==='shark')||
   catalog.find(m=>/^shark$/i.test(m.name||m['Monster Name']||''));
  if(!source||!cells.length)throw Error('No valid water square is available for the summoned shark.');
  const tile=cells[Math.min(cells.length-1,Math.floor(random()*cells.length))],id=crypto.randomUUID();
  const monster={...structuredClone(source),id,type:'monster',name:source.name||source['Monster Name'],x:tile.x,y:tile.y,
   roomId:tile.roomId,routeId:routeOf(state,caster),maxHp:Number(source.hp||source['**HP**'])||1,
   hp:Number(source.hp||source['**HP**'])||1,ac:source.ac??source['**AC**'],attack:source.attack||source['**ATK**'],
   movement:source.movement||source['**MV**'],visible:true,encounterState:'hostile',
   monsterSummon:{sourceId:caster.id},conjuredCreature:true,gear:[],carriedGear:[]};
  state.entities.push(monster);
  state.spellEffects||=[];
  state.spellEffects.push({id:crypto.randomUUID(),spell:'summon shark',kind:'summon',sourceType:'monster',
   casterId:caster.id,targetId:id,rounds:5});
  if(state.combat?.active){
   state.combat.monsterIds||=[];state.combat.monsterIds.push(id);
   state.combat.turnOrder||=[];
   let index=state.combat.turnOrder.findIndex(e=>e.id===caster.id)+1;
   while(state.combat.turnOrder[index]&&state.entities.some(e=>e.id===state.combat.turnOrder[index].id&&e.monsterSummon?.sourceId===caster.id))index++;
   state.combat.turnOrder.splice(index,0,{id,type:'monster'});
  }
  return caster.name+' summons a loyal shark for five rounds.';
 }
 return null;
}
export function advanceSeaMonsterEffects(state,rounds,removeSummon){
 if(!(rounds>0))return false;
 let changed=false;
 for(const holder of [...(state.characters||[]),...(state.entities||[])]){
  for(const effect of holder.spellEffects||[])if(effect.spell==='holy spark'&&effect.sourceType==='monster'){
   effect.rounds-=rounds;changed=true;
  }
  if(holder.spellEffects)holder.spellEffects=holder.spellEffects.filter(e=>e.spell!=='holy spark'||e.rounds>0);
 }
 for(const effect of state.spellEffects||[])if(effect.spell==='summon shark'&&effect.sourceType==='monster'){
  effect.rounds-=rounds;changed=true;
  if(effect.rounds<=0){
   const target=[...(state.characters||[]),...(state.entities||[])].find(e=>e.id===effect.targetId);
   if(target)removeSummon(state,target);
  }
 }
 if(state.spellEffects)state.spellEffects=state.spellEffects.filter(e=>e.spell!=='summon shark'||e.rounds>0);
 return changed;
}
