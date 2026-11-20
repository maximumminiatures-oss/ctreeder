import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import clipping from '../../S3_content/src/vendor/polygon-clipping.js';

test('degenerate consumed-neighbor cycles return exact pieces instead of freezing exploration',()=>{
 // Run in a bounded child: the original library loops synchronously forever on
 // this reduced 44-vertex sample from an actual organic-map exploration merge.
 const fixture=new URL('../fixtures/exploration-merge-cycle.json',import.meta.url).href;
 const clipping=new URL('../../S3_content/src/vendor/polygon-clipping.js',import.meta.url).href;
 const exploration=new URL('../../S3_content/src/exploration-memory.js',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';
  import {readFileSync} from 'node:fs';
  import clipping from ${JSON.stringify(clipping)};
  import {mergeExplorationShapes} from ${JSON.stringify(exploration)};
  const shapes=JSON.parse(readFileSync(new URL(${JSON.stringify(fixture)}),'utf8'));
  assert.throws(()=>clipping.union(...shapes),/traversal cycled/);
  const pieces=mergeExplorationShapes(shapes);
  assert.equal(pieces.length,11);
  const points=shape=>shape.flat(2).map(p=>JSON.stringify(p)).sort();
  assert.deepEqual(points(pieces),points(shapes.flat()));
  assert.deepEqual(mergeExplorationShapes(shapes),pieces);
  // A failed operation must not poison the next ordinary operation.
  assert.deepEqual(clipping.union([[[[0,0],[1,0],[1,1],[0,1],[0,0]]]]),[[[[0,0],[1,0],[1,1],[0,1],[0,0]]]]);
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{timeout:3000,encoding:'utf8',windowsHide:true});
 assert.equal(result.error,undefined,result.error?.message);
 assert.equal(result.status,0,result.stderr);
});


test('indexed coincident-endpoint consumption preserves exact baseline geometry for dense fans and shared rectangle corners',()=>{
 const cases=JSON.parse(readFileSync(new URL('../fixtures/polygon-consumption-golden.json',import.meta.url),'utf8'));
 for(const {op,shapes,result} of cases)assert.deepEqual(clipping[op](...shapes),result);
});
