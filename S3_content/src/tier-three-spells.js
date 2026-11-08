import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { canAimAtSquare } from './targeting.js';
import { hasLineOfSightFrom } from './visibility.js';
import { getTile } from './state-schema.js';
import { routeOf, routeExistsAt, routeKey } from './underpasses.js';
import { elementalDamage } from './elemental-effects.js';
import { wakeCreature } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { applyFireToTreasure } from './fire-damage.js';
import { igniteWebsAt, silenceBlocksAction } from './area-spells.js';

export const TIER_THREE_SPELLS = new Set(['fireball', 'lightning bolt']);
export const TIER_THREE_CHOICES = {
  fireball: [['damage', '8d6 Fire Damage'], ['area', '13 x 13 Area']],
  'lightning bolt': [['damage', '6d6 Lightning Damage'], ['range', '24-Square Ray']]
};
const defaults = {
  fireball: { diceCount: 4, diceSides: 6, radius: 3, range: 12 },
  'lightning bolt': { diceCount: 3, diceSides: 6, range: 12 }
};
const title = spell => spell === 'fireball' ? 'Fireball' : 'Lightning Bolt';
const placementMessage = spell => spell === 'fireball' ? 'Choose the blast center, then confirm.' : 'Choose the ray direction, then confirm.';
const alive = creature => creature && !creature.dead && !creature.slain && !creature.defeated &&
  !creature.leftPeacefully && Number(creature.hp) > 0 && !isFloatingDisc(creature);
const clearLine = (state, from, to) => hasLineOfSightFrom(state, from.x, from.y, to.x, to.y, { source: from, target: to });

