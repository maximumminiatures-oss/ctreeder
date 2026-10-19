import test from 'node:test';
import assert from 'node:assert/strict';
import { beginPartyRest, acceptPartyRest, advancePartyRest, cancelPartyRest, interruptPartyRest, restSupplyStatus, REST_HOUR_MS, restWatchSchedule, restWatchCharacters, buildRestWatchOrder } from '../../S3_content/src/rest.js';
import { wanderingCheckDenominator } from '../../S3_content/src/wandering.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { collectLightSources } from '../../S3_content/src/light-geometry.js';

function scene() {
  return { characters: [
    { id: 'a', name: 'A', hp: 3, maxHitPoints: 10, x: 2, y: 2, roomId: 'r', gear: [{ name: 'Rations', quantity: 2 }, { name: 'Torch', quantity: 2 }], failedSpellKeys: ['light','cure wounds'], spellPenance: {'cure wounds': {paid:false}} },
    { id: 'b', name: 'B', hp: 2, maxHitPoints: 8, x: 3, y: 2, roomId: 'r', gear: [{ name: 'Rations', quantity: 2 }, { name: 'Torch', quantity: 2 }] }
  ], rooms: [{id:'r'}], tiles: [], entities: [], map:{width:7,height:7}, player:{}, combat: {active:false} };
}

test('rest supply status counts the party and reuses supplies for interrupted rest',()=>{
  const state=scene();assert.equal(restSupplyStatus(state).sufficient,true);
  state.characters[1].gear=[];assert.equal(restSupplyStatus(state).sufficient,false);assert.equal(restSupplyStatus(state).partySize,2);
  for(const character of state.characters){character.restRationPaid=true;character.gear=[];}
  state.rest={phase:'interrupted',suppliesPaid:true,participantIds:['a','b']};
  assert.equal(restSupplyStatus(state).sufficient,true);
});

test('stairs-room wandering encounters are half as common without changing configured odds',()=>{
  const state={player:{roomId:'stairs'},generation:{entranceRoomId:'stairs'},wanderingMonsters:{numerator:1,denominator:6}};
  assert.equal(wanderingCheckDenominator(state),12);assert.equal(state.wanderingMonsters.denominator,6);
  assert.equal(wanderingCheckDenominator(state,{roomId:'other'}),6);
});

test('party must gather and have food and three torches before resting', () => {
  let state = scene(); state.characters[1].roomId = 'elsewhere';
  assert.throws(() => beginPartyRest(state), /same room/);
  state = scene(); state.characters[1].gear = [];state.characters[0].gear[0].quantity=1;
  assert.throws(() => beginPartyRest(state), /ration/);
  state = scene(); state.characters[0].gear[1].quantity = 0;
  assert.throws(() => beginPartyRest(state), /three torches/);
  state = scene(); state.characters[1].hp = 0;
  assert.throws(() => beginPartyRest(state), /dying/);
});

test('party rations may be carried by one member and still feed everyone',()=>{
  const state=scene();state.characters[1].gear=state.characters[1].gear.filter(item=>item.name!=='Rations');
  assert.equal(restSupplyStatus(state).sufficient,true);beginPartyRest(state,{safe:true,now:0});
  assert.equal(state.rest.phase,'sleeping');assert.ok(state.characters.every(character=>character.restRationPaid));
  assert.equal(state.characters.flatMap(character=>character.gear).filter(item=>item.name==='Rations').length,0);
});

test('rest cannot teleport a trapped party member out of a pit',()=>{
  const state=scene();state.characters[1].conditions={sinkhole:'pit',prone:true};
  assert.throws(()=>beginPartyRest(state),/pit/);
  assert.equal(state.characters[0].gear[0].quantity,2);
});

test('halfling invisibility recharges only for characters receiving rest benefits',()=>{
  const state=scene();for(const character of state.characters)character.halflingInvisibilityUsed=true;
  beginPartyRest(state,{safe:true,now:0});state.characters[1].restFailed=true;
  advancePartyRest(state,{now:16000});
  assert.equal(state.characters[0].halflingInvisibilityUsed,false);
  assert.equal(state.characters[1].halflingInvisibilityUsed,true);
});

