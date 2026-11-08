import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { movePlayer, clickEntity, collectLoot, disarmTrap, attemptLockedDoor,
  canMoveBetweenTiles, getPendingLockedDoorAction, isMagicallyLocked } from '../../S3_content/src/interactions.js';
import { suppressMagic, advanceMagicSuppression } from '../../S3_content/src/magic-suppression.js';
import { isTileIlluminated } from '../../S3_content/src/light-geometry.js';

function scene(lit = true) {
  const state = createEmptyDungeonState(7);
  state.map = { width: 9, height: 9 };
  state.tiles = Array.from({ length: 81 }, (_, i) => ({ x: i % 9, y: Math.floor(i / 9),
    type: 'floor', roomId: 'room', meta: {} }));
  state.rooms = [{ id: 'room', x: 0, y: 0, width: 9, height: 9 }];
  state.characters = [{ id: 'hero', name: 'Hero', className: 'Wizard', hp: 40, maxHitPoints: 40,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 14 }, x: 3, y: 3, roomId: 'room', routeId: '',
    lightRadius: lit ? 6 : 0, spellsKnown: 'Feather Fall', gear: [], raw: {} }];
  state.activeCharacterId = 'hero';
  Object.assign(state.player, { x: 3, y: 3, roomId: 'room', routeId: '', torchLit: false, lightSource: '' });
  state.visibility.visibleNow = new Set(state.tiles.map(tile => `${tile.x},${tile.y}`));
  assert.equal(isTileIlluminated(state, 3, 3, state.player), lit);
  return state;
}

function trap(state, extra = {}) {
  const entity = { id: 'trap', type: 'trap', subtype: 'hidden-trap', name: 'Magic needle', magical: true,
    targetType: 'tile', x: 4, y: 3, roomId: 'room', routeId: '', dc: 15,
    trigger: 'Touch', effect: 'Poison damage', visible: false, revealed: false, ...extra };
  state.entities.push(entity);
  return entity;
}

function door(state, extra = {}) {
  const entity = { id: 'door', type: 'feature', subtype: 'door', x: 4, y: 3, roomId: 'room', routeId: '',
    wallSide: 'east', doorState: 'closed', visible: true, lockPickDc: 12, breakDc: 12, ...extra };
  state.entities.push(entity);
  return entity;
}

function resetPosition(state, x = 3, y = 3) {
  Object.assign(state.player, { x, y });
  Object.assign(state.characters[0], { x, y });
}

function assertDormant(state, entity) {
  assert.notEqual(entity.triggered, true);
  assert.notEqual(entity.disarmed, true);
  assert.notEqual(entity.wasSprung, true);
  assert.equal(entity.targetCharacterId, undefined);
  assert.equal(state.characters[0].hp, 40);
  assert.equal(state.characters[0].pendingFall ?? null, null);
  assert.equal(state.characters[0].conditions?.sinkhole, undefined);
}

