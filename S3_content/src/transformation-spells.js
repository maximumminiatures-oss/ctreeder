import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { canMoveBetweenTiles, rollCheck } from './interactions.js';
import { castingBonus, canTouchCharacter } from './spell-effects.js';
import { rollWizardMishaps, wizardCastingMode } from './wizard-mishaps.js';
import { getMaximumDamage, extractDamageReferences } from './damage.js';
import { isMonsterCurrentlyVisible } from './monster-perception.js';
import { hasLineOfSightFrom, isTilePerceived } from './visibility.js';
import { isTileIlluminated } from './light-geometry.js';
import { isSlowWaterTile } from './terrain-movement.js';
import { getTile } from './state-schema.js';
import { routeOf, sameRoute, routeExistsAt } from './underpasses.js';
import { pitAtBottom, safePitRim } from './pits.js';

export const TRANSFORMATION_SPELLS = new Set(['alter self', 'levitate', 'mirror image', 'misty step']);
export const ALTER_SELF_OPTIONS = Object.freeze([
  { key: 'spider-legs', label: 'Spider Legs', description: 'Cross pits and move through enemies.' },
  { key: 'goat-legs', label: 'Goat Legs', description: 'Double your movement.' },
  { key: 'claws', label: 'Claws', description: 'Two claw attacks each round, using INT to hit and dealing 1d6 damage each.' },
  { key: 'gills', label: 'Gills', description: 'Move normally in water and become invisible while in water.' },
  { key: 'cat-eyes', label: 'Cat Eyes', description: 'See in darkness for 60 feet without illuminating the dungeon.' },
  { key: 'foe-form', label: 'Foe Form', description: 'Copy a foe you can see in combat, or an illuminated foe outside combat. Gain its strongest attack and impose disadvantage on attacks from that type.' }
]);
export const TRANSFORMATION_CRITICAL_CHOICES = {
  'alter self': [['duration', '10 Rounds'], ['options', 'Two Features']],
  levitate: [['self', 'Self Only'], ['target', 'Also Levitate One Party Member Within 5 Feet']],
  'mirror image': [['duration', '10 Rounds'], ['duplicates', 'Duplicates Equal to Level']],
  'misty step': [['range', '12-Square Range']]
};
const alive = actor => actor && Number(actor.hp) > 0 && !actor.dead && !actor.slain && !actor.defeated;
const creatures = state => [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')];
const typeOf = monster => String(monster?.monsterType || monster?.companion?.source?.name ||
  (monster?.type !== 'monster' && monster?.ancestry) || monster?.name || '').trim().toLowerCase();
const effects = actor => (actor?.transformationEffects || []).filter(effect => effect.spell === 'levitate' || effect.rounds > 0);
export const transformationEffect = (actor, spell) => effects(actor).find(effect => effect.spell === spell) || null;
export const hasAlterSelfFeature = (actor, key) => Boolean(transformationEffect(actor, 'alter self')?.features?.includes(key));
const modifier = caster => abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
const randomUnit = random => { const value = random(); if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid random value.'); return value; };

export function foeFormOptions(state, caster) {
  return (state.entities || []).filter(monster => monster.type === 'monster' && alive(monster) &&
    sameRoute(state, caster, monster) && isMonsterCurrentlyVisible(state, monster) &&
    (state.combat?.active || isTileIlluminated(state, monster.x, monster.y, monster)) &&
    hasLineOfSightFrom(state, caster.x, caster.y, monster.x, monster.y, { source: caster, target: monster }));
}

export function alterSelfOptionEligible(state, caster, key) {
  return ALTER_SELF_OPTIONS.some(option => option.key === key) &&
    !caster.pendingSpell?.features?.includes(key) && (key !== 'foe-form' || foeFormOptions(state, caster).length > 0);
}

function putEffect(actor, effect) {
  if (effect.spell === 'alter self') removeEffect(actor, 'alter self');
  actor.transformationEffects = [...(actor.transformationEffects || []).filter(previous => previous.spell !== effect.spell), effect];
}
function removeEffect(actor, spell) {
  const previous = (actor.transformationEffects || []).find(effect => effect.spell === spell);
  if (spell === 'alter self' && previous?.originalAncestry != null) {
    actor.ancestry = previous.originalAncestry;
    if (actor.raw) actor.raw.ancestry = actor.ancestry;
  }
  actor.transformationEffects = (actor.transformationEffects || []).filter(effect => effect.spell !== spell);
  if (spell === 'alter self' && actor.invisibility?.source === 'alter-self-gills') delete actor.invisibility;
}

export function castTransformationSpell(state, caster, spell, options = {}) {
  if (!TRANSFORMATION_SPELLS.has(spell)) throw new Error('Unknown transformation spell.');
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if ((caster.failedSpellKeys || []).includes(spell)) throw new Error('This spell is unavailable until recovery.');
  if (spell === 'levitate') { caster.focusSpell = null; syncTransformationEffects(state); }
  const check = (options.rollCheck || options.checkRoll || rollCheck)(modifier(caster), wizardCastingMode(caster, 2, options.advantage === true, options.disadvantage === true));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 12);
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
    const mishaps = check.roll === 1 ? rollWizardMishaps(state, caster, spell, { ...options, tier: 2 }) : [];
    return { check, succeeded, mishaps, message: `${caster.name} fails to cast ${spell}: ${check.total} vs DC 12.` };
  }
  const critical = check.roll === 20;
  caster.pendingSpell = { spell, phase: critical ? 'critical' : spell === 'alter self' ? 'options' : 'targeting',
    rounds: 5, features: [], optionCount: 1, range: 6, castingTotal: check.total, critical };
  if (spell === 'mirror image' && !critical) applyMirrorImage(caster, caster.pendingSpell, options);
  if (spell === 'levitate' && !critical) applyLevitate(state, caster, [], options);
  return { check, succeeded, critical, message: critical ? 'Choose a critical effect.' : spell === 'alter self' ? 'Choose a feature.' :
    spell === 'misty step' ? 'Pick a destination square.' : `${caster.name} casts ${spell}.` };
}

