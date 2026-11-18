const lycanStatBlocks = {
  wererat: { STR: 12, DEX: 14, CON: 12, INT: 8, WIS: 12, CHA: 8 },
  werewolf: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 10 }
};

export const lycanthropeKind = actor => actor?.conditions?.lycanthropy?.transformed ? actor.conditions.lycanthropy.kind :
  actor?.type === 'monster' && /^(wererat|werewolf)$/i.test(actor.name || '') ? actor.name.toLowerCase() : null;
export const hostileLycanthrope = actor => Boolean(actor?.conditions?.lycanthropy?.hostile);
export const silverItem = item => item?.silver === true || /^silver /i.test(item?.name || '');
export const vampireNeedsStake = actor => actor?.type === 'monster' && /^vampire(?: spawn)?$/i.test(actor.name || '');
export const stakeTarget = actor => vampireNeedsStake(actor) && !actor.defeated && Number(actor.hp) <= 0;

export function recordLycanthropeDamage(target, source, damage, random = Math.random) {
  const kind = lycanthropeKind(source);
  if (!kind || !(damage > 0) || target.conditions?.lycanthropy) return false;
  target.conditions ||= {};
  const injuries = target.conditions.lycanthropeDamage ||= {};
  injuries[source.id] = (injuries[source.id] || 0) + damage;
  if (injuries[source.id] < 12) return false;
  target.conditions.lycanthropy = { kind, cycle: 1 + Math.floor(random() * 14), transformed: false, hostile: false };
  delete target.conditions.lycanthropeDamage;
  return true;
}

export function progressLycanthropyAfterRest(state, participantIds) {
  const departed = [];
  for (const actor of state.characters) {
    const curse = actor.conditions?.lycanthropy;
    if (!curse || curse.hostile || Number(actor.hp) <= 0 || !participantIds.includes(actor.id)) continue;
    if (curse.transformed) curse.cycle = curse.cycle % 14 + 1;
    else {
      curse.original = { ancestry: actor.ancestry, alignment: actor.alignment, stats: structuredClone(actor.stats) };
      actor.ancestry = (curse.kind === 'wererat' ? 'Wererat' : 'Werewolf') +
        (actor.ancestry && !/^human$/i.test(actor.ancestry) ? ' ' + actor.ancestry : '');
      actor.alignment = 'Chaotic';
      actor.stats = { ...lycanStatBlocks[curse.kind] };
      if (/\bwizard\b/i.test(actor.className || '')) actor.stats.INT = curse.original.stats.INT;
      if (/\bpriest\b/i.test(actor.className || '')) actor.stats.WIS = curse.original.stats.WIS;
      curse.transformed = true;
    }
    if (curse.cycle === 14) {
      curse.hostile = true;
      actor.focusSpell = actor.pendingSpell = null;
      departed.push(actor);
    }
    if (actor.raw) {
      actor.raw.ancestry = actor.ancestry;
      actor.raw.alignment = actor.alignment;
      actor.raw.stats = structuredClone(actor.stats);
      actor.raw.conditions = structuredClone(actor.conditions);
    }
  }
  return departed;
}

export function lycanthropeAttack(actor) {
  const kind = lycanthropeKind(actor);
  return kind === 'wererat' ? 'Bite: +2, 1d6, close' : kind === 'werewolf' ? 'Rend: +3, 1d6, close' : '';
}

export function stakeGear(item) {
  const text = [item.name, item.description, item.treasureDescription].filter(Boolean).join(' ');
  return !item.bound && (/^(?:\d+'\s+pole|pole(?:,?\s+10')?|(?:silver )?greataxe|club|(?:quarter)?staff|broken chair|(?:silver )?arrows?|(?:silver )?(?:crossbow )?bolts?)$/i.test(item.name || '') ||
    (item.treasureItem || item.treasureKind) && (/\bwood(?:en)?\b/i.test(text) || /instrument/i.test(item.treasureKind || '')));
}

export function shortenedStakePole(item) {
  const length = /^(?:\d+'\s+pole|pole(?:,?\s+10')?)$/i.test(item.name || '') ? Number(item.name.match(/\d+/)?.[0] || 10) : null;
  return length > 2 ? { ...item, name: (length - 2) + "' Pole", gearId: undefined, equipped: false, reachPole: false } : null;
}

export const isReachPole = item => item?.reachPole === true || /^(?:10'\s+pole|pole(?:,?\s+10')?)$/i.test(item?.name || '');

const innateAttackTags = new Set(['ooze', 'devil', 'demon', 'fiend', 'angel', 'celestial', 'outsider', 'dragon', 'elemental', 'primordial', 'fey']);
export const vampireKind = actor => actor?.conditions?.vampirism?.kind ||
  (/^vampire(?: spawn)?$/i.test(actor?.companion?.source?.name || (actor?.type === 'monster' ? actor.name : '')) ?
    ((actor.companion?.source?.name || actor.name).toLowerCase()) : null);
