import test from 'node:test';
import assert from 'node:assert/strict';
import { withinTargetRange, canAimAtSquare, canTargetAtRange, pendingSpellAllowsCommand, planClickMovement } from '../../S3_content/src/targeting.js';
import { recomputeVisibility, isTilePerceived, isTileVisible } from '../../S3_content/src/visibility.js';

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

test('square aiming needs physical line of sight and range but never illumination or knowledge of an occupant', () => {
  const state = scene(), character = state.characters[0];
  state.visibility.visibleNow.clear(); state.visibility.exploredEver.clear();
  state.entities.push({ id: 'hidden', type: 'monster', x: 6, y: 3, hp: 20, stealthed: true });
  assert.equal(canAimAtSquare(state, character, { x: 6, y: 3 }, 6), true);
  assert.equal(canAimAtSquare(state, character, { x: 7, y: 3 }, 6), true);
  assert.equal(canAimAtSquare(state, character, { x: 4, y: 4 }, 1), true);
  assert.equal(canAimAtSquare(state, character, { x: 5, y: 3 }, 1), false);
  assert.equal(canAimAtSquare(state, character, { x: 6, y: 3, routeId: 'other' }, 6), false);
  state.tiles[3 * 15 + 5].type = 'wall';
  assert.equal(canAimAtSquare(state, character, { x: 6, y: 3 }, 6), false);
});

function darkvisionScene() {
  const state = scene(), human = state.characters[0]; human.lightRadius = 0; human.routeId = '';
  const companion = { id: 'companion', name: 'Orc', x: 3, y: 4, routeId: '', hp: 10,
    lightRadius: 0, gear: [], companion: { kind: 'friendly' } };
  const monster = { id: 'monster', type: 'monster', name: 'Rat', x: 6, y: 3, routeId: '', hp: 10 };
  const treasure = { id: 'treasure', type: 'treasure', name: 'Coins', x: 6, y: 4, routeId: '', visible: true };
  state.characters.push(companion); state.entities.push(monster, treasure);
  state.player.torchLit = false; recomputeVisibility(state);
  return { state, human, companion, monster, treasure };
}

test('shared companion darkvision permits direct monster and feature targeting without physical illumination', () => {
  const { state, human, monster, treasure } = darkvisionScene();
  assert.equal(isTileVisible(state, monster.x, monster.y, monster), false);
  assert.equal(isTilePerceived(state, monster.x, monster.y, monster), true);
  assert.equal(canTargetAtRange(state, human, monster, 6, { directAttack: true }), true);
  assert.equal(canTargetAtRange(state, human, treasure, 6), true);
  assert.equal(human.lightRadius, 0, 'target selection does not grant illumination or change attack penalties');
  monster.stealthState = { attempted: true, revealed: false };
  assert.equal(canTargetAtRange(state, human, monster, 6, { directAttack: true }), false);
});

test('perceived targets still require the acting character range and own physical line of sight', () => {
  const { state, human, companion, monster } = darkvisionScene();
  assert.equal(canTargetAtRange(state, human, monster, 1, { directAttack: true }), false);
  Object.assign(companion, { x: 6, y: 4 }); state.tiles[3 * 15 + 4].type = 'wall';
  recomputeVisibility(state);
  assert.equal(isTilePerceived(state, monster.x, monster.y, monster), true);
  assert.equal(canTargetAtRange(state, human, monster, 6, { directAttack: true }), false);
});

test('direct targeting respects global viewer ownership rather than forcing the human attacker to possess darkvision', () => {
  const { state, human, companion, monster, treasure } = darkvisionScene();
  state.viewerCharacterIds = new Set([human.id]); recomputeVisibility(state);
  assert.equal(canTargetAtRange(state, human, monster, 6, { directAttack: true }), false);
  assert.equal(canTargetAtRange(state, human, treasure, 6), false);
  state.viewerCharacterIds.add(companion.id); recomputeVisibility(state);
  assert.equal(canTargetAtRange(state, human, monster, 6, { directAttack: true }), true);
  assert.equal(canTargetAtRange(state, human, treasure, 6), true);
});

test('only darkvision companions can click-path across perceived but unlit squares', () => {
  const { state, human, companion } = darkvisionScene(); state.entities = [];
  recomputeVisibility(state);
  assert.equal(planClickMovement(state, companion, 6, 4, 3).length, 3);
  assert.deepEqual(planClickMovement(state, human, 6, 3, 3), []);
  state.visibility.visibleNow.add('6,3');
  assert.deepEqual(planClickMovement(state, human, 6, 3, 3), [], 'a lit destination does not allow an unlit path');
  state.viewerCharacterIds = new Set([human.id]); recomputeVisibility(state);
  assert.deepEqual(planClickMovement(state, companion, 6, 4, 3), []);
});
