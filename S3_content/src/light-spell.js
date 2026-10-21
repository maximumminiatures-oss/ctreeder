import { abilityScoreModifier } from './characters.js';
import { syncEquipmentLight } from './equipment.js';
import { rollCheck } from './interactions.js';
import { castingBonus, canTouchCharacter } from './spell-effects.js';
import { getTile } from './state-schema.js';
import { canAimAtSquare } from './targeting.js';
import { TORCH_DURATION_MS, lightNewTorch } from './timers.js';
import { routeOf } from './underpasses.js';
import { rollWizardMishaps, wizardCastingMode } from './wizard-mishaps.js';

export const LIGHT_TARGET_PROMPT = 'Pick target token, item, monster or blank square.';
export const LIGHT_RADIUS = 6;
export const LIGHT_TOUCH_RANGE = 1;

export function castLight(state, caster, options = {}) {
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if ((caster.failedSpellKeys || []).includes('light')) throw new Error('Light is unavailable until recovery.');
  const casterClass = /wizard/i.test(caster.className || caster.class) ? 'wizard' : /priest|cleric/i.test(caster.className || caster.class) ? 'priest' : null;
  if (!casterClass) throw new Error('Light requires a wizard or priest.');
  const modifier = abilityScoreModifier(caster.stats?.[casterClass === 'wizard' ? 'INT' : 'WIS']) + castingBonus(caster, casterClass);
  const check = (options.rollCheck || rollCheck)(modifier, wizardCastingMode(caster, 1, options.advantage === true, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 11);
  let message = `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Light: ${check.total} vs DC 11.`;
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'light'])];
    let mishaps = [];
    if (check.roll === 1) {
      if (casterClass === 'wizard') mishaps = rollWizardMishaps(state, caster, 'Light', options);
      else caster.spellPenance = { ...(caster.spellPenance || {}), light: { paid: false } };
    }
    if (mishaps.length) message += ` ${mishaps.map(mishap => `${mishap.name}: ${mishap.detail}`).join(' ')}`;
    return { check, succeeded: false, mishaps, message };
  }
  // Existing Light has no special critical choice: a natural 20 succeeds with the normal radius/timer.
  caster.pendingSpell = { spell: 'light', phase: 'targeting', radius: LIGHT_RADIUS,
    range: LIGHT_TOUCH_RANGE, critical: check.roll === 20, castingTotal: check.total };
  return { check, succeeded: true, critical: check.roll === 20, prompt: LIGHT_TARGET_PROMPT, message: `${message} ${LIGHT_TARGET_PROMPT}` };
}

export function validateLightTarget(state, caster, { targetId, characterId, gearIndex, x, y, routeId } = {}) {
  let target, point, kind;
  if (characterId != null || gearIndex != null) {
    const carrier = (state.characters || []).find(character => character.id === characterId) ||
      (state.entities || []).find(entity => entity.type === 'monster' && entity.id === characterId);
    if (!carrier || !Number.isInteger(gearIndex) || gearIndex < 0 || !carrier.gear?.[gearIndex]) throw new Error('Choose an existing carried item.');
    target = carrier.gear[gearIndex]; point = carrier; kind = 'gear';
  } else if (targetId != null) {
    target = (state.characters || []).find(character => character.id === targetId) || (state.entities || []).find(entity => entity.id === targetId);
    if (!target || target.collected || target.leftPeacefully) throw new Error('Choose an existing token or item.');
    point = target; kind = (state.characters || []).includes(target) ? 'character' : 'entity';
  } else { point = { x, y, routeId: routeId ?? routeOf(state, caster) }; kind = 'square'; }
  if (getTile(state, point.x, point.y)?.type !== 'floor' ||
      !canAimAtSquare(state, caster, point, LIGHT_TOUCH_RANGE) || !canTouchCharacter(state, caster, point))
    throw new Error('Move within clear touch range on the same floor.');
  return { target, point, kind };
}

export function resolveLight(state, caster, selection = {}) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'light' || pending.phase !== 'targeting') throw new Error('There is no Light spell awaiting a target.');
  const { target, point, kind } = validateLightTarget(state, caster, selection);
  let source = target;
  if (kind === 'square') {
    const base = `light-spell-${caster.id}`, ids = new Set((state.entities || []).map(entity => entity.id));
    let index = 1; while (ids.has(`${base}-${index}`)) index++;
    source = { id: `${base}-${index}`, type: 'feature', subtype: 'spell-light', name: 'Magical light',
      x: point.x, y: point.y, routeId: routeOf(state, point), roomId: getTile(state, point.x, point.y).roomId ?? null,
      visible: true };
    state.entities ||= []; state.entities.push(source);
  }
  source.lightSpellLit = true;
  if (kind === 'character') syncEquipmentLight(source);
  else if (kind !== 'gear') Object.assign(source, { lightSource: 'light-spell', lightRadius: LIGHT_RADIUS });
  // A successful Light uses the same global one-hour reset as the existing implementation.
  // Do this only after target validation, never on cast/reselection or an invalid target.
  lightNewTorch(state);
  const active = (state.characters || []).find(character => character.id === state.activeCharacterId) || caster;
  Object.assign(state.player, { torchLit: Number(active.lightRadius) > 0,
    lightSource: active.lightSource || '', lightRadius: Number(active.lightRadius) || 0 });
  caster.pendingSpell = null;
  return { targetId: source.id || null, kind, source, radius: LIGHT_RADIUS, actionCost: 0,
    message: `${kind === 'square' ? 'That square' : source.name || 'The target'} glows with magical light.` };
}

// Read positions from the current holder/entity each frame; never leave a duplicate light at an old position.
export function lightSpellSources(state) {
  if ((Number(state.timers?.torchElapsedMs) || 0) >= (Number(state.timers?.torchDurationMs) || TORCH_DURATION_MS)) return [];
  const sources = [];
  const add = (point, sourceId) => sources.push({ x: point.x, y: point.y, radius: LIGHT_RADIUS, routeId: routeOf(state, point), sourceId });
  for (const character of state.characters || []) {
    if (character.lightSpellLit) add(character, character.id);
    for (const [index, item] of (character.gear || []).entries()) if (item.lightSpellLit) add(character, item.instanceId || `${character.id}:gear:${index}`);
  }
  for (const entity of state.entities || []) {
    if (entity.collected || entity.leftPeacefully) continue;
    if (entity.lightSpellLit || entity.gearItem?.lightSpellLit) add(entity, entity.id);
    for (const [index, item] of (entity.gear || []).entries()) if (item.lightSpellLit) add(entity, item.instanceId || `${entity.id}:gear:${index}`);
  }
  return sources;
}
