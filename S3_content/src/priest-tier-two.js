import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { castingBonus, canTouchCharacter } from './spell-effects.js';
import { canTargetAtRange } from './targeting.js';
import { equippedWeapon, protectionDisadvantage } from './faith-spells.js';
import { wizardCastingMode, spellLockRemaining } from './wizard-mishaps.js';
import { isUndeadMonster } from './crypts.js';
import { grantLuckToken } from './luck.js';
import { isFloatingDisc } from './floating-disc.js';
import { isSleeping, wakeCreature } from './conditions.js';
import { isMonsterCurrentlyVisible, isFeatureCurrentlyVisible } from './monster-perception.js';
import { normalizeLanguages, automaticMonsterLanguages, isTelepathicMonster } from './monster-languages.js';
import { normalizeSpellLookupKey } from './spells.js';
import { blocksSpellTier, isRaving } from './arcane-effects.js';
import { syncAreaSpellConditions } from './area-spells.js';

export const PRIEST_TIER_TWO_SPELLS = new Set(['augury', 'bless', 'blind deafen', 'cleansing weapon', 'smite', 'zone of truth']);
export const PRIEST_TIER_TWO_CHOICES = {
  augury: [],
  bless: [['targets', 'Two Creatures']],
  'blind deafen': [['targets', 'Two Creatures'], ['both', 'Blind and Deafen']],
  'cleansing weapon': [['duration', '10 Rounds'], ['dice', 'Double Bonus Damage Dice']],
  smite: [['double-dice', '2d6 Damage'], ['larger-die', '1d12 Damage'], ['targets', 'Two Targets'], ['range', '12-Square Range']],
  'zone of truth': [['range', '12-Square Range']]
};
export const PRIEST_TIER_TWO_DC = 12;
const FOCUS_SPELLS = new Set(['blind deafen', 'zone of truth']);
const SENSE_SOURCE = 'blind deafen';
const names = { augury: 'Augury', bless: 'Bless', 'blind deafen': 'Blind/Deafen', 'cleansing weapon': 'Cleansing Weapon', smite: 'Smite', 'zone of truth': 'Zone of Truth' };
const alive = creature => creature && !creature.dead && !creature.slain && !creature.defeated && !creature.leftPeacefully && Number(creature.hp) > 0;
const targets = state => [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')];
const findTarget = (state, id) => targets(state).find(target => target.id === id);
const success = check => check.roll !== 1 && (check.roll === 20 || check.total >= PRIEST_TIER_TWO_DC);
const turnKey = (state, caster) => state.combat?.active ? `${state.combat.round}:${caster.id}` : null;
export const isPriestTierTwoFocus = focus => Number(focus?.tier) === 2 && FOCUS_SPELLS.has(focus.spell);

function die(sides, rng = Math.random) {
  if (rng && typeof rng.nextInt === 'function') {
    const value = rng.nextInt(1, sides);
    if (!Number.isInteger(value) || value < 1 || value > sides) throw new Error('Invalid spell die roll.');
    return value;
  }
  const value = typeof rng === 'function' ? rng() : rng?.nextFloat?.();
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid spell random source.');
  return 1 + Math.min(sides - 1, Math.floor(value * sides));
}

function castingCheck(state, caster, options) {
  const modifier = abilityScoreModifier(caster.stats?.WIS) + castingBonus(caster, 'priest');
  const mode = wizardCastingMode(caster, 2, options.advantage === true,
    options.disadvantage === true || protectionDisadvantage(state, caster));
  if (options.checkRoll) return options.checkRoll(modifier, mode);
  const firstRoll = die(20, options.rng), secondaryRoll = mode.doubleRoll || mode.disadvantage ? die(20, options.rng) : null;
  const roll = secondaryRoll == null ? firstRoll : mode.disadvantage ? Math.min(firstRoll, secondaryRoll) : Math.max(firstRoll, secondaryRoll);
  return { roll, firstRoll, secondaryRoll, modifier, total: roll + modifier,
    checkMode: mode.disadvantage ? 'disadvantage' : mode.doubleRoll ? 'advantage' : 'normal' };
}

function loseSpell(caster, spell, critical) {
  caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
  if (critical) caster.spellPenance = { ...(caster.spellPenance || {}), [spell]: { paid: false } };
}

function syncSense(target, sense) {
  const conditions = target.conditions, saved = conditions?.priestTierTwoSenses?.[sense];
  if (!saved) return;
  const entries = Object.entries(saved.sources);
  if (entries.length) {
    const [focusId, casterId] = entries[0];
    conditions[sense] = { source: SENSE_SOURCE, casterId, focusId, sources: { ...saved.sources } };
  } else {
    if (conditions[sense]?.source === SENSE_SOURCE) {
      if (saved.base != null) conditions[sense] = saved.base;
      else delete conditions[sense];
    }
    delete conditions.priestTierTwoSenses[sense];
    if (!Object.keys(conditions.priestTierTwoSenses).length) delete conditions.priestTierTwoSenses;
  }
}

function applySense(target, sense, caster, focus) {
  target.conditions ||= {};
  target.conditions.priestTierTwoSenses ||= {};
  target.conditions.priestTierTwoSenses[sense] ||= { base: target.conditions[sense] ?? null, sources: {} };
  target.conditions.priestTierTwoSenses[sense].sources[focus.id] = caster.id;
  syncSense(target, sense);
}

export function endPriestTierTwoFocus(state, caster, { reason = 'ended', onFocusEnd } = {}) {
  const focus = caster.focusSpell;
  if (!isPriestTierTwoFocus(focus)) return null;
  caster.focusSpell = null;
  if (caster.pendingSpell?.focusId === focus.id) caster.pendingSpell = null;
  for (const target of targets(state)) for (const sense of ['blind', 'deaf', 'deafened']) {
    const sources = target.conditions?.priestTierTwoSenses?.[sense]?.sources;
    if (sources) { delete sources[focus.id]; syncSense(target, sense); }
  }
  syncAreaSpellConditions(state);
  onFocusEnd?.(state, caster, focus, reason);
  return { spell: focus.spell, casterId: caster.id, ended: true, reason, message: `${caster.name}'s ${names[focus.spell]} ends (${reason}).` };
}

export function cleanupPriestTierTwoFocus(state, options = {}) {
  const results = [];
  for (const caster of state.characters || []) {
    const focus = caster.focusSpell;
    if (isPriestTierTwoFocus(focus) && (!alive(caster) || isSleeping(caster, state) || isRaving(caster) || focus.spell === 'zone of truth' && state.combat?.active ||
      focus.targetIds?.length && !focus.targetIds.some(id => alive(findTarget(state, id))) && caster.pendingSpell?.focusId !== focus.id))
      results.push(endPriestTierTwoFocus(state, caster, { ...options, reason: state.combat?.active && focus.spell === 'zone of truth' ? 'combat begins' :
        !alive(caster) || isSleeping(caster, state) || isRaving(caster) ? 'caster incapacitated' : 'target unavailable' }));
    if (caster.pendingSpell?.focusId && FOCUS_SPELLS.has(caster.pendingSpell.spell) && caster.pendingSpell.focusId !== caster.focusSpell?.id) caster.pendingSpell = null;
  }
  for (const target of targets(state)) for (const sense of ['blind', 'deaf', 'deafened']) {
    const sources = target.conditions?.priestTierTwoSenses?.[sense]?.sources;
    for (const [id, casterId] of Object.entries(sources || {})) {
      const caster = (state.characters || []).find(member => member.id === casterId), focus = caster?.focusSpell;
      if (!alive(target) || !alive(caster) || !isPriestTierTwoFocus(focus) || focus.id !== id || focus.spell !== 'blind deafen' || !focus.targetIds?.includes(target.id)) delete sources[id];
    }
    syncSense(target, sense);
  }
  syncAreaSpellConditions(state);
  return results;
}

function makeFocus(state, caster, pending) {
  caster.raw ||= {};
  caster.raw.priestTierTwoSequence = (Number(caster.raw.priestTierTwoSequence) || 0) + 1;
  return { id: `priest-two-${caster.id}-${caster.raw.priestTierTwoSequence}`, spell: pending.spell, spellClass: 'priest', tier: 2,
    targetIds: [], lastCheck: pending.castingTotal, lastTurn: turnKey(state, caster), focusedRounds: 0,
    radius: pending.radius, critical: pending.critical, criticalChoice: pending.choice || null,
    senses: [], questionAvailable: false, questionOpen: false, questionsAsked: 0 };
}

export function castPriestTierTwoSpell(state, caster, key, options = {}) {
  const spell = normalizeSpellLookupKey(key);
  if (!PRIEST_TIER_TWO_SPELLS.has(spell)) throw new Error('Unknown implemented Tier 2 priest spell.');
  if (!alive(caster) || isSleeping(caster, state) || isRaving(caster) || caster.conditions?.paralyzed) throw new Error('The caster must be conscious and able to act.');
  if (caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if (spell === 'zone of truth' && isPriestTierTwoFocus(caster.focusSpell) && caster.focusSpell.spell === spell &&
      caster.focusSpell.questionAvailable && !state.combat?.active) {
    caster.focusSpell.questionOpen = true;
    return { succeeded: true, reused: true, actionCost: 0, message: 'Choose a question.' };
  }
  if ((caster.failedSpellKeys || []).includes(spell) || spellLockRemaining(caster, spell) || blocksSpellTier(caster, 2)) throw new Error('This spell is unavailable until recovery.');
  if (spell === 'zone of truth' && state.combat?.active) throw new Error('Zone of Truth can only be used outside combat.');
  if (FOCUS_SPELLS.has(spell) && caster.focusSpell) {
    if (isPriestTierTwoFocus(caster.focusSpell)) endPriestTierTwoFocus(state, caster, { ...options, reason: 'another focus spell' });
    else { const old = caster.focusSpell; caster.focusSpell = null; options.onFocusEnd?.(state, caster, old, 'another focus spell'); }
    cleanupPriestTierTwoFocus(state, options);
  }
  const check = castingCheck(state, caster, options), succeeded = success(check);
  const message = `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} ${names[spell]}: ${check.total} vs DC 12.`;
  if (!succeeded) {
    loseSpell(caster, spell, check.roll === 1);
    return { check, succeeded: false, mishaps: [], message };
  }
  const critical = check.roll === 20;
  const pending = { spell, tier: 2, phase: critical && spell !== 'augury' ? 'critical' : ['augury', 'blind deafen'].includes(spell) ? 'options' : 'targeting',
    castingTotal: check.total, critical, radius: ['bless', 'cleansing weapon'].includes(spell) ? 1 : 6,
    rounds: 5, diceCount: 1, diceSides: 6, remaining: 1, usedTargetIds: [] };
  if (FOCUS_SPELLS.has(spell)) { caster.focusSpell = makeFocus(state, caster, pending); pending.focusId = caster.focusSpell.id; }
  caster.pendingSpell = pending;
  return { check, succeeded: true, critical, message: `${message} ${pending.phase === 'critical' ? 'Choose a critical effect.' : pending.phase === 'options' ? spell === 'augury' ? 'Choose a course of action to ask about.' : 'Choose blind or deaf.' : 'Pick target.'}` };
}

function validTarget(state, caster, pending, target) {
  if (!alive(target) || isFloatingDisc(target) || pending.usedTargetIds.includes(target.id)) throw new Error('Choose a different living creature.');
  if (pending.radius === 1) {
    if (!canTouchCharacter(state, caster, target)) throw new Error('Move within touch range with no wall or closed door between you.');
  } else if (!canTargetAtRange(state, caster, target, pending.radius, { requireLight: false, directAttack: true }) ||
      !(target.type === 'monster' ? isMonsterCurrentlyVisible(state, target, { viewer: caster }) : isFeatureCurrentlyVisible(state, target, { viewer: caster }))) {
    throw new Error('Pick a visible target within range and line of sight on the same route.');
  }
}

function hasLuck(target) {
  if (Number(target.luckTokens) > 0) return true;
  if (typeof target.luckToken === 'boolean') return target.luckToken;
  if (Object.hasOwn(target, 'luckTokens')) return false;
  return target.raw?.luckToken === true || Number(target.raw?.luckTokens) > 0;
}

function sharedLanguage(caster, target) {
  if (isTelepathicMonster(caster) || isTelepathicMonster(target)) return true;
  const casterLanguages = normalizeLanguages(caster.languages ?? caster.raw?.languages).map(name => name.toLowerCase());
  const targetLanguages = normalizeLanguages(target.languages ?? target.raw?.languages ?? target.companion?.source?.languages ??
    automaticMonsterLanguages(target)).map(name => name.toLowerCase());
  return casterLanguages.some(name => targetLanguages.includes(name));
}

function answerOutcome(answer, fallback) {
  if (typeof answer === 'string') return { answer, message: answer };
  if (answer && typeof answer === 'object') return { ...answer, message: answer.message || answer.answer || fallback };
  return { requiresAnswer: true, message: fallback };
}

function askZoneQuestion(state, caster, selection, options) {
  const focus = caster.focusSpell, target = findTarget(state, focus.targetIds[0]);
  if (state.combat?.active) throw new Error('Zone of Truth can only be used outside combat.');
  if (!focus.questionAvailable) throw new Error('Maintain Focus successfully for another question.');
  if (!alive(target) || !sharedLanguage(caster, target)) throw new Error('The target must share a language with the caster.');
  validTarget(state, caster, { ...focus, usedTargetIds: [] }, target);
  const question = String(selection.question ?? selection.questionKey ?? '').trim();
  if (!question) throw new Error('Choose a question.');
  const answer = options.answerQuestion?.(state, caster, target, question, focus);
  focus.questionAvailable = false; focus.questionOpen = false; focus.questionsAsked++;
  return { ...answerOutcome(answer, 'The target must answer truthfully.'), targetId: target.id, question, questionsAsked: focus.questionsAsked,
    events: [{ type: 'truth-question', casterId: caster.id, targetId: target.id, question, answered: answer != null }] };
}

function smiteDamage(state, caster, target, pending, options) {
  const rolls = Array.from({ length: pending.diceCount }, () => die(pending.diceSides, options.rng));
  const damage = rolls.reduce((total, roll) => total + roll, 0), before = Number(target.hp);
  const context = { state, caster, spell: 'smite', damageType: 'radiant', damageSource: 'radiant', rolls, diceCount: pending.diceCount, diceSides: pending.diceSides };
  if ((state.characters || []).includes(target)) setCharacterHp(target, before - damage, { sourceId: caster.id, damageSource: 'radiant' });
  else { target.hp = Math.max(0, before - damage); wakeCreature(target, state); }
  options.onDamage?.(target, damage, context);
  let defeatHandled = Boolean(target.defeated);
  if (target.hp <= 0 && !defeatHandled && options.onDefeat) { options.onDefeat(target, context); defeatHandled = true; }
  return { targetId: target.id, damage, hpLost: before - target.hp, rolls, damageType: 'radiant', diceCount: pending.diceCount,
    diceSides: pending.diceSides, damageApplied: true, defeated: target.hp <= 0, defeatHandled,
    message: `${target.name} takes ${damage} radiant damage.` };
}

export function resolvePriestTierTwoSpell(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell;
  if (selection.dismiss && !pending && caster.focusSpell?.spell === 'zone of truth') {
    caster.focusSpell.questionOpen = false;
    return { dismissed: true, focusEnded: false, message: 'Question prompt closed. Zone of Truth remains active.' };
  }
  if ((selection.question != null || selection.questionKey != null) && caster.focusSpell?.spell === 'zone of truth' &&
      (!pending || pending.focusId !== caster.focusSpell.id)) return askZoneQuestion(state, caster, selection, options);
  if (!PRIEST_TIER_TWO_SPELLS.has(pending?.spell)) throw new Error('No Tier 2 priest spell is pending.');
  if (selection.dismiss) {
    if (pending.focusId) return endPriestTierTwoFocus(state, caster, { ...options, reason: 'dismissed' });
    caster.pendingSpell = null; return { message: 'Unused spell targeting dismissed. The casting action remains spent.' };
  }
  if (pending.phase === 'critical') {
    if (!PRIEST_TIER_TWO_CHOICES[pending.spell].some(([key]) => key === selection.choice)) throw new Error('Choose a valid critical effect.');
    pending.choice = selection.choice;
    if (selection.choice === 'targets') pending.remaining = 2;
    if (selection.choice === 'duration') pending.rounds = 10;
    if (selection.choice === 'dice' || selection.choice === 'double-dice') pending.diceCount = 2;
    if (selection.choice === 'larger-die') pending.diceSides = 12;
    if (selection.choice === 'range') pending.radius = 12;
    if (pending.focusId) Object.assign(caster.focusSpell, { radius: pending.radius, criticalChoice: selection.choice });
    pending.phase = pending.spell === 'blind deafen' && selection.choice !== 'both' ? 'options' : 'targeting';
    if (selection.choice === 'both') pending.senses = ['blind', 'deaf'];
    return { message: pending.phase === 'options' ? 'Choose blind or deaf.' : pending.remaining === 2 ? 'Pick two distinct targets.' : 'Pick target.' };
  }
  if (pending.spell === 'augury') {
    const question = String(selection.question ?? selection.questionKey ?? '').trim();
    if (!question) throw new Error('Choose a course of action to ask about.');
    const answer = options.auguryAssessment ? options.auguryAssessment(state, caster, question, pending) :
      options.answerQuestion?.(state, caster, null, question, pending);
    caster.pendingSpell = null;
    return { ...answerOutcome(answer, 'Interpret the omens for this course of action.'), question, clearerExplanation: pending.critical,
      events: [{ type: 'augury', casterId: caster.id, question, clearerExplanation: pending.critical, answered: answer != null }] };
  }
  if (pending.phase === 'options') {
    const mode = selection.mode ?? selection.option;
    if (!['blind', 'deaf'].includes(mode)) throw new Error('Choose blind or deaf.');
    pending.senses = [mode]; pending.phase = 'targeting';
    return { message: pending.remaining === 2 ? 'Pick two distinct targets.' : 'Pick target.' };
  }
  if (pending.phase !== 'targeting') throw new Error('Choose a critical effect first.');
  const target = findTarget(state, selection.targetId);
  validTarget(state, caster, pending, target);
  const hits = [], events = [];
  let message;
  if (pending.spell === 'bless') {
    if (!(state.characters || []).includes(target)) throw new Error('Choose a party member to receive a Luck Token.');
    if (hasLuck(target)) throw new Error('That character already has a Luck Token.');
    grantLuckToken(state, target.id);
    events.push({ type: 'luck', targetId: target.id, applied: true });
    message = `${target.name} gains a Luck Token.`;
  } else if (pending.spell === 'cleansing weapon') {
    const weapon = equippedWeapon(target);
    if (!weapon) throw new Error('Choose a creature with an equipped weapon.');
    weapon.cleansingWeapon = { casterId: caster.id, rounds: pending.rounds, diceCount: pending.diceCount, damageType: 'radiant', magical: true };
    message = `${target.name}'s ${weapon.name} gains Cleansing Weapon for ${pending.rounds} rounds.`;
  } else if (pending.spell === 'smite') {
    hits.push(smiteDamage(state, caster, target, pending, options)); message = hits[0].message;
  } else {
    const focus = caster.focusSpell;
    if (!isPriestTierTwoFocus(focus) || focus.id !== pending.focusId) throw new Error('The spell no longer has an active Focus.');
    if (pending.spell === 'zone of truth' && !(target.type === 'monster' || target.companion)) throw new Error('Zone of Truth requires a monster target.');
    if (pending.spell === 'zone of truth' && (state.combat?.active || !sharedLanguage(caster, target))) throw new Error('Zone of Truth requires a shared language outside combat.');
    focus.targetIds.push(target.id); focus.focusedRounds = 1;
    if (pending.spell === 'blind deafen') {
      focus.senses = [...pending.senses];
      for (const sense of focus.senses) applySense(target, sense === 'deaf' ? 'deafened' : sense, caster, focus);
      if (focus.senses.includes('deaf') && target.focusSpell) {
        options.onDistractFocus?.(target);
        events.push({ type: 'distract-focus', targetId: target.id, handled: typeof options.onDistractFocus === 'function' });
      }
      message = `${target.name} is ${focus.senses.includes('blind') ? focus.senses.includes('deaf') ? 'blinded and deafened' : 'blinded' : 'deafened'} while Focus lasts.`;
    } else { focus.questionAvailable = true; focus.questionOpen = true; message = 'Choose a question. The target must answer truthfully.'; }
  }
  pending.usedTargetIds.push(target.id); pending.remaining--;
  if (!pending.remaining) caster.pendingSpell = null;
  return { targetId: target.id, target, hits, events, remaining: pending.remaining,
    questionAvailable: caster.focusSpell?.spell === 'zone of truth' && caster.focusSpell.questionAvailable || false, message };
}

export function maintainPriestTierTwoFocus(state, caster, options = {}) {
  cleanupPriestTierTwoFocus(state, options);
  const focus = caster.focusSpell;
  if (!isPriestTierTwoFocus(focus)) return null;
  if (caster.pendingSpell?.focusId === focus.id) return { skipped: true, awaitingResolution: true, message: 'Resolve the pending spell first.' };
  const reason = options.reason || 'next round', nextRound = ['next round', 'turn'].includes(reason);
  const key = options.turnKey ?? (nextRound ? turnKey(state, caster) : null);
  if (nextRound && key != null && key === focus.lastTurn) return { skipped: true, message: 'Focus was already checked this turn.' };
  const check = castingCheck(state, caster, options), succeeded = success(check);
  if (nextRound && key != null) focus.lastTurn = key;
  if (!succeeded) {
    endPriestTierTwoFocus(state, caster, { ...options, reason: check.roll === 1 ? 'critical failure' : 'failed Focus check' });
    if (check.roll === 1) loseSpell(caster, focus.spell, true);
  } else {
    focus.lastCheck = check.total;
    if (nextRound) { focus.focusedRounds++; if (focus.spell === 'zone of truth') { focus.questionAvailable = true; focus.questionOpen = true; } }
  }
  return { check, succeeded, mishaps: [], questionAvailable: succeeded && focus.spell === 'zone of truth' && focus.questionAvailable || false,
    message: `${caster.name} Focus (${reason}): ${check.total} vs DC 12; ${succeeded ? 'maintained' : 'lost'}.` };
}

export function cleansingWeaponDice(item, target) {
  const effect = item?.cleansingWeapon;
  if (!(effect?.rounds > 0)) return '';
  const undead = isUndeadMonster(target) || isUndeadMonster(target?.companion?.source);
  return `${effect.diceCount === 2 ? 2 : 1}d${undead ? 6 : 4}`;
}

export function advancePriestTierTwoRounds(state, rounds = 1) {
  if (!Number.isInteger(rounds) || rounds < 0) throw new Error('Advance a nonnegative whole number of rounds.');
  const items = new Set();
  for (const holder of [...(state.characters || []), ...(state.entities || [])]) {
    for (const item of holder.gear || []) items.add(item);
    if (holder.gearItem) items.add(holder.gearItem);
    if (holder.characterCorpse) for (const item of holder.characterCorpse.gear || []) items.add(item);
  }
  for (const item of items) if (item.cleansingWeapon) {
    item.cleansingWeapon.rounds = Math.max(0, item.cleansingWeapon.rounds - rounds);
    if (!item.cleansingWeapon.rounds) delete item.cleansingWeapon;
  }
  return cleanupPriestTierTwoFocus(state);
}

export function advancePriestTierTwoFocus(state, rounds = 1, options = {}) {
  if (!Number.isInteger(rounds) || rounds < 0) throw new Error('Advance a nonnegative whole number of rounds.');
  const results = cleanupPriestTierTwoFocus(state, options);
  if (state.combat?.active && !options.includeCombat) return results;
  for (let round = 0; round < rounds; round++) for (const caster of state.characters || []) if (isPriestTierTwoFocus(caster.focusSpell)) {
    const outcome = maintainPriestTierTwoFocus(state, caster, { ...options,
      ...(options.turnKey != null ? { turnKey: `${options.turnKey}:${round}` } : {}) });
    if (outcome) results.push({ casterId: caster.id, ...outcome });
  }
  return results;
}

export function priestTierTwoPresentation(state, caster) {
  const pending = caster?.pendingSpell, focus = caster?.focusSpell;
  if (!PRIEST_TIER_TWO_SPELLS.has(pending?.spell)) return focus?.spell === 'zone of truth' && focus.questionAvailable && focus.questionOpen ? {
    id: `${focus.id}:question:${focus.questionsAsked}`, title: names[focus.spell], question: true, targetId: focus.targetIds[0], message: 'Choose a question.'
  } : null;
  const view = { id: `${caster.id}:${pending.spell}:${pending.phase}`, title: names[pending.spell], message: 'Pick target.' };
  if (pending.phase === 'critical') {
    view.message = 'Choose a critical effect.';
    view.choices = PRIEST_TIER_TWO_CHOICES[pending.spell].map(([key, label]) => ({ key, label }));
  }
  else if (pending.spell === 'augury') Object.assign(view, { question: true, message: 'Choose a course of action to ask about.' });
  else if (pending.phase === 'options') view.options = [{ key: 'blind', label: 'Blind' }, { key: 'deaf', label: 'Deafen' }];
  else if (pending.remaining > 1) view.message = `Pick targets (${pending.remaining} remaining).`;
  return view;
}
