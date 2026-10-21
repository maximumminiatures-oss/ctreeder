import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateDungeon, generateClassicDungeon, placeDungeonDownstairs, dungeonTraversalDistances,
  isDungeonTraversalCell, isSafeDungeonArrival } from '../../S3_content/src/generator.js';
import { buildNextLevelState, dungeonArrivalPositions, downstairsIn, partyInDownstairsRoom,
  dungeonDescentStatus, DEEPEST_DUNGEON_LEVEL } from '../../S3_content/src/dungeon-descent.js';
import { createEmptyDungeonState, getTile } from '../../S3_content/src/state-schema.js';
import { makePitTunnel } from '../../S3_content/src/pit-tunnels.js';
import { makeUnderpass, routeKey } from '../../S3_content/src/underpasses.js';
import { getOrganicTileData } from '../../S3_content/src/organic-tiles.js';
import { buildMonsterCompanion, companionLeaves } from '../../S3_content/src/companions.js';

const organicAssets = JSON.parse(readFileSync(new URL('../../S3_content/data/organic-assets.json', import.meta.url)));
const delta = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const corners = { north: ['nw', 'ne'], east: ['ne', 'se'], south: ['se', 'sw'], west: ['sw', 'nw'] };

function scene() {
  const state = createEmptyDungeonState(41, 1);
  const rooms = [{ id: 'start', x: 2, y: 2, width: 6, height: 6 }, { id: 'far', x: 17, y: 2, width: 6, height: 6 }];
  for (const room of rooms) for (let y = room.y; y < room.y + room.height; y++) for (let x = room.x; x < room.x + room.width; x++)
    Object.assign(getTile(state, x, y), { type: 'floor', roomId: room.id });
  for (let x = 8; x < 17; x++) Object.assign(getTile(state, x, 4), { type: 'floor', hallId: 'hall' });
  state.rooms = rooms; state.generation.entranceRoomId = 'start';
  state.player = { ...state.player, x: 3, y: 3, roomId: 'start', routeId: '' };
  state.entities.push({ id: 'up', type: 'feature', subtype: 'door', doorKind: 'stairs-up', x: 3, y: 3, roomId: 'start', routeId: '', doorState: 'open' });
  placeDungeonDownstairs(state);
  return state;
}

function gather(state, count = 3) {
  const stairs = downstairsIn(state);
  const cells = state.tiles.filter(tile => tile.roomId === stairs.roomId && isSafeDungeonArrival(state, tile));
  state.characters = Array.from({ length: count }, (_, index) => ({ id: `hero-${index}`, name: `Hero ${index}`, hp: 10,
    x: cells[index].x, y: cells[index].y, routeId: '', roomId: stairs.roomId, gear: [], stats: {} }));
  state.activeCharacterId = state.characters[0].id;
  return state;
}

test('descent checks actual room cells and route, includes discs/companions, and caps depth at ten', () => {
  const state = gather(scene());
  assert.equal(partyInDownstairsRoom(state), true);
  assert.equal(dungeonDescentStatus(state).nextLevel, 2);
  state.characters[2].conditions = { sinkhole: 'old-pit' };
  assert.equal(partyInDownstairsRoom(state), false);
  delete state.characters[2].conditions.sinkhole;
  state.characters[2].summon = { kind: 'floating-disc' };
  state.characters[2].routeId = 'lower';
  assert.equal(partyInDownstairsRoom(state), false);
  assert.equal(dungeonDescentStatus(state).reason, 'gather-party');
  state.characters[2].routeId = '';
  state.characters[2].companion = { kind: 'charmed' };
  state.characters[2].x = 3; state.characters[2].y = 3; // stale roomId cannot bypass the check
  assert.equal(partyInDownstairsRoom(state), false);
  state.level = DEEPEST_DUNGEON_LEVEL;
  assert.equal(dungeonDescentStatus(state).reason, 'deepest-level');
  assert.throws(() => buildNextLevelState(state), /deepest/);
  state.level = 1; state.combat.active = true;
  assert.equal(dungeonDescentStatus(state).reason, 'combat');
});

