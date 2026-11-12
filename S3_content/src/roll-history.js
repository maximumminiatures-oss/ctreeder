const die = (value, sides, bold = false) => ({ text: String(value), bold, minimum: value === 1, maximum: value === sides });

export function historyMonsterColor(monster) {
  if (!monster) return '#be2d2d';
  return monster.mimicDisguise && !monster.disguiseRevealed ? '#e0bc2f'
    : monster.impersonatedCharacter?.colorValue || (monster.hostile || ['combat', 'hostile'].includes(monster.attitude) ? '#be2d2d' : '#df9696');
}

export function createCheckRollCard(check, { heading = null, actorId = null, actorName = null, type = null, tooltip = [], damage = null, ...presentation } = {}) {
  const values = Number.isFinite(check.secondaryRoll) ? [check.firstRoll, check.secondaryRoll] : [check.roll];
  const modifier = Number(check.modifier) || 0;
  return {
    heading, actorId, actorName, type,
    results: values.map(value => ({
      value: value + modifier, bold: value === check.roll,
      minimum: value === 1, maximum: value === 20, tooltip
    })),
    damage, ...presentation
  };
}

export function checkHistoryPresentation(check, action, presentation = {}) {
  const card = { actionName: action.replace(/ cast$/i, ''), ...presentation };
  if (['Search', 'Stealth'].includes(action)) card.type ||= action;
  if (Number.isFinite(check?.dc) && !Number.isFinite(card.dc)) card.dc = check.dc;
  if (typeof check?.succeeded === 'boolean' && card.succeeded == null) card.succeeded = check.succeeded;
  if (action === 'Search' && !card.summary && Array.isArray(check?.found)) {
    card.resultText = check.darknessMessage || (check.found.length
      ? `Found: ${check.found.map(entity => entity.subtype === 'door' && entity.secret ? 'secret door' : entity.name || entity.type).join(', ')}.`
      : 'Nothing found.');
  }
  if (card.succeeded == null && Number.isFinite(card.dc) && Number.isFinite(check?.total)) {
    card.succeeded = card.type === 'Spellcasting'
      ? check.roll !== 1 && (check.roll === 20 || check.total >= card.dc)
      : check.total >= card.dc;
  }
  if (typeof card.succeeded === 'boolean') card.outcome = card.succeeded ? 'Success' : 'Failure';
  return card;
}

export function reactionHistorySegments({ actor, monster, result, talk = false, understood = false }) {
  const parts = rollTextSegments(result.message);
  const summary = talk && actor
    ? understood ? `${actor.name} talks to ${monster.name}. ${monster.name} feels ${result.attitude}.`
      : `${actor.name} talks to ${monster.name}, but ${monster.name} doesn't understand.`
    : `${monster.name} feels ${result.attitude}.`;
  parts[0].rollCard = {
    heading: 'CHA', actorId: actor?.id || monster.id, actorName: actor?.name || monster.name,
    type: 'CHA', actionName: 'CHA', results: [{ value: result.total, bold: true,
      minimum: result.rolls.every(value => value === 1), maximum: result.rolls.every(value => value === 6),
      tooltip: parts.map(part => ({ ...part })) }], damage: null, summary
  };
  return parts;
}

export function burningHandsHistorySegments(caster, outcome, diceSides = 6) {
  const parts = damageRollSegments('Burning Hands', {
    expression: `${outcome.rolls.length}d${diceSides}`, total: outcome.damage,
    terms: outcome.rolls.map(value => ({ type: 'die', value, sign: 1,
      isMinimum: value === 1, isMaximum: value === diceSides }))
  });
  Object.assign(parts[0].rollCard, {
    actorId: caster.id, actorName: caster.name, type: 'Spell Release', actionName: 'Burning Hands',
    targets: outcome.hits.map(hit => ({ id: hit.id, name: hit.name, damage: hit.damage, dead: Boolean(hit.defeated || hit.dead || hit.slain) }))
  });
  if (outcome.message) parts[0].rollCard.damage.tooltip.push({ text: '\n' }, ...rollTextSegments(outcome.message));
  return parts;
}

export function checkDiceSegments(result) {
  const values = Number.isFinite(result.secondaryRoll) ? [result.firstRoll, result.secondaryRoll] : [result.roll];
  const parts = [{ text: `${values.length}d20 = ` }];
  let chosen = false;
  for (const value of values) {
    const selected = !chosen && value === result.roll;
    if (selected) chosen = true;
    if (values.length > 1) parts.push({ text: '(' });
    parts.push(die(value, 20, selected));
    if (values.length > 1) parts.push({ text: ')' });
  }
  return parts;
}

export function rollTextSegments(text, check = null) {
  const parts = [], pattern = /\b(\d+)d(\d+)\s*=\s*(\([\d\s,+-]+\)(?:\([\d\s,+-]+\))*)/g;
  let offset = 0, usedCheck = false;
  for (const match of text.matchAll(pattern)) {
    parts.push({ text: text.slice(offset, match.index) });
    const sides = Number(match[2]);
    if (check && sides === 20 && !usedCheck) { parts.push(...checkDiceSegments(check)); usedCheck = true; }
    else {
      const prefixLength = match[0].indexOf(match[3]);
      parts.push({ text: match[0].slice(0, prefixLength) });
      let cursor = 0;
      for (const number of match[3].matchAll(/\d+/g)) {
        parts.push({ text: match[3].slice(cursor, number.index) }, die(Number(number[0]), sides));
        cursor = number.index + number[0].length;
      }
      parts.push({ text: match[3].slice(cursor) });
    }
    offset = match.index + match[0].length;
  }
  parts.push({ text: text.slice(offset) });
  if (check && !usedCheck && Number.isFinite(check.roll)) parts.push({ text: '\n' }, ...checkDiceSegments(check),
    { text: ` ${check.modifier < 0 ? '-' : '+'}${Math.abs(check.modifier || 0)} = ` }, { text: String(check.total), bold: true });
  if (check && Number.isFinite(check.roll)) {
    // Snapshot the detailed segments before attaching metadata to avoid a cycle.
    parts[0].rollCard = createCheckRollCard(check, { tooltip: parts.map(part => ({ ...part })) });
  }
  return parts;
}

export function damageRollSegments(label, roll) {
  const parts = [{ text: `${label || 'Damage'}\n${roll.expression} = ` }];
  (roll.terms || []).forEach((term, index) => {
    if (index || term.sign < 0) parts.push({ text: term.sign < 0 ? ' - ' : ' + ' });
    parts.push(term.type === 'die' ? { text: String(term.value), bold: true, minimum: term.isMinimum, maximum: term.isMaximum } : { text: String(term.value) });
  });
  if (roll.multiplier > 1) parts.push({ text: ` x${roll.multiplier}` });
  parts.push({ text: ' = ' }, { text: String(roll.total), bold: true });
  const dice = (roll.terms || []).filter(term => term.type === 'die');
  parts[0].rollCard = {
    heading: label || 'Damage', actorId: null, actorName: null, type: 'Damage', results: [],
    damage: {
      value: roll.total, bold: true,
      minimum: dice.length > 0 && dice.every(term => Boolean(term.isMinimum)),
      maximum: dice.length > 0 && dice.every(term => Boolean(term.isMaximum)),
      tooltip: parts.map(part => ({ ...part }))
    }
  };
  return parts;
}
