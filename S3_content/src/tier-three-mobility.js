import { abilityScoreModifier } from './characters.js';
import { canMoveBetweenTiles, rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { silenceBlocksAction } from './area-spells.js';
import { hasMobilityFlight, isGaseousForm, isSleeping } from './conditions.js';
import { getTile } from './state-schema.js';
import { routeOf, sameRoute, routeExistsAt } from './underpasses.js';
import { avoidsFalling, fallIntoPit, pitAtBottom, pitIsOpen, pitContains, pitBridgeAt } from './pits.js';
import { hasLineOfSightFrom } from './visibility.js';
import { isFloatingDisc } from './floating-disc.js';

export { isGaseousForm, hasMobilityFlight } from './conditions.js';
export const TIER_THREE_MOBILITY_SPELLS = new Set(['fly', 'gaseous form']);
export const TIER_THREE_MOBILITY_CHOICES = Object.freeze({ fly: [['duration', '10 Rounds'], ['movement', '12-Square Movement']] });
const title = spell => spell === 'fly' ? 'Fly' : 'Gaseous Form';
const alive = actor => actor && !actor.dead && !actor.slain && !actor.defeated && !actor.leftPeacefully && Number(actor.hp) > 0;
const creatures = state => [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')];
const flightEffect = actor => actor?.transformationEffects?.find(effect => effect.spell === 'fly' && effect.rounds > 0);

export const mobilityMovementSquares = actor => isGaseousForm(actor) ? 6 : flightEffect(actor)?.movementSquares || (hasMobilityFlight(actor) ? 6 : null);
export const mobilityPassesDoor = (actor, door) => isGaseousForm(actor) && door?.subtype === 'door' &&
  !door.secret && !door.isSecret && door.spell !== 'wall of force' && door.subtype !== 'wall-of-force' && !door.wallOfForce;
export const mobilityImmuneToWeb = actor => isGaseousForm(actor);
export const mobilityCanDirectlyTarget = (actor, { melee = false } = {}) => !isGaseousForm(actor) &&
  !(melee && (hasMobilityFlight(actor) || actor?.transformationEffects?.some(effect => effect.spell === 'levitate')));

export function mobilityActionBlock(actor, { spellcasting = false, weaponAttack = false, gearAction = false } = {}) {
  return isGaseousForm(actor) && (spellcasting || weaponAttack || gearAction)
    ? 'You cannot cast spells, make weapon attacks, or use gear in Gaseous Form.' : '';
}

function applyMobility(state, caster, pending) {
  const effect = { spell: pending.spell, casterId: caster.id, tier: 3, rounds: pending.rounds,
    movementSquares: pending.movementSquares, critical: Boolean(pending.critical) };
  caster.transformationEffects = [...(caster.transformationEffects || []).filter(previous => previous.spell !== effect.spell), effect];
  if (effect.spell === 'gaseous form' && caster.conditions) {
    for (const key of ['tied', 'grappled', 'restrained', 'webbed', 'webs', 'bound']) delete caster.conditions[key];
  }
  const pit = pitAtBottom(state, caster);
  if (pit) {
    caster.routeId = routeOf(state, pit);
    for (const key of ['sinkhole', 'pitLedge', 'prone']) if (caster.conditions) delete caster.conditions[key];
    syncPosition(state, caster);
  }
  caster.pendingSpell = null;
  return { effect, targetIds: [caster.id], message: `${caster.name} casts ${title(effect.spell)} for ${effect.rounds} rounds.` };
}

export function castTierThreeMobilitySpell(state, caster, spell, options = {}) {
  spell = String(spell || '').trim().toLowerCase();
  if (!TIER_THREE_MOBILITY_SPELLS.has(spell)) throw new Error('Unknown tier-three mobility spell.');
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if (!alive(caster)) throw new Error('This character cannot cast spells.');
  const actionBlock = mobilityActionBlock(caster, { spellcasting: true });
  if (actionBlock) throw new Error(actionBlock);
  if ((caster.failedSpellKeys || []).includes(spell) || spellLockRemaining(caster, spell) || blocksSpellTier(caster, 3))
    throw new Error('This spell is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  const check = (options.rollCheck || options.checkRoll || rollCheck)(modifier,
    wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage === true));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13), critical = check.roll === 20;
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
    const mishaps = check.roll === 1 ? rollWizardMishaps(state, caster, spell, { ...options, tier: 3 }) : [];
    return { check, succeeded, critical, mishaps, message: `${caster.name} fails to cast ${title(spell)}: ${check.total} vs DC 13.` };
  }
  const pending = { spell, tier: 3, phase: critical && spell === 'fly' ? 'critical' : 'self', critical,
    castingTotal: check.total, rounds: spell === 'fly' ? 5 : critical ? 20 : 10, movementSquares: 6 };
  if (pending.phase === 'critical') {
    caster.pendingSpell = pending;
    return { check, succeeded, critical, pendingSpell: pending, message: 'Choose a critical effect.' };
  }
  return { check, succeeded, critical, ...applyMobility(state, caster, pending) };
}

