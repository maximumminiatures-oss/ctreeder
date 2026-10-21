import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { canTargetAtRange } from './targeting.js';
import { isHumanoid } from './wizard-tier-one.js';
import { isFloatingDisc } from './floating-disc.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { isFeatureCurrentlyVisible } from './monster-perception.js';

export const WIZARD_TIER_TWO_FOCUS = new Set(['acid arrow', 'detect thoughts', 'hold person', 'levitate', 'silence']);
export const TARGETED_TIER_TWO_FOCUS = new Set(['acid arrow', 'detect thoughts', 'hold person']);
export const WIZARD_TIER_TWO_FOCUS_CRITICAL_CHOICES = {
  'acid arrow': [['damage', '2d6 Initial and Ongoing Damage'], ['targets', 'Two Targets, 1d6 Each']],
  'detect thoughts': [['bonus', '+2 AC and Attack Against the Target']],
  'hold person': [['targets', 'Two Humanoids'], ['level', 'Humanoids up to Level 8']]
};
export const TIER_TWO_FOCUS_DC = 12;
export const isTierTwoFocus = focus => Number(focus?.tier) === 2 && WIZARD_TIER_TWO_FOCUS.has(focus.spell);
const alive = creature => creature && !creature.dead && !creature.slain && !creature.defeated && !creature.leftPeacefully &&
  !(Number(creature.dyingRounds) > 0) && Number(creature.hp) > 0;
