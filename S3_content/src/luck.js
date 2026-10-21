// Parent integration owns authorization, presentation, and recomputing derived visibility.
// Capture before the original effects, finish after them, then resolve synchronously
// against the supplied draft. Never call a resolver that closes over live state.
export const LUCK_HISTORY_LIMIT = 20;
const MAX_EVENT_BYTES = 65536;
const MAX_JOURNAL_BYTES = 262144;
const MAX_PATCHES = 256;
const KINDS = new Set(['party-attack', 'monster-attack', 'save', 'cast']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const WORLD_ROOTS = new Set(['characters', 'entities', 'luckJournal', 'tiles', 'map', 'rooms',
  'halls', 'decor', 'underpasses', 'visibility', 'width', 'height', 'seed', 'sharedRoom']);
const builders = new WeakMap();
const busyStates = new WeakSet();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export class LuckError extends Error {
  constructor(code, message) { super(message); this.name = 'LuckError'; this.code = code; }
}
function fail(code, message) { throw new LuckError(code, message); }
function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Set || b instanceof Set) return a instanceof Set && b instanceof Set &&
    a.size === b.size && [...a].every(value => b.has(value));
  if (a instanceof Map || b instanceof Map) return a instanceof Map && b instanceof Map &&
    a.size === b.size && [...a].every(([key, value]) => b.has(key) && equal(value, b.get(key)));
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
}
function boundedClone(value, limit = MAX_EVENT_BYTES) {
  const seen = new Set();
  function validate(item, depth = 0) {
    if (depth > 32) fail('too-large', 'Luck context is nested too deeply.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if ((!plain(item) && !Array.isArray(item)) || seen.has(item)) {
      fail('invalid-data', 'Luck context must contain only acyclic JSON values.');
    }
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (FORBIDDEN_KEYS.has(key)) fail('invalid-path', 'Unsafe Luck field.');
      // Existing runtime records sometimes contain optional undefined fields.
      // Like save serialization, omit those keys; never persist an undefined slot.
      if (child !== undefined || Array.isArray(item)) validate(child, depth + 1);
    }
    seen.delete(item);
  }
  validate(value);
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > limit) fail('too-large', 'Luck context exceeds its storage limit.');
  return JSON.parse(json);
}
function pathOf(value, statePath = false) {
  const path = Array.isArray(value) ? [...value] : typeof value === 'string' ? value.split('.') : [];
  if (!path.length || path.length > 16 || path.some(key => typeof key !== 'string' ||
    !key || /^\d+$/.test(key) || FORBIDDEN_KEYS.has(key))) fail('invalid-path', 'Invalid Luck field path (capture arrays as a whole).');
  if (statePath && WORLD_ROOTS.has(path[0])) fail('invalid-path', 'World geometry and journal fields cannot be captured.');
  if (!statePath && path[0] === 'id') fail('invalid-path', 'Actor identity cannot be rewritten by Luck.');
  return path;
}
function refOf(ref, allowState = false) {
  if (allowState && ref?.collection === 'state') return { collection: 'state' };
  if (!['characters', 'entities'].includes(ref?.collection) ||
    typeof ref.id !== 'string' || !ref.id || ref.id.length > 160) fail('invalid-ref', 'Luck requires a stable actor/entity ID.');
  return { collection: ref.collection, id: ref.id };
}
const refKey = ref => `${ref.collection}:${ref.id || ''}`;
function objectAt(state, ref) {
  if (ref.collection === 'state') return state;
  const matches = (state[ref.collection] || []).filter(item => item?.id === ref.id);
  if (matches.length > 1) fail('duplicate-id', 'Luck cannot resolve duplicate entity IDs.');
  return matches[0];
}
function slot(object, path) {
  let current = object;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !own(current, key)) return { exists: false };
    current = current[key];
  }
  return current === undefined ? { exists: false } : { exists: true, value: boundedClone(current) };
}
function writeSlot(object, path, value) {
  let current = object;
  for (const key of path.slice(0, -1)) {
    if (!plain(current[key])) current[key] = {};
    current = current[key];
  }
  if (value.exists) current[path.at(-1)] = structuredClone(value.value);
  else delete current[path.at(-1)];
}
function journal(state, create = false) {
  if (!state.luckJournal && create) state.luckJournal = { version: 1, sequence: 0, events: [] };
  const value = state.luckJournal;
  if (!value) return { version: 1, sequence: 0, events: [] };
  if (value.version !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
    !Array.isArray(value.events) || value.events.length > LUCK_HISTORY_LIMIT) fail('invalid-journal', 'Invalid Luck journal.');
  const ids = new Set();
  for (const event of value.events) {
    boundedClone(event);
    if (!KINDS.has(event.kind) || !Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
      event.sequence > value.sequence || event.id !== `luck-${event.sequence}` || ids.has(event.id) ||
      typeof event.used !== 'boolean' || typeof event.succeeded !== 'boolean' ||
      typeof event.naturalExtremes !== 'boolean' || !Number.isInteger(event.roll) || event.roll < 1 || event.roll > 20 ||
      !Number.isFinite(event.modifier) || !Number.isFinite(event.dc) ||
      !Array.isArray(event.scope) || !Array.isArray(event.statePaths) || !Array.isArray(event.patches) ||
      event.patches.length > MAX_PATCHES || (event.kind === 'monster-attack' ? !event.succeeded : event.succeeded)) {
      fail('invalid-journal', 'Invalid Luck event.');
    }
    ids.add(event.id);
    refOf(event.actor);
    if (event.target) refOf(event.target);
    event.scope.forEach(ref => refOf(ref));
    event.statePaths.forEach(path => pathOf(path, true));
    for (const patch of event.patches) {
      const ref = refOf(patch.ref, true);
      for (const snapshot of [patch.before, patch.after]) {
        if (!plain(snapshot) || typeof snapshot.exists !== 'boolean' || snapshot.exists && !own(snapshot, 'value')) {
          fail('invalid-journal', 'Invalid Luck field snapshot.');
        }
      }
      if (patch.lifecycle) {
        if (ref.collection === 'state') fail('invalid-journal', 'World lifecycle snapshots are forbidden.');
        for (const snapshot of [patch.before, patch.after]) {
          if (snapshot.exists && (!plain(snapshot.value) || snapshot.value.id !== ref.id)) fail('invalid-journal', 'Luck lifecycle identity mismatch.');
        }
      } else {
        pathOf(patch.path, ref.collection === 'state');
        if (!['guard', 'compensate'].includes(patch.mode)) fail('invalid-journal', 'Invalid Luck field mode.');
        if (patch.mode === 'compensate' && (!patch.before.exists || !patch.after.exists ||
          !Number.isFinite(patch.before.value) || !Number.isFinite(patch.after.value))) fail('invalid-journal', 'Invalid Luck numeric compensation.');
        if (['min', 'max'].some(key => own(patch, key) && !Number.isFinite(patch[key])) || patch.min > patch.max) fail('invalid-journal', 'Invalid Luck numeric clamps.');
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_JOURNAL_BYTES) fail('invalid-journal', 'Luck journal exceeds its storage limit.');
  return value;
}
function tokenHolder(state, ownerId) {
  refOf({ collection: 'characters', id: ownerId });
  const character = objectAt(state, { collection: 'characters', id: ownerId });
  if (character) return { character, ref: { collection: 'characters', id: ownerId } };
  const corpses = (state.entities || []).filter(entity => entity.characterCorpse?.id === ownerId);
  if (corpses.length > 1) fail('duplicate-id', 'Luck token owner has multiple corpses.');
  return corpses[0] ? { character: corpses[0].characterCorpse,
    ref: { collection: 'entities', id: corpses[0].id } } : null;
}
function tokens(character) {
  if (typeof character?.luckToken === 'boolean') return character.luckToken ? 1 : 0;
  if (typeof character?.raw?.luckToken === 'boolean') return character.raw.luckToken ? 1 : 0;
  return Number(character?.luckTokens ?? character?.raw?.luckTokens) > 0 ? 1 : 0;
}
function setTokens(character, count) {
  character.luckToken = count > 0;
  character.luckTokens = count;
  if (plain(character.raw)) { character.raw.luckToken = count > 0; character.raw.luckTokens = count; }
}
export function grantLuckToken(state, ownerId) {
  const holder = tokenHolder(state, ownerId);
  if (!holder) fail('missing-owner', 'Luck token owner is not in this party.');
  const added = tokens(holder.character) === 0;
  setTokens(holder.character, 1);
  return added;
}
export function isLuckResolution(state) { return busyStates.has(state); }

/** actor/target/scope use {collection:'characters'|'entities', id}.
 * context is compact resolver metadata, NOT a state snapshot. statePaths explicitly
 * allow bounded non-map writes, e.g. ['combat','player','arcaneHazards'].
 */
export function beginLuckEvent(state, options) {
  if (busyStates.has(state)) fail('busy', 'Cannot journal during Luck resolution.');
  if (!KINDS.has(options?.kind)) fail('invalid-kind', 'Unknown Luck roll kind.');
  const roll = typeof options.roll === 'object' ? options.roll?.roll : options.roll;
  const modifier = options.modifier ?? options.roll?.modifier ?? 0;
  if (!Number.isInteger(roll) || roll < 1 || roll > 20 || !Number.isFinite(modifier) ||
    !Number.isFinite(options.dc)) fail('invalid-roll', 'Luck requires a d20, modifier, and original DC.');
  const value = journal(state, true);
  const actor = refOf(options.actor);
  if (!objectAt(state, actor)) fail('missing-actor', 'Original Luck roller is missing.');
  const target = options.target ? refOf(options.target) : null;
  const event = {
    id: `luck-${++value.sequence}`, sequence: value.sequence, kind: options.kind,
    actor, target, roll, modifier, dc: options.dc,
    naturalExtremes: options.naturalExtremes ?? options.kind !== 'save',
    context: boundedClone(options.context || {}, 8192),
    scope: (options.scope || []).map(ref => refOf(ref)),
    statePaths: (options.statePaths || []).map(path => pathOf(path, true)),
    watches: [], finished: false
  };
  builders.set(event, state);
  return event;
}

/** Capture fields BEFORE effects. Use {lifecycle:true} with paths=[] for an entity
 * created/removed by the outcome. mode:'compensate' on finite numeric fields refunds
 * only this event's delta while preserving later changes; clamps are optional.
 */
export function captureLuckChange(state, event, reference, paths = [], options = {}) {
  if (builders.get(event) !== state || event.finished) fail('closed-event', 'Luck event is not open for this state.');
  const ref = refOf(reference, true);
  const object = objectAt(state, ref);
  if (options.lifecycle) {
    if (ref.collection === 'state') fail('invalid-path', 'Cannot snapshot the dungeon.');
    if (event.watches.some(watch => refKey(watch.ref) === refKey(ref))) fail('overlap', 'Luck captures cannot overlap.');
    event.watches.push({ ref, lifecycle: true, before: object ? { exists: true, value: boundedClone(object) } : { exists: false } });
    return event;
  }
  if (!object) fail('missing-actor', 'Capture requires an existing actor; use lifecycle for creation.');
  for (const value of paths) {
    let path = pathOf(value, ref.collection === 'state');
    // If a parent was absent, capture that missing branch so undo does not leave
    // an empty conditions/raw object that did not exist before this outcome.
    for (let length = 1; length < path.length; length += 1) {
      if (!slot(object, path.slice(0, length)).exists) { path = path.slice(0, length); break; }
    }
    if (event.watches.some(watch => refKey(watch.ref) === refKey(ref) && (watch.lifecycle ||
      path.every((key, index) => watch.path[index] === key) || watch.path.every((key, index) => path[index] === key)))) {
      fail('overlap', 'Luck captures cannot overlap.');
    }
    const mode = options.mode || 'guard';
    if (!['guard', 'compensate'].includes(mode)) fail('invalid-mode', 'Unknown Luck compensation mode.');
    const before = slot(object, path);
    if (mode === 'compensate' && (!before.exists || !Number.isFinite(before.value))) fail('invalid-mode', 'Compensation requires a numeric field.');
    const watch = { ref, path, mode, before };
    for (const key of ['min', 'max']) if (options[key] !== undefined) {
      if (!Number.isFinite(options[key])) fail('invalid-mode', 'Luck clamps must be finite.');
      watch[key] = options[key];
    }
    if (watch.min > watch.max) fail('invalid-mode', 'Invalid Luck clamp range.');
    event.watches.push(watch);
    if (event.watches.length > MAX_PATCHES) fail('too-large', 'Too many Luck fields.');
  }
  return event;
}
function fieldDiff(before, after, prefix = [], result = []) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const path = [...prefix, key];
    const a = own(before, key) && before[key] !== undefined ? { exists: true, value: before[key] } : { exists: false };
    const b = own(after, key) && after[key] !== undefined ? { exists: true, value: after[key] } : { exists: false };
    if (equal(a, b)) continue;
    pathOf(path);
    if (a.exists && b.exists && plain(a.value) && plain(b.value)) fieldDiff(a.value, b.value, path, result);
    else result.push({ path, before: boundedClone(a), after: boundedClone(b), mode: 'guard' });
    if (result.length > MAX_PATCHES) fail('too-large', 'Too many Luck field changes.');
  }
  return result;
}
export function finishLuckEvent(state, event, { succeeded }) {
  if (builders.get(event) !== state || event.finished) fail('closed-event', 'Luck event is not open for this state.');
  if (typeof succeeded !== 'boolean') fail('invalid-outcome', 'Luck requires the original success result.');
  event.finished = true;
  if (event.kind === 'monster-attack' ? !succeeded : succeeded) return null;
  const patches = [];
  for (const watch of event.watches) {
    const object = objectAt(state, watch.ref);
    if (watch.lifecycle) {
      const after = object ? { exists: true, value: boundedClone(object) } : { exists: false };
      if (watch.before.exists && after.exists) {
        patches.push(...fieldDiff(watch.before.value, after.value).map(patch => ({ ...patch, ref: watch.ref })));
      } else if (!equal(watch.before, after)) patches.push({ ...watch, after });
    } else {
      if (!object) fail('missing-actor', 'A removed actor requires a lifecycle capture.');
      const after = slot(object, watch.path);
      if (watch.mode === 'compensate' && (!after.exists || !Number.isFinite(after.value))) fail('invalid-mode', 'Compensated outcome must be numeric.');
      if (!equal(watch.before, after)) patches.push({ ...watch, after });
    }
  }
  if (patches.length > MAX_PATCHES) fail('too-large', 'Too many Luck outcome changes.');
  const { watches, finished, ...metadata } = event;
  const record = boundedClone({ ...metadata, succeeded, used: false, patches });
  const value = journal(state, true);
  value.events.push(record);
  value.events.sort((a, b) => a.sequence - b.sequence);
  while (value.events.length > LUCK_HISTORY_LIMIT || new TextEncoder().encode(JSON.stringify(value)).length > MAX_JOURNAL_BYTES) value.events.shift();
  return record;
}
function latest(state) { return [...journal(state).events].sort((a, b) => b.sequence - a.sequence).find(event => !event.used) || null; }
function conflictsFor(state, event) {
  const conflicts = [];
  for (const patch of event.patches) {
    const object = objectAt(state, patch.ref);
    const current = patch.lifecycle ? (object ? { exists: true, value: boundedClone(object) } : { exists: false }) : object ? slot(object, patch.path) : { exists: false };
    if (patch.mode === 'compensate' && object && current.exists && Number.isFinite(current.value)) continue;
    if (!equal(current, patch.after)) conflicts.push({ ref: patch.ref, path: patch.path || [], reason: 'changed-since-roll' });
    else if (!patch.lifecycle && !object) conflicts.push({ ref: patch.ref, path: patch.path, reason: 'missing-object' });
  }
  for (const ref of [event.actor, event.target].filter(Boolean)) {
    if (!objectAt(state, ref) && !event.patches.some(patch => patch.lifecycle && patch.before.exists && refKey(patch.ref) === refKey(ref))) {
      conflicts.push({ ref, path: [], reason: 'missing-target' });
    }
  }
  return conflicts;
}
export function checkLuckEvent(state, { ownerId } = {}) {
  try {
    const holder = tokenHolder(state, ownerId);
    if (!holder || !tokens(holder.character)) return { ok: false, reason: 'no-token', event: null, conflicts: [] };
    const event = latest(state);
    if (!event) return { ok: false, reason: 'no-event', event: null, conflicts: [] };
    const conflicts = conflictsFor(state, event);
    return { ok: !conflicts.length, reason: conflicts.length ? 'conflict' : null,
      event: boundedClone(event), conflicts };
  } catch (error) {
    if (!(error instanceof LuckError)) throw error;
    return { ok: false, reason: error.code, event: null, conflicts: [] };
  }
}
function undo(state, event) {
  // Recreate removed actors before restoring their fields; remove created aftermath last.
  for (const patch of [...event.patches].reverse()) {
    if (patch.lifecycle) {
      const collection = state[patch.ref.collection] ||= [];
      const index = collection.findIndex(item => item.id === patch.ref.id);
      if (patch.before.exists) {
        if (index >= 0) collection[index] = structuredClone(patch.before.value);
        else collection.push(structuredClone(patch.before.value));
      } else if (index >= 0) collection.splice(index, 1);
      continue;
    }
    const object = objectAt(state, patch.ref);
    if (patch.mode === 'compensate') {
      const current = slot(object, patch.path).value;
      const value = Math.max(patch.min ?? -Infinity, Math.min(patch.max ?? Infinity,
        current + patch.before.value - patch.after.value));
      writeSlot(object, patch.path, { exists: true, value });
    } else writeSlot(object, patch.path, patch.before);
  }
}
function allowedPath(path, allowed) { return allowed.some(prefix => prefix.every((key, index) => path[index] === key)); }
function freezeMetadata(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeMetadata); Object.freeze(value); }
  return value;
}
function resolutionPatches(before, after, event, ownerRefs, result) {
  const scopes = new Set([event.actor, event.target, ...event.scope, ...event.patches.map(patch => patch.ref), ...ownerRefs]
    .filter(ref => ref && ref.collection !== 'state').map(refKey));
  const created = new Set((result?.createdEntities || []).map(ref => refKey(refOf(ref))));
  const patches = [];
  for (const collection of ['characters', 'entities']) {
    const original = new Map((before[collection] || []).map(item => [item.id, item]));
    const next = new Map((after[collection] || []).map(item => [item.id, item]));
    if (original.size !== (before[collection] || []).length || next.size !== (after[collection] || []).length) fail('duplicate-id', 'Resolver produced duplicate IDs.');
    const surviving = items => items.filter(item => original.has(item.id) && next.has(item.id)).map(item => item.id);
    if (!equal(surviving(before[collection] || []), surviving(after[collection] || []))) fail('outside-scope', 'Luck resolver cannot reorder the party or map entities.');
    for (const id of new Set([...original.keys(), ...next.keys()])) {
      const a = original.get(id), b = next.get(id), ref = refOf({ collection, id });
      if (equal(a, b)) continue;
      if (!scopes.has(refKey(ref)) && !(b && !a && created.has(refKey(ref)))) fail('outside-scope', 'Luck resolver changed an undeclared actor.');
      if (!a || !b) patches.push({ ref, lifecycle: true, after: b ? { exists: true, value: boundedClone(b) } : { exists: false } });
      else patches.push(...fieldDiff(a, b).map(patch => ({ ...patch, ref })));
    }
  }
  const statePaths = [...event.statePaths, ...event.patches.filter(patch => patch.ref.collection === 'state').map(patch => patch.path)];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'characters' || key === 'entities' || equal(before[key], after[key])) continue;
    if (WORLD_ROOTS.has(key)) fail('outside-scope', 'Luck resolver cannot rewrite the world or journal.');
    const fields = fieldDiff(own(before, key) ? { [key]: before[key] } : {}, own(after, key) ? { [key]: after[key] } : {});
    for (const patch of fields) {
      if (!allowedPath(patch.path, statePaths)) fail('outside-scope', `Undeclared Luck state field: ${patch.path.join('.')}`);
      patches.push({ ...patch, ref: { collection: 'state' } });
    }
  }
  boundedClone(patches);
  return patches;
}

