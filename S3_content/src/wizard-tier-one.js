import { abilityScoreModifier } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps } from './wizard-mishaps.js';
import { canTargetAtRange } from './targeting.js';
import { blocksMindControl } from './faith-spells.js';
import { isMagicItem, identifyMagicItem } from './magic-items.js';
import { isMimic, isDoppelganger } from './companions.js';
import { createFloatingDiscs, floatingDiscSlotsAvailable } from './floating-disc.js';
import { holdDoor, releaseSleep } from './control-spells.js';

export const WIZARD_TIER_ONE = new Set(['charm person', 'detect magic', 'feather fall', 'alarm', 'floating disc', 'mage armor', 'hold portal', 'sleep']);
export const WIZARD_CRITICAL_CHOICES = {
  'charm person': [['duration', '2d8 Days'], ['targets', 'Two Humanoids'], ['level', 'Humanoids up to Level 4']],
  'detect magic': [['range', '12-Square Range'], ['properties', 'Discern Properties Immediately']],
  'floating disc': [['two-discs', 'Two Floating Discs'], ['duration', 'Two-Hour Duration']],
  'hold portal': [['duration', '20 Rounds'], ['targets', 'Two Doors'], ['range', '12-Square Range']],
  'sleep': [['level', 'Living Creatures up to Level 4'], ['area', '13 by 13 Squares']]
};
export const isHumanoid = creature => (creature.tags || []).some(tag => /^humanoid$/i.test(tag)) ||
  /\b(?:acolyte|apprentice|bandit|thief|assassin|peasant|pirate|human|elf|dwarf|goblin|orc|halfling|drow|duergar|knight|guard|cultist|wizard|priest|soldier|merchant)\b/i.test(creature.name || '');
const modifier = caster => abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
const passed = check => check.roll !== 1 && (check.roll === 20 || check.total >= 11);
const die = random => Math.floor(random() * 8) + 1;
export const mageArmorEffect = character => (character?.wizardEffects || []).find(effect =>
  effect.type === 'mage-armor' && effect.rounds > 0 && [14, 18].includes(effect.armorClass)) || null;

