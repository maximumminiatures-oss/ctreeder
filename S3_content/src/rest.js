import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollCheck } from './interactions.js';
import { recoverWizardSpells } from './wizard-mishaps.js';
import { learnQueuedScrolls } from './magic-items.js';
import { isFloatingDisc } from './floating-disc.js';
import { planRestScene } from './rest-scene.js';

export const REST_HOUR_MS = 1000;
export function restWatchSchedule(state, order = state.rest?.watchOrderIds || state.rest?.participantIds || []) {
  return Array.from({ length: 4 }, (_, shift) => ({
    firstHour: shift * 2 + 1,
    lastHour: shift * 2 + 2,
    characterIds: order.filter((id, index) => index % 4 === shift && state.characters.some(character =>
      character.id === id && !isFloatingDisc(character) && !character.dead && !character.slain))
  }));
}

export function restWatchCharacters(state, hour = Math.min(8, (state.rest?.hours || 0) + 1)) {
  const shift = Math.floor((Math.max(1, Math.min(8, hour)) - 1) / 2);
  const ids = restWatchSchedule(state)[shift].characterIds;
  return state.characters.filter(character => ids.includes(character.id));
}

export function buildRestWatchOrder(party, preferred = [], { ownership = {}, memberIds = [], initiatorId = null } = {}) {
  const ids = party.map(character => character.id);
  if (!Array.isArray(preferred) || preferred.length > 16 || preferred.some(id => typeof id !== 'string' || !ids.includes(id)) || new Set(preferred).size !== preferred.length) {
    throw new Error('Invalid rest watch order.');
  }
  const ordered = [...preferred, ...ids.filter(id => !preferred.includes(id))];
  if (!Object.keys(ownership).length) return ordered;
  const members = [...new Set([initiatorId, ...memberIds, ...ordered.map(id => ownership[id])].filter(Boolean))];
  const queues = members.map(member => ordered.filter(id => ownership[id] === member));
  const result = [];
  let next = 0;
  while (queues.some(queue => queue.length)) {
    // Start each four-shift cycle with another initiator character when available.
    if (result.length % 4 === 0 && queues[0]?.length) {
      result.push(queues[0].shift());
      if (next === 0) next = 1 % queues.length;
      continue;
    }
    while (!queues[next].length) next = (next + 1) % queues.length;
    result.push(queues[next].shift());
    next = (next + 1) % queues.length;
  }
  return [...result, ...ordered.filter(id => !result.includes(id))];
}
export function restInProgress(state) {
  return ['voting', 'sleeping'].includes(state.rest?.phase);
}
function units(item) {
  return Math.max(0, Math.floor(Number(item.totalUnits ?? item.quantity ?? 1) || 0));
}
function count(character, pattern) {
  return (character.gear || []).reduce((total, item) => total + (pattern.test(item.name || '') ? units(item) : 0), 0);
}
function supplyHolders(state, party) {
  return [...party, ...state.characters.filter(character => isFloatingDisc(character) && character.roomId === party[0]?.roomId)];
}

export function restSupplyStatus(state) {
  const party=(state.characters||[]).filter(character=>!isFloatingDisc(character)&&!character.dead&&!character.slain);
  const reusing=state.rest?.phase==='interrupted'&&state.rest.suppliesPaid&&
    state.rest.participantIds?.length===party.length&&party.every(character=>state.rest.participantIds.includes(character.id));
  const holders=supplyHolders(state,party);
  const torches=holders.reduce((total,character)=>total+count(character,/\btorch(?:es)?\b/i),0);
  const rations=holders.reduce((total,character)=>total+count(character,/\brations?\b/i),0);
  const rationShortfall=rations<party.filter(character=>!character.restRationPaid).length;
  return {partySize:party.length,torches,rations,reusing:Boolean(reusing),
    sufficient:party.length>0&&(reusing||torches>=3)&&!rationShortfall};
}
function consume(character, pattern, amount) {
  let left = amount;
  for (const item of character.gear || []) {
    if (!pattern.test(item.name || '')) continue;
    const taken = Math.min(left, units(item));
    const remaining = units(item) - taken;
    item.quantity = remaining;
    if ('totalUnits' in item) item.totalUnits = remaining;
    left -= taken;
    if (!left) break;
  }
  character.gear = character.gear.filter(item => units(item) > 0);
}

