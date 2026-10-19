import test from 'node:test';
import assert from 'node:assert/strict';
import { pitArt, pitContains, resolvePitSave, openPit, knownPitAt, climbFromPit, pushIntoPit, pushTargets, ropeRescues, safePitRim } from '../../S3_content/src/pits.js';
import { canMoveBetweenTiles, rollCheck } from '../../S3_content/src/interactions.js';

function scene() {
  const hero = { id: 'hero', name: 'Hero', className: 'Fighter', x: 3, y: 3, hp: 60, maxHitPoints: 60,
    stats: { STR: 14, DEX: 14 }, gear: [], bonuses: [] };
  const pit = { id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 3, cells: [{ x: 3, y: 3 }] };
  return { map: { width: 9, height: 9 }, tiles: Array.from({ length: 81 }, (_, i) => ({ x: i % 9, y: Math.floor(i / 9), type: 'floor', meta: {} })),
    characters: [hero], entities: [pit], activeCharacterId: hero.id, player: { x: 3, y: 3 }, decor: {} };
}
const options = state => ({ check: rollCheck, canStep: (x, y, nx, ny) => canMoveBetweenTiles(state, x, y, nx, ny, { ignorePits: true }).ok });
function randomRolls(values, action) { const previous = Math.random; let index = 0; Math.random = () => values[index++] ?? 0; try { return action(); } finally { Math.random = previous; } }

test('DEX Grit grants advantage on pit saves and success relocates without damage or a fall condition', () => {
  const state = scene(), hero = state.characters[0];
  hero.bonuses = [{ name: 'Grit', bonusName: 'Dexterity' }];
  const result = randomRolls([0, .99], () => resolvePitSave(state, state.entities[0], hero, options(state)));
  assert.equal(result.check.checkMode, 'advantage'); assert.equal(result.passed, true); assert.equal(hero.hp, 60);
  assert.equal(Math.max(Math.abs(hero.x - 3), Math.abs(hero.y - 3)), 1);
  assert.ok(!hero.conditions?.sinkhole); assert.deepEqual([state.player.x, state.player.y], [hero.x, hero.y]);
});

test('STR Grit grants advantage climbing out and pushing while normal checks retain a single roll', () => {
  const state = scene(), hero = state.characters[0];
  hero.conditions = { sinkhole: 'pit', prone: true }; hero.bonuses = [{ name: 'Grit', bonusName: 'Strength' }];
  const climb = randomRolls([0, .99], () => climbFromPit(state, hero, options(state)));
  assert.equal(climb.check.checkMode, 'advantage'); assert.equal(climb.escaped, true);
  Object.assign(hero, { x: 1, y: 3 });
  state.entities.push({ id: 'foe', type: 'monster', name: 'Foe', x: 2, y: 3, hp: 50, ac: 15 });
  const push = randomRolls([0, .99], () => pushIntoPit(state, hero, 'foe', 'pit', { ...options(state), random: () => 0 }));
  assert.equal(push.check.checkMode, 'advantage'); assert.equal(push.succeeded, true); assert.equal(push.monster.hp, 47);
});

test('revealed pit blocks ordinary navigation, but flight and incorporeal movement remain valid', () => {
  const state = scene();
  assert.equal(canMoveBetweenTiles(state, 2, 3, 3, 3).ok, false);
  assert.equal(canMoveBetweenTiles(state, 2, 3, 3, 3, { creature: { movement: 'fly near' } }).ok, true);
  assert.equal(canMoveBetweenTiles(state, 2, 3, 3, 3, { creature: { conditions: { incorporeal: true } } }).ok, true);
  for (const creature of [{ movement: 'fly near' }, { movement: 'flying' }, { conditions: { incorporeal: true } }, { summon: { kind: 'floating-disc' } }]) {
    Object.assign(state.characters[0], creature);
    assert.equal(resolvePitSave(state, state.entities[0], state.characters[0], options(state)), null);
  }
});

test('pit art assembles a five-by-four rim around six solid black interior cells', () => {
  const state = scene(), pit = { subtype: 'pit', x: 1, y: 1, width: 5, height: 4 };
  const art = pitArt(state, pit);
  assert.equal(art.length, 20); assert.equal(art.filter(cell => cell.sides.length === 0).length, 6);
  assert.equal(art.filter(cell => cell.asset).length, 14);
  assert.equal(art.find(cell => cell.x === 1 && cell.y === 1).asset, 'pit-nw');
  assert.equal(art.find(cell => cell.x === 5 && cell.y === 4).asset, 'pit-se');
  assert.equal(pitArt(state, state.entities[0])[0].asset, 'pit-1x1');
});

