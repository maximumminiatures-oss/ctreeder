export function characterMovementBudget(character) {
  const value = Number(character?.movementSquares ?? character?.movementPerTurn ?? 6);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 6;
}

export function characterOccupant(state, x, y, exceptId) {
  return (state.characters || []).find(character => character.id !== exceptId && !character.dead && !character.slain && Number(character.x) === x && Number(character.y) === y);
}

export function combatStepBlock(state, character, x, y) {
  const monster = (state.entities || []).find(entity => entity.type === 'monster' && !entity.defeated && Number(entity.x) === x && Number(entity.y) === y);
  if (monster) return `${monster.name || 'Monster'} blocks the way.`;
  const occupant = characterOccupant(state, x, y, character.id);
  if (occupant && state.combat.movementRemaining <= 1) return `${character.name} can't end turn on ${occupant.name}'s token.`;
  return '';
}

export function attackNarrative({ character, monster, weapon, roll, ability, abilityModifier, hit, damage }) {
  const modifier = Number(abilityModifier) || 0;
  const other = (Number(roll.modifier) || 0) - modifier;
  const signed = number => `${number < 0 ? '-' : '+'}${Math.abs(number)}`;
  const dice = roll.rolls?.length > 1 ? roll.rolls.join(', ') : roll.roll;
  return `${character.name} attacks the ${(monster.name || 'monster').toLowerCase()} with a ${(weapon || 'unarmed strike').toLowerCase()} and ${hit ? 'hits' : 'misses'}. ` +
    `1d20 = (${dice}) ${signed(modifier)} ${ability.toUpperCase()}${other ? ` ${signed(other)} other` : ''} = To hit: ${roll.total} vs ${monster.name || 'Monster'} AC ${Number.isFinite(Number(monster.ac)) ? Number(monster.ac) : 10}: ${hit ? 'hit' : 'miss'}` +
    (damage != null ? `. Damage: ${damage}.` : '');
}

export function colorChannels(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  return rgb ? rgb.slice(1).map(Number) : [57, 126, 217];
}

export function mixTokenColor(color, base, amount) {
  const token = colorChannels(color), background = colorChannels(base);
  return `rgb(${token.map((value, i) => Math.round(value * amount + background[i] * (1 - amount))).join(', ')})`;
}