test('16-member descent is atomic and keeps identity, ownership, charms, discs, equipment and clocks, not old floor state', () => {
  const state = gather(scene(), 16);
  state.partyName = 'The Expedition'; state.partyAssets.gold = 91;
  state.ownership = Object.fromEntries(state.characters.map((member, index) => [member.id, `player-${index % 3}`]));
  state.characterAssignments = { 'player-0': 'hero-0' }; state.sharedRoom = true;
  state.timers.torchElapsedMs = 2000000; state.timers.lightEverLit = true;
  state.arcaneTime = { elapsedMs: 9000000, crawlRemainderMs: 3500 };
  state.characters[0].summon = { kind: 'floating-disc', casterId: 'hero-15', remainingMs: 12345, trail: [{ x: 1, y: 1 }] };
  state.characters[1].companion = { kind: 'charmed', charm: { casterId: 'hero-15', remainingMs: 123456 }, sourceMonsterId: 'old-monster' };
  state.characters[2].companion = { kind: 'doppelganger', sourceMonsterId: 'old-doppelganger' };
  state.characters[15].gear = [{ name: 'Torch', equipped: true, lit: true }];
  state.characters[15].lightSource = 'torch'; state.characters[15].lightRadius = 6;
  state.characters[15].focusSpell = { spell: 'protection from evil', centerId: 'hero-15', radius: 2 };
  state.characters[15].faithEffects = [{ spell: 'holy weapon', remainingRounds: 3 }];
  state.characters[15].ownerId = 'owner-15';
  state.characters[15].pendingSpell = { targetId: 'old-monster' };
  state.characters[15].magicDetectedIds = ['old-door'];
  state.rest = { campfire: { x: 19, y: 5 } }; state.encounterPrompt = { monsterId: 'old-monster' };
  state.marchingGroups = { solo: { trail: [{ x: 19, y: 5 }] } };
  state.visibility.exploredEver.add('19,5');
  const before = structuredClone(state);
  const next = buildNextLevelState(state, { seed: 4, now: 100, generate: (seed, level) => ({ ...scene(), seed, level }) });
  assert.deepEqual(state, before);
  assert.equal(next.level, 2); assert.equal(next.partyName, state.partyName);
  assert.equal(next.partyAssets.gold, 91); assert.deepEqual(next.ownership, state.ownership);
  assert.deepEqual(next.characterAssignments, state.characterAssignments); assert.equal(next.sharedRoom, true);
  assert.deepEqual(next.timers, { ...state.timers, lastTickAt: 100 });
  assert.deepEqual(next.arcaneTime, state.arcaneTime);
  assert.equal(next.characters.length, 16);
  assert.equal(new Set(next.characters.map(routeKey)).size, 16);
  for (const member of next.characters) {
    assert.equal(member.roomId, 'start'); assert.equal(member.routeId, '');
    assert.ok(isSafeDungeonArrival(next, member));
  }
  assert.equal(next.characters[0].summon.remainingMs, 12345);
  assert.deepEqual(next.characters[0].summon.trail, []);
  assert.equal(next.characters[0].summon.lastCasterX, next.characters[15].x);
  assert.equal(next.characters[0].summon.lastCasterY, next.characters[15].y);
  for (const index of [1, 2]) {
    const { sourceMonsterId, source, ...metadata } = next.characters[index].companion;
    const { sourceMonsterId: previousId, ...previousMetadata } = state.characters[index].companion;
    assert.notEqual(sourceMonsterId, previousId); assert.equal(source.id, sourceMonsterId);
    assert.deepEqual(metadata, previousMetadata);
  }
  assert.deepEqual(next.characters[15].faithEffects, state.characters[15].faithEffects);
  assert.deepEqual(next.characters[15].focusSpell, state.characters[15].focusSpell);
  assert.equal(next.characters[15].ownerId, 'owner-15');
  assert.equal(next.characters[15].pendingSpell, undefined);
  assert.deepEqual(next.characters[15].gear, state.characters[15].gear);
  assert.equal(next.rest, undefined); assert.equal(next.encounterPrompt, undefined);
  assert.equal(next.marchingGroups, undefined); assert.equal(next.visibility.exploredEver.size, 0);
  assert.equal(next.combat.active, false); assert.equal(next.run.dirty, true);
  next.characters[15].gear[0].lit = false;
  assert.equal(state.characters[15].gear[0].lit, true);
});

