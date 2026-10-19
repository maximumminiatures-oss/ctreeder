import { hasLineOfSightFrom, isTileVisible } from './visibility.js';
import { isHiddenMonster } from './concealment.js';
import { isSleeping } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { collectLightSources, computeLightPolygon, isPointInPolygon } from './light-geometry.js';
import { visualTilePoint } from './tile-positions.js';
import { TILE_SIZE_PX } from './constants.js';
import { sameRoute } from './underpasses.js';

export function isMonsterCurrentlyVisible(state, monster, { viewer = null } = {}) {
  if (!monster || monster.defeated || monster.leftPeacefully || monster.visible === false || isHiddenMonster(monster) ||
      !state.visibility?.visibleNow || !isTileVisible(state, Number(monster.x), Number(monster.y), monster)) return false;
  if (Number.isFinite(state.lightVisualTime) && state.lightTransition && state.lightVisualTime < state.lightTransition.startedAt + 3000) {
    const point = visualTilePoint(state, monster.x, monster.y).map(value => value * TILE_SIZE_PX);
    if (!collectLightSources(state).some(source => isPointInPolygon(point, computeLightPolygon(state, source)))) return false;
  }
  const viewerIds = state.viewerCharacterIds instanceof Set ? state.viewerCharacterIds : null;
  const observers = viewer ? [viewer] : (state.characters || []).filter(character => !viewerIds || viewerIds.has(character.id));
  if (!(state.characters || []).length) return hasLineOfSightFrom(state, state.player.x, state.player.y, monster.x, monster.y, { source: state.player, target: monster });
  return observers.some(character => !isFloatingDisc(character) && !character.dead && !character.slain &&
    !isSleeping(character, state) && Number(character.hp) > 0 &&
    Number.isFinite(Number(character.x)) && Number.isFinite(Number(character.y)) &&
    sameRoute(state, character, monster) && hasLineOfSightFrom(state, Number(character.x), Number(character.y), Number(monster.x), Number(monster.y), { source: character, target: monster }));
}
