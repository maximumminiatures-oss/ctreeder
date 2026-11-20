import {getTile} from './state-schema.js';
import {SeededRng} from './rng.js';

export const WATER_ART_VERSION=2;
const key=(x,y)=>x+','+y;
const asset=item=>String(item.assetKey||item.asset||'').split(/[\\/]/).pop().replace(/\.png$/i,'');
const isWater=item=>/^(water|canal)-/i.test(asset(item))&&!/bridge/i.test(asset(item));
const flatKeys=[1,2,3,4,5,6,7,8,9,10,12].map(n=>'water-nn-'+n);
const cornerKeys=Array.from({length:13},(_,i)=>'water-nw-'+(i+1));
export const basicWaterWall=tile=>tile?.type==='wall'||tile?.meta?.reviewedWall===true;

/** Authored placements keep their native origin, rotation and rectangular footprint. */
export function authoredWaterBounds(state){
 const result=[];
 for(const [kind,items]of [['native',state.decor?.reviewed],['native',state.decor?.canals],['water',state.decor?.water]])
  for(const item of items||[]){
   if(item.generatedWater||!isWater(item))continue;
   if(kind==='water'){result.push(waterArtBounds(item));continue;}
   const turns=Number(item.rotationTurns||0)%2;
   let w=Number(item.gridWidthTiles||item.widthTiles||1),h=Number(item.gridHeightTiles||item.heightTiles||(/^water-nn-/.test(asset(item))?1.5:1));
   if(turns)[w,h]=[h,w];
   result.push({x:Number(item.x)+(Number(item.nudgeX)||0),y:Number(item.y)+(Number(item.nudgeY)||0),w,h});
  }
 return result;
}
export function authoredWaterCells(state){
 const cells=new Set();
 for(const r of authoredWaterBounds(state))for(let y=Math.floor(r.y);y<Math.ceil(r.y+r.h);y++)for(let x=Math.floor(r.x);x<Math.ceil(r.x+r.w);x++)
  if(getTile(state,x,y)?.type==='floor')cells.add(key(x,y));
 return cells;
}
/** Matches the established 54 x 81 flat-water snap: half a tile outside the shore. */
export function waterArtBounds(item){
 const flat=/^water-nn-/.test(asset(item))||item.variant==='nn';
 const direction=item.direction||'n';
 const r={x:Number(item.x)+(Number(item.nudgeX)||0),y:Number(item.y)+(Number(item.nudgeY)||0),w:1,h:1};
 if(flat){
  if(direction==='n'){r.y-=.5;r.h=1.5;}
  else if(direction==='s')r.h=1.5;
  else if(direction==='w'){r.x-=.5;r.w=1.5;}
  else r.w=1.5;
 }
 return r;
}
const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
function subtract(a,b){
 if(!overlaps(a,b))return [a];
 const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h),out=[];
 if(y>a.y)out.push({x:a.x,y:a.y,w:a.w,h:y-a.y});
 if(bottom<a.y+a.h)out.push({x:a.x,y:bottom,w:a.w,h:a.y+a.h-bottom});
 if(x>a.x)out.push({x:a.x,y,w:x-a.x,h:bottom-y});
 if(right<a.x+a.w)out.push({x:right,y,w:a.x+a.w-right,h:bottom-y});
 return out;
}
function rectIndex(){
 const buckets=new Map();
 const cells=r=>{const out=[];for(let y=Math.floor(r.y);y<Math.ceil(r.y+r.h);y++)for(let x=Math.floor(r.x);x<Math.ceil(r.x+r.w);x++)out.push(key(x,y));return out;};
 return {add(r){for(const k of cells(r)){if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);}},
  query(r){return [...new Set(cells(r).flatMap(k=>buckets.get(k)||[]))].filter(b=>overlaps(r,b));}};
}

/** Build artwork after the center regions are fixed. No new water paints over other water. */
export function buildWaterArtwork(state,wet,authored=authoredWaterCells(state),rng=new SeededRng(Number(state.seed)+91531)){
 const placements=[];
 for(const k of [...wet].sort()){
  if(authored.has(k))continue;
  const [x,y]=k.split(',').map(Number);
  const filled=(dx,dy)=>wet.has(key(x+dx,y+dy))||basicWaterWall(getTile(state,x+dx,y+dy));
  const n=filled(0,-1),e=filled(1,0),s=filled(0,1),w=filled(-1,0);
  const corner=!n&&!w?'nw':!n&&!e?'ne':!s&&!e?'se':!s&&!w?'sw':null;
  const edge=!n?'n':!e?'e':!s?'s':!w?'w':null;
  placements.push({x,y,assetKey:corner?rng.pick(cornerKeys):edge?rng.pick(flatKeys):'water-c',
   variant:corner?'nw':edge?'nn':'center',direction:corner||edge||'c',
   nudgeX:0,nudgeY:0,rotationTurns:0,flipX:false,flipY:false,generatedWater:true});
 }
 // Reserve every assigned tile before adding the outward transparent shore fringes.
 const core=rectIndex(),painted=rectIndex();
 for(const r of authoredWaterBounds(state)){core.add(r);painted.add(r);}
 for(const item of placements)core.add({x:item.x,y:item.y,w:1,h:1,owner:item});
 for(const item of placements){
  const bounds=waterArtBounds(item);
  let rects=[bounds];
  const blockers=[...core.query(bounds).filter(r=>r.owner!==item),...painted.query(bounds)];
  for(const blocker of blockers)rects=rects.flatMap(r=>subtract(r,blocker));
  if(rects.length!==1||JSON.stringify(rects[0])!==JSON.stringify(bounds))item.clipRects=rects;
  for(const r of rects)painted.add(r);
 }
 return placements.filter(item=>!item.clipRects||item.clipRects.length);
}

/** Upgrade only generated artwork; remembered terrain and water gameplay remain unchanged. */
export function repairGeneratedWaterArtwork(state){
 if(!state.generation?.waterPlan||state.generation.waterPlan.artVersion===WATER_ART_VERSION)return;
 const old=(state.decor?.water||[]).filter(item=>item.generatedWater);
 if(!old.length)return;
 const wet=new Set(state.tiles.filter(t=>t.meta?.slowWater).map(t=>key(t.x,t.y)));
 const authored=authoredWaterCells(state);
 state.decor.water=[...state.decor.water.filter(item=>!item.generatedWater),...buildWaterArtwork(state,wet,authored)];
 state.generation.waterPlan.artVersion=WATER_ART_VERSION;
}
