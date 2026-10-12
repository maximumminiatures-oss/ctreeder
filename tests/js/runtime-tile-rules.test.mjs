import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REVIEWED_TILE_RULES, ORGANIC_HALL_LAYOUTS } from '../../S3_content/src/reviewed-tile-data.js';
import { ORGANIC_LIGHTING_RULES } from '../../tools/tile-debugger/organic-lighting-drafts.mjs';
import { reviewedTileLightSegments } from '../../S3_content/src/reviewed-tile-rules.js';
import { applyOrganicLightingRules } from '../../tools/tile-debugger/lighting-rules.mjs';
import { createPlacement, lightSegments, canMoveToken } from '../../tools/tile-debugger/model.mjs';
import { poseLayout, applyReviewedLayout, canCrossReviewedGeometry } from '../../S3_content/src/reviewed-layouts.js';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { generateDungeon } from '../../S3_content/src/generator.js';
import { visualTilePoint } from '../../S3_content/src/tile-positions.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

const assets=JSON.parse(readFileSync(new URL('../../S3_content/data/organic-assets.json',import.meta.url)));
const canonical=segments=>[...new Set(segments.map(s=>JSON.stringify(s.map(p=>p.map(v=>Math.round(v*1e7)/1e7)).sort())))].sort();

test('all reviewed organic artwork is current, bundled and shares exact workbench shadows in every pose',()=>{
  assert.equal(assets.length,170);
  for(const [name,rule] of Object.entries(REVIEWED_TILE_RULES)) {
    assert.ok(assets.includes(name));
    assert.equal(createHash('sha256').update(readFileSync(new URL('../../S3_content/assets/'+name,import.meta.url))).digest('hex'),rule.digest);
    const profile=ORGANIC_LIGHTING_RULES[name];
    assert.deepEqual(rule.paths.map(p=>p.points),profile.paths.map(p=>p.points),name);
    for(let turn=0;turn<4;turn++) for(const flipX of [false,true]) {
      const asset={id:name,name,digest:rule.digest,w:rule.w,h:rule.h};
      const tile=createPlacement(asset,4,5);
      Object.assign(tile,{turn,flipX,shadowPaths:profile.paths});
      const scene={width:80,height:80,placements:[tile],shadowPaths:[]};
      applyOrganicLightingRules(scene,[asset],{[name]:profile});
      const expected=lightSegments(scene).slice(4).map(s=>s.map(p=>p.map(v=>v/54)));
      assert.deepEqual(canonical(reviewedTileLightSegments(name,tile)),canonical(expected),`${name}/${turn}/${flipX}`);
    }
  }
});

test('large organic halls preserve annotated movement and port connectivity in every pose',()=>{
  assert.equal(ORGANIC_HALL_LAYOUTS.length,10);
  for(const source of ORGANIC_HALL_LAYOUTS) for(let turn=0;turn<4;turn++) for(const flipX of [false,true]) {
    const layout=poseLayout(source,turn,flipX),state=createEmptyDungeonState(1),rule=REVIEWED_TILE_RULES[source.id];
    applyReviewedLayout(state,layout,8,8,null,'hall',new SeededRng(1));
    const placed={...layout.placements[0],x:8,y:8,annotations:Object.fromEntries(Object.entries(rule.movement).map(([key,movement])=>[key,{movement}]))};
    for(const [,x,y] of layout.ports) assert.equal(Boolean(getTile(state,8+x,8+y).meta.layoutBlocks),false);
    for(const [x,y] of layout.floor) {
      const point=visualTilePoint(state,8+x,8+y);
      assert.ok(point[0]>=8+x && point[0]<9+x && point[1]>=8+y && point[1]<9+y);
      assert.deepEqual(visualTilePoint(hydrateDungeonState(serializeDungeonState(state)),8+x,8+y),point);
    }
    for(const [x,y] of layout.floor) for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      if(!layout.floor.some(([xx,yy])=>xx===x+dx&&yy===y+dy))continue;
      const scene={width:80,height:80,placements:[placed],token:{x:8+x,y:8+y}};
      assert.equal(canCrossReviewedGeometry(state,8+x,8+y,8+x+dx,8+y+dy),canMoveToken(scene,dx,dy),`${source.id}/${turn}/${flipX}/${x}/${y}`);
    }
    assert.ok(state.tiles.filter(t=>t.meta.organicMacro).every(t=>!t.meta.layoutBlocks));
  }
});

test('floor-aligned visual centers interpolate smoothly without changing ordinary tile centers',()=>{
  const state=createEmptyDungeonState(1);
  getTile(state,3,4).meta.visualCenter=[.2,.7];
  getTile(state,4,4).meta.visualCenter=[.8,.3];
  assert.deepEqual(visualTilePoint(state,3,4),[3.2,4.7]);
  assert.deepEqual(visualTilePoint(state,3.5,4),[4,4.5]);
  assert.deepEqual(visualTilePoint(state,10,10),[10.5,10.5]);
});

test('organic generation uses large halls and crypts without an outer organic ring or overlapping artwork',()=>{
  const seen=new Set(); let crypts=0;
  for(let seed=1;seed<=25;seed++) {
    const state=generateDungeon(seed,1,{organicAssets:assets,architecturePattern:'organic'});
    assert.equal(state.generation.connectivityValid,true,`seed ${seed}`);
    assert.equal(state.tiles.some(t=>t.meta.organicShell),false);
    for(const item of state.decor.reviewed || []) if(item.assetKey.startsWith('org-hall-')) {
      seen.add(item.assetKey+'.png');
      const source=ORGANIC_HALL_LAYOUTS.find(layout=>layout.id===item.assetKey+'.png');
      const layout=poseLayout(source,item.rotationTurns,item.flipX);
      const floor=new Set(layout.floor.map(point=>point.join(',')));
      for(let y=0;y<layout.height;y++) for(let x=0;x<layout.width;x++) {
        const tile=getTile(state,item.x+x,item.y+y);
        assert.equal(tile.type,floor.has(`${x},${y}`)?'floor':'wall',`${seed}/${source.id}/${x}/${y}`);
        assert.equal(tile.meta.organicMacro,true);
      }
      assert.equal(state.halls.find(hall=>hall.id===item.hallId).tiles.some(tile=>tile.branch),false);
    }
    for(const tile of state.tiles.filter(t=>t.meta.organicMacro || t.meta.crypt)) assert.equal(Boolean(tile.meta.organic),false);
    crypts+=state.rooms.filter(r=>r.crypt).length;
  }
  assert.ok(crypts>0);
  assert.deepEqual([...seen].sort(),ORGANIC_HALL_LAYOUTS.map(l=>l.id).sort());
});
