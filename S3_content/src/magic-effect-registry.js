import { activeAreaSpells, syncAreaSpellConditions } from './area-spells.js';
import { cleanupWizardTierTwoFocus } from './wizard-tier-two-focus.js';
import { cleanupPriestTierTwoFocus } from './priest-tier-two.js';
import { syncEquipmentLight } from './equipment.js';
import { isMagicItem } from './magic-items.js';
import { isMagicSuppressed, suppressMagic } from './magic-suppression.js';
import { routeOf } from './underpasses.js';
import { TORCH_DURATION_MS } from './timers.js';

const clone = value => structuredClone(value);
const key = (...parts) => parts.map(part => encodeURIComponent(String(part))).join(':');
const title = text => String(text || '').replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const spellKey = text => String(text || '').trim().toLowerCase().replace(/[-_]/g, ' ').replace('blind/deafen', 'blind deafen');
const present = effect => effect && (effect.rounds == null || Number(effect.rounds) > 0) &&
  (effect.remainingMs == null || Number(effect.remainingMs) > 0) && effect.active !== false && !effect.ended;
const living = actor => actor && !actor.dead && !actor.slain && !actor.defeated && !actor.leftPeacefully &&
  (actor.hp == null || Number(actor.hp) > 0);
const holders = state => [...(state.characters || []), ...(state.entities || []).filter(entity => !entity.collected && !entity.leftPeacefully)];
const targetFocusSpells = new Set(['acid arrow', 'hold person', 'blind deafen', 'detect thoughts', 'zone of truth', 'levitate']);

function recordIdentity(records, effect, index) {
  if (effect.id != null || effect.instanceId != null) return effect.id ?? effect.instanceId;
  const signature = record => key(spellKey(record.spell || record.type), record.type || '', record.casterId ?? '',
    record.targetId ?? '', record.kind ?? '');
  const identity = signature(effect);
  const occurrence = records.slice(0, index).filter(record => signature(record) === identity).length;
  return key(identity, occurrence);
}

function syncRaw(object, ...properties) {
  if (!object.raw) return;
  for (const property of properties) {
    if (Object.hasOwn(object, property)) object.raw[property] = clone(object[property]);
    else delete object.raw[property];
  }
}

function erase(object, property) {
  delete object[property];
  if (object.raw) delete object.raw[property];
}

function removeRecord(object, property, record) {
  const index = object[property]?.indexOf(record);
  if (index >= 0) object[property].splice(index, 1);
  syncRaw(object, property);
}

function finishFocus(state, caster, focus, options) {
  if (caster.focusSpell !== focus) return;
  caster.focusSpell = null;
  const pending = caster.pendingSpell;
  const sameSpell = pending?.spell === focus.spell &&
    (focus.spell !== 'illusion' || pending.focusId == null || pending.focusId === focus.id);
  if (pending && (focus.id != null && pending.focusId === focus.id || sameSpell)) {
    caster.pendingSpell = focus.suspendedPendingSpell || null;
  }
  syncRaw(caster, 'focusSpell', 'pendingSpell');
  options.onFocusEnd?.(state, caster, focus, options.reason || 'dispelled');
}

function detachFocusTarget(state, caster, focus, target, options) {
  focus.targetIds = (focus.targetIds || []).filter(id => id !== target.id);
  syncRaw(caster, 'focusSpell');
  if (!focus.targetIds.length) finishFocus(state, caster, focus, options);
  // The owning modules restore base conditions and retain other casters' sources.
  const cleanup = focus.spell === 'hold person' ? cleanupWizardTierTwoFocus :
    focus.spell === 'blind deafen' ? cleanupPriestTierTwoFocus : null;
  if (cleanup) {
    // These helpers normally sweep the board. Keep their source/base restoration
    // logic, but copy back only this target's conditions, not unrelated cleanup.
    const scope = { ...state, characters: clone(state.characters || []), entities: clone(state.entities || []),
      areaSpells: clone(state.areaSpells || []) };
    cleanup(scope);
    const restored = [...scope.characters, ...scope.entities].find(actor => actor.id === target.id);
    if (restored) target.conditions = restored.conditions;
  }
  syncRaw(target, 'conditions');
}