const creatures = state => [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')];
const findTarget = (state, id) => creatures(state).find(creature => creature.id === id);
const title = spell => spell.replace(/\b\w/g, letter => letter.toUpperCase());
const passed = check => check.roll !== 1 && (check.roll === 20 || check.total >= TIER_TWO_FOCUS_DC);
const turn = (state, caster) => state.combat?.active ? `${state.combat.round}:${caster.id}` : null;

function ensureFocusId(caster, focus) {
  if (!focus.id) {
    caster.raw ||= {};
    caster.raw.tierTwoFocusSequence = (Number(caster.raw.tierTwoFocusSequence) || 0) + 1;
    focus.id = `tier-two-${caster.id}-${caster.raw.tierTwoFocusSequence}`;
  }
  return focus;
}

function syncParalysis(target) {
  const conditions = target.conditions, entries = Object.entries(conditions?.holdPersonSources || {});
  if (entries.length) {
    const [focusId, casterId] = entries[0];
    conditions.paralyzed = { source: 'hold person', casterId, focusId, sources: { ...conditions.holdPersonSources } };
  } else if (conditions?.holdPersonSources) {
    if (conditions.paralyzed?.source === 'hold person') {
      if (conditions.holdPersonBaseParalyzed != null) conditions.paralyzed = conditions.holdPersonBaseParalyzed;
      else delete conditions.paralyzed;
    }
    delete conditions.holdPersonSources;
    delete conditions.holdPersonBaseParalyzed;
  }
}

function paralyze(target, caster, focus) {
  target.conditions ||= {};
  if (!target.conditions.holdPersonSources) {
    target.conditions.holdPersonBaseParalyzed = target.conditions.paralyzed ?? null;
    target.conditions.holdPersonSources = {};
  }
  target.conditions.holdPersonSources[focus.id] = caster.id;
  syncParalysis(target);
}

function clearHeldTargets(state, casterId, focusId = null) {
  for (const target of creatures(state)) {
    for (const [id, owner] of Object.entries(target.conditions?.holdPersonSources || {})) {
      if (owner === casterId && (!focusId || id === focusId)) delete target.conditions.holdPersonSources[id];
    }
    syncParalysis(target);
  }
}

export function endWizardTierTwoFocus(state, caster, { reason = 'ended', onFocusEnd } = {}) {
  const focus = caster.focusSpell;
  if (!isTierTwoFocus(focus)) { clearHeldTargets(state, caster.id); return null; }
  caster.focusSpell = null;
  clearHeldTargets(state, caster.id, focus.id);
  if (caster.pendingSpell?.focusId === focus.id) caster.pendingSpell = focus.suspendedPendingSpell || null;
  onFocusEnd?.(state, caster, focus, reason);
  return { spell: focus.spell, ended: true, reason, message: `${caster.name}'s ${title(focus.spell)} focus ends (${reason}).` };
}

export function cleanupWizardTierTwoFocus(state, options = {}) {
  const ended = [];
  for (const caster of state.characters || []) if (isTierTwoFocus(caster.focusSpell) && !alive(caster)) {
    ended.push(endWizardTierTwoFocus(state, caster, { ...options, reason: 'caster incapacitated' }));
  }
  for (const caster of state.characters || []) if (caster.pendingSpell?.focusId &&
    WIZARD_TIER_TWO_FOCUS.has(caster.pendingSpell.spell) && caster.pendingSpell.focusId !== caster.focusSpell?.id) caster.pendingSpell = null;
  for (const target of creatures(state)) {
    for (const [focusId, casterId] of Object.entries(target.conditions?.holdPersonSources || {})) {
      const caster = (state.characters || []).find(character => character.id === casterId);
      if (!alive(caster) || caster.focusSpell?.id !== focusId || caster.focusSpell.spell !== 'hold person' ||
        !caster.focusSpell.targetIds?.includes(target.id) || !alive(target))
        delete target.conditions.holdPersonSources[focusId];
    }
    syncParalysis(target);
  }
  return ended;
}

function loseSpell(state, caster, spell, check, options) {
  caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
  if (check.roll !== 1) return [];
  return rollWizardMishaps(state, caster, spell, { ...options, tier: 2,
    knownSpells: options.knownSpells || String(caster.spellsKnown || '').split(/,\s*/),
    resolveMisfire: options.resolveMisfire || (target => {
      if (spell === 'acid arrow') {
        const hit = damageTarget(state, caster, target, 1, options);
        return { targetId: target.id, damage: hit.damage, detail: `${target.name} takes ${hit.damage} acid damage.` };
      }
      return { targetId: target.id, detail: `${title(spell)} dissipates without a valid target.` };
    }) });
}

export function wizardTierTwoFocusCheck(caster, { advantage = false, disadvantage = false, checkRoll = rollCheck } = {}) {
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  return checkRoll(modifier, wizardCastingMode(caster, 2, advantage, disadvantage));
}

function damageTarget(state, caster, target, diceCount, { random = Math.random, applyDamage, onDefeat } = {}) {
  const rolls = Array.from({ length: diceCount }, () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid acid damage roll.');
    return 1 + Math.floor(value * 6);
  });
  const damage = rolls.reduce((sum, roll) => sum + roll, 0);
  const context = { caster, spell: 'acid arrow', damageSource: 'acid', rolls, diceCount, diceSides: 6 };
  if (applyDamage) applyDamage(state, target, damage, context);
  else if ((state.characters || []).includes(target)) setCharacterHp(target, Number(target.hp) - damage, { sourceId: caster.id, damageSource: 'acid' });
  else target.hp = Math.max(0, Number(target.hp) - damage);
  if (damage > 0 && target.conditions?.sleeping) { delete target.conditions.sleeping; target.conditions.prone = true; }
  let defeatHandled = Boolean(target.defeated);
  if (Number(target.hp) <= 0 && !defeatHandled && onDefeat) { onDefeat(state, target, context); defeatHandled = true; }
  return { targetId: target.id, damage, rolls, diceCount, diceSides: 6, defeated: Number(target.hp) <= 0,
    damageApplied: true, defeatHandled, message: `${target.name} takes ${damage} acid damage (${diceCount}d6: ${rolls.join(' + ')}).` };
}

function choicesFor(spell, options) {
  return WIZARD_TIER_TWO_FOCUS_CRITICAL_CHOICES[spell] ||
    (typeof options.criticalChoices === 'function' ? options.criticalChoices(spell) : options.criticalChoices?.[spell]) || [];
}

function requestCritical(caster, focus) {
  if (caster.pendingSpell && caster.pendingSpell.focusId !== focus.id) focus.suspendedPendingSpell = caster.pendingSpell;
  caster.pendingSpell = { spell: focus.spell, phase: 'critical', focusId: focus.id, maintenance: focus.targeted !== false };
  focus.critical = true;
  focus.criticalPending = true;
}

