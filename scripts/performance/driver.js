import { isSafeDungeonArrival as auditSafeArrival } from './generator.js';
const audit = { samples: {}, phase: 'setup', inputs: [], counters: {} };
function auditWrap(name, original) {
  return function(...args) {
    const start = performance.now();
    try { return original(...args); }
    finally { (audit.samples[name] ||= []).push(performance.now() - start); }
  };
}
applyLocalMovement = auditWrap('movement', applyLocalMovement);
render = auditWrap('render', render);
updatePanels = auditWrap('panels', updatePanels);
updateCharactersUi = auditWrap('character_cards', updateCharactersUi);
renderCharacterDetail = auditWrap('sheet_detail', renderCharacterDetail);
openCharacterSheet = auditWrap('open_sheet', openCharacterSheet);
recomputeVisibility = auditWrap('visibility', recomputeVisibility);
processMonsterVisibilityChange = auditWrap('monster_tracking', processMonsterVisibilityChange);
advanceMarchingOrder = auditWrap('followers', advanceMarchingOrder);
resolveCharacterAttackAgainstMonster = auditWrap('player_attack', resolveCharacterAttackAgainstMonster);
const auditMonsterTurn=runMonsterTurn;
runMonsterTurn=async function(...args){const start=performance.now();try{return await auditMonsterTurn(...args);}finally{(audit.samples.monster_turn_elapsed ||= []).push(performance.now()-start);}};
document.addEventListener('keydown', e => {
  if (!/^(Arrow|[1-4])/.test(e.key)) return;
  const start=performance.now(), phase=audit.phase;
  requestAnimationFrame(() => audit.inputs.push({phase,key:e.key,ms:performance.now()-start}));
},true);
let auditBase;
window.__audit = {
  ready:()=>Boolean(state?.rooms?.length),
  snapshot:()=>({x:state.player.x,y:state.player.y,characters:state.characters.length,monsters:state.entities.filter(e=>e.type==='monster'&&!e.defeated).length,tiles:state.tiles.length,rooms:state.rooms.length,lights:state.characters.filter(c=>c.lightRadius>0).length,combat:state.combat.active,turn:getCurrentCombatEntry(),status:ui.statusText.textContent}),
  capture:()=>{auditBase=structuredClone(state);},
  phase:name=>{audit.phase=name;audit.samples={};audit.inputs=[];},
  samples:()=>({samples:audit.samples,inputs:audit.inputs}),
  prepare:({lights=1,follow=true,crowded=false}={})=>{
    state=structuredClone(auditBase);
    const room=state.rooms.find(r=>r.id===state.generation.entranceRoomId);
    let cells=state.tiles.filter(t=>t.roomId===room.id&&auditSafeArrival(state,t));
    const exits=t=>[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>canMoveBetweenTiles(state,t.x,t.y,t.x+dx,t.y+dy).ok).length;
    cells.sort((a,b)=>exits(b)-exits(a));
    const anchor=cells[0];cells=[anchor,...cells.filter(t=>Math.max(Math.abs(t.x-anchor.x),Math.abs(t.y-anchor.y))>1).slice(0,3)];
    if(cells.length<4)throw Error('Not enough floor cells for party');
    state.characters=['Fighter','Thief','Wizard','Priest'].map((className,i)=>({
      id:'audit-'+i,name:'Audit '+className,className,ancestry:'Human',level:3,hp:40,maxHitPoints:40,
      stats:{STR:14,DEX:12,CON:12,INT:14,WIS:14,CHA:12},...cells[i],routeId:'',
      gold:0,silver:0,copper:0,gear:[{name:'Longsword',type:'weapon',equipped:true,damage:'1d8',slots:1},
      {name:'Torch',quantity:1,lit:i<lights,equipped:i<lights,slots:1}],equipmentInitialized:true,
      languages:'Common',spellsKnown:className==='Wizard'?'Magic Missile, Light, Sleep':className==='Priest'?'Cure Wounds, Light':'',
      deity:className==='Priest'?'Saint Terragnis':undefined,
    }));
    for(const e of state.entities)if(e.type==='monster')Object.assign(e,{attitude:'friendly',hostile:false,attitudeChecked:true});
    if(crowded){
      const extra=state.tiles.filter(t=>t.type==='floor'&&Math.hypot(t.x-cells[0].x,t.y-cells[0].y)>10);
      for(let i=state.entities.filter(e=>e.type==='monster').length;i<40;i++){
        const t=extra[i%extra.length];state.entities.push({id:'audit-neutral-'+i,type:'monster',name:'Goblin',hp:10,maxHp:10,ac:12,attack:'1 dagger +1 (1d4)',x:t.x,y:t.y,roomId:t.roomId,routeId:'',attitude:'friendly',hostile:false,attitudeChecked:true,tags:['humanoid'],I:0});
      }
    }
    state.activeCharacterId='audit-0';state.combat={active:false};state.encounterPrompt=null;
    state.wanderingMonsters.numerator=0;state.rollHistory=[];diceHistory=[];state.marchingGroups={};
    normalizeCharacterState(state);ensureCombatState();syncAllCharacterEquipmentDerivedStats();
    localStorage.setItem(roomOrderKey(),JSON.stringify(state.characters.map(c=>c.id)));
    localStorage.setItem(roomOrderKey()+':follow',JSON.stringify(follow?state.characters.slice(1).map(c=>c.id):[]));
    syncPlayerToActiveCharacter();recomputeVisibility(state);updatePanels();render();
    ui.characterSheetModal.hidden=true;ui.mapHost.focus();
    return window.__audit.snapshot();
  },
  nextMove:previous=>{
    const dirs=[[1,0,'ArrowRight'],[0,1,'ArrowDown'],[-1,0,'ArrowLeft'],[0,-1,'ArrowUp']];
    const reverse={ArrowRight:'ArrowLeft',ArrowLeft:'ArrowRight',ArrowUp:'ArrowDown',ArrowDown:'ArrowUp'};
    const options=dirs.filter(([dx,dy])=>{
      const x=state.player.x+dx,y=state.player.y+dy,t=getTile(state,x,y);
      return t?.type==='floor'&&canMoveBetweenTiles(state,state.player.x,state.player.y,x,y).ok&&
        !state.entities.some(e=>e.x===x&&e.y===y&&(e.type==='trap'||e.type==='monster'))&&
        movementStepCost(state,x,y,getActiveCharacter(state))===1;
    });
    return (options.find(d=>d[2]===previous)||options.find(d=>d[2]!==reverse[previous])||options[0])?.[2];
  },
  combat:()=>{
    const actor=getActiveCharacter(state);
    const t=state.tiles.find(t=>t.type==='floor'&&Math.max(Math.abs(t.x-actor.x),Math.abs(t.y-actor.y))===1&&
      !state.characters.some(c=>c.x===t.x&&c.y===t.y)&&canMoveBetweenTiles(state,actor.x,actor.y,t.x,t.y).ok);
    if(!t)throw Error('No adjacent encounter tile');
    const foe={id:'audit-foe',type:'monster',name:'Orc',hp:100,maxHp:100,ac:10,attack:'1 greataxe +1 (1d8)',
      x:t.x,y:t.y,roomId:t.roomId,routeId:'',visible:true,hostile:true,attitude:'combat',attitudeChecked:true,level:1,S:1,D:0,C:1,I:0,W:0,Ch:0,tags:['humanoid']};
    state.entities.push(foe);beginCombat('Audit encounter',{extraMonsterIds:[foe.id]});
    // Fix initiative order for repeatable measurement, preserving normal turn actions.
    state.combat.turnOrder=[{type:'character',id:actor.id},{type:'monster',id:foe.id},...state.characters.slice(1).map(c=>({type:'character',id:c.id}))];
    state.combat.playerOrderIds=state.characters.map(c=>c.id);state.combat.sideFirst='characters';state.combat.monsterIds=[foe.id];
    state.combat.turnIndex=0;state.combat.movementRemaining=6;state.combat.actionUsed=false;state.combat.turnStartPending=false;
    updatePanels();render();return window.__audit.snapshot();
  },
  attack:()=>attackClickedMonster(state.entities.find(e=>e.id==='audit-foe')),
  endTurn:()=>endCurrentTurn(),
  combatBusy:()=>Boolean(state.combat.autoRunning),
  closeRolls:()=>{for(const id of ['roll-modal','attack-modal','check-modal']){const e=document.getElementById(id);if(e)e.hidden=true;}},
  coinProbe:()=>{
    const actor=getActiveCharacter(state),backup=structuredClone(actor);
    actor.gold=0;actor.silver=0;actor.copper=0;actor.raw.gold=0;actor.raw.silver=0;actor.raw.copper=0;
    const e={id:'audit-coins',type:'treasure',name:'700 cp',kind:'coins',x:actor.x,y:actor.y,roomId:actor.roomId,visible:true,coinBreakdown:{gold:0,silver:0,copper:700},value:7,slots:6};
    state.entities.push(e);const result=collectLoot(state,e.id,actor.id);
    const afterPickup={gold:actor.gold,silver:actor.silver,copper:actor.copper,slots:getCharacterCoinBagSlots(actor),result};
    normalizeCharacterState(state);const now=state.characters.find(c=>c.id===actor.id);
    const afterNormalize={gold:now.gold,silver:now.silver,copper:now.copper,slots:getCharacterCoinBagSlots(now)};
    setCharacterMoneyFromCopper(now,700);
    const valueRewrite={gold:now.gold,silver:now.silver,copper:now.copper,slots:getCharacterCoinBagSlots(now)};
    state.characters[state.characters.findIndex(c=>c.id===actor.id)]=backup;
    state.entities=state.entities.filter(e=>e.id!=='audit-coins');return {afterPickup,afterNormalize,valueRewrite};
  }
};