for (const lit of [true, false]) {
  test(`suppressed tile traps do not trigger in ${lit ? 'light' : 'darkness'} and rearm after ten rounds`, () => {
    const state = scene(lit), entity = trap(state, { revealed: true, visible: true });
    assert.equal(suppressMagic(entity), true);
    for (let round = 0; round < 10; round++) {
      resetPosition(state);
      const result = movePlayer(state, 1, 0, { deferVisibility: true });
      assert.equal(result.moved, true);
      assert.notEqual(result.trapSprung, true);
      assertDormant(state, entity);
      assert.equal(entity.revealed, true);
      advanceMagicSuppression(state);
    }
    resetPosition(state);
    assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).trapSprung, true);
    assert.equal(entity.triggered, true);
    assert.equal(entity.wasSprung, true);
  });

  test(`suppressed pit traps allow crossing without opening, saves or falls in ${lit ? 'light' : 'darkness'}`, t => {
    t.mock.method(Math, 'random', () => { throw new Error('Suppressed pits must not roll saves or damage'); });
    for (const subtype of ['hidden-trap', 'pit']) {
      const state = scene(lit), entity = trap(state, { subtype, name: 'Magic pit', pit: true,
        revealed: true, visible: true, cells: [{ x: 4, y: 3 }] });
      suppressMagic(entity);
      assert.equal(canMoveBetweenTiles(state, 3, 3, 4, 3, { creature: state.characters[0] }).ok, true);
      assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
      assertDormant(state, entity);
      assert.equal(entity.revealed, true);
      assert.equal(state.characters[0].lastPitFall, undefined);
    }
  });

  test(`suppressed door traps are skipped by ${lit ? 'lit' : 'dark'} movement without bypassing mundane locks`, () => {
    for (const locked of [false, true]) {
      const state = scene(lit), portal = door(state, { doorState: locked ? 'locked' : 'closed' });
      const entity = trap(state, { targetType: 'door', targetEntityId: portal.id, revealed: true });
      suppressMagic(entity);
      let result = movePlayer(state, 1, 0, { deferVisibility: true });
      if (!lit && !result.lockedDoor) result = movePlayer(state, 1, 0, { deferVisibility: true });
      assert.equal(portal.doorState, locked ? 'locked' : 'open');
      assert.notEqual(result.trapSprung, true);
      assertDormant(state, entity);
      if (locked) assert.equal(result.lockedDoor.doorId, portal.id);
    }
  });
}

test('a catastrophic disarm failure cannot trigger a suppressed trap or queue falling damage', t => {
  t.mock.method(Math, 'random', () => 0);
  for (const pit of [false, true]) {
    const state = scene(), entity = trap(state, { revealed: true, visible: true, pit,
      damageType: 'falling', effect: 'Falling damage and poison' });
    suppressMagic(entity);
    const result = disarmTrap(state, entity.id, -99);
    assert.equal(result.triggered, false);
    assert.equal(result.trapSprung, false);
    assert.equal(result.disarmed, false);
    assertDormant(state, entity);
    advanceMagicSuppression(state, 10);
    const rearmed = disarmTrap(state, entity.id, -99);
    assert.equal(rearmed.triggered, true);
    assert.equal(rearmed.trapSprung, true);
    assert.equal(entity.revealed, true);
    if (!pit) assert.equal(state.characters[0].pendingFall.sourceId, entity.id);
  }
});

test('successful disarming during suppression removes the trap permanently', () => {
  const state = scene(), entity = trap(state, { revealed: true });
  suppressMagic(entity);
  assert.equal(disarmTrap(state, entity.id, 99).disarmed, true);
  advanceMagicSuppression(state, 10);
  assert.equal(state.entities.includes(entity), false);
  assert.equal(state.entities.some(item => item.name === `broken ${entity.name}`), true);
  assert.notEqual(movePlayer(state, 1, 0, { deferVisibility: true }).trapSprung, true);
});

test('destroyed or disarmed traps do not reactivate when suppression expires', () => {
  for (const field of ['destroyed', 'disarmed']) {
    const state = scene(), entity = trap(state);
    suppressMagic(entity);
    entity[field] = true;
    advanceMagicSuppression(state, 10);
    assert.notEqual(movePlayer(state, 1, 0, { deferVisibility: true }).trapSprung, true);
    assert.notEqual(entity.triggered, true);
  }
});

test('suppressed traps do not hide another active trap on the same tile or door', () => {
  for (const targetType of ['tile', 'door']) {
    const state = scene();
    if (targetType === 'door') door(state);
    const suppressed = trap(state, { targetType, targetEntityId: 'door' });
    suppressMagic(suppressed);
    const active = trap(state, { id: 'active', targetType, targetEntityId: 'door', magical: false });
    const result = targetType === 'tile'
      ? movePlayer(state, 1, 0, { deferVisibility: true }) : clickEntity(state, 4, 3);
    assert.equal(result.trapSprung, true);
    assert.equal(active.triggered, true);
    assertDormant(state, suppressed);
  }
});

