import test from 'node:test';
import assert from 'node:assert/strict';
import { roomRequest } from '../../S3_content/src/multiplayer.js';
import { packPrivateVisibility, unpackPrivateVisibility, PRIVATE_VISIBILITY_ENCODING as encoding, PRIVATE_VISIBILITY_HEADER as header } from '../../S3_content/src/private-visibility.js';

test('actual roomRequest compresses private fog, negotiates responses and preserves credentials/CSRF/no-store',async()=>{
 const value={floorLevel:1,explorationMemory:{version:1,routes:{'':{complete:{},partial:{'1,1':Array.from({length:2000},()=>[[[[1,1],[2,1],[1,2],[1,1]]]])},rooms:{},halls:{}}}}};
 const before=JSON.stringify(value),calls=[],original=globalThis.fetch;
 globalThis.fetch=async(path,options={})=>{
  if(path==='/api/session') return Response.json({csrf_token:'disposable-test-token'});
  calls.push({path,options});return Response.json({viewer_visibility:await packPrivateVisibility(value)});
 };
 try{
  const response=await roomRequest('fixture','presence',{viewer_visibility:value});assert.deepEqual(response.viewer_visibility,value);
  const {options}=calls[0];assert.equal(options.headers.get(header),encoding);assert.equal(options.headers.get('X-CSRFToken'),'disposable-test-token');
  assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  const wire=JSON.parse(options.body).viewer_visibility;assert.equal(wire.encoding,encoding);assert.deepEqual(await unpackPrivateVisibility(wire),value);assert.equal(JSON.stringify(value),before);
  globalThis.fetch=async()=>Response.json({viewer_visibility:{exploredEver:['1,1']}});
  assert.deepEqual((await roomRequest('fixture')).viewer_visibility,{exploredEver:['1,1']});
 }finally{globalThis.fetch=original;}
});

test('a later private snapshot waits for the older write, including leave',async()=>{
 const original=globalThis.fetch,calls=[];let release;
 const blocked=new Promise(resolve=>release=resolve);
 globalThis.fetch=async(path,options)=>{
  if(path==='/api/session')return Response.json({csrf_token:'fixture'});
  calls.push(JSON.parse(options.body));if(calls.length===1)await blocked;
  return Response.json({ok:true});
 };
 try{
  const first=roomRequest('ordering','presence',{viewer_visibility:{exploredEver:['1,1']}});
  const second=roomRequest('ordering','leave',{viewer_visibility:{exploredEver:['1,1','2,2']}});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls.length,1);
  release();await Promise.all([first,second]);assert.equal(calls.length,2);assert.deepEqual(calls[1].viewer_visibility.exploredEver,['1,1','2,2']);
 }finally{release();globalThis.fetch=original;}
});