export function wizardSpellCheck(state, caster, spell, { advantage = false, disadvantage = false, checkRoll = rollCheck } = {}) {
  const check = checkRoll(modifier(caster), wizardCastingMode(caster, 1, advantage, disadvantage));
  const succeeded = passed(check);
  let mishaps = [];
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
    if (check.roll === 1) mishaps = rollWizardMishaps(state, caster, spell, {
      knownSpells: String(caster.spellsKnown || '').split(/,\s*/),
      resolveMisfire: target => ({ targetId: target.id, detail: `${spell} dissipates without a valid target.` })
    });
  }
  return { check, succeeded, mishaps, message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} ${spell.replace(/\b\w/g, c => c.toUpperCase())}: 1d20 = (${check.roll}) ${check.modifier >= 0 ? '+' : ''}${check.modifier} = ${check.total} vs DC 11.` };
}

export function castWizardTierOne(state, caster, spell, options = {}) {
  if (!WIZARD_TIER_ONE.has(spell)) throw new Error('Unknown implemented wizard spell.');
  if (caster.pendingSpell && spell !== 'feather fall') throw new Error('Resolve the pending spell first.');
  if ((caster.failedSpellKeys || []).includes(spell)) throw new Error('This spell is unavailable until recovery.');
  if (spell === 'feather fall' && !caster.pendingFall) throw new Error('Feather Fall can be cast when this character is falling.');
  if (spell === 'floating disc' && !floatingDiscSlotsAvailable(state)) throw new Error('The party is full. Floating Disc needs a free party slot.');
  if (spell === 'alarm' && (state.combat?.active || state.rest?.phase === 'sleeping')) throw new Error('Cast Alarm while preparing rest, outside combat.');
  if (spell === 'detect magic') caster.focusSpell = null;
  const result = wizardSpellCheck(state, caster, spell, options);
  if (!result.succeeded) return result;
  if (spell === 'hold portal' || spell === 'sleep') {
    caster.pendingSpell = { spell, phase: result.check.roll === 20 ? 'critical' : 'targeting',
      radius: 6, remaining: 1, rounds: 10, castingTotal: result.check.total, usedTargetIds: [], size: 7, maxLevel: 2 };
    if (spell === 'sleep' && result.check.roll !== 20) {
      const effect = releaseSleep(state, caster);
      return { ...result, ...effect, message: `${result.message} ${effect.message}` };
    }
    return { ...result, message: `${result.message} ${result.check.roll === 20 ? 'Choose a critical effect.' : 'Pick a door.'}` };
  }
  if (spell === 'mage armor') {
    const armorClass = result.check.roll === 20 ? 18 : 14;
    caster.wizardEffects = (caster.wizardEffects || []).filter(effect => effect.type !== 'mage-armor');
    caster.wizardEffects.push({ type: 'mage-armor', armorClass, rounds: 10 });
    return { ...result, message: `${result.message} ${caster.name}'s AC becomes ${armorClass} for 10 rounds.` };
  }
  if (spell === 'alarm') {
    const alarm = { casterId: caster.id, roomId: caster.roomId, encounterDivisor: result.check.roll === 20 ? 4 : 2 };
    const existing = state.rest?.phase === 'voting' ? state.rest.alarm : state.preparedAlarm;
    const chosen = existing?.roomId === alarm.roomId && existing.encounterDivisor > alarm.encounterDivisor ? existing : alarm;
    if (state.rest?.phase === 'voting') state.rest.alarm = chosen;
    else state.preparedAlarm = chosen;
    return { ...result, message: `${result.message} The party cannot be surprised during this rest; wandering monster chance is ${chosen.encounterDivisor === 4 ? 'quartered' : 'halved'}.` };
  }
  if (spell === 'floating disc') {
    if (result.check.roll === 20) caster.pendingSpell = { spell, phase: 'critical' };
    else createFloatingDiscs(state, caster);
    return { ...result, message: `${result.message} ${result.check.roll === 20 ? 'Choose two discs or a two-hour duration.' : 'Floating Disc joins the party for one hour.'}` };
  }
  if (spell === 'feather fall') {
    caster.pendingFall.negated = true;
    return { ...result, message: `${result.message} Falling damage is negated; ${caster.name} lands safely.` };
  }
  if (spell === 'detect magic') {
    caster.focusSpell = { spell, radius: 6, focusedRounds: 0, critical: result.check.roll === 20,
      lastTurn: state.combat?.active ? `${state.combat.round}:${caster.id}` : null };
    if (result.check.roll === 20) caster.pendingSpell = { spell, phase: 'critical' };
    else refreshMagicDetection(state);
  } else caster.pendingSpell = { spell, phase: result.check.roll === 20 ? 'critical' : 'targeting',
    radius: 6, maxLevel: 2, remaining: 1, durationDice: 1, usedTargetIds: [] };
  return { ...result, message: `${result.message} ${result.check.roll === 20 ? 'Choose a critical effect.' : spell === 'charm person' ? 'Pick a humanoid to charm.' : 'Focus to sense nearby magic.'}` };
}

