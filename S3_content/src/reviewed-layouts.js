import { REVIEWED_LAYOUTS } from './reviewed-layout-data.js';
import { getTile, createDoorEntity } from './state-schema.js';
import { ORGANIC_HALL_LAYOUTS } from './reviewed-tile-data.js';
import { getReviewedTileRule, reviewedTileLightSegments, reviewedTileMovementSegments, hasFixedSolidMovement, isStatueAsset } from './reviewed-tile-rules.js';
import { sameRoute, routeOf } from './underpasses.js';
import { visualTilePoint } from './tile-positions.js';
import { isSlowWaterPlacement, isSlowWaterTile, isLegacyWaterMovementSegment } from './terrain-movement.js';

export const REVIEWED_ASSET_KEYS = [...new Set([...REVIEWED_LAYOUTS,...ORGANIC_HALL_LAYOUTS].flatMap(layout => layout.placements.map(tile => tile.asset.replace(/\.png$/i,''))))];
const DELTA = { north:[0,-1], east:[1,0], south:[0,1], west:[-1,0] };
const SIDES = Object.keys(DELTA);
const key = point => point.join(',');
export function layoutPoint(pose, [x,y]) {
  let w=pose.w,h=pose.h;
  if(pose.flipX) x=w-x; if(pose.flipY) y=h-y;
  for(let i=0;i<(pose.turn||0);i++) { [x,y]=[h-y,x]; [w,h]=[h,w]; }
  return [(pose.x||0)+x,(pose.y||0)+y];
}
function cell(pose, point) { return layoutPoint(pose,point.map(value=>value+.5)).map(Math.floor); }
function placedTile(tile, pose) {
  const points=[[0,0],[tile.w,0],[0,tile.h],[tile.w,tile.h]].map(point=>layoutPoint(pose,layoutPoint(tile,point)));
  const wanted=[[0,0],[1,0],[0,1]].map(point=>layoutPoint({ ...pose,x:0,y:0,w:1,h:1 },layoutPoint({...tile,x:0,y:0,w:1,h:1},point)));
  let match;
  for(let turn=0;turn<4;turn++) for(const flipX of [false,true]) {
    const candidate={w:1,h:1,turn,flipX};
    if([[0,0],[1,0],[0,1]].every((point,i)=>layoutPoint(candidate,point).every((v,a)=>v===wanted[i][a]))) match=candidate;
  }
  return { ...tile, x:Math.min(...points.map(p=>p[0])), y:Math.min(...points.map(p=>p[1])),
    turn:match.turn,flipX:match.flipX,flipY:false };
}
function side(pose, name) {
  const a=layoutPoint({...pose,x:0,y:0,w:1,h:1},[.5,.5]);
  const b=layoutPoint({...pose,x:0,y:0,w:1,h:1},[.5+DELTA[name][0],.5+DELTA[name][1]]);
  return SIDES.find(s=>DELTA[s][0]===b[0]-a[0]&&DELTA[s][1]===b[1]-a[1]);
}
export function poseLayout(layout, turn=0, flipX=false) {
  const pose={w:layout.width,h:layout.height,turn,flipX};
  return { ...layout, width:turn%2?layout.height:layout.width,height:turn%2?layout.width:layout.height,
    floor:layout.floor.map(point=>cell(pose,point)), placements:layout.placements.map(tile=>placedTile(tile,pose)),
    ports:layout.ports.map(([s,x,y])=>[side(pose,s),...cell(pose,[x,y])]),
    doors:layout.doors.map(door=>({ ...door,...Object.fromEntries(['x','y'].map((name,i)=>[name,cell(pose,[door.x,door.y])[i]])),
      orientation:turn%2?(door.orientation==='horizontal'?'vertical':'horizontal'):door.orientation })),
    token:layout.token?cell(pose,layout.token):undefined,
    centers:(layout.centers||[]).map(point=>layoutPoint(pose,point)),
    shadowPaths:(layout.shadowPaths||[]).map(path=>({...path,points:path.points.map(point=>layoutPoint(pose,point))})) };
}
export function pickReviewedLayout(rng, kind, pattern, enabled=true, entrySide=null) {
  if(!enabled) return null;
  if(pattern==='organic') {
    if(kind!=='hall' || rng.nextFloat()>.6) return null;
    const choices=ORGANIC_HALL_LAYOUTS.flatMap(layout=>Array.from({length:8},(_,i)=>poseLayout(layout,i%4,i>=4)))
      .filter(layout=>!entrySide || layout.ports.some(([side])=>side===entrySide));
    return choices.length ? rng.pick(choices) : null;
  }
  if(kind==='room' && rng.nextFloat()<.025) return poseLayout(REVIEWED_LAYOUTS.find(t=>t.isolatedBank),rng.nextInt(0,3));
  if(rng.nextFloat()>(kind==='entrance'?.15:kind==='hall'?.12:.22)) return null;
  const choices=REVIEWED_LAYOUTS.filter(t=>t.kind===kind&&!t.isolatedBank);
  return poseLayout(rng.pick(choices),rng.nextInt(0,3),rng.nextFloat()<.5);
}
function annotationSegments(tile, property) {
  return Object.entries(tile.annotations).filter(([,rule])=>rule[property] &&
    (property!=='light'||tile.lightShape!=='none'||rule.editedLight)).flatMap(([name])=>{
    const [kind,x,y]=name.split(':'); const a=[Number(x),Number(y)];
    if(kind==='p'&&property==='light') {
      const inset=1/16, [px,py]=a;
      const corners=[[px-inset,py-inset],[px+inset,py-inset],[px+inset,py+inset],[px-inset,py+inset]];
      return corners.map((point,i)=>[point,corners[(i+1)%4]].map(p=>layoutPoint(tile,p)));
    }
    const b=kind==='h'?[a[0]+1,a[1]]:kind==='v'?[a[0],a[1]+1]:a;
    return [[a,b].map(point=>layoutPoint(tile,point))];
  });
}
function intersects(a,b,c,d) {
  if(Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))>Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0])) ||
    Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))>Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))) return false;
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  return cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0;
}
export function canCrossReviewedGeometry(state, fromX,fromY,toX,toY, source = { x: fromX, y: fromY }) {
  if(!routeOf(state, source) && getTile(state,toX,toY)?.meta?.layoutBlocks && !isSlowWaterTile(state,toX,toY)) return false;
  for (const placement of state.decor?.reviewed || []) {
    if (!hasFixedSolidMovement(placement.assetKey) || !sameRoute(state, source, placement)) continue;
    const pose={x:placement.x,y:placement.y,w:placement.gridWidthTiles||1,h:placement.gridHeightTiles||1,
      turn:placement.rotationTurns||0,flipX:placement.flipX,flipY:placement.flipY};
    const width = pose.turn % 2 ? pose.h : pose.w, height = pose.turn % 2 ? pose.w : pose.h;
    if (toX >= pose.x && toY >= pose.y && toX < pose.x + width && toY < pose.y + height) return false;
    if (reviewedTileMovementSegments(placement.assetKey,pose).some(([a,b])=>
      intersects([fromX+.5,fromY+.5],[toX+.5,toY+.5],a,b))) return false;
  }
  if (routeOf(state, source)) return true;
  return !(state.decor?.reviewedMovement || []).some(segment=>!isLegacyWaterMovementSegment(state,segment) &&
    intersects([fromX+.5,fromY+.5],[toX+.5,toY+.5],...segment));
}
export function reviewedBlocksLine(state,fromX,fromY,toX,toY,source = { x: fromX, y: fromY }) {
  const from=visualTilePoint(state,fromX,fromY),to=visualTilePoint(state,toX,toY);
  for (const placement of state.decor?.reviewed || []) if (isStatueAsset(placement.assetKey) && sameRoute(state, source, placement)) {
    const pose = { x: placement.x, y: placement.y, w: placement.gridWidthTiles || 1, h: placement.gridHeightTiles || 1,
      turn: placement.rotationTurns || 0, flipX: placement.flipX, flipY: placement.flipY };
    if (reviewedTileLightSegments(placement.assetKey, pose).some(([a, b]) => intersects(from, to, a, b))) return true;
  }
  if (routeOf(state, source)) return false;
  return (state.decor?.reviewedLight||[]).some(([a,b])=>intersects(from,to,a,b));
}
export function hasRangedMonsterAttack(monster) {
  return /\b(?:near|far)\b/i.test(String(monster?.attack ?? monster?.['**ATK**'] ?? ''));
}
export function applyReviewedLayout(state, layout, x,y,roomId,hallId,rng) {
  state.decor.reviewed ||= []; state.decor.reviewedMovement ||= []; state.decor.reviewedLight ||= [];
  for (const path of layout.shadowPaths || []) for (let i=1;i<path.points.length;i++) {
    state.decor.reviewedLight.push([path.points[i-1],path.points[i]].map(([px,py])=>[px+x,py+y]));
  }
  const floor=new Set(layout.floor.map(key));
  for(let yy=y-1;yy<=y+layout.height;yy++)for(let xx=x-1;xx<=x+layout.width;xx++) {
    const tile=getTile(state,xx,yy);if(tile?.type==='wall')tile.meta.reviewedWall=true;
  }
  for(let yy=0;yy<layout.height;yy++) for(let xx=0;xx<layout.width;xx++) {
    const tile=getTile(state,x+xx,y+yy);
    Object.assign(tile,{type:floor.has(`${xx},${yy}`)?'floor':'wall',roomId:floor.has(`${xx},${yy}`)?roomId:null,hallId:floor.has(`${xx},${yy}`)?hallId:null});
    tile.meta.reviewed=true;
    if(layout.organicMacro) tile.meta.organicMacro=true;
    if(tile.type==='wall')tile.meta.reviewedWall=true;
  }
  for(const [cx,cy] of layout.centers || []) {
    const tile=getTile(state,x+Math.floor(cx),y+Math.floor(cy));
    tile.meta.visualCenter=[cx-Math.floor(cx),cy-Math.floor(cy)];
  }
  for(const tile of layout.placements) {
    const item={...tile,x:tile.x+x,y:tile.y+y};
    state.decor.reviewed.push({assetKey:tile.asset.replace(/\.png$/i,''),x:item.x,y:item.y,
      gridWidthTiles:tile.w,gridHeightTiles:tile.h,rotationTurns:tile.turn,flipX:tile.flipX,flipY:tile.flipY,roomId,hallId});
    const w=tile.turn%2?tile.h:tile.w,h=tile.turn%2?tile.w:tile.h;
    const fixedSolidMovement=hasFixedSolidMovement(tile.asset);
    const slowWater=isSlowWaterPlacement(tile);
    if(tile.movement || fixedSolidMovement || slowWater) for(let yy=item.y;yy<item.y+h;yy++)for(let xx=item.x;xx<item.x+w;xx++) {
      const target=getTile(state,xx,yy);if(target?.meta.reviewed)target.meta[slowWater?'slowWater':'layoutBlocks']=true;
    }
    const pose={x:item.x,y:item.y,w:tile.w,h:tile.h,turn:tile.turn,flipX:tile.flipX,flipY:tile.flipY};
    const rule=getReviewedTileRule(tile.asset);
    if(!slowWater) state.decor.reviewedMovement.push(...(rule || fixedSolidMovement ? reviewedTileMovementSegments(tile.asset,pose) : annotationSegments(item,'movement')));
    const reviewedLight=reviewedTileLightSegments(tile.asset,pose);
    state.decor.reviewedLight.push(...(reviewedLight ?? annotationSegments(item,'light')));
    if(reviewedLight===null && tile.lightShape==='solid') {
      const corners=[[0,0],[tile.w,0],[tile.w,tile.h],[0,tile.h]];
      state.decor.reviewedLight.push(...corners.map((point,i)=>[point,corners[(i+1)%4]].map(p=>layoutPoint(item,p))));
    }
    if(reviewedLight===null && tile.lightShape==='pillar') {
      const cx=item.x+w/2,cy=item.y+h/2,s=1/6;
      state.decor.reviewedLight.push([[cx-s,cy-s],[cx+s,cy-s]],[[cx+s,cy-s],[cx+s,cy+s]],[[cx+s,cy+s],[cx-s,cy+s]],[[cx-s,cy+s],[cx-s,cy-s]]);
    }
    if(reviewedLight===null) for(const path of tile.shadowPaths||[])for(let i=1;i<path.points.length;i++)state.decor.reviewedLight.push([path.points[i-1],path.points[i]].map(point=>layoutPoint(item,point)));
  }
  for(const door of layout.doors) {
    const entity=createDoorEntity(x+door.x,y+door.y,roomId,hallId,rng,door.orientation);
    entity.doorState='closed';entity.internal=true;state.entities.push(entity);
  }
  const seen=new Set(), start=layout.ports[0]?.slice(1);
  const queue=start?[[x+start[0],y+start[1]]]:[];
  while(queue.length) {
    const point=queue.shift();if(seen.has(key(point)))continue;seen.add(key(point));
    for(const [dx,dy]of [...Object.values(DELTA),[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const next=[point[0]+dx,point[1]+dy],local=[next[0]-x,next[1]-y];
      if(floor.has(key(local))&&!seen.has(key(next))&&!(layout.isolatedBank&&isSlowWaterTile(state,...next))&&canCrossReviewedGeometry(state,...point,...next))queue.push(next);
    }
  }
  const isolated=[];
  for(const [xx,yy]of layout.floor) {
    const tile=getTile(state,x+xx,y+yy);
    if(!tile.meta.layoutBlocks&&!isSlowWaterTile(state,tile.x,tile.y)&&!seen.has(`${tile.x},${tile.y}`)) {
      if(layout.isolatedBank){tile.meta.encounterOnly=true;isolated.push([tile.x,tile.y]);}
      else tile.meta.layoutBlocks=true;
    }
  }
  return {isolated};
}
