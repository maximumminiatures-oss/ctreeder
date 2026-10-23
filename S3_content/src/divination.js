import { unweightedTreasureNames } from './treasure.js';
import { isFloatingDisc } from './floating-disc.js';
import { isSleeping } from './conditions.js';
import { revealSecretDoor } from './interactions.js';

export const ZONE_TRUTH_COLORS = Object.freeze([
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'black', 'white',
  'gray', 'cyan', 'magenta', 'teal', 'indigo', 'violet', 'gold', 'silver', 'maroon', 'turquoise'
]);

const nonnegative = value => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};
const hp = creature => nonnegative(creature?.hp ?? creature?.maxHp ?? creature?.maxHitPoints ?? 1);
const alive = creature => creature && !creature.dead && !creature.slain && !creature.defeated && hp(creature) > 0;
const level = creature => Math.max(0.25, nonnegative(creature?.level ?? creature?.lv ?? creature?.['**LV**'] ?? 1));
const health = creature => Math.min(1, hp(creature) / Math.max(1, nonnegative(creature?.maxHitPoints ?? creature?.maxHp ?? hp(creature))));
const party = state => (state?.characters || []).filter(character => !isFloatingDisc(character));
const sourceId = character => character?.companion?.sourceMonsterId ?? character?.companion?.source?.id ?? character.id;
const groupKey = creature => `${creature.routeId || ''}:${creature.roomId ? `room:${creature.roomId}` : creature.hallId ? `hall:${creature.hallId}` : `creature:${creature.id}`}`;
const charmActive = creature => Boolean(creature?.charm && !creature.charm.brokenByParty &&
  (creature.charm.remainingMs == null || Number(creature.charm.remainingMs) > 0));
const peaceful = creature => creature.departing || creature.leftPeacefully || charmActive(creature) ||
  ['friendly', 'neutral', 'curious'].includes(creature.attitude);

// Values are current authoritative GP totals, not unidentified sale offers or nested copies.
// Future random monster drops and inventory that has not become floor treasure are excluded.
export function remainingTreasureValue(state) {
  let total = 0;
  for (const entity of state?.entities || []) {
    if (entity.type !== 'treasure' || entity.collected || entity.destroyed) continue;
    if (entity.value != null) total += nonnegative(entity.value);
    else if (entity.coinBreakdown) total += nonnegative(entity.coinBreakdown.gold) +
      nonnegative(entity.coinBreakdown.silver) / 10 + nonnegative(entity.coinBreakdown.copper) / 100;
    else total += nonnegative(entity.gearItem?.value);
  }
  return Math.round(total * 100) / 100;
}

// Literal living monsters, including sleeping/charmed/friendly monsters and companions.
// A recruited monster moved from entities to characters is counted once by source ID.
export function remainingMonsterCount(state) {
  const companions = party(state).filter(character => character.companion);
  const represented = new Set(companions.map(sourceId));
  const seen = new Set();
  let count = 0;
  for (const creature of state?.entities || []) {
    if (creature.type !== 'monster' || represented.has(creature.id) || creature.leftPeacefully || !alive(creature)) continue;
    if (creature.id != null && seen.has(creature.id)) continue;
    if (creature.id != null) seen.add(creature.id);
    count++;
  }
  for (const character of companions) {
    const id = sourceId(character);
    if (!alive(character) || seen.has(id)) continue;
    seen.add(id);
    count++;
  }
  return count;
}