test('door clicks and mundane lock picking skip a suppressed door trap', () => {
  for (const pick of [false, true]) {
    const state = scene(), portal = door(state, { doorState: pick ? 'locked' : 'closed' });
    const entity = trap(state, { targetType: 'door', targetEntityId: portal.id, revealed: true });
    suppressMagic(entity);
    let result = clickEntity(state, 4, 3);
    if (pick) {
      assert.equal(portal.doorState, 'locked');
      result = attemptLockedDoor(state, 'pick', 99);
      assert.equal(result.opened, true);
    }
    assert.equal(portal.doorState, 'open');
    assert.notEqual(result.trapSprung, true);
    assertDormant(state, entity);
    assert.equal(entity.revealed, true);
  }
});

test('suppressed treasure traps allow collection and dark stumbling without triggering', () => {
  for (const stumble of [false, true]) {
    const state = scene(!stumble);
    state.entities.push({ id: 'loot', type: 'treasure', name: 'Gem', kind: 'gems',
      x: 4, y: 3, routeId: '', roomId: 'room', value: 10, visible: true });
    const entity = trap(state, { targetType: 'treasure', targetEntityId: 'loot', revealed: true });
    suppressMagic(entity);
    const result = stumble ? movePlayer(state, 1, 0, { deferVisibility: true }) : collectLoot(state, 'loot');
    assert.equal(stumble ? result.moved : result.collected, stumble ? true : 1);
    assert.notEqual(result.interrupted, true);
    assert.notEqual(result.trapSprung, true);
    assertDormant(state, entity);
    assert.equal(entity.revealed, true);
  }
});

test('permanent magical lock flags remain separate from mundane locks and Hold Portal', () => {
  assert.equal(isMagicallyLocked(null), false);
  assert.equal(isMagicallyLocked({ doorState: 'locked' }), false);
  assert.equal(isMagicallyLocked({ holdPortal: { rounds: 5 } }), false);
  for (const field of ['magicLock', 'magicallyLocked']) {
    const portal = { [field]: true, doorState: 'closed' };
    assert.equal(isMagicallyLocked(portal), true);
    portal.magicSuppression = { rounds: 10 };
    assert.equal(isMagicallyLocked(portal), false);
    portal.magicSuppression.rounds = 0;
    assert.equal(isMagicallyLocked(portal), true);
    portal.destroyed = true;
    assert.equal(isMagicallyLocked(portal), false);
  }
});

for (const field of ['magicLock', 'magicallyLocked']) {
  for (const lit of [true, false]) {
    test(`${field} blocks ordinary opening in ${lit ? 'light' : 'darkness'}, including trapped doors`, () => {
      for (const diagonal of [false, true]) {
        const state = scene(lit), portal = door(state, { [field]: true });
        const entity = trap(state, { targetType: 'door', targetEntityId: portal.id });
        if (diagonal) resetPosition(state, 3, 2);
        const result = movePlayer(state, 1, diagonal ? 1 : 0, { deferVisibility: true });
        assert.equal(result.moved, false);
        assert.match(result.message, /Magically locked/);
        assert.equal(portal.doorState, 'closed');
        assertDormant(state, entity);
        assert.match(clickEntity(state, 4, 3).message, /Magically locked/);
        assert.equal(portal.doorState, 'closed');
      }
    });
  }

  test(`${field} can be bypassed during suppression, but an independent mundane lock remains`, () => {
    for (const mundane of [false, true]) {
      const state = scene(), portal = door(state, { [field]: true,
        doorState: mundane ? 'locked' : 'closed' });
      suppressMagic(portal);
      const result = clickEntity(state, 4, 3);
      assert.equal(portal.doorState, mundane ? 'locked' : 'open');
      assert.equal(portal[field], true);
      if (mundane) {
        assert.equal(result.lockedDoor.doorId, portal.id);
        assert.equal(attemptLockedDoor(state, 'pick', 99).opened, true);
      }
      assert.equal(clickEntity(state, 4, 3).message, 'Door closed.');
      advanceMagicSuppression(state, 10);
      assert.equal(isMagicallyLocked(portal), true);
      assert.match(clickEntity(state, 4, 3).message, /Magically locked/);
      assert.equal(portal.doorState, 'closed');
    }
  });

  test(`${field} suppression respects mundane locks on both movement paths`, () => {
    for (const lit of [true, false]) for (const diagonal of [false, true]) for (const mundane of [false, true]) {
      const state = scene(lit), portal = door(state, { [field]: true,
        doorState: mundane ? 'locked' : 'closed' });
      suppressMagic(portal);
      if (diagonal) resetPosition(state, 3, 2);
      for (let attempt = 0; attempt < 2 && portal.doorState !== 'open'; attempt++) {
        movePlayer(state, 1, diagonal ? 1 : 0, { deferVisibility: true });
      }
      assert.equal(portal.doorState, mundane ? 'locked' : 'open');
      assert.equal(portal[field], true);
    }
  });
}

