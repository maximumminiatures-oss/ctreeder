import test from 'node:test';
import assert from 'node:assert/strict';
import { isIllusionCreature, illusionCells, illusionContains, illusionsAt,
  illusionBlocksMonsterStep } from '../../S3_content/src/illusion-geometry.js';
import { canMoveBetweenTiles, movePlayer, disarmTrap } from '../../S3_content/src/interactions.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { makeUnderpass } from '../../S3_content/src/underpasses.js';
import { isTileIlluminated } from '../../S3_content/src/light-geometry.js';
import { suppressMagic, advanceMagicSuppression } from '../../S3_content/src/magic-suppression.js';

function scene(lit = true) {
  const state = createEmptyDungeonState(7);
  state.map = { width: 11, height: 11 };
  state.tiles = Array.from({ length: 121 }, (_, i) => ({ x: i % 11, y: Math.floor(i / 11),
    type: 'floor', roomId: 'room', meta: {} }));
  state.rooms = [{ id: 'room', x: 0, y: 0, width: 11, height: 11 }];
  state.characters = [{ id: 'hero', name: 'Hero', className: 'Wizard', hp: 40, maxHitPoints: 40,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 14 }, x: 3, y: 3, roomId: 'room', routeId: '',
    lightRadius: lit ? 6 : 0, spellsKnown: 'Feather Fall', gear: [], raw: {} }];
  state.activeCharacterId = 'hero';
  Object.assign(state.player, { x: 3, y: 3, roomId: 'room', routeId: '', torchLit: false, lightSource: '' });
  state.visibility.visibleNow = new Set(state.tiles.map(tile => `${tile.x},${tile.y}`));
  assert.equal(isTileIlluminated(state, 3, 3, state.player), lit);
  return state;
}

function area(state, kind = 'pit', extra = {}) {
  const entity = { id: `illusion-${kind}`, type: 'feature', subtype: 'illusion', x: 4, y: 3,
    width: 3, height: 3, routeId: '', illusion: { id: `projection-${kind}`, casterId: 'hero', kind }, ...extra };
  state.entities.push(entity);
  return entity;
}

function creature(state, footprint = 3, extra = {}) {
  const projection = { id: 'projection', name: 'Illusion', hp: 1, maxHitPoints: 1, x: 3, y: 3,
    routeId: '', roomId: 'room', gear: [], raw: {}, illusion: { id: 'creature-illusion', casterId: 'hero',
      kind: 'creature', form: footprint === 3 ? 'horrible behemoth' : 'goblin', footprint }, ...extra };
  state.characters.push(projection);
  return projection;
}

function monster(state, extra = {}) {
  const entity = { id: 'monster', type: 'monster', name: 'Orc', hp: 10, x: 5, y: 4, routeId: '', ...extra };
  state.entities.push(entity);
  return entity;
}

function select(state, projection) {
  state.activeCharacterId = projection.id;
  Object.assign(state.player, { x: projection.x, y: projection.y, routeId: projection.routeId });
}

const step = (state, actor = state.characters[0], extra = {}) =>
  canMoveBetweenTiles(state, 3, 3, 4, 3, { creature: actor, ...extra });

test('creature recognition is metadata-based, not its name, form, or area kind', () => {
  assert.equal(isIllusionCreature(null), false);
  assert.equal(isIllusionCreature({ name: 'Illusion', summon: { kind: 'illusion' } }), false);
  assert.equal(isIllusionCreature({ illusion: { kind: 'pit' } }), false);
  assert.equal(isIllusionCreature({ illusion: { kind: 'creature', form: 'any form' } }), true);
});

test('three-cell creature footprints are centered; single-cell forms stay at their center', () => {
  const state = scene(), large = creature(state), small = creature(state, 1, { id: 'small', routeId: 'lower' });
  assert.deepEqual(illusionCells(large), Array.from({ length: 9 }, (_, i) => ({ x: 2 + i % 3,
    y: 2 + Math.floor(i / 3), routeId: '' })));
  assert.deepEqual(illusionCells(small), [{ x: 3, y: 3, routeId: 'lower' }]);
  large.x = 0;
  assert.equal(illusionCells(large)[0].x, -1, 'geometry is not clipped or recentered at the map boundary');
});

