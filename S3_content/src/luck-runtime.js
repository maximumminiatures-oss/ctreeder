import {
  beginLuckEvent, captureLuckChange, finishLuckEvent, checkLuckEvent, consumeLuck,
  grantLuckToken as grantCoreLuckToken, isLuckResolution, LuckError, LUCK_HISTORY_LIMIT
} from './luck.js';

const own = (object, key) => Object.hasOwn(object || {}, key);
const refs = state => [...(state.characters || []), ...(state.entities || []).map(entity => entity.characterCorpse).filter(Boolean)];
const tokenFields = ['luckToken', 'luckTokens'];
const guardFields = ['maxHitPoints', 'conditions', 'dyingRounds', 'dead', 'slain', 'defeated', 'focusSpell', 'pendingSpell',
  'failedSpellKeys', 'spellLocks', 'wizardEffects', 'faithEffects', 'pendingFall', 'stats', 'gear',
  'bonuses', 'spellsKnown', 'learnedScrollSpells', 'transformationEffects', 'lastPitAscent'];
const positionFields = ['x', 'y', 'routeId', 'roomId'];
const rawFields = ['dyingRounds', 'dead', 'slain', 'conditions', 'focusSpell', 'pendingSpell', 'failedSpellKeys',
  'spellLocks', 'wizardEffects', 'faithEffects', 'pendingFall', 'stats', 'gear', 'bonuses', 'spellsKnown', 'learnedScrollSpells'];
const fault = (code, message) => { throw new LuckError(code, message); };

// Explicit top-level spent values win over stale raw mirrors. Never OR stale tokens back into existence.
export function hasRuntimeLuckToken(character) {
  const current = tokenFields.filter(key => own(character, key));
  const source = current.length ? character : character?.raw;
  const fields = current.length ? current : tokenFields.filter(key => own(source, key));
  return fields.length > 0 && fields.every(key => key === 'luckToken' ? source[key] === true : Number(source[key]) > 0);
}
function writeToken(character, available) {
  character.luckToken = available; character.luckTokens = available ? 1 : 0;
  character.raw ||= {};
  character.raw.luckToken = available; character.raw.luckTokens = available ? 1 : 0;
}
export function syncRuntimeLuckTokens(state) {
  for (const character of refs(state)) writeToken(character, hasRuntimeLuckToken(character));
}
export function grantRuntimeLuckToken(state, ownerId, { grantLuckToken = grantCoreLuckToken } = {}) {
  syncRuntimeLuckTokens(state);
  const added = grantLuckToken(state, ownerId);
  const owner = refs(state).find(character => character.id === ownerId);
  if (!owner) fault('missing-owner', 'Luck owner is missing.');
  writeToken(owner, true);
  return added;
}
function tokenProjection(state) {
  const copy = { ...state, characters: (state.characters || []).map(character => ({ ...character, raw: { ...character.raw } })),
    entities: (state.entities || []).map(entity => entity.characterCorpse ? { ...entity,
      characterCorpse: { ...entity.characterCorpse, raw: { ...entity.characterCorpse.raw } } } : entity) };
  syncRuntimeLuckTokens(copy); return copy;
}
export const checkRuntimeLuckEvent = (state, options) => checkLuckEvent(tokenProjection(state), options);

export function consumeRuntimeLuck(state, options = {}) {
  const snapshots = refs(state).map(character => ({ character,
    fields: tokenFields.map(key => [key, own(character, key), character[key]]),
    rawExists: own(character, 'raw'), raw: character.raw,
    rawFields: tokenFields.map(key => [key, own(character.raw, key), character.raw?.[key]]) }));
  syncRuntimeLuckTokens(state);
  try {
    const result = consumeLuck(state, options);
    // The core count is authoritative after spending/replacement; mirror it for normalization/UI.
    for (const character of refs(state)) writeToken(character, Number(character.luckTokens) > 0);
    return result;
  } catch (error) {
    for (const snapshot of snapshots) {
      for (const [key, exists, value] of snapshot.fields) {
        if (exists) snapshot.character[key] = value; else delete snapshot.character[key];
      }
      if (!snapshot.rawExists) delete snapshot.character.raw;
      else {
        snapshot.character.raw = snapshot.raw;
        for (const [key, exists, value] of snapshot.raw && typeof snapshot.raw === 'object' ? snapshot.rawFields : []) {
          if (exists) snapshot.raw[key] = value; else delete snapshot.raw[key];
        }
      }
    }
    throw error;
  }
}