export function restingParty(state) {
  const party = state.characters.filter(character => !isFloatingDisc(character) && !character.dead && !character.slain);
  if (party.some(character => character.conditions?.sinkhole)) throw new Error('Rescue or climb out of the pit before resting.');
  if (!party.length || party.some(character => Number(character.hp) <= 0 || character.pendingSpell)) {
    throw new Error('Heal dying characters and finish pending spells before resting.');
  }
  const roomId = party[0].roomId;
  if (!roomId || !state.rooms.some(room => room.id === roomId) || party.some(character => character.roomId !== roomId)) {
    throw new Error('The entire party must gather in the same room to rest.');
  }
  const reusingCampfire = state.rest?.suppliesPaid && state.rest.phase === 'interrupted' &&
    state.rest.participantIds.length === party.length && party.every(character => state.rest.participantIds.includes(character.id));
  const neededRations=party.filter(character=>!character.restRationPaid).length;
  const holders=supplyHolders(state,party);
  if(holders.reduce((total,character)=>total+count(character,/\brations?\b/i),0)<neededRations)throw new Error('The party needs one ration per resting character.');
  if (!reusingCampfire && state.rest?.phase !== 'voting' && holders.reduce((total, character) => total + count(character, /\btorch(?:es)?\b/i), 0) < 3) throw new Error('The party needs three torches to rest.');
  return party;
}

export function beginPartyRest(state, { memberId = 'solo', requiredMemberIds = ['solo'], safe = false, watchOrderIds = [], ownership = {}, memberIds = [], now = Date.now() } = {}) {
  if (state.combat?.active) throw new Error('Rest is unavailable during combat.');
  if (restInProgress(state)) throw new Error('A rest is already in progress.');
  const party = restingParty(state);
  const suppliesPaid = Boolean(state.rest?.suppliesPaid && state.rest.phase === 'interrupted' &&
    state.rest.participantIds.length === party.length && party.every(character => state.rest.participantIds.includes(character.id)));
  const previousRest = state.rest;
  const orderedIds = suppliesPaid ? previousRest.watchOrderIds || previousRest.participantIds
    : buildRestWatchOrder(party, watchOrderIds, { ownership, memberIds, initiatorId: memberId });
  state.rest = { phase: 'voting', roomId: party[0].roomId, participantIds: party.map(character => character.id),
    requiredMemberIds: [...new Set([...requiredMemberIds, memberId])], acceptedMemberIds: [],
    hours: Math.min(...party.map(character => Number(character.restHours) || 0)), safe, suppliesPaid,
    x: party[0].x, y: party[0].y, watchOrderIds: orderedIds,
    interrupted: suppliesPaid && previousRest.interrupted === true };
  if (suppliesPaid && previousRest.scene) state.rest.scene = previousRest.scene;
  const alarm = [state.preparedAlarm, previousRest?.phase === 'interrupted' ? previousRest.alarm : null]
    .filter(entry => entry?.roomId === party[0].roomId)
    .sort((a, b) => b.encounterDivisor - a.encounterDivisor)[0];
  if (alarm?.roomId === party[0].roomId) state.rest.alarm = alarm;
  state.preparedAlarm = null;
  return acceptPartyRest(state, memberId, now);
}

export function acceptPartyRest(state, memberId, now = Date.now()) {
  const rest = state.rest;
  if (rest?.phase !== 'voting' || !rest.requiredMemberIds.includes(memberId)) throw new Error('There is no rest invitation for this player.');
  const party = restingParty(state);
  if (party.length !== rest.participantIds.length || party.some(character => !rest.participantIds.includes(character.id) || character.roomId !== rest.roomId)) {
    throw new Error('The party changed; cancel this rest and gather again.');
  }
  rest.acceptedMemberIds = [...new Set([...rest.acceptedMemberIds, memberId])];
  if (rest.requiredMemberIds.some(id => !rest.acceptedMemberIds.includes(id))) return 'Waiting for all connected players to accept rest.';
  const scene = rest.scene || planRestScene(state, rest, now);
  const holders=supplyHolders(state,party);
  if (!rest.suppliesPaid && holders.reduce((total, character) => total + count(character, /\btorch(?:es)?\b/i), 0) < 3) throw new Error('The party needs three torches to rest.');
  for (const character of party) {
    if (!character.restRationPaid) {
      const donor=[character,...holders.filter(other=>other!==character)].find(member=>count(member,/\brations?\b/i)>0);
      consume(donor,/\brations?\b/i,1);
    }
    character.restRationPaid = true;
  }
  let torches = rest.suppliesPaid ? 0 : 3;
  for (const character of holders) {
    const taken = Math.min(torches, count(character, /\btorch(?:es)?\b/i));
    consume(character, /\btorch(?:es)?\b/i, taken);
    torches -= taken;
  }
  rest.phase = 'sleeping';
  for (const character of state.characters.filter(member => rest.participantIds.includes(member.id))) {
    character.stealthed = false;
    if (character.stealthState) character.stealthState.revealed = true;
    if (character.raw) character.raw.stealthed = false;
  }
  rest.suppliesPaid = true;
  if (scene) {
    const fresh = !rest.scene;
    rest.scene = scene; rest.x = scene.x; rest.y = scene.y;
    if (!fresh) scene.startedAt = now - (scene.durationMs || 0);
    for (const place of scene.placements) {
      const character = state.characters.find(member => member.id === place.characterId);
      if (character) Object.assign(character, { x: place.x, y: place.y, roomId: rest.roomId });
    }
    rest.nextHourAt = now + REST_HOUR_MS + (fresh ? scene.durationMs || 0 : 0);
  } else rest.nextHourAt = now + REST_HOUR_MS;
  return `You've slept for ${rest.hours} of 8 hours.`;
}

