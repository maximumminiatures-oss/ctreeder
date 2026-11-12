import { abilityScoreModifier } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { silenceBlocksAction } from './area-spells.js';
import { canAimAtSquare } from './targeting.js';
import { hasLineOfSightFrom } from './visibility.js';
import { getTile } from './state-schema.js';
import { sameRoute, routeOf, routeExistsAt } from './underpasses.js';
import { isSleeping } from './conditions.js';
import { buildMonsterCompanion, nativeAttackLines } from './companions.js';
import { monsterModifier, moraleImmune, isDungeonMoraleSubject } from './encounters.js';
import { illusionCells, illusionContains, isIllusionCreature, illusionsAt } from './illusion-geometry.js';
import { createSpellArtTransform } from './spell-art-transform.js';

export const ILLUSION_OPTIONS = [
  ['horrible behemoth', 'Horrible Behemoth'], ['skeleton', 'Skeleton'], ['marilith', 'Marilith'],
  ['vampire', 'Vampire'], ['tyrannosaurus', 'Tyrannosaurus'], ['floor', 'Blank Floor'], ['pit', 'Illusory Pit']
];
const allProjections = state => [...(state.characters || []), ...(state.entities || [])].filter(object => object.illusion);
const alive = actor => actor && !actor.dead && !actor.slain && Number(actor.hp) > 0;
const writeRaw = (actor, key) => { if (actor.raw) actor.raw[key] = structuredClone(actor[key]); };
const title = form => ILLUSION_OPTIONS.find(([key]) => key === form)?.[1] || 'Illusion';

export function dismissIllusion(state, projection) {
  if (typeof projection === 'string') projection = allProjections(state).find(object => object.id === projection);
  if (!projection?.illusion) return false;
  state.characters = (state.characters || []).filter(object => object.id !== projection.id);
  state.entities = (state.entities || []).filter(object => object.id !== projection.id);
  const caster = state.characters.find(actor => actor.id === projection.illusion.casterId);
  if (caster?.focusSpell?.spell === 'illusion') {
    caster.focusSpell.illusionIds = caster.focusSpell.illusionIds.filter(id => id !== projection.id);
    if (!caster.focusSpell.illusionIds.length && caster.pendingSpell?.spell !== 'illusion') caster.focusSpell = null;
    writeRaw(caster, 'focusSpell');
  }
  if (state.activeCharacterId === projection.id) state.activeCharacterId = caster?.id || state.characters[0]?.id || null;
  if (state.combat?.turnOrder) {
    const combat = state.combat;
    const before = combat.turnOrder.slice(0, combat.turnIndex || 0).filter(entry => entry.id === projection.id).length;
    combat.turnOrder = combat.turnOrder.filter(entry => entry.id !== projection.id);
    combat.turnIndex = Math.max(0, (combat.turnIndex || 0) - before);
  }
  return true;
}

export function cleanupIllusions(state) {
  let changed = false;
  for (const projection of allProjections(state)) {
    const caster = (state.characters || []).find(actor => actor.id === projection.illusion.casterId);
    if (!alive(caster) || isSleeping(caster, state) || caster.conditions?.unconscious ||
        caster.focusSpell?.spell !== 'illusion' || !caster.focusSpell.illusionIds?.includes(projection.id))
      changed = dismissIllusion(state, projection) || changed;
  }
  const ids = new Set(allProjections(state).map(projection => projection.id));
  for (const caster of state.characters || []) if (caster.focusSpell?.spell === 'illusion') {
    const focus = caster.focusSpell, retained = (focus.illusionIds || []).filter(id => ids.has(id));
    if (retained.length !== focus.illusionIds?.length) { focus.illusionIds = retained; changed = true; }
    if (!retained.length && !(caster.pendingSpell?.spell === 'illusion' && caster.pendingSpell.focusId === focus.id)) {
      caster.focusSpell = null; changed = true;
    }
    writeRaw(caster, 'focusSpell');
  }
  return changed;
}

