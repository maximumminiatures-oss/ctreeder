import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { canMoveBetweenTiles } from '../../S3_content/src/interactions.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { makePitTunnel } from '../../S3_content/src/pit-tunnels.js';
import { fallIntoPit, knownPitAt, pitBridgeAt } from '../../S3_content/src/pits.js';
import { routeStep } from '../../S3_content/src/underpasses.js';
import { drawRopeBridges } from '../../S3_content/src/render.js';
import { ropeFeet, availableRopeFeet, planRopeUse, consumeRope, ropeActionBlock, grapplingEscapeOption,
  escapePitWithGrapplingHook, ropeBridgeOptions, buildRopeBridge, ropeBridgeArt,
  isTied, tieTargets, tieWithRope, escapeRope, GRAPPLING_ESCAPE_MOVEMENT, ROPE_BRIDGE_ASSET } from '../../S3_content/src/rope-actions.js';

function scene(width = 1, height = 1) {
  const state = createEmptyDungeonState(1, 1);
  for (const tile of state.tiles) Object.assign(tile, { type: 'floor', meta: {} });
  const actor = { id: 'hero', name: 'Hero', hp: 30, maxHitPoints: 30, x: 3, y: 4, routeId: '',
    className: 'Fighter', stats: { STR: 14, DEX: 14 }, gear: [{ name: 'Rope', quantity: 1, totalUnits: 1, slots: 1 }], bonuses: [], conditions: {} };
  const pit = { id: 'pit', type: 'feature', subtype: 'pit', x: 4, y: 4, routeId: '', visible: true,
    cells: Array.from({ length: width * height }, (_, i) => ({ x: 4 + i % width, y: 4 + Math.floor(i / width) })) };
  state.characters = [actor]; state.entities = [pit]; state.activeCharacterId = actor.id;
  Object.assign(state.player, { x: actor.x, y: actor.y, routeId: '' });
  return { state, actor, pit };
}
const steps = state => ({ canStep: (x, y, nx, ny, creature) => canMoveBetweenTiles(state, x, y, nx, ny, { creature, ignorePits: true }).ok });
function combat(state, actor, movement = 6) {
  Object.assign(state.combat, { active: true, turnOrder: [{ id: actor.id, type: 'character' }], turnIndex: 0, actionUsed: false, movementRemaining: movement });
}

test('plain imported rope defaults to 60 feet, named lengths and explicit remaining feet survive JSON', () => {
  assert.equal(ropeFeet({ name: 'Rope' }), 60);
  for (const name of ["45' rope", 'Rope, 45 ft', '45 feet of rope', '45\u2032 rope']) assert.equal(ropeFeet({ name }), 45);
  for (const item of [{ name: "0' rope" }, { name: 'Rope', ropeFeet: 0 }, { name: 'Rope', quantity: 0 },
    { name: 'Rope', ropeFeet: -1 }, { name: 'Rope', ropeFeet: NaN }, { name: 'Grappling hook' }]) assert.equal(ropeFeet(item), 0);
  const actor = { gear: [{ name: "60' rope", ropeFeet: 30 }] };
  consumeRope(actor, 15); assert.equal(actor.gear[0].name, "15' rope");
  assert.equal(ropeFeet(JSON.parse(JSON.stringify(actor.gear[0]))), 15);
});

test('rope supply checks are transactional and do not join scraps or consume depleted rope', () => {
  const actor = { gear: [{ name: "10' rope" }, { name: "5' rope" }, { name: "0' rope" }] };
  const before = structuredClone(actor);
  assert.equal(availableRopeFeet(actor), 15);
  for (const amount of [15, 0, -5, 1.5, NaN]) assert.throws(() => consumeRope(actor, amount));
  assert.deepEqual(actor, before);
  assert.throws(() => consumeRope(actor, 5, { gearIndex: 2 }));
  assert.deepEqual(actor, before);
});

test('using a stacked coil shortens only one coil and does not duplicate its inventory identity', () => {
  const actor = { gear: [{ instanceId: 'coils', name: 'Rope', quantity: 2, totalUnits: 2, slots: 2 }] };
  consumeRope(actor, 15);
  assert.equal(availableRopeFeet(actor), 105);
  assert.deepEqual(actor.gear.map(item => [item.quantity, item.slots, ropeFeet(item)]), [[1, 1, 60], [1, 1, 45]]);
  assert.equal(actor.gear[0].instanceId, 'coils'); assert.equal(actor.gear[1].instanceId, undefined);
  consumeRope(actor, 45, { gearIndex: 1 }); assert.equal(actor.gear.length, 1);
  assert.equal(planRopeUse(actor, 60).remainingFeet, 0);
  consumeRope(actor, 60); assert.equal(actor.gear.length, 0);
});