export function castFocusedSpell(state, caster, spell, options = {}) {
  spell = String(spell).trim().toLowerCase();
  if (!TARGETED_TIER_TWO_FOCUS.has(spell)) throw new Error('This module casts Acid Arrow, Detect Thoughts, and Hold Person.');
  if (!alive(caster)) throw new Error('The caster must be conscious.');
  if (caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if ((caster.failedSpellKeys || []).includes(spell) || spellLockRemaining(caster, spell)) throw new Error('This spell is unavailable until recovery.');
  if (isTierTwoFocus(caster.focusSpell)) endWizardTierTwoFocus(state, caster, { ...options, reason: 'another focus spell' });
  else if (caster.focusSpell) { const old = caster.focusSpell; caster.focusSpell = null; options.onFocusEnd?.(state, caster, old, 'another focus spell'); }
  cleanupWizardTierTwoFocus(state, options);
  const check = wizardTierTwoFocusCheck(caster, options), succeeded = passed(check);
  const message = `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} ${title(spell)}: ${check.total} vs DC 12.`;
  if (!succeeded) return { check, succeeded, message, mishaps: loseSpell(state, caster, spell, check, options) };
  const focus = ensureFocusId(caster, { spell, tier: 2,
    radius: spell === 'acid arrow' ? 12 : 6, maxTargets: 1, targetIds: [], usedTargetIds: [], maxLevel: 4,
    damageDice: 1, focusedRounds: 0, targeted: false, critical: false, criticalChoice: null,
    lastCheck: check.total, lastTurn: turn(state, caster), luckGranted: false });
  caster.focusSpell = focus;
  if (check.roll === 20) requestCritical(caster, focus);
  else caster.pendingSpell = { spell, phase: 'targeting', focusId: focus.id, remaining: 1 };
  return { check, succeeded: true, critical: check.roll === 20, message: `${message} ${check.roll === 20 ? 'Choose a critical effect.' : 'Pick target.'}` };
}

function thoughtDialogue(target, round) {
  const text = round === 1 ? `You peer into the mind of a ${target.name} and learn some interesting stuff.` :
    round === 2 ? `You learn how this ${target.name} fights.` : `You really get this ${target.name}.`;
  return { title: 'Detect Thoughts', targetId: target.id, text };
}

function advanceEffect(state, caster, focus, options) {
  if (focus.targeted === false) return { hits: [], dialogs: [], events: [] };
  const hits = [], dialogs = [], events = [];
  focus.focusedRounds = (Number(focus.focusedRounds) || 0) + 1;
  if (focus.spell === 'acid arrow') {
    focus.targetIds = (focus.targetIds || []).filter(id => alive(findTarget(state, id)));
    for (const id of focus.targetIds) hits.push(damageTarget(state, caster, findTarget(state, id), focus.damageDice || 1, options));
    focus.targetIds = focus.targetIds.filter(id => alive(findTarget(state, id)));
    if (!focus.targetIds.length && caster.pendingSpell?.phase !== 'targeting') endWizardTierTwoFocus(state, caster, { ...options, reason: 'no living targets' });
  } else if (focus.spell === 'detect thoughts') {
    const target = findTarget(state, focus.targetIds?.[0]);
    if (!alive(target)) return { ...endWizardTierTwoFocus(state, caster, { ...options, reason: 'target unavailable' }), hits, dialogs, events };
    if (focus.focusedRounds <= 3) dialogs.push(thoughtDialogue(target, focus.focusedRounds));
    if (focus.focusedRounds === 3 && !focus.luckGranted) {
      focus.luckGranted = true;
      options.grantLuck?.(state, caster);
      events.push({ type: 'luck', casterId: caster.id, focusId: focus.id, applied: typeof options.grantLuck === 'function' });
    }
  }
  options.onFocusAdvance?.(state, caster, focus);
  return { hits, dialogs, events };
}

export function resolveFocusedSpell(state, caster, { choice, targetId, dismiss = false, ...options } = {}) {
  const pending = caster.pendingSpell, focus = caster.focusSpell;
  if (!pending || !isTierTwoFocus(focus) || pending.focusId !== focus.id) throw new Error('No Tier 2 focus spell is awaiting resolution.');
  if (dismiss) return endWizardTierTwoFocus(state, caster, { ...options, reason: 'dismissed' });
  if (pending.phase === 'critical') {
    if (!choicesFor(focus.spell, options).some(([key]) => key === choice)) throw new Error('Choose a valid critical effect.');
    if (!TARGETED_TIER_TWO_FOCUS.has(focus.spell) && typeof options.onCriticalChoice !== 'function') throw new Error('This spell needs its owning module to apply the critical effect.');
    focus.criticalChoice = choice;
    focus.criticalPending = false;
    if (focus.spell === 'acid arrow') focus.damageDice = choice === 'damage' ? 2 : 1;
    if (choice === 'targets') focus.maxTargets = 2;
    if (focus.spell === 'hold person' && choice === 'level') focus.maxLevel = 8;
    options.onCriticalChoice?.(state, caster, focus, choice);
    const remaining = TARGETED_TIER_TWO_FOCUS.has(focus.spell) ? focus.maxTargets - focus.usedTargetIds.length : 0;
    caster.pendingSpell = remaining > 0 ? { spell: focus.spell, phase: 'targeting', focusId: focus.id, remaining } : focus.suspendedPendingSpell || null;
    if (remaining <= 0) delete focus.suspendedPendingSpell;
    const effect = focus.pendingAdvance ? advanceEffect(state, caster, focus, options) : { hits: [], dialogs: [], events: [] };
    delete focus.pendingAdvance;
    return { ...effect, critical: true, message: remaining > 0 ? `Pick ${remaining === 2 ? 'two distinct targets' : 'target'}.` : 'Critical focus effect applied.' };
  }
  if (pending.phase !== 'targeting' || !TARGETED_TIER_TWO_FOCUS.has(focus.spell)) throw new Error('Choose a critical effect first.');
  const target = findTarget(state, targetId);
  if (!alive(target) || isFloatingDisc(target) || focus.usedTargetIds.includes(targetId)) throw new Error('Choose a different living target.');
  const partyHumanoid = (state.characters || []).includes(target) && !target.companion;
  if (focus.spell !== 'hold person' && target.type !== 'monster') throw new Error('Choose a monster.');
  if (focus.spell === 'hold person' && (!(partyHumanoid || isHumanoid(target) || isHumanoid(target.companion?.source || {})) ||
    Number(target.level ?? target['**LV**'] ?? 1) > focus.maxLevel)) throw new Error(`Choose a humanoid of level ${focus.maxLevel} or less.`);
  const legal = options.canTarget ? options.canTarget(target, focus.radius) :
    canTargetAtRange(state, caster, target, focus.radius, { requireLight: false, directAttack: true }) &&
      (target.type === 'monster' || isFeatureCurrentlyVisible(state, target, { viewer: caster }));
  if (!legal) throw new Error('Pick a visible target within range and line of sight on the same route.');
  focus.targetIds.push(target.id); focus.usedTargetIds.push(target.id); pending.remaining--;
  const first = !focus.targeted;
  focus.targeted = true;
  const hits = [], dialogs = [], events = [];
  if (focus.spell === 'acid arrow') hits.push(damageTarget(state, caster, target, focus.damageDice, options));
  if (focus.spell === 'hold person') paralyze(target, caster, focus);
  if (first) focus.focusedRounds = 1;
  if (focus.spell === 'detect thoughts') dialogs.push(thoughtDialogue(target, 1));
  if (!pending.remaining) { caster.pendingSpell = focus.suspendedPendingSpell || null; delete focus.suspendedPendingSpell; }
  if (focus.spell === 'acid arrow' && focus.targetIds.every(id => !alive(findTarget(state, id))) && !caster.pendingSpell)
    endWizardTierTwoFocus(state, caster, { ...options, reason: 'no living targets' });
  return { target, targetId: target.id, hits, dialogs, events, remaining: Math.max(0, pending.remaining),
    message: focus.spell === 'acid arrow' ? hits[0].message : focus.spell === 'hold person' ? `${target.name} is paralyzed while focus is maintained.` : dialogs[0].text };
}

export function maintainTierTwoFocus(state, caster, { reason = 'next round', turnKey, ...options } = {}) {
  cleanupWizardTierTwoFocus(state, options);
  const focus = caster.focusSpell;
  if (!isTierTwoFocus(focus)) return null;
  ensureFocusId(caster, focus);
  if (caster.pendingSpell?.focusId === focus.id) return { skipped: true, awaitingResolution: true, message: 'Resolve the pending focus spell first.' };
  const nextRound = reason === 'next round' || reason === 'turn';
  const key = turnKey ?? (nextRound ? turn(state, caster) : null);
  if (nextRound && key != null && focus.lastTurn === key) return { skipped: true, message: 'Focus was already checked this turn.' };
  const check = wizardTierTwoFocusCheck(caster, options), succeeded = passed(check);
  if (nextRound && key != null) focus.lastTurn = key;
  if (!succeeded) {
    endWizardTierTwoFocus(state, caster, { ...options, reason: check.roll === 1 ? 'critical failure' : 'failed focus check' });
    const mishaps = check.roll === 1 ? loseSpell(state, caster, focus.spell, check, options) : [];
    return { check, succeeded: false, mishaps, hits: [], dialogs: [], events: [], message: `${caster.name} loses ${title(focus.spell)} focus: ${check.total} vs DC 12.` };
  }
  focus.lastCheck = check.total;
  const effect = nextRound ? advanceEffect(state, caster, focus, options) : { hits: [], dialogs: [], events: [] };
  return { ...effect, check, succeeded: true, message: `${caster.name} maintains ${title(focus.spell)} focus: ${check.total} vs DC 12.` };
}

export function advanceTierTwoFocus(state, rounds = 1, options = {}) {
  const results = cleanupWizardTierTwoFocus(state, options);
  if (state.combat?.active && !options.includeCombat) return results;
  for (let round = 0; round < Math.max(0, Math.floor(rounds)); round++) {
    for (const caster of state.characters || []) if (isTierTwoFocus(caster.focusSpell)) {
      const result = maintainTierTwoFocus(state, caster, { ...options, reason: 'next round',
        ...(options.turnKey != null ? { turnKey: `${options.turnKey}:${round}` } : {}) });
      if (result) results.push({ casterId: caster.id, ...result });
    }
  }
  return results;
}

export function resolveDetectThoughtsResistance(state, monster, { checkRoll = rollCheck, turnKey, ...options } = {}) {
  if (typeof monster === 'string') monster = (state.entities || []).find(entity => entity.id === monster);
  if (!alive(monster) || monster.type !== 'monster') return [];
  const results = [];
  for (const caster of state.characters || []) {
    const focus = caster.focusSpell;
    if (!alive(caster) || !isTierTwoFocus(focus) || focus.spell !== 'detect thoughts' || !focus.targetIds?.includes(monster.id)) continue;
    const key = turnKey ?? (state.combat?.active ? `${state.combat.round}:${monster.id}` : null);
    if (key != null && focus.lastResistanceTurn === key) continue;
    if (key != null) focus.lastResistanceTurn = key;
    const check = checkRoll(Number(monster.W ?? monster['**W**']) || 0), dc = focus.lastCheck, resisted = check.total >= dc;
    if (resisted) endWizardTierTwoFocus(state, caster, { ...options, reason: 'target resists and notices the intrusion' });
    results.push({ casterId: caster.id, targetId: monster.id, check, dc, resisted, detected: resisted,
      message: `${monster.name} WIS ${check.total} vs ${dc}: ${resisted ? 'notices the intrusion; Detect Thoughts ends' : 'does not notice'}.` });
  }
  return results;
}

export function detectThoughtsModifiers(state, partyMember, monster) {
  const result = { armorClass: 0, attack: 0, damage: 0 };
  if (!(state.characters || []).some(character => character.id === partyMember?.id) || !alive(partyMember) || !alive(monster)) return result;
  for (const caster of state.characters || []) {
    const focus = caster.focusSpell;
    if (!alive(caster) || !isTierTwoFocus(focus) || focus.spell !== 'detect thoughts' || focus.focusedRounds < 2 ||
      !focus.targetIds?.includes(monster.id)) continue;
    result.armorClass = Math.max(result.armorClass, focus.criticalChoice === 'bonus' ? 2 : 1);
    result.attack = result.armorClass; result.damage = 1;
  }
  return result;
}

export const castWizardTierTwoFocus = castFocusedSpell;
export const resolveWizardTierTwoFocus = resolveFocusedSpell;
export const maintainWizardTierTwoFocus = maintainTierTwoFocus;
export const advanceWizardTierTwoFocus = advanceTierTwoFocus;
