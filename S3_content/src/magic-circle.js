import { abilityScoreModifier } from './characters.js';
import { createSpellArtTransform } from './spell-art-transform.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { silenceBlocksAction } from './area-spells.js';
import { isSleeping } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { routeOf, routeExistsAt } from './underpasses.js';
import { CREATURE_TAGS, canonicalCreatureTag, creatureMatchesTags } from './creature-tags.js';

/* Parent integration contract:
 * - Cast once (spending the action even on failure); resolve {option: tag} once
 *   or twice through magicCirclePresentation. Resolution never spends/refunds it.
 * - Route round/damage/distraction Focus and Luck replay to maintainMagicCircle.
 *   Run syncMagicCircles after normalize/load, Focus changes and dispel cleanup.
 * - Gate each movement step with canCrossCircleBoundary(state, actor, from, to),
 *   retaining routeId on both points. Gate attacks/hostile spells per target
 *   with circleBlocksHostileAction; possess/compel/beguile use circleBlocksMentalControl.
 * - activeAreaSpells/advanceAreaSpells must preserve activeMagicCircles instead
 *   of requiring rounds > 0. Merge magicCircleVisuals once, or allow the existing
 *   area visuals to include these records; template art already maps the spell.
 * - Registry: expose the area once, not a duplicate caster Focus descriptor.
 *   Its areaId lets existing whole-area dispel end the owning Focus.
 */
export const MAGIC_CIRCLE = 'magic circle';
export const MAGIC_CIRCLE_TAGS = CREATURE_TAGS;
export const MAGIC_CIRCLE_SIZE = 7;
const actors = state => [...(state.characters || []), ...(state.entities || []).filter(actor => actor.type === 'monster')];
const awake = (state, actor) => actor && !actor.dead && !actor.slain && !actor.defeated && !actor.leftPeacefully &&
  Number(actor.hp) > 0 && !isSleeping(actor, state) && !actor.conditions?.unconscious;
const saveCaster = caster => {
  if (caster.raw) for (const key of ['focusSpell', 'pendingSpell', 'failedSpellKeys'])
    caster.raw[key] = structuredClone(caster[key] ?? (key === 'failedSpellKeys' ? [] : null));
};
const saveAreas = state => { if (state.raw) state.raw.areaSpells = structuredClone(state.areaSpells || []); };
const validPoint = point => Number.isSafeInteger(point?.x) && Number.isSafeInteger(point?.y);

export function magicCircleBounds(origin) {
  if (!validPoint(origin) || ![origin.x - 3, origin.x + 4, origin.y - 3, origin.y + 4].every(Number.isSafeInteger))
    throw new Error('Magic Circle needs a valid cast location.');
  return { x: origin.x - 3, y: origin.y - 3, width: MAGIC_CIRCLE_SIZE, height: MAGIC_CIRCLE_SIZE,
    anchor: { x: origin.x, y: origin.y }, routeId: origin.routeId || '' };
}

export function activeMagicCircles(state) {
  const zones = (state.areaSpells || []).filter(zone => zone.spell === MAGIC_CIRCLE);
  if (!zones.length) return [];
  const byId = new Map(actors(state).map(actor => [actor.id, actor]));
  return zones.filter(zone => {
    if (zone.active === false || zone.ended ||
        !validPoint(zone) || !Number.isSafeInteger(zone.x + 7) || !Number.isSafeInteger(zone.y + 7) ||
        zone.width !== 7 || zone.height !== 7) return false;
    const caster = byId.get(zone.casterId), focus = caster?.focusSpell;
    return awake(state, caster) && focus?.spell === MAGIC_CIRCLE && focus.id === zone.focusId && focus.areaId === zone.id;
  });
}

export function magicCircleContains(state, circle, point) {
  return validPoint(point) && routeOf(state, point) === (circle.routeId || '') &&
    point.x >= circle.x && point.y >= circle.y && point.x < circle.x + circle.width && point.y < circle.y + circle.height;
}

// Slab intersection is constant-time even for a long jump; cell centers sit half a tile inside the perimeter.
function crossesInterior(circle, from, to) {
  let enter = 0, leave = 1;
  for (const axis of ['x', 'y']) {
    const delta = to[axis] - from[axis], low = circle[axis] - .5, high = low + MAGIC_CIRCLE_SIZE;
    if (!delta) { if (from[axis] <= low || from[axis] >= high) return false; continue; }
    const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    if (enter >= leave) return false;
  }
  return enter < leave;
}

const chosen = (circle, creature) => !creature?.illusion && !isFloatingDisc(creature) && creatureMatchesTags(creature, circle.tags);

// This only gates the magical perimeter. The caller still checks walls, pits, occupancy and each path step.
export function canCrossCircleBoundary(state, creature, from, to) {
  if (!validPoint(from) || !validPoint(to)) return false;
  for (const circle of activeMagicCircles(state).filter(circle => chosen(circle, creature))) {
    const insideFrom = magicCircleContains(state, circle, from), insideTo = magicCircleContains(state, circle, to);
    if (insideFrom !== insideTo) return false;
    if (!insideFrom && routeOf(state, from) === circle.routeId && routeOf(state, to) === circle.routeId &&
        crossesInterior(circle, from, to)) return false;
  }
  return true;
}