export function cancelPartyRest(state, message = 'Rest cancelled. No recovery was granted.') {
  if (!restInProgress(state)) throw new Error('No rest is in progress.');
  if (state.rest.phase === 'sleeping') state.rest.interrupted = true;
  state.rest.phase = 'interrupted';
  state.rest.message = message;
  return message;
}

export function interruptPartyRest(state, check = rollCheck, { hour = Math.min(8, (state.rest?.hours || 0) + 1) } = {}) {
  const rest = state.rest;
  rest.interruptedWatchIds = restWatchCharacters(state, hour).map(character => character.id);
  rest.ambushPending = true;
  rest.interruptionChecks = state.characters.filter(character => rest.participantIds.includes(character.id) && !rest.interruptedWatchIds.includes(character.id) && !character.dead && !character.slain).map(character => {
    character.conditions ||= {}; character.conditions.prone = true;
    const result = check(abilityScoreModifier(character.stats?.CON));
    const passed = result.total >= 12;
    if (!passed) character.restFailed = true;
    return { characterId: character.id, name: character.name, result, passed };
  });
  return cancelPartyRest(state, `You've slept for ${rest.hours} of 8 hours. Rest paused by combat.`);
}

export function advancePartyRest(state, { now = Date.now(), encounter = () => false, interruptionCheck = rollCheck, onHour = () => {} } = {}) {
  const rest = state.rest;
  if (rest?.phase !== 'sleeping' || now < rest.nextHourAt) return null;
  while (rest.hours < 8 && now >= rest.nextHourAt) {
    rest.hours += 1;
    for (const character of state.characters.filter(character => rest.participantIds.includes(character.id))) {
      character.restHours = Math.min(8, (Number(character.restHours) || 0) + 1);
    }
    rest.nextHourAt += REST_HOUR_MS;
    onHour(rest.hours);
    if (rest.phase !== 'sleeping') return rest.message;
    if (!rest.safe && encounter(rest.hours)) {
      return interruptPartyRest(state, interruptionCheck, { hour: rest.hours });
    }
  }
  if (rest.hours < 8) return `You've slept for ${rest.hours} of 8 hours.`;
  const recovered = [], failed = [];
  rest.studyResults = [];
  for (const character of state.characters.filter(character => rest.participantIds.includes(character.id))) {
    if (!character.dead && !character.slain && Number(character.hp) > 0 && !character.restFailed) {
      setCharacterHp(character, character.maxHitPoints);
      character.halflingInvisibilityUsed = false;
      recoverWizardSpells(character);
      character.spellPenance = Object.fromEntries(Object.entries(character.spellPenance || {}).filter(([, entry]) => !entry.paid));
      recovered.push(character.name);
    } else failed.push(character.name);
    rest.studyResults.push(...learnQueuedScrolls(character));
    character.restHours = 0;
    character.restRationPaid = false;
    character.restFailed = false;
  }
  rest.phase = 'completed';
  rest.recoveredNames = recovered;
  rest.failedNames = failed;
  rest.message = rest.interrupted || failed.length ? "You've gotten what rest you can." : 'You were able to sleep peacefully';
  return rest.message;
}
