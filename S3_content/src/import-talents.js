import { abilityScoreModifier } from './characters.js';

const STATS = ['STR','DEX','CON','INT','WIS','CHA'];
const classKey = character => String(character.className || character.class || '').toLowerCase();
export const isImportedClassBonus = (character, bonus) => !/ambition/i.test(bonus.sourceCategory || '') &&
  (/^class$/i.test(bonus.sourceType || '') || !bonus.sourceType && (!bonus.sourceName || String(bonus.sourceName).toLowerCase() === classKey(character)));

export function classTalentForRoll(key, roll) {
  if (roll === 12) return 'wild';
  if (key === 'fighter') return roll === 2 ? 'mastery' : roll <= 6 ? 'attack' : roll <= 9 ? 'stat' : 'armor';
  if (key === 'priest') return roll === 2 ? 'spell-advantage' : roll <= 6 ? 'attack-choice' : roll <= 9 ? 'casting' : 'stat';
  if (key === 'thief') return roll === 2 ? 'initiative' : roll <= 5 ? 'backstab' : roll <= 9 ? 'stat' : 'attack';
  return roll === 2 ? 'magic-item' : roll <= 7 ? 'casting-or-int' : roll <= 9 ? 'spell-advantage' : 'extra-spell';
}

function importedTalent(character, bonus) {
  if (/ambition/i.test(`${bonus.sourceType || ''} ${bonus.sourceCategory || ''}`)) return true;
  if (/human/i.test(character.ancestry || '') && /^ancestry$/i.test(bonus.sourceType || '') && /^talent$/i.test(bonus.sourceCategory || '')) return true;
  return isImportedClassBonus(character, bonus) && (/^talent$/i.test(bonus.sourceCategory || '') ||
    /StatBonus|Plus2|PlusTwo|Plus1ToHit|AttackBonus|PriestSpellcasting|WizardSpellcasting|BackstabIncrease|InitiativeAdvantage|Adv.*Cast|LearnExtraSpell|ArmorMastery|CreateMagicItem/i.test(bonus.name || ''));
}

function statChanges(bonuses) {
  const changes = Object.fromEntries(STATS.map(stat => [stat, 0]));
  for (const bonus of bonuses) for (const [, stat, amount] of String(bonus.bonusTo || '').matchAll(/\b(STR|DEX|CON|INT|WIS|CHA)\s*:\s*([+-]?\d+)/gi)) changes[stat.toUpperCase()] += Number(amount);
  return changes;
}

// Called only at the explicit fresh-import boundary, never by load or normalization.
export function resetFreshImportTalents(character) {
  const before = { ...character.stats }, bonuses = character.bonuses || [];
  const discarded = bonuses.filter(bonus => importedTalent(character, bonus));
  character.bonuses = bonuses.filter(bonus => !discarded.includes(bonus));
  const preservedChanges = statChanges(character.bonuses), discardedChanges = statChanges(discarded);
  const rolled = character.raw?.stats && !character.raw?.rolledStats ? {} : character.rolledStats || character.raw?.rolledStats || {};
  character.stats = Object.fromEntries(STATS.map(stat => [stat,
    Number.isFinite(Number(rolled[stat])) && Number(rolled[stat]) > 0 ? Number(rolled[stat]) + preservedChanges[stat] :
      (Number(before[stat]) || 10) - discardedChanges[stat]]));
  const hpBaseline = { maxHitPoints: Number(character.maxHitPoints) || 1, conScore: Number(before.CON) || 10,
    levelCount: Math.max(1, Number(character.level) || 1),
    rolls: (character.levels || []).map(level => Math.max(Number(level.HitPointRoll),
      /^dwarf$/i.test(character.ancestry || '') ? Number(level.stoutHitPointRoll) || 0 : 0)).filter(roll => Number.isFinite(roll) && roll > 0) };
  const capacity = stats => Math.max(10, Number(stats.STR) || 10) + (classKey(character) === 'fighter' ? Math.max(0, abilityScoreModifier(stats.CON)) : 0);
  character.gearSlotsTotal = Math.max(10, (Number(character.gearSlotsTotal) || capacity(before)) + capacity(character.stats) - capacity(before));
  character.levels = (character.levels || []).map(level => ({ ...level, talentRolledName: '', talentRolledDesc: '',
    Rolled12ChosenTalentName: '', Rolled12ChosenTalentDesc: '', Rolled12TalentOrTwoStatPoints: '', progression: true }));
  if (!character.levels.some(level => Number(level.level) === 1)) character.levels.unshift({ level: 1, progression: true });
  character.ambitionTalentLevel = null;
  syncFreshImportHitPoints(character, hpBaseline);
  return hpBaseline;
}

export function syncFreshImportHitPoints(character, baseline) {
  const oldCon = abilityScoreModifier(baseline.conScore), newCon = abilityScoreModifier(character.stats.CON);
  const rolls = baseline.rolls.slice(0, baseline.levelCount);
  const delta = rolls.reduce((sum, roll) => sum + Math.max(1, roll + newCon) - Math.max(1, roll + oldCon), 0) +
    (baseline.levelCount - rolls.length) * (newCon - oldCon);
  const maximum = Math.max(1, baseline.maxHitPoints + delta), difference = maximum - Number(character.maxHitPoints);
  character.maxHitPoints = maximum;
  if (Number(character.hp) > 0) character.hp = Math.max(0, Math.min(maximum, Number(character.hp) + difference));
}