function dismissSummon(state, target) {
  for (const property of ['characters', 'entities']) {
    if (Array.isArray(state[property])) state[property] = state[property].filter(actor => actor !== target);
  }
  const combat = state.combat;
  if (combat) {
    for (const property of ['monsterIds', 'characterIds']) if (Array.isArray(combat[property]))
      combat[property] = combat[property].filter(id => id !== target.id);
    if (Array.isArray(combat.turnOrder)) {
      const before = combat.turnOrder.slice(0, combat.turnIndex || 0).filter(entry => entry.id === target.id).length;
      combat.turnOrder = combat.turnOrder.filter(entry => entry.id !== target.id);
      combat.turnIndex = Math.max(0, (combat.turnIndex || 0) - before);
    }
  }
  for (const owner of [state, ...holders(state)]) {
    if (owner.spellEffects?.some(effect => effect.kind === 'summon' && effect.targetId === target.id)) {
      owner.spellEffects = owner.spellEffects.filter(effect => effect.kind !== 'summon' || effect.targetId !== target.id);
      syncRaw(owner, 'spellEffects');
    }
  }
  // Dismissal is not defeat: never invoke death, corpse, loot, or revival code.
}

/**
 * Future effects may be stored in state.spellEffects or holder.spellEffects as
 * plain { id, spell, casterId, targetId, rounds?, kind?, x?, y?, routeId?,
 * width?, height?, sourceType? }. kind defaults to "spell"; "area" describes
 * its rectangle, "self" targets its owner, and "summon" dismisses targetId.
 * sourceType is descriptive provenance (for example "monster"), not casting
 * automation. Removing an ordinary record only removes that record; optional
 * onEffectEnd(state, descriptor) performs application-owned derived cleanup.
 * onCharmEnd(state, target, charm) owns companion-to-monster reversion and is
 * invoked before charm metadata is erased. onFocusEnd uses the existing API.
 */
