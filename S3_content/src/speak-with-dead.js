import { abilityScoreModifier } from './characters.js';
import { canTouchCharacter, castingBonus } from './spell-effects.js';
import { rollCheck } from './interactions.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier, isRaving } from './arcane-effects.js';
import { isSleeping } from './conditions.js';
import { silenceBlocksAction } from './area-spells.js';
import { sameRoute } from './underpasses.js';
import { creatureTypeName } from './creature-names.js';
import { answerDeadQuestion, deadQuestionMenu, deadNumber } from './dead-dialogue.js';

export const SPEAK_WITH_DEAD_KEY = 'speak with dead';
export const SPEAK_WITH_DEAD_DAY_MS = 24 * 60 * 60 * 1000;
const copy = value => JSON.parse(JSON.stringify(value));
const clock = state => Math.max(0, Number(state.arcaneTime?.elapsedMs) || 0);
const corpseEntities = state => (state.entities || []).filter(entity => !entity.collected && !entity.destroyed &&
  (entity.subtype === 'corpse-loot' || entity.subtype === 'character-corpse' || entity.corpseLoot));

function intelligence(source) {
  const value = source?.I ?? source?.['**I**'] ?? source?.intelligence;
  if (value != null && value !== '' && Number.isFinite(Number(value))) return Number(value);
  const score = source?.stats?.INT ?? source?.raw?.stats?.INT;
  return score != null && Number.isFinite(Number(score)) ? abilityScoreModifier(score) : null;
}

export function speakWithDeadCorpseSource(state, corpse, options = {}) {
  if (!corpseEntities(state).includes(corpse)) return null;
  if (corpse.characterCorpse) return corpse.characterCorpse;
  if (corpse.corpseSource) return corpse.corpseSource;
  const id = corpse.sourceMonsterId;
  const source = (state.entities || []).find(entity => entity.type === 'monster' &&
    (id ? entity.id === id : entity.defeated && entity.x === corpse.x && entity.y === corpse.y && sameRoute(state, entity, corpse) &&
      creatureTypeName(entity.name) === creatureTypeName(corpse.monsterName)));
  if (source) return source;
  const catalog = options.monsters || state.monsters || state.monsterTable || [];
  const entries = catalog instanceof Map ? [...catalog.values()] : Array.isArray(catalog) ? catalog : [];
  return entries.find(entry => creatureTypeName(entry.name || entry['Monster Name']) === creatureTypeName(corpse.monsterName)) || null;
}

export function speakWithDeadTargets(state, caster, options = {}) {
  return corpseEntities(state).flatMap(corpse => {
    const source = speakWithDeadCorpseSource(state, corpse, options), modifier = intelligence(source);
    return source && modifier != null && modifier >= -2 && canTouchCharacter(state, caster, corpse) ?
      [{ key: corpse.id, label: corpse.monsterName || source.name || source['Monster Name'] || corpse.name, description: 'Touch this corpse to ask your questions.' }] : [];
  });
}

function sync(caster) {
  caster.raw ||= {};
  caster.raw.pendingSpell = caster.pendingSpell ? copy(caster.pendingSpell) : null;
  caster.raw.failedSpellKeys = [...(caster.failedSpellKeys || [])];
  caster.raw.spellPenance = copy(caster.spellPenance || {});
}

