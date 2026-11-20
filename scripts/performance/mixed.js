// Test-only instrumentation injected by Playwright; never shipped to the site.
window.__mixed={
 ready:()=>Boolean(state)&&!artworkLoading,
 setup:()=>{
  state=generateDungeon(13,1,{architecturePattern:'organic',waterCategory:'medium',partySize:16,monsterTable,bossMonsterTable,trapTable,contentCatalog:shadowdarkContent,rulesData,organicAssets:organicAssetNames,innerWallAssets:innerWallAssetNames});
  setupCanvasLayers(state);__audit.capture();__audit.prepare({lights:4,follow:true});
  for(const c of state.characters){c.hp=5000;c.maxHitPoints=5000;c.raw.hp=5000;c.raw.maxHitPoints=5000;c.luckTokens=0;}
  const wizard=state.characters.find(c=>c.className==='Wizard');wizard.spellsKnown='Magic Missile, Mage Armor, Light, Web';wizard.raw.spellsKnown=wizard.spellsKnown;
  state.characters[0].copper=700;state.characters[0].raw.copper=700;
  normalizeCharacterState(state);syncAllCharacterEquipmentDerivedStats();syncPlayerToActiveCharacter();recomputeVisibility(state);updatePanels();render();
  const graph=longGraph();longPlan=longWalk(graph);longPosition=0;longTotalMoves=0;longPresses=0;longRooms=new Set();
  if(!longPlan.length)throw Error('No walk plan');
  return {pathLength:longPlan.length,reachable:graph.reachable,waterTiles:state.generation.waterPlan.actualTiles,organicTiles:state.tiles.filter(t=>t.meta?.organic).length,...__long.snapshot()};
 },
 physical:()=>({actors:state.characters.map(c=>({id:c.id,hp:c.hp,x:c.x,y:c.y,coins:[c.gold||0,c.silver||0,c.copper||0],gear:c.gear.map(i=>({name:i.name,units:i.totalUnits??i.quantity??1,equipped:!!i.equipped,lit:!!i.lit,value:i.value??null}))})),doors:state.entities.filter(e=>e.subtype==='door').map(e=>[e.id,e.doorState,!!e.secretFound]),level:state.level}),
 metrics:()=>{
  const m=state.visibility.explorationMemory;
  return {snapshot:__long.snapshot(),worldBytes:__long.serializedBytes(),fogBytes:new Blob([JSON.stringify(m)]).size,partialTiles:Object.values(m.routes).reduce((n,r)=>n+Object.keys(r.partial).length,0),completeTiles:Object.values(m.routes).reduce((n,r)=>n+Object.keys(r.complete).length,0)};
 },
 saveReload:()=>{const start=performance.now(),before=JSON.stringify(__mixed.physical()),saved=__long.captureSession();__long.restoreSession(saved);if(JSON.stringify(__mixed.physical())!==before)throw Error('Save/load changed physical state');return {ms:performance.now()-start,bytes:JSON.stringify(saved.world).length};},
 startCombat:async()=>{
  while(localWaterMotions.size)await longFrame();
  __mixed.randomBefore=Math.random;Math.random=()=>.61;
  __mixed.background=state.entities.filter(e=>e.type==='monster');
  for(const m of __mixed.background)m.leftPeacefully=true;
  __mixed.positions=state.characters.map(c=>({id:c.id,x:c.x,y:c.y,roomId:c.roomId,routeId:c.routeId}));
  const offsets=[[0,-1],[1,0],[0,1],[-1,0]],actor=state.characters[0];
  const center=state.tiles.find(t=>t.type==='floor' && offsets.every(([dx,dy])=>{
   const x=t.x+dx,y=t.y+dy,n=getTile(state,x,y);
   return n?.type==='floor' && !state.entities.some(e=>e.x===x&&e.y===y&&['monster','trap'].includes(e.type)) &&
    canMoveBetweenTiles(state,x,y,t.x,t.y).ok && canTargetAtRange(state,{...actor,x,y,routeId:''},{x:t.x,y:t.y,routeId:''},1,{requireLight:false});
  }) && !state.entities.some(e=>e.x===t.x&&e.y===t.y&&['monster','trap'].includes(e.type)));
  if(!center)throw Error('No legal controlled encounter staging area');
  state.characters.forEach((c,i)=>{const [dx,dy]=offsets[i],t=getTile(state,center.x+dx,center.y+dy);Object.assign(c,{x:t.x,y:t.y,roomId:t.roomId,routeId:''});});
  setActiveCharacter(state,'audit-0');syncPlayerToActiveCharacter();recomputeVisibility(state);
  const foe={id:'audit-foe',type:'monster',name:'Orc',hp:100000,maxHp:100000,ac:10,attack:'1 greataxe +1 (1d8)',
   x:center.x,y:center.y,roomId:center.roomId,routeId:'',visible:true,hostile:true,attitude:'combat',attitudeChecked:true,level:1,S:1,D:0,C:1,I:0,W:0,Ch:0,tags:['humanoid']};
  state.entities.push(foe);beginCombat('Controlled replay encounter',{extraMonsterIds:[foe.id]});
  state.combat.turnOrder=[{type:'character',id:'audit-0'},{type:'monster',id:foe.id},...state.characters.slice(1).map(c=>({type:'character',id:c.id}))];
  Object.assign(state.combat,{playerOrderIds:state.characters.map(c=>c.id),sideFirst:'characters',monsterIds:[foe.id],turnIndex:0,movementRemaining:6,actionUsed:false,turnStartPending:false});
  __mixed.combatStats={turns:0,attacks:0,spells:0,turnResponse:[],startHp:foe.hp};updatePanels();render();
 },
 turn:async()=>{
  while(state.combat.autoRunning)await longFrame();
  const entry=getCurrentCombatEntry();if(entry?.type!=='character')throw Error('Expected character turn');
  const actor=getActiveCharacter(state),foe=state.entities.find(e=>e.id==='audit-foe'),started=performance.now();
  if(actor.className==='Wizard'){
   const missile=canTargetMagicMissile(actor,foe),name=missile?'Magic Missile':'Mage Armor';
   performSpellCast(actor,findSpellRecord(name));
   if(missile){
    if(getCurrentCharacter(actor).pendingSpell?.spell!=='magic missile')throw Error('Magic Missile not ready: '+ui.statusText.textContent);
    let guard=0;while(getCurrentCharacter(actor).pendingSpell&&guard++<10)resolveMagicMissile(getCurrentCharacter(actor),{targetId:foe.id});
    if(getCurrentCharacter(actor).pendingSpell)throw Error('Missile target failed: '+ui.statusText.textContent);
   }
   __mixed.combatStats[missile?'missileCasts':'armorCasts']=(__mixed.combatStats[missile?'missileCasts':'armorCasts']||0)+1;
   __mixed.combatStats.spells++;
  }else{
   const attack=getFirstCombatAttack(actor);
   if(attack&&canTargetAtRange(state,actor,foe,1,{directAttack:true})){resolveCharacterAttackAgainstMonster(actor,attack,foe);__mixed.combatStats.attacks++;}
  }
  __audit.closeRolls();endCurrentTurn();
  while(state.combat.autoRunning)await longFrame();
  await longFrame();__mixed.combatStats.turns++;__mixed.combatStats.turnResponse.push(performance.now()-started);
  if(!state.combat.active)throw Error('Encounter ended unexpectedly');
  return {turns:__mixed.combatStats.turns,foeHp:foe.hp};
 },
 finishCombat:()=>{
  const foe=state.entities.find(e=>e.id==='audit-foe'),stats=__mixed.combatStats;
  stats.damage=stats.startHp-foe.hp;stats.turnTiming=longStats(stats.turnResponse);delete stats.turnResponse;
  if(stats.damage<=0||!stats.spells)throw Error('Combat did not execute attacks and spells '+JSON.stringify({stats,status:ui.statusText.textContent,foe,actors:state.characters.map(c=>({id:c.id,x:c.x,y:c.y,attacks:getRenderableAttacks(c),light:c.lightRadius}))}));
  // Remove only the artificially sustained encounter fixture before resuming exploration.
  state.entities=state.entities.filter(e=>e.id!==foe.id);
  for(const m of __mixed.background){delete m.leftPeacefully;Object.assign(m,{attitude:'friendly',hostile:false,attitudeChecked:true});}
  endCombat('Controlled replay encounter ends.');state.encounterPrompt=null;state.pendingAmbush=null;
  for(const position of __mixed.positions)Object.assign(state.characters.find(c=>c.id===position.id),position);
  Math.random=__mixed.randomBefore;setActiveCharacter(state,'audit-0');syncPlayerToActiveCharacter();recomputeVisibility(state);updatePanels();render();ui.mapHost.focus();return stats;
 }
};