function strongestAttack(monster, options) {
  const entries = options.monsterAttacks ? options.monsterAttacks(monster) : Array.isArray(monster.attacks) ? monster.attacks : String(monster.attack || '').split(/\s+\b(?:or|and)\b\s+/i);
  return entries.map(entry => {
    if (typeof entry === 'object') return { ...entry, damageExpression: entry.damageExpression || entry.damage || '' };
    const name = entry.match(/^(?:\d+\s+)?(.+?)(?:\s*\([^)]*\))?\s*[+-]\d+/)?.[1]?.trim();
    return { name: name || 'Foe attack', damageExpression: extractDamageReferences(entry)[0]?.expression || '', text: entry };
  }).filter(entry => getMaximumDamage(entry.damageExpression) > 0).sort((a, b) => getMaximumDamage(b.damageExpression) - getMaximumDamage(a.damageExpression))[0] || null;
}

function applyAlterSelf(state, caster, pending) {
  const old = transformationEffect(caster, 'alter self');
  const effect = { spell: 'alter self', rounds: pending.rounds, features: [...pending.features],
    ...(pending.foe ? { foeType: pending.foe.type, foeName: pending.foe.name, attack: pending.foe.attack,
      originalAncestry: old?.originalAncestry ?? caster.ancestry ?? '' } : {}) };
  putEffect(caster, effect);
  if (pending.foe) { caster.ancestry = pending.foe.name; if (caster.raw) caster.raw.ancestry = caster.ancestry; }
  caster.pendingSpell = null; syncTransformationEffects(state);
  return { effect, message: `${caster.name} gains ${effect.features.join(' and ')} for ${effect.rounds} rounds.` };
}

function applyMirrorImage(caster, pending, { random = Math.random } = {}) {
  const level = Math.max(1, Math.min(16, Math.floor(Number(caster.level) || 1)));
  const count = pending.choice === 'duplicates' ? level : Math.max(1, Math.floor(level / 2));
  const directions = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  for (let i = directions.length - 1; i > 0; i--) { const j = Math.floor(randomUnit(random) * (i + 1)); [directions[i], directions[j]] = [directions[j], directions[i]]; }
  const offsets = Array.from({ length: count }, (_, i) => {
    const [dx, dy] = directions[i % 8], distance = .3 * (1 + Math.floor(i / 8)), length = Math.hypot(dx, dy);
    return { dx: dx * distance / length, dy: dy * distance / length, direction: i % 8 };
  });
  const effect = { spell: 'mirror image', rounds: pending.rounds, offsets };
  putEffect(caster, effect); caster.pendingSpell = null;
  return { effect, message: `${count} mirror images surround ${caster.name}.` };
}