test('multiplayer consumes supplies only after every member accepts', () => {
  const state = scene();
  beginPartyRest(state, {memberId:'host',requiredMemberIds:['host','guest','spectator'],safe:true,now:0});
  assert.equal(state.rest.phase, 'voting');
  assert.equal(state.characters[0].gear[0].quantity, 2);
  acceptPartyRest(state, 'guest', 0);
  assert.equal(state.rest.phase, 'voting');
  assert.throws(() => acceptPartyRest(state, 'forged', 0), /invitation/);
  acceptPartyRest(state, 'spectator', 0);
  assert.equal(state.rest.phase, 'sleeping');
  assert.equal(state.characters[0].gear[0].quantity, 1);
  assert.equal(state.characters[1].gear[1].quantity, 1);
  assert.throws(() => acceptPartyRest(state, 'host', 0), /invitation/);
});

test('safe rest runs eight seconds, skips encounters, restores HP and ordinary lost spells only', () => {
  const state = scene();
  beginPartyRest(state, {safe:true,now:0});
  let checks = 0;
  assert.equal(REST_HOUR_MS,1000);
  assert.equal(advancePartyRest(state, {now:7000,encounter:()=>{checks++;return true;}}), "You've slept for 7 of 8 hours.");
  assert.equal(state.characters[0].hp, 3);
  assert.equal(advancePartyRest(state, {now:8000}), 'You were able to sleep peacefully');
  assert.equal(checks, 0);
  assert.equal(state.characters[0].hp, 10);
  assert.deepEqual(state.characters[0].failedSpellKeys, ['cure wounds']);
  state.characters[0].spellPenance['cure wounds'].paid = true;
  state.characters[0].gear.push({name:'Torch',quantity:3});
  beginPartyRest(state,{safe:true,now:20000});
  advancePartyRest(state,{now:36000});
  assert.deepEqual(state.characters[0].failedSpellKeys, []);
  assert.deepEqual(state.characters[0].spellPenance, {});
});

test('hourly encounters interrupt without recovery and rest progress survives saves and resumption', () => {
  let state = scene();
  beginPartyRest(state,{now:0});
  const checks=[];
  assert.match(advancePartyRest(state,{now:16000,encounter:hour=>{checks.push(hour);return hour===5;},interruptionCheck:()=>({roll:15,total:15,modifier:0})}), /5 of 8.*paused/);
  assert.deepEqual(checks,[1,2,3,4,5]);
  assert.equal(state.characters[0].hp,3);
  assert.equal(state.characters[0].restHours,5);
  const gear = JSON.stringify(state.characters.map(c=>c.gear));
  state = hydrateDungeonState(serializeDungeonState(state));
  assert.match(beginPartyRest(state,{safe:true,now:20000}),/5 of 8/);
  assert.equal(JSON.stringify(state.characters.map(c=>c.gear)),gear);
  advancePartyRest(state,{now:26000});
  assert.equal(state.rest.phase,'completed');
  assert.equal(state.characters[0].hp,10);
});

test('one failed interruption forfeits only that character\'s recovery, not time or supplies', () => {
  const state=scene();
  beginPartyRest(state,{now:0});
  let rolls=0;
  advancePartyRest(state,{now:10000,encounter:hour=>hour===5,interruptionCheck:()=>({roll:++rolls===1?2:15,total:rolls===1?2:15,modifier:0})});
  assert.equal(state.characters[0].restFailed,true);
  assert.equal(state.characters[0].restHours,5);
  assert.equal(state.characters[1].restFailed,undefined);
  const before=JSON.stringify(state.characters.map(c=>c.gear));
  beginPartyRest(state,{safe:true,now:20000});
  assert.equal(state.rest.hours,5);
  assert.equal(JSON.stringify(state.characters.map(c=>c.gear)),before);
  const message=advancePartyRest(state,{now:26000});
  assert.equal(message,"You've gotten what rest you can.");
  assert.deepEqual(state.rest.recoveredNames,['B']);
  assert.deepEqual(state.rest.failedNames,['A']);
  assert.equal(state.characters[0].hp,3);
  assert.equal(state.characters[1].hp,8);
  assert.equal(state.characters[0].restHours,0);
  assert.equal(state.characters[0].restFailed,false);
  assert.deepEqual(state.characters[0].failedSpellKeys,['light','cure wounds']);
});

test('cancelling a vote consumes no supplies and a changed roster cannot silently consent', () => {
  const state=scene(), before=JSON.stringify(state.characters);
  beginPartyRest(state,{memberId:'host',requiredMemberIds:['host','guest'],now:0});
  cancelPartyRest(state);
  assert.equal(JSON.stringify(state.characters),before);
  beginPartyRest(state,{memberId:'host',requiredMemberIds:['host','guest'],now:0});
  state.characters[1].roomId='other';
  assert.throws(()=>acceptPartyRest(state,'guest',0),/same room/);
});

