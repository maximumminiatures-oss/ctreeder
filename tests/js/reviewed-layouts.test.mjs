import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVIEWED_LAYOUTS } from '../../S3_content/src/reviewed-layout-data.js';
import { ORGANIC_HALL_LAYOUTS } from '../../S3_content/src/reviewed-tile-data.js';
import { poseLayout, layoutPoint, applyReviewedLayout, canCrossReviewedGeometry,
  reviewedBlocksLine, hasRangedMonsterAttack } from '../../S3_content/src/reviewed-layouts.js';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { generateDungeon } from '../../S3_content/src/generator.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

const data = name => JSON.parse(readFileSync(new URL(`../../S3_content/${name}`,import.meta.url)));

test('reviewed room/hall ports and stair position remain usable in all eight poses', () => {
  for(const source of REVIEWED_LAYOUTS) for(let turn=0;turn<4;turn++) for(const flip of [false,true]) {
    const layout=poseLayout(source,turn,flip), state=createEmptyDungeonState(1);
    applyReviewedLayout(state,layout,5,5,'reviewed',null,new SeededRng(1));
    for(const [,x,y] of layout.ports) {
      const tile=getTile(state,5+x,5+y);
      assert.equal(tile.type,'floor',`${source.id} port ${turn}/${flip}`);
      assert.equal(Boolean(tile.meta.layoutBlocks),false,`${source.id} port blocked ${turn}/${flip}`);
    }
    if(layout.token) assert.equal(Boolean(getTile(state,5+layout.token[0],5+layout.token[1]).meta.layoutBlocks),false);
    assert.equal(state.decor.reviewed.length,source.placements.length);
  }
});

test('map and tile custom shadow paths follow layout transforms without blocking movement', () => {
  const source={id:'pen-example',width:3,height:3,floor:Array.from({length:9},(_,i)=>[i%3,Math.floor(i/3)]),
    ports:[['west',0,1]],doors:[],shadowPaths:[{id:'map',points:[[1.2,0],[1.2,3]]}],
    placements:[{asset:'example.png',x:0,y:0,w:3,h:3,turn:0,flipX:false,flipY:false,movement:false,
      lightShape:'none',annotations:{},shadowPaths:[{id:'tile',points:[[.2,.1],[.8,.9]]}]}]};
  for(let turn=0;turn<4;turn++) for(const flipX of [false,true]) {
    const state=createEmptyDungeonState(),layout=poseLayout(source,turn,flipX);
    applyReviewedLayout(state,layout,5,5,'r1',null,new SeededRng(1));
    const pose={x:5,y:5,w:3,h:3,turn,flipX};
    assert.deepEqual(state.decor.reviewedLight[0],source.shadowPaths[0].points.map(p=>layoutPoint(pose,p)));
    assert.equal(state.decor.reviewedMovement.length,0);
    const [from,to]=[[.5,1.5],[2.5,1.5]].map(p=>layoutPoint(pose,p).map(Math.floor));
    assert.equal(canCrossReviewedGeometry(state,...from,...to),true);
    assert.equal(reviewedBlocksLine(state,...from,...to),true);
  }
});

test('generation preserves connectivity and encounters across reviewed shapes', () => {
  const ids=new Set(),monsterTable=data('monsters-2.json'),organicAssets=data('data/organic-assets.json');
  let sentries=0,divided=0,stairs=0,totalRooms=0;
  for(const architecturePattern of ['processional','maze','angled','waterLogged','innerWalls','organic']) {
    for(let i=1;i<=40;i++) {
      const state=generateDungeon(i*7919,2,{architecturePattern,monsterTable,organicAssets,cryptHallways:false});
      assert.equal(state.generation.connectivityValid,true,`${architecturePattern}/${i*7919}`);
      totalRooms+=state.rooms.length;
      for(const room of state.rooms) {
        if(room.reviewedTemplate) ids.add(room.reviewedTemplate);
        if(room.reviewedTemplate==='divided-canal-room') {
          divided++;
          assert.ok(room.isolatedBankKeys.length>0);
          assert.equal(state.generation.bossRooms.includes(room.id),false);
          for(const monster of state.entities.filter(e=>e.type==='monster'&&room.isolatedBankKeys.includes(`${e.x},${e.y}`))) {
            assert.equal(hasRangedMonsterAttack(monster),true);assert.equal(monster.canalSentry,true);sentries++;
          }
        }
        if(room.reviewedTemplate==='hall-stair-entrance') {
          stairs++;
          assert.equal(room.id,state.generation.entranceRoomId);
          assert.equal(getTile(state,state.player.x,state.player.y).roomId,room.id);
          assert.ok(state.entities.some(e=>e.hiddenStairSprite&&e.doorKind==='stairs-up'));
        }
      }
      for(const hall of state.halls) if(hall.reviewedTemplate)ids.add(hall.reviewedTemplate);
      const restored=hydrateDungeonState(serializeDungeonState(state));
      assert.deepEqual(restored.decor.reviewedLight,state.decor.reviewedLight);
      assert.deepEqual(restored.decor.reviewed,state.decor.reviewed);
    }
  }
  assert.deepEqual([...ids].sort(),[...REVIEWED_LAYOUTS,...ORGANIC_HALL_LAYOUTS].map(l=>l.id).sort());
  assert.ok(divided>0&&divided/totalRooms<.02,`${divided} divided rooms / ${totalRooms} rooms`);
  assert.ok(stairs>0&&sentries>0);
});
