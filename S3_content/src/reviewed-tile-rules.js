import { REVIEWED_TILE_RULES } from './reviewed-tile-data.js';
import { LEARNED_SHADOW_RULES } from './tile-shadow-rules.js';

export function hasFixedSolidMovement(asset) {
  return /^plr-1(?:\.png)?$/i.test(String(asset || '').split(/[\\/]/).pop());
}

export function getReviewedTileRule(asset) {
  const name=String(asset || '').split(/[\\/]/).pop();
  return REVIEWED_TILE_RULES[name.endsWith('.png') ? name : `${name}.png`] || null;
}

export function tileRulePoint(pose, [x,y]) {
  let w=pose.w,h=pose.h;
  if(pose.flipX) x=w-x;
  if(pose.flipY) y=h-y;
  for(let i=0;i<(pose.turn || 0);i++) { [x,y]=[h-y,x]; [w,h]=[h,w]; }
  return [(pose.x || 0)+x,(pose.y || 0)+y];
}

export function featureSegment(key) {
  const [kind,xx,yy]=key.split(':'),x=Number(xx),y=Number(yy);
  if(kind==='h') return [[x,y],[x+1,y]];
  if(kind==='v') return [[x,y],[x,y+1]];
  return [[x,y],[x,y]];
}

export function reviewedTileLightSegments(asset, pose) {
  const rule=getReviewedTileRule(asset) || LEARNED_SHADOW_RULES[asset];
  if(!rule || rule.w!==pose.w || rule.h!==pose.h) return null;
  const segments=(rule.lightEdges || []).map(featureSegment);
  for(const path of rule.paths || []) for(let i=1;i<path.points.length;i++) segments.push([path.points[i-1],path.points[i]]);
  return segments.map(segment=>segment.map(point=>tileRulePoint(pose,point)));
}

export function reviewedTileMovementSegments(asset, pose) {
  if (hasFixedSolidMovement(asset)) {
    return [[[0,0],[pose.w,0]],[[pose.w,0],[pose.w,pose.h]],
      [[pose.w,pose.h],[0,pose.h]],[[0,pose.h],[0,0]]]
      .map(segment=>segment.map(point=>tileRulePoint(pose,point)));
  }
  const rule=getReviewedTileRule(asset);
  if(!rule || rule.w!==pose.w || rule.h!==pose.h) return [];
  return Object.entries(rule.movement).filter(([,blocked])=>blocked)
    .map(([key])=>featureSegment(key).map(point=>tileRulePoint(pose,point)));
}

export function movementIntersects(a,b,c,d) {
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  return cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0 &&
    Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0])) &&
    Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]));
}
