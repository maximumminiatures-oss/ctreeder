import {transferredMonsterGear} from './companions.js';

/** Conjured bodies expire; physical inventory acquired in play remains physical. */
export function clearConjuredRemains(state,target){
 if(!target?.conjuredCreature)return false;
 for(const [index,item]of(target.gear||target.carriedGear||[]).entries()){
  if(item.conjuredSourceId)continue;
  state.entities.push({id:'expired-summon-'+target.id+'-'+index+'-'+Date.now(),type:'treasure',
   subtype:'dropped-equipment',kind:'gear',name:item.name,x:target.x,y:target.y,routeId:target.routeId||'',
   roomId:target.roomId,visible:true,revealed:true,collected:false,value:Number(item.value)||0,
   slots:item.slots??1,gearItem:transferredMonsterGear(item)});
 }
 target.gear=[];target.carriedGear=[];
 state.entities=state.entities.filter(e=>e.conjuredSourceId!==target.id);
 for(const holder of [...(state.characters||[]),...state.entities]){
  if(holder.gear)holder.gear=holder.gear.filter(item=>item.conjuredSourceId!==target.id);
  if(holder.carriedGear)holder.carriedGear=holder.carriedGear.filter(item=>item.conjuredSourceId!==target.id);
  if(holder.raw?.gear)holder.raw.gear=holder.raw.gear.filter(item=>item.conjuredSourceId!==target.id);
 }
 return true;
}
