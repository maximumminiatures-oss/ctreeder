import test from 'node:test';
import assert from 'node:assert/strict';
import { blankScene, createPlacement, canMoveToken, validateScene, lightSegments, toggleRules } from '../../tools/tile-debugger/model.mjs';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { applyReviewedLayout, poseLayout } from '../../S3_content/src/reviewed-layouts.js';
import { canMoveBetweenTiles } from '../../S3_content/src/interactions.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { SeededRng } from '../../S3_content/src/rng.js';

const asset = { id: 'plr-1.png', name: 'plr-1.png', w: 1, h: 1, digest: 'pillar', pixelWidth: 54, pixelHeight: 54 };
const directions = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

test('plr-1 blocks every workbench approach without changing its pillar lighting', () => {
  for (let turn=0;turn<4;turn++) for (const flipX of [false,true]) {
    const scene=blankScene(), tile=createPlacement(asset,5,5);
    Object.assign(tile,{turn,flipX}); scene.placements.push(tile);
    assert.equal(tile.movement,true);
    assert.ok(Object.values(tile.annotations).every(rule=>rule.movement));
    assert.ok(Object.values(tile.annotations).every(rule=>!rule.light));
    assert.equal(tile.lightShape,'pillar');
    const lighting=lightSegments(scene);
    assert.equal(toggleRules(tile,[],'movement'),false);
    assert.equal(toggleRules(tile,['h:0:0'],'movement'),false);
    assert.deepEqual(lightSegments(scene),lighting);
    for (const [dx,dy] of directions) {
      scene.token.x=5+dx; scene.token.y=5+dy;
      assert.equal(canMoveToken(scene,-dx,-dy),false,`${turn}/${flipX}/${dx},${dy}`);
    }
  }
});

test('old workbench placements and saved asset rules cannot make plr-1 walkable', () => {
  const scene=blankScene(), tile=createPlacement(asset,5,5);
  tile.movement=false;
  for (const rule of Object.values(tile.annotations)) rule.movement=false;
  tile.annotations['h:0:0'].light=true;
  tile.annotations['h:0:0'].editedLight=true;
  scene.placements.push(tile); scene.reviewed[asset.id]=asset.digest;
  scene.assetRules[asset.id]={movement:false,lightShape:'pillar',annotations:structuredClone(tile.annotations)};
  const restored=validateScene(scene,[asset]);
  for (const item of [restored.placements[0],restored.assetRules[asset.id]]) {
    assert.equal(item.movement,true);
    assert.ok(Object.values(item.annotations).every(rule=>rule.movement));
    assert.equal(item.annotations['h:0:0'].light,true);
    assert.equal(item.annotations['h:0:0'].editedLight,true);
    assert.equal(item.lightShape,'pillar');
  }
});

test('generated and saved reviewed plr-1 placements block cardinal and diagonal movement', () => {
  const base={id:'pillar-test',width:5,height:5,floor:Array.from({length:25},(_,i)=>[i%5,Math.floor(i/5)]),
    ports:[['west',0,2],['east',4,2]],doors:[],placements:[{asset:'plr-1.png',x:2,y:2,w:1,h:1,
      turn:0,flipX:false,flipY:false,movement:false,lightShape:'pillar',annotations:{}}]};
  for (let turn=0;turn<4;turn++) for (const flipX of [false,true]) {
    const state=createEmptyDungeonState(7); state.map={width:11,height:11};
    state.tiles=Array.from({length:121},(_,i)=>({x:i%11,y:Math.floor(i/11),type:'wall',meta:{}}));
    const layout=poseLayout(base,turn,flipX);
    applyReviewedLayout(state,layout,3,3,'room',null,new SeededRng(7));
    assert.equal(state.tiles[5*11+5].meta.layoutBlocks,true);
    assert.equal(state.decor.reviewedMovement.length,4);
    assert.equal(state.decor.reviewedLight.length,4);
    const saved=hydrateDungeonState(serializeDungeonState(state));
    // Older runs can contain the artwork without movement metadata.
    saved.decor.reviewedMovement=[];
    delete saved.tiles[5*11+5].meta.layoutBlocks;
    for (const current of [state,saved]) for (const [dx,dy] of directions) {
      assert.equal(canMoveBetweenTiles(current,5+dx,5+dy,5,5).ok,false);
      assert.equal(canMoveBetweenTiles(current,5,5,5+dx,5+dy).ok,false);
    }
    assert.equal(canMoveBetweenTiles(saved,4,5,5,4).ok,false,'diagonal cannot cut across a pillar corner');
    assert.equal(canMoveBetweenTiles(saved,3,3,4,3).ok,true,'nearby floor stays passable');
  }
});