export function resolveWizardTierOne(state, caster, { choice, targetId, x, y, dismiss = false, random = Math.random } = {}) {
  const pending = caster.pendingSpell;
  if (!pending || !WIZARD_TIER_ONE.has(pending.spell)) throw new Error('No wizard spell is pending.');
  if (pending.phase === 'critical') {
    if (!WIZARD_CRITICAL_CHOICES[pending.spell]?.some(([key]) => key === choice)) throw new Error('Choose a valid critical effect.');
    if (pending.spell === 'hold portal' || pending.spell === 'sleep') {
      Object.assign(pending, { phase: 'targeting', rounds: choice === 'duration' ? 20 : 10,
        remaining: choice === 'targets' ? 2 : 1, radius: choice === 'range' ? 12 : 6,
        size: choice === 'area' ? 13 : 7, maxLevel: choice === 'level' ? 4 : 2 });
      if (pending.spell === 'sleep') return releaseSleep(state, caster);
      return { message: 'Pick a door to hold closed.' };
    }
    if (pending.spell === 'floating disc') {
      const created = createFloatingDiscs(state, caster, { count: choice === 'two-discs' ? 2 : 1, hours: choice === 'duration' ? 2 : 1 });
      caster.pendingSpell = null;
      return { message: `${created.length === 2 ? 'Two Floating Discs join' : 'Floating Disc joins'} the party for ${choice === 'duration' ? 'two hours' : 'one hour'}.` };
    }
    if (pending.spell === 'detect magic') {
      if (!caster.focusSpell || caster.focusSpell.spell !== 'detect magic') throw new Error('Detect Magic focus has ended.');
      caster.focusSpell.radius = choice === 'range' ? 12 : 6;
      caster.focusSpell.focusedRounds = choice === 'properties' ? 2 : 0;
      caster.focusSpell.criticalChoice = choice;
      caster.pendingSpell = null;
      refreshMagicDetection(state);
      return { message: `${caster.name} senses magic within ${caster.focusSpell.radius} squares.` };
    }
    Object.assign(pending, { phase: 'targeting', remaining: choice === 'targets' ? 2 : 1,
      maxLevel: choice === 'level' ? 4 : 2, durationDice: choice === 'duration' ? 2 : 1 });
    return { message: `Pick ${pending.remaining === 2 ? 'two humanoids' : 'a humanoid'} to charm.` };
  }
  if (dismiss) { caster.pendingSpell = null; return { message: 'Unused spell dissipates. The casting action remains spent.' }; }
  if (pending.spell === 'hold portal') return holdDoor(state, caster, state.entities.find(entity => entity.id === targetId), pending);
  if (pending.spell === 'sleep') return releaseSleep(state, caster, { x, y });
  const target = state.entities.find(entity => entity.id === targetId && entity.type === 'monster' && !entity.defeated && Number(entity.hp) > 0);
  if (!target || !isHumanoid(target) || Number(target.level ?? target['**LV**'] ?? 1) > pending.maxLevel) throw new Error(`Choose a humanoid of level ${pending.maxLevel} or less.`);
  if (!canTargetAtRange(state, caster, target, pending.radius, { directAttack: true })) throw new Error('That humanoid is outside range or line of sight.');
  if (blocksMindControl(state, target, 'Charm Person')) throw new Error('Protection from Evil or Good prevents that charm.');
  if (pending.usedTargetIds.includes(target.id)) throw new Error('Choose a different humanoid.');
  const days = Array.from({ length: pending.durationDice }, () => die(random)).reduce((sum, roll) => sum + roll, 0);
  target.attitude = 'friendly'; target.attitudeChecked = true; target.hostile = false; target.stealthed = false;
  if (target.stealthState) target.stealthState.revealed = true;
  delete target.turnedUndead; delete target.moraleFlight; delete target.curious;
  target.charm = { casterId: caster.id, remainingMs: days * 24 * 60 * 60 * 1000, days };
  pending.usedTargetIds.push(target.id);
  pending.remaining--;
  if (!pending.remaining) caster.pendingSpell = null;
  return { target, days, message: `${target.name} regards ${caster.name} as a friend for ${days} days.` };
}

