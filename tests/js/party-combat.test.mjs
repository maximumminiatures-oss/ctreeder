import test from 'node:test';
import assert from 'node:assert/strict';
import { characterMovementBudget, combatStepBlock, attackNarrative, mixTokenColor } from '../../S3_content/src/combat-rules.js';
import { planMarchingSteps } from '../../S3_content/src/marching-order.js';
import { doorBoundaryCenter, doorLightSegments, secretFoundMarkerRect } from '../../S3_content/src/door-geometry.js';

test('combat movement budgets support bonuses and occupied final steps are rejected', () => {
  assert.equal(characterMovementBudget({}), 6);
  assert.equal(characterMovementBudget({ movementSquares: 10 }), 10);
  const actor = { id: 'a', name: 'Erd', x: 1, y: 1 };
  const state = { characters: [actor, { id: 'b', name: 'Ratbilg', x: 2, y: 1 }], entities: [{ type: 'monster', name: 'Rat', x: 3, y: 1 }], combat: { movementRemaining: 2 } };
  assert.equal(combatStepBlock(state, actor, 2, 1), '');
  state.combat.movementRemaining = 1;
  assert.match(combatStepBlock(state, actor, 2, 1), /Erd can't end turn on Ratbilg/);
  assert.match(combatStepBlock(state, actor, 3, 1), /Rat blocks/);
});

test('attack history describes raw roll, ability, other bonuses, AC and outcome', () => {
  assert.equal(attackNarrative({ character: { name: 'Erd' }, monster: { name: 'Apprentice', ac: 11 }, weapon: 'Dagger',
    roll: { roll: 11, modifier: -1, total: 10 }, ability: 'STR', abilityModifier: -1, hit: false }),
  'Erd attacks the apprentice with a dagger.\n10 misses.');
  assert.match(attackNarrative({ character: { name: 'Erd' }, monster: { ac: 10 }, weapon: 'Sword', roll: { roll: 12, modifier: 3, total: 15 }, ability: 'STR', abilityModifier: 2, hit: true, damage: 4 }), /15 hits for 4 damage\./);
  assert.equal(mixTokenColor('#ff0000', '#ffffff', .1), 'rgb(255, 230, 230)');
});

test('secret-door barriers meet the room perimeter and found markers stay upright on its inside', () => {
  for (const side of ['north', 'south', 'east', 'west']) {
    const door = { x: 4, y: 4, wallSide: side, hallDirection: side, secret: true, doorState: 'closed', doorSpriteId: 'door-secret-1', orientation: ['north', 'south'].includes(side) ? 'horizontal' : 'vertical' };
    const center = doorBoundaryCenter(door), rect = secretFoundMarkerRect(door, 30, 20), segments = doorLightSegments(door);
    assert.ok(segments.length);
    assert.ok(segments.some(line => line.every(point => Math.abs(point[['north', 'south'].includes(side) ? 1 : 0] - center[['north', 'south'].includes(side) ? 'y' : 'x']) < .01)));
    assert.equal(rect.width, 30); assert.equal(rect.height, 20);
    if (side === 'north') assert.equal(rect.y, center.y);
    if (side === 'south') assert.equal(rect.y + rect.height, center.y);
    if (side === 'west') assert.equal(rect.x, center.x);
    if (side === 'east') assert.equal(rect.x + rect.width, center.x);
  }
  assert.deepEqual(doorLightSegments({ x: 1, y: 1, doorState: 'open', orientation: 'horizontal' }), []);
});

function formation() {
  return { map: { width: 12, height: 12 }, tiles: Array.from({ length: 144 }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12), roomId: 'room' })),
    characters: [{ id: 'a', x: 6, y: 6, hp: 10 }, { id: 'b', x: 6, y: 7, hp: 10 }], entities: [] };
}