function levitateExit(state, target, options) {
  const pit = pitAtBottom(state, target);
  if (!pit) return null;
  const routeId = routeOf(state, pit);
  const occupied = creatures(state).some(other => other.id !== target.id && alive(other) && !other.conditions?.sinkhole &&
    routeOf(state, other) === routeId && other.x === target.x && other.y === target.y);
  const destination = occupied ? safePitRim(state, pit, target, options) : getTile(state, target.x, target.y);
  if (!destination || !routeExistsAt(state, destination.x, destination.y, routeId)) throw new Error('There is no free upper landing above this pit.');
  return { ...destination, routeId };
}
function applyLevitate(state, caster, additional, options) {
  const targets = [caster, ...additional], exits = targets.map(target => levitateExit(state, target, options));
  caster.focusSpell = { spell: 'levitate', tier: 2, targetIds: targets.map(target => target.id), critical: Boolean(caster.pendingSpell?.critical), lastCheck: caster.pendingSpell?.castingTotal };
  for (const [index, target] of targets.entries()) {
    putEffect(target, { spell: 'levitate', casterId: caster.id });
    if (exits[index]) {
      Object.assign(target, { x: exits[index].x, y: exits[index].y, roomId: exits[index].roomId ?? null, routeId: exits[index].routeId });
      for (const key of ['sinkhole', 'pitLedge', 'prone']) if (target.conditions) delete target.conditions[key];
      syncPlayerPosition(state, target);
    }
  }
  caster.pendingSpell = null;
  return { targetIds: targets.map(target => target.id), message: `${targets.map(target => target.name).join(' and ')} levitate while focus lasts.` };
}

export function resolveTransformationSpell(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell;
  if (!pending || !TRANSFORMATION_SPELLS.has(pending.spell)) throw new Error('No transformation spell is pending.');
  if (pending.phase === 'critical') {
    const { choice } = selection;
    if (!TRANSFORMATION_CRITICAL_CHOICES[pending.spell]?.some(([key]) => key === choice)) throw new Error('Choose a valid critical effect.');
    if (pending.spell === 'mirror image') return applyMirrorImage(caster, { ...pending, choice, rounds: choice === 'duration' ? 10 : 5 }, options);
    if (pending.spell === 'levitate' && choice === 'self') return applyLevitate(state, caster, [], options);
    Object.assign(pending, { choice, phase: pending.spell === 'alter self' ? 'options' : 'targeting',
      rounds: choice === 'duration' ? 10 : 5, optionCount: choice === 'options' ? 2 : 1,
      range: pending.spell === 'misty step' ? 12 : pending.range });
    return { message: pending.phase === 'options' ? 'Choose a feature.' : pending.spell === 'levitate' ? 'Pick one party member within 5 feet.' : 'Pick a destination square.' };
  }
  if (pending.spell === 'alter self') {
    if (pending.phase === 'options') {
      const key = selection.option;
      if (!alterSelfOptionEligible(state, caster, key)) throw new Error('Choose an available, different feature.');
      if (key === 'foe-form') { pending.phase = 'targeting'; return { message: 'Pick an illuminated monster you can see.' }; }
      pending.features.push(key);
    } else {
      const foe = foeFormOptions(state, caster).find(monster => monster.id === selection.targetId);
      if (!foe) throw new Error('Choose a visible foe in combat, or an illuminated foe outside combat.');
      const attack = strongestAttack(foe, options);
      if (!attack) throw new Error('That foe has no usable attack.');
      pending.foe = { type: typeOf(foe), name: foe.name, attack }; pending.features.push('foe-form');
    }
    if (pending.features.length >= pending.optionCount) return applyAlterSelf(state, caster, pending);
    pending.phase = 'options'; return { message: 'Choose a second, different feature.' };
  }
  if (pending.spell === 'levitate') {
    const target = (state.characters || []).find(character => character.id === selection.targetId);
    if (!alive(target) || target.id === caster.id || !canTouchCharacter(state, caster, target)) throw new Error('Choose another living party member within 5 feet and clear touch range.');
    return applyLevitate(state, caster, [target], options);
  }
  if (pending.spell === 'misty step') return resolveMistyStep(state, caster, selection, options);
  throw new Error('This spell is not awaiting a target.');
}

