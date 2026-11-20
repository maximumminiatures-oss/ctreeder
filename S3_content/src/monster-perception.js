import { creatureObservers, creatureDarkvisionObservers, controlledCharacters, blindDungeonView } from './viewer-perception.js';
import { hasLineOfSightFrom, isTileVisible, isTilePerceived } from './visibility.js';
import { isHiddenMonster, isInvisible, isStealthed } from './concealment.js';
import { isBlind, isSleeping, isGaseousForm } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { collectLightSources, computeLightPolygon, isTileIlluminated } from './light-geometry.js';
import { TILE_SIZE_PX } from './constants.js';
import { sameRoute, routeOf } from './underpasses.js';
import { canSeeWithDarkvision, hasDarkvision, isTilePhysicallyIlluminated } from './darkvision.js';
import { isLightSuppressedAt } from './wizard-mishaps.js';
import { isShrouded } from './arcane-effects.js';
import { canSenseWithGaseousForm } from './tier-three-mobility.js';

const lineOfSight = state => (observer, target) => !isBlind(observer) && hasLineOfSightFrom(state, observer.x, observer.y, target.x, target.y,
  { source: observer, target });

export function isMonsterTileIlluminated(state, monster) {
  if (isLightSuppressedAt(state, monster.x, monster.y, monster)) return false;
  return isTileIlluminated(state, monster.x, monster.y, monster) || isTilePhysicallyIlluminated(state, monster, { sources: collectLightSources(state), tileSize: TILE_SIZE_PX,
    polygonFor: source => computeLightPolygon(state, source) });
}

export function isFeatureCurrentlyVisible(state, entity, { viewer = null } = {}) {
  if(!viewer && blindDungeonView(state))return false;
  if (!entity || entity.visible === false || entity.collected || entity.hidden === true ||
    isShrouded(state, entity.x, entity.y, entity) ||
    entity.type === 'trap' && !entity.revealed && !entity.triggered && !entity.disarmed ||
    (entity.secret || entity.isSecret) && !entity.secretFound && !entity.revealed) return false;
  const viewerIds = state.viewerCharacterIds instanceof Set ? state.viewerCharacterIds : null;
  const observers = viewer ? [viewer] : (state.characters || []).filter(character => !viewerIds || viewerIds.has(character.id));
  const canSee = lineOfSight(state);
  if (observers.some(observer => !isGaseousForm(observer) && canSeeWithDarkvision(state, observer, entity, { hasLineOfSight: canSee }))) return true;
  if (!isTilePerceived(state, entity.x, entity.y, entity) && !isMonsterTileIlluminated(state, entity)) return false;
  if (!(state.characters || []).length) return canSee(state.player, entity);
  return observers.some(observer => !isGaseousForm(observer) && !isFloatingDisc(observer) && !observer.dead && !observer.slain && Number(observer.hp) > 0 &&
    !isBlind(observer) && !isSleeping(observer, state) && sameRoute(state, observer, entity) && canSee(observer, entity) &&
    (isTileVisible(state, entity.x, entity.y, entity) || isMonsterTileIlluminated(state, entity)));
}

export function isMonsterCurrentlyVisible(state, monster, { viewer = null } = {}) {
  if (!monster || monster.defeated || monster.leftPeacefully || monster.visible === false || isHiddenMonster(monster) ||
      isShrouded(state, monster.x, monster.y, monster) ||
      !state.visibility?.visibleNow) return false;
  const viewerIds = state.viewerCharacterIds instanceof Set ? state.viewerCharacterIds : null;
  const observers = creatureObservers(state,{viewer});
  if(isStealthed(monster))return false;
  const canSee = lineOfSight(state);
  if (observers.some(observer => canSenseWithGaseousForm(state, observer, monster))) return true;
  if (creatureDarkvisionObservers(state,{viewer}).some(observer => !isGaseousForm(observer) && canSeeWithDarkvision(state, observer, monster, { hasLineOfSight: canSee }))) return true;
  let lit = isTileVisible(state, Number(monster.x), Number(monster.y), monster);
  const transitioning = Number.isFinite(state.lightVisualTime) && state.lightTransition && state.lightVisualTime < state.lightTransition.startedAt + 3000;
  if (!lit || transitioning) lit = isMonsterTileIlluminated(state, monster);
  if (!lit) return false;
  if (!(state.characters || []).length) return canSee(state.player, monster);
  return observers.some(character => !isGaseousForm(character) && !isFloatingDisc(character) && !character.dead && !character.slain &&
    !isBlind(character) && !isSleeping(character, state) && Number(character.hp) > 0 &&
    Number.isFinite(Number(character.x)) && Number.isFinite(Number(character.y)) &&
    sameRoute(state, character, monster) && hasLineOfSightFrom(state, Number(character.x), Number(character.y), Number(monster.x), Number(monster.y), { source: character, target: monster }));
}

