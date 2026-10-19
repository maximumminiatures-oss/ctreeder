import test from 'node:test';
import assert from 'node:assert/strict';
import { isMonsterCurrentlyVisible } from '../../S3_content/src/monster-perception.js';
import { updateMonsterStealth, isHiddenMonster } from '../../S3_content/src/concealment.js';
import { planFiringPosition } from '../../S3_content/src/pursuit.js';
import { canTargetAtRange, withinTargetRange } from '../../S3_content/src/targeting.js';
import { renderDungeon } from '../../S3_content/src/render.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';

function scene() {
  return { map: { width: 25, height: 7 }, tiles: Array.from({ length: 175 }, (_, i) => ({ x: i % 25, y: Math.floor(i / 25), type: 'floor' })),
    characters: [{ id: 'hero', hp: 10, x: 1, y: 3, stats: { WIS: 10 } }], entities: [], rooms: [], player: { x: 1, y: 3 },
    visibility: { visibleNow: new Set(['4,3']), exploredEver: new Set(['4,3']) } };
}

test('monster visibility uses current light and sight, never remembered exploration', () => {
  const state = scene(), monster = { id: 'foe', type: 'monster', name: 'Orc', hp: 8, x: 4, y: 3, visible: true };
  state.entities.push(monster);
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
  state.visibility.visibleNow.clear();
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
  assert.equal(canTargetAtRange(state, state.characters[0], monster, 6, { directAttack: true, requireLight: false }), false);
  state.visibility.visibleNow.add('4,3');
  state.tiles[3 * 25 + 3].type = 'wall';
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
});

test('each local multiplayer viewer still needs sight; hidden monsters and sleeping observers stay excluded', () => {
  const state = scene(), monster = { id: 'foe', type: 'monster', hp: 8, x: 4, y: 3 };
  state.tiles[3 * 25 + 3].type = 'wall';
  state.characters.push({ id: 'other', hp: 8, x: 5, y: 3 });
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
  state.viewerCharacterIds = new Set(['hero']);
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
  state.viewerCharacterIds = new Set(['other']);
  monster.stealthState = { attempted: true, revealed: false };
  monster.invisibility = { rounds: 3 };
  assert.equal(isHiddenMonster(monster), true);
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
  monster.stealthState.revealed = true;
  state.characters[1].conditions = { sleeping: {} };
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
});

test('a torch-reset animation does not reveal a monster before the growing light reaches its center', () => {
  const state = scene(), monster = { id: 'foe', type: 'monster', hp: 8, x: 4, y: 3 };
  state.characters[0].lightRadius = 6;
  state.lightTransition = { startedAt: 0, characterId: 'hero' };
  state.lightVisualTime = 1500;
  assert.equal(isMonsterCurrentlyVisible(state, monster), false);
  state.lightVisualTime = 2500;
  assert.equal(isMonsterCurrentlyVisible(state, monster), true);
});

test('one stealth roll beats every passive Wisdom within fourteen squares, including equality and later arrivals', () => {
  const state = scene(), monster = { id: 'foe', type: 'monster', name: 'Bandit', hp: 8, x: 15, y: 3, D: 2 };
  state.entities.push(monster);
  let rolls = 0;
  const options = { random: () => { rolls++; return .55; } };
  updateMonsterStealth(state, options);
  assert.equal(rolls, 1); assert.equal(monster.stealthState.total, 14); assert.equal(isHiddenMonster(monster), true);
  state.characters.push({ id: 'sage', hp: 8, x: 0, y: 3, stats: { WIS: 18 } });
  updateMonsterStealth(state, options); assert.equal(isHiddenMonster(monster), true);
  state.characters[1].x = 1;
  updateMonsterStealth(state, options); assert.equal(isHiddenMonster(monster), false); assert.equal(rolls, 1);
});

test('ranged positions maximize circular distance, prefer darkness on ties, and pay water movement on departure', () => {
  const state = scene(), target = { x: 1, y: 3 }, monster = { x: 3, y: 3 };
  const options = { movement: 6, preferRange: true, canStep: () => true,
    canAttackFrom: (x, y) => withinTargetRange({ x, y }, target, 6), isHidden: (x, y) => x === 7 && y === 3 };
  const route = planFiringPosition(state, monster, target, options);
  assert.deepEqual([route.x, route.y], [7, 3]); assert.equal(route.hidden, true);
  assert.ok(route.cost <= 6);
  const wet = planFiringPosition(state, { x: 2, y: 3 }, target, { ...options, movement: 2,
    canStep: (x, y, nx, ny) => ny === 3, stepCost: () => 2 });
  assert.deepEqual([wet.x, wet.y], [3, 3]); assert.equal(wet.cost, 2);
});

test('attack readiness includes the current square, respects the movement limit and cannot cross closed walls', () => {
  const state = scene(), monster = { x: 8, y: 3 }, target = { x: 1, y: 3 };
  const options = { movement: 6, canStep: (x, y, nx, ny) => ny === 3,
    canAttackFrom: (x, y) => withinTargetRange({ x, y }, target, 1) };
  assert.equal(planFiringPosition(state, monster, target, options).cost, 6);
  assert.equal(planFiringPosition(state, monster, target, { ...options, movement: 5 }), null);
  assert.equal(planFiringPosition(state, { x: 2, y: 3 }, target, { ...options, movement: 0 }).cost, 0);
  assert.equal(planFiringPosition(state, monster, target, { ...options, canStep: (x, y, nx, ny) => ny === 3 && nx !== 5 }), null);
});

test('motion-only frames erase newly hidden monsters without repeatedly repainting unchanged objects', () => {
  const empty = createEmptyDungeonState(1), raw = scene();
  const state = { ...empty, ...raw, visibility: { ...empty.visibility, ...raw.visibility } };
  state.entities.push({ id: 'foe', type: 'monster', name: 'Orc', hp: 8, x: 4, y: 3 });
  const calls = { clear: 0, arc: 0 };
  const context = () => new Proxy({ globalAlpha: 1, fillStyle: '', strokeStyle: '',
    clearRect: () => calls.clear++, arc: () => calls.arc++ }, { get: (object, key) => key in object ? object[key] : () => {} });
  const objectsCtx = context(), fogCtx = context();
  renderDungeon(state, { objectsCtx, fogCtx }, { motionOnly: true });
  const before = calls.arc;
  assert.ok(before > 0);
  state.visibility.visibleNow.clear();
  renderDungeon(state, { objectsCtx, fogCtx }, { motionOnly: true });
  const cleared = calls.clear;
  assert.equal(cleared, 4);
  renderDungeon(state, { objectsCtx, fogCtx }, { motionOnly: true });
  assert.equal(calls.clear, cleared + 1);
});