export function syncTransformationEffects(state) {
  const ended = [];
  for (const actor of creatures(state)) {
    if (!alive(actor) && actor.focusSpell?.spell === 'levitate') actor.focusSpell = null;
    for (const effect of [...(actor.transformationEffects || [])]) {
      const caster = (state.characters || []).find(candidate => candidate.id === effect.casterId);
      if (effect.spell === 'levitate' ? !alive(caster) || caster.focusSpell?.spell !== 'levitate' || !caster.focusSpell.targetIds?.includes(actor.id) : !(effect.rounds > 0)) {
        removeEffect(actor, effect.spell); ended.push({ actorId: actor.id, spell: effect.spell });
      }
    }
    const gills = transformationEffect(actor, 'alter self');
    if (hasAlterSelfFeature(actor, 'gills') && isSlowWaterTile(state, actor.x, actor.y)) {
      if (!actor.invisibility || actor.invisibility.source === 'alter-self-gills') actor.invisibility = { source: 'alter-self-gills', rounds: gills.rounds };
    } else if (actor.invisibility?.source === 'alter-self-gills') delete actor.invisibility;
  }
  return ended;
}

export function advanceTransformationRounds(state, rounds = 1) {
  if (!Number.isInteger(rounds) || rounds < 0) throw new Error('Advance a nonnegative whole number of rounds.');
  for (const actor of creatures(state)) for (const effect of actor.transformationEffects || []) if (effect.spell !== 'levitate') {
    effect.rounds -= rounds;
    if (effect.spell === 'alter self') effect.crawlRound = (Number(effect.crawlRound) || 0) + rounds;
  }
  return syncTransformationEffects(state);
}

export function maintainLevitationFocus(state, caster, options = {}) {
  if (caster.focusSpell?.spell !== 'levitate') return null;
  if (!alive(caster)) { caster.focusSpell = null; syncTransformationEffects(state); return { succeeded: false, message: 'Levitate ends.' }; }
  const check = (options.rollCheck || options.checkRoll || rollCheck)(modifier(caster), wizardCastingMode(caster, 2, options.advantage, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 12);
  let mishaps = [];
  if (!succeeded) {
    caster.focusSpell = null;
    if (check.roll === 1) {
      caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'levitate'])];
      mishaps = rollWizardMishaps(state, caster, 'levitate', { ...options, tier: 2 });
    }
  } else {
    caster.focusSpell.lastCheck = check.total;
  }
  syncTransformationEffects(state);
  return { check, succeeded, mishaps, message: `Levitate focus: ${check.total} vs DC 12; ${succeeded ? 'maintained' : 'lost'}.` };
}

export function transformationMovementRules(state, actor) {
  const levitating = Boolean(transformationEffect(actor, 'levitate'));
  return { levitating, multiplier: hasAlterSelfFeature(actor, 'goat-legs') ? 2 : 1,
    crossesPits: levitating || hasAlterSelfFeature(actor, 'spider-legs'), passesCreatures: levitating || hasAlterSelfFeature(actor, 'spider-legs'),
    ignoresWater: levitating || hasAlterSelfFeature(actor, 'gills'), ignoresFloorTraps: levitating, passesStatues: levitating,
    passesPillars: false, canPickUpGear: !levitating, canMeleeAttack: !levitating };
}
export const transformationDarkvisionRadius = actor => hasAlterSelfFeature(actor, 'cat-eyes') ? 12 : 0;
export const transformationInvisible = (state, actor) => hasAlterSelfFeature(actor, 'gills') && isSlowWaterTile(state, actor.x, actor.y);
export const transformationAttackDisadvantage = (attacker, target) => Boolean(transformationEffect(target, 'alter self')?.foeType &&
  typeOf(attacker) === transformationEffect(target, 'alter self').foeType);

