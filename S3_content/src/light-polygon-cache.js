// Exact mathematical inputs only. Current visibility and exploration are never cached here.
export const LIGHT_POLYGON_CACHE_LIMIT=32;
export const LIGHT_POLYGON_CACHE_BYTES=512*1024;
const worlds=new WeakMap();
export function lightPolygonCacheStats(state){
 const cache=worlds.get(state);return {entries:cache?.entries.size||0,estimatedBytes:cache?.bytes||0,hits:cache?.hits||0,misses:cache?.misses||0};
}
export function reuseExactLightPolygon(state,origin,radius,segments,calculate){
 let cache=worlds.get(state);
 if(!cache){cache={entries:new Map(),bytes:0,hits:0,misses:0};worlds.set(state,cache);}
 let finite=true;
 const signature=JSON.stringify([origin,radius,segments],(_,value)=>{
  if(typeof value==='number'){if(!Number.isFinite(value))finite=false;if(Object.is(value,-0))return '-0';}
  return value;
 });
 if(!finite)return calculate();
 const known=cache.entries.get(signature);
 if(known){cache.entries.delete(signature);cache.entries.set(signature,known);cache.hits++;return known.polygon;}
 cache.misses++;
 const polygon=calculate();
 // Polygon arrays are read-only, as with the existing per-pass cache and polygon-bounds index.
 const bytes=signature.length*2+polygon.length*16+128;
 if(bytes>LIGHT_POLYGON_CACHE_BYTES||!polygon.every(point=>point.every(Number.isFinite)))return polygon;
 cache.entries.set(signature,{polygon,bytes});cache.bytes+=bytes;
 while(cache.entries.size>LIGHT_POLYGON_CACHE_LIMIT||cache.bytes>LIGHT_POLYGON_CACHE_BYTES){
  const first=cache.entries.keys().next().value;cache.bytes-=cache.entries.get(first).bytes;cache.entries.delete(first);
 }
 return polygon;
}