/** Authorization MUST happen before this call. applyOutcome(draft, info) must be
 * synchronous, mutate only actor/target/declared scope/statePaths, and return
 * {createdEntities:[{collection,id}]} for new aftermath entities. It receives a
 * single frozen-modifier d20 check: inject it into existing attack/cast/save
 * resolution, do not roll a second check or revalidate range/LOS. UI after return.
 * The staging clone is transient; only sparse patches are committed/journaled.
 */
export function consumeLuck(state, { ownerId, rollD20 = () => Math.floor(Math.random() * 20) + 1, applyOutcome } = {}) {
  if (busyStates.has(state)) fail('busy', 'Luck resolution is already running.');
  const eligible = checkLuckEvent(state, { ownerId });
  if (!eligible.ok) fail(eligible.reason, eligible.reason === 'conflict' ? 'Later changes conflict with this Luck outcome.' : 'No eligible Luck token or roll.');
  if (typeof applyOutcome !== 'function') fail('missing-resolver', 'Luck requires an outcome resolver.');
  busyStates.add(state);
  let draft;
  try {
    const event = freezeMetadata(eligible.event);
    draft = structuredClone(state);
    busyStates.add(draft);
    const originalOwner = tokenHolder(draft, ownerId);
    undo(draft, event);
    const owner = tokenHolder(draft, ownerId);
    if (!owner) fail('missing-owner', 'Cannot restore Luck token owner.');
    setTokens(owner.character, 0);
    const roll = rollD20();
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) fail('invalid-roll', 'Luck reroll must be one d20.');
    const succeeded = event.naturalExtremes && roll === 20 ? true : event.naturalExtremes && roll === 1 ? false : roll + event.modifier >= event.dc;
    const check = Object.freeze({ roll, firstRoll: roll, secondaryRoll: null, modifier: event.modifier,
      total: roll + event.modifier, checkMode: 'normal', rerolledFrom: event.roll });
    const info = { event, check, succeeded, favorable: event.kind === 'monster-attack' ? !succeeded : succeeded,
      actor: objectAt(draft, event.actor), target: event.target ? objectAt(draft, event.target) : null };
    const result = applyOutcome(draft, info);
    if (result && typeof result.then === 'function') fail('async-resolver', 'Luck resolvers must finish synchronously.');
    const finalOwner = tokenHolder(draft, ownerId);
    if (!finalOwner) fail('missing-owner', 'Resolver removed the token owner without preserving their corpse.');
    const replacementToken = roll === event.roll || roll === (event.kind === 'monster-attack' ? 1 : 20);
    setTokens(finalOwner.character, replacementToken ? 1 : 0);
    const patches = resolutionPatches(state, draft, event, [originalOwner.ref, owner.ref, finalOwner.ref], result);
    // No live writes occur before all undo, resolution, size, and scope checks pass.
    for (const patch of patches) {
      if (patch.lifecycle) {
        const collection = state[patch.ref.collection] ||= [];
        const index = collection.findIndex(item => item.id === patch.ref.id);
        if (patch.after.exists) collection.push(structuredClone(patch.after.value));
        else if (index >= 0) collection.splice(index, 1);
      } else writeSlot(objectAt(state, patch.ref), patch.path, patch.after);
    }
    const saved = journal(state).events.find(item => item.id === event.id);
    saved.used = true;
    saved.reroll = { roll, total: check.total, succeeded, replacementToken, ownerId };
    return { eventId: event.id, check, succeeded, favorable: info.favorable, replacementToken, result };
  } finally { busyStates.delete(state); if (draft) busyStates.delete(draft); }
}