export function transformationAttackOptions(state, actor, { attackBonus = abilityScoreModifier(actor.stats?.STR) } = {}) {
  if (transformationEffect(actor, 'levitate')) return [];
  const attacks = [];
  if (hasAlterSelfFeature(actor, 'claws')) attacks.push({ key: 'alter-self-claws', name: 'Claws', bonus: abilityScoreModifier(actor.stats?.INT), ability: 'INT', damageExpression: '1d6', range: 1, attacksPerRound: 2,
    remainingAttacks: remainingClawAttacks(state, actor) });
  const attack = transformationEffect(actor, 'alter self')?.attack;
  if (attack) attacks.push({ ...attack, key: 'alter-self-foe', bonus: typeof attackBonus === 'function' ? attackBonus(actor, attack) : attackBonus, attacksPerRound: 1 });
  return attacks;
}

const clawRoundKey = (state, actor, effect) => state.combat?.active ? `combat:${state.combat.round}:${actor.id}` : `crawl:${effect.crawlRound || 0}`;
export function remainingClawAttacks(state, actor) {
  const effect = transformationEffect(actor, 'alter self');
  if (!effect?.features?.includes('claws')) return 0;
  return effect.clawRoundKey === clawRoundKey(state, actor, effect) ? Math.max(0, 2 - effect.clawAttacksUsed) : 2;
}
export function spendClawAttack(state, actor) {
  if (!remainingClawAttacks(state, actor) || transformationEffect(actor, 'levitate')) throw new Error('No claw attacks remain this round.');
  const effect = transformationEffect(actor, 'alter self'), key = clawRoundKey(state, actor, effect);
  if (effect.clawRoundKey !== key) { effect.clawRoundKey = key; effect.clawAttacksUsed = 0; }
  effect.clawAttacksUsed++;
  return { remaining: remainingClawAttacks(state, actor), actionComplete: effect.clawAttacksUsed >= 2 };
}

export function interceptMirrorImageHit(state, actor, { hit = true } = {}) {
  const effect = transformationEffect(actor, 'mirror image');
  if (!hit || !effect?.offsets?.length) return { intercepted: false, remaining: effect?.offsets?.length || 0 };
  const doubled = effect.offsets.findIndex((offset, index, all) => all.some((other, otherIndex) => otherIndex !== index && other.direction === offset.direction));
  effect.offsets.splice(doubled < 0 ? 0 : doubled, 1); const remaining = effect.offsets.length;
  if (!remaining) removeEffect(actor, 'mirror image');
  return { intercepted: true, remaining, damage: 0, preventEffects: true };
}
export function interceptTransformationHit(state, actor, { hit = true, melee = false } = {}) {
  if (hit && melee && transformationEffect(actor, 'levitate')) return { intercepted: true, remaining: null, damage: 0, preventEffects: true, reason: 'levitate' };
  return interceptMirrorImageHit(state, actor, { hit });
}
export function mirrorImagePaintTokens(actor) {
  return (transformationEffect(actor, 'mirror image')?.offsets || []).map((offset, index) => ({ ...offset, id: `${actor.id}:mirror:${index}`,
    x: Number(actor.visualX ?? actor.x) + offset.dx, y: Number(actor.visualY ?? actor.y) + offset.dy,
    routeId: actor.visualRouteId ?? actor.routeId ?? '', opacity: .5, colorValue: actor.colorValue || '', colorId: actor.colorId || '' }));
}

