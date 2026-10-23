import { isInvisible } from './concealment.js';
import { isBlind, isSleeping } from './conditions.js';
import { TILE_SIZE_PX } from './constants.js';
import { computeLightPolygon, isPointInPolygon } from './light-geometry.js';
import { getTile } from './state-schema.js';
import { withinTargetRange } from './targeting.js';
import { routeOf, sameRoute } from './underpasses.js';
import { visualTilePoint } from './tile-positions.js';
import { hasLineOfSightFrom } from './visibility.js';

export const THIEF_STEALTH_RANGES = Object.freeze({ entry: 6, reveal: 3, automaticSuccess: 6 });

// Canonical condition is conditions.deafened; older imports may use these aliases.
export const isDeafStealthObserver = creature => Boolean(creature?.conditions?.deafened ||
  creature?.conditions?.deaf || creature?.deafened || creature?.deaf);

const isBlindObserver = creature => isBlind(creature) || Boolean(creature?.conditions?.blinded ||
  creature?.blind || creature?.blinded);
const hasOrdinaryStealth = character => character?.stealthed === true ||
  character?.stealthState?.attempted === true && character.stealthState.revealed !== true;
const isThief = character => /^thief$/i.test(String(character?.className || character?.class || character?.raw?.class || '').trim());
const isAlive = creature => !creature?.dead && !creature?.slain && !creature?.defeated &&
  !creature?.leftPeacefully && !(Number(creature?.dyingRounds) > 0) &&
  !(creature?.hp != null && Number(creature.hp) <= 0);

function hasMapPosition(state, creature) {
  return Boolean(state?.map && state?.tiles && creature &&
    [creature.x, creature.y].every(value => value != null && Number.isInteger(Number(value))) &&
    getTile(state, Number(creature.x), Number(creature.y)));
}

/** Read-only geometry query. Observer descriptors include deaf monsters for automatic-success evidence. */
export function queryThiefStealthAwareness(state, character) {
  const applicable = isThief(character) && isAlive(character) && hasMapPosition(state, character);
  const inCombat = state?.combat?.active === true;
  const ordinaryStealth = hasOrdinaryStealth(character);
  const observers = [];
  let geometryPolygon;
  if (applicable) for (const monster of state.entities || []) {
    if (monster.type !== 'monster' || !isAlive(monster) || isSleeping(monster, state) ||
        isBlindObserver(monster) || !hasMapPosition(state, monster) || !sameRoute(state, monster, character) ||
        !withinTargetRange(monster, character, THIEF_STEALTH_RANGES.entry) ||
        !hasLineOfSightFrom(state, Number(monster.x), Number(monster.y), Number(character.x), Number(character.y),
          { source: monster, target: character })) continue;
    // A geometry-only polygon also catches columns and artwork contours omitted by tile LOS.
    geometryPolygon ||= computeLightPolygon(state, { x: Number(character.x), y: Number(character.y),
      routeId: routeOf(state, character), radius: THIEF_STEALTH_RANGES.entry });
    if (!isPointInPolygon(visualTilePoint(state, Number(monster.x), Number(monster.y))
      .map(value => value * TILE_SIZE_PX), geometryPolygon)) continue;
    const deafened = isDeafStealthObserver(monster);
    observers.push({ id: monster.id, monster, distance: Math.hypot(monster.x - character.x, monster.y - character.y),
      deafened, blocksEntry: !deafened,
      breaksStealth: !deafened && withinTargetRange(monster, character, THIEF_STEALTH_RANGES.reveal) });
  }
  const entryBlockingObservers = observers.filter(observer => observer.blocksEntry);
  const stealthBreakingObservers = observers.filter(observer => observer.breaksStealth);
  return {
    applicable, inCombat, ordinaryStealth, invisible: isInvisible(character),
    entryBlocked: entryBlockingObservers.length > 0,
    breakStealth: ordinaryStealth && !inCombat && stealthBreakingObservers.length > 0,
    // "Nearby" for deaf-only automatic success is the same circular six-square, clear-LOS area.
    automaticSuccess: observers.length > 0 && entryBlockingObservers.length === 0,
    observers, entryBlockingObservers, stealthBreakingObservers,
  };
}