test('descent reserves fresh companion source IDs without changing party IDs or deleting colliding new-floor monsters', () => {
  const state = gather(scene(), 4), uuid = '00000000-0000-4000-8000-000000000000';
  const base = `floor-companion-${uuid}`;
  state.characters[0].id = `${base}-1`; state.activeCharacterId = state.characters[0].id;
  for (const [index, kind] of ['friendly', 'charmed', 'doppelganger'].entries()) {
    const previous = state.characters[index + 1];
    state.characters[index + 1] = buildMonsterCompanion({ id: 'old-origin', name: 'Thief', type: 'monster', hp: 8, ac: 12,
      x: -1, y: -1, routeId: 'old-underpass', roomId: 'old-room', hallId: 'old-hall',
      conditions: { sinkhole: 'old-pit', pitLedge: 'old-pit' }, darkGuess: { x: -1, y: -1 },
      curious: { targetId: 'old-target' }, stealthState: { attempted: true }, emulatedId: 'old-victim' },
    { id: previous.id, kind, controllerId: state.characters[0].id });
    Object.assign(state.characters[index + 1], { x: previous.x, y: previous.y, roomId: previous.roomId, routeId: '' });
  }
  state.characters[1].companion.source.id = `${base}-2`;
  state.characters[2].companion.charm = { casterId: state.characters[0].id, remainingMs: 987654 };
  state.characters[2].raw = structuredClone(state.characters[2]);
  state.ownership = Object.fromEntries(state.characters.map(member => [member.id, 'player-1']));
  const before = structuredClone(state), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const generate = (seed, level) => {
    const fresh = scene(); Object.assign(fresh, { seed, level });
    fresh.entities.push({ id: 'old-origin', type: 'monster', name: 'Unrelated Orc', hp: 99, x: 20, y: 5, roomId: 'far' },
      { id: base, type: 'monster', name: 'Unrelated Goblin', hp: 7, x: 21, y: 5, roomId: 'far' });
    return fresh;
  };
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => uuid } });
    const next = buildNextLevelState(state, { generate });
    assert.deepEqual(state, before); assert.deepEqual(next.ownership, state.ownership);
    assert.deepEqual(next.characters.map(member => member.id), state.characters.map(member => member.id));
    const forbidden = new Set([...next.entities.map(entity => entity.id), ...next.characters.map(member => member.id), 'old-origin', `${base}-2`]);
    const ids = next.characters.filter(member => member.companion).map(member => member.companion.sourceMonsterId);
    assert.equal(new Set(ids).size, 3);
    for (const member of next.characters.filter(member => member.companion)) {
      const source = member.companion.source;
      assert.ok(!forbidden.has(source.id)); assert.equal(source.id, member.companion.sourceMonsterId);
      assert.equal(source.x, member.x); assert.equal(source.y, member.y);
      assert.equal(source.routeId, ''); assert.equal(source.roomId, 'start'); assert.equal(source.hallId, null);
      assert.equal(source.conditions.sinkhole, undefined); assert.equal(source.conditions.pitLedge, undefined);
      for (const key of ['darkGuess', 'curious', 'stealthState', 'emulatedId']) assert.equal(source[key], undefined);
      assert.equal(member.companion.controllerCharacterId, state.characters[0].id);
    }
    assert.deepEqual(next.characters[2].companion.charm, state.characters[2].companion.charm);
    assert.equal(next.characters[2].raw.companion.source.id, next.characters[2].companion.sourceMonsterId);
    const exit = downstairsIn(next);
    const cells = next.tiles.filter(tile => tile.roomId === exit.roomId && isSafeDungeonArrival(next, tile));
    next.characters.forEach((member, index) => Object.assign(member, { x: cells[index].x, y: cells[index].y, roomId: exit.roomId }));
    const again = buildNextLevelState(next, { generate });
    for (const member of again.characters.filter(member => member.companion)) assert.ok(!ids.includes(member.companion.sourceMonsterId));
    const friendly = next.characters.find(member => member.companion?.kind === 'friendly');
    companionLeaves(next, friendly);
    assert.equal(next.entities.find(entity => entity.id === 'old-origin').hp, 99);
    assert.equal(next.entities.find(entity => entity.id === base).hp, 7);
    assert.equal(next.entities.filter(entity => entity.id === friendly.companion.sourceMonsterId).length, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});