test('followers stay one tile behind in rooms and halls and stop in combat', () => {
  const state = formation(), config = { order: ['a', 'b'], followingIds: ['b'], direction: [0, -1] };
  const rules = { canStep: () => true, isLit: (x, y) => x >= 0 && y >= 0 && x < 12 && y < 12 };
  assert.deepEqual(planMarchingSteps(state, 'a', config, rules), []);
  state.characters[1].y = 8;
  assert.deepEqual(planMarchingSteps(state, 'a', config, rules), [{ characterId: 'b', dx: 0, dy: -1 }]);
  state.tiles[6 * 12 + 6].roomId = null;
  assert.deepEqual(planMarchingSteps(state, 'a', config, rules), [{ characterId: 'b', dx: 0, dy: -1 }]);
  state.characters[1].y = 7;
  assert.deepEqual(planMarchingSteps(state, 'a', config, rules), []);
  state.combat = { active: true };
  state.characters[1].y = 8;
  assert.deepEqual(planMarchingSteps(state, 'a', config, rules), []);
});

test('followers avoid occupied squares and revealed traps but can catch up through darkness', () => {
  const state = formation(), config = { order: ['a', 'b'], followingIds: ['b'], direction: [0, -1] };
  state.characters[1].y = 8;
  state.entities.push({ type: 'trap', x: 6, y: 7, revealed: true });
  const step = planMarchingSteps(state, 'a', config, { canStep: () => true, isLit: () => true })[0];
  assert.ok(!step || step.dx !== 0 || step.dy !== -1);
  state.entities[0].revealed = false;
  assert.deepEqual(planMarchingSteps(state, 'a', config, { canStep: () => true, isLit: () => true })[0], { characterId: 'b', dx: 0, dy: -1 });
  assert.deepEqual(planMarchingSteps(state, 'a', config, { canStep: () => true, isLit: () => false })[0], {characterId:'b',dx:0,dy:-1});
  assert.deepEqual(planMarchingSteps(state, 'a', { ...config, followingIds: [] }, { canStep: () => true, isLit: () => true }), []);
});

test('followers take a temporary step away to escape a U-shaped corner',()=>{
  const state=formation();Object.assign(state.characters[0],{x:6,y:5});Object.assign(state.characters[1],{x:3,y:5});
  const walls=new Set(['2,4','3,4','4,4','4,5','4,6','3,6']);
  const config={order:['a','b'],followingIds:['b'],direction:[1,0],trail:[{x:6,y:5},{x:5,y:5},{x:5,y:5}]};
  const rules={canStep:(x,y,nx,ny)=>!walls.has(`${nx},${ny}`)&&
    (!(nx!==x&&ny!==y)||!walls.has(`${nx},${y}`)&&!walls.has(`${x},${ny}`)),isLit:()=>false};
  const first=planMarchingSteps(state,'a',config,rules)[0];
  assert.ok(first);assert.equal(first.dx,-1);
  for(let i=0;i<20;i++) {
    const step=planMarchingSteps(state,'a',config,rules)[0];if(!step)break;
    state.characters[1].x+=step.dx;state.characters[1].y+=step.dy;
  }
  assert.deepEqual([state.characters[1].x,state.characters[1].y],[5,5]);
});

test('following stops at twelve squares from the selected character',()=>{
  const state=formation();state.map.width=30;state.characters[0].x=18;state.characters[1].x=6;state.characters[1].y=6;
  const rules={canStep:()=>true,isLit:()=>true};
  assert.deepEqual(planMarchingSteps(state,'a',{order:['a','b'],followingIds:['b']},rules),[]);
  state.characters[1].x=7;
  assert.equal(planMarchingSteps(state,'a',{order:['a','b'],followingIds:['b']},rules).length,1);
});

test('earlier-ranked followers pass a moving lower-ranked token without overlapping it', () => {
  const state = formation();
  state.characters[0].y = 8;
  const steps = planMarchingSteps(state, 'b', { order: ['a', 'b'], followingIds: ['a'], direction: [0, -1] }, { canStep: () => true, isLit: () => true });
  assert.equal(steps.length, 1);
  assert.notDeepEqual([state.characters[0].x + steps[0].dx, state.characters[0].y + steps[0].dy], [6, 7]);
});