export function circleBlocksHostileAction(state, actor, target, { hostile = true, mentalControl = false } = {}) {
  if (!hostile && !mentalControl) return false;
  return activeMagicCircles(state).some(circle => chosen(circle, actor) &&
    routeOf(state, actor) === circle.routeId && magicCircleContains(state, circle, target));
}

// Possession, compulsion and beguiling are blocked even when not classified as hostile damage/spells.
export function circleBlocksMentalControl(state, actor, target) {
  return circleBlocksHostileAction(state, actor, target, { hostile: false, mentalControl: true });
}

export function syncMagicCircles(state) {
  const activeIds = new Set(activeMagicCircles(state).map(zone => zone.id));
  const retained = (state.areaSpells || []).filter(zone => zone.spell !== MAGIC_CIRCLE || activeIds.has(zone.id));
  let changed = retained.length !== (state.areaSpells || []).length;
  if (changed) state.areaSpells = retained;
  for (const caster of actors(state)) {
    const focus = caster.focusSpell, pending = caster.pendingSpell;
    if (focus?.spell === MAGIC_CIRCLE && (!awake(state, caster) ||
        !(focus.areaId ? activeIds.has(focus.areaId) : pending?.spell === MAGIC_CIRCLE && pending.focusId === focus.id))) {
      caster.focusSpell = null; changed = true;
    }
    if (pending?.spell === MAGIC_CIRCLE && (caster.focusSpell?.spell !== MAGIC_CIRCLE || pending.focusId !== caster.focusSpell.id)) {
      caster.pendingSpell = null; changed = true;
    }
    if (focus?.spell === MAGIC_CIRCLE || pending?.spell === MAGIC_CIRCLE) saveCaster(caster);
  }
  if (changed) saveAreas(state);
  return changed;
}
export const cleanupMagicCircles = syncMagicCircles;

export function endMagicCircle(state, caster) {
  if (caster.focusSpell?.spell === MAGIC_CIRCLE) caster.focusSpell = null;
  if (caster.pendingSpell?.spell === MAGIC_CIRCLE) caster.pendingSpell = null;
  const count = (state.areaSpells || []).length;
  state.areaSpells = (state.areaSpells || []).filter(zone => zone.spell !== MAGIC_CIRCLE || zone.casterId !== caster.id);
  saveCaster(caster); saveAreas(state);
  return count - state.areaSpells.length;
}

function spellCheck(caster, options) {
  return (options.checkRoll || options.rollCheck || rollCheck)(abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard'),
    wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage === true));
}
function loseSpell(state, caster, check, options) {
  caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), MAGIC_CIRCLE])];
  const mishaps = check.roll === 1 ? rollWizardMishaps(state, caster, 'Magic Circle', { ...options, tier: 3,
    knownSpells: options.knownSpells || String(caster.spellsKnown || '').split(/,\s*/).filter(Boolean) }) : [];
  saveCaster(caster);
  return mishaps;
}

