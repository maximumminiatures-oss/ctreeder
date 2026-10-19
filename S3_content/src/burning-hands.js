import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { canTargetAtRange } from './targeting.js';
import { rollWizardMishaps, wizardCastingMode } from './wizard-mishaps.js';
import { applyFireToTreasure } from './fire-damage.js';
import { isFloatingDisc } from './floating-disc.js';

const choices = {
  normal: { diceCount: 1, diceSides: 6, radius: 1 },
  'two-d6': { diceCount: 2, diceSides: 6, radius: 1 },
  'one-d12': { diceCount: 1, diceSides: 12, radius: 1 },
  'double-radius': { diceCount: 1, diceSides: 6, radius: 2 }
};

export function applyBurningHands(state, caster, { center = caster, diceCount = 1, diceSides = 6, radius = 1,
  includeCaster = false, random = Math.random } = {}) {
  const rolls = Array.from({ length: diceCount }, () => Math.floor(random() * diceSides) + 1);
  const damage = rolls.reduce((total, roll) => total + roll, 0);
  const hits = [], ignited = [], damagedTreasure = [];
  const reaches = target => canTargetAtRange(state, center, target, radius, { requireLight: false });
  for (const character of state.characters || []) {
    if (isFloatingDisc(character) || (!includeCaster && character.id === caster.id) || character.dead || character.slain || !reaches(character)) continue;
    const before = Number(character.hp);
    setCharacterHp(character, before - damage, { sourceId: caster.id, damageSource: 'fire' });
    hits.push({ id: character.id, name: character.name, type: 'character', damage: before - character.hp });
  }
  for (const entity of state.entities || []) {
    if (!reaches(entity)) continue;
    const treasureDamage = applyFireToTreasure(entity);
    if (treasureDamage) damagedTreasure.push(treasureDamage);
    if (entity.type === 'monster' && !entity.defeated && !entity.leftPeacefully && Number(entity.hp) > 0) {
      entity.hp = Math.max(0, Number(entity.hp) - damage);
      if (damage > 0 && entity.conditions?.sleeping) { delete entity.conditions.sleeping; entity.conditions.prone = true; }
      hits.push({ id: entity.id, name: entity.name, type: 'monster', damage, defeated: entity.hp <= 0 });
    } else if (entity.type !== 'monster' && entity.type !== 'treasure' && entity.flammable === true && !entity.collected && !entity.burning) {
      entity.burning = true;
      ignited.push(entity.name || 'Flammable object');
    }
  }
  const targets = hits.length ? hits.map(hit => hit.name).join(', ') : 'no creatures';
  return { rolls, damage, hits, ignited, damagedTreasure, message: caster.name + ' releases Burning Hands: ' + diceCount + 'd' + diceSides +
    ' = (' + rolls.join(' + ') + ') = ' + damage + ' damage to ' + targets + '.' +
    (ignited.length ? ' ' + ignited.join(', ') + ' catch fire.' : '') +
    (damagedTreasure.length ? ' ' + damagedTreasure.join(' ') : '') };
}

export function castBurningHands(state, caster, options = {}) {
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if ((caster.failedSpellKeys || []).includes('burning hands')) throw new Error('Burning Hands is unavailable until recovery.');
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  const check = (options.rollCheck || rollCheck)(modifier, wizardCastingMode(caster, 1, options.advantage === true, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 11);
  let message = caster.name + (succeeded ? ' casts' : ' fails to cast') + ' Burning Hands: 1d20 = (' + check.roll +
    ') ' + (modifier >= 0 ? '+' : '-') + Math.abs(modifier) + ' = ' + check.total + ' vs DC 11.';
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'burning hands'])];
    const mishaps = check.roll === 1 ? rollWizardMishaps(state, caster, 'Burning Hands', {
      ...options, resolveMisfire: target => {
        const result = applyBurningHands(state, caster, { center: target, includeCaster: true, random: options.random });
        return { damage: result.damage, targetId: target.id, hits: result.hits, detail: result.message };
      }
    }) : [];
    if (mishaps.length) message += ' ' + mishaps.map(result => 'Mishap ' + result.roll + ': ' + result.name + '! ' + result.detail).join(' ');
    return { check, message, succeeded: false, mishaps };
  }
  const critical = check.roll === 20;
  caster.pendingSpell = { spell: 'burning hands', phase: critical ? 'critical' : 'targeting', ...choices.normal };
  return { check, succeeded: true, critical, message: message + (critical ? ' Choose a critical effect.' : ' Burning Hands is ready. Release the flames when positioned.') };
}

export function chooseBurningHands(caster, choice) {
  if (caster.pendingSpell?.spell !== 'burning hands' || caster.pendingSpell.phase !== 'critical') throw new Error('There is no critical Burning Hands awaiting a choice.');
  if (!['two-d6', 'one-d12', 'double-radius'].includes(choice)) throw new Error('Choose a critical Burning Hands effect.');
  Object.assign(caster.pendingSpell, choices[choice], { phase: 'targeting' });
  return { message: 'Burning Hands is ready. Release the flames when positioned.' };
}

export function releaseBurningHands(state, caster, options = {}) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'burning hands' || pending.phase !== 'targeting') throw new Error('Burning Hands is not ready.');
  const result = applyBurningHands(state, caster, { ...pending, ...options });
  caster.pendingSpell = null;
  return result;
}
