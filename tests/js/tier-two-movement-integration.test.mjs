import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { canMoveBetweenTiles, movePlayer, partyCanReachLoot, collectLoot } from '../../S3_content/src/interactions.js';
import { escapeWeb } from '../../S3_content/src/area-spells.js';
import { reviewedTileMovementSegments } from '../../S3_content/src/reviewed-tile-rules.js';
import { isTileIlluminated } from '../../S3_content/src/light-geometry.js';

function scene() {
  const state = createEmptyDungeonState(7);
  state.map = { width: 9, height: 9 };
  state.tiles = Array.from({ length: 81 }, (_, i) => ({ x: i % 9, y: Math.floor(i / 9), type: 'floor', roomId: 'room', meta: {} }));
  state.rooms = [{ id: 'room', x: 0, y: 0, width: 9, height: 9 }];
  state.characters = [{ id: 'wizard', name: 'Wizard', className: 'Wizard', hp: 20, maxHitPoints: 20,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 14 }, x: 3, y: 3, routeId: '', raw: {}, gear: [] }];
  state.activeCharacterId = 'wizard';
  Object.assign(state.player, { x: 3, y: 3, roomId: 'room', routeId: '', torchLit: false, lightSource: '' });
  return state;
}
function levitate(state) {
  state.characters[0].focusSpell = { spell: 'levitate', targetIds: ['wizard'] };
  state.characters[0].transformationEffects = [{ spell: 'levitate', casterId: 'wizard' }];
}
function spider(state) { state.characters[0].transformationEffects = [{ spell: 'alter self', rounds: 5, features: ['spider-legs'] }]; }
const step = state => canMoveBetweenTiles(state, 3, 3, 4, 3, { creature: state.characters[0] });
function statue(state, asset = 'statue-1x1-n') {
  const placement = { assetKey: asset, x: 4, y: 3, gridWidthTiles: 1, gridHeightTiles: 1, roomId: 'room' };
  state.decor.reviewed = [placement];
  state.decor.reviewedMovement = reviewedTileMovementSegments(asset, { x: 4, y: 3, w: 1, h: 1 });
  state.tiles[3 * 9 + 4].meta.layoutBlocks = true;
}
function pit(state, extra = {}) { state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', x: 4, y: 3, routeId: '', ...extra }); }

test('Fixed Object blocks path queries and actual movement in darkness, but not another route or expired objects', () => {
  const state = scene();
  state.entities.push({ id: 'fixed', type: 'treasure', x: 4, y: 3, fixedObject: { rounds: 5 } });
  assert.match(step(state).message, /fixed object/);
  assert.equal(movePlayer(state, 1, 0).moved, false);
  levitate(state);
  assert.equal(step(state).ok, false, 'levitation is not incorporeal');
  state.entities[0].fixedObject.rounds = 0;
  assert.equal(step(state).ok, true);
  state.entities[0].fixedObject.rounds = 5;
  state.entities[0].routeId = 'other';
  state.underpasses = [{ id: 'other', lowerCells: [{ x: 4, y: 3 }], upperCrossings: [{ x: 4, y: 3 }], portals: [] }];
  assert.equal(step(state).ok, true);
});

test('Fixed Object cannot be picked up even by a grounded adjacent party member', () => {
  const state = scene();
  state.entities.push({ id: 'fixed', type: 'treasure', name: 'Stone', x: 4, y: 3, fixedObject: { rounds: 5 } });
  assert.match(collectLoot(state, 'fixed').message, /fixed in place/);
  assert.equal(state.entities[0].collected, undefined);
});

test('Web blocks character and monster movement until a successful escape, and does not affect incorporeal creatures', () => {
  const state = scene(), wizard = state.characters[0];
  state.areaSpells = [{ id: 'web', spell: 'web', x: 3, y: 3, width: 2, height: 2, rounds: 5, castingTotal: 12, escapedIds: [] }];
  assert.match(step(state).message, /Escape the web/);
  assert.equal(movePlayer(state, 1, 0).moved, false);
  const monster = { id: 'orc', type: 'monster', hp: 10, S: 2, x: 3, y: 3 };
  state.entities.push(monster);
  assert.equal(canMoveBetweenTiles(state, 3, 3, 4, 3, { creature: monster }).ok, false);
  monster.conditions = { incorporeal: true };
  assert.equal(canMoveBetweenTiles(state, 3, 3, 4, 3, { creature: monster }).ok, true);
  escapeWeb(state, wizard, { rollCheck: () => ({ roll: 15, total: 15 }) });
  assert.equal(step(state).ok, true);
  assert.equal(movePlayer(state, 1, 0).moved, true);
});

test('path queries check Web at their supplied origin, not only at the actor current location', () => {
  const state = scene();
  state.areaSpells = [{ id: 'web', spell: 'web', x: 4, y: 3, width: 1, height: 1, rounds: 5, castingTotal: 12, escapedIds: [] }];
  assert.equal(step(state).ok, true, 'entry allowed');
  assert.equal(canMoveBetweenTiles(state, 4, 3, 5, 3, { creature: state.characters[0] }).ok, false, 'cannot plan through a web');
});

for (const mode of ['spider', 'levitate']) {
  test(`${mode} crosses revealed pits without a save or damage and advertises creature passage`, () => {
    const state = scene();
    pit(state);
    assert.equal(step(state).ok, false);
    (mode === 'spider' ? spider : levitate)(state);
    assert.equal(step(state).ok, true);
    assert.equal(step(state).passesCreatures, true);
    assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
    assert.equal(state.characters[0].hp, 20);
    assert.equal(state.characters[0].conditions?.sinkhole, undefined);
    assert.equal(state.characters[0].lastPitFall, undefined);
  });
  test(`${mode} does not spring an undiscovered pit trap while crossing it`, () => {
    const state = scene();
    pit(state, { type: 'trap', targetType: 'tile', subtype: 'pit-trap', name: 'Pit', pit: true });
    (mode === 'spider' ? spider : levitate)(state);
    assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
    assert.equal(state.entities[0].triggered, undefined);
    assert.equal(state.characters[0].hp, 20);
  });
}

test('Levitate skips floor traps and trapped floor treasure in darkness, but Spider Legs still triggers non-pit floor traps', () => {
  for (const mode of ['levitate', 'spider']) {
    const state = scene();
    state.entities.push({ id: 'trap', type: 'trap', targetType: 'tile', x: 4, y: 3, name: 'Needle', effect: 'poison' });
    (mode === 'levitate' ? levitate : spider)(state);
    const moved = movePlayer(state, 1, 0, { deferVisibility: true });
    assert.equal(moved.moved, true);
    assert.equal(Boolean(state.entities[0].triggered), mode === 'spider');
  }
  const state = scene(); levitate(state);
  state.entities.push({ id: 'loot', type: 'treasure', x: 4, y: 3, name: 'Chest' },
    { id: 'trap', type: 'trap', targetType: 'treasure', targetEntityId: 'loot', name: 'Needle', effect: 'poison' });
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  assert.equal(state.entities[1].triggered, undefined);
});

test('Levitate passes statue geometry without mutating it, but still respects pillars and stone/organic walls', () => {
  const state = scene(); statue(state);
  assert.equal(step(state).ok, false);
  levitate(state);
  const original = structuredClone(state.decor);
  assert.equal(step(state).ok, true);
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  assert.deepEqual(state.decor, original);
  assert.equal(state.tiles[3 * 9 + 4].meta.layoutBlocks, true);
  const pillar = scene(); statue(pillar, 'plr-1'); levitate(pillar);
  assert.equal(step(pillar).ok, false);
  const wall = scene(); statue(wall); levitate(wall); wall.tiles[3 * 9 + 4].type = 'wall';
  assert.equal(step(wall).ok, false);
});

test('Levitate cannot bypass a wall segment overlapping statue geometry or a separate native pillar', () => {
  const state = scene(); statue(state); levitate(state);
  state.decor.reviewedMovement.push([[4, 3], [4, 4]]);
  assert.equal(step(state).ok, false, 'duplicate wall boundary must remain');
  state.decor.reviewedMovement.pop();
  state.decor.columns = [{ x: 4, y: 3, placement: 'center', blocksMovement: true }];
  assert.equal(step(state).ok, false);
});

test('levitating selected carrier cannot collect, even when an adjacent grounded ally can reach the item', () => {
  const state = scene(); levitate(state);
  const loot = { id: 'loot', type: 'treasure', name: 'Gold', x: 4, y: 3, value: 2 };
  state.entities.push(loot);
  assert.equal(partyCanReachLoot(state, loot), false);
  state.characters.push({ id: 'ally', hp: 10, x: 4, y: 4 });
  assert.equal(partyCanReachLoot(state, loot), true);
  assert.match(collectLoot(state, 'loot').message, /Levitating/);
  assert.equal(loot.collected, undefined);
});

test('a pit sprung by a grounded ally does not make another levitating character fall', () => {
  const state = scene(); levitate(state);
  state.characters[0].x = 4;
  state.characters.push({ id: 'ally', name: 'Ally', hp: 40, maxHitPoints: 40, x: 3, y: 3,
    stats: { DEX: 10, CON: 10 }, raw: {} });
  state.activeCharacterId = 'ally';
  pit(state, { type: 'trap', targetType: 'tile', subtype: 'pit-trap', name: 'Pit', pit: true });
  const result = movePlayer(state, 1, 0, { deferVisibility: true });
  assert.equal(result.trapSprung, true);
  assert.equal(state.characters[0].hp, 20);
  assert.equal(state.characters[0].lastPitFall, undefined);
});

test('the illuminated movement branch applies the same levitation floor-trap immunity and Fixed Object blocking', () => {
  const state = scene(); levitate(state);
  state.characters[0].lightRadius = 6;
  assert.equal(isTileIlluminated(state, 3, 3, state.player), true);
  state.entities.push({ id: 'trap', type: 'trap', targetType: 'tile', x: 4, y: 3, name: 'Needle', effect: 'poison' });
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, true);
  assert.equal(state.entities[0].triggered, undefined);
  state.entities.push({ id: 'fixed', type: 'treasure', x: 5, y: 3, fixedObject: { rounds: 5 } });
  assert.equal(movePlayer(state, 1, 0, { deferVisibility: true }).moved, false);
  assert.equal(state.player.x, 4);
});
