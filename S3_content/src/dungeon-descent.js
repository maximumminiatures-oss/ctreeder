import { DEEPEST_DUNGEON_LEVEL, generateDungeon, dungeonTraversalDistances, isSafeDungeonArrival } from './generator.js';
import { getTile } from './state-schema.js';
import { routeOf, routeKey } from './underpasses.js';

export { DEEPEST_DUNGEON_LEVEL };

export function downstairsIn(state) {
  return (state.entities || []).find(entity => entity.doorKind === 'stairs-down') || null;
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
  return { ok: true, nextLevel: Number(state.level) + 1, message: `Descend to dungeon level ${Number(state.level) + 1}?` };
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

function clearOldFloorReferences(record, partyIds) {
  for (const key of ['pendingSpell', 'pendingSteal', 'pendingFall', 'lastPitAscent', 'lastPitFall', 'lastMagicMissile',
    'magicDetectedIds', 'reviveTurnKey', 'openingSpellActionSpent', 'castFromConcealment', 'darkGuess']) delete record[key];
  if (record.conditions) {
    for (const key of ['inPit', 'pit', 'sinkhole', 'pitLedge', 'sinkholeMovementSpent']) delete record.conditions[key];
    for (const [condition, key] of [['sleeping', 'casterId'], ['tied', 'tiedBy']]) {
      const effect = record.conditions[condition];
      if (effect && effect[key] && !partyIds.has(effect[key])) delete effect[key];
    }
  }
  if (record.focusSpell?.centerId && !partyIds.has(record.focusSpell.centerId)) record.focusSpell = null;
  for (const effect of record.wizardEffects || []) if (effect.type === 'arcana-loop') delete effect.lastTurnKey;
}

// Call only after UI/shared-room consensus. The caller owns authorization and replacing
// its state reference; this function is atomic and never mutates the current floor.
export function buildNextLevelState(current, { seed = Number(current.seed) + 1, generationOptions = {},
  now = Date.now(), generate = generateDungeon, maxAttempts = 16 } = {}) {
  const status = dungeonDescentStatus(current);
  if (!status.ok) throw new Error(status.message);
  if (current.characters.length > 16) throw new Error('A party can contain at most 16 members.');
  let next, positions;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    next = generate(Number(seed) + attempt, status.nextLevel, { ...generationOptions,
      ...(attempt ? { reviewedLayouts: false } : {}) });
    positions = dungeonArrivalPositions(next, current.characters.length);
    if (positions.length === current.characters.length) break;
    next = null;
  }
  if (!next) throw new Error('Could not find safe starting-room space for the whole party. The current dungeon is unchanged.');
  next.characters = structuredClone(current.characters);
  next.characters.forEach((member, index) => Object.assign(member, positions[index]));
  const partyIds = new Set(next.characters.map(member => member.id));
  const reservedIds = new Set([...partyIds, ...next.entities.map(entity => entity.id),
    ...current.characters.flatMap(member => [member.companion?.sourceMonsterId, member.companion?.source?.id])]);
  next.characters.forEach(member => {
    clearOldFloorReferences(member, partyIds);
    if (member.companion) {
      const base = `floor-companion-${crypto.randomUUID()}`;
      let sourceId = base, suffix = 0;
      while (reservedIds.has(sourceId)) sourceId = `${base}-${++suffix}`;
      reservedIds.add(sourceId);
      member.companion.sourceMonsterId = sourceId;
      const source = member.companion.source ||= {};
      clearOldFloorReferences(source, partyIds);
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
      clearOldFloorReferences(member.raw, partyIds);
      for (const key of ['x', 'y', 'roomId', 'routeId', 'companion', 'summon', 'conditions', 'focusSpell', 'wizardEffects']) {
        if (Object.hasOwn(member, key)) member.raw[key] = structuredClone(member[key]);
      }
    }
  });
  // These are party/session data, not geometry. Character-owned charm, summon, Focus,
  // spell and item timers are preserved by the deep clone above, without normalization.
  for (const key of ['partyName', 'party', 'partyAssets', 'timers', 'inventory', 'lootLog', 'rulesData',
    'ownership', 'characterOwnership', 'characterAssignments', 'sharedRoom', 'arcaneTime']) {
    if (Object.hasOwn(current, key)) next[key] = structuredClone(current[key]);
  }
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
