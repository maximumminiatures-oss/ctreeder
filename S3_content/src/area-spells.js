import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollCheck, canMoveBetweenTiles } from './interactions.js';
import { castingBonus, canTouchCharacter } from './spell-effects.js';
import { wizardCastingMode, rollWizardMishaps, spellLockRemaining } from './wizard-mishaps.js';
import { blocksSpellTier } from './arcane-effects.js';
import { canAimAtSquare } from './targeting.js';
import { routeOf, routeStep, routeKey, sameRoute, routeExistsAt } from './underpasses.js';
import { getTile } from './state-schema.js';
import { isMimic } from './companions.js';
import { isFloatingDisc } from './floating-disc.js';
import { isIncorporeal, isSleeping, wakeCreature } from './conditions.js';
import { hasGrit } from './class-progression.js';
import { handItemKind, syncEquipmentLight } from './equipment.js';

export const AREA_SPELLS = new Set(['fixed object', 'knock', 'silence', 'web']);
export const AREA_CRITICAL_CHOICES = {
  'fixed object': [['duration', '10 Rounds']],
  knock: [['quiet', '25% Wandering Chance'], ['range', 'Also Affect Within 12 Squares Through Walls']],
  silence: [['area', '12 x 12 Area']],
  web: [['area', '12 x 12 Area']]
};
export const WEB_BURN_FADE_MS = 1500;
const alive = creature => creature && !creature.dead && !creature.slain && !creature.defeated && !creature.leftPeacefully && Number(creature.hp) > 0;
const creatures = state => [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')]
  .filter(creature => alive(creature) && !isFloatingDisc(creature));
const contains = (zone, point) => (zone.routeId || '') === (point.routeId || '') &&
  point.x >= zone.x && point.y >= zone.y && point.x < zone.x + zone.width && point.y < zone.y + zone.height;
const pointOf = (state, point) => ({ x: point.x, y: point.y, routeId: routeOf(state, point) });
const isBat = creature => /\bbats?\b|\bstingbat\b/i.test(`${creature?.name || ''} ${creature?.companion?.source?.name || ''}`);
const active = (state, zone) => {
  if (zone.burnedAt != null) return false;
  if (zone.spell !== 'silence') return zone.rounds > 0;
  const caster = (state.characters || []).find(member => member.id === zone.casterId);
  return alive(caster) && !isSleeping(caster, state) && caster.focusSpell?.spell === 'silence' && caster.focusSpell.areaId === zone.id;
};
export const activeAreaSpells = state => (state.areaSpells || []).filter(zone => active(state, zone));
export const isSilenced = (state, point) => activeAreaSpells(state).some(zone => zone.spell === 'silence' && contains(zone, pointOf(state, point)));
export const noiseIsSilenced = (state, origin) => isSilenced(state, origin);
export const silenceStealthSuccess = (state, creature) => /\bthief\b/i.test(creature?.className || creature?.class || '') && isSilenced(state, creature);

export function silenceBlocksAction(state, actor, { spellcasting = false, attack = '', ability = '' } = {}) {
  if (!isSilenced(state, actor)) return '';
  const text = [attack, ability].map(value => typeof value === 'string' ? value :
    [value?.name, value?.description, value?.type].filter(Boolean).join(' ')).join(' ');
  if (spellcasting || /\bspell\b/i.test(text)) return 'Spellcasting is impossible inside Silence.';
  if (/\b(?:vrock|harpy|siren|sphinx)\b/i.test(actor.name || actor.companion?.source?.name || '') && /screech|song|roar/i.test(text))
    return 'Silence prevents that sound-based ability.';
  return '';
}

export function castAreaSpell(state, caster, spell, options = {}) {
  spell = String(spell || '').trim().toLowerCase();
  if (!AREA_SPELLS.has(spell)) throw new Error('Unknown area spell.');
  if (caster.pendingSpell) throw new Error('Finish the pending spell first.');
  if ((caster.failedSpellKeys || []).includes(spell) || spellLockRemaining(caster, spell) || blocksSpellTier(caster, 2))
    throw new Error('This spell is unavailable until recovery.');
  const blocked = silenceBlocksAction(state, caster, { spellcasting: true });
  if (blocked) throw new Error(blocked);
  if (spell === 'silence') { caster.focusSpell = null; syncAreaSpellConditions(state); }
  const modifier = abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard');
  const check = (options.rollCheck || options.checkRoll || rollCheck)(modifier, wizardCastingMode(caster, 2, options.advantage === true, options.disadvantage));
  const succeeded = check.roll !== 1 && (check.roll === 20 || check.total >= 12);
  const result = { check, succeeded, critical: check.roll === 20, mishaps: [],
    message: `${caster.name} ${succeeded ? 'casts' : 'fails to cast'} ${spell}: ${check.total} vs DC 12.` };
  if (!succeeded) {
    caster.failedSpellKeys = [...new Set([...(caster.failedSpellKeys || []), spell])];
    if (check.roll === 1) result.mishaps = rollWizardMishaps(state, caster, spell, { ...options, tier: 2,
      knownSpells: String(caster.spellsKnown || '').split(/,\s*/),
      resolveMisfire: options.resolveMisfire || (() => ({ detail: `${spell} dissipates without a valid target.` })) });
    return result;
  }
  caster.pendingSpell = { spell, phase: result.critical ? 'critical' : ['silence', 'web'].includes(spell) ? 'placement' : 'targeting',
    castingTotal: check.total, tier: 2, size: 6, rounds: 5, radius: 12 };
  if (spell === 'knock' && !result.critical) return { ...result, ...applyKnock(state, caster, options) };
  return { ...result, message: `${result.message} ${result.critical ? 'Choose a critical effect.' : spell === 'fixed object' ? 'Pick carried gear or a floor item within touch range.' : 'Choose the center of the area, then confirm placement.'}` };
}

export function areaSpellPlacement(state, caster, { x, y, routeId } = {}, size = caster.pendingSpell?.size || 6) {
  if (![6, 12].includes(size) || !canAimAtSquare(state, caster, { x, y, routeId }, 12))
    throw new Error('Choose an area center within twelve squares and clear line of sight on the same route.');
  return { x: x - Math.floor(size / 2), y: y - Math.floor(size / 2), width: size, height: size,
    anchor: { x, y }, routeId: routeOf(state, caster) };
}

export function resolveAreaSpell(state, caster, selection = {}, options = {}) {
  const pending = caster.pendingSpell;
  if (!AREA_SPELLS.has(pending?.spell)) throw new Error('No area spell is pending.');
  if (pending.phase === 'critical') {
    if (!AREA_CRITICAL_CHOICES[pending.spell].some(([key]) => key === selection.choice)) throw new Error('Choose a valid critical effect.');
    pending.criticalChoice = selection.choice;
    if (pending.spell === 'fixed object') { pending.rounds = 10; pending.phase = 'targeting'; }
    else if (pending.spell === 'knock') return applyKnock(state, caster, { ...options, choice: selection.choice });
    else { pending.size = 12; pending.phase = 'placement'; }
    return { message: pending.phase === 'placement' ? 'Choose the center of the area, then confirm placement.' : 'Pick an object within touch range.' };
  }
  if (pending.spell === 'fixed object') return fixObject(state, caster, selection, options);
  if (!['silence', 'web'].includes(pending.spell) || pending.phase !== 'placement') throw new Error('That spell is not awaiting placement.');
  const rect = areaSpellPlacement(state, caster, selection, pending.size);
  const preview = { ...rect, spell: pending.spell, outlineColor: caster.colorValue || '#ffffff', fill: '#ffffff', fillOpacity: .1, exploredOnly: true };
  if (selection.confirmed !== true) return { preview, requiresConfirmation: true, message: 'Confirm this placement?' };
  const zone = { ...rect, id: `area-${crypto.randomUUID()}`, casterId: caster.id, spell: pending.spell,
    castingTotal: pending.castingTotal, color: caster.colorValue || '#ffffff',
    ...(pending.spell === 'web' ? { rounds: pending.rounds, escapedIds: [] } : {}) };
  state.areaSpells ||= []; state.areaSpells.push(zone);
  if (zone.spell === 'silence') caster.focusSpell = { spell: 'silence', areaId: zone.id, tier: 2, castingTotal: pending.castingTotal,
    critical: pending.criticalChoice === 'area', criticalChoice: pending.criticalChoice || null, focusedRounds: 0 };
  caster.pendingSpell = null;
  syncAreaSpellConditions(state);
  return { zone, actionCost: 0, message: `${zone.spell === 'web' ? 'Web' : 'Silence'} fills the selected area.` };
}

export const isFixedObject = entity => Number(entity?.fixedObject?.rounds) > 0;
export const fixedObjectAt = (state, point) => (state.entities || []).find(entity => isFixedObject(entity) &&
  entity.x === point.x && entity.y === point.y && sameRoute(state, entity, point)) || null;

function fixObject(state, caster, selection, { createDroppedItem } = {}) {
  const pending = caster.pendingSpell;
  let entity, carrier, item;
  if (Number.isInteger(selection.gearIndex)) {
    carrier = (state.characters || []).find(member => member.id === (selection.characterId || selection.targetId || caster.id));
    item = carrier?.gear?.[selection.gearIndex];
    if (!item || !canTouchCharacter(state, caster, carrier) || Number(item.totalUnits ?? item.quantity ?? 1) < 1)
      throw new Error('Choose carried gear within touch range.');
  } else {
    entity = (state.entities || []).find(target => target.id === selection.targetId &&
      (target.type === 'treasure' || target.subtype === 'dropped-equipment') && !target.collected);
    item = entity?.gearItem || entity;
    if (!entity || !canTouchCharacter(state, caster, entity)) throw new Error('Choose a floor item within touch range.');
  }
  const weight = Number(item.weightPounds ?? item.weightLb ?? item.weight);
  if (Number.isFinite(weight) && weight > 5) throw new Error('Fixed Object supports objects weighing at most five pounds.');
  if (carrier) {
    const point = { x: selection.x ?? carrier.x, y: selection.y ?? carrier.y, routeId: routeOf(state, carrier) };
    if (getTile(state, point.x, point.y)?.type !== 'floor' || !canTouchCharacter(state, caster, point))
      throw new Error('Place the object on a floor square within touch range.');
    const gearItem = { ...structuredClone(item), quantity: 1, totalUnits: 1, equipped: false };
    const units = Number(item.totalUnits ?? item.quantity ?? 1);
    if (units > 1 && gearItem.instanceId) gearItem.instanceId = crypto.randomUUID();
    entity = createDroppedItem ? createDroppedItem(gearItem, point, { caster, carrier }) : {
      id: `fixed-item-${crypto.randomUUID()}`, type: 'treasure', subtype: 'dropped-equipment', name: item.name,
      ...point, roomId: getTile(state, point.x, point.y).roomId ?? null, visible: true, revealed: true, gearItem,
      value: Number(item.value) || 0, slots: Number(item.slots) || 0 };
    if (!entity || typeof entity.id !== 'string' || (state.entities || []).some(other => other.id === entity.id) ||
      entity.x !== point.x || entity.y !== point.y || !sameRoute(state, entity, point)) throw new Error('The object could not be placed.');
    entity.gearItem ||= gearItem;
    const lightKind = handItemKind(gearItem);
    if (gearItem.lit && !gearItem.covered && ['torch', 'lantern'].includes(lightKind)) {
      entity.lightSource = lightKind; entity.lightRadius = lightKind === 'lantern' ? 12 : 6;
    }
    if (units > 1) {
      item.quantity = item.totalUnits = units - 1;
      item.equipped = false; item.lit = false;
    }
    else carrier.gear.splice(selection.gearIndex, 1);
    state.entities ||= []; state.entities.push(entity);
    syncEquipmentLight(carrier);
  }
  if (!isFixedObject(entity)) entity.fixedObject = { hadBlocksMovement: Object.hasOwn(entity, 'blocksMovement'), originalBlocksMovement: entity.blocksMovement };
  Object.assign(entity.fixedObject, { casterId: caster.id, rounds: pending.rounds, maxWeightPounds: 5000 });
  entity.blocksMovement = true;
  caster.pendingSpell = null;
  return { entity, message: `${entity.name || 'The object'} is fixed in place for ${entity.fixedObject.rounds} rounds.` };
}

function knockScope(state, caster, throughWalls) {
  const origin = pointOf(state, caster), tile = getTile(state, caster.x, caster.y);
  const room = (state.rooms || []).find(candidate => candidate.id === tile?.roomId && (candidate.routeId || '') === origin.routeId);
  const cells = new Set(), hallIds = new Set();
  if (!room) {
    const queue = [origin]; cells.add(routeKey(origin));
    for (let index = 0; index < queue.length; index++) {
      const from = queue[index], floor = getTile(state, from.x, from.y);
      if (floor?.hallId) hallIds.add(floor.hallId);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const to = routeStep(state, from, { x: from.x + dx, y: from.y + dy });
        const next = to && getTile(state, to.x, to.y);
        if (!to || to.routeId !== origin.routeId || next?.type !== 'floor' || !origin.routeId && next.roomId || cells.has(routeKey(to)) ||
          !canMoveBetweenTiles(state, from.x, from.y, to.x, to.y, { routeId: origin.routeId, ignoreClosedDoors: true, ignorePits: true }).ok) continue;
        cells.add(routeKey(to)); queue.push(to);
      }
    }
  }
  return entity => {
    const position = entity.targetEntityId ? (state.entities || []).find(other => other.id === entity.targetEntityId) || entity : entity;
    if (!sameRoute(state, origin, position)) return false;
    if (throughWalls && Math.hypot(position.x - caster.x, position.y - caster.y) <= 12) return true;
    if (room) return entity.roomId === room.id || getTile(state, position.x, position.y)?.roomId === room.id ||
      position.subtype === 'door' && [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => getTile(state, position.x + dx, position.y + dy)?.roomId === room.id);
    return cells.has(routeKey(pointOf(state, position))) ||
      position.subtype === 'door' && (hallIds.has(position.hallId) || (position.connectedHallIds || []).some(id => hallIds.has(id)) ||
        [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => cells.has(routeKey({ x: position.x + dx, y: position.y + dy, routeId: origin.routeId }))));
  };
}