export function castTierThreeSpell(state, caster, spell, options = {}) {
  spell = String(spell || '').trim().toLowerCase();
  if (!TIER_THREE_SPELLS.has(spell)) throw new Error('Unknown tier-three spell.');
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if ((caster.failedSpellKeys || []).includes(spell) || spellLockRemaining(caster, spell) || blocksSpellTier(caster, 3))
    throw new Error('This spell is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  const check = (options.rollCheck || options.checkRoll || rollCheck)(modifier,
    wizardCastingMode(caster, 3, options.advantage === true, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 13);
  const result = { check, succeeded, critical: check.roll === 20, mishaps: [], pendingSpell: null,
    message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} ${title(spell)}: ${check.total} vs DC 13.` };
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
    if (check.roll === 1) result.mishaps = rollWizardMishaps(state, caster, spell, { ...options, tier: 3,
      knownSpells: options.knownSpells || String(caster.spellsKnown || '').split(/,\s*/) });
    if (result.mishaps.length) result.message += ' ' + result.mishaps.map(mishap =>
      `Mishap ${mishap.roll}: ${mishap.name}. ${mishap.detail || ''}`).join(' ');
    return result;
  }
  caster.pendingSpell = { spell, tier: 3, phase: result.critical ? 'critical' : 'placement',
    castingTotal: check.total, ...defaults[spell] };
  return { ...result, pendingSpell: caster.pendingSpell,
    message: `${result.message} ${result.critical ? 'Choose a critical effect.' : placementMessage(spell)}` };
}

function settingsFor(spell, options) {
  const settings = { ...defaults[spell] };
  for (const key of Object.keys(settings)) if (options[key] != null) {
    if (!Number.isInteger(options[key]) || options[key] < (key === 'radius' ? 0 : 1))
      throw new Error(`Invalid spell ${key}.`);
    settings[key] = options[key];
  }
  return settings;
}

function spellCells(state, caster, spell, point, settings, { forced = false } = {}) {
  const routeId = routeOf(state, caster), target = { x: point?.x, y: point?.y, routeId: point?.routeId ?? routeId };
  // A ray click supplies direction, not its endpoint or length.
  const aimRange = spell === 'fireball' && !forced ? settings.range : Math.hypot(state.map.width, state.map.height);
  if (!canAimAtSquare(state, caster, target, aimRange))
    throw new Error('Choose a square within range and clear line of sight on the same route.');
  const cells = [];
  if (spell === 'fireball') {
    for (let y = Math.max(0, target.y - settings.radius); y <= Math.min(state.map.height - 1, target.y + settings.radius); y++) {
      for (let x = Math.max(0, target.x - settings.radius); x <= Math.min(state.map.width - 1, target.x + settings.radius); x++) {
        const cell = { x, y, routeId };
        if (getTile(state, x, y) && routeExistsAt(state, x, y, routeId) && clearLine(state, target, cell)) cells.push(cell);
      }
    }
    return cells;
  }
  let dx = target.x - caster.x, dy = target.y - caster.y;
  if (!dx && !dy) {
    if (!forced) throw new Error('Choose a ray direction away from the caster.');
    dx = 1;
  }
  const major = Math.max(Math.abs(dx), Math.abs(dy));
  // Sample once per dominant-axis square: a thin straight ray, never a widening cone.
  for (let step = 1; step <= settings.range; step++) {
    const cell = { x: caster.x + Math.round(dx * step / major), y: caster.y + Math.round(dy * step / major), routeId };
    if (Math.hypot(cell.x - caster.x, cell.y - caster.y) > settings.range + .000001 ||
        !getTile(state, cell.x, cell.y) || !routeExistsAt(state, cell.x, cell.y, routeId) || !clearLine(state, caster, cell)) break;
    cells.push(cell);
  }
  return cells;
}

export function tierThreeCells(state, caster, point) {
  const pending = caster?.pendingSpell;
  if (!TIER_THREE_SPELLS.has(pending?.spell) || !['targeting', 'placement'].includes(pending.phase)) return [];
  try { return spellCells(state, caster, pending.spell, point, settingsFor(pending.spell, pending)); }
  catch { return []; }
}

export function tierThreePresentation(state, caster) {
  const pending = caster?.pendingSpell;
  if (!TIER_THREE_SPELLS.has(pending?.spell)) return null;
  const view = { id: `${caster.id}:${pending.spell}:`, title: title(pending.spell), message: placementMessage(pending.spell) };
  if (pending.phase === 'critical') {
    view.message = 'Choose a critical effect.';
    view.choices = TIER_THREE_CHOICES[pending.spell].map(([key, label]) => ({ key, label }));
  } else view.area = { size: pending.spell === 'fireball' ? pending.radius * 2 + 1 : 1,
    color: caster.colorValue, routeId: routeOf(state, caster) };
  return view;
}

function damageCreature(state, creature, amount, sourceId, damageType) {
  const before = Number(creature.hp);
  state.lastDamageSourceId = sourceId;
  if ((state.characters || []).includes(creature)) setCharacterHp(creature, before - amount, { sourceId, damageSource: damageType });
  else creature.hp = Math.max(0, before - elementalDamage(creature, amount, damageType).total);
  if (Number(creature.hp) < before) wakeCreature(creature, state);
  return { id: creature.id, name: creature.name, type: (state.characters || []).includes(creature) ? 'character' : 'monster',
    damage: before - Number(creature.hp), defeated: Number(creature.hp) <= 0 };
}

export function applyTierThreeBlast(state, caster, spell, point, options = {}) {
  spell = String(spell || '').trim().toLowerCase();
  if (!TIER_THREE_SPELLS.has(spell)) throw new Error('Unknown tier-three spell.');
  const settings = settingsFor(spell, options), cells = spellCells(state, caster, spell, point, settings, { forced: true });
  const keys = new Set(cells.map(routeKey)), reaches = target => keys.has(routeKey({ ...target, routeId: routeOf(state, target) }));
  const random = options.random || Math.random, damageType = spell === 'fireball' ? 'fire' : 'lightning';
  const rolls = Array.from({ length: settings.diceCount }, () => Math.floor(random() * settings.diceSides) + 1);
  const damage = rolls.reduce((sum, roll) => sum + roll, 0), hits = [], damagedTreasure = [], ignited = [], webIgnitions = [], webHits = [];
  for (const creature of [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')]) {
    if (alive(creature) && reaches(creature)) hits.push(damageCreature(state, creature, damage, caster.id, damageType));
  }
  if (spell === 'fireball') {
    for (const entity of state.entities || []) {
      if (!reaches(entity)) continue;
      const response = applyFireToTreasure(entity);
      if (response) damagedTreasure.push(response);
      if (entity.type !== 'monster' && entity.type !== 'treasure' && entity.flammable === true && !entity.collected && !entity.burning) {
        entity.burning = true; ignited.push(entity.name || 'Flammable object');
      }
    }
    for (const cell of cells) {
      if (!(state.areaSpells || []).some(zone => zone.spell === 'web' && zone.rounds > 0 && zone.burnedAt == null)) break;
      const fire = igniteWebsAt(state, cell, { random, now: options.now,
        applyDamage: (creature, amount, info) => damageCreature(state, creature, amount, info.sourceId, info.damageType) });
      webIgnitions.push(...fire.ignited);
      for (const hit of fire.hits) {
        const character = (state.characters || []).find(member => member.id === hit.id);
        const creature = character || (state.entities || []).find(entity => entity.id === hit.id);
        const detail = { ...hit, name: creature?.name || hit.id, type: character ? 'character' : 'monster', source: 'web' };
        webHits.push(detail);
        const previous = hits.find(existing => existing.id === hit.id);
        if (previous) { previous.damage += hit.damage; previous.webDamage = (previous.webDamage || 0) + hit.damage; previous.defeated = hit.defeated; }
        else hits.push({ ...detail, webDamage: hit.damage });
      }
    }
  }
  return { spell, ...settings, cells, rolls, damage, damageType, hits, damagedTreasure, ignited, webIgnitions, webHits,
    message: `${caster.name} releases ${title(spell)}: ${settings.diceCount}d${settings.diceSides} = (${rolls.join(' + ')}) = ${damage} ${damageType} damage.` +
      (damagedTreasure.length ? ` ${damagedTreasure.join(' ')}` : '') + (webIgnitions.length ? ' The Web burns.' : '') };
}

export function resolveTierThreeSpell(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell;
  if (!TIER_THREE_SPELLS.has(pending?.spell)) throw new Error('No tier-three spell is pending.');
  if (selection.dismiss) { caster.pendingSpell = null; return { pendingSpell: null, message: 'Spell targeting dismissed.' }; }
  if (pending.phase === 'critical') {
    if (!TIER_THREE_CHOICES[pending.spell].some(([key]) => key === selection.choice)) throw new Error('Choose a valid critical effect.');
    if (selection.choice === 'damage') pending.diceCount = defaults[pending.spell].diceCount * 2;
    else if (selection.choice === 'area') pending.radius = 6;
    else pending.range = 24;
    pending.criticalChoice = selection.choice; pending.phase = 'placement';
    return { pendingSpell: pending, message: placementMessage(pending.spell) };
  }
  if (selection.choice != null) throw new Error('Only an initial critical cast can choose a critical effect.');
  if (!['targeting', 'placement'].includes(pending.phase)) throw new Error('That spell is not awaiting placement.');
  const settings = settingsFor(pending.spell, pending), cells = spellCells(state, caster, pending.spell, selection, settings);
  if (selection.confirmed !== true) return { preview: { spell: pending.spell, cells, routeId: routeOf(state, caster) },
    cells, requiresConfirmation: true, message: 'Confirm this placement?' };
  // Numeric overrides are reserved for the direct mishap API, not ordinary resolution options.
  const result = applyTierThreeBlast(state, caster, pending.spell, selection, { ...options, ...settings });
  caster.pendingSpell = null;
  return { ...result, pendingSpell: null, actionCost: 0 };
}