function catalog(state) {
  const entries = [], actors = holders(state), byId = new Map(actors.map(actor => [actor.id, actor]));
  const add = (id, spell, point, data, end) => {
    const descriptor = { id, name: title(spell), spell: spellKey(spell), kind: 'spell', targetId: point.id,
      x: point.x ?? null, y: point.y ?? null, routeId: point.routeId ?? routeOf(state, point), ...data };
    entries.push({ descriptor, end });
  };
  const effectData = effect => ({ ...(effect.casterId != null ? { casterId: effect.casterId } : {}),
    ...(effect.rounds != null ? { remainingRounds: Number(effect.rounds) } : {}) });
  const lit = (Number(state.timers?.torchElapsedMs) || 0) < (Number(state.timers?.torchDurationMs) || TORCH_DURATION_MS);

  function objectEffects(object, holder, location, save, { itemIndex, itemName, labelName = itemName, wrapper } = {}) {
    const itemData = itemName ? { itemName, ...(itemIndex != null ? { itemIndex } : {}) } : {};
    for (const [property, spell] of [['holyWeapon', 'holy weapon'], ['cleansingWeapon', 'cleansing weapon'],
      ['holdPortal', 'hold portal'], ['fixedObject', 'fixed object']]) {
      const effect = object[property];
      if (!present(effect)) continue;
      add(key(holder.id, location, property, effect.id ?? effect.instanceId ?? 'effect'), spell, holder,
        { ...effectData(effect), ...itemData, ...(itemName ? { name: `${title(spell)} (${labelName})` } : {}) }, () => {
          if (property === 'fixedObject') {
            if (effect.hadBlocksMovement) object.blocksMovement = effect.originalBlocksMovement;
            else erase(object, 'blocksMovement');
            syncRaw(object, 'blocksMovement');
          }
          erase(object, property); save();
        });
    }
    if (object.lightSpellLit && lit) add(key(holder.id, location, 'lightSpellLit'), 'light', holder,
      { ...itemData, ...(itemName ? { name: `Light (${labelName})` } : {}) }, () => {
        erase(object, 'lightSpellLit');
        if (object.lightSource === 'light-spell') { object.lightSource = ''; object.lightRadius = 0; syncRaw(object, 'lightSource', 'lightRadius'); }
        if ((state.characters || []).includes(object) || object.gear) syncEquipmentLight(object);
        if (object.subtype === 'spell-light') state.entities = (state.entities || []).filter(entity => entity !== object);
        save();
        const active = (state.characters || []).find(actor => actor.id === state.activeCharacterId);
        if (active && state.player) Object.assign(state.player, { torchLit: Number(active.lightRadius) > 0,
          lightSource: active.lightSource || '', lightRadius: Number(active.lightRadius) || 0 });
      });
    const isScroll = [object.magic?.kind, object.type].some(value => String(value || '').toLowerCase() === 'scroll');
    const creature = (state.characters || []).includes(object) || object.type === 'monster';
    if (!creature && !object.gearItem && !isScroll &&
        (isMagicItem(object) || object.magicLock || object.magicalLock || object.magicallyLocked) && !isMagicSuppressed(object)) {
      const label = labelName || object.name || 'Magic item';
      add(key(holder.id, location, 'magic'), 'magic', holder,
        { kind: 'suppression', name: `${label} magic`, ...itemData }, () => {
          suppressMagic(wrapper || object, 10);
          syncRaw(object, 'magicSuppression', 'name'); save();
        });
    }
  }

  for (const holder of actors) {
    const illusion = holder.illusion;
    if (illusion && ['creature', 'floor', 'pit'].includes(illusion.kind)) {
      if (present(illusion) && living(holder)) {
        const creature = illusion.kind === 'creature';
        const footprint = creature && illusion.footprint === 3 ? 3 : 1;
        const inset = (footprint - 1) / 2;
        const name = `Illusion (${title(creature ? illusion.form : illusion.kind)})`;
        add(key('illusion', illusion.id), 'illusion', holder, {
          kind: creature ? 'summon' : 'area', name, displayName: name,
          casterId: illusion.casterId, illusionId: illusion.id,
          x: holder.x == null ? null : holder.x - (creature ? inset : 0),
          y: holder.y == null ? null : holder.y - (creature ? inset : 0),
          width: creature ? footprint : holder.width ?? 3,
          height: creature ? footprint : holder.height ?? 3
        }, options => {
          dismissSummon(state, holder);
          const caster = byId.get(illusion.casterId), focus = caster?.focusSpell;
          if (focus?.spell === 'illusion' && focus.illusionIds?.includes(illusion.id)) {
            focus.illusionIds = focus.illusionIds.filter(id => id !== illusion.id);
            syncRaw(caster, 'focusSpell');
            const pending = caster.pendingSpell;
            const awaitingPlacement = pending?.spell === 'illusion' && pending.focusId === focus.id &&
              Number(pending.remaining) > 0 && ['options', 'placement'].includes(pending.phase);
            if (!focus.illusionIds.length && !awaitingPlacement) finishFocus(state, caster, focus, options);
          }
          syncRaw(state, 'characters', 'entities');
        });
      }
      continue;
    }
    objectEffects(holder, holder, 'self', () => {});
    if (holder.gearItem) objectEffects(holder.gearItem, holder, 'gearItem', () => syncRaw(holder, 'gearItem', 'name', 'magicSuppression'),
      { itemName: holder.gearItem.name || holder.name, wrapper: holder });
    // Monster carriedGear is a legacy alias; an explicit gear array always wins.
    const inventoryKeys = [...(Array.isArray(holder.gear) ? ['gear'] : ['carriedGear']), 'treasures', 'magicItems'];
    const seen = new Set();
    for (const property of inventoryKeys) for (const [index, item] of (holder[property] || []).entries()) {
      if (!item || typeof item !== 'object' || seen.has(item)) continue;
      seen.add(item);
      objectEffects(item, holder, key(property, item.instanceId ?? index), () => {
        syncRaw(item, 'holyWeapon', 'cleansingWeapon', 'lightSpellLit', 'magicSuppression', 'name');
        syncRaw(holder, property);
        if (property === 'gear' && Array.isArray(holder.carriedGear)) {
          holder.carriedGear = holder.gear; syncRaw(holder, 'carriedGear');
        }
      }, { itemIndex: index, itemName: item.name || 'Item',
        labelName: (holder[property] || []).filter(other => other?.name === item.name).length > 1
          ? `${item.name || 'Item'} #${index + 1}` : item.name || 'Item' });
    }

    const sleeping = holder.conditions?.sleeping;
    if (sleeping?.source === 'sleep') add(key(holder.id, 'conditions', 'sleeping'), 'sleep', holder, effectData(sleeping), () => {
      delete holder.conditions.sleeping; syncRaw(holder, 'conditions');
    });
    if (present(holder.invisibility) && ['spell', 'potion', 'monster'].includes(holder.invisibility.source))
      add(key(holder.id, 'invisibility'), 'invisibility', holder,
        { ...effectData(holder.invisibility), sourceType: holder.invisibility.source }, () => erase(holder, 'invisibility'));
    if (holder.blessEffect && (Number(holder.luckTokens) > 0 || holder.luckToken === true))
      add(key(holder.id, 'blessEffect', holder.blessEffect.id ?? 'bless'), 'bless', holder, effectData(holder.blessEffect), () => {
        holder.luckToken = false; holder.luckTokens = 0; erase(holder, 'blessEffect'); syncRaw(holder, 'luckToken', 'luckTokens');
      });
    for (const property of ['wizardEffects', 'faithEffects', 'transformationEffects', 'potionEffects']) {
      for (const [index, effect] of (holder[property] || []).entries()) {
        if (!present(effect)) continue;
        // Wizard mishap records (lost spells, permanent injuries, etc.) are not active spells.
        if (property === 'wizardEffects' && effect.type !== 'mage-armor') continue;
        const spell = spellKey(effect.spell || effect.type);
        if (!spell) continue;
        const caster = byId.get(effect.casterId), focus = caster?.focusSpell;
        if (spell === 'levitate' && (!living(caster) || focus?.spell !== spell || !focus.targetIds?.includes(holder.id))) continue;
        add(key(holder.id, property, recordIdentity(holder[property], effect, index)), spell, holder,
          { ...effectData(effect), ...(property === 'potionEffects' ? { sourceType: 'potion', name: `${title(spell)} (Potion)` } : {}) }, options => {
            removeRecord(holder, property, effect);
            if (spell === 'alter self') {
              if (effect.originalAncestry != null) { holder.ancestry = effect.originalAncestry; syncRaw(holder, 'ancestry'); }
              if (holder.invisibility?.source === 'alter-self-gills') erase(holder, 'invisibility');
            }
            if (property === 'potionEffects' && effect.type === 'giant-strength' && effect.originalStrength != null) {
              holder.stats.STR = effect.originalStrength; syncRaw(holder, 'stats');
            }
            if (spell === 'levitate') detachFocusTarget(state, caster, focus, holder, options);
          });
      }
    }
    if (present(holder.turnedUndead)) add(key(holder.id, 'turnedUndead'), 'turn undead', holder,
      effectData(holder.turnedUndead), () => erase(holder, 'turnedUndead'));
    const charm = holder.charm || holder.companion?.charm;
    if (present(charm)) add(key(holder.id, 'charm'), 'charm person', holder, effectData(charm), options => {
      options.onCharmEnd?.(state, holder, clone(charm));
      erase(holder, 'charm');
      if (holder.companion) { delete holder.companion.charm; if (holder.companion.source) delete holder.companion.source.charm; }
      syncRaw(holder, 'companion');
      if (holder.type === 'monster') holder.attitude = 'suspicious';
    });
    if (holder.summon && present(holder.summon) && (holder.summon.kind === 'floating-disc' || living(holder))) {
      const disc = holder.summon.kind === 'floating-disc';
      add(key(holder.id, 'summon', holder.summon.id ?? holder.summon.kind ?? 'summon'),
        disc ? 'floating disc' : holder.summon.spell || 'summon', holder,
        { kind: 'summon', ...effectData(holder.summon), name: disc ? 'Floating Disc' : `${title(holder.summon.spell || 'Summon')} (${holder.name || holder.id})` }, () => {
          if (disc) { holder.summon.remainingMs = 0; syncRaw(holder, 'summon'); return { removedDisc: holder }; }
          dismissSummon(state, holder);
        });
    }

    const focus = holder.focusSpell;
    if (!focus || !living(holder)) continue;
    if (targetFocusSpells.has(focus.spell)) {
      for (const targetId of new Set(focus.targetIds || [])) {
        const target = byId.get(targetId);
        if (!living(target) || focus.spell === 'levitate' && target.transformationEffects?.some(effect => effect.spell === 'levitate' && effect.casterId === holder.id)) continue;
        add(key(holder.id, 'focusSpell', focus.id ?? focus.spell, targetId), focus.spell, target,
          { casterId: holder.id, focusId: focus.id ?? null }, options => detachFocusTarget(state, holder, focus, target, options));
      }
    } else if (!['silence', 'illusion'].includes(focus.spell) && focus.spell) {
      add(key(holder.id, 'focusSpell', focus.id ?? focus.spell), focus.spell, holder,
        { casterId: holder.id, kind: 'focus', ...(focus.radius != null ? { radius: focus.radius } : {}) },
        options => finishFocus(state, holder, focus, options));
    }
  }

  for (const zone of activeAreaSpells(state)) add(key('areaSpells', zone.id), zone.spell, zone,
    { kind: 'area', ...effectData(zone), width: zone.width, height: zone.height }, options => {
      state.areaSpells = (state.areaSpells || []).filter(other => other !== zone);
      if (state.raw) syncRaw(state, 'areaSpells');
      const caster = byId.get(zone.casterId), focus = caster?.focusSpell;
      if (focus?.areaId === zone.id) finishFocus(state, caster, focus, options);
      syncAreaSpellConditions(state);
      for (const actor of actors) syncRaw(actor, 'conditions');
    });

  for (const [owner, location] of [[state, 'state'], ...actors.map(actor => [actor, actor.id])]) {
    for (const [index, effect] of (owner.spellEffects || []).entries()) {
      if (!present(effect) || !effect.spell) continue;
      const kind = effect.kind || 'spell', target = byId.get(effect.targetId) || (owner === state ? effect : owner);
      if (kind !== 'area' && effect.targetId != null && !byId.has(effect.targetId)) continue;
      if (kind === 'summon' && !living(byId.get(effect.targetId))) continue;
      if (kind === 'summon' && target.summon && entries.some(entry => entry.descriptor.targetId === target.id && entry.descriptor.kind === 'summon')) continue;
      const area = kind === 'area', point = area ? effect : target;
      const id = key(location, 'spellEffects', recordIdentity(owner.spellEffects, effect, index));
      add(id, effect.spell, point, { ...effectData(effect), kind,
        targetId: area ? effect.id ?? id : effect.targetId ?? target.id ?? id,
        ...(effect.sourceType ? { sourceType: effect.sourceType } : {}),
        ...(effect.name ? { name: effect.name } : {}),
        ...(area ? { width: effect.width ?? 1, height: effect.height ?? 1 } : {}) }, () => {
          removeRecord(owner, 'spellEffects', effect);
          if (kind === 'summon') dismissSummon(state, target);
        });
    }
  }
  for (const [owner, property] of [[state, 'preparedAlarm'], [state.rest, 'alarm']]) {
    const alarm = owner?.[property], caster = byId.get(alarm?.casterId);
    if (alarm && caster) add(key('alarm', property, alarm.id ?? alarm.casterId), 'alarm', caster,
      { casterId: alarm.casterId, roomId: alarm.roomId }, () => erase(owner, property));
  }
  return entries;
}

// IDs are opaque capabilities looked up afresh, never evaluated as object paths.
export function listMagicEffects(state) {
  return catalog(state).map(entry => entry.descriptor);
}

export function endMagicEffect(state, effectId, options = {}) {
  const entry = typeof effectId === 'string' && catalog(state).find(candidate => candidate.descriptor.id === effectId);
  if (!entry) throw new Error('That magic effect is no longer active.');
  const extra = entry.end(options) || {};
  options.onEffectEnd?.(state, entry.descriptor);
  return { effect: entry.descriptor, message: entry.descriptor.kind === 'suppression'
    ? `${entry.descriptor.name} is suppressed for 10 rounds.` : `${entry.descriptor.name} ends.`, ...extra };
}
