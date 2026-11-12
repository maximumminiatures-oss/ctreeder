import { DEEPEST_DUNGEON_LEVEL, generateDungeon, dungeonTraversalDistances, dungeonEntrancePoint, isSafeDungeonArrival } from './generator.js';
import { getTile } from './state-schema.js';
import { routeOf, routeKey } from './underpasses.js';
import { hydrateDungeonState, serializeDungeonState } from './persistence.js';

export { DEEPEST_DUNGEON_LEVEL };

export function downstairsIn(state) {
  return (state.entities || []).find(entity => entity.doorKind === 'stairs-down') || null;
}

export function upstairsIn(state) {
  return (state.entities || []).find(entity => entity.doorKind === 'stairs-up') || null;
}

export function stairsAtMapPoint(state, x, y) {
  const stairs = (state.entities || []).filter(entity => ['stairs-up', 'stairs-down'].includes(entity.doorKind));
  const direct = stairs.find(entity => entity.x === x && entity.y === y);
  if (direct) return direct;
  // Ordinary stair sprites are drawn inside their room, not on the hall-side
  // entity cell. Match the renderer's boundary center plus inward half-tile.
  for (const stair of stairs) {
    if (stair.hiddenStairSprite) continue;
    const vertical = stair.orientation !== 'horizontal';
    const centerX = vertical ? stair.x + (stair.hallDirection === 'east' ? 0 : 1) : stair.x + .5;
    const centerY = vertical ? stair.y + .5 : stair.y + (stair.hallDirection === 'south' ? 0 : 1);
    const inwardX = stair.wallSide === 'east' ? -.5 : stair.wallSide === 'west' ? .5 : 0;
    const inwardY = stair.wallSide === 'south' ? -.5 : ['east', 'west'].includes(stair.wallSide) ? 0 : .5;
    if (Math.floor(centerX + inwardX) === x && Math.floor(centerY + inwardY) === y) return stair;
  }
  for (const placement of state.decor?.reviewed || []) {
    if (!/stairs?/i.test(placement.assetKey || '')) continue;
    const odd = Number(placement.rotationTurns || 0) % 2;
    const width = odd ? placement.gridHeightTiles : placement.gridWidthTiles;
    const height = odd ? placement.gridWidthTiles : placement.gridHeightTiles;
    if (x < placement.x || y < placement.y || x >= placement.x + width || y >= placement.y + height) continue;
    const stair = stairs.find(entity => entity.hiddenStairSprite && entity.roomId === placement.roomId);
    if (stair) return stair;
  }
  return null;
}

export function partyInDownstairsRoom(state, stairs = downstairsIn(state)) {
  const party = state.characters || [];
  return Boolean(stairs?.roomId && party.length && party.every(member =>
    Number.isInteger(member.x) && Number.isInteger(member.y) && !member.conditions?.sinkhole &&
    (member.routeId ?? routeOf(state, member)) === (stairs.routeId ?? routeOf(state, stairs)) &&
    getTile(state, member.x, member.y)?.roomId === stairs.roomId));
}

export function dungeonDescentStatus(state, stairs = downstairsIn(state)) {
  if (Number(state.level) >= DEEPEST_DUNGEON_LEVEL) return { ok: false, reason: 'deepest-level', message: 'This is the deepest dungeon level.' };
  if (!stairs || !(state.entities || []).includes(stairs)) return { ok: false, reason: 'no-stairs', message: 'No stairs down are available.' };
  if (state.combat?.active) return { ok: false, reason: 'combat', message: 'Finish combat before descending deeper.' };
  if (!partyInDownstairsRoom(state, stairs)) return { ok: false, reason: 'gather-party', message: 'Gather your party before descending deeper.' };
  return { ok: true, nextLevel: Number(state.level) + 1, message: `Descend stairs to dungeon level ${Number(state.level) + 1}?` };
}

