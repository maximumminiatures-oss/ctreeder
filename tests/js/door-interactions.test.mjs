import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { clickEntity, getDoorClickContext } from '../../S3_content/src/interactions.js';

function scene() {
  const state = createEmptyDungeonState(7);
  state.map = { width: 11, height: 11 };
  state.tiles = Array.from({ length: 121 }, (_, i) => ({ x: i % 11, y: Math.floor(i / 11),
    type: 'floor', roomId: 'room', meta: {} }));
  state.rooms = [{ id: 'room', x: 0, y: 0, width: 11, height: 11 }];
  state.characters = [
    { id: 'far', name: 'Far', hp: 8, x: 1, y: 1, roomId: 'room' },
    { id: 'near', name: 'Near', hp: 8, x: 5, y: 4, roomId: 'room' }
  ];
  state.activeCharacterId = 'far';
  Object.assign(state.player, { x: 1, y: 1, roomId: 'room', torchLit: true, lightRadius: 8 });
  state.entities = [{ id: 'door', type: 'feature', subtype: 'door', x: 5, y: 5,
    wallSide: 'south', orientation: 'horizontal', doorState: 'closed' }];
  state.visibility.visibleNow = new Set(state.tiles.map(tile => `${tile.x},${tile.y}`));
  return state;
}

test('a visible door cannot be opened remotely once the party has characters', () => {
  const state = scene();
  state.characters[1].y = 2;
  assert.match(clickEntity(state, 5, 5).message, /next to the door/);
  assert.equal(state.entities[0].doorState, 'closed');
  assert.equal(state.activeCharacterId, 'far');
  assert.deepEqual([state.player.x, state.player.y], [1, 1]);
});

test('clicking a door selects an adjacent actor before the trap or door changes', () => {
  const state = scene(), order = [];
  let triggered = false, doorState = 'closed';
  let activeCharacterId = state.activeCharacterId;
  Object.defineProperty(state, 'activeCharacterId', { enumerable: true,
    get: () => activeCharacterId, set: value => { activeCharacterId = value; order.push('selection'); } });
  const actorReady = () => {
    assert.equal(state.activeCharacterId, 'near');
    assert.deepEqual([state.player.x, state.player.y], [5, 4]);
  };
  Object.defineProperty(state.entities[0], 'doorState', { enumerable: true,
    get: () => doorState, set: value => { actorReady(); order.push('door'); doorState = value; } });
  const trap = { id: 'trap', type: 'trap', targetType: 'door', targetEntityId: 'door',
    name: 'Needle', trigger: 'Open door', effect: 'Damage' };
  Object.defineProperty(trap, 'triggered', { enumerable: true,
    get: () => triggered, set: value => { actorReady(); order.push('trap'); triggered = value; } });
  state.entities.push(trap);
  const result = clickEntity(state, 5, 5);
  assert.equal(result.trapSprung, true);
  assert.equal(doorState, 'open');
  assert.equal(triggered, true);
  assert.deepEqual(order, ['selection', 'trap', 'door']);
});

test('an out-of-range click cannot spring a trap or start lock handling', () => {
  const state = scene();
  state.characters[1].y = 2;
  state.entities[0].doorState = 'locked';
  state.entities.push({ id: 'trap', type: 'trap', targetType: 'door', targetEntityId: 'door' });
  clickEntity(state, 5, 5);
  assert.equal(state.entities[0].doorState, 'locked');
  assert.notEqual(state.entities[1].triggered, true);
  assert.equal(state.lockedDoorAction, null);
});

test('an eligible selected neighbor is preferred; otherwise party order breaks ties', () => {
  const state = scene();
  state.characters.push({ id: 'other', name: 'Other', hp: 8, x: 6, y: 5, roomId: 'room' });
  state.activeCharacterId = 'other';
  assert.equal(getDoorClickContext(state, 5, 5).character.id, 'other');
  state.activeCharacterId = 'far';
  assert.equal(getDoorClickContext(state, 5, 5).character.id, 'near');
});

test('door actor selection respects ownership, explicit command actors, and combat turns', () => {
  const state = scene();
  assert.equal(getDoorClickContext(state, 5, 5, { canUseCharacter: character => character.id === 'far' }).character, null);
  assert.equal(getDoorClickContext(state, 5, 5, { characterId: 'far' }).character, null);
  state.combat = { active: true, turnIndex: 0, turnOrder: [{ type: 'character', id: 'far' }] };
  assert.equal(getDoorClickContext(state, 5, 5).character, null);
  state.combat.turnOrder[0].id = 'near';
  assert.equal(getDoorClickContext(state, 5, 5).character.id, 'near');
  state.combat.turnOrder[0] = { type: 'monster', id: 'monster' };
  assert.equal(getDoorClickContext(state, 5, 5).character, null);
});

test('dead, dying, unconscious, and unpositioned characters cannot use a door', () => {
  for (const change of [{ dead: true }, { slain: true }, { dyingRounds: 2 }, { hp: 0 }, { x: null }, { y: NaN }]) {
    const state = scene();
    Object.assign(state.characters[1], change);
    assert.equal(getDoorClickContext(state, 5, 5).character, null);
    assert.match(clickEntity(state, 5, 5).message, /next to the door/);
    assert.equal(state.entities[0].doorState, 'closed');
  }
});

test('unknown secret doors and hidden doors do not auto-select a character', () => {
  const state = scene();
  state.entities[0].secret = true;
  assert.equal(getDoorClickContext(state, 5, 5), null);
  assert.equal(clickEntity(state, 5, 5).message, 'No interactive token on that tile.');
  assert.equal(state.activeCharacterId, 'far');
  state.entities[0].secret = false;
  state.visibility.visibleNow.clear();
  assert.equal(getDoorClickContext(state, 5, 5), null);
  assert.equal(clickEntity(state, 5, 5).message, 'That tile is hidden by darkness.');
  assert.equal(state.activeCharacterId, 'far');
});

test('door closing uses the same nearby actor and no-character previews still work', () => {
  const state = scene();
  state.entities[0].doorState = 'open';
  assert.equal(clickEntity(state, 5, 5).message, 'Door closed.');
  assert.equal(state.activeCharacterId, 'near');
  const preview = scene();
  preview.characters = [];
  preview.entities[0].doorState = 'locked';
  assert.equal(clickEntity(preview, 5, 5).message, 'Door opened.');
});
