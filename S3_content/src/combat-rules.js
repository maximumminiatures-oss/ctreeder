import { movementStepCost } from './terrain-movement.js';
import { isFloatingDisc } from './floating-disc.js';
import { petrifiedLegs, isRaving } from './arcane-effects.js';
import { routeOf, routeStep } from './underpasses.js';

export function characterMovementBudget(character) {
  const value = Number(character?.movementSquares ?? character?.movementPerTurn ?? 6);
  const effects = character?.transformationEffects || [];
  const levitating = effects.some(effect => effect.spell === 'levitate');
  const goatLegs = effects.some(effect => effect.spell === 'alter self' && effect.rounds > 0 && effect.features?.includes('goat-legs'));
  if (isRaving(character) || character?.conditions?.paralyzed || character?.conditions?.sinkhole && !levitating) return 0;
  return Math.max(0, Math.floor((Number.isFinite(value) ? value : 6) * (goatLegs ? 2 : 1) / 2 ** petrifiedLegs(character)));
}

export function characterOccupant(state, x, y, exceptId, options = {}) {
  const actor = state.characters?.find(character => character.id === exceptId);
  const route = options.routeId ?? (actor ? routeStep(state, actor, { x, y })?.routeId ?? routeOf(state, actor) : routeOf(state, { x, y }));
  return (state.characters || []).find(character => !isFloatingDisc(character) && character.id !== exceptId && !character.dead && !character.slain &&
    routeOf(state, character) === route && Number(character.x) === x && Number(character.y) === y);
}

export function combatStepBlock(state, character, x, y) {
  const route = routeStep(state, character, { x, y })?.routeId ?? routeOf(state, character);
  const monster = (state.entities || []).find(entity => entity.type === 'monster' && !entity.defeated && routeOf(state, entity) === route && Number(entity.x) === x && Number(entity.y) === y);
  const passesCreatures = character.transformationEffects?.some(effect => effect.spell === 'levitate' ||
    effect.spell === 'alter self' && effect.rounds > 0 && effect.features?.includes('spider-legs'));
  if (monster && !passesCreatures) return `${monster.name || 'Monster'} blocks the way.`;
  const occupant = characterOccupant(state, x, y, character.id);
  const remaining = state.combat.movementRemaining - movementStepCost(state, Number(character.x), Number(character.y), character);
  if ((occupant || monster) && remaining < movementStepCost(state, x, y, character)) return `${character.name} can't end turn on ${(occupant || monster).name}'s token.`;
  return '';
}

export function attackCreatureName(creature, { article = false, sentenceStart = false } = {}) {
  const name = String((typeof creature?.uniqueName === 'string' && creature.uniqueName) ||
    (typeof creature?.properName === 'string' && creature.properName) || creature?.name || 'monster');
  const proper = creature?.partyMember || creature?.className || creature?.uniqueName || creature?.properName || creature?.isUnique;
  if (proper) return name;
  const commonName = `${article ? 'the ' : ''}${name.toLowerCase()}`;
  return sentenceStart ? commonName.charAt(0).toUpperCase() + commonName.slice(1) : commonName;
}

export function attackRollSegments({ character, monster, weapon, spell, roll, ability, abilityModifier, hit, damage, damageRoll, magic = 0, hiddenMagic = 0, backstab = false, advantageReason = '' }) {
  const modifier = Number(abilityModifier) || 0;
  const other = (Number(roll.modifier) || 0) - modifier - magic - hiddenMagic;
  const signed = number => `${number < 0 ? '-' : '+'}${Math.abs(number)}`;
  const mode = ['advantage', 'disadvantage'].includes(roll.checkMode) ? ` at ${roll.checkMode}` : '';
  const attackName = spell || (weapon || 'unarmed strike').toLowerCase();
  const actorName = character.type === 'monster' ? attackCreatureName(character, { sentenceStart: true }) : character.name;
  const parts = [{ text: actorName, bold: true, characterId: character.id },
    { text: ` ${backstab ? 'backstabs' : 'attacks'} ${monster.name === 'nothing' ? 'nothing' : attackCreatureName(monster, { article: true })}${backstab ? '' : mode} with ${spell ? '' : 'a '}${attackName}.\n` }];
  const values = Number.isFinite(roll.secondaryRoll) ? [roll.firstRoll, roll.secondaryRoll] : [roll.roll];
  const tooltip = [];
  if (advantageReason) tooltip.push({ text: `${roll.checkMode === 'advantage' ? 'Advantage from ' : 'Unaware from '}${advantageReason}; ` });
  tooltip.push({ text: `${values.length}d20 = ` });
  let chosen = false;
  for (const value of values) {
    const bold = !chosen && value === roll.roll;
    if (bold) chosen = true;
    if (values.length > 1) tooltip.push({ text: '(' });
    tooltip.push({ text: String(value), bold, die: true, maximum: value === 20, minimum: value === 1 });
    if (values.length > 1) tooltip.push({ text: ')' });
  }
  tooltip.push({ text: ` ${signed(modifier)} ${String(ability || 'attack').toUpperCase()}${magic ? ` ${signed(magic)} magic` : ''}${other ? ` ${signed(other)} other` : ''} = To hit: ` },
    { text: String(roll.total), bold: true });
  parts.push({ text: String(roll.total), bold: true, tooltip }, { text: ` ${hit ? 'Hits!' : 'Miss!'}` });
  if (damage != null) {
    const dice = damageRoll?.terms?.filter(term => term.type === 'die') || [];
    const damageTip = [{ text: `${spell || (weapon || 'unarmed').toLowerCase()}: ` }];
    if (!backstab && dice.length === 1 && !(damageRoll.terms || []).some(term => term.type === 'flat') &&
      !(damageRoll.multiplier > 1) && !damageRoll.resistance) {
      damageTip.push({ text: `1-${dice[0].label.replace(/^1d/, '')} (` },
        { text: String(dice[0].value), bold: true, maximum: dice[0].isMaximum, minimum: dice[0].isMinimum }, { text: ')' });
    } else {
      for (const [index, term] of (damageRoll?.terms || []).entries()) {
        if (index || term.sign < 0) damageTip.push({ text: term.sign < 0 ? ' - ' : ' + ' });
        damageTip.push({ text: term.type === 'die' ? `${term.label}${term.element ? ` ${term.element}` : ''} = (` : '' },
          { text: String(term.value), bold: term.type === 'die', maximum: term.isMaximum, minimum: term.isMinimum },
          { text: term.type === 'die' ? ')' : '' });
      }
      if (damageRoll?.multiplier > 1) damageTip.push({ text: ` x${damageRoll.multiplier}` });
      if (damageRoll?.resistance) damageTip.push({ text: ` / 2 (${damageRoll.resistance} resistance)` });
      damageTip.push({ text: backstab ? ' backstab = ' : ' = ' }, { text: String(damage), bold: true }, { text: ' damage' });
    }
    parts.push({ text: ' Damage: ' }, { text: String(damage), bold: true, tooltip: damageTip,
      maximum: dice.length > 0 && dice.every(term => term.isMaximum), minimum: dice.length > 0 && dice.every(term => term.isMinimum) });
  }
  return parts;
}

export const attackNarrative = options => attackRollSegments(options).map(part => part.text).join('');

export function colorChannels(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  return rgb ? rgb.slice(1).map(Number) : [57, 126, 217];
}

export function mixTokenColor(color, base, amount) {
  const token = colorChannels(color), background = colorChannels(base);
  return `rgb(${token.map((value, i) => Math.round(value * amount + background[i] * (1 - amount))).join(', ')})`;
}
