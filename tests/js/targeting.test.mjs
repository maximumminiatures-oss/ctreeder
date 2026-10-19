import test from 'node:test';
import assert from 'node:assert/strict';
import { withinTargetRange, pendingSpellAllowsCommand, planClickMovement } from '../../S3_content/src/targeting.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';

function scene() {
  const character = { id: 'hero', name: 'Hero', x: 3, y: 3, hp: 10, lightRadius: 12, gear: [] };
  const state = { map: { width: 15, height: 15 }, tiles: Array.from({ length: 225 }, (_, i) => ({ x: i % 15, y: Math.floor(i / 15), type: 'floor' })),
    rooms: [], entities: [], characters: [character], player: { x: 3, y: 3 },
    visibility: { visibleNow: new Set(), exploredEver: new Set(), visitedRoomIds: new Set() } };
  recomputeVisibility(state);
  return state;
}

test('range is circular, includes eight melee neighbors, and uses Near6/Far12', () => {
  const origin = { x: 0, y: 0 };
  assert.equal(withinTargetRange(origin, { x: 1, y: 1 }, 1), true);
  assert.equal(withinTargetRange(origin, { x: 2, y: 0 }, 1), false);
  assert.equal(withinTargetRange(origin, { x: 6, y: 0 }, 6), true);
  assert.equal(withinTargetRange(origin, { x: 5, y: 5 }, 6), false);
  assert.equal(withinTargetRange(origin, { x: 12, y: 0 }, 12), true);
  assert.equal(withinTargetRange(origin, { x: 12, y: 1 }, 12), false);
});

test('ready spells permit movement, reselecting the same spell and ending the turn, never another action', () => {
  const character = { pendingSpell: { spell: 'magic missile', phase: 'targeting' } };
  for (const type of ['move', 'move_batch', 'resolve_spell', 'end_turn', 'tick']) assert.equal(pendingSpellAllowsCommand(character, type), true);
  assert.equal(pendingSpellAllowsCommand(character, 'spell', 'Magic Missile'), true);
  for (const type of ['attack', 'equip', 'light', 'spell', 'rest']) assert.equal(pendingSpellAllowsCommand(character, type), false);
  character.pendingSpell.phase = 'critical';
  assert.equal(pendingSpellAllowsCommand(character, 'move'), false);
});

test('click paths fit the remaining movement, avoid monsters and revealed traps, and cannot end on an ally', () => {
  const state = scene(), character = state.characters[0];
  assert.equal(planClickMovement(state, character, 6, 3, 3).length, 3);
  assert.deepEqual(planClickMovement(state, character, 7, 3, 3), []);
  state.entities.push({ type: 'monster', x: 4, y: 3 });
  const path = planClickMovement(state, character, 6, 3, 3);
  let x = 3, y = 3;
  for (const step of path) { x += step.dx; y += step.dy; assert.notDeepEqual([x, y], [4, 3]); }
  assert.deepEqual([x, y], [6, 3]);
  state.characters.push({ id: 'ally', x: 6, y: 3, hp: 5 });
  assert.deepEqual(planClickMovement(state, character, 6, 3, 6), []);
  state.visibility.visibleNow.clear();
  assert.deepEqual(planClickMovement(state, character, 5, 3, 6), []);
});