export function runtimeLuckRef(state, actor) {
  for (const collection of ['characters', 'entities']) if ((state[collection] || []).includes(actor)) return { collection, id: actor.id };
  fault('missing-actor', 'The Luck actor must belong to the supplied state.');
}
export function captureRuntimeLuckActor(state, event, actor, { position = false } = {}) {
  const ref = runtimeLuckRef(state, actor), max = Number(actor.maxHitPoints);
  const clamps = { mode: 'compensate', min: 0, ...(Number.isFinite(max) && max > 0 ? { max } : {}) };
  if (Number.isFinite(actor.hp)) captureLuckChange(state, event, ref, ['hp'], clamps);
  captureLuckChange(state, event, ref, [...guardFields, ...(position ? positionFields : [])]);
  if (!actor.raw || typeof actor.raw !== 'object') captureLuckChange(state, event, ref, ['raw']);
  else {
    if (Number.isFinite(actor.raw.hp)) captureLuckChange(state, event, ref, ['raw.hp'], clamps);
    else captureLuckChange(state, event, ref, ['raw.hp']);
    captureLuckChange(state, event, ref, ['raw.maxHitPoints', ...rawFields.map(key => `raw.${key}`)]);
  }
  return event;
}
export function startRuntimeLuckEvent(state, { actor, target = null, capturePosition = false, captureTarget = true, ...options }) {
  if (isLuckResolution(state)) return null;
  syncRuntimeLuckTokens(state);
  const event = beginLuckEvent(state, { ...options, actor: runtimeLuckRef(state, actor),
    target: target ? runtimeLuckRef(state, target) : null });
  captureRuntimeLuckActor(state, event, actor, { position: capturePosition });
  if (captureTarget && target && target !== actor) captureRuntimeLuckActor(state, event, target, { position: capturePosition });
  return event;
}
export function finishRuntimeLuckEvent(state, event, result) {
  return event ? finishLuckEvent(state, event, { succeeded: typeof result === 'boolean' ? result : result.succeeded }) : null;
}

export function startLuckSave(state, actor, check, { dc = 15, context = {}, ...options } = {}) {
  if (!Number.isInteger(check?.roll) || check.roll < 1 || check.roll > 20) return null;
  const playerPaths = state.activeCharacterId === actor.id && state.player ? positionFields.map(key => ['player', key]) : [];
  const event = startRuntimeLuckEvent(state, { ...options, kind: 'save', actor, roll: check, dc,
    statePaths: [...(options.statePaths || []), ...playerPaths],
    naturalExtremes: false, capturePosition: true, context: { ...context,
      origin: { x: actor.x, y: actor.y, routeId: actor.routeId ?? '', roomId: actor.roomId ?? null } } });
  if (event && playerPaths.length) captureLuckChange(state, event, { collection: 'state' }, playerPaths);
  return event;
}
export function finishLuckSave(state, event, actor, outcome) {
  if (!event) return null;
  if (actor.pendingFall && !outcome.passed) actor.pendingFall.luckEventId = event.id;
  if (outcome.rolls) event.context.damageRolls = [...outcome.rolls];
  event.context.deferredFall = Boolean(actor.pendingFall);
  return finishRuntimeLuckEvent(state, event, outcome.passed);
}