export function monsterCanSeeTarget(state, monster, target) {
  return !isStealthed(target) && (canSenseWithGaseousForm(state, monster, target) ||
    !isGaseousForm(monster) && canSeeWithDarkvision(state, monster, target, { hasLineOfSight: lineOfSight(state) }));
}

export function monsterCanAmbush(state, monster, target, { canAttackAfterMove = () => false } = {}) {
  return !monster.defeated && !monster.leftPeacefully && isStealthed(monster) && monsterCanSeeTarget(state, monster, target) &&
    canAttackAfterMove(monster, target);
}

export function markMonsterCorrectlyGuessed(monster,state=null) {
  monster.darkGuess = { x: monster.x, y: monster.y, routeId: state ? routeOf(state,monster) : monster.routeId || '' };
}

export function shouldRepositionAfterDarkGuess(monster, { isIlluminated = () => false } = {}) {
  const intelligence = Number(monster.I ?? monster['**I**']) || 0;
  return (isStealthed(monster) || intelligence >= 0) && Boolean(monster.darkGuess) && !monster.defeated && !isSleeping(monster) &&
    (isStealthed(monster) || !isIlluminated(monster)) && monster.x === monster.darkGuess.x && monster.y === monster.darkGuess.y &&
    (monster.routeId || '') === monster.darkGuess.routeId;
}

export function darknessAttackMode(attacker, target, { isIlluminated = () => false } = {}) {
  return { advantage: !hasDarkvision(target) && !isIlluminated(attacker),
    disadvantage: !hasDarkvision(attacker) && !isIlluminated(target) };
}

export function isCreatureLocationKnown(state, creature, {viewer=null}={}) {
  if(!creature || creature.visible===false || creature.possessingId || creature.collected || creature.defeated || creature.leftPeacefully || creature.dead || creature.slain || !viewer && blindDungeonView(state))return false;
  const observers=viewer ? [viewer] : controlledCharacters(state);
  const sensed=observers.some(observer=>observer.magicDetectedIds?.includes(creature.id) && !isBlind(observer) && !isSleeping(observer,state) &&
    !observer.dead && !observer.slain && Number(observer.hp)>0 && Math.hypot(observer.x-creature.x,observer.y-creature.y)<=(observer.focusSpell?.radius || 6) && sameRoute(state,observer,creature) &&
    hasLineOfSightFrom(state,observer.x,observer.y,creature.x,creature.y,{source:observer,target:creature}));
  const guess=creature.darkGuess;
  return sensed || Boolean(guess && guess.x===creature.x && guess.y===creature.y && (guess.routeId || '')===routeOf(state,creature));
}

export function monsterHearsTarget(state,monster,target,{hasLineOfSight=(from,to)=>hasLineOfSightFrom(state,from.x,from.y,to.x,to.y,{source:from,target:to})}={}) {
  if(!monster || !target || isStealthed(target) || isSleeping(monster,state) || monster.conditions?.deaf || monster.conditions?.deafened ||
    monster.defeated || monster.leftPeacefully || target.dead || target.slain || !sameRoute(state,monster,target))return false;
  const distance=Math.hypot(target.x-monster.x,target.y-monster.y);
  return distance<=3 || distance<=6 && hasLineOfSight(monster,target);
}

export function refreshMonsterAwareness(state,monster,{canSee=(target)=>monsterCanSeeTarget(state,monster,target)}={}) {
  const remembered=monster.knownCharacterSquares ||= {};
  const current=[];
  for(const character of state.characters || []) {
    if(character.dead || character.slain) {delete remembered[character.id];continue;}
    const seen=canSee(character),heard=!seen && monsterHearsTarget(state,monster,character);
    if(!seen && !heard)continue;
    const square={id:character.id,x:character.x,y:character.y,routeId:character.routeId || '',seen,heard};
    remembered[character.id]=square;current.push(square);
  }
  return current;
}
