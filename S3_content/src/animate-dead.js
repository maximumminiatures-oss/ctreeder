import { abilityScoreModifier, normalizeCharacterState } from './characters.js';
import { rollCheck, canMoveBetweenTiles } from './interactions.js';
import { buildMonsterCompanion, nativeAttackLines, transferredMonsterGear } from './companions.js';
import { castingBonus } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { silenceBlocksAction } from './area-spells.js';
import { canTargetAtRange } from './targeting.js';
import { sameRoute, routeOf } from './underpasses.js';
import { isHumanoid } from './wizard-tier-one.js';
import { handItemKind } from './equipment.js';
import { DEFAULT_LIGHT_RADIUS } from './constants.js';

/* Parent integration contract (no main.js side effects here):
 * - Route spell/resolve_spell to castAnimateDead/resolveAnimateDead, passing
 *   {monsters: shadowdarkContent.monsters}. Spend the casting action once, even
 *   on failure/dismissal; resolution spends no additional caster action.
 * - Render animateDeadPresentation: critical choices, then form options, then
 *   targets/targetIds. Adapt the reusable UI's selection.option to form; resolve
 *   with {choice}, then {form}, then {targetId}; dismiss is final. Each body
 *   chooses its form independently. The lifecycle kind is always 'animate-dead'.
 * - Corpse provenance: corpseSource -> sourceMonsterId's defeated entity ->
 *   monsterName catalog lookup. Optional remains={limbsIntact,headIntact};
 *   legacy ordinary corpses have four limbs/head unless explicitly damaged.
 *   Gear comes only from uncollected corpse-linked equipment drops, never from
 *   source/catalog inventory. corpseEquipment preserves pre-death equipped flags.
 *   Parent equipment rebuilds apply gear to the naked form's baseline stats.
 * - Animated undead own their initiative action/movement. effectiveTurnOwner
 *   returns the undead itself; only Floating Disc shares its caster's turn.
 * - Use animatedDeadController to consult multiplayerSession.ownership[caster.id].
 *   Backend room.ownership_json is authoritative; reconcile via
 *   companion.controllerCharacterId / summon.casterId, with no host fallback.
 * - advanceAnimatedDeadTime(state, gameMilliseconds) performs cleanup itself;
 *   call alongside Floating Disc on exploration/combat/rest game-time deltas,
 *   never Date.now/offline wall time. Do not run defeat/archive/loot on expiry.
 * - companion.animateDead is canonical (normalization retains companion, but
 *   drops non-disc summon). syncAnimatedDeadState restores the summon mirror
 *   after normalize/load and before registry inspection. Route dispel/dismissal
 *   to cleanupAnimatedDead, not a write to that mirror. No focus is required.
 * - Add 'animate dead' to pending targeting/move eligibility and route corpse
 *   clicks (not living-monster targeting) to resolveAnimateDead. Parent action
 *   guards still check caster/actor incapacitation and ownership before control.
 */
export const ANIMATE_DEAD_DAY_MS = 24 * 60 * 60 * 1000;
export const ANIMATE_DEAD_CHOICES = [['targets', 'Two Bodies'], ['duration', 'Two Days']];
const forms = ['Skeleton', 'Zombie'];
const alive = actor => actor && !actor.dead && !actor.slain && !actor.defeated && Number(actor.hp) > 0;
const clone = value => structuredClone(value);
const nameOf = monster => monster?.name || monster?.['Monster Name'] || '';
const writeRaw = (actor, key) => { actor.raw ||= {}; actor.raw[key] = clone(actor[key]); };
export const isAnimatedDead = actor => actor?.companion?.kind === 'animate-dead';
const effectOf = actor => isAnimatedDead(actor) ? actor.companion.animateDead : null;

export function animatedDeadController(state, actor) {
  if (!isAnimatedDead(actor)) return null;
  return (state.characters || []).find(member => member.id === actor.companion.controllerCharacterId) || null;
}

export function effectiveTurnOwner(state, actor) {
  if (actor?.summon?.kind === 'floating-disc') return (state.characters || []).find(member => member.id === actor.summon.casterId) || null;
  return actor || null;
}

export function syncAnimatedDeadState(state) {
  for (const actor of (state.characters || []).filter(isAnimatedDead)) {
    const effect = effectOf(actor);
    actor.summon = { kind: 'animate-dead', spell: 'animate dead', casterId: effect.casterId, remainingMs: effect.remainingMs };
    writeRaw(actor, 'companion'); writeRaw(actor, 'summon');
  }
  return state;
}