export function dungeonAscentStatus(state, stairs = upstairsIn(state)) {
  if (Number(state.level) <= 1) return { ok: false, reason: 'first-level', message: 'These stairs lead out of the dungeon.' };
  if (!stairs || !(state.entities || []).includes(stairs)) return { ok: false, reason: 'no-stairs', message: 'No stairs up are available.' };
  if (state.combat?.active) return { ok: false, reason: 'combat', message: 'Finish combat before ascending.' };
  if (!partyInDownstairsRoom(state, stairs)) return { ok: false, reason: 'gather-party', message: 'Gather your party before ascending.' };
  return { ok: true, nextLevel: Number(state.level) - 1, message: 'Ascend back to the last dungeon level?' };
}

const TRAVELLING_FIELDS = ['partyName', 'party', 'partyAssets', 'timers', 'inventory', 'lootLog', 'rulesData',
  'ownership', 'characterOwnership', 'characterAssignments', 'sharedRoom', 'arcaneTime', 'rollHistory', 'activity'];

function isDepartingPartyAreaIllusion(entity, partyIds) {
  return ['floor', 'pit'].includes(entity.illusion?.kind) && partyIds.has(entity.illusion.casterId);
}

// Inactive floors contain no party copies or recursive history. Run-length encoding
// removes repeated wall tiles while retaining every reviewed tile's exact metadata.
export function snapshotDungeonFloor(state) {
  const floor = serializeDungeonState({ ...state, dungeonFloors: undefined, characters: [], sharedRoom: undefined });
  const partyIds = new Set((state.characters || []).map(member => member.id));
  floor.entities = floor.entities.filter(entity => !isDepartingPartyAreaIllusion(entity, partyIds));
  for (const key of [...TRAVELLING_FIELDS, 'characters', 'run', 'activeCharacterId', 'player', 'combat', 'groupAction',
    'luckJournal', 'multiplayerMotions', 'lockedDoorAction', 'darkness']) delete floor[key];
  const tileRuns = [];
  let previous = '';
  for (const { x, y, ...tile } of floor.tiles) {
    const value = JSON.stringify(tile);
    if (value === previous) tileRuns[tileRuns.length - 1][0]++;
    else { tileRuns.push([1, tile]); previous = value; }
  }
  delete floor.tiles;
  floor.tileRuns = tileRuns;
  return floor;
}

export function restoreDungeonFloor(snapshot) {
  const raw = structuredClone(snapshot);
  if (![raw.map?.width, raw.map?.height].every(axis => Number.isSafeInteger(axis) && axis >= 1 && axis <= 256))
    throw new Error('The saved dungeon floor is invalid.');
  const size = raw.map.width * raw.map.height;
  if (raw.tileRuns) {
    raw.tiles = [];
    for (const [count, tile] of raw.tileRuns) {
      if (!Number.isSafeInteger(count) || count < 1 || raw.tiles.length + count > size) throw new Error('The saved dungeon floor is invalid.');
      for (let i = 0; i < count; i++) {
        const index = raw.tiles.length;
        raw.tiles.push({ ...structuredClone(tile), x: index % raw.map.width, y: Math.floor(index / raw.map.width) });
      }
    }
    delete raw.tileRuns;
  }
  if (raw.tiles?.length !== size) throw new Error('The saved dungeon floor is incomplete.');
  return hydrateDungeonState(raw);
}

export function dungeonArrivalPositions(state, count) {
  if (!Number.isInteger(count) || count < 0 || count > 16) throw new Error('A party can contain at most 16 members.');
  const entranceId = state.generation.entranceRoomId;
  const distances = dungeonTraversalDistances(state);
  return state.tiles.filter(tile => tile.roomId === entranceId).map(tile => ({ x: tile.x, y: tile.y, routeId: '' }))
    .filter(point => distances.has(routeKey(point)) && isSafeDungeonArrival(state, point))
    .sort((a, b) => distances.get(routeKey(a)) - distances.get(routeKey(b)) || a.y - b.y || a.x - b.x)
    .slice(0, count).map(point => ({ ...point, roomId: entranceId }));
}

