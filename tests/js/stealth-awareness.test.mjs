import test from 'node:test';
import assert from 'node:assert/strict';
import { queryThiefStealthAwareness, isDeafStealthObserver, THIEF_STEALTH_RANGES } from '../../S3_content/src/stealth-awareness.js';
import { isInvisible, isStealthed } from '../../S3_content/src/concealment.js';
import { makeUnderpass } from '../../S3_content/src/underpasses.js';

function scene() {
  const width = 20, height = 15;
  const character = { id: 'thief', name: 'Shrigark', className: 'Thief', x: 3, y: 7, hp: 10,
    stealthed: true, lightRadius: 0, routeId: '' };
  return { map: { width, height },
    tiles: Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width), type: 'floor', meta: {} })),
    characters: [character], entities: [], rooms: [], decor: {}, combat: { active: false },
    visibility: { visibleNow: new Set(), exploredEver: new Set() }, viewerCharacterIds: new Set() };
}
const thief = state => state.characters[0];
function monster(state, values = {}) {
  const entity = { id: `monster-${state.entities.length}`, type: 'monster', name: 'Orc', x: 6, y: 7, hp: 10, routeId: '', ...values };
  state.entities.push(entity);
  return entity;
}
const query = state => queryThiefStealthAwareness(state, thief(state));

test('entry and reveal ranges are circular and include their exact six- and three-square boundaries', () => {
  assert.deepEqual(THIEF_STEALTH_RANGES, { entry: 6, reveal: 3, automaticSuccess: 6 });
  const state = scene(), observer = monster(state, { x: 9 });
  assert.equal(query(state).entryBlocked, true);
  assert.equal(query(state).breakStealth, false);
  observer.y = 8;
  assert.equal(query(state).entryBlocked, false, 'six east plus one south is outside a circular radius of six');
  Object.assign(observer, { x: 6, y: 7 });
  assert.equal(query(state).breakStealth, true);
  observer.y = 8;
  assert.equal(query(state).entryBlocked, true);
  assert.equal(query(state).breakStealth, false, 'three east plus one south is outside radius three');
});

test('combat still blocks entry but does not invoke the outside-combat proximity reveal rule', () => {
  const state = scene(); monster(state);
  state.combat.active = true;
  assert.equal(query(state).entryBlocked, true);
  assert.equal(query(state).breakStealth, false);
  assert.equal(query(state).stealthBreakingObservers.length, 1);
  state.combat.active = false;
  thief(state).stealthed = false;
  assert.equal(query(state).breakStealth, false, 'nearby enemies do not create stealth to remove');
  thief(state).stealthState = { attempted: true, revealed: false };
  assert.equal(query(state).breakStealth, true);
  thief(state).stealthState.revealed = true;
  assert.equal(query(state).breakStealth, false);
});

test('monsters observe through darkness and hidden-token presentation, irrespective of player ownership', () => {
  const state = scene();
  monster(state, { visible: false, stealthed: true, stealthState: { attempted: true, revealed: false } });
  Object.assign(thief(state), { ownerId: 'another-player' });
  const result = query(state);
  assert.equal(result.entryBlocked, true);
  assert.equal(result.breakStealth, true);
  assert.equal(state.visibility.visibleNow.size, 0);
});

test('solid walls and interior wall tiles block monster LOS in both directions', () => {
  for (const feature of ['wall', 'inner-wall']) {
    const state = scene(); monster(state);
    const tile = state.tiles[7 * state.map.width + 5];
    if (feature === 'wall') tile.type = 'wall';
    else tile.meta.innerWall = { asset: 'inner-wall-1x1.png', blocksMovement: true };
    assert.equal(query(state).entryBlocked, false, feature);
    assert.equal(query(state).breakStealth, false, feature);
    assert.equal(query(state).automaticSuccess, false, 'absence of observers alone does not grant automatic success');
  }
});

test('closed and secret doors obstruct LOS while open doors do not', () => {
  for (const secret of [false, true]) {
    const state = scene(); monster(state);
    const door = { id: 'door', type: 'feature', subtype: 'door', x: 5, y: 7,
      wallSide: 'east', hallDirection: 'east', orientation: 'vertical', doorState: 'closed', secret, routeId: '' };
    state.entities.push(door);
    assert.equal(query(state).entryBlocked, false);
    door.doorState = 'open';
    assert.equal(query(state).entryBlocked, true);
    assert.equal(query(state).breakStealth, true);
  }
});

test('reviewed shadow-pen geometry and statues block LOS, but intervening creatures do not', () => {
  const state = scene(); monster(state);
  state.decor.reviewedLight = [[[5, 7], [5, 8]]];
  assert.equal(query(state).entryBlocked, false);
  state.decor.reviewedLight = [];
  state.decor.reviewed = [{ assetKey: 'statue-1x1-n', x: 5, y: 7, gridWidthTiles: 1, gridHeightTiles: 1, routeId: '' }];
  assert.equal(query(state).entryBlocked, false);
  state.decor.reviewed = [];
  state.characters.push({ id: 'ally', x: 5, y: 7, hp: 10 });
  monster(state, { id: 'intervening-monster', x: 4 });
  assert.equal(query(state).observers.length, 2);
  assert.equal(query(state).observers.find(observer => observer.id === 'monster-0').blocksEntry, true);
});

