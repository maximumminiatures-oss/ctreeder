import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { buildMonsterCompanion } from '../../S3_content/src/companions.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';
import { isMonsterCurrentlyVisible } from '../../S3_content/src/monster-perception.js';
import { canTargetAtRange } from '../../S3_content/src/targeting.js';
import { sameRoute, makeUnderpass } from '../../S3_content/src/underpasses.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';

const source=await readFile(new URL('../../S3_content/src/main.js',import.meta.url),'utf8');
function helper(name,nextName) {
  const start=source.indexOf(`function ${name}(`),end=source.indexOf(`\nfunction ${nextName}(`,start);
  assert.ok(start>=0&&end>start,`${name} helper boundaries exist`);
  return source.slice(start,end);
}
const helpers=[helper('getVisibleMonsterAtTile','getAlertingMonstersFromAttack'),
  helper('canTargetMagicMissile','targetingTurnKey'),helper('createSharedViewerVisibility','attachSharedViewerScope'),
  helper('serializeSharedViewerVisibility','rememberSharedMotionId')].join('\n');
function runtime(state) {
  const context={state,Set,Map,Object,Array,sameRoute,isMonsterCurrentlyVisible,canTargetAtRange,RANGE_LIMITS:{far:12},
    isCharacterAbleToAct:actor=>Number(actor?.hp)>0,hasCharacterMapPosition:actor=>Number.isFinite(actor?.x)&&Number.isFinite(actor?.y),
    isLiveMonster:monster=>monster?.type==='monster'&&!monster.defeated&&!monster.leftPeacefully&&Number(monster.hp)>0,
    getLiveMonsters:()=>context.state.entities.filter(context.isLiveMonster)};
  return runInNewContext(`${helpers}\n({getVisibleMonsterAtTile,canTargetMagicMissile,createSharedViewerVisibility,serializeSharedViewerVisibility})`,context);
}
function scene() {
  const state=createEmptyDungeonState(123);state.map={width:20,height:9};
  state.tiles=Array.from({length:180},(_,i)=>({x:i%20,y:Math.floor(i/20),type:'floor',meta:{}}));
  const caster=buildMonsterCompanion({id:'caster',name:'Mage',hp:10,x:2,y:4,I:2});
  state.characters=[caster];state.activeCharacterId=caster.id;state.player={x:2,y:4,lightRadius:0,torchLit:false};
  state.entities=[{id:'foe',type:'monster',name:'Orc',hp:10,x:5,y:4}];recomputeVisibility(state);return state;
}

test('main lookup and missile helpers accept darkvision targets without removing route, range, wall, or invisibility checks',()=>{
  const state=scene(),api=runtime(state),caster=state.characters[0],foe=state.entities[0];
  assert.equal(state.visibility.visibleNow.size,0);assert.equal(api.getVisibleMonsterAtTile(5,4),foe);
  assert.equal(api.canTargetMagicMissile(caster,foe),true);
  foe.invisibility={rounds:3};assert.equal(api.canTargetMagicMissile(caster,foe),false);delete foe.invisibility;
  state.tiles[4*20+4].type='wall';recomputeVisibility(state);assert.equal(api.canTargetMagicMissile(caster,foe),false);
  state.tiles[4*20+4].type='floor';foe.x=15;recomputeVisibility(state);assert.equal(api.canTargetMagicMissile(caster,foe),false);
});

test('main lookup and missile helpers do not identify a monster on the other level of a crossing',()=>{
  const state=scene(),caster=state.characters[0],foe=state.entities[0];
  state.underpasses=[makeUnderpass('below',Array.from({length:11},(_,i)=>({x:i+2,y:4})),
    {x:7,y:4},[{x:1,y:4},{x:13,y:4}])];
  Object.assign(caster,{x:6,y:4,routeId:'below'});Object.assign(state.player,{x:6,y:4,routeId:'below'});
  Object.assign(foe,{x:7,y:4,routeId:''});recomputeVisibility(state);const api=runtime(state);
  assert.equal(api.getVisibleMonsterAtTile(7,4),null);assert.equal(api.canTargetMagicMissile(caster,foe),false);
  foe.routeId='below';recomputeVisibility(state);assert.equal(api.getVisibleMonsterAtTile(7,4),foe);
  assert.equal(api.canTargetMagicMissile(caster,foe),true);
});

test('main target helpers accept a physically lit sliver even if tile sample visibility omitted the monster center',()=>{
  const state=scene(),caster=state.characters[0],foe=state.entities[0];
  delete caster.companion;caster.bonuses=[];caster.lightRadius=2.05;
  recomputeVisibility(state);const api=runtime(state);
  assert.equal(state.visibility.visibleNow.has('5,4'),false);
  assert.equal(api.getVisibleMonsterAtTile(5,4),foe);assert.equal(api.canTargetMagicMissile(caster,foe),true);
  caster.lightRadius=1.9;recomputeVisibility(state);
  assert.equal(api.getVisibleMonsterAtTile(5,4),null);assert.equal(api.canTargetMagicMissile(caster,foe),false);
});

test('shared viewer helpers preserve local dim memory but never inherit server or another viewer darkvision',()=>{
  const api=runtime({visibility:{}});
  const base={darkvisionNow:new Set(['9,9']),routeDarkvision:{below:new Set(['9,9'])},
    darkvisionExplored:new Set(['9,9']),routeDarkvisionExplored:{below:new Set(['9,9'])}};
  const local=api.createSharedViewerVisibility(base,{routeDarkvisionExplored:{'':['2,2']}});
  assert.equal(local.darkvisionNow.size,0);assert.deepEqual(Object.keys(local.routeDarkvision),[]);
  assert.equal(local.routeDarkvisionExplored.below,undefined);
  assert.equal(local.darkvisionExplored.has('9,9'),false);assert.ok(local.routeDarkvisionExplored[''].has('2,2'));
  local.routeDarkvisionExplored[''].add('3,2');assert.equal(base.routeDarkvisionExplored.below.has('3,2'),false);
  const saved=runtime({visibility:local}).serializeSharedViewerVisibility();
  assert.deepEqual(JSON.parse(JSON.stringify(saved.routeDarkvisionExplored)),{'':['2,2','3,2']});
  assert.equal(saved.darkvisionNow,undefined);assert.equal(saved.routeDarkvision,undefined);
  const restored=api.createSharedViewerVisibility(base,saved);assert.ok(restored.routeDarkvisionExplored[''].has('3,2'));
  const fresh=api.createSharedViewerVisibility(base);assert.deepEqual(Object.keys(fresh.routeDarkvisionExplored),[]);
  const malformed=api.createSharedViewerVisibility(base,{routeDarkvisionExplored:{'':[null,42,{},'bad','2,3']}});
  assert.deepEqual([...malformed.routeDarkvisionExplored['']],['2,3']);
});