test('area footprints use top-left coordinates and do not acquire creature centering', () => {
  const state = scene();
  for (const kind of ['pit', 'floor']) {
    const projection = area(state, kind, { routeId: 'lower' });
    const cells = illusionCells(projection);
    assert.equal(cells.length, 9);
    assert.deepEqual(cells[0], { x: 4, y: 3, routeId: 'lower' });
    assert.deepEqual(cells[8], { x: 6, y: 5, routeId: 'lower' });
    assert.equal(illusionContains(state, projection, { x: 3, y: 3, routeId: 'lower' }), false);
    assert.equal(illusionContains(state, projection, { x: 6, y: 5, routeId: 'lower' }), true);
    assert.equal(illusionContains(state, projection, { x: 7, y: 5, routeId: 'lower' }), false);
  }
});

test('invalid or ordinary objects have no illusion cells', () => {
  for (const value of [null, {}, { type: 'feature', subtype: 'pit', x: 1, y: 1 },
    { x: NaN, y: 1, illusion: { kind: 'creature' } }]) assert.deepEqual(illusionCells(value), []);
});

test('lookups include overlapping independent entities and characters, filtered by kind and route', () => {
  const state = scene(), pit = area(state), floor = area(state, 'floor'), projection = creature(state);
  area(state, 'pit', { id: 'other-route', routeId: 'lower' });
  const before = JSON.stringify(state);
  assert.deepEqual(illusionsAt(state, { x: 4, y: 3, routeId: '' }), [pit, floor, projection]);
  assert.deepEqual(illusionsAt(state, { x: 4, y: 3, routeId: '' }, 'pit'), [pit]);
  assert.deepEqual(illusionsAt(state, { x: 4, y: 3, routeId: '' }, 'creature'), [projection]);
  assert.equal(illusionsAt(state, { x: 4, y: 3, routeId: 'lower' }).length, 1);
  assert.deepEqual(illusionsAt(state, { x: 8, y: 8 }), []);
  assert.equal(JSON.stringify(state), before, 'queries do not dismiss or mutate projections');
});

test('route inference uses existing underpass topology when a query omits routeId', () => {
  const state = scene();
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 4, y: 3 }], upperCrossings: [], portals: [] }];
  const lower = area(state, 'pit', { routeId: 'lower' });
  area(state, 'floor');
  assert.deepEqual(illusionsAt(state, { x: 4, y: 3 }), [lower]);
  assert.equal(illusionContains(state, lower, { x: 4, y: 3, routeId: '' }), false);
});

test('only grounded corporeal monsters avoid an illusory pit', () => {
  const state = scene(), pit = area(state), foe = monster(state);
  const point = { x: 4, y: 3, routeId: '' };
  assert.equal(illusionBlocksMonsterStep(state, foe, point), true);
  for (const change of [{ movement: 'fly near' }, { movement: 'flying' }, { flying: true },
    { tags: ['flying'] }, { companion: { source: { movement: 'fly near' } } }, { conditions: { incorporeal: true } }]) {
    assert.equal(illusionBlocksMonsterStep(state, { ...foe, ...change }, point), false);
  }
  assert.equal(illusionBlocksMonsterStep(state, state.characters[0], point), false);
  assert.equal(illusionBlocksMonsterStep(state, null, point), false);
  assert.equal(illusionBlocksMonsterStep(state, foe, { ...point, routeId: 'lower' }), false);
  pit.illusion.kind = 'floor';
  assert.equal(illusionBlocksMonsterStep(state, foe, point), false);
});

test('monster path queries avoid illusory pits without making party movement physically blocked', () => {
  const state = scene(), pit = area(state), foe = monster(state);
  assert.equal(step(state, foe).ok, false);
  assert.equal(step(state).ok, true);
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  assert.equal(state.entities.includes(pit), true, 'contact is left for the parent, not auto-dismissed');
  for (const actor of [{ ...foe, movement: 'fly near' }, { ...foe, conditions: { incorporeal: true } }]) {
    assert.equal(step(state, actor).ok, true);
  }
});

test('illusory creatures and floors do not become monster or party occupancy blockers', () => {
  const state = scene(), projection = creature(state, 3, { x: 4 }), floor = area(state, 'floor'), foe = monster(state);
  assert.equal(step(state).ok, true);
  assert.equal(step(state, foe).ok, true);
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  assert.equal(state.characters.includes(projection), true);
  assert.equal(state.entities.includes(floor), true);
});

test('a floor illusion cannot hide actual walls, closed doors or physical pits from party navigation', () => {
  for (const obstacle of ['wall', 'door', 'pit']) {
    const state = scene();
    area(state, 'floor');
    if (obstacle === 'wall') state.tiles[3 * 11 + 4].type = 'wall';
    if (obstacle === 'door') state.entities.push({ id: 'door', type: 'feature', subtype: 'door',
      x: 4, y: 3, wallSide: 'east', doorState: 'closed' });
    if (obstacle === 'pit') state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 4, y: 3 });
    assert.equal(step(state).ok, false, obstacle);
  }
});

