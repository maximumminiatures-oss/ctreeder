import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollCheck } from './interactions.js';
import { isFloatingDisc } from './floating-disc.js';
import { routeOf, sameRoute } from './underpasses.js';
import { applyHigherMishap, HIGHER_MISHAPS, processArcanaLoop, advanceArcanePhenomena } from './higher-mishaps.js';

export const SPELL_ROUND_MS = 10000;
export const SPELL_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WIZARD_MISHAPS = [
  '', 'Devastation', 'Explosion', 'Refraction', 'Your hand slipped', 'Mind wound',
  'Discorporation', 'Spell worm', 'Harmonic failure', 'Poof', 'The horror',
  'Energy surge', 'Unstable conduit'
];
const key = name => String(name || '').trim().toLowerCase();
const die = (sides, random) => Math.floor(random() * sides) + 1;
const pick = (items, random) => items.length ? items[die(items.length, random) - 1] : null;
const lose = (character, spell) => {
  if (spell) character.failedSpellKeys = [...new Set([...(character.failedSpellKeys || []), key(spell)])];
};

export function hasWizardEffect(character, type) {
  return (character?.wizardEffects || []).some(effect => effect.type === type && (effect.rounds == null || effect.rounds > 0));
}

export function wizardCastingMode(character, tier, advantage = false, extraDisadvantage = false) {
  const disadvantage = extraDisadvantage || (character.wizardEffects || []).some(effect => effect.type === 'unstable' && effect.rounds > 0 && (effect.tier === tier || effect.maxTier >= tier));
  return { doubleRoll: advantage && !disadvantage, disadvantage: disadvantage && !advantage };
}

export function spellLockRemaining(character, spell) {
  return Math.max(0, Number(character?.spellLocks?.[key(spell)]?.remainingMs) || 0);
}

export function rollWizardMishaps(state, caster, spell, options = {}) {
  const { random = Math.random, knownSpells = [], resolveMisfire = null, tier = 1 } = options;
  const results = [];
  const apply = number => {
    if (tier >= 3) { results.push(applyHigherMishap(state, caster, spell, number, options)); return; }
    const result = { roll: number, name: WIZARD_MISHAPS[number] };
    const add = effect => {
      caster.wizardEffects ||= [];
      const old = caster.wizardEffects.find(item => item.type === effect.type && item.tier === effect.tier);
      if (old) Object.assign(old, effect, { rounds: Math.max(old.rounds || 0, effect.rounds || 0) || undefined });
      else caster.wizardEffects.push(effect);
    };
    switch (number) {
      case 2: {
        result.damage = die(8, random);
        setCharacterHp(caster, Number(caster.hp) - result.damage, { sourceId: caster.id, damageSource: 'fire explosion' });
        result.detail = `${caster.name} takes ${result.damage} damage (1d8).`;
        break;
      }
      case 3:
      case 4: {
        const target = number === 3 ? caster : pick((state.characters || []).filter(character => !isFloatingDisc(character) && character.id !== caster.id && !character.dead && !character.slain), random);
        if (target && resolveMisfire) Object.assign(result, resolveMisfire(target));
        else if (target) {
          result.damage = die(4, random);
          setCharacterHp(target, Number(target.hp) - result.damage, { sourceId: caster.id });
          result.targetId = target.id;
          result.detail = `Magic Missile strikes ${target.name} for ${result.damage} damage (1d4).`;
        } else result.detail = 'No ally is present; the spell dissipates.';
        break;
      }
      case 5:
        caster.spellLocks ||= {};
        caster.spellLocks[key(spell)] = { remainingMs: SPELL_WEEK_MS, rested: false };
        result.detail = `${spell} is lost for one in-game week and requires a successful rest.`;
        break;
      case 6: {
        const choices = (caster.gear || []).map((item, index) => ({ item, index }))
          .filter(({ item }) => Number(item.totalUnits ?? item.quantity ?? 1) > 0);
        const chosen = pick(choices, random);
        if (chosen) {
          const { item, index } = chosen;
          const count = Number(item.totalUnits ?? item.quantity ?? 1);
          if (count > 1) {
            item.quantity = count - 1;
            if ('totalUnits' in item) item.totalUnits = count - 1;
            // The lit/equipped unit is the one that disappears from a stack.
            item.lit = false;
            item.equipped = false;
          } else caster.gear.splice(index, 1);
          result.detail = `One ${item.name || 'gear item'} disappears forever.`;
        } else result.detail = 'There is no gear to disappear.';
        break;
      }
      case 7:
        add({ type: 'spell-worm' });
        result.detail = 'Each turn, lose a random spell, then roll DC 12 CON to end the spell worm. Lost spells require rest.';
        break;
      case 8: {
        const lost = pick(knownSpells, random);
        lose(caster, lost);
        result.detail = lost ? `${lost} is also lost until a successful rest.` : 'There is no additional spell to lose.';
        break;
      }
      case 9:
        add({ type: 'light-suppression', rounds: 10 });
        result.detail = 'All light within six squares of the caster is suppressed for 10 rounds.';
        break;
      case 10:
        add({ type: 'screaming', rounds: 3 });
        result.detail = 'Scream in Primordial for three rounds; check for wandering monsters each round.';
        break;
      case 11:
        add({ type: 'purple-glow', rounds: 10 });
        result.detail = 'Glow bright purple for 10 rounds; enemies have advantage on attacks against the caster.';
        break;
      case 12:
        add({ type: 'unstable', rounds: 10, tier });
        result.detail = `Disadvantage on tier ${tier} spellcasting for 10 rounds.`;
        break;
    }
    results.push(result);
  };
  const roll = die(12, random);
  if (roll === 1) {
    results.push({ roll: 1, tier, name: (tier >= 3 ? HIGHER_MISHAPS[tier >= 5 ? 5 : 3] : WIZARD_MISHAPS)[1], detail: 'Two mishaps occur.' });
    // Sampling 2..12 directly is equivalent to rerolling 1s and cannot loop forever.
    apply(2 + Math.floor(random() * 11));
    apply(2 + Math.floor(random() * 11));
  } else apply(roll);
  caster.lastWizardMishaps = results;
  return results;
}