// Heuristic about continuing to seek this dungeon's treasure, not a combat simulation.
// Four full-health, awake adventurers of the dungeon's level facing one same-level
// foe per encounter have threatRatio 1 (Possibly), independent of the room count.
export function auguryAssessment(state, { critical = false } = {}) {
  const characters = party(state);
  const allies = characters.filter(character => character.companion?.kind !== 'doppelganger');
  const ready = allies.filter(character => alive(character) && !isSleeping(character, state) &&
    !character.conditions?.paralyzed);
  const partyStrength = ready.reduce((sum, character) => sum + level(character) * health(character), 0);
  const survivors = allies.filter(character => !character.dead && !character.slain && !character.defeated);
  const healthyPartyStrength = survivors.reduce((sum, character) => sum + level(character), 0);
  const partyHealthFraction = healthyPartyStrength ? survivors.reduce((sum, character) => sum + level(character) * health(character), 0) / healthyPartyStrength : 0;
  const companionIds = new Set(characters.filter(character => character.companion).map(sourceId));
  const monsters = (state?.entities || []).filter(entity => entity.type === 'monster' && !companionIds.has(entity.id));
  const potential = monsters.filter(creature => !peaceful(creature));
  const enemies = potential.filter(alive);
  // An infiltrating doppelganger is a threat, not an extra adventurer's strength.
  for (const character of characters.filter(character => character.companion?.kind === 'doppelganger' && alive(character))) {
    const source = character.companion.source || {};
    const enemy = { ...source, id: sourceId(character), hp: character.hp,
      maxHp: character.maxHitPoints, roomId: character.roomId, routeId: character.routeId };
    potential.push(enemy); enemies.push(enemy);
  }
  const groups = new Map();
  for (const enemy of enemies) groups.set(groupKey(enemy), (groups.get(groupKey(enemy)) || 0) + level(enemy) * health(enemy));
  const encounterCount = groups.size;
  const originalEncounterCount = Math.max(encounterCount, new Set(potential.map(groupKey)).size);
  const roomCount = (state?.rooms || []).filter(room => room.id !== state?.generation?.entranceRoomId).length;
  const enemyStrength = [...groups.values()].reduce((sum, strength) => sum + strength, 0);
  const meanEncounterStrength = encounterCount ? enemyStrength / encounterCount : 0;
  // Cleared encounters reduce attrition; they do not erase the remaining peak encounter.
  const remainingEncounterFraction = originalEncounterCount ? encounterCount / originalEncounterCount : 0;
  const attritionFactor = Math.sqrt(remainingEncounterFraction);
  const threatRatio = partyStrength > 0 ? 4 * meanEncounterStrength * attritionFactor / partyStrength : enemies.length ? Infinity : 0;
  const peakThreatRatio = partyStrength > 0 ? 4 * Math.max(0, ...groups.values()) / partyStrength : enemies.length ? Infinity : 0;
  const treasureGp = remainingTreasureValue(state);
  const budgetGp = nonnegative(state?.generation?.treasureActualGp ?? state?.generation?.treasureTargetGp) ||
    Math.max(1, nonnegative(state?.level) || 1) * 4000;
  const remainingTreasureFraction = Math.min(1, treasureGp / budgetGp);
  let answer = 'possibly', reason;
  if (!ready.length || partyStrength <= 0) {
    answer = 'no'; reason = 'No conscious, able party member is ready to continue.';
  } else if (!treasureGp) {
    answer = 'no'; reason = 'No uncollected treasure value remains to justify further treasure-seeking.';
  } else if (partyHealthFraction <= 0.25) {
    answer = 'no'; reason = 'The party has at most one quarter of its health left; recover before risking traps or other hazards, even if no enemies remain.';
  } else if (!enemies.length) {
    answer = 'yes'; reason = 'Treasure remains and no living enemies are counted as threats; traps may still be dangerous.';
  } else if (threatRatio > 1.5) {
    answer = 'no'; reason = 'The remaining encounter pressure is more than one and a half times the party\'s health-adjusted strength.';
  } else if (threatRatio < 1 / 1.5 && peakThreatRatio <= 1.5 && remainingTreasureFraction >= 0.25) {
    answer = 'yes'; reason = 'Remaining encounter pressure is below two thirds of the party\'s health-adjusted strength, with a meaningful treasure share left.';
  } else {
    reason = 'The balance of danger, current party health, and remaining treasure is uncertain.';
  }
  const assumptions = [
    'This estimates continuing to seek the remaining treasure, not a particular route or proposed action.',
    'Encounter groups use room or hall and route IDs; ungrouped monsters are separate encounters.',
    'Level and remaining HP approximate strength; four healthy, awake adventurers are the baseline.',
    'Sleeping enemies still count because they can wake; sleeping or paralyzed allies are not ready to act.',
    'Friendly and actively charmed monsters are not enemy threats; recruited allies can support the party.',
    'Traps, equipment, spells, terrain, future wandering monsters, and player tactics are not simulated.'
  ];
  const metrics = { partyStrength, partyHealthFraction, readyPartyCount: ready.length, sleepingPartyCount: allies.filter(character => isSleeping(character, state)).length,
    enemyCount: enemies.length, enemyStrength, encounterCount, originalEncounterCount, roomCount,
    meanEncounterStrength, remainingEncounterFraction, threatRatio, peakThreatRatio,
    treasureGp, budgetGp, remainingTreasureFraction };
  const clearer = critical ? ` ${enemies.length} living threats remain in ${encounterCount} encounter groups, with ${treasureGp} gold pieces uncollected. ` +
    (partyStrength ? `Encounter pressure is ${Number.isFinite(threatRatio) ? threatRatio.toFixed(2) : 'unbounded'} times the baseline for this party. ` : '') +
    (answer === 'no' ? 'Recover or withdraw before pressing on.' : answer === 'yes' ? 'Proceed carefully; this is not a guarantee of safety.' : 'Recover, scout, and reassess before committing.') : '';
  const explanation = `${reason}${clearer} This is a heuristic, not a simulated outcome.`;
  return { answer, explanation, message: `${answer[0].toUpperCase()}${answer.slice(1)}. ${explanation}`,
    critical: Boolean(critical), metrics, assumptions };
}