export function resolveTierThreeMobilitySpell(state, caster, { choice } = {}) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'fly' || pending.phase !== 'critical') throw new Error('No mobility choice is pending.');
  if (!TIER_THREE_MOBILITY_CHOICES.fly.some(([key]) => key === choice)) throw new Error('Choose a valid critical effect.');
  return applyMobility(state, caster, { ...pending, rounds: choice === 'duration' ? 10 : 5, movementSquares: choice === 'movement' ? 12 : 6 });
}

export function tierThreeMobilityPresentation(state, caster) {
  if (caster?.pendingSpell?.spell !== 'fly' || caster.pendingSpell.phase !== 'critical') return null;
  return { id: `${caster.id}:fly:`, title: 'Fly', message: 'Choose a critical effect.',
    choices: TIER_THREE_MOBILITY_CHOICES.fly.map(([key, label]) => ({ key, label })) };
}

export function canSenseWithGaseousForm(state, observer, target) {
  return Boolean(isGaseousForm(observer) && alive(observer) && !observer.dyingRounds && !isSleeping(observer, state) &&
    sameRoute(state, observer, target) && Math.hypot(target.x - observer.x, target.y - observer.y) <= 6 &&
    hasLineOfSightFrom(state, observer.x, observer.y, target.x, target.y, { source: observer, target }));
}

export function gaseousSenseCells(state) {
  const viewerIds = state.viewerCharacterIds instanceof Set ? state.viewerCharacterIds : null;
  const points = new Map();
  for (const observer of (state.characters || []).filter(actor => !viewerIds || viewerIds.has(actor.id))) {
    if (!isGaseousForm(observer)) continue;
    for (let y = Math.max(0, observer.y - 6); y <= Math.min(state.map.height - 1, observer.y + 6); y++)
      for (let x = Math.max(0, observer.x - 6); x <= Math.min(state.map.width - 1, observer.x + 6); x++) {
        const point = { x, y, routeId: routeOf(state, observer) };
        if (canSenseWithGaseousForm(state, observer, point)) points.set(`${point.routeId}|${x},${y}`, point);
      }
  }
  return [...points.values()];
}

export function mobilityLandingOccupant(state, actor, point = actor) {
  return creatures(state).find(other => other.id !== actor.id && alive(other) && !isFloatingDisc(other) && !other.illusion &&
    (other.conditions?.sinkhole || null) === (actor.conditions?.sinkhole || null) &&
    sameRoute(state, point, other) && other.x === point.x && other.y === point.y) || null;
}
export const canEndMobilityMovement = (state, actor) => !mobilityLandingOccupant(state, actor);

function syncPosition(state, actor) {
  if (state.player && state.activeCharacterId === actor.id) Object.assign(state.player,
    { x: actor.x, y: actor.y, roomId: actor.roomId ?? null, routeId: routeOf(state, actor) });
}

function fallAtPosition(state, actor, options) {
  if (avoidsFalling(actor)) return null;
  const pit = (state.entities || []).find(entity => pitIsOpen(entity) && sameRoute(state, entity, actor) &&
    pitContains(entity, actor.x, actor.y) && !pitBridgeAt(state, entity, actor));
  return pit ? fallIntoPit(state, pit, actor, options) : null;
}

// Remove the effect before calling this, including from Dispel Magic. Falling is checked before relocation.
export function resolveMobilityExpiry(state, actor, effect, options = {}) {
  if (!TIER_THREE_MOBILITY_SPELLS.has(effect?.spell)) return null;
  if (hasMobilityFlight(actor)) return { actorId: actor.id, spell: effect.spell, stillFlying: true };
  const fall = fallAtPosition(state, actor, options);
  const origin = { x: actor.x, y: actor.y, routeId: routeOf(state, actor) };
  if (!mobilityLandingOccupant(state, actor)) return { actorId: actor.id, spell: effect.spell, fall, moved: false };
  const queue = [origin], visited = new Set([`${origin.x},${origin.y}`]), free = [];
  const trappedPit = actor.conditions?.sinkhole && (state.entities || []).find(entity => entity.id === actor.conditions.sinkhole);
  const canStep = options.canStep || ((x, y, nx, ny) => canMoveBetweenTiles(state, x, y, nx, ny,
    { creature: actor, routeId: origin.routeId, ignorePits: Boolean(fall) }).ok);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const [dx, dy] of [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const point = { x: from.x + dx, y: from.y + dy, routeId: origin.routeId }, key = `${point.x},${point.y}`;
      if (visited.has(key)) continue;
      const tile = getTile(state, point.x, point.y);
      if (tile?.type !== 'floor' || trappedPit && !pitContains(trappedPit, point.x, point.y) || !routeExistsAt(state, point.x, point.y, point.routeId) ||
          !canStep(from.x, from.y, point.x, point.y, actor)) continue;
      visited.add(key);
      queue.push(point);
      if (!mobilityLandingOccupant(state, actor, point)) free.push({ ...point, roomId: tile.roomId ?? null });
    }
  }
  free.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y) || a.y - b.y || a.x - b.x);
  if (!free.length) return { actorId: actor.id, spell: effect.spell, fall, moved: false, blocked: true };
  Object.assign(actor, free[0]); syncPosition(state, actor);
  return { actorId: actor.id, spell: effect.spell, fall: fall || fallAtPosition(state, actor, options), moved: true, destination: free[0] };
}