export function processWizardTurn(character, knownSpells, options = {}) {
  const { random = Math.random, check = rollCheck, state } = options;
  if (character.dead || character.slain || Number(character.hp) <= 0) return null;
  const loop = state ? processArcanaLoop(state, character, options) : '';
  if (!hasWizardEffect(character, 'spell-worm')) return loop || null;
  const spell = pick(knownSpells, random);
  lose(character, spell);
  const result = check(abilityScoreModifier(character.stats?.CON));
  const passed = result.total >= 12;
  if (passed) character.wizardEffects = character.wizardEffects.filter(effect => effect.type !== 'spell-worm');
  return `${loop ? loop + ' ' : ''}${character.name}: ${spell ? `${spell} lost. ` : ''}Spell worm CON check ${result.total} vs DC 12: ${passed ? 'passed; spell worm ends' : 'failed'}.`;
}

export function advanceWizardTime(state, milliseconds, { rounds = 0, onScream = () => {}, onTurn = () => {}, summon } = {}) {
  const elapsed = Math.max(0, Number(milliseconds) || 0);
  let changed = false;
  for (const character of state.characters || []) {
    for (const effect of character.wizardEffects || []) if (effect.remainingMs > 0) {
      effect.remainingMs = Math.max(0, effect.remainingMs - elapsed); changed ||= elapsed > 0;
    }
    character.wizardEffects = (character.wizardEffects || []).filter(effect => effect.remainingMs == null || effect.remainingMs > 0);
    for (const [spell, lock] of Object.entries(character.spellLocks || {})) {
      lock.remainingMs = Math.max(0, (Number(lock.remainingMs) || 0) - elapsed);
      if (!lock.remainingMs && lock.rested) {
        character.failedSpellKeys = (character.failedSpellKeys || []).filter(name => name !== spell);
        delete character.spellLocks[spell];
      }
      changed ||= elapsed > 0;
    }
  }
  changed = advanceArcanePhenomena(state, rounds, { summon }) || changed;
  for (let round = 0; round < rounds; round += 1) {
    state.arcaneTurnSequence = Math.max(0, Number(state.arcaneTurnSequence) || 0) + 1;
    // Finish duration updates before encounter callbacks can begin combat.
    const screamers = [];
    for (const character of state.characters || []) {
      if (hasWizardEffect(character, 'screaming') && !character.dead && !character.slain) screamers.push(character);
      for (const effect of character.wizardEffects || []) if (effect.rounds > 0) { effect.rounds -= 1; changed = true; }
      character.wizardEffects = (character.wizardEffects || []).filter(effect => effect.rounds == null || effect.rounds > 0);
      if (onTurn(character)) changed = true;
    }
    for (const character of screamers) onScream(character);
  }
  return changed;
}

export function suppressionZones(state) {
  return (state.characters || []).filter(character => hasWizardEffect(character, 'light-suppression'))
    .map(character => ({ x: Number(character.visualX ?? character.x), y: Number(character.visualY ?? character.y), radius: 6, routeId: routeOf(state, character) }));
}

export function isLightSuppressedAt(state, x, y, point = { x, y }) {
  return suppressionZones(state).some(zone => sameRoute(state, zone, point) && Math.hypot(x - zone.x, y - zone.y) <= zone.radius + 0.5);
}

export function recoverWizardSpells(character) {
  for (const effect of character.wizardEffects || []) if (effect.type === 'stat-collapse') character.stats[effect.stat] = Math.max(3, effect.original + character.stats[effect.stat] - 3);
  character.wizardEffects = (character.wizardEffects || []).filter(effect => !effect.untilRest);
  for (const item of character.gear || []) if (item.magic?.kind === 'wand') delete item.magic.disabledUntilRest;
  character.raw ||= {}; character.raw.stats = structuredClone(character.stats); character.raw.gear = structuredClone(character.gear || []);
  for (const lock of Object.values(character.spellLocks || {})) lock.rested = true;
  character.failedSpellKeys = (character.failedSpellKeys || []).filter(spell =>
    spellLockRemaining(character, spell) > 0 || (character.spellPenance?.[spell] && !character.spellPenance[spell].paid));
  for (const [spell, lock] of Object.entries(character.spellLocks || {})) if (lock.remainingMs <= 0) delete character.spellLocks[spell];
}