test('descent clears old-floor caches and raw shadows while retaining carried conditions, effects and party links', () => {
  const state = gather(scene()), caster = state.characters[0];
  Object.assign(caster, { pendingSpell: { targetId: 'old-monster' }, pendingSteal: { targetId: 'old-monster' },
    pendingFall: { pitId: 'old-pit' }, lastPitAscent: { pitId: 'old-pit' }, lastPitFall: { pitId: 'old-pit' },
    lastMagicMissile: { targetId: 'old-monster', castNumber: 5 }, magicDetectedIds: ['old-monster'],
    conditions: { sinkholeMovementSpent: 3, pitLedge: 'old-pit', sleeping: { source: 'sleep', casterId: 'old-monster' },
      tied: { dc: 19, tiedBy: 'old-monster', ropeFeet: 15 }, prone: true },
    focusSpell: { spell: 'protection from evil', centerId: state.characters[1].id, radius: 2 },
    wizardEffects: [{ type: 'arcana-loop', spell: 'Sleep', lastTurnKey: 'old-combat-round' }, { type: 'raving', remainingMs: 23456 }],
    lastWizardMishaps: [{ targetId: 'old-monster', detail: 'Historical log only' }],
    gear: [{ name: 'Dagger', instanceId: 'carried-gear', holyWeapon: { casterId: caster.id, rounds: 3 } }] });
  caster.raw = structuredClone(caster);
  state.characters[1].conditions = { sleeping: { casterId: caster.id }, tied: { dc: 17, tiedBy: caster.id } };
  state.characters[2].focusSpell = { spell: 'protection from evil', centerId: 'old-monster' };
  const next = buildNextLevelState(state, { generate: (seed, level) => ({ ...scene(), seed, level }) });
  const transferred = next.characters[0];
  for (const record of [transferred, transferred.raw]) {
    for (const key of ['pendingSpell', 'pendingSteal', 'pendingFall', 'lastPitAscent', 'lastPitFall', 'lastMagicMissile', 'magicDetectedIds'])
      assert.equal(record[key], undefined, key);
    assert.equal(record.conditions.sinkholeMovementSpent, undefined); assert.equal(record.conditions.pitLedge, undefined);
    assert.deepEqual(record.conditions.sleeping, { source: 'sleep' });
    assert.deepEqual(record.conditions.tied, { dc: 19, ropeFeet: 15 });
    assert.equal(record.conditions.prone, true);
    assert.equal(record.wizardEffects[0].lastTurnKey, undefined);
    assert.equal(record.wizardEffects[1].remainingMs, 23456);
    assert.equal(record.focusSpell.centerId, state.characters[1].id);
    assert.equal(record.roomId, 'start'); assert.equal(record.routeId, '');
  }
  assert.deepEqual(transferred.gear, caster.gear); assert.deepEqual(transferred.lastWizardMishaps, caster.lastWizardMishaps);
  assert.deepEqual(next.characters[1].conditions, state.characters[1].conditions);
  assert.equal(next.characters[2].focusSpell, null);
});

test('arrival retries cramped entrances, never overlaps or silently loses party members, and rolls back on exhaustion', () => {
  const current = gather(scene(), 16), calls = [];
  const next = buildNextLevelState(current, { seed: 20, generate(seed, level, options) {
    calls.push({ seed, level, options }); const fresh = scene(); fresh.level = level;
    if (calls.length === 1) for (const tile of fresh.tiles) if (tile.roomId === 'start' && tile.x > 3) tile.type = 'wall';
    return fresh;
  } });
  assert.equal(calls.length, 2); assert.equal(calls[1].options.reviewedLayouts, false);
  assert.equal(calls[1].seed, 21); assert.equal(next.characters.length, 16);
  const before = structuredClone(current);
  assert.throws(() => buildNextLevelState(current, { maxAttempts: 2, generate() {
    const fresh = scene(); fresh.tiles.forEach(tile => { tile.type = 'wall'; }); return fresh;
  } }), /unchanged/);
  assert.deepEqual(current, before);
  assert.throws(() => dungeonArrivalPositions(next, 17), /16/);
});