test('grappling escape costs three movement but no action, rope or hook, and updates the active player', () => {
  const { state, actor, pit } = scene();
  actor.x = 4; actor.conditions = { sinkhole: pit.id, prone: true };
  actor.gear.push({ name: 'Grappling hook' }); combat(state, actor, 3);
  state.combat.actionUsed = true;
  assert.equal(grapplingEscapeOption(state, actor).prompt, 'Escape pit with grappling hook?');
  const before = structuredClone(actor.gear), result = escapePitWithGrapplingHook(state, actor, steps(state));
  assert.equal(result.movementCost, GRAPPLING_ESCAPE_MOVEMENT); assert.equal(result.actionCost, 0);
  assert.equal(state.combat.movementRemaining, 0); assert.equal(state.combat.actionUsed, true);
  assert.deepEqual(actor.gear, before); assert.ok(!actor.conditions.sinkhole && !actor.conditions.prone);
  assert.deepEqual([state.player.x, state.player.y], [actor.x, actor.y]);
});

test('grappling requires both supplies, a real pit bottom, enough movement and a safe unoccupied rim', () => {
  const { state, actor, pit } = scene(); actor.x = 4;
  actor.conditions.sinkhole = pit.id; combat(state, actor, 2);
  actor.gear.push({ name: 'Grappling hook' });
  assert.equal(grapplingEscapeOption(state, actor), null);
  state.combat.movementRemaining = 3;
  actor.gear[0].ropeFeet = 0; assert.equal(grapplingEscapeOption(state, actor), null);
  delete actor.gear[0].ropeFeet;
  actor.gear[1].quantity = 0; assert.equal(grapplingEscapeOption(state, actor), null);
  actor.gear[1].quantity = 1;
  delete actor.conditions.sinkhole; assert.equal(grapplingEscapeOption(state, actor), null);
  actor.conditions.sinkhole = pit.id;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy)
    state.characters.push({ id: `rim${dx}${dy}`, hp: 10, x: 4 + dx, y: 4 + dy, routeId: '' });
  const before = JSON.stringify(state);
  assert.throws(() => escapePitWithGrapplingHook(state, actor), /free safe pit rim/);
  assert.equal(JSON.stringify(state), before);
});

test('grappling can leave a connected lower pit without connecting the route graph', () => {
  const { state, actor, pit } = scene();
  state.underpasses = [makePitTunnel(state, 'lower', [pit], [{ x: 4, y: 4 }, { x: 5, y: 4 }])];
  Object.assign(actor, { x: 4, y: 4, routeId: 'lower' }); actor.gear.push({ name: 'Grappling hook' });
  actor.routeId = ''; actor.conditions.sinkhole = pit.id;
  assert.equal(grapplingEscapeOption(state, actor), null);
  delete actor.conditions.sinkhole; actor.routeId = 'lower';
  assert.equal(routeStep(state, actor, { x: 3, y: 4 }), null);
  escapePitWithGrapplingHook(state, actor, steps(state));
  assert.equal(actor.routeId, ''); assert.ok(!actor.conditions.sinkhole);
  assert.deepEqual(state.underpasses[0].portals, []);
});

for (const [width, height, start, axis, cost] of [[1, 1, [3, 4], 'horizontal', 15], [2, 1, [3, 4], 'horizontal', 20],
  [2, 3, [4, 3], 'vertical', 25], [3, 2, [7, 5], 'horizontal', 25], [2, 3, [5, 7], 'vertical', 25]]) {
  test(`bridge ${width}x${height} from ${start} uses ${axis} span and ${cost} feet`, () => {
    const { state, actor, pit } = scene(width, height); [actor.x, actor.y] = start;
    const result = buildRopeBridge(state, actor, pit.id, steps(state));
    assert.equal(result.bridge.axis, axis); assert.equal(result.bridge.ropeFeet, cost);
    assert.equal(actor.gear[0].name, `${60 - cost}' rope`);
    for (const cell of result.bridge.cells) assert.equal(knownPitAt(state, cell.x, cell.y, actor), null);
    assert.ok(ropeBridgeArt(state).every(cell => cell.turn === Number(axis === 'vertical')));
  });
}

