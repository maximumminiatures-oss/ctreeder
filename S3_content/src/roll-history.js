const die = (value, sides, bold = false) => ({ text: String(value), bold, minimum: value === 1, maximum: value === sides });

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
  return parts;
}