export function applyKnock(state, caster, { choice, random = Math.random, wanderingCheck, onMimicRevealed } = {}) {
  const affects = knockScope(state, caster, choice === 'range'), revealed = [], opened = [], mimics = [];
  for (const entity of state.entities || []) {
    if (entity.collected || !affects(entity)) continue;
    if (entity.type === 'trap') { entity.revealed = true; entity.visible = true; revealed.push(entity.id); }
    if (entity.subtype === 'door' && !String(entity.doorKind || '').startsWith('stairs') && !entity.destroyed && !entity.gone) {
      if (entity.secret || entity.isSecret) { entity.secretFound = true; entity.revealed = true; }
      entity.doorState = 'open'; entity.everOpened = true; entity.visible = true; entity.locked = false;
      delete entity.transition; delete entity.holdPortal; opened.push(entity.id);
    } else if (/chest/i.test(`${entity.subtype || ''} ${entity.kind || ''} ${entity.name || ''}`) && entity.type !== 'monster') {
      entity.opened = true; entity.chestState = 'open'; entity.locked = false; opened.push(entity.id);
    }
    if (entity.type === 'monster' && isMimic(entity) && !entity.defeated) {
      entity.disguiseRevealed = true; entity.mimicDisguise = false; entity.revealed = true; entity.visible = true;
      if (entity.stealthState) entity.stealthState.revealed = true;
      mimics.push(entity.id); onMimicRevealed?.(entity);
    }
  }
  for (const member of state.characters || []) {
    member.stealthed = false;
    if (member.stealthState) member.stealthState.revealed = true;
    if (member.raw) member.raw.stealthed = false;
  }
  const chance = choice === 'quiet' ? .25 : .5;
  const noiseSuppressed = noiseIsSilenced(state, caster), wanderingTriggered = !noiseSuppressed && random() < chance;
  if (wanderingTriggered) wanderingCheck?.({ state, origin: pointOf(state, caster), chance, spell: 'knock' });
  caster.pendingSpell = null;
  return { revealed, opened, mimics, chance, noiseSuppressed, wanderingTriggered, message: 'Knock reveals traps and opens the surrounding doors and chests.' };
}