test('bridges reject wrong routes, diagonally adjacent edges, blocked geometry, insufficient rope and occupied far rims atomically', () => {
  const { state, actor, pit } = scene(2, 1);
  state.underpasses = [makePitTunnel(state, 'lower', [pit], [{ x: 4, y: 4 }, { x: 5, y: 4 }])];
  actor.routeId = 'lower'; assert.deepEqual(ropeBridgeOptions(state, actor), []);
  actor.routeId = ''; actor.y = 3; assert.deepEqual(ropeBridgeOptions(state, actor), []);
  actor.y = 4;
  assert.deepEqual(ropeBridgeOptions(state, actor, { canStep: () => false }), []);
  actor.gear[0].name = "15' rope";
  assert.throws(() => buildRopeBridge(state, actor, pit.id), /enough rope/);
  actor.gear[0].name = 'Rope'; state.characters.push({ id: 'other', hp: 5, x: 6, y: 4, routeId: '' });
  const before = JSON.stringify(state); assert.throws(() => buildRopeBridge(state, actor, pit.id));
  assert.equal(JSON.stringify(state), before);
  state.characters.at(-1).routeId = 'lower';
  assert.equal(ropeBridgeOptions(state, actor).length, 1);
});

test('bridge crosses the upper pit without falling or creating access to lower tunnel; save roundtrip preserves it', () => {
  const { state, actor, pit } = scene(2, 1);
  state.underpasses = [makePitTunnel(state, 'lower', [pit], [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }])];
  assert.equal(canMoveBetweenTiles(state, 3, 4, 4, 4, { creature: actor }).ok, false);
  buildRopeBridge(state, actor, pit.id, steps(state));
  for (let x = 3; x < 6; x++) {
    const result = canMoveBetweenTiles(state, x, 4, x + 1, 4, { creature: actor });
    assert.equal(result.ok, true); assert.equal(result.routeId, '');
  }
  assert.equal(routeStep(state, { x: 4, y: 4, routeId: 'lower' }, { x: 4, y: 3 }), null);
  assert.equal(pitBridgeAt(state, pit, { x: 4, y: 4, routeId: 'lower' }), null);
  Object.assign(actor, { x: 4, y: 4 });
  assert.equal(fallIntoPit(state, pit, actor), null); assert.equal(actor.hp, 30);
  const restored = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(restored.entities[0].ropeBridges[0].routeId, '');
  assert.equal(knownPitAt(restored, 4, 4, restored.characters[0]), null);
  assert.equal(restored.characters[0].gear[0].ropeFeet, 40);
});