test('monsters can step onto real pits covered by a floor illusion while the party remains blocked', () => {
  for (const hiddenTrap of [false, true]) {
    const state = scene(), foe = monster(state), floor = area(state, 'floor');
    const pit = hiddenTrap
      ? { id: 'pit', type: 'trap', subtype: 'hidden-trap', targetType: 'tile', name: 'Pit', revealed: true, x: 4, y: 3 }
      : { id: 'pit', type: 'feature', subtype: 'pit', x: 4, y: 3 };
    state.entities.push(pit);
    assert.equal(step(state, foe).ok, true);
    assert.equal(step(state).ok, false);
    assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, false);
    assert.notEqual(pit.triggered, true, 'planning leaves pit opening and falls to parent contact handling');
    assert.equal(foe.hp, 10);
    assert.equal(foe.conditions?.sinkhole, undefined);
    floor.routeId = 'other-route';
    assert.equal(step(state, foe).ok, false, 'a floor on another route cannot cover this pit');
    floor.routeId = '';
    state.entities.splice(state.entities.indexOf(floor), 1);
    assert.equal(step(state, foe).ok, false, 'uncovered real pits retain normal monster blocking');
  }
});

test('a covering floor does not let monsters bypass walls, closed doors or overlapping false pits', () => {
  for (const obstacle of ['wall', 'door', 'false-pit']) {
    const state = scene(), foe = monster(state);
    area(state, 'floor');
    state.entities.push({ id: 'real-pit', type: 'feature', subtype: 'pit', x: 4, y: 3 });
    if (obstacle === 'wall') state.tiles[3 * 11 + 4].type = 'wall';
    if (obstacle === 'door') state.entities.push({ id: 'door', type: 'feature', subtype: 'door',
      x: 4, y: 3, wallSide: 'east', doorState: 'closed' });
    if (obstacle === 'false-pit') area(state, 'pit');
    assert.equal(step(state, foe).ok, false, obstacle);
  }
});

test('floor-covered magical pit planning preserves suppression and its expiry', () => {
  const state = scene(), foe = monster(state);
  area(state, 'floor');
  const pit = { id: 'pit', type: 'trap', subtype: 'hidden-trap', targetType: 'tile', name: 'Magic pit',
    magical: true, revealed: true, x: 4, y: 3 };
  state.entities.push(pit);
  suppressMagic(pit);
  assert.equal(step(state, foe).ok, true);
  assert.equal(step(state).ok, true, 'suppressed magical pits retain the existing party exception');
  assert.equal(pit.magicSuppression.rounds, 10);
  assert.notEqual(pit.triggered, true);
  advanceMagicSuppression(state, 10);
  assert.equal(step(state, foe).ok, true);
  assert.equal(step(state).ok, false);
  assert.notEqual(pit.triggered, true);
});

for (const lit of [true, false]) {
  test(`floor illusions do not suppress real traps in ${lit ? 'light' : 'darkness'}`, () => {
    const state = scene(lit);
    area(state, 'floor');
    const trap = { id: 'trap', type: 'trap', targetType: 'tile', x: 4, y: 3, name: 'Needle', effect: 'Poison' };
    state.entities.push(trap);
    assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).trapSprung, true);
    assert.equal(trap.triggered, true);
  });

  test(`creature illusions cannot trigger floor traps or fall into pits in ${lit ? 'light' : 'darkness'}`, t => {
    t.mock.method(Math, 'random', () => { throw new Error('Illusions must not roll trap saves or damage'); });
    for (const kind of ['trap', 'hidden-pit', 'open-pit']) {
      const state = scene(lit), projection = creature(state, 1);
      select(state, projection);
      const hazard = kind === 'open-pit'
        ? { id: 'pit', type: 'feature', subtype: 'pit', x: 4, y: 3 }
        : { id: 'trap', type: 'trap', subtype: 'hidden-trap', targetType: 'tile', x: 4, y: 3,
          name: kind === 'hidden-pit' ? 'Pit' : 'Needle', effect: 'Falling damage and poison' };
      state.entities.push(hazard);
      assert.equal(step(state, projection).ok, true);
      assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
      assert.notEqual(hazard.triggered, true);
      assert.notEqual(hazard.revealed, true);
      assert.equal(projection.hp, 1);
      assert.equal(projection.pendingFall, undefined);
      assert.equal(projection.conditions?.sinkhole, undefined);
      assert.deepEqual([projection.x, projection.y], [4, 3]);
    }
  });

  test(`a moving behemoth checks all nine destination cells for living monsters in ${lit ? 'light' : 'darkness'}`, () => {
    const state = scene(lit), projection = creature(state), foe = monster(state);
    select(state, projection);
    assert.equal(step(state, projection).ok, false, 'monster touches the outer corner, not the center');
    assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, false);
    assert.deepEqual([state.player.x, state.player.y], [3, 3]);
    foe.defeated = true;
    assert.equal(step(state, projection).ok, true);
    assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  });
}