export function syncAreaSpellConditions(state) {
  const zones = activeAreaSpells(state), targets = creatures(state);
  for (const zone of zones.filter(zone => zone.spell === 'web')) zone.escapedIds = (zone.escapedIds || [])
    .filter(id => targets.some(creature => creature.id === id && contains(zone, pointOf(state, creature))));
  for (const creature of [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')]) {
    const inside = targets.includes(creature) ? zones.filter(zone => contains(zone, pointOf(state, creature))) : [];
    const webs = inside.filter(zone => zone.spell === 'web' && !isIncorporeal(creature) && !(zone.escapedIds || []).includes(creature.id)).map(zone => zone.id);
    const silence = inside.filter(zone => zone.spell === 'silence').map(zone => zone.id);
    if (webs.length || silence.length || creature.conditions?.webs || creature.conditions?.silenceAreas) creature.conditions ||= {};
    if (creature.conditions) {
      if (webs.length) creature.conditions.webs = webs; else delete creature.conditions.webs;
      if (silence.length) creature.conditions.silenceAreas = silence; else delete creature.conditions.silenceAreas;
      if (silence.length && isBat(creature)) {
        if (!creature.conditions.blind || creature.conditions.blind.source === 'silence')
          creature.conditions.blind = { source: 'silence', areaIds: silence };
      } else if (creature.conditions.blind?.source === 'silence') delete creature.conditions.blind;
    }
  }
}

export function isRestrainedByWeb(state, creature) {
  return !isFloatingDisc(creature) && !isIncorporeal(creature) && activeAreaSpells(state).some(zone => zone.spell === 'web' &&
    contains(zone, pointOf(state, creature)) && !(zone.escapedIds || []).includes(creature.id));
}
export const webStepBlock = (state, creature) => isRestrainedByWeb(state, creature) ? 'Escape the web with a Strength action before moving.' : '';

export function escapeWeb(state, creature, { rollCheck: checkRoll = rollCheck, advantage = false, disadvantage = false } = {}) {
  if (!alive(creature) || isSleeping(creature, state) || !isRestrainedByWeb(state, creature)) throw new Error('This creature cannot attempt to escape a web.');
  const modifier = creature.stats ? abilityScoreModifier(creature.stats.STR) : Number(creature.S ?? creature['**S**']) || 0;
  const advantaged = advantage || hasGrit(creature, 'STR');
  const check = checkRoll(modifier, { doubleRoll: advantaged && !disadvantage, disadvantage: disadvantage && !advantaged });
  const escapedIds = [];
  for (const zone of activeAreaSpells(state).filter(zone => zone.spell === 'web' && contains(zone, pointOf(state, creature)))) {
    if (check.total >= zone.castingTotal) { zone.escapedIds ||= []; if (!zone.escapedIds.includes(creature.id)) zone.escapedIds.push(creature.id); escapedIds.push(zone.id); }
  }
  syncAreaSpellConditions(state);
  return { check, escapedIds, escaped: !isRestrainedByWeb(state, creature), actionCost: 1, message: `${creature.name} tries to escape the web: ${check.total}.` };
}

export function igniteWebsAt(state, point, { random = Math.random, now = Date.now(), applyDamage, onDefeat } = {}) {
  const ignited = [], hits = [];
  for (const zone of activeAreaSpells(state).filter(zone => zone.spell === 'web' && contains(zone, pointOf(state, point)))) {
    zone.burnedAt = now; zone.burnFadeMs = WEB_BURN_FADE_MS; zone.rounds = 0; zone.escapedIds = []; ignited.push(zone.id);
    for (const creature of creatures(state).filter(creature => contains(zone, pointOf(state, creature)))) {
      const roll = Math.floor(random() * 6) + 1, before = Number(creature.hp);
      if (applyDamage) applyDamage(creature, roll, { sourceId: zone.casterId, damageType: 'fire', areaId: zone.id });
      else if ((state.characters || []).includes(creature)) setCharacterHp(creature, before - roll, { sourceId: zone.casterId, damageSource: 'fire' });
      else { creature.hp = Math.max(0, before - roll); wakeCreature(creature, state); }
      hits.push({ id: creature.id, areaId: zone.id, roll, damage: before - Number(creature.hp), defeated: creature.hp <= 0 });
      if (creature.hp <= 0) onDefeat?.(creature, zone);
    }
  }
  syncAreaSpellConditions(state);
  return { ignited, hits };
}

export function advanceAreaSpells(state, rounds = 1, { now = Date.now() } = {}) {
  if (!Number.isFinite(rounds) || rounds < 0) throw new Error('Area spell rounds must be non-negative.');
  for (const entity of state.entities || []) if (isFixedObject(entity)) {
    entity.fixedObject.rounds = Math.max(0, entity.fixedObject.rounds - rounds);
    if (!entity.fixedObject.rounds) {
      if (entity.fixedObject.hadBlocksMovement) entity.blocksMovement = entity.fixedObject.originalBlocksMovement;
      else delete entity.blocksMovement;
      delete entity.fixedObject;
    }
  }
  for (const zone of state.areaSpells || []) if (zone.spell === 'web' && zone.burnedAt == null) zone.rounds = Math.max(0, zone.rounds - rounds);
  state.areaSpells = (state.areaSpells || []).filter(zone => zone.burnedAt != null ? now < zone.burnedAt + zone.burnFadeMs : active(state, zone));
  syncAreaSpellConditions(state);
}

// Parent clips both fills and outlines to clipCells; no canvas/state mutation here.
export function areaSpellVisuals(state, { now = Date.now(), isExplored } = {}) {
  const explored = isExplored || ((point) => {
    const cells = state.visibility?.routeExplored?.[point.routeId] || (!point.routeId ? state.visibility?.exploredEver : null);
    return cells instanceof Set ? cells.has(`${point.x},${point.y}`) : Array.isArray(cells) && cells.includes(`${point.x},${point.y}`);
  });
  return (state.areaSpells || []).filter(zone => active(state, zone) || zone.burnedAt != null && now < zone.burnedAt + zone.burnFadeMs).map(zone => {
    const clipCells = [];
    for (let y = Math.max(0, zone.y); y < Math.min(state.map.height, zone.y + zone.height); y++)
      for (let x = Math.max(0, zone.x); x < Math.min(state.map.width, zone.x + zone.width); x++) {
        const point = { x, y, routeId: zone.routeId };
        if (routeExistsAt(state, x, y, zone.routeId) && explored(point)) clipCells.push(point);
      }
    return { id: zone.id, spell: zone.spell, rect: { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, routeId: zone.routeId,
      outlineColor: zone.color, lineWidth: 1, fill: zone.burnedAt != null ? '#ff0000' : '#ffffff', fillOpacity: zone.burnedAt != null ? .4 : .1,
      opacity: zone.burnedAt != null ? Math.max(0, 1 - (now - zone.burnedAt) / zone.burnFadeMs) : 1, exploredOnly: true, clipCells };
  });
}
