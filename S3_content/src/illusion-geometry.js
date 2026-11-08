import { isIncorporeal } from './conditions.js';
import { routeOf } from './underpasses.js';

export const isIllusionCreature = creature => creature?.illusion?.kind === 'creature';

function isAreaIllusion(projection) {
  return projection?.type === 'feature' && projection.subtype === 'illusion' &&
    ['floor', 'pit'].includes(projection.illusion?.kind);
}

export function illusionCells(projection) {
  const creature = isIllusionCreature(projection);
  if ((!creature && !isAreaIllusion(projection)) ||
      !Number.isInteger(projection.x) || !Number.isInteger(projection.y)) return [];
  const footprint = Number(projection.illusion.footprint) === 3 ? 3 : 1;
  const width = creature ? footprint : Math.max(1, Math.floor(Number(projection.width) || 3));
  const height = creature ? footprint : Math.max(1, Math.floor(Number(projection.height) || 3));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return [];
  const left = projection.x - (creature ? Math.floor(footprint / 2) : 0);
  const top = projection.y - (creature ? Math.floor(footprint / 2) : 0);
  const routeId = projection.routeId ?? '';
  return Array.from({ length: width * height }, (_, index) => ({
    x: left + index % width, y: top + Math.floor(index / width), routeId
  }));
}

function projectionRoute(state, point) {
  return typeof point?.routeId === 'string' ? point.routeId : routeOf(state, point);
}

export function illusionContains(state, projection, point) {
  return Boolean(point && projection && projectionRoute(state, projection) === projectionRoute(state, point) &&
    illusionCells(projection).some(cell => cell.x === point.x && cell.y === point.y));
}

export function illusionsAt(state, point, kind = null) {
  return [...(state.entities || []), ...(state.characters || [])].filter(projection =>
    (!kind || projection.illusion?.kind === kind) && illusionContains(state, projection, point));
}

export function illusionBlocksMonsterStep(state, monster, point) {
  if (monster?.type !== 'monster' || isIllusionCreature(monster) || isIncorporeal(monster) || monster.flying === true) return false;
  const tags = Array.isArray(monster.tags) ? monster.tags : [monster.tags];
  if (/\bfly(?:ing)?\b/i.test([monster.movement, monster.companion?.source?.movement, ...tags].join(' '))) return false;
  return illusionsAt(state, point, 'pit').length > 0;
}