let longPlan, longPosition=0, longTotalMoves=0, longPresses=0, longRooms=new Set();
const longDirs=[[1,0,'ArrowRight'],[0,1,'ArrowDown'],[-1,0,'ArrowLeft'],[0,-1,'ArrowUp']];
const longReverse={ArrowRight:'ArrowLeft',ArrowLeft:'ArrowRight',ArrowDown:'ArrowUp',ArrowUp:'ArrowDown'};
const longKey=(x,y)=>`${x},${y}`;
function longGraph(){
  const start={x:state.player.x,y:state.player.y},queue=[start],edges=new Map(),seen=new Set([longKey(start.x,start.y)]);
  for(let n=0;n<queue.length;n++){
    const p=queue[n],out=[];
    for(const [dx,dy,key] of longDirs){
      const x=p.x+dx,y=p.y+dy,k=longKey(x,y),tile=getTile(state,x,y);
      if(tile?.type!=='floor'||!canMoveBetweenTiles(state,p.x,p.y,x,y,{ignoreClosedDoors:true}).ok)continue;
      const door=getDoorBetween(state,p.x,p.y,x,y)||getDoorAt(state,x,y);
      if(door&&(isMagicallyLocked(door)||door.doorState==='locked'||door.secret&&!door.secretFound&&!door.revealed))continue;
      if(state.entities.some(e=>e.x===x&&e.y===y&&['trap','monster'].includes(e.type)))continue;
      out.push({key,to:k});if(!seen.has(k)){seen.add(k);queue.push({x,y});}
    }
    edges.set(longKey(p.x,p.y),out);
  }
  return {start:longKey(start.x,start.y),edges,reachable:seen.size};
}
function longWalk(graph){
  const walk=[],seen=new Set();
  function dfs(at){
    seen.add(at);
    for(const edge of graph.edges.get(at)||[]){
      if(seen.has(edge.to))continue;
      walk.push(edge.key);dfs(edge.to);walk.push(longReverse[edge.key]);
    }
  }
  dfs(graph.start);return walk;
}
function longDispatch(key){
  ui.mapHost.dispatchEvent(new KeyboardEvent('keydown',{key,code:/^[1-4]$/.test(key)?'Digit'+key:key,bubbles:true,cancelable:true}));
}
function longFrame(){return new Promise(resolve=>requestAnimationFrame(resolve));}
function longStats(values){
  const s=[...values].sort((a,b)=>a-b),n=s.length;
  return n?{n,median:s.length%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2,p95:s[Math.ceil(.95*n)-1],mean:s.reduce((a,b)=>a+b,0)/n,max:s[n-1]}:{};
}
window.__long={
  prepare:({lights=1,mode='explore',follow=true}={})=>{
    state=generateDungeon(61019,1,{reviewedLayouts:false,pits:false,underpasses:false,monsterTable,trapTable,contentCatalog:shadowdarkContent,rulesData});
    for(const e of state.entities)if(e.subtype==='door'&&!e.secret&&!e.isSecret&&e.doorState==='locked')e.doorState='closed';
    setupCanvasLayers(state);__audit.capture();__audit.prepare({lights,follow});
    const graph=longGraph();longPlan=mode==='loop'?[graph.edges.get(graph.start)[0].key,longReverse[graph.edges.get(graph.start)[0].key]]:longWalk(graph);
    if(!longPlan.length)throw Error('No valid movement path');
    longPosition=0;longTotalMoves=0;longPresses=0;longRooms=new Set();
    return {pathLength:longPlan.length,reachable:graph.reachable,...__long.snapshot()};
  },
  snapshot:()=>{
    const v=state.visibility,polys=v.exploredLightPolygons||[];
    return {moves:longTotalMoves,presses:longPresses,rooms:[...longRooms].sort(),active:state.activeCharacterId,
      polygons:polys.length,points:polys.reduce((n,p)=>n+p.length,0),polygonKeys:v.exploredLightPolygonKeys?.size,
      exploredTiles:v.exploredEver?.size,visibleTiles:v.visibleNow?.size,rollHistory:state.rollHistory?.length,
      activity:state.activity?.length,entities:state.entities.length,domNodes:document.getElementsByTagName('*').length,
      positions:state.characters.map(c=>[c.id,c.x,c.y]),hp:state.characters.map(c=>c.hp),combat:state.combat.active,
      lightCount:state.characters.filter(c=>c.lightRadius>0).length,torchElapsed:state.timers.torchElapsedMs,
      rawHeap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null};
  },
  serializedBytes:()=>new TextEncoder().encode(JSON.stringify(serializeDungeonState(state))).length,
  runChunk:async(n)=>{
    __audit.phase('long-movement');const response=[],handler=[],start=performance.now();let opened=0;
    for(let i=0;i<n;i++){
      if(state.combat.active||state.encounterPrompt)throw Error('Unexpected encounter interrupted controlled walk');
      const key=longPlan[longPosition%longPlan.length],before={x:state.player.x,y:state.player.y};let moved=false;
      for(let attempt=0;attempt<3;attempt++){
        const t=performance.now();longDispatch(key);handler.push(performance.now()-t);longPresses++;
        await longFrame();response.push(performance.now()-t);
        if(before.x!==state.player.x||before.y!==state.player.y){moved=true;break;}
        if(ui.statusText.textContent.includes('Door opened'))opened++;
      }
      if(!moved)throw Error('Move failed at '+longTotalMoves+': '+ui.statusText.textContent);
      longPosition++;longTotalMoves++;
      const room=getTile(state,state.player.x,state.player.y)?.roomId;if(room)longRooms.add(room);
    }
    const samples=__audit.samples().samples;
    return {snapshot:__long.snapshot(),response:longStats(response),handler:longStats(handler),duration:performance.now()-start,
      timings:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,longStats(v)])),opened};
  },
  sheets:async()=>{
    __audit.phase('long-sheets');const values=[];
    for(const key of ['1','2','3','4','1']){
      const start=performance.now();longDispatch(key);await longFrame();values.push(performance.now()-start);
      if(ui.characterSheetModal.hidden)throw Error('Sheet did not open');
      longDispatch('Escape');await longFrame();
    }
    __audit.phase('setup');return longStats(values);
  },
  replaceHistoryForDiagnostic:(polygons)=>{
    const v=state.visibility;
    v.exploredLightPolygons=polygons;v.exploredLightPolygonsBeforeNow=polygons.slice();v.exploredLightPolygonKeys=new Set(polygons.map(p=>`${p.length}:`+p.filter((_,i)=>i%6===0).map(q=>`${Math.round(q[0])},${Math.round(q[1])}`).join('|')));
  },
  captureWorld:()=>serializeDungeonState(state),
  captureSession:()=>({world:serializeDungeonState(state),plan:longPlan,index:longPosition,moves:longTotalMoves,presses:longPresses,rooms:[...longRooms]}),
  restoreSession:session=>{
    state=hydrateDungeonState(session.world);normalizeCharacterState(state);ensureCombatState();
    longPlan=session.plan;longPosition=session.index;longTotalMoves=session.moves;longPresses=session.presses;longRooms=new Set(session.rooms);
    diceHistory=state.rollHistory||[];syncPlayerToActiveCharacter();setupCanvasLayers(state);updatePanels();render();ui.mapHost.focus();
    return __long.snapshot();
  },
};

window.__long.verifyState=()=>({
 positions:state.characters.map(c=>[c.id,c.x,c.y,c.hp,c.gear,c.gold,c.silver,c.copper]),
 visible:[...state.visibility.visibleNow].sort(),explored:[...state.visibility.exploredEver].sort(),
 polygons:state.visibility.exploredLightPolygons,
 before:state.visibility.exploredLightPolygonsBeforeNow,
 doors:state.entities.filter(e=>e.subtype==='door').map(e=>[e.id,e.doorState,e.secretFound,e.revealed]),
 rooms:state.rooms.map(r=>[r.id,r.discovered,r.explored]),
});
window.__long.fogImage=()=>layers.fogCtx.canvas.toDataURL();
window.__long.enableFollowers=()=>{
 localStorage.setItem(roomOrderKey(),JSON.stringify(state.characters.map(c=>c.id)));
 localStorage.setItem(roomOrderKey()+':follow',JSON.stringify(state.characters.slice(1).map(c=>c.id)));
};
window.__long.nextKey=()=>longPlan[longPosition%longPlan.length];
window.__long.recordExternalMove=()=>{longPosition++;longTotalMoves++;};
window.__long.resetFixtureClock=()=>{state.timers.lastTickAt=Date.now();};