function clearOldFloorReferences(record, partyIds, travellingIllusions) {
  for (const key of ['pendingSpell', 'pendingSteal', 'pendingFall', 'lastPitAscent', 'lastPitFall', 'lastMagicMissile',
    'magicDetectedIds', 'reviveTurnKey', 'openingSpellActionSpent', 'castFromConcealment', 'darkGuess']) delete record[key];
  if (record.conditions) {
    for (const key of ['inPit', 'pit', 'sinkhole', 'pitLedge', 'sinkholeMovementSpent']) delete record.conditions[key];
    for (const [condition, key] of [['sleeping', 'casterId'], ['tied', 'tiedBy']]) {
      const effect = record.conditions[condition];
      if (effect && effect[key] && !partyIds.has(effect[key])) delete effect[key];
    }
  }
  const focus = record.focusSpell;
  if (focus) {
    let hadCreatureTargets = false, retainedCreatureTargets = false;
    if (Array.isArray(focus.targetIds)) {
      hadCreatureTargets = true;
      focus.targetIds = focus.targetIds.filter(id => partyIds.has(id));
      retainedCreatureTargets = focus.targetIds.length > 0;
    }
    for (const key of ['targetId', 'centerId']) if (Object.hasOwn(focus, key)) {
      hadCreatureTargets = true;
      if (partyIds.has(focus[key])) retainedCreatureTargets = true;
      else delete focus[key];
    }
    if (Array.isArray(focus.usedTargetIds)) focus.usedTargetIds = focus.usedTargetIds.filter(id => partyIds.has(id));
    delete focus.suspendedPendingSpell;
    if (focus.spell === 'illusion') {
      focus.illusionIds = (focus.illusionIds || []).filter(id => travellingIllusions.get(id) === record.id);
      if (!focus.illusionIds.length) record.focusSpell = null;
    }
    // Board areas never follow a matching destination ID; party creature effects do.
    if (focus.areaId != null || hadCreatureTargets && !retainedCreatureTargets) record.focusSpell = null;
  }
  for (const effect of record.wizardEffects || []) if (effect.type === 'arcana-loop') delete effect.lastTurnKey;
}