test('watch shifts repeat every four characters and remain fixed through resuming and saving',()=>{
  const state=scene();
  state.characters=Array.from({length:9},(_,index)=>({...structuredClone(state.characters[0]),id:`c${index}`,name:`C${index}`}));
  const order=state.characters.map(character=>character.id).reverse();
  beginPartyRest(state,{safe:true,watchOrderIds:order,now:0});
  assert.deepEqual(restWatchSchedule(state).map(shift=>shift.characterIds),[['c8','c4','c0'],['c7','c3'],['c6','c2'],['c5','c1']]);
  assert.deepEqual(restWatchCharacters(state,2).map(character=>character.id).sort(),['c0','c4','c8']);
  advancePartyRest(state,{now:4000});cancelPartyRest(state);
  const saved=hydrateDungeonState(serializeDungeonState(state));
  beginPartyRest(saved,{safe:true,watchOrderIds:order.slice().reverse(),now:10000});
  assert.deepEqual(saved.rest.watchOrderIds,order);
  advancePartyRest(saved,{now:14000});
  assert.equal(saved.rest.message,"You've gotten what rest you can.");
  assert.ok(saved.characters.every(character=>character.hp===character.maxHitPoints));
});

test('multiplayer watch order cycles owners from the initiator using the preferred within-owner order',()=>{
  const party=['a1','a2','b1','b2'].map(id=>({id}));
  const options={ownership:{a1:'A',a2:'A',b1:'B',b2:'B'},memberIds:['B','A'],initiatorId:'A'};
  assert.deepEqual(buildRestWatchOrder(party,['a2','a1','b2','b1'],options),['a2','b2','a1','b1']);
  const five=['a1','a2','b1','c1','d1'].map(id=>({id}));
  assert.deepEqual(buildRestWatchOrder(five,[],{ownership:{a1:'A',a2:'A',b1:'B',c1:'C',d1:'D'},memberIds:['B','C','D'],initiatorId:'A'}),['a1','b1','c1','d1','a2']);
  assert.deepEqual(buildRestWatchOrder([...five,{id:'e1'}],[],{ownership:{a1:'A',a2:'A',b1:'B',c1:'C',d1:'D',e1:'E'},memberIds:['B','C','D','E'],initiatorId:'A'}),['a1','b1','c1','d1','a2','e1']);
  assert.throws(()=>buildRestWatchOrder(party,['a1','a1']),/Invalid/);
  assert.throws(()=>buildRestWatchOrder(party,['forged']),/Invalid/);
});

test('awake watchers skip CON interruption checks but sleeping characters can forfeit recovery',()=>{
  const state=scene();beginPartyRest(state,{now:0});
  let checks=0;
  advancePartyRest(state,{now:1000,encounter:()=>true,interruptionCheck:()=>{checks++;return{roll:1,total:1,modifier:0};}});
  assert.equal(checks,1);
  assert.deepEqual(state.rest.interruptedWatchIds,['a']);
  assert.equal(state.characters[0].restFailed,undefined);
  assert.equal(state.characters[1].restFailed,true);
  assert.equal(state.rest.ambushPending,true);
  beginPartyRest(state,{safe:true,now:2000});advancePartyRest(state,{now:9000});
  assert.equal(state.characters[0].hp,10);
  assert.equal(state.characters[1].hp,2);
  assert.deepEqual(state.rest.failedNames,['B']);
});

test('combat between hourly ticks uses the currently awake shift, not the previous one',()=>{
  const state=scene();beginPartyRest(state,{now:0});advancePartyRest(state,{now:2000});
  interruptPartyRest(state,()=>({roll:15,total:15,modifier:0}));
  assert.deepEqual(state.rest.interruptedWatchIds,['b']);
  assert.deepEqual(state.rest.interruptionChecks.map(entry=>entry.characterId),['a']);
});

test('the paid campfire continues illuminating an interrupted rest but not a completed one',()=>{
  const state=scene();beginPartyRest(state,{now:0});
  assert.ok(collectLightSources(state).some(source=>source.x===2&&source.y===2&&source.radius===6));
  interruptPartyRest(state,()=>({roll:15,total:15,modifier:0}));
  assert.ok(collectLightSources(state).some(source=>source.x===2&&source.y===2&&source.radius===6));
  beginPartyRest(state,{memberId:'host',requiredMemberIds:['host','guest'],now:2000});
  assert.equal(state.rest.phase,'voting');
  assert.ok(collectLightSources(state).some(source=>source.x===2&&source.y===2&&source.radius===6));
  state.rest.phase='completed';
  assert.ok(!collectLightSources(state).some(source=>source.x===2&&source.y===2&&source.radius===6));
});