export const isVampire = actor => Boolean(vampireKind(actor));
export const vampireInTorpor = actor => actor?.conditions?.vampirism?.torpor === true;
export const hostileVampire = actor => actor?.conditions?.vampirism?.hostile === true && !vampireInTorpor(actor);
export const hostileSupernatural = actor => hostileLycanthrope(actor) || hostileVampire(actor);
export const isCoffin = item => item?.coffin === true || /^coffin$/i.test(item?.name || '');
export const supernaturalDefense = actor => Boolean(lycanthropeKind(actor) || vampireKind(actor));
export const vampireBite = actor => vampireKind(actor) === 'vampire' ? 'Bite: +7, 1d8, close' :
  vampireKind(actor) === 'vampire spawn' ? 'Bite: +4, 1d8, close' : '';
export const originalAncestry = actor => actor?.conditions?.vampirism?.originalAncestry || actor?.conditions?.lycanthropy?.original?.ancestry || actor?.ancestry || '';
export const suppressesVampireSpellcasting = actor => actor?.conditions?.vampirism?.noSpellcasting === true;

function sourceTags(source) {
  return [...(source?.tags || []), ...(source?.companion?.source?.tags || [])].map(tag => String(tag).toLowerCase());
}
export function supernaturalAttackCanDamage(target, source, { magical = false, silver = false, special = false } = {}) {
  if (!supernaturalDefense(target) || magical || silver || special || lycanthropeKind(source)) return true;
  const tags = sourceTags(source);
  const name = source?.companion?.source?.name || source?.name || '';
  return tags.some(tag => innateAttackTags.has(tag)) || /\b(?:kraken|ophid|viperian|animated armor)\b/i.test(name) ||
    (isVampire(source) || tags.includes('undead') || source?.companion?.kind === 'animate-dead') &&
      Number(source?.level ?? source?.['**LV**'] ?? source?.companion?.source?.level ?? 0) > 4;
}

const rollDie = (sides, random) => Math.floor(random() * sides) + 1;
const stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const native = ['S', 'D', 'C', 'I', 'W', 'Ch'];

function talentIncreases(actor) {
  const changes = {};
  for (const bonus of actor.bonuses || []) {
    for (const [, stat, amount] of String(bonus.bonusTo || '').matchAll(/\b(STR|DEX|CON|INT|WIS|CHA)\s*:\s*([+-]\d+)/gi)) {
      const key = stat.toUpperCase();
      changes[key] = (changes[key] || 0) + Number(amount);
    }
  }
  return changes;
}

export function syncVampireHealth(actor) {
  if (!isVampire(actor) || actor.type === 'monster') return;
  actor.conditions ||= {};
  const effect = actor.conditions.vampirism ||= { kind: vampireKind(actor), lockedHp: 0 };

  if (!effect || effect.torpor || actor.type === 'monster') return;
  if (actor.hp <= 0 && !actor.dead && !actor.slain) {
    effect.torpor = true; effect.hostile = false; actor.dyingRounds = 0;
    return;
  }
  effect.hostile = actor.hp > 0 && actor.hp * 2 < actor.maxHitPoints;
}

