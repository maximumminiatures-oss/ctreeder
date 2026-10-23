import { isBlind, isSleeping } from './conditions.js';
import { sameRoute, routeOf } from './underpasses.js';
import { hasLineOfSightFrom } from './visibility.js';

export const MONSTER_DARKVISION_RADIUS = 12;
export const MONSTER_DARKVISION_TALENT = "Darkvision 60'";

export const isMonsterCompanion = creature => Boolean(creature?.companion);
const catEyes = creature => creature?.transformationEffects?.some(effect => effect.spell === 'alter self' && effect.rounds > 0 && effect.features?.includes('cat-eyes'));
export const isDarkvisionCharacter = creature => isMonsterCompanion(creature) || catEyes(creature);
export const companionEquipmentClass = creature => creature?.companion?.kind === 'doppelganger' ? null :
  isMonsterCompanion(creature) ? 'fighter' : null;
export const hasDarkvision = creature => creature?.type === 'monster' || isDarkvisionCharacter(creature);

export function darkvisionObservers(state, { viewer = null } = {}) {
  const viewerIds = state.viewerCharacterIds instanceof Set ? state.viewerCharacterIds : null;
  return (viewer ? [viewer] : state.characters || []).filter(character =>
    (!viewerIds || viewerIds.has(character.id)) && hasDarkvision(character) && !character.dead && !character.slain &&
    !character.dyingRounds && Number(character.hp) > 0 && !isBlind(character) && !isSleeping(character, state));
}

// This is vision, not a light source. Callers supply wall/door-aware line of sight.
export function canSeeWithDarkvision(state, observer, target, { hasLineOfSight = (from, to) =>
  hasLineOfSightFrom(state, from.x, from.y, to.x, to.y, { source: from, target: to }) } = {}) {
  return Boolean(hasDarkvision(observer) && !observer.dead && !observer.slain && !observer.defeated &&
    !observer.dyingRounds && Number(observer.hp) > 0 && !isBlind(observer) && !isSleeping(observer, state) && sameRoute(state, observer, target) &&
    Math.hypot(target.x - observer.x, target.y - observer.y) <= MONSTER_DARKVISION_RADIUS &&
    typeof hasLineOfSight === 'function' && hasLineOfSight(observer, target));
}

export function partyDarkvisionReveals(state, target, options = {}) {
  return darkvisionObservers(state, options).some(observer => canSeeWithDarkvision(state, observer, target, options));
}

export function collectDarkvisionTiles(state, { hasLineOfSight, viewer = null } = {}) {
  const revealed = new Map();
  for (const observer of darkvisionObservers(state, { viewer })) {
    for (let y = Math.max(0, observer.y - 12); y <= Math.min(state.map.height - 1, observer.y + 12); y++) {
      for (let x = Math.max(0, observer.x - 12); x <= Math.min(state.map.width - 1, observer.x + 12); x++) {
        const target = { x, y, routeId: routeOf(state, observer) };
        if (canSeeWithDarkvision(state, observer, target, { hasLineOfSight })) revealed.set(`${target.routeId}|${x},${y}`, target);
      }
    }
  }
  return [...revealed.values()];
}

export const darkvisionCells = collectDarkvisionTiles;

export function tileIntersectsLightRadius(tile, source) {
  const dx = Math.max(0, Math.abs(Number(tile.x) - Number(source.x)) - .5);
  const dy = Math.max(0, Math.abs(Number(tile.y) - Number(source.y)) - .5);
  return Number(source.radius) > 0 && Math.hypot(dx, dy) <= Number(source.radius);
}

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = polygon[i], [c, d] = polygon[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}

function segmentIntersectsBox([ax, ay], [bx, by], box) {
  let low = 0, high = 1;
  for (const [a, b, min, max] of [[ax, bx, box.left, box.right], [ay, by, box.top, box.bottom]]) {
    const delta = b - a;
    if (Math.abs(delta) < 1e-9) { if (a < min || a > max) return false; continue; }
    const first = (min - a) / delta, second = (max - a) / delta;
    low = Math.max(low, Math.min(first, second)); high = Math.min(high, Math.max(first, second));
    if (low > high) return false;
  }
  return true;
}

// Polygon coordinates and tileSize must use the same units (pixels in the renderer).
export function tileIntersectsLightPolygon(tile, polygon, tileSize = 1) {
  if (!Array.isArray(polygon) || polygon.length < 3 || !(tileSize > 0)) return false;
  const box = { left: tile.x * tileSize, top: tile.y * tileSize,
    right: (tile.x + 1) * tileSize, bottom: (tile.y + 1) * tileSize };
  if (polygon.some(([x, y]) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) return true;
  if ([[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]]
    .some(point => pointInPolygon(point, polygon))) return true;
  return polygon.some((point, index) => segmentIntersectsBox(point, polygon[(index + 1) % polygon.length], box));
}

export function isTilePhysicallyIlluminated(state, tile, { sources = [], polygonFor, tileSize = 1, radiusPadding = .5 } = {}) {
  return sources.some(source => sameRoute(state, source, tile) &&
    tileIntersectsLightRadius(tile, { ...source, radius: Number(source.radius) + radiusPadding }) &&
    typeof polygonFor === 'function' && tileIntersectsLightPolygon(tile, polygonFor(source), tileSize));
}
