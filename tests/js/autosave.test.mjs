import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAutosaveStep,createAutosaveCoordinator} from '../../S3_content/src/autosave.js';
import {serializeDungeonState,hydrateDungeonState} from '../../S3_content/src/persistence.js';
import {createEmptyDungeonState} from '../../S3_content/src/state-schema.js';

test('commanded step counting reaches 100 across the actual persistence codec',()=>{
 let state=createEmptyDungeonState(1,1);state.run.autosaveSteps=97;
 assert.equal(recordAutosaveStep(state),false);
 state=hydrateDungeonState(serializeDungeonState(state));
 assert.equal(recordAutosaveStep(state),false);
 assert.equal(recordAutosaveStep(state),true);
 assert.equal(state.run.autosaveSteps,0);
});
test('autosave writes are serialized and queued snapshots coalesce to the newest',async()=>{
 let release;const writes=[];let version=1;
 const c=createAutosaveCoordinator({canSave:()=>true,getSnapshot:()=>version,
  write:async s=>{writes.push(s);if(s===1)await new Promise(r=>release=r);}});
 const first=c.request('combat');await Promise.resolve();
 version=2;c.request('steps');version=3;c.request('stairs');release();
 await first;assert.deepEqual(writes,[1,3]);
});
test('failed autosaves can be retried and signed-out play never sends snapshots',async()=>{
 let allowed=false,fail=true,calls=0,errors=0;
 const c=createAutosaveCoordinator({canSave:()=>allowed,getSnapshot:()=>({seed:1}),
  write:async()=>{calls++;if(fail)throw Error('offline');},onError:()=>errors++});
 await c.request('steps');assert.equal(calls,0);
 allowed=true;assert.equal(await c.request('combat'),false);assert.equal(errors,1);
 fail=false;assert.equal(await c.request('retry'),true);assert.equal(calls,2);
});
