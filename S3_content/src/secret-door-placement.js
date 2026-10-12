import { DOOR_STATES } from './constants.js';
import { doorApproachTiles } from './door-geometry.js';
import { getTile } from './state-schema.js';

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const key = ({ x, y }) => `${x},${y}`;

export function traverseDoorApproaches(state, canStep, closedSecrets = []) {
  const start = { x: state.player.x, y: state.player.y };
  const blocked = new Set(closedSecrets.map(door => key(door)));
  const distances = new Map([[key(start), 0]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index];
    for (const [dx, dy] of STEPS) {
      const to = { x: from.x + dx, y: from.y + dy };
      if (distances.has(key(to)) || blocked.has(key(to)) || !canStep(from, to)) continue;
      distances.set(key(to), distances.get(key(from)) + 1);
      queue.push(to);
    }
  }
  return distances;
}

function restoreOrdinaryDoor(door) {
  door.secret = false;
  delete door.isSecret;
  delete door.secretFound;
  delete door.secretFoundSide;
  delete door.secretFoundRoomId;
  delete door.searchDc;
  if (door.doorKind === 'secret') delete door.doorKind;
  if (/^door-secret-/.test(door.doorSpriteId || '')) door.doorSpriteId = door.normalDoorSpriteId || 'door1';
  door.visible = true;
  door.revealed = true;
}

export function enforceSecretDoorApproaches(state, canStep) {
  const doors = state.entities.filter(door => door.subtype === 'door');
  const originals = doors.filter(door => door.secret === true);
  const report = { version: 1, checked: originals.length, relocated: [], ordinary: [], doors: [] };
  if (!originals.length) {
    state.generation.secretDoorApproaches = report;
    return report;
  }
  for (const door of originals) {
    if (!/^door-secret-[123]$/.test(door.doorSpriteId || '')) {
      door.normalDoorSpriteId = door.doorSpriteId;
      door.doorSpriteId = 'door-secret-1';
    }
    Object.assign(door, { secretFound: false, revealed: false, visible: false,
      doorState: door.doorState === DOOR_STATES.OPEN ? DOOR_STATES.CLOSED : door.doorState });
  }
  const distances = traverseDoorApproaches(state, canStep);
  const eligible = door => {
    if (!door.roomId || !door.hallId || door.crypt || door.organic || door.portcullis ||
      /^(stairs|gate)/.test(door.doorKind || '')) return false;
    const sides = doorApproachTiles(door);
    if (!sides || getTile(state, sides.room.x, sides.room.y)?.roomId !== door.roomId || !canStep(sides.room, sides.hall)) return false;
    const roomDistance = distances.get(key(sides.room));
    const hallDistance = distances.get(key(sides.hall));
    return Number.isFinite(roomDistance) && roomDistance < hallDistance;
  };
  for (const door of originals) {
    if (eligible(door)) continue;
    const hallIds = new Set([door.hallId, ...(door.connectedHallIds || [])].filter(Boolean));
    const replacement = doors.find(candidate => candidate.secret !== true && eligible(candidate) &&
      [candidate.hallId, ...(candidate.connectedHallIds || [])].some(id => hallIds.has(id)));
    const artwork = door.doorSpriteId;
    const searchDc = door.searchDc;
    restoreOrdinaryDoor(door);
    if (replacement) {
      replacement.normalDoorSpriteId = replacement.doorSpriteId;
      Object.assign(replacement, { doorKind: 'secret', secret: true, secretFound: false, revealed: false,
        visible: false, doorState: replacement.doorState === DOOR_STATES.LOCKED ? DOOR_STATES.LOCKED : DOOR_STATES.CLOSED,
        doorSpriteId: artwork, searchDc });
      report.relocated.push({ from: door.id, to: replacement.id });
    } else report.ordinary.push(door.id);
  }

  // A searchable room side must remain reachable without crossing an undiscovered door.
  let pending = doors.filter(door => door.secret === true);
  while (pending.length) {
    const reachable = traverseDoorApproaches(state, canStep, pending);
    const searchable = pending.filter(door => reachable.has(key(doorApproachTiles(door).room)));
    if (!searchable.length) {
      for (const door of pending) { restoreOrdinaryDoor(door); report.ordinary.push(door.id); }
      break;
    }
    const found = new Set(searchable);
    pending = pending.filter(door => !found.has(door));
  }
  report.doors = doors.filter(door => door.secret === true).map(door => {
    const sides = doorApproachTiles(door);
    return { id: door.id, roomSteps: distances.get(key(sides.room)), hallSteps: distances.get(key(sides.hall)) };
  });
  state.generation.secretDoorApproaches = report;
  return report;
}