test('physical distance includes pit descents, connected lower tunnel and a second pit climb to an otherwise disconnected room', () => {
  const state = scene();
  state.entities = state.entities.filter(entity => entity.doorKind !== 'stairs-down');
  for (let x = 8; x < 17; x++) getTile(state, x, 4).type = 'wall';
  const pits = [{ id: 'a', x: 6, y: 4, roomId: 'start' }, { id: 'b', x: 18, y: 4, roomId: 'far' }]
    .map(pit => ({ ...pit, type: 'feature', subtype: 'pit', routeId: '', cells: [{ x: pit.x, y: pit.y }] }));
  const path = Array.from({ length: 13 }, (_, index) => ({ x: index + 6, y: 4 }));
  state.underpasses = [makePitTunnel(state, 'pit-link', pits, path)];
  state.entities.push(...pits);
  const distances = dungeonTraversalDistances(state);
  assert.ok(distances.has('pit-link|12,4'));
  assert.ok(distances.has('|19,4'));
  assert.equal(distances.has('|6,4'), false);
  assert.equal(isDungeonTraversalCell(state, { x: 6, y: 4, routeId: '' }), false);
  assert.equal(placeDungeonDownstairs(state).roomId, 'far');
  const exitRim = [{ x: 18, y: 3 }, { x: 19, y: 4 }, { x: 18, y: 5 }, { x: 17, y: 4 }];
  for (const cell of exitRim) getTile(state, cell.x, cell.y).meta.layoutBlocks = true;
  assert.equal(dungeonTraversalDistances(state).has('|19,3'), false);
  for (const cell of exitRim) delete getTile(state, cell.x, cell.y).meta.layoutBlocks;
  state.underpasses = [];
  assert.equal(placeDungeonDownstairs(state), null); // never place unreachable stairs
});

test('crossings do not create a shortcut between routes; stairs avoid pillars, pits, doors and hazards', () => {
  const state = scene();
  state.entities = state.entities.filter(entity => entity.doorKind !== 'stairs-down');
  for (let y = 1; y < 10; y++) Object.assign(getTile(state, 12, y), { type: 'floor', roomId: null });
  const cells = Array.from({ length: 11 }, (_, index) => ({ x: index + 7, y: 4 }));
  state.underpasses = [makeUnderpass('cross', cells, { x: 12, y: 4 }, [{ x: 6, y: 4 }, { x: 18, y: 4 }])];
  const distances = dungeonTraversalDistances(state);
  assert.ok(distances.has('cross|12,4'));
  assert.equal(distances.has('|12,4'), false);
  state.underpasses = [];
  const bad = [{ x: 21, y: 7 }, { x: 22, y: 7 }, { x: 21, y: 6 }, { x: 22, y: 6 }];
  state.decor.columns = [{ ...bad[0], blocksMovement: true }];
  state.entities.push({ id: 'pit', type: 'feature', subtype: 'pit', ...bad[1] },
    { id: 'trap', type: 'trap', targetType: 'tile', ...bad[2] }, { id: 'door', type: 'feature', subtype: 'door', ...bad[3] });
  for (const point of bad) assert.equal(isSafeDungeonArrival(state, point), false);
  const stairs = placeDungeonDownstairs(state);
  assert.ok(stairs); assert.ok(!bad.some(point => point.x === stairs.x && point.y === stairs.y));
});

test('the farthest room remains the destination even when it is flooded or fully occupied by spawns', () => {
  const state = scene();
  state.entities = state.entities.filter(entity => entity.doorKind !== 'stairs-down');
  const far = state.rooms[1];
  state.decor.water = [{ x: far.x, y: far.y, widthTiles: far.width, heightTiles: far.height, assetKey: 'water-1x1' }];
  const stairs = placeDungeonDownstairs(state);
  assert.equal(stairs.roomId, 'far');
  assert.equal(isSafeDungeonArrival(state, stairs), false);
  state.entities = state.entities.filter(entity => entity.doorKind !== 'stairs-down');
  state.decor.water = [];
  const originalIds = [];
  for (const tile of state.tiles.filter(tile => tile.roomId === 'far')) {
    const id = `monster-${tile.x}-${tile.y}`; originalIds.push(id);
    state.entities.push({ id, type: 'monster', hp: 5, x: tile.x, y: tile.y, roomId: 'far', routeId: '' });
  }
  const reserved = placeDungeonDownstairs(state);
  assert.equal(reserved.roomId, 'far');
  assert.ok(!state.entities.some(entity => entity.type === 'monster' && entity.x === reserved.x && entity.y === reserved.y));
  assert.deepEqual(state.entities.filter(entity => entity.type === 'monster').map(entity => entity.id), originalIds);
});