export function animateDeadSlotsAvailable(state, casterId = null) {
  const reserved = (state.characters || []).filter(actor => actor.id !== casterId).reduce((sum, actor) => {
    const pending = actor.pendingSpell;
    return sum + (pending?.spell === 'animate dead' ? pending.remaining || 1
      : pending?.spell === 'floating disc' && pending.phase === 'critical' ? 1 : 0);
  }, 0);
  return Math.max(0, 16 - (state.characters || []).length - reserved);
}

function corpseSource(state, corpse, monsters) {
  if (corpse.corpseSource) return corpse.corpseSource;
  const source = (state.entities || []).find(entity => entity.id === corpse.sourceMonsterId && entity.type === 'monster' && entity.defeated);
  if (source) return source;
  if (corpse.characterCorpse) return corpse.characterCorpse.companion?.source || {
    name: corpse.characterCorpse.ancestry, tags: ['humanoid'], character: corpse.characterCorpse
  };
  return monsters.find(monster => nameOf(monster).toLowerCase() === String(corpse.monsterName || '').toLowerCase()) || null;
}

export function animateDeadRemains(state, caster, { monsters = [] } = {}) {
  return (state.entities || []).filter(corpse => {
    if (!['corpse-loot', 'character-corpse'].includes(corpse.subtype) || corpse.collected || corpse.buried || corpse.animateDeadConsumed ||
        corpse.characterCorpse?.companion?.kind === 'animate-dead') return false;
    const source = corpseSource(state, corpse, monsters);
    if (!source || (source.tags || []).some(tag => /^(?:undead|construct)$/i.test(tag))) return false;
    if (!(isHumanoid(source) || /^bugbear\b/i.test(nameOf(source)))) return false;
    const limbs = corpse.remains?.limbsIntact ?? 4;
    if (!Number.isInteger(limbs) || limbs < 3 || corpse.remains?.headIntact === false) return false;
    if (!canTargetAtRange(state, caster, corpse, 1)) return false;
    if ((state.characters || []).some(actor => alive(actor) && actor.x === corpse.x && actor.y === corpse.y && sameRoute(state, actor, corpse)) ||
        (state.entities || []).some(actor => actor.type === 'monster' && alive(actor) && actor.x === corpse.x && actor.y === corpse.y && sameRoute(state, actor, corpse))) return false;
    return canMoveBetweenTiles(state, caster.x, caster.y, corpse.x, corpse.y, { routeId: routeOf(state, caster), creature: caster }).ok;
  });
}

function statBlock(monsters, form) {
  const candidates = monsters.filter(monster => nameOf(monster).toLowerCase() === form.toLowerCase() &&
    !(monster.source || []).includes('srd5e'));
  const source = candidates.find(monster => monster.slug === form.toLowerCase()) ||
    candidates.find(monster => (monster.source || []).includes('core')) || candidates[0];
  if (!source) throw new Error(`The normal ${form} stat block is unavailable.`);
  return { ...clone(source), name: form, hp: source.hp ?? source['**HP**'], maxHp: Number.parseInt(source.hp ?? source['**HP**'], 10),
    ac: source.ac ?? source['**AC**'], level: source.level ?? source['**LV**'], attack: source.attack ?? source['**ATK**'],
    movement: source.movement ?? source['**MV**'], alignment: source.alignment ?? source.AL ?? source['**AL**'] };
}

function inheritCorpseGear(state, corpse, undead) {
  const inheritedGearIds = [];
  for (const loot of state.entities || []) {
    if (loot.type !== 'treasure' || loot.subtype !== 'dropped-equipment' || !loot.gearItem ||
        loot.collected || loot.destroyed || loot.buried || loot.animateDeadConsumed ||
        loot.x !== corpse.x || loot.y !== corpse.y || !sameRoute(state, loot, corpse)) continue;
    const provenance = loot.corpseEquipment;
    const legacyPrefix = `slain-gear-${corpse.sourceMonsterId}-`;
    const linked = provenance ? provenance.corpseId === corpse.id
      : corpse.characterCorpse ? loot.corpseOwnerId === corpse.characterCorpse.id
      : corpse.sourceMonsterId && loot.id?.startsWith(legacyPrefix) && /^\d+$/.test(loot.id.slice(legacyPrefix.length));
    if (!linked) continue;
    const item = { id: loot.id, ...clone(loot.gearItem), equipped: provenance ? provenance.equipped === true : loot.gearItem.equipped === true };
    if (item.slots == null && loot.slots != null) item.slots = loot.slots;
    if (loot.fireDamage) item.fireDamage = clone(loot.fireDamage);
    // Use the normal inventory calculation, including quantities and stack sizes.
    const probe = { characters: [{ ...clone(undead), companion: { ...clone(undead.companion), gearCapacity: 1000000 },
      gear: [...clone(undead.gear), item] }] };
    normalizeCharacterState(probe);
    if (probe.characters[0].gearSlotsUsed > undead.companion.gearCapacity) continue;
    undead.gear.push(item);
    inheritedGearIds.push(loot.id);
    loot.collected = true;
    loot.animateDeadConsumed = { animatedId: undead.id, corpseId: corpse.id };
    delete loot.gearItem;
  }
  return inheritedGearIds;
}

