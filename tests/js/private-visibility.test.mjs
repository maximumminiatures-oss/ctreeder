import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { packPrivateVisibility, unpackPrivateVisibility, PRIVATE_VISIBILITY_ENCODING as encoding } from '../../S3_content/src/private-visibility.js';

function fixture() {
  const ring = [[1,1],[1.9999999999999998,1.2345678901234567],[2,2],[1,1]];
  return { floorLevel: 1, explorationMemory: { version: 1, compactRegions: true, routes: {
    '': { complete: { '2,2': true }, partial: { '1,1': Array.from({length:12000},()=>[ring,[[1.2,1.2],[1.3,1.2],[1.2,1.3],[1.2,1.2]]]) }, rooms:{}, halls:{} },
    '@legacy': { complete: {'3,3':true},partial:{},rooms:{},halls:{} }
  } }, closedDoorExploredSides: {door:['left']}, routeDarkvisionExplored: {'':['2,2']} };
}
test('large private geometry round-trips exactly, including holes, routes, tiny differences and door sides', async()=>{
  const value=fixture(),before=JSON.stringify(value),packed=await packPrivateVisibility(value);
  assert.ok(new TextEncoder().encode(before).length>1024*1024);
  assert.ok(JSON.stringify(packed).length<1024*1024);
  assert.deepEqual(await unpackPrivateVisibility(packed),value);
  assert.equal(JSON.stringify(value),before);
  assert.ok(packed.data.every(c=>c.length<=12000));
});
test('small legacy visibility stays compatible and packing does not require DOM state',async()=>{
 const value={exploredEver:['1,1']};assert.equal(await packPrivateVisibility(value),value);assert.equal(await unpackPrivateVisibility(value),value);
});
test('bad lengths, base64, unknown encoding, wrong floor, corrupt and oversized streams fail explicitly',async()=>{
 const packed=await packPrivateVisibility(fixture());
 for(const mutate of [p=>p.bytes++,p=>p.bytes=6*1024*1024,p=>p.floorLevel=2,p=>p.encoding='unknown',p=>p.data=['!'],p=>p.data[0]=p.data[0].slice(4)]){
  const p=structuredClone(packed);mutate(p);await assert.rejects(()=>unpackPrivateVisibility(p));
 }
 const bomb={encoding,bytes:100,data:[gzipSync(Buffer.alloc(1024*1024,65)).toString('base64')]};await assert.rejects(()=>unpackPrivateVisibility(bomb));
});