test('a real sixteen-member party can descend to level ten with no overlapping or hazardous arrivals and no stairs farther down', () => {
  const current = gather(scene(), 16); current.level = 9;
  const next = buildNextLevelState(current, { seed: 9 });
  assert.equal(next.level, 10); assert.equal(downstairsIn(next), null);
  assert.ok(next.entities.some(entity => entity.doorKind === 'stairs-up'));
  assert.equal(new Set(next.characters.map(routeKey)).size, 16);
  assert.ok(next.characters.every(member => isSafeDungeonArrival(next, member) && member.roomId === next.generation.entranceRoomId));
});

test('generated seeds place exactly one reachable stair in the farthest room, preserve upstairs and stop at level ten', () => {
  for (const pattern of ['processional', 'angled', 'organic', 'innerWalls']) for (const seed of [1, 3, 10, 23, 564643]) {
    const state = generateDungeon(seed, seed % 9 + 1, { architecturePattern: pattern, organicAssets });
    const stairs = state.entities.filter(entity => entity.doorKind === 'stairs-down');
    assert.equal(stairs.length, 1, `${pattern} ${seed}`);
    assert.ok(state.entities.some(entity => entity.doorKind === 'stairs-up'));
    assert.equal(stairs[0].type, 'feature'); assert.equal(stairs[0].subtype, 'door');
    assert.ok(isDungeonTraversalCell(state, stairs[0]));
    const distances = dungeonTraversalDistances(state);
    assert.ok(distances.has(routeKey(stairs[0])));
    const roomDistances = state.rooms.filter(room => room.id !== state.generation.entranceRoomId).map(room => {
      const cells = state.tiles.filter(tile => tile.roomId === room.id).map(tile => ({ ...tile, routeId: room.routeId || '' }));
      return Math.min(...cells.map(cell => distances.get(routeKey(cell))).filter(Number.isFinite));
    }).filter(Number.isFinite);
    assert.equal(state.generation.downstairs.distance, Math.max(...roomDistances));
    state.level = 10; placeDungeonDownstairs(state);
    assert.equal(downstairsIn(state), null);
    assert.ok(state.entities.some(entity => entity.doorKind === 'stairs-up'));
  }
  for (const level of [9, 10]) {
    const state = generateClassicDungeon(19, level, { pits: false, underpasses: false });
    assert.equal(Boolean(downstairsIn(state)), level < 10);
    assert.ok(state.entities.some(entity => entity.doorKind === 'stairs-up'));
  }
});

test('generated angled/organic room exits never use diagonal corner art facing a hallway', () => {
  for (const pattern of ['angled', 'organic']) for (const seed of [2, 9, 13, 22, 564643]) {
    const state = generateDungeon(seed, 1, { architecturePattern: pattern, organicAssets, underpasses: false, pits: false });
    for (const tile of state.tiles.filter(tile => tile.type === 'floor' && tile.roomId)) for (const [side, [dx, dy]] of Object.entries(delta)) {
      const neighbor = getTile(state, tile.x + dx, tile.y + dy);
      if (neighbor?.type !== 'floor' || neighbor.roomId || !neighbor.hallId) continue;
      assert.equal(tile.meta?.angledWall, undefined, `${pattern} ${seed} ${tile.x},${tile.y} ${side}`);
      const art = getOrganicTileData(tile);
      if (art && pattern === 'organic') for (const corner of corners[side])
        assert.equal(art.corners[corner], 'o', `flat organic jamb ${seed} ${tile.x},${tile.y} ${corner}`);
    }
  }
});