test('bridge renderer uses the existing PNG, rotates vertical overlays 90 degrees, and balances canvas state', () => {
  const { state, actor, pit } = scene(1, 2); Object.assign(actor, { x: 4, y: 3 });
  buildRopeBridge(state, actor, pit.id);
  const png = readFileSync(new URL('../../S3_content/assets/rope-horizontal.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(ropeBridgeArt(state)[0].asset, ROPE_BRIDGE_ASSET);
  const calls = [], image = { id: 'rope' }, ctx = Object.fromEntries(['save', 'translate', 'rotate', 'drawImage', 'restore'].map(name =>
    [name, (...args) => calls.push([name, ...args])]));
  drawRopeBridges(state, ctx, image);
  assert.equal(calls.filter(call => call[0] === 'drawImage').length, 2);
  assert.ok(calls.filter(call => call[0] === 'rotate').every(call => call[1] === Math.PI / 2));
  assert.ok(calls.filter(call => call[0] === 'drawImage').every(call => call[1] === image));
  assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
});

function tieScene() {
  const result = scene(), { state, actor } = result;
  const target = { id: 'foe', name: 'Foe', type: 'monster', hp: 20, x: 3, y: 5, routeId: '', S: 2, D: 1, conditions: { sleeping: true } };
  state.entities.push(target); combat(state, actor);
  return { ...result, target };
}

test('Tie is ownership-neutral, uses DEX plus five, consumes 15 feet and one combat action', () => {
  const { state, actor, target } = tieScene();
  state.activeCharacterId = 'someone-else'; actor.ownerId = 'player-B'; target.ownerId = 'player-C';
  assert.equal(ropeActionBlock(state, actor, { action: true }), '');
  const result = tieWithRope(state, actor, target.id, { random: () => .5 });
  assert.equal(result.check.roll, 11); assert.equal(result.dc, 18);
  assert.equal(target.conditions.tied.dc, 18); assert.equal(isTied(target), true);
  assert.equal(actor.gear[0].name, "45' rope"); assert.equal(state.combat.actionUsed, true);
  const saved = hydrateDungeonState(serializeDungeonState(state));
  assert.deepEqual(saved.entities.find(item => item.id === target.id).conditions.tied, target.conditions.tied);
  assert.throws(() => tieWithRope(state, actor, target.id));
});

test('Tie includes sleeping party members, checks route and walls, rejects active targets and does not mutate on failure', () => {
  const { state, actor, target } = tieScene();
  state.entities.pop(); state.characters.push(target);
  assert.ok(tieTargets(state, actor).includes(target));
  assert.deepEqual(tieTargets(state, actor, { canStep: () => false }), []);
  state.underpasses = [makePitTunnel(state, 'lower', [], [{ x: 3, y: 5 }])];
  target.routeId = 'lower'; assert.deepEqual(tieTargets(state, actor), []);
  target.routeId = ''; delete target.conditions.sleeping;
  assert.deepEqual(tieTargets(state, actor), []);
  target.conditions.paralyzed = true; actor.gear[0].name = "10' rope";
  const before = JSON.stringify(state); assert.throws(() => tieWithRope(state, actor, target.id));
  assert.equal(JSON.stringify(state), before);
});

for (const [className, bonuses] of [['Thief', []], ['Fighter', [{ name: 'Grit', bonusName: 'Dexterity' }]]]) {
  test(`${className} gets advantage tying and escaping with DEX`, () => {
    const { state, actor, target } = tieScene(); Object.assign(actor, { className, bonuses });
    let values = [0, .95]; const result = tieWithRope(state, actor, target.id, { random: () => values.shift() });
    assert.equal(result.check.roll, 20); assert.equal(result.check.checkMode, 'advantage'); assert.equal(result.dc, 27);
    actor.conditions.tied = { dc: 20 }; state.combat.actionUsed = false;
    assert.match(ropeActionBlock(state, actor), /Tied/);
    values = [0, .95]; const escape = escapeRope(state, actor, 'escape', { random: () => values.shift() });
    assert.equal(escape.escaped, true); assert.equal(escape.check.checkMode, 'advantage');
    assert.equal(isTied(actor), false); assert.equal(state.combat.actionUsed, true);
  });
}

test('STR Grit helps break rope, failure preserves bindings, and one attempt spends the action regardless of result', () => {
  const { state, actor } = tieScene(); actor.conditions.tied = { dc: 20 };
  actor.bonuses = [{ name: 'Grit', bonusName: 'Strength' }];
  const fail = escapeRope(state, actor, 'break', { random: () => 0 });
  assert.equal(fail.escaped, false); assert.equal(fail.check.checkMode, 'advantage'); assert.equal(isTied(actor), true);
  assert.throws(() => escapeRope(state, actor, 'break'), /already used/);
  state.combat.actionUsed = false;
  const pass = escapeRope(state, actor, 'break', { random: () => .99 });
  assert.equal(pass.escaped, true); assert.equal(isTied(actor), false);
});

test('wrong turn, incapacitation, already tied actors and forged actors cannot perform rope actions', () => {
  const { state, actor, target } = tieScene();
  state.combat.turnIndex = 1; assert.deepEqual(tieTargets(state, actor), []);
  state.combat.turnIndex = 0;
  for (const conditions of [{ tied: { dc: 10 } }, { sleeping: true }, { paralyzed: true }, { incorporeal: true }]) {
    actor.conditions = conditions; assert.deepEqual(tieTargets(state, actor), []);
    assert.equal(grapplingEscapeOption(state, actor), null);
  }
  actor.conditions = {};
  actor.wizardEffects = [{ type: 'raving', rounds: 1 }];
  assert.deepEqual(tieTargets(state, actor), []);
  actor.wizardEffects = [];
  assert.ok(ropeActionBlock(state, { ...actor }));
  const before = JSON.stringify(state);
  assert.throws(() => tieWithRope(state, actor, target.id, { gearIndex: 999 }));
  assert.throws(() => tieWithRope(state, actor, target.id, { check: () => ({ total: NaN }) }));
  assert.equal(JSON.stringify(state), before);
});
