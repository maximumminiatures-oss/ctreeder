import data from './water-habitat-data.js';

// Exact authored identities, including the printed "Crab, Giant" / "Giant Crab" order.
const key = name => {
  const words=String(name||'').toLowerCase().match(/[a-z0-9]+/g)||[];
  return words.sort().join(' ').replace(/^megalodon shark$/,'megalodon');
};
const flags=Object.fromEntries(['eligible','bound','averse','prefersWater'].map(kind=>[kind,new Set(data[kind].map(key))]));
const variants=new Map(Object.entries(data.variants).map(([name,variant])=>[key(name),variant]));
const nameOf=creature=>creature?.name||creature?.['Monster Name']||'';
export function waterHabitat(creature) {
  const source=creature?.companion?.source||creature;
  const identity=source?.stats && source.type!=='monster' ? '' : key(nameOf(source));
  const metadata=source?.waterHabitat||{};
  return Object.fromEntries(Object.entries(flags).map(([kind,names])=>[kind,Boolean(metadata[kind]||names.has(identity)||
    kind==='averse' && /\bvampire(?: spawn)?\b/i.test(creature?.ancestry||''))]));
}
const undead=monster=>(monster.tags||[]).some(tag=>String(tag).toLowerCase()==='undead');
export const waterEncounterRestricted=(state,room)=>state.generation?.waterPlan?.category==='water-dungeon'||
  state.generation?.waterPlan?.category==='high'&&state.generation.waterPlan.floodedRoomIds?.includes(room?.id);
export const roomHasWater=(state,room)=>state.generation?.waterPlan?.wetRoomIds?.includes(room?.id)===true;

export function makeSeaVariant(monster) {
  const base=nameOf(monster),name=variants.get(key(base));
  if(!name)return null;
  const result=structuredClone(monster),movement=String(monster.movement||monster['**MV**']||'near');
  result.name=name;
  if(Object.hasOwn(monster,'Monster Name'))result['Monster Name']=name;
  result.waterBaseName=base;
  result.waterHabitat={...monster.waterHabitat,eligible:true,seaVariant:true};
  const swim=/\bswim\b/i.test(movement)?movement:movement.includes('(')?movement.replace(/\)?$/,', swim)'):movement+' (swim)';
  result.movement=swim;
  if(Object.hasOwn(monster,'**MV**'))result['**MV**']=swim;
  const rewrite=value=>{
    let text=String(value);
    if(key(base)==='druid')text=text.replace(/Conjure Flames/g,'Boil Water').replace(/Summon Bear/g,'Summon Shark').replace(/brown bear/gi,'shark');
    if(key(base)==='priest')text=text.replace(/Holy Flame/g,'Holy Spark').replace(/magic flames/g,'magic sparks').replace(/\bfire\b/g,'lightning');
    return text;
  };
  for(const property of ['abilities','talents'])if(result[property]){
    result[property]=Array.isArray(result[property])?result[property].map(rewrite):
      Object.fromEntries(Object.entries(result[property]).map(([title,text])=>[rewrite(title),rewrite(text)]));
  }
  return result;
}

/** Filtering never changes the level table's surviving entries or their weights. */
export function waterEncounterTable(state,room,table=[]) {
  const plan=state.generation?.waterPlan;
  if(!plan)return table;
  const wet=roomHasWater(state,room),restricted=waterEncounterRestricted(state,room);
  const allowed=monster=>{
    const habitat=waterHabitat(monster);
    if(plan.category==='none'&&(habitat.bound||habitat.prefersWater))return false;
    if(habitat.bound&&!wet)return false;
    if(restricted&&(habitat.averse||!(habitat.eligible||plan.category==='water-dungeon'&&undead(monster))))return false;
    return !room?.crypt||undead(monster);
  };
  const pool=table.filter(allowed);
  return pool.length||!restricted?pool:table.map(makeSeaVariant).filter(Boolean).filter(allowed);
}
export function waterSpawnPlacement(state,room,monster) {
  const habitat=waterHabitat(monster);
  return {avoidWater:habitat.averse,requireWater:Boolean(habitat.bound||waterEncounterRestricted(state,room)&&habitat.eligible||
    habitat.prefersWater&&roomHasWater(state,room))};
}