function spellCheck(state, caster, options) {
  return (options.checkRoll || options.rollCheck || rollCheck)(abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard'),
    wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage));
}
export function castIllusion(state, caster, options = {}) {
  if (caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if ((caster.failedSpellKeys || []).includes('illusion') || spellLockRemaining(caster, 'illusion') || blocksSpellTier(caster, 3))
    throw new Error('Illusion is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  caster.focusSpell = null; cleanupIllusions(state);
  const check = spellCheck(state, caster, options);
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  const result = { check, succeeded, critical: check.roll === 20, mishaps: [], privateCharacterId: caster.id,
    message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Illusion: ${check.total} vs DC 13.` };
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'illusion'])];
    if (check.roll === 1) {
      result.mishaps = rollWizardMishaps(state, caster, 'Illusion', { ...options, tier: 3 });
      result.message += ' ' + result.mishaps.map(mishap => `${mishap.name}: ${mishap.detail || ''}`).join(' ');
    }
    return result;
  }
  const focusId = `illusion-${crypto.randomUUID()}`;
  caster.focusSpell = { id: focusId, spell: 'illusion', tier: 3, castingTotal: check.total, lastCheck: check.total, illusionIds: [] };
  caster.pendingSpell = { spell: 'illusion', tier: 3, phase: 'options', focusId, remaining: result.critical ? 2 : 1,
    artTransform: createSpellArtTransform(options.artRandom) };
  return result;
}

export function maintainIllusion(state, caster, options = {}) {
  const focus = caster.focusSpell;
  if (focus?.spell !== 'illusion') return null;
  const check = spellCheck(state, caster, options), succeeded = alive(caster) && check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  let mishaps = [];
  if (!succeeded) {
    caster.focusSpell = null;
    if (caster.pendingSpell?.spell === 'illusion') caster.pendingSpell = null;
    if (check.roll === 1) {
      caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'illusion'])];
      mishaps = rollWizardMishaps(state, caster, 'Illusion', { ...options, tier: 3 });
    }
    cleanupIllusions(state);
  } else focus.castingTotal = focus.lastCheck = check.total;
  writeRaw(caster, 'focusSpell');
  return { check, succeeded, mishaps, privateCharacterId: caster.id,
    message: `${caster.name} maintains Illusion: ${check.total} vs DC 13; ${succeeded ? 'maintained' : 'lost'}.` };
}

export function illusionPlacement(state, caster, point) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'illusion' || pending.phase !== 'placement') throw new Error('Choose an illusion first.');
  if (!canAimAtSquare(state, caster, point, 12)) throw new Error('Choose a square within twelve squares and clear line of sight on the same route.');
  const size = ['horrible behemoth', 'floor', 'pit'].includes(pending.form) ? 3 : 1;
  const x = point.x - Math.floor(size / 2), y = point.y - Math.floor(size / 2), routeId = routeOf(state, caster);
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
    if (!getTile(state, xx, yy) || !routeExistsAt(state, xx, yy, routeId)) throw new Error('The complete illusion must fit on this dungeon route.');
    if (!['floor', 'pit'].includes(pending.form) && (getTile(state, xx, yy).type !== 'floor' ||
        state.entities.some(monster => monster.type === 'monster' && !monster.defeated && sameRoute(state, monster, { x: xx, y: yy, routeId }) && monster.x === xx && monster.y === yy)))
      throw new Error('Place the creature illusion on open floor, away from monsters.');
  }
  return { x, y, width: size, height: size, routeId };
}

function behemothSource() {
  return { name: 'Horrible Behemoth', level: 10, hp: 60, ac: 20, S: 4, D: 4, C: 4, I: 4, W: 4, Ch: 4, movement: 'near',
    attack: '1 acid claw +10 (5d6+20) or 1 bile spit +10 (5d6+20, far)', gear: [], languages: [] };
}
export function resolveIllusion(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'illusion') throw new Error('No Illusion is awaiting resolution.');
  if (selection.dismiss) {
    caster.pendingSpell = null;
    if (!caster.focusSpell?.illusionIds?.length) caster.focusSpell = null;
    return { privateCharacterId: caster.id, message: 'Unused illusion placements dissipate. The casting action remains spent.' };
  }
  if (pending.phase === 'options') {
    if (!ILLUSION_OPTIONS.some(([key]) => key === selection.option)) throw new Error('Choose an illusion type.');
    if (!['floor', 'pit'].includes(selection.option) && state.characters.length >= 16) throw new Error('The party has no room for a creature illusion.');
    pending.form = selection.option; pending.phase = 'placement';
    return { privateCharacterId: caster.id, message: 'Choose the illusion center, then confirm.' };
  }
  const rect = illusionPlacement(state, caster, selection);
  if (!selection.confirmed) return { privateCharacterId: caster.id, preview: { ...rect, artTransform: pending.artTransform }, requiresConfirmation: true, message: 'Confirm this placement?' };
  if (caster.focusSpell?.id !== pending.focusId) throw new Error('The caster is no longer focusing on this Illusion.');
  const id = `projection-${crypto.randomUUID()}`, form = pending.form;
  let projection;
  if (form === 'floor' || form === 'pit') {
    projection = { id, type: 'feature', subtype: 'illusion', name: title(form), ...rect, visible: true,
      illusion: { id, casterId: caster.id, kind: form, artTransform: pending.artTransform } };
    state.entities.push(projection);
  } else {
    if (state.characters.length >= 16) throw new Error('The party has no room for a creature illusion.');
    const source = form === 'horrible behemoth' ? behemothSource() : (options.monsters || []).find(monster =>
      String(monster.name).toLowerCase() === form || form === 'tyrannosaurus' && /^tyrannosaurus\b/i.test(monster.name));
    if (!source) throw new Error('That creature stat block is unavailable.');
    projection = buildMonsterCompanion({ ...structuredClone(source), id, x: selection.x, y: selection.y, routeId: rect.routeId,
      roomId: getTile(state, selection.x, selection.y)?.roomId }, { id, kind: 'illusion', controllerId: caster.id });
    projection.illusion = { id, casterId: caster.id, kind: 'creature', form, footprint: rect.width, artTransform: pending.artTransform };
    projection.ownerMemberId = caster.ownerMemberId; projection.controllerMemberId = caster.controllerMemberId;
    projection.colorId = caster.colorId; projection.colorValue = caster.colorValue;
    projection.gear = []; projection.baseAttacks = projection.attacks = nativeAttackLines(source);
    projection.movementSquares = /double\s+near/i.test(source.movement || '') ? 12 : /far/i.test(source.movement || '') ? 12 : 6;
    projection.raw = structuredClone(projection);
    state.characters.push(projection);
  }
  caster.focusSpell.illusionIds.push(id);
  pending.remaining--;
  if (pending.remaining) { pending.phase = 'options'; delete pending.form; pending.artTransform = createSpellArtTransform(options.artRandom); }
  else caster.pendingSpell = null;
  writeRaw(caster, 'focusSpell');
  const morale = [];
  if (form === 'horrible behemoth') for (const monster of state.entities.filter(monster => isDungeonMoraleSubject(state, monster) && !monster.defeated && !moraleImmune(monster) &&
      sameRoute(state, projection, monster) && Math.hypot(monster.x - projection.x, monster.y - projection.y) <= 6)) {
    const check = (options.moraleCheck || rollCheck)(monsterModifier(monster, 'W'));
    if (check.total < 15) monster.moraleFlight = { casterId: id, rounds: 5 };
    morale.push({ id: monster.id, check, fled: check.total < 15 });
  }
  return { projection, morale, privateCharacterId: caster.id,
    message: `${title(form)} appears.${morale.length ? ` ${morale.filter(result => result.fled).length} of ${morale.length} monsters flee.` : ''}` };
}

export function illusionPresentation(state, caster) {
  const pending = caster?.pendingSpell;
  if (pending?.spell !== 'illusion') return null;
  const view = { id: `${caster.id}:illusion:${pending.remaining}:${pending.form || ''}`, title: 'Illusion',
    message: pending.remaining === 2 ? 'Choose the first of two illusions.' : 'Choose an illusion.' };
  if (pending.phase === 'options') view.options = ILLUSION_OPTIONS.map(([key, label]) => ({ key, label,
    disabled: !['floor', 'pit'].includes(key) && state.characters.length >= 16 }));
  else { view.message = 'Choose the illusion center, then confirm.'; view.area = { spell: 'illusion', size: ['floor', 'pit', 'horrible behemoth'].includes(pending.form) ? 3 : 1 }; }
  return view;
}

export function syncIllusionStealth(state, options = {}) {
  const results = [];
  for (const actor of state.characters || []) {
    if (isIllusionCreature(actor)) continue;
    const previous = actor.illusionStealthIds || [];
    actor.illusionStealthIds = illusionsAt(state, actor, 'floor').map(area => area.id);
    if (previous.length && !actor.illusionStealthIds.length && alive(actor)) {
      const check = (options.checkRoll || rollCheck)(abilityScoreModifier(actor.stats?.DEX), { advantage: /thief/i.test(actor.className || '') });
      actor.stealthed = check.total >= 10; actor.stealthRoll = check;
      writeRaw(actor, 'stealthed'); writeRaw(actor, 'stealthRoll');
      results.push({ actorId: actor.id, check, message: `${actor.name} ${actor.stealthed ? 'remains hidden' : 'is no longer hidden'}.` });
    }
    writeRaw(actor, 'illusionStealthIds');
  }
  return results;
}

export function touchIllusions(state, monster) {
  const touched = allProjections(state).filter(projection => illusionContains(state, projection, monster));
  for (const projection of touched) dismissIllusion(state, projection);
  return touched;
}

export function inspectIllusion(state, monster, options = {}) {
  const projection = allProjections(state).filter(projection => (!options.ids || options.ids.includes(projection.id)) && sameRoute(state, projection, monster) &&
    Math.min(...illusionCells(projection).map(cell => Math.hypot(cell.x - monster.x, cell.y - monster.y))) <= 12 &&
    hasLineOfSightFrom(state, monster.x, monster.y, projection.x, projection.y, { source: monster, target: projection }))
    .sort((a, b) => Math.hypot(a.x - monster.x, a.y - monster.y) - Math.hypot(b.x - monster.x, b.y - monster.y))[0];
  if (!projection) return null;
  const caster = state.characters.find(actor => actor.id === projection.illusion.casterId);
  const dc = Number(caster?.focusSpell?.lastCheck || caster?.focusSpell?.castingTotal) || 13;
  const check = (options.checkRoll || rollCheck)(monsterModifier(monster, 'W'));
  const exposed = check.total >= dc;
  if (exposed) dismissIllusion(state, projection);
  return { projectionId: projection.id, check, dc, exposed,
    message: `${monster.name} inspects the illusion: ${check.total} vs DC ${dc}; ${exposed ? 'the illusion vanishes' : 'it appears real'}.` };
}

export function illusionAttack(state, actor) {
  const targets = state.entities.filter(monster => monster.type === 'monster' && !monster.defeated && !monster.leftPeacefully && sameRoute(state, actor, monster));
  const target = targets.sort((a, b) => Math.hypot(a.x - actor.x, a.y - actor.y) - Math.hypot(b.x - actor.x, b.y - actor.y))[0];
  if (!target) return { message: `${actor.name} finds no enemy to attack.` };
  const distance = Math.hypot(target.x - actor.x, target.y - actor.y);
  const attacks = nativeAttackLines(actor.companion?.source || {}).filter(line => !/spell|charm|gaze|summon/i.test(line));
  const attack = attacks.find(line => distance <= Math.SQRT2 ? /close$/.test(line) : /far$/.test(line) && distance <= 12 || /near$/.test(line) && distance <= 6);
  if (!attack || !hasLineOfSightFrom(state, actor.x, actor.y, target.x, target.y, { source: actor, target }))
    return { target, needsMovement: true, message: `${actor.name} approaches the nearest enemy.` };
  const bonus = Number(attack.match(/:\s*([+-]?\d+)/)?.[1]) || 0;
  return { target, attack, roll: { roll: 1, firstRoll: 1, modifier: bonus, total: 1 + bonus, checkMode: 'normal' },
    message: `${actor.name} attacks ${target.name.toLowerCase()} with ${attack.split(':')[0].toLowerCase()} and misses. 1d20 = 1.` };
}
