import clipping from './vendor/polygon-clipping.js';
import {ORGANIC_EXPLORATION_MASKS} from './organic-exploration-data.js';
import {getOrganicTileData,normalizeOrganicAssetName} from './organic-tiles.js';
import {tileRulePoint} from './reviewed-tile-rules.js';
const tileShapes=new WeakMap(),placementShapes=new WeakMap();
function transform(mask,pose){const pixels={...pose,x:pose.x*54,y:pose.y*54,w:pose.w*54,h:pose.h*54};return mask.shape.map(polygon=>polygon.map(ring=>ring.map(point=>tileRulePoint(pixels,point).map(v=>v/54))));}
// This is terrain memory only. Current shadows still use artist light outlines.
export function organicExplorationArea(state,tile){
 const organic=getOrganicTileData(tile);
 if(organic && !tile.meta?.organicMacro){
  const mask=ORGANIC_EXPLORATION_MASKS[normalizeOrganicAssetName(organic.asset)];
  if(!mask||mask.w!==54||mask.h!==54)return null;
  const signature=[organic.asset,organic.rotationTurns,organic.flipX,organic.flipY,tile.x,tile.y].join(':');
  const cached=tileShapes.get(tile);if(cached?.signature===signature)return cached.shape;
  const shape=transform(mask,{x:tile.x,y:tile.y,w:1,h:1,turn:organic.rotationTurns,flipX:organic.flipX,flipY:organic.flipY});
  tileShapes.set(tile,{signature,shape});return shape;
 }
 if(!tile.meta?.organicMacro)return null;
 for(const placement of state.decor?.reviewed||[]){
  const mask=ORGANIC_EXPLORATION_MASKS[normalizeOrganicAssetName(placement.assetKey)];if(!mask)continue;
  const turn=placement.rotationTurns||0,w=mask.w/54,h=mask.h/54;
  if(tile.x<placement.x||tile.y<placement.y||tile.x>=placement.x+(turn%2?h:w)||tile.y>=placement.y+(turn%2?w:h))continue;
  const signature=JSON.stringify([placement.x,placement.y,turn,placement.flipX,placement.flipY,placement.assetKey]);
  let cached=placementShapes.get(placement);
  if(cached?.signature!==signature){cached={signature,shape:transform(mask,{x:placement.x,y:placement.y,w,h,turn,flipX:placement.flipX,flipY:placement.flipY}),tiles:new Map()};placementShapes.set(placement,cached);}
  const key=tile.x+','+tile.y;
  if(!cached.tiles.has(key))cached.tiles.set(key,clipping.intersection(cached.shape,[[[[tile.x,tile.y],[tile.x+1,tile.y],[tile.x+1,tile.y+1],[tile.x,tile.y+1],[tile.x,tile.y]]]]));
  return cached.tiles.get(key);
 }
 return null;
}
