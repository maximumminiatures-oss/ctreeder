import {getTile} from './state-schema.js';
import {buildWaterArtwork,authoredWaterCells,basicWaterWall,WATER_ART_VERSION} from './water-art.js';
import {isSlowWaterTile} from './terrain-movement.js';

export const WATER_PROFILES=Object.freeze([
  {category:'none',weight:25,fraction:0,maxGroups:0},
  {category:'low',weight:35,fraction:.05,maxGroups:3},
  {category:'medium',weight:20,fraction:.10,maxGroups:6},
  {category:'high',weight:15,fraction:.30,maxGroups:Infinity},
  {category:'water-dungeon',weight:5,fraction:.90,maxGroups:Infinity}
].map(Object.freeze));

export function chooseWaterProfile(rng,category=null) {
  if(category){const profile=WATER_PROFILES.find(p=>p.category===category);if(!profile)throw Error('Unknown water category.');return profile;}
  let roll=rng.nextInt(1,100);
  for(const profile of WATER_PROFILES){roll-=profile.weight;if(roll<=0)return profile;}
}
const key=tile=>tile.x+','+tile.y;
const directions=[[0,-1],[1,0],[0,1],[-1,0]];
export function waterComponents(keys) {
  const remaining=new Set(keys),groups=[];
  while(remaining.size) {
    const first=remaining.values().next().value,queue=[first];remaining.delete(first);
    for(let i=0;i<queue.length;i++) {
      const [x,y]=queue[i].split(',').map(Number);
      for(const [dx,dy] of directions){const next=(x+dx)+','+(y+dy);if(remaining.delete(next))queue.push(next);}
    }
    groups.push(queue);
  }
  return groups;
}

/** Geometry is finished first. Existing authored water is never erased or painted over. */
export function applyDungeonWater(state,rng,profile,{eligible=tile=>tile.type==='floor',protectedKeys=new Set()}={}) {
  const floor=state.tiles.filter(eligible),byKey=new Map(floor.map(t=>[key(t),t]));
  const authored=authoredWaterCells(state);
  for(const tile of floor)if(isSlowWaterTile(state,tile.x,tile.y))authored.add(key(tile));
  const wet=new Set([...authored].filter(k=>byKey.has(k))),target=Math.round(floor.length*profile.fraction);
  const plan={version:1,artVersion:WATER_ART_VERSION,category:profile.category,targetFraction:profile.fraction,floorTiles:floor.length,
    targetTiles:target,authoredTiles:wet.size};
  state.generation.waterPlan=plan;
  if(profile.category==='none'&&wet.size)throw Error('Dry dungeons require dry authored templates.');
  plan.authoredOvershoot=wet.size>target;
  const available=floor.filter(t=>!protectedKeys.has(key(t))),candidates=new Set(available.map(key)),centers=new Set();
  // Grow complete center neighborhoods, never unrelated one-tile shoreline fragments.
  const footprint=tile=>{
    const cells=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const k=(tile.x+dx)+','+(tile.y+dy),other=byKey.get(k);
      if(candidates.has(k)||wet.has(k)){if(other)cells.push(k);}
      else if(!basicWaterWall(getTile(state,tile.x+dx,tile.y+dy)))return null;
    }
    return cells;
  };
  const addCenter=tile=>{centers.add(key(tile));for(const k of footprint(tile)||[])wet.add(k);};
  if(profile.category==='high'){
    const rooms=state.rooms.filter(r=>r.id!==state.generation.entranceRoomId).map(room=>{
      const cells=available.filter(t=>t.roomId===room.id);return {cells,extra:cells.filter(t=>!wet.has(key(t))).length};
    }).filter(r=>r.cells.length&&r.extra<=target-wet.size).sort((a,b)=>b.cells.length-a.cells.length);
    const selected=rooms.length?rng.pick(rooms.slice(0,3)):null;
    if(selected)for(const tile of selected.cells)wet.add(key(tile));
  }
  const seedLimit=Math.min(Math.max(1,Math.floor(target/9)),profile.category==='low'?rng.nextInt(1,3):profile.category==='medium'?rng.nextInt(1,6):1);
  const choices=()=>available.filter(t=>!centers.has(key(t))).map(tile=>({tile,cells:footprint(tile)})).filter(c=>c.cells?.length)
    .map(c=>({...c,extra:c.cells.filter(k=>!wet.has(k)).length})).filter(c=>c.extra>0&&c.extra<=target-wet.size+4);
  let groups=waterComponents(wet).length;
  while(groups<seedLimit&&wet.size<target){
    const separate=choices().filter(c=>!c.cells.some(k=>wet.has(k)));
    if(!separate.length)break;
    addCenter(rng.pick(separate).tile);groups=waterComponents(wet).length;
  }
  while(wet.size<target){
    const all=choices();if(!all.length)break;
    let frontier=all.filter(c=>c.cells.some(k=>wet.has(k)));
    if(!frontier.length){if(waterComponents(wet).length>=profile.maxGroups)break;frontier=all;}
    // Favor attached compact regions; edges and corners are assigned only after growth.
    const least=Math.min(...frontier.map(c=>c.extra));
    addCenter(rng.pick(frontier.filter(c=>c.extra===least)).tile);
  }
  state.decor||={};state.decor.water=(state.decor.water||[]).filter(t=>!t.generatedWater);
  for(const k of wet){const tile=byKey.get(k);tile.meta||={};tile.meta.slowWater=true;}
  state.decor.water.push(...buildWaterArtwork(state,wet,authored,rng));
  plan.centerTiles=[...centers];
  plan.actualTiles=wet.size;plan.actualFraction=wet.size/Math.max(1,floor.length);
  plan.groups=waterComponents(wet).length;plan.placementLimited=wet.size<target;
  plan.wetRoomIds=state.rooms.filter(room=>floor.some(t=>t.roomId===room.id&&wet.has(key(t)))).map(room=>room.id);
  plan.floodedRoomIds=state.rooms.filter(room=>{const cells=floor.filter(t=>t.roomId===room.id);return cells.length&&cells.every(t=>wet.has(key(t)));}).map(room=>room.id);
  return plan;
}