test('successful saves cannot relocate onto occupied tiles, known traps, walls or another pit', () => {
  const state = scene(), hero = state.characters[0], pit = state.entities[0];
  state.characters.push({ id: 'friend', x: 2, y: 2, hp: 10 });
  state.entities.push({ id: 'other-pit', subtype: 'pit', x: 3, y: 2 }, { type: 'trap', x: 4, y: 2, revealed: true });
  state.tiles[3 * 9 + 2].type = 'wall';
  const rim = safePitRim(state, pit, hero, options(state));
  assert.ok(rim); assert.ok(![[2, 2], [3, 2], [4, 2], [2, 3]].some(([x, y]) => rim.x === x && rim.y === y));
  const result = resolvePitSave(state, pit, hero, { ...options(state), check: () => ({ total: 20 }) });
  assert.equal(result.passed, true); assert.equal(knownPitAt(state, hero.x, hero.y), null);
});

test('a fully enclosed pit gives a successful saver a ledge without illegal teleportation and prevents impossible rescue', () => {
  const state = scene(), pit = state.entities[0], hero = state.characters[0];
  state.tiles.forEach(tile => { if (tile.x !== 3 || tile.y !== 3) tile.type = 'wall'; });
  const result = resolvePitSave(state, pit, hero, { ...options(state), check: () => ({ total: 20 }) });
  assert.equal(result.passed, true); assert.equal(hero.conditions.pitLedge, 'pit'); assert.equal(hero.hp, 60);
  assert.deepEqual([hero.x, hero.y], [3, 3]);
  hero.conditions.sinkhole = 'pit'; assert.throws(() => climbFromPit(state, hero, options(state)), /no free/);
});

test('safe-rim checks inspect only pit-adjacent candidates, not every floor tile on a large map', () => {
  const state=scene();state.map={width:200,height:200};
  state.tiles=Array.from({length:40000},(_,i)=>({x:i%200,y:Math.floor(i/200),type:'floor'}));
  Object.assign(state.characters[0],{x:100,y:100});Object.assign(state.entities[0],{x:100,y:100,cells:[{x:100,y:100}]});
  let checks=0;const rim=safePitRim(state,state.entities[0],state.characters[0],{canStep:()=>{checks++;return true;}});
  assert.ok(rim);assert.ok(checks<=16,checks);
});

test('opening a larger trap saves everyone inside its footprint; search-only discovery blocks entry but has no open artwork yet', () => {
  const state = scene(), pit = state.entities[0];
  Object.assign(pit, { type: 'trap', subtype: 'hidden-trap', targetType: 'tile', name: 'Pit', cells: [{ x: 3, y: 3 }, { x: 4, y: 3 }], revealed: true });
  state.characters.push({ id: 'friend', name: 'Friend', x: 4, y: 3, hp: 40, maxHitPoints: 40, stats: { DEX: 10 }, gear: [] });
  assert.equal(knownPitAt(state, 4, 3), pit);
  const falls = openPit(state, pit, { ...options(state), check: () => ({ total: 1 }), random: () => 0 });
  assert.equal(falls.length, 2); assert.equal(state.characters[0].hp, 57); assert.equal(state.characters[1].hp, 37);
  assert.ok(state.characters.every(hero => hero.conditions.sinkhole === 'pit'));
  assert.equal(pitContains(pit, 5, 3), false);
});

test('rescuers and pushes cannot reach through walls, and an airborne monster cannot be pushed even if helpless', () => {
  const state = scene(), hero = state.characters[0];
  Object.assign(hero, { x: 1, y: 3, gear: [{ name: 'Rope', quantity: 1 }] });
  state.characters.push({ id: 'fallen', name: 'Fallen', x: 3, y: 3, hp: 10, conditions: { sinkhole: 'pit' } });
  assert.deepEqual(ropeRescues(state, hero, options(state)), []);
  Object.assign(hero, { x: 2, y: 3 });
  assert.equal(ropeRescues(state, hero, options(state)).length, 1);
  assert.deepEqual(ropeRescues(state, hero, { canStep: () => false }), []);
  state.entities.push({ id: 'flyer', type: 'monster', hp: 20, x: 2, y: 4, movement: 'fly near', conditions: { sleeping: true } });
  assert.deepEqual(pushTargets(state, hero, options(state)), []);
});