export function maintainDetectMagic(state, caster, options = {}) {
  const focus = caster.focusSpell;
  if (focus?.spell !== 'detect magic') return null;
  if (caster.dead || caster.slain || Number(caster.hp) <= 0) {
    caster.focusSpell = null; refreshMagicDetection(state);
    return { succeeded: false, message: `${caster.name} loses Detect Magic focus.` };
  }
  const previouslyLost = (caster.failedSpellKeys || []).includes('detect magic');
  caster.focusSpell = null;
  const result = wizardSpellCheck(state, caster, 'detect magic', options);
  if (!result.succeeded) {
    caster.focusSpell = null;
    if (result.check.roll !== 1 && !previouslyLost) caster.failedSpellKeys = caster.failedSpellKeys.filter(key => key !== 'detect magic');
  } else {
    caster.focusSpell = focus;
    if (options.reason === 'next round') focus.focusedRounds++;
    if (result.check.roll === 20 && !focus.critical) {
      focus.critical = true;
      caster.pendingSpell = { spell: 'detect magic', phase: 'critical' };
    }
  }
  refreshMagicDetection(state);
  return { ...result, message: `${caster.name} Detect Magic focus (${options.reason || 'next round'}): ${result.check.total} vs DC 11; ${result.succeeded ? 'maintained' : 'lost'}.` };
}

export function refreshMagicDetection(state) {
  for (const entity of state.entities || []) entity.magicDetected = false;
  for (const caster of state.characters || []) {
    caster.magicDetectedIds = [];
    if (caster.focusSpell?.spell !== 'detect magic' || caster.dead || caster.slain || Number(caster.hp) <= 0) continue;
    for (const target of state.entities || []) {
      if (target.collected || target.defeated || !canTargetAtRange(state, caster, target, caster.focusSpell.radius, { requireLight: false })) continue;
      const magical = isMagicItem(target) || isMagicItem(target.gearItem) ||
        [...(target.gear || []), ...(target.carriedGear || []), ...(target.treasures || []), ...(target.magicItems || [])].some(isMagicItem);
      if (magical || isMimic(target) || isDoppelganger(target) || target.invisibility) {
        target.magicDetected = true;
        caster.magicDetectedIds.push(target.id);
        if (target.type === 'trap' || target.type === 'treasure') target.visible = target.revealed = true;
        if (target.stealthState && magical) target.stealthState.revealed = true;
        if ((isMimic(target) || isDoppelganger(target)) && !target.disguiseRevealed) {
          target.disguiseRevealed = true; target.impersonatedCharacter = null;
          target.attitudeChecked = false; target.hostile = true; target.attitude = 'hostile';
        }
        if (caster.focusSpell.focusedRounds >= 2 && magical) target.magicPropertiesKnown = true;
      }
    }
    for (const member of state.characters || []) if (member.id !== caster.id &&
      canTargetAtRange(state, caster, member, caster.focusSpell.radius, { requireLight: false })) {
      if (member.invisibility) caster.magicDetectedIds.push(member.id);
      if (member.companion?.kind === 'doppelganger') member.detectedDoppelganger = true;
    }
  }
}

export function canIdentify(caster) {
  return /wizard/i.test(caster?.className || '') && String(caster.spellsKnown || '').split(/,\s*/).some(spell => /^detect magic$/i.test(spell)) &&
    !(caster.failedSpellKeys || []).includes('detect magic') && !caster.spellLocks?.['detect magic']?.remainingMs;
}
export function identifyGear(state, caster, index, options = {}) {
  if (!canIdentify(caster)) throw new Error('Detect Magic is unavailable.');
  const item = caster.gear?.[index];
  if (!item?.magic || item.magic.identified) throw new Error('Choose an unidentified magic item.');
  const checks = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = wizardSpellCheck(state, caster, 'detect magic', options);
    checks.push(result);
    if (!result.succeeded) return { checks, succeeded: false, message: `${result.message} The item remains unidentified.` };
  }
  identifyMagicItem(item);
  caster.raw ||= {}; caster.raw.gear = JSON.parse(JSON.stringify(caster.gear));
  return { checks, succeeded: true, message: `${caster.name} identifies ${item.name}${item.magic.tier ? ` (Tier ${item.magic.tier})` : ''}.` };
}
