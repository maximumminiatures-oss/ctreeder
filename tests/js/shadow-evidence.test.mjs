import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { blankScene, createPlacement } from '../../tools/tile-debugger/model.mjs';

test('evidence compilation rejects draft paths and respects authoritative shared deletion', async () => {
  const asset={id:'org-fixture.png',name:'org-fixture.png',digest:'fixture',w:1,h:1};
  const server=createServer((request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({assets:[asset]}));});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const directory=await mkdtemp(join(tmpdir(),'sd-shadow-evidence-'));
  try {
    const artist={id:'artist',source:'artist',points:[[0,0],[.5,.5],[1,1]]};
    const inferred={id:'guess',source:'inferred',points:[[0,1],[1,0]]};
    const scene=blankScene(),tile=createPlacement(asset,3,3);
    tile.shadowPaths=[artist,inferred];tile.shadowSource='mixed';scene.placements=[tile];
    scene.shadowRules[asset.id]={digest:asset.digest,w:1,h:1,source:'mixed',paths:[artist,inferred]};
    const input=join(directory,'input.json'),output=join(directory,'rules.js'),report=join(directory,'report.json');
    await writeFile(input,JSON.stringify(scene));
    const command=[resolve('scripts/build_shadow_rules.mjs'),`http://127.0.0.1:${server.address().port}/api/catalog`,output,report,input];
    await promisify(execFile)(process.execPath,command);
    const evidence=JSON.parse(await readFile(report));
    assert.deepEqual(evidence.rules[asset.id].paths,[artist]);
    const removed=structuredClone(scene);removed.shadowRules[asset.id]={...scene.shadowRules[asset.id],source:'artist',paths:[]};
    const deletion=join(directory,'deleted.json');await writeFile(deletion,JSON.stringify(removed));
    await promisify(execFile)(process.execPath,[...command,deletion]);
    assert.deepEqual(JSON.parse(await readFile(report)).rules[asset.id].paths,[]);
  } finally {
    await new Promise(done=>server.close(done));
    assert.ok(dirname(resolve(directory))===resolve(tmpdir()) && basename(directory).startsWith('sd-shadow-evidence-'),
      'temporary cleanup must remain within its named test directory');
    await rm(directory,{recursive:true});
  }
});