test('a queued mundane pick cannot bypass a magical lock that has reactivated', () => {
  const state = scene(), portal = door(state, { magicLock: true, doorState: 'locked' });
  suppressMagic(portal);
  clickEntity(state, 4, 3);
  assert.equal(getPendingLockedDoorAction(state).doorId, portal.id);
  advanceMagicSuppression(state, 10);
  assert.equal(attemptLockedDoor(state, 'pick', 99).opened, false);
  assert.equal(portal.doorState, 'locked');
  assert.equal(attemptLockedDoor(state, 'break', 99, { doorId: portal.id }).destroyed, true);
  assert.equal(state.entities.includes(portal), false);
});

test('an independent active trap cannot open a mundane lock while door magic is suppressed', () => {
  for (const lit of [true, false]) for (const diagonal of [false, true]) for (const click of [false, true]) {
    const state = scene(lit), portal = door(state, { magicLock: true, doorState: 'locked' });
    const entity = trap(state, { targetType: 'door', targetEntityId: portal.id, magical: false });
    suppressMagic(portal);
    if (diagonal) resetPosition(state, 3, 2);
    const result = click ? clickEntity(state, 4, 3)
      : movePlayer(state, 1, diagonal ? 1 : 0, { deferVisibility: true });
    assert.equal(result.lockedDoor.doorId, portal.id);
    assert.equal(portal.doorState, 'locked');
    assertDormant(state, entity);
  }
});

test('suppression does not reveal secret doors or bypass Hold Portal', () => {
  const state = scene(), portal = door(state, { magicLock: true, secret: true });
  suppressMagic(portal);
  assert.equal(movePlayer(state, 1, 0).message, 'Blocked by a wall.');
  assert.equal(portal.secretFound, undefined);
  assert.equal(clickEntity(state, 4, 3).message, 'No interactive token on that tile.');
  portal.secret = false;
  portal.holdPortal = { rounds: 5 };
  assert.match(movePlayer(state, 1, 0).message, /Hold Portal/);
  assert.match(clickEntity(state, 4, 3).message, /Hold Portal/);
  assert.deepEqual(portal.holdPortal, { rounds: 5 });
  assert.equal(portal.doorState, 'closed');
});

test('no-character previews retain unlocked behavior for mundane and magical doors', () => {
  for (const magic of [false, true]) {
    const state = scene(), portal = door(state, { doorState: 'locked', magicLock: magic });
    state.characters = [];
    assert.equal(clickEntity(state, 4, 3).message, 'Door opened.');
    assert.equal(portal.doorState, 'open');
  }
  const shared = scene();
  door(shared, { doorState: 'locked' });
  shared.characters = [];
  shared.sharedRoom = true;
  assert.equal(clickEntity(shared, 4, 3).message, 'Locked.');
});

test('ordinary nonmagical floor traps and revealed pits retain their behavior', () => {
  const state = scene(), entity = trap(state, { magical: false, name: 'Needle' });
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).trapSprung, true);
  assert.equal(entity.triggered, true);
  const pitState = scene();
  pitState.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 4, y: 3 });
  assert.equal(canMoveBetweenTiles(pitState, 3, 3, 4, 3).ok, false);
  assert.equal(movePlayer(pitState, 1, 0).moved, false);
});