function randomFraction(rng) {
  const value = typeof rng === 'function' ? rng() : rng?.nextFloat?.();
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Random source must return a number from zero to one.');
  return value;
}

const questionAliases = new Map([
  ['treasure_value', 'treasure'], ['remaining_treasure', 'treasure'],
  ['monsters_alive', 'monsters'], ['remaining_monsters', 'monsters'],
  ['favorite_color', 'color'], ['favourite_color', 'color'], ['favourite_colour', 'color'],
  ['favorite_treasure', 'desired_treasure'], ['favourite_treasure', 'desired_treasure']
]);

// Engine owns combat/language/Focus-round gates. Adapter:
// answerQuestion: (state, caster, target, key) => zoneTruthAnswer(state, target, key).
// rng accepts Math.random-style functions or SeededRng.nextFloat(). Only secret_doors
// mutates state, through the existing reveal helper; all results include reply/message.
export function zoneTruthAnswer(state, target, question, { rng = Math.random } = {}) {
  const rawKey = String(question || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  const key = questionAliases.get(rawKey) || rawKey;
  let reply, queryData = {};
  if (key === 'treasure') {
    const treasureValue = remainingTreasureValue(state);
    const factor = 0.9 + randomFraction(rng) * 0.2;
    // Round within the permitted +/-10% interval, including copper-sized totals.
    const low = Math.ceil(treasureValue * 90 - 1e-8) / 100;
    const high = Math.floor(treasureValue * 110 + 1e-8) / 100;
    const estimate = Math.max(low, Math.min(high, Math.round(treasureValue * factor * 100) / 100));
    reply = `Our treasure? Oh. The total gold piece value is probably about: ${estimate} gold pieces.`;
    queryData = { treasureValue, estimate };
  } else if (key === 'monsters') {
    const monsterCount = remainingMonsterCount(state);
    reply = `My friends? Well, there are ${monsterCount} of them you haven't slain.`;
    queryData = { monsterCount };
  } else if (key === 'color') {
    const color = ZONE_TRUTH_COLORS[Math.min(ZONE_TRUTH_COLORS.length - 1, Math.floor(randomFraction(rng) * ZONE_TRUTH_COLORS.length))];
    reply = `Oh, thanks for asking. I like ${color}.`;
    queryData = { color };
  } else if (key === 'desired_treasure') {
    const names = unweightedTreasureNames(state);
    const item = names[Math.min(names.length - 1, Math.floor(randomFraction(rng) * names.length))];
    reply = `${item}.`;
    queryData = { item };
  } else if (key === 'secret_doors') {
    const doors = (state?.entities || []).filter(entity => entity.subtype === 'door' && entity.secret === true &&
      !entity.secretFound && !entity.revealed);
    for (const door of doors) revealSecretDoor(door, state, { roomId: door.roomId });
    const secretDoorIds = doors.map(door => door.id);
    reply = doors.length ? "Oh, I'll mark them on your map." : "There aren't any more secrets.";
    queryData = { secretDoorIds };
  } else throw new Error('Choose a supported Zone of Truth question.');
  return { question: key, reply, message: reply, ...queryData };
}