function knownSquare(state, x, y, routeId) {
  const key = `${x},${y}`, visibility = state.visibility || {};
  const explored = state.underpasses?.length ? visibility.routeExplored?.[routeId] : visibility.exploredEver;
  return isTilePerceived(state, x, y, { x, y, routeId }) || Boolean(explored?.has(key));
}
export function validateMistyStepDestination(state, caster, { x, y, routeId = routeOf(state, caster) } = {}) {
  const range = caster.pendingSpell?.range || 6, tile = getTile(state, x, y);
  if (![caster.x, caster.y, x, y].every(Number.isInteger) || !tile || routeId !== routeOf(state, caster) ||
      !routeExistsAt(state, caster.x, caster.y, routeId) || !routeExistsAt(state, x, y, routeId) ||
      Math.hypot(x - caster.x, y - caster.y) > range + 1e-6) throw new Error('Choose an in-bounds destination within range on the same floor.');
  const occupant = creatures(state).find(actor => actor.id !== caster.id && alive(actor) && !actor.conditions?.sinkhole && sameRoute(state, caster, actor) && actor.x === x && actor.y === y && !actor.summon);
  if (occupant && occupant.type !== 'monster') throw new Error('Another party member occupies that destination.');
  const secretDoor = (state.entities || []).find(entity => entity.subtype === 'door' && entity.secret && !entity.secretFound && !entity.revealed && sameRoute(state, caster, entity) && entity.x === x && entity.y === y);
  const solid = !canMoveBetweenTiles(state, x, y, x, y, { creature: caster, routeId, ignorePits: true }).ok, known = knownSquare(state, x, y, routeId);
  const adjacentKnown = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]].some(([dx,dy]) => {
    const neighbor = getTile(state, x + dx, y + dy);
    return neighbor && knownSquare(state, x + dx, y + dy, routeId);
  });
  const risk = secretDoor ? null : solid ? 'solid' : occupant ? 'monster' : null;
  const warning = risk === 'monster' ? isMonsterCurrentlyVisible(state, occupant) : risk === 'solid' && (known || adjacentKnown);
  return { x, y, routeId, tile, occupant, secretDoor, risk, requiresConfirmation: Boolean(warning),
    prompt: warning ? risk === 'monster' ? 'teleporting into a monster will have disastrous results. Proceed?' : 'really teleport into a solid wall?' : null };
}
function syncPlayerPosition(state, caster) {
  if (state.player && state.activeCharacterId === caster.id) Object.assign(state.player, { x: caster.x, y: caster.y, roomId: caster.roomId, routeId: caster.routeId });
}
function resolveMistyStep(state, caster, selection, { random = Math.random, onLuck = actor => { actor.luckToken = true; actor.raw ||= {}; actor.raw.luckToken = true; } } = {}) {
  if (selection.confirmed != null && typeof selection.confirmed !== 'boolean') throw new Error('Teleport confirmation must be true or false.');
  const destination = validateMistyStepDestination(state, caster, selection);
  if (destination.requiresConfirmation && selection.confirmed !== true) {
    return { requiresConfirmation: true, prompt: destination.prompt, message: destination.prompt };
  }
  const rolls = destination.risk ? Array.from({ length: 8 }, () => Math.floor(randomUnit(random) * 6) + 1) : [];
  const damage = rolls.reduce((sum, roll) => sum + roll, 0);
  const monsterRolls = destination.risk && destination.occupant ? Array.from({ length: 8 }, () => Math.floor(randomUnit(random) * 6) + 1) : [];
  const monsterDamage = monsterRolls.reduce((sum, roll) => sum + roll, 0);
  if (damage) {
    setCharacterHp(caster, Number(caster.hp) - damage);
    if (destination.occupant) { destination.occupant.hp = Math.max(0, destination.occupant.hp - monsterDamage); if (destination.occupant.conditions) delete destination.occupant.conditions.sleeping; }
  }
  // Failed solid landings and a surviving occupied landing return to the origin rather than creating an illegal token overlap.
  const moved = !destination.risk || destination.risk === 'monster' && destination.occupant.hp <= 0;
  if (moved) {
    Object.assign(caster, { x: destination.x, y: destination.y, routeId: destination.routeId, roomId: destination.tile.roomId ?? null });
    for (const key of ['tied','grappled','restrained','webbed','bound','sinkhole','pitLedge']) if (caster.conditions) delete caster.conditions[key];
    syncPlayerPosition(state, caster);
    if (destination.secretDoor) onLuck(caster, destination.secretDoor);
  }
  caster.pendingSpell = null;
  return { moved, damage, rolls, monsterId: destination.occupant?.id || null, monsterDamage, monsterRolls,
    secretDoorId: destination.secretDoor?.id || null, luckGranted: Boolean(destination.secretDoor),
    message: `${caster.name} ${moved ? 'teleports' : 'cannot land there'}${damage ? `; 8d6 = (${rolls.join(' + ')}) = ${damage} damage` : ''}.` };
}
