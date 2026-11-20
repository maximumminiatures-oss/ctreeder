import {canMoveBetweenTiles,resolveGroundContact} from './interactions.js';
import {getTile} from './state-schema.js';
import {routeOf,sameRoute} from './underpasses.js';
import {isOnCeiling,quenchImmersedEffects} from './water-rules.js';

const offsets=[[0,-1],[1,0],[0,1],[-1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
const occupied=(state,actor,point)=>[...(state.characters||[]),...(state.entities||[])].some(other=>
 other.id!==actor.id&&(other.type==='monster'||state.characters?.includes(other))&&!other.illusion&&
 other.summon?.kind!=='floating-disc'&&!isOnCeiling(other)&&!other.dead&&!other.slain&&!other.defeated&&
 other.x===point.x&&other.y===point.y&&sameRoute(state,point,other));
/** A forced landing ignores voluntary habitat restrictions, but never crosses solid geometry. */
export function dropFromCeiling(state,actor,{random=Math.random,...options}={}){
 if(!isOnCeiling(actor))return null;
 const origin={x:actor.x,y:actor.y,routeId:routeOf(state,actor)};
 let destination=origin;
 if(occupied(state,actor,origin)){
  let frontier=[origin];const seen=new Set([origin.x+','+origin.y]);destination=null;
  while(frontier.length&&!destination){
   const next=[],free=[];
   for(const from of frontier)for(const [dx,dy]of offsets){
    const point={x:from.x+dx,y:from.y+dy,routeId:origin.routeId},key=point.x+','+point.y;
    if(seen.has(key))continue;
    if(!canMoveBetweenTiles(state,from.x,from.y,point.x,point.y,{routeId:origin.routeId,creature:actor,
      forceGround:true,ignoreWaterHabitat:true,ignorePits:true}).ok)continue;
    seen.add(key);next.push(point);if(!occupied(state,actor,point))free.push(point);
   }
   if(free.length)destination=free[Math.min(free.length-1,Math.floor(random()*free.length))];
   frontier=next;
  }
  if(!destination)return {blocked:true,message:'There is no available landing square.'};
 }
 delete actor.conditions.ceiling;
 Object.assign(actor,destination,{roomId:getTile(state,destination.x,destination.y)?.roomId??null});
 if(actor.raw){actor.raw.conditions=structuredClone(actor.conditions);actor.raw.x=actor.x;actor.raw.y=actor.y;actor.raw.routeId=actor.routeId;}
 if(state.activeCharacterId===actor.id&&state.player)Object.assign(state.player,{x:actor.x,y:actor.y,roomId:actor.roomId,routeId:actor.routeId});
 quenchImmersedEffects(state,actor);
 const contact=resolveGroundContact(state,actor,options);
 return {actorId:actor.id,destination,contact,message:actor.name+' drops from the ceiling.'+(contact?.message?' '+contact.message:'')};
}