test('native decorative columns block observer sight even though tile LOS has no wall at that square', () => {
  const state = scene(); monster(state);
  state.decor.columns = [{ x: 5, y: 7 }];
  assert.equal(query(state).entryBlocked, false);
  assert.equal(query(state).breakStealth, false);
  state.decor.columns = [];
  assert.equal(query(state).entryBlocked, true);
});

test('deaf-only nearby observers grant automatic success and never block entry or break stealth', () => {
  const state = scene();
  const first = monster(state, { conditions: { deafened: true } });
  let result = query(state);
  assert.equal(result.automaticSuccess, true);
  assert.equal(result.entryBlocked, false);
  assert.equal(result.breakStealth, false);
  assert.equal(result.observers[0].monster, first);
  monster(state, { x: 8, conditions: { deafened: { source: 'spell' } } });
  assert.equal(query(state).automaticSuccess, true);
  assert.equal(query(state).observers.length, 2);
  const hearing = monster(state, { x: 7 });
  result = query(state);
  assert.equal(result.automaticSuccess, false);
  assert.deepEqual(result.entryBlockingObservers.map(observer => observer.id), [hearing.id]);
  assert.equal(result.breakStealth, false);
  hearing.x = 6;
  assert.equal(query(state).breakStealth, true);
});

test('deaf-only automatic success uses six-square circular LOS, not distant or occluded monsters', () => {
  const state = scene(), deaf = monster(state, { x: 9, conditions: { deafened: true } });
  assert.equal(query(state).automaticSuccess, true);
  deaf.y = 8;
  assert.equal(query(state).automaticSuccess, false);
  Object.assign(deaf, { x: 6, y: 7 });
  state.tiles[7 * state.map.width + 5].type = 'wall';
  assert.equal(query(state).automaticSuccess, false);
  state.tiles[7 * state.map.width + 5].type = 'floor';
  monster(state, { x: 10 });
  assert.equal(query(state).automaticSuccess, true, 'hearing monsters outside six squares do not change nearby evidence');
});

test('deaf condition aliases are accepted without rewriting conditions', () => {
  for (const creature of [{ conditions: { deafened: true } }, { conditions: { deafened: { rounds: 2 } } },
    { conditions: { deaf: true } }, { deafened: true }, { deaf: true }]) assert.equal(isDeafStealthObserver(creature), true);
  assert.equal(isDeafStealthObserver({ conditions: { deafened: false } }), false);
  assert.equal(isDeafStealthObserver(null), false);
});

test('blind, sleeping, dead, dying, defeated and departed creatures are not observers', () => {
  for (const values of [{ conditions: { blind: true } }, { conditions: { blinded: true } },
    { conditions: { sleeping: true } }, { dead: true }, { slain: true }, { defeated: true },
    { dyingRounds: 2 }, { hp: 0 }, { leftPeacefully: true }]) {
    const state = scene(); monster(state, values);
    assert.equal(query(state).observers.length, 0, JSON.stringify(values));
    assert.equal(query(state).automaticSuccess, false);
  }
});

test('upper and lower routes remain completely separate, including overlapping coordinates', () => {
  const state = scene();
  state.underpasses = [makeUnderpass('lower', Array.from({ length: 9 }, (_, index) => ({ x: index + 3, y: 7 })),
    { x: 3, y: 7 }, [{ x: 2, y: 7 }, { x: 12, y: 7 }])];
  const observer = monster(state, { x: 3, routeId: 'lower', conditions: { deafened: true } });
  assert.equal(query(state).observers.length, 0);
  assert.equal(query(state).automaticSuccess, false);
  observer.conditions = {};
  thief(state).routeId = 'lower';
  observer.x = 6;
  assert.equal(query(state).entryBlocked, true);
  assert.equal(query(state).breakStealth, true);
});

test('the query never mutates invisibility or ordinary stealth, and invisibility alone is not ordinary stealth', () => {
  const state = scene(); monster(state);
  thief(state).invisibility = { rounds: 3, source: 'spell', breakOnOffense: true };
  const before = structuredClone(state);
  const result = query(state);
  assert.equal(result.breakStealth, true);
  assert.equal(result.invisible, true);
  assert.deepEqual(state, before);
  thief(state).stealthed = false;
  assert.equal(query(state).breakStealth, false);
  assert.equal(isStealthed(thief(state)), true);
  assert.equal(isInvisible(thief(state)), true);
});

test('the query is inapplicable to non-thieves and invalid positions without throwing', () => {
  const state = scene(); monster(state);
  thief(state).className = 'Wizard';
  assert.equal(query(state).applicable, false);
  assert.equal(query(state).entryBlocked, false);
  thief(state).className = 'Thief'; thief(state).x = NaN;
  assert.equal(query(state).applicable, false);
  assert.equal(queryThiefStealthAwareness(null, null).applicable, false);
});
