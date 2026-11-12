export function parseMonsterAttack(segment) {
  const value = String(segment || '').trim();
  const match = value.match(/^(\d+\s+)?(.+?)\s*(\([^)]+\)\s*)?([+\-]\d+)\b(.*)$/);
  if (!match) return null;
  const [, count = '', rawName = '', range = '', bonusText = '', detail = ''] = match;
  const name = rawName.trim();
  if (!name) return null;
  return { count, attackCount: Math.min(100, Math.max(1, Number.parseInt(count, 10) || 1)),
    name, range, bonus: Number.parseInt(bonusText, 10) || 0, bonusText, detail };
}

export function monsterAttackSegments(value) {
  return String(value || '').split(/\s+\bor\b\s+/i).flatMap((routine, routineIndex) =>
    routine.split(/\s+\band\b\s+/i).map(segment => ({ segment, routineIndex })));
}

export function monsterAttackSequence(attacks, selected) {
  if (!selected) return [];
  const routine = selected.routineIndex == null ? [selected] : attacks.filter(attack => attack.routineIndex === selected.routineIndex);
  return routine.flatMap(attack => Array.from({ length: Math.min(100, Math.max(1, attack.attackCount || 1)) }, () => attack));
}
