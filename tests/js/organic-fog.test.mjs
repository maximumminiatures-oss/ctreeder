import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { setOrganicTileMeta } from '../../S3_content/src/organic-tiles.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';
import { renderDungeon } from '../../S3_content/src/render.js';

function fogContext() {
  const operations=[],stack=[];
  const context={operations,globalCompositeOperation:'source-over',globalAlpha:1,fillStyle:''};
  context.save=()=>stack.push({globalCompositeOperation:context.globalCompositeOperation,globalAlpha:context.globalAlpha,fillStyle:context.fillStyle});
  context.restore=()=>Object.assign(context,stack.pop());
  for(const name of ['fillRect','fill']) context[name]=(...args)=>operations.push({name,args,op:context.globalCompositeOperation,style:context.fillStyle});
  return new Proxy(context,{get:(target,name)=>name in target?target[name]:()=>{}});
}

function scene(asset,radius) {
  const state=createEmptyDungeonState(1);
  state.map={...state.map,width:14,height:10};
  state.tiles=Array.from({length:140},(_,i)=>({x:i%14,y:Math.floor(i/14),type:'floor',roomId:'room',hallId:null,meta:{}}));
  state.rooms=[{id:'room',x:0,y:0,width:14,height:10,organic:true,cornerSize:0}];
  state.player={...state.player,x:2,y:4,roomId:'room',torchLit:true,lightRadius:radius};
  setOrganicTileMeta(state.tiles[4*14+8],asset);
  return state;
}

test('organic cells beyond torch reach are not revealed by an adjacent lit tile',()=>{
  const state=scene('org-blocks-NWxNExSExSWxNxExSxWx.png',5);
  recomputeVisibility(state);
  assert.equal(state.visibility.visibleNow.has('7,4'),true);
  assert.equal(state.visibility.visibleNow.has('8,4'),false);
  assert.equal(state.visibility.exploredEver.has('8,4'),false);
});

test('organic current and explored fog never clear a whole blocking cell or add a legacy pillar shadow',()=>{
  for(const asset of ['org-blocks-NWxNExSExSWxNxExSxWx.png','org-blocks-NWxNExSEoSWoNxExSxWx.png']) {
    const state=scene(asset,5.75);
    recomputeVisibility(state);
    assert.equal(state.visibility.visibleNow.has('8,4'),true);
    for(const moved of [false,true]) {
      if(moved) {
        state.player.x=0;state.player.y=9;state.player.lightRadius=1;
        recomputeVisibility(state);
      }
      const context=fogContext();
      renderDungeon(state,{fogCtx:context},{motionOnly:true});
      assert.equal(context.operations.some(({name,op,args})=>name==='fillRect'&&op==='destination-out'&&
        args.join(',')===[8*54,4*54,54,54].join(',')),false,`${asset}/${moved}`);
      if(!moved) assert.equal(context.operations.some(({name,op,style})=>name==='fill'&&op==='source-over'&&style==='rgba(0, 0, 0, 0.45)'),false);
    }
  }
});
