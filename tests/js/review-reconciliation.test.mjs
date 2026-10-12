import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileShadowReview } from '../../tools/tile-debugger/review-reconciliation.mjs';

const asset={id:'org-test.png',name:'org-test.png',digest:'current',w:1,h:1};
const paths=[{id:'left',points:[[.1,0],[.1,1]],source:'inferred'},
  {id:'right',points:[[.9,0],[.9,1]],source:'inferred'}];
const initial={digest:asset.digest,w:1,h:1,source:'inferred',revision:'v1',paths};
const snapshot=(name,rule)=>({name,scene:{shadowRules:{[asset.id]:rule}}});

test('review reconciliation recovers explicit deletions without learning later automatic resurrection',()=>{
  const result=reconcileShadowReview({[asset.id]:initial},[
    snapshot('edited.json',{...initial,revision:undefined,paths:[paths[0]]}),
    snapshot('reloaded.json',initial)
  ],[asset],{acceptBaseline:true});
  assert.deepEqual(result.rules[asset.id].paths,[paths[0]]);
  assert.equal(result.rules[asset.id].source,'inferred');
  assert.equal(result.rules[asset.id].edited,true);
  assert.equal(result.rules[asset.id].reviewed,true);
  assert.deepEqual(result.recoveredDeletions,[asset.id]);
  assert.deepEqual(result.pending,[]);
});

test('review acceptance is explicit and later artist replacements or empty definitions win',()=>{
  assert.deepEqual(reconcileShadowReview({[asset.id]:initial},[],[asset]).pending,[asset.id]);
  const artist={...initial,source:'artist',paths:[{id:'artist',points:[[.2,0],[.3,1]],source:'artist'}]};
  const result=reconcileShadowReview({[asset.id]:initial},[
    snapshot('artist.json',artist),snapshot('delete.json',{...artist,paths:[]})
  ],[asset],{acceptBaseline:true});
  assert.deepEqual(result.rules[asset.id].paths,[]);
  assert.equal(result.rules[asset.id].source,'artist');
  assert.equal(result.changes.length,2);
  assert.deepEqual(reconcileShadowReview({[asset.id]:{...initial,digest:'old'}},[],[asset]).rules,{});
});