export function riseAsVampire(target) {
  const scores = target.stats || Object.fromEntries(stats.map((stat, index) => [stat, 10 + 2 * Number(target[native[index]] || 0)]));
  const vampire = Number(target.level ?? 1) > 4 && scores.CHA + scores.INT + scores.WIS > 38;
  const kind = vampire ? 'vampire' : 'vampire spawn';
  const name = vampire ? 'Vampire' : 'Vampire Spawn';
  const ancestry = originalAncestry(target);
  const wasPriest = /\bpriest\b/i.test(target.className || '');
  const noSpellcasting = !vampire && (/\bwizard\b/i.test(target.className || '') ||
    wasPriest && /^(?:lawful|neutral)$/i.test(target.alignment || ''));
  const previousMax = Number(target.maxHitPoints ?? target.maxHp) || 0;
  const ceiling = /\bdwarf\b/i.test(ancestry) ? 62 : vampire ? Math.max(52, previousMax) : 20;
  const next = vampire ? { STR: 18, DEX: 16, CON: 16, INT: scores.INT, WIS: scores.WIS, CHA: 18 } :
    { STR: 16, DEX: 14, CON: 16, INT: 8, WIS: 12, CHA: 14 };
  const increases = talentIncreases(target);
  for (const key of stats) if (!vampire || !['INT', 'WIS'].includes(key)) next[key] += increases[key] || 0;
  target.conditions ||= {};
  delete target.conditions.lycanthropy;
  delete target.conditions.bloodDrain;
  target.conditions.vampirism = { kind, originalAncestry: ancestry, lockedHp: 0, hostile: false, torpor: false, noSpellcasting };
  Object.assign(target, { ancestry: !ancestry || /^human$/i.test(ancestry) ? name : ancestry + ' ' + name,
    alignment: 'Chaotic', hp: ceiling, dead: false, slain: false, dyingRounds: 0, focusSpell: null, pendingSpell: null });
  if (target.type === 'monster' && !target.stats) {
    for (const [index, key] of native.entries()) target[key] = Math.floor((next[stats[index]] - 10) / 2);
    target.name = name; target.maxHp = ceiling; target.AL = 'C';
    target.attack = vampire ? '3 bite +7 (1d8 + blood drain)' : '2 bite +4 (1d8 + blood drain)';
    target.tags = [...new Set([...(target.tags || []), 'undead'])];
  } else {
    target.stats = next;
    target.maxHitPoints = ceiling;
    if (noSpellcasting) {
      target.spellsKnown = '';
      target.failedSpellKeys = [];
      target.spellPenance = {};
      target.learnedScrollSpells = [];
      for (const level of [...(target.levels || []), target.ambitionTalentLevel].filter(Boolean)) {
        if (/spellcasting|advantage.*spell|learn.*spell/i.test([level.talentRolledName, level.talentRolledDesc, level.Rolled12ChosenTalentDesc].join(' '))) {
          delete level.talentRolledName; delete level.talentRolledDesc; delete level.Rolled12ChosenTalentDesc;
        }
      }
      for (const event of target.advancements || []) {
        for (const task of event.tasks || []) if (['spell', 'extra-spell', 'spell-advantage', 'casting'].includes(task.type)) task.done = true;
        event.completed = event.tasks?.every(task => task.done) ?? event.completed;
      }
      target.bonuses = (target.bonuses || []).filter(bonus => !/spellcasting|advantageonspell|^Spell:/i.test(
        [bonus.name, bonus.bonusName, bonus.bonusTo, bonus.description].join(' ')));
      if (/^elf$/i.test(ancestry)) target.ancestryChoices = { ...target.ancestryChoices, farsight: 'ranged' };
    }
  }
  if (target.raw) for (const field of ['ancestry', 'alignment', 'hp', 'maxHitPoints', 'stats', 'conditions', 'spellsKnown',
    'failedSpellKeys', 'spellPenance', 'bonuses', 'levels', 'ambitionTalentLevel', 'advancements', 'ancestryChoices', 'learnedScrollSpells', 'dead', 'slain', 'dyingRounds']) {
    if (target[field] !== undefined) target.raw[field] = structuredClone(target[field]);
  }
  return kind;
}

export function canDrainBlood(target) {
  return Boolean(target && !isVampire(target) && target.companion?.kind !== 'animate-dead' &&
    !target.illusion && !target.summon && (target.type !== 'monster' && !target.companion || sourceTags(target).includes('humanoid')) &&
    !sourceTags(target).includes('undead'));
}

export function applyBloodDrain(source, target, { random = Math.random, heal } = {}) {
  if (!isVampire(source) || !canDrainBlood(target)) return null;
  const amount = rollDie(4, random);
  const previous = target.stats ? Number(target.stats.CON) : (target.drainCon ?? 10 + 2 * Number(target.C || 0));
  const remaining = Math.max(0, previous - amount);
  if (target.stats) {
    target.stats.CON = remaining;
    if (target.raw) target.raw.stats = structuredClone(target.stats);
  } else {
    target.drainCon = remaining;
    target.C = Math.floor((remaining - 10) / 2);
  }
  const healing = rollDie(6, random) + rollDie(6, random);
  if (heal) heal(source, healing);
  else source.hp = Math.min(source.maxHp || source.maxHitPoints || source.hp, source.hp + healing);
  const rose = remaining === 0 ? riseAsVampire(target) : null;
  return { rose, message: source.name + ' drains ' + (previous - remaining) + ' CON from ' + target.name +
    (rose ? '. ' + target.name + ' rises as a ' + rose + '.' : '.') };
}

export function recoverVampireAtRest(world, actor, roomId, random = Math.random) {
  if (!isVampire(actor) || actor.slain || actor.dead) return null;
  actor.conditions ||= {};
  const form = actor.conditions.vampirism ||= { kind: vampireKind(actor), lockedHp: 0 };
  const hasCoffin = (actor.gear || []).some(isCoffin) || roomId != null && world.entities.some(entity =>
    entity.roomId === roomId && !entity.collected && (isCoffin(entity) || isCoffin(entity.gearItem)));
  if (hasCoffin) {
    actor.hp = Math.min(actor.maxHitPoints, (Number(actor.hp) || 0) + (form.lockedHp || 0));
    form.lockedHp = 0;
    form.torpor = false;
    form.hostile = false;
    return 'coffin';
  }
  const lost = Math.min(Number(actor.hp) || 0, rollDie(6, random) + rollDie(6, random));
  form.lockedHp = Math.min(actor.maxHitPoints, (form.lockedHp || 0) + lost);
  actor.hp = Math.max(0, actor.hp - lost);
  syncVampireHealth(actor);
  return 'no-coffin';
}

export function coffinGear(value = 10) {
  return { name: 'Coffin', coffin: true, type: 'sundry', slots: 5, costGp: value, quantity: 1, totalUnits: 1 };
}