test('small creature illusions check only their destination cell and ignore owned illusion features', () => {
  const state = scene(), projection = creature(state, 1), foe = monster(state);
  area(state, 'floor', { illusion: { id: projection.illusion.id, casterId: 'hero', kind: 'floor' } });
  assert.equal(step(state, projection).ok, true);
  Object.assign(foe, { x: 4, y: 3 });
  assert.equal(step(state, projection).ok, false);
});

test('monster overlap checks ignore other routes, dead/departed monsters and other creature illusions', () => {
  for (const change of [{ routeId: 'lower' }, { hp: 0 }, { dead: true }, { slain: true },
    { defeated: true }, { leftPeacefully: true }, { illusion: { kind: 'creature', footprint: 1 } }]) {
    const state = scene(), projection = creature(state);
    monster(state, change);
    assert.equal(step(state, projection).ok, true, JSON.stringify(change));
  }
});

test('creature projections retain ordinary wall and closed-door movement checks', () => {
  const state = scene(), projection = creature(state, 1);
  state.tiles[3 * 11 + 4].type = 'wall';
  assert.equal(step(state, projection).ok, false);
  state.tiles[3 * 11 + 4].type = 'floor';
  state.entities.push({ type: 'feature', subtype: 'door', x: 4, y: 3, wallSide: 'east', doorState: 'closed' });
  assert.equal(step(state, projection).ok, false);
});

test('a real pit sprung by an ordinary character excludes illusion characters from its saves and falls', t => {
  t.mock.method(Math, 'random', () => 0);
  const state = scene(), projection = creature(state, 1, { x: 4 });
  const pit = { id: 'pit', type: 'trap', targetType: 'tile', name: 'Pit', x: 4, y: 3 };
  state.entities.push(pit);
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).trapSprung, true);
  assert.equal(pit.triggered, true);
  assert.equal(state.characters[0].pendingFall.sourceId, 'pit');
  assert.equal(projection.hp, 1);
  assert.equal(projection.pendingFall, undefined);
  assert.equal(projection.lastPitFall, undefined);
  assert.equal(projection.conditions?.sinkhole, undefined);
});

test('dark illusion movement does not touch floor treasure or spring its attached trap', () => {
  const state = scene(false), projection = creature(state, 1);
  select(state, projection);
  const treasure = { id: 'loot', type: 'treasure', name: 'Chest', x: 4, y: 3, visible: false };
  const trap = { id: 'trap', type: 'trap', targetType: 'treasure', targetEntityId: 'loot', x: 4, y: 3 };
  state.entities.push(treasure, trap);
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  assert.equal(treasure.visible, false);
  assert.notEqual(trap.triggered, true);
  assert.equal(state.characters.includes(projection), true);
});

test('the shared trap path does not spring a trap when the active actor is an illusion', () => {
  const state = scene(), projection = creature(state, 1);
  select(state, projection);
  const trap = { id: 'trap', type: 'trap', targetType: 'tile', x: 4, y: 3, revealed: true, dc: 15 };
  state.entities.push(trap);
  const result = disarmTrap(state, 'trap', -99);
  assert.equal(result.triggered, false);
  assert.equal(result.trapSprung, false);
  assert.notEqual(trap.triggered, true);
});

test('illusory pit avoidance respects the destination route of a genuine underpass step', () => {
  const state = scene();
  state.underpasses = [makeUnderpass('lower', [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }],
    { x: 4, y: 3 }, [{ x: 2, y: 3 }, { x: 6, y: 3 }])];
  const foe = monster(state, { x: 3, y: 3, routeId: 'lower' });
  const pit = area(state, 'pit', { routeId: '' });
  assert.equal(step(state, foe).ok, true);
  pit.routeId = 'lower';
  assert.equal(step(state, foe).ok, false);
});