export function castSpeakWithDead(state, caster, options = {}) {
  if (!caster || caster.dead || caster.slain || Number(caster.hp) <= 0 || isSleeping(caster, state) || isRaving(caster) || caster.conditions?.paralyzed)
    throw new Error('The caster must be conscious and able to act.');
  if (caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  const className = String(options.spellClass || caster.className || caster.class || '').toLowerCase();
  const spellClass = className === 'cleric' ? 'priest' : className;
  if (!['wizard', 'priest'].includes(spellClass)) throw new Error('Speak With Dead requires a wizard or priest.');
  if ((caster.failedSpellKeys || []).includes(SPEAK_WITH_DEAD_KEY) || spellLockRemaining(caster, SPEAK_WITH_DEAD_KEY) || blocksSpellTier(caster, 3))
    throw new Error('Speak With Dead is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  if (!speakWithDeadTargets(state, caster, options).length) throw new Error('Touch a corpse with an Intelligence modifier of at least -2.');
  caster.raw ||= {};
  const now = clock(state), previous = (caster.raw.speakWithDeadCastTimes || []).filter(time => Number.isFinite(time) && time <= now && now - time < SPEAK_WITH_DEAD_DAY_MS);
  const modifier = abilityScoreModifier(caster.stats?.[spellClass === 'wizard' ? 'INT' : 'WIS']) + castingBonus(caster, spellClass);
  const mode = wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage === true);
  const check = (options.checkRoll || options.rollCheck || rollCheck)(modifier, mode);
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  const criticalFailure = !succeeded && (check.roll === 1 || previous.length > 0);
  caster.raw.speakWithDeadCastTimes = [...previous, now];
  const result = { check, succeeded, critical: succeeded && check.roll === 20, criticalFailure, repeated: previous.length > 0,
    spellClass, tier: 3, mishaps: [], message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Speak With Dead: ${check.total} vs DC 13.` };
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), SPEAK_WITH_DEAD_KEY])];
    if (criticalFailure && spellClass === 'priest') caster.spellPenance = { ...(caster.spellPenance || {}), [SPEAK_WITH_DEAD_KEY]: { paid: false } };
    if (criticalFailure && spellClass === 'wizard') result.mishaps = (options.rollMishaps || rollWizardMishaps)(state, caster, 'Speak With Dead', { ...options, tier: 3 });
    if (criticalFailure) result.message += ' The failed casting is a critical failure.';
    sync(caster);
    return result;
  }
  caster.pendingSpell = { spell: SPEAK_WITH_DEAD_KEY, tier: 3, spellClass, phase: 'targeting', radius: 1,
    critical: result.critical, castingTotal: check.total, questionsTotal: result.critical ? 6 : 3, questionsAsked: 0,
    castAtMs: now, monsterTypes: [], treasureCategories: [], answers: [] };
  sync(caster);
  return { ...result, message: `${result.message} Pick a corpse within touch range.` };
}

export function resolveSpeakWithDead(state, caster, selection = {}, options = {}) {
  const pending = caster?.pendingSpell;
  if (pending?.spell !== SPEAK_WITH_DEAD_KEY) throw new Error('No Speak With Dead is pending.');
  if (selection.dismiss || selection.option === '__finish__') {
    caster.pendingSpell = null; sync(caster);
    return { dismissed: true, actionCost: 0, message: 'Speak With Dead ends. The casting action remains spent.' };
  }
  if (pending.phase === 'complete') throw new Error('All questions have been asked.');
  if (pending.phase === 'targeting') {
    const target = speakWithDeadTargets(state, caster, options).find(entry => entry.key === selection.targetId);
    if (!target) throw new Error('Choose a valid corpse within touch range on the same route.');
    const corpse = corpseEntities(state).find(entity => entity.id === target.key);
    const source = speakWithDeadCorpseSource(state, corpse, options);
    pending.targetId = corpse.id;
    pending.corpseName = corpse.characterCorpse?.name || source.uniqueName || source.properName ||
      creatureTypeName(corpse.monsterName || source.name || source['Monster Name'] || corpse.name.replace(/^dead\s+/i, ''));
    pending.phase = 'questions'; sync(caster);
    return { targetId: pending.targetId, message: `You may ask the dead ${pending.corpseName} ${deadNumber(pending.questionsTotal)} questions.` };
  }
  if (pending.phase !== 'questions' || !pending.targetId) throw new Error('Pick a corpse before asking a question.');
  const corpse = corpseEntities(state).find(entity => entity.id === pending.targetId);
  if (!corpse || !speakWithDeadTargets(state, caster, options).some(entry => entry.key === pending.targetId))
    throw new Error('The corpse is no longer available within touch range.');
  if (pending.questionsAsked >= pending.questionsTotal) throw new Error('All questions have been asked.');
  const key = selection.option ?? selection.question ?? selection.questionKey;
  const answer = answerDeadQuestion(state, pending, key, options);
  pending.questionsAsked++;
  pending.lastAnswer = answer.reply;
  pending.answers.push({ question: answer.question, answer: answer.reply });
  if (pending.questionsAsked === pending.questionsTotal) pending.phase = 'complete';
  sync(caster);
  return { ...answer, targetId: pending.targetId, questionsAsked: pending.questionsAsked, questionsRemaining: pending.questionsTotal - pending.questionsAsked,
    complete: pending.phase === 'complete', actionCost: 0,
    events: [{ type: 'speak-with-dead-question', casterId: caster.id, targetId: pending.targetId, question: answer.question }] };
}

export function speakWithDeadPresentation(state, caster, options = {}) {
  const pending = caster?.pendingSpell;
  if (pending?.spell !== SPEAK_WITH_DEAD_KEY) return null;
  const view = { id: `${caster.id}:speak-with-dead:${pending.castAtMs}`, title: 'Speak With Dead',
    message: 'Pick a corpse within touch range.', detail: pending.lastAnswer || '' };
  if (pending.phase === 'targeting') view.targets = speakWithDeadTargets(state, caster, options);
  else {
    view.title = `You may ask the dead ${pending.corpseName} ${deadNumber(pending.questionsTotal)} questions.`;
    view.message = pending.phase === 'complete' ? 'All questions have been answered.' :
      `${deadNumber(pending.questionsTotal - pending.questionsAsked)[0].toUpperCase()}${deadNumber(pending.questionsTotal - pending.questionsAsked).slice(1)} questions remain.`;
    view.options = pending.phase === 'complete' ? [] : deadQuestionMenu(state, pending);
    view.options.push({ key: '__finish__', label: 'Finish' });
  }
  return view;
}