// Call only after UI/shared-room consensus. The caller owns authorization and replacing
// its state reference; this function is atomic and never mutates the current floor.
export function buildNextLevelState(current, { seed = Number(current.seed) + 1, generationOptions = {},
  now = Date.now(), generate = generateDungeon, maxAttempts = 16, direction = 'down' } = {}) {
  const status = direction === 'up' ? dungeonAscentStatus(current) : dungeonDescentStatus(current);
  if (!status.ok) throw new Error(status.message);
  if (current.characters.length > 16) throw new Error('A party can contain at most 16 members.');
  let next, positions;
  const saved = current.dungeonFloors?.[status.nextLevel];
  if (saved) {
    next = restoreDungeonFloor(saved);
    const stairs = direction === 'up' ? downstairsIn(next) : upstairsIn(next);
    positions = returningArrivalPositions(next, current.characters.length, stairs);
    if (positions.length !== current.characters.length) throw new Error('There is not enough safe space beside the stairs for the whole party. The current dungeon is unchanged.');
  }
  for (let attempt = 0; !saved && attempt < maxAttempts; attempt++) {
    next = generate(Number(seed) + attempt, status.nextLevel, { ...generationOptions,
      partySize: generationOptions.partySize ?? current.characters.length,
      ...(attempt ? { reviewedLayouts: false } : {}) });
    positions = direction === 'up' ? returningArrivalPositions(next, current.characters.length, downstairsIn(next)) :
      dungeonArrivalPositions(next, current.characters.length);
    if (positions.length === current.characters.length) break;
    next = null;
  }
  if (!next) throw new Error('Could not find safe starting-room space for the whole party. The current dungeon is unchanged.');
  next.characters = structuredClone(current.characters);
  next.characters.forEach((member, index) => Object.assign(member, positions[index]));
  const partyIds = new Set(next.characters.map(member => member.id));
  const travellingIllusions = new Map(next.characters.filter(member => member.illusion?.kind === 'creature')
    .map(member => [member.id, member.illusion.casterId]));
  const reservedIds = new Set([...partyIds, ...next.entities.map(entity => entity.id),
    ...current.characters.flatMap(member => [member.companion?.sourceMonsterId, member.companion?.source?.id])]);
  next.characters.forEach(member => {
    clearOldFloorReferences(member, partyIds, travellingIllusions);
    if (member.companion) {
      const base = `floor-companion-${crypto.randomUUID()}`;
      let sourceId = base, suffix = 0;
      while (reservedIds.has(sourceId)) sourceId = `${base}-${++suffix}`;
      reservedIds.add(sourceId);
      member.companion.sourceMonsterId = sourceId;
      const source = member.companion.source ||= {};
      clearOldFloorReferences(source, partyIds, travellingIllusions);
      for (const key of ['curious', 'stealthState', 'emulatedId', 'targetId', 'pursuitTargetId']) delete source[key];
      Object.assign(source, { id: sourceId, x: member.x, y: member.y, routeId: member.routeId,
        roomId: member.roomId, hallId: getTile(next, member.x, member.y)?.hallId ?? null });
    }
    if (member.summon?.kind === 'floating-disc') {
      const caster = next.characters.find(character => character.id === member.summon.casterId);
      Object.assign(member.summon, { trail: [], lastCasterX: caster?.x ?? member.x,
        lastCasterY: caster?.y ?? member.y, lastCasterRouteId: caster?.routeId || '' });
    }
    if (member.raw) {
      clearOldFloorReferences(member.raw, partyIds, travellingIllusions);
      for (const key of ['x', 'y', 'roomId', 'routeId', 'companion', 'summon', 'conditions', 'focusSpell', 'wizardEffects']) {
        if (Object.hasOwn(member, key)) member.raw[key] = structuredClone(member[key]);
      }
    }
  });
  // Older cached floors can still contain fixed projections whose Focus travelled away.
  next.entities = next.entities.filter(entity => !isDepartingPartyAreaIllusion(entity, partyIds));
  // These are party/session data, not geometry. Character-owned charm, summon, Focus,
  // spell and item timers are preserved by the deep clone above, without normalization.
  for (const key of TRAVELLING_FIELDS) {
    if (Object.hasOwn(current, key)) next[key] = structuredClone(current[key]);
  }
  next.dungeonFloors = { ...structuredClone(current.dungeonFloors || {}), [current.level]: snapshotDungeonFloor(current) };
  // The live floor is represented once, at the root, and captured on departure.
  delete next.dungeonFloors[next.level];
  next.floorTransitions = Math.max(0, Number(current.floorTransitions) || 0) + 1;
  next.timers ||= {};
  next.timers.lastTickAt = now;
  next.run = { ...structuredClone(current.run || next.run), dirty: true, hasUserActivity: true };
  next.activeCharacterId = next.characters.some(member => member.id === current.activeCharacterId)
    ? current.activeCharacterId : next.characters[0]?.id || null;
  const active = next.characters.find(member => member.id === next.activeCharacterId);
  Object.assign(next.player, active ? { x: active.x, y: active.y, roomId: active.roomId, routeId: active.routeId,
    lightSource: active.lightSource || '', lightRadius: active.lightRadius || 0,
    torchLit: Boolean(active.lightSource && active.lightRadius) } : {});
  return next;
}

function returningArrivalPositions(state, count, stairs) {
  if (!stairs) return [];
  const distances = dungeonTraversalDistances(state, stairs.doorKind === 'stairs-up' ? dungeonEntrancePoint(state) : stairs);
  return state.tiles.map(tile => ({ x: tile.x, y: tile.y, routeId: '', roomId: tile.roomId }))
    .filter(point => distances.has(routeKey(point)) && isSafeDungeonArrival(state, point))
    .sort((a, b) => Number(b.roomId === stairs.roomId) - Number(a.roomId === stairs.roomId) ||
      distances.get(routeKey(a)) - distances.get(routeKey(b)) || a.y - b.y || a.x - b.x)
    .slice(0, count);
}

export function buildPreviousLevelState(current, options = {}) {
  return buildNextLevelState(current, { ...options, direction: 'up' });
}