export function castMagicCircle(state, caster, options = {}) {
  if (!awake(state, caster)) throw new Error('The caster must be conscious.');
  if (caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if (caster.failedSpellKeys?.includes(MAGIC_CIRCLE) || spellLockRemaining(caster, MAGIC_CIRCLE) || blocksSpellTier(caster, 3))
    throw new Error('Magic Circle is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  const origin = { x: caster.x, y: caster.y, routeId: routeOf(state, caster) };
  magicCircleBounds(origin);
  if (!Number.isSafeInteger(state.map?.width) || !Number.isSafeInteger(state.map?.height) ||
      origin.x < 0 || origin.y < 0 || origin.x >= state.map.width || origin.y >= state.map.height ||
      !routeExistsAt(state, origin.x, origin.y, origin.routeId)) throw new Error('Magic Circle needs a valid cast location.');
  caster.focusSpell = null; syncMagicCircles(state);
  const check = spellCheck(caster, options), succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  const result = { check, succeeded, critical: check.roll === 20, mishaps: [],
    message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Magic Circle: ${check.total} vs DC 13.` };
  if (!succeeded) { result.mishaps = loseSpell(state, caster, check, options); return result; }
  const id = `magic-circle-${crypto.randomUUID()}`;
  caster.focusSpell = { id, spell: MAGIC_CIRCLE, tier: 3, castingTotal: check.total, lastCheck: check.total, focusedRounds: 0 };
  caster.pendingSpell = { spell: MAGIC_CIRCLE, tier: 3, phase: 'options', focusId: id, origin,
    castingTotal: check.total, maxTags: result.critical ? 2 : 1, tags: [], artTransform: createSpellArtTransform(options.artRandom) };
  saveCaster(caster);
  return { ...result, message: `${result.message} Choose ${result.critical ? 'two creature tags' : 'a creature tag'}.` };
}

export function resolveMagicCircle(state, caster, selection = {}) {
  const pending = caster.pendingSpell, focus = caster.focusSpell;
  if (pending?.spell !== MAGIC_CIRCLE || focus?.spell !== MAGIC_CIRCLE || pending.focusId !== focus.id)
    throw new Error('No Magic Circle casting is pending.');
  if (!awake(state, caster)) { endMagicCircle(state, caster); throw new Error('The caster must be conscious.'); }
  if (selection.dismiss) {
    endMagicCircle(state, caster);
    return { actionCost: 0, message: 'Magic Circle dissipates. The casting action remains spent.' };
  }
  const tag = canonicalCreatureTag(selection.option ?? selection.tag);
  if (!tag || pending.tags.includes(tag)) throw new Error('Choose a different approved creature tag.');
  pending.tags.push(tag);
  if (pending.tags.length < pending.maxTags) {
    saveCaster(caster);
    return { actionCost: 0, message: 'Choose a second creature tag.' };
  }
  const zone = { ...magicCircleBounds(pending.origin), id: `area-${focus.id}`, spell: MAGIC_CIRCLE, kind: 'area',
    sourceModule: 'magic-circle', casterId: caster.id, focusId: focus.id, castingTotal: pending.castingTotal,
    color: caster.colorValue || '#ffffff', tags: [...pending.tags], artTransform: pending.artTransform };
  state.areaSpells ||= []; state.areaSpells.push(zone);
  focus.areaId = zone.id;
  caster.pendingSpell = null;
  saveCaster(caster); saveAreas(state);
  return { zone, actionCost: 0, message: 'Magic Circle takes effect at the cast location while Focus lasts.' };
}

export function maintainMagicCircle(state, caster, options = {}) {
  if (caster.focusSpell?.spell !== MAGIC_CIRCLE) return null;
  const focus = caster.focusSpell;
  if (!awake(state, caster) || silenceBlocksAction(state, caster, { spellcasting: true })) {
    endMagicCircle(state, caster);
    return { succeeded: false, mishaps: [], message: `${caster.name}'s Magic Circle ends.` };
  }
  if (focus.areaId && !activeMagicCircles(state).some(zone => zone.id === focus.areaId)) {
    syncMagicCircles(state); return null;
  }
  const check = spellCheck(caster, options), succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  let mishaps = [];
  if (succeeded) {
    focus.lastCheck = check.total;
    if (options.reason === 'next round') focus.focusedRounds = (focus.focusedRounds || 0) + 1;
    saveCaster(caster);
  } else {
    endMagicCircle(state, caster);
    if (check.roll === 1) mishaps = loseSpell(state, caster, check, options);
  }
  return { check, succeeded, mishaps,
    message: `${caster.name} ${succeeded ? 'maintains' : 'loses'} Focus on Magic Circle: ${check.total} vs DC 13.` };
}

export function magicCirclePresentation(state, caster) {
  const pending = caster?.pendingSpell;
  if (pending?.spell !== MAGIC_CIRCLE || caster.focusSpell?.id !== pending.focusId) return null;
  return { id: `${caster.id}:${pending.focusId}`, title: 'Magic Circle', phase: 'options',
    message: pending.maxTags === 2 && !pending.tags.length ? 'Choose two creature tags.' :
      pending.tags.length ? 'Choose a second creature tag.' : 'Choose a creature tag.',
    selectedTags: [...pending.tags], maxTags: pending.maxTags,
    options: MAGIC_CIRCLE_TAGS.map(([key, label]) => ({ key, label, disabled: pending.tags.includes(key) })),
    preview: { ...magicCircleBounds(pending.origin), spell: MAGIC_CIRCLE, artTransform: pending.artTransform } };
}

// Parent may merge these into area visuals; the existing template map selects mqgic-circle.png.
export function magicCircleVisuals(state, { isExplored } = {}) {
  const explored = isExplored || (point => {
    const cells = state.visibility?.routeExplored?.[point.routeId] || (!point.routeId ? state.visibility?.exploredEver : null);
    return cells instanceof Set ? cells.has(`${point.x},${point.y}`) : Array.isArray(cells) && cells.includes(`${point.x},${point.y}`);
  });
  return activeMagicCircles(state).map(zone => {
    const clipCells = [];
    for (let dy = 0; dy < MAGIC_CIRCLE_SIZE; dy++) for (let dx = 0; dx < MAGIC_CIRCLE_SIZE; dx++) {
      const point = { x: zone.x + dx, y: zone.y + dy, routeId: zone.routeId };
      if (point.x >= 0 && point.y >= 0 && point.x < state.map?.width && point.y < state.map?.height &&
          routeExistsAt(state, point.x, point.y, point.routeId) && explored(point)) clipCells.push(point);
    }
    return { id: zone.id, spell: MAGIC_CIRCLE, routeId: zone.routeId, artTransform: zone.artTransform,
      rect: { x: zone.x, y: zone.y, width: 7, height: 7 }, outlineColor: zone.color, lineWidth: 1,
      fill: '#ffffff', fillOpacity: .1, opacity: 1, exploredOnly: true, clipCells };
  });
}