// A delayed Feather Fall decision is part of the original save's consequences, not a second save roll.
export function continueLuckSave(state, actor, operation) {
  const original = state.luckJournal?.events.find(event => event.id === actor.pendingFall?.luckEventId && !event.used);
  if (!original || isLuckResolution(state)) return operation();
  const continuation = startLuckSave(state, actor, { roll: original.roll, modifier: original.modifier },
    { dc: original.dc, context: { saveType: 'continuation' } });
  const source = original.target && state[original.target.collection]?.find(entity => entity.id === original.target.id);
  if (source) captureLuckChange(state, continuation, original.target, ['fallingDamageNegated', 'featherFallTargetId']);
  const result = operation();
  const addition = finishRuntimeLuckEvent(state, continuation, false);
  const key = patch => `${patch.ref.collection}:${patch.ref.id || ''}:${(patch.path || []).join('.')}`;
  const patches = new Map(original.patches.map(patch => [key(patch), structuredClone(patch)]));
  for (const patch of addition.patches) {
    const previous = patches.get(key(patch));
    patches.set(key(patch), previous ? { ...previous, after: patch.after } : structuredClone(patch));
  }
  original.context.fallResolved = true;
  original.patches = [...patches.values()];
  state.luckJournal.events = state.luckJournal.events.filter(event => event !== addition);
  if (original.patches.length > 256 || new TextEncoder().encode(JSON.stringify(original)).length > 65536)
    state.luckJournal.events = state.luckJournal.events.filter(event => event !== original);
  state.luckJournal.events = state.luckJournal.events.slice(-LUCK_HISTORY_LIMIT);
  while (new TextEncoder().encode(JSON.stringify(state.luckJournal)).length > 262144) state.luckJournal.events.shift();
  return result;
}

function applyRecordedFailure(draft, event) {
  const createdEntities = [];
  for (const patch of event.patches) {
    if (patch.lifecycle) {
      const collection = draft[patch.ref.collection];
      const index = collection.findIndex(entity => entity.id === patch.ref.id);
      if (index >= 0) collection.splice(index, 1);
      if (patch.after.exists) { collection.push(structuredClone(patch.after.value)); createdEntities.push(patch.ref); }
      continue;
    }
    let object = patch.ref.collection === 'state' ? draft : draft[patch.ref.collection].find(actor => actor.id === patch.ref.id);
    for (const field of patch.path.slice(0, -1)) object = object[field] ||= {};
    const field = patch.path.at(-1);
    if (patch.mode === 'compensate') object[field] = Math.max(patch.min ?? -Infinity, Math.min(patch.max ?? Infinity,
      object[field] + patch.after.value - patch.before.value));
    else if (patch.after.exists) object[field] = structuredClone(patch.after.value);
    else delete object[field];
  }
  return { createdEntities };
}

export function resolveLuckSave(draft, info, { resolvePitSave, canStep, resolveSave } = {}) {
  if (info.event.kind !== 'save') fault('invalid-kind', 'This resolver only handles saving throws.');
  if (info.event.context.saveType === 'pit') {
    const pit = draft.entities.find(entity => entity.id === info.event.context.pitId);
    if (!pit) fault('missing-target', 'The original pit is no longer present.');
    if (!info.succeeded) return applyRecordedFailure(draft, info.event);
    if (typeof resolvePitSave !== 'function') fault('missing-resolver', 'Supply the pit save resolver.');
    const origin = info.event.context.origin;
    if (info.actor.x !== origin.x || info.actor.y !== origin.y || (info.actor.routeId || '') !== origin.routeId)
      fault('conflict', 'The creature moved after the original pit save.');
    return resolvePitSave(draft, pit, info.actor, { check: () => info.check,
      canStep: canStep ? (x, y, nx, ny, actor) => canStep(draft, actor || info.actor, x, y, nx, ny) : undefined });
  }
  if (typeof resolveSave === 'function') return resolveSave(draft, info);
  if (info.event.context.saveType === 'higher-mishap') return info.succeeded ? {} : applyRecordedFailure(draft, info.event);
  fault('missing-resolver', 'No resolver is registered for this saving throw.');
}

export function createLuckOutcomeResolver(handlers = {}) {
  return (draft, info) => {
    const handler = handlers[info.event.kind];
    if (typeof handler !== 'function') fault('missing-resolver', `No Luck resolver for ${info.event.kind}.`);
    return handler(draft, info);
  };
}