export function castAnimateDead(state, caster, options = {}) {
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if ((caster.failedSpellKeys || []).includes('animate dead') || spellLockRemaining(caster, 'animate dead') || blocksSpellTier(caster, 3))
    throw new Error('This spell is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  if (!animateDeadSlotsAvailable(state, caster.id)) throw new Error('Animate Dead needs a free party slot.');
  for (const form of forms) statBlock(options.monsters || [], form);
  if (!animateDeadRemains(state, caster, options).length) throw new Error('Touch visible humanoid remains with at least three limbs and an intact head.');
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  const check = (options.checkRoll || options.rollCheck || rollCheck)(modifier,
    wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  const result = { check, succeeded, critical: succeeded && check.roll === 20, mishaps: [],
    message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} Animate Dead: ${check.total} vs DC 13.` };
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), 'animate dead'])];
    if (check.roll === 1) result.mishaps = rollWizardMishaps(state, caster, 'animate dead', { ...options, tier: 3,
      knownSpells: options.knownSpells || String(caster.spellsKnown || '').split(/,\s*/) });
    writeRaw(caster, 'failedSpellKeys');
    if (result.mishaps.length) result.message += ' ' + result.mishaps.map(mishap =>
      `Mishap ${mishap.roll}: ${mishap.name}. ${mishap.detail || ''}`).join(' ');
    return result;
  }
  caster.pendingSpell = { spell: 'animate dead', tier: 3, phase: result.critical ? 'critical' : 'targeting',
    remaining: 1, days: 1, castingTotal: check.total };
  writeRaw(caster, 'pendingSpell');
  return { ...result, pendingSpell: caster.pendingSpell };
}

export function resolveAnimateDead(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell;
  if (pending?.spell !== 'animate dead') throw new Error('No Animate Dead is awaiting resolution.');
  if (selection.dismiss) {
    caster.pendingSpell = null; writeRaw(caster, 'pendingSpell');
    return { message: 'Unused Animate Dead dissipates. The casting action remains spent.' };
  }
  if (pending.phase === 'critical') {
    if (!ANIMATE_DEAD_CHOICES.some(([key]) => key === selection.choice)) throw new Error('Choose two bodies or two days.');
    const count = selection.choice === 'targets' ? 2 : 1;
    if (animateDeadSlotsAvailable(state, caster.id) < count) throw new Error(`Animate Dead needs ${count} free party slots.`);
    if (animateDeadRemains(state, caster, options).length < count) throw new Error(`Touch ${count} available humanoid bodies.`);
    Object.assign(pending, { phase: 'targeting', remaining: count, days: selection.choice === 'duration' ? 2 : 1 });
    writeRaw(caster, 'pendingSpell');
    return { message: 'Choose Skeleton or Zombie, then touch the remains.' };
  }
  const form = forms.find(value => value.toLowerCase() === String(selection.form || pending.form || '').toLowerCase());
  if (!form) throw new Error('Choose Skeleton or Zombie.');
  if (!selection.targetId) {
    pending.form = form; writeRaw(caster, 'pendingSpell');
    return { message: 'Touch the humanoid remains.' };
  }
  if (!animateDeadSlotsAvailable(state, caster.id)) throw new Error('Animate Dead needs a free party slot.');
  const corpse = animateDeadRemains(state, caster, options).find(entity => entity.id === selection.targetId);
  if (!corpse) throw new Error('Those remains are unavailable, damaged, occupied, or outside visible touch range.');
  const source = corpseSource(state, corpse, options.monsters || []);
  const originalMonsterName = nameOf(source);
  const id = `animate-dead-${crypto.randomUUID()}`;
  const monster = { ...statBlock(options.monsters || [], form), id, type: 'monster', x: corpse.x, y: corpse.y,
    routeId: routeOf(state, corpse), roomId: corpse.roomId, gear: [], carriedGear: [] };
  if (form === 'Skeleton') Object.assign(monster, { ac: 10, attack: '1 claw +1 (1)' });
  const undead = buildMonsterCompanion(monster, { id, kind: 'animate-dead', controllerId: caster.id });
  undead.name = undead.ancestry = `${originalMonsterName} ${form}`;
  undead.baseAttacks = undead.attacks = nativeAttackLines(monster);
  undead.colorId = caster.colorId; undead.colorValue = caster.colorValue;
  undead.companion.animateDead = { casterId: caster.id, corpseId: corpse.id, form, originalMonsterName,
    corpseArmorClass: Number.parseInt(source.ac ?? source['**AC**'] ?? source.armorClass ?? corpse.characterCorpse?.armorClass, 10) || null,
    inheritedGearIds: inheritCorpseGear(state, corpse, undead), remainingMs: pending.days * ANIMATE_DEAD_DAY_MS };
  undead.raw = clone(undead);
  // Retain the consumed record as a tombstone, never as loot or reusable remains.
  corpse.animateDeadConsumed = { casterId: caster.id, animatedId: id };
  corpse.type = 'feature'; corpse.subtype = 'animated-remains'; corpse.corpseLoot = false;
  corpse.collected = true;
  state.characters.push(undead);
  pending.remaining--;
  if (!pending.remaining) caster.pendingSpell = null;
  else delete pending.form;
  writeRaw(caster, 'pendingSpell'); syncAnimatedDeadState(state);
  return { undead, corpse, message: `${undead.name} rises for ${pending.days === 2 ? 'two days' : 'one day'}.` };
}

export function animateDeadPresentation(state, caster, options = {}) {
  const pending = caster?.pendingSpell;
  if (pending?.spell !== 'animate dead') return null;
  const remains = animateDeadRemains(state, caster, options), slots = animateDeadSlotsAvailable(state, caster.id);
  const view = { id: `${caster.id}:animate-dead:${pending.phase}:${pending.remaining}`, title: 'Animate Dead' };
  if (pending.phase === 'critical') return { ...view, message: 'Choose a critical effect.',
    choices: ANIMATE_DEAD_CHOICES.map(([key, label]) => ({ key, label, disabled: slots < (key === 'targets' ? 2 : 1) || remains.length < (key === 'targets' ? 2 : 1) })) };
  return { ...view, message: pending.form ? 'Pick a corpse to animate.' : 'Choose Skeleton or Zombie.',
    ...(!pending.form ? { options: forms.map(label => ({ key: label.toLowerCase(), label })) } : {}),
    targets: remains.map(corpse => ({ key: corpse.id, label: corpse.name || `Dead ${corpse.monsterName || 'Humanoid'}` })),
    targetIds: remains.map(corpse => corpse.id), remaining: pending.remaining, form: pending.form || null };
}

export function cleanupAnimatedDead(state, actor) {
  const current = (state.characters || []).find(member => member.id === actor?.id && isAnimatedDead(member));
  if (!current) return null;
  const dust = { id: `grave-dust-${current.id}`, type: 'feature', subtype: 'grave-dust', name: 'Grave Dust',
    x: current.x, y: current.y, routeId: routeOf(state, current), roomId: current.roomId, visible: true,
    animateDeadConsumed: clone(effectOf(current)), description: 'Animate Dead has ended. Grave dust remains.' };
  const gearDrops = (current.gear || []).map((item, index) => ({
    id: `grave-dust-gear-${current.id}-${index}`, type: 'treasure', subtype: 'dropped-equipment', kind: 'gear', name: item.name,
    x: current.x, y: current.y, routeId: routeOf(state, current), roomId: current.roomId, visible: true, revealed: true,
    collected: false, value: Number(item.value) || 0, slots: item.slots ?? 1,
    gearItem: item.nativeMonsterWeapon ? transferredMonsterGear(item) : { ...clone(item), equipped: false },
    animateDeadSourceId: current.id,
    ...(item.lit && ['torch', 'lantern'].includes(handItemKind(item)) ? {
      lightSource: handItemKind(item), lightRadius: handItemKind(item) === 'lantern' ? 12 : DEFAULT_LIGHT_RADIUS
    } : {})
  }));
  state.entities.push(...gearDrops);
  current.gear = []; writeRaw(current, 'gear');
  state.entities.push(dust);
  state.characters = state.characters.filter(member => member.id !== current.id);
  if (state.activeCharacterId === current.id) state.activeCharacterId = animatedDeadController(state, current)?.id || state.characters[0]?.id || null;
  return { undead: current, dust, gearDrops, message: `${current.name} collapses into grave dust.` };
}

export function advanceAnimatedDeadTime(state, milliseconds) {
  const delta = Number(milliseconds);
  if (!Number.isFinite(delta) || delta < 0) throw new Error('Animate Dead requires a nonnegative game-time delta.');
  const expired = [];
  for (const actor of [...(state.characters || [])].filter(isAnimatedDead)) {
    const effect = effectOf(actor);
    effect.remainingMs = Math.max(0, effect.remainingMs - delta);
    if (!effect.remainingMs) expired.push(cleanupAnimatedDead(state, actor));
  }
  syncAnimatedDeadState(state);
  return expired;
}
