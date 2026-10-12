import { DOOR_STATES, TILE_SIZE_PX } from './constants.js';
import { DOOR_LIGHT_RULES } from './door-light-data.js';

export function isClosedSecretDoor(door) {
  return (door?.secret === true || door?.isSecret === true) && door.doorState !== DOOR_STATES.OPEN;
}

export function doorApproachTiles(door) {
  const inward = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[door.wallSide || door.hallDirection];
  if (!inward) return null;
  return { hall: { x: door.x, y: door.y }, room: { x: door.x + inward[0], y: door.y + inward[1] } };
}

export function doorBoundaryCenter(door) {
  const side = door.hallDirection || door.wallSide;
  if (side === 'east') return { x: door.x * TILE_SIZE_PX, y: (door.y + .5) * TILE_SIZE_PX };
  if (side === 'west') return { x: (door.x + 1) * TILE_SIZE_PX, y: (door.y + .5) * TILE_SIZE_PX };
  if (side === 'south') return { x: (door.x + .5) * TILE_SIZE_PX, y: door.y * TILE_SIZE_PX };
  return { x: (door.x + .5) * TILE_SIZE_PX, y: (door.y + 1) * TILE_SIZE_PX };
}

export function secretDoorAngle(door) {
  return { north: Math.PI, east: -Math.PI / 2, west: Math.PI / 2, south: 0 }[door.wallSide || door.hallDirection] || 0;
}

export function doorRotationAngle(door) {
  const angle = Number(door.doorRotationAngle || 0);
  if (door.orientation !== 'horizontal') return angle < 0 ? -Math.PI / 2 : Math.PI / 2;
  return Math.abs(angle) > Math.PI / 2 ? Math.PI : 0;
}

export function doorLightSegments(door) {
  const secret = door.secret === true || door.isSecret === true;
  const open = door.doorState === DOOR_STATES.OPEN;
  const key = secret ? `${/^door-secret-[123]$/.test(door.doorSpriteId) ? door.doorSpriteId : 'door-secret-1'}${open ? '-open' : ''}` : `door-${open ? 'open' : 'closed'}`;
  const rule = DOOR_LIGHT_RULES[key];
  if (!rule) return null;
  const center = secret ? doorBoundaryCenter(door) : { x: (door.x + .5) * TILE_SIZE_PX, y: (door.y + .5) * TILE_SIZE_PX };
  const angle = secret ? secretDoorAngle(door) : doorRotationAngle(door);
  const transform = ([x, y]) => {
    const dx = (x - rule.w / 2) * TILE_SIZE_PX, dy = (y - rule.h / 2) * TILE_SIZE_PX;
    return [center.x + dx * Math.cos(angle) - dy * Math.sin(angle), center.y + dx * Math.sin(angle) + dy * Math.cos(angle)];
  };
  return [...rule.edges, ...rule.paths.flatMap(path => path.slice(1).map((point, index) => [path[index], point]))].map(line => line.map(transform));
}

export function secretFoundMarkerRect(door, width, height) {
  const center = doorBoundaryCenter(door);
  const inward = door.secretFoundSide || ({ north: { x: 0, y: 1 }, south: { x: 0, y: -1 }, east: { x: -1, y: 0 }, west: { x: 1, y: 0 } }[door.wallSide || door.hallDirection]) || { x: 0, y: 1 };
  return { x: center.x + (inward.x < 0 ? -width : inward.x > 0 ? 0 : -width / 2),
    y: center.y + (inward.y < 0 ? -height : inward.y > 0 ? 0 : -height / 2), width, height };
}
