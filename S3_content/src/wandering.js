import { ENTITY_TYPES, TILE_TYPES } from "./constants.js";
import { getTile, tileKey } from "./state-schema.js";
import { SeededRng } from "./rng.js";
import { isUndeadMonster } from "./crypts.js";
import { canMoveBetweenTiles } from './interactions.js';

export const DEFAULT_WANDERING_NUMERATOR = 1;
export const DEFAULT_WANDERING_DENOMINATOR = 6;

function normalizeInteger(value, fallback = 0) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) {
    return fallback;
  }
  return Number.parseInt(digits, 10);
}

export function normalizeWanderingChance(state, numerator, denominator) {
  state.wanderingMonsters = {
    numerator: normalizeInteger(numerator, DEFAULT_WANDERING_NUMERATOR),
    denominator: normalizeInteger(denominator, DEFAULT_WANDERING_DENOMINATOR),
    spawnedCount: Math.max(0, Number.parseInt(state.wanderingMonsters?.spawnedCount ?? 0, 10) || 0)
  };
  return state.wanderingMonsters;
}

export function wanderingEnabled(state) {
  const chance = state.wanderingMonsters;
  return Number(chance?.numerator) > 0 && Number(chance?.denominator) > 0;
}

function isOccupied(state, x, y) {
  return state.entities.some((entity) => {
    if (entity.x !== x || entity.y !== y || entity.visible === false) {
      return false;
    }
    if (entity.type === ENTITY_TYPES.MONSTER && entity.defeated) {
      return false;
    }
    if (entity.type === ENTITY_TYPES.TREASURE && entity.collected) {
      return false;
    }
    if (entity.type === ENTITY_TYPES.TRAP && (entity.disarmed || entity.triggered)) {
      return false;
    }
    return true;
  });
}

function visibleEdgeCandidates(state) {
  const minDistance = Math.max(1, state.player.lightRadius - 1);
  const candidates = [];
  for (const key of state.visibility.visibleNow) {
    const [x, y] = key.split(",").map(Number);
    const tile = getTile(state, x, y);
    if (!tile || tile.type !== TILE_TYPES.FLOOR || isOccupied(state, x, y)) {
      continue;
    }
    const distance = Math.max(Math.abs(x - state.player.x), Math.abs(y - state.player.y));
    if (distance >= minDistance && tileKey(x, y) === key) {
      candidates.push(tile);
    }
  }
  return candidates;
}

function unlitEdgeCandidates(state, origin) {
  const start = { x: Number(origin.x), y: Number(origin.y) };
  const seen = new Set([tileKey(start.x, start.y)]), queue = [start], candidates = [];
  for (let i = 0; i < queue.length; i += 1) {
    const point = queue[i];
    const distance = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
    if (distance >= 4 && !isOccupied(state, point.x, point.y)) candidates.push(getTile(state, point.x, point.y));
    if (distance >= 6) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = point.x + dx, y = point.y + dy, key = tileKey(x, y);
      if (!seen.has(key) && canMoveBetweenTiles(state, point.x, point.y, x, y).ok) { seen.add(key); queue.push({ x, y }); }
    }
  }
  return candidates.filter(Boolean);
}

function monsterDetails(rng, monsterTable) {
  const validMonsters = monsterTable.filter((monster) => monster?.["Monster Name"] || monster?.name);
  const monster = rng.pick(validMonsters);
  if (!monster) {
    return {
      name: "wandering monster",
      ac: null,
      hp: null,
      attack: null,
      abilities: {}
    };
  }
  return {
    name: monster["Monster Name"] || monster.name,
    level: monster["**LV**"] ?? monster.level ?? null,
    ac: monster["**AC**"] ?? monster.ac ?? null,
    hp: monster["**HP**"] ?? monster.hp ?? null,
    maxHp: Number.parseInt(monster.hp ?? monster['**HP**'],10)||1,
    attack: monster["**ATK**"] ?? monster.attack ?? null,
    movement: monster["**MV**"] || monster.movement || null,
    D: monster["**D**"] || monster.D || "",
    S: monster.S ?? monster['**S**'] ?? '',
    C: monster.C ?? monster['**C**'] ?? '',
    I: monster.I ?? monster['**I**'] ?? '',
    W: monster.W ?? monster['**W**'] ?? '',
    Ch: monster.Ch ?? monster['**CH**'] ?? '',
    languages: monster.languages ?? '',
    alignment: monster.alignment ?? monster.AL ?? monster["**AL**"] ?? "",
    chaModifier: Number(monster.chaModifier ?? monster.Ch ?? monster.CH ?? monster["**CH**"]) || 0,
    abilities: monster.abilities || {},
    tags: monster.tags || [],
    carriedGear: monster.gear || monster.carriedGear || [],
    diplomacy: monster.diplomacy || monster.Diplomacy || monster["Diplomacy"] || ""
  };
}

export function wanderingCheckDenominator(state,origin=state.player) {
  return state.wanderingMonsters.denominator*(origin?.roomId&&origin.roomId===state.generation?.entranceRoomId?2:1);
}

export function maybeSpawnWanderingMonster(state, monsterTable = [], options = {}) {
  if ((!options.forceEncounter && !wanderingEnabled(state)) || (!state.player.torchLit && !options.ignoreDarkness)) {
    return { spawned: false, message: "" };
  }

  const chance = state.wanderingMonsters ||= { numerator: 1, denominator: 6, spawnedCount: 0 };
  const seed = (Number(state.seed) || 0) + Math.floor(state.timers?.torchElapsedMs || 0) + chance.spawnedCount + (Number(options.seedOffset) || 0);
  const rng = new SeededRng(seed);
  const denominator=options.forceEncounter ? 1 : wanderingCheckDenominator(state,options.origin||state.player) * (options.chanceDivisor === 4 ? 4 : options.chanceDivisor === 2 ? 2 : 1);
  const roll = rng.nextInt(1, denominator);
  if (!options.forceEncounter && roll > chance.numerator) {
    return { spawned: false, message: `Wandering monster check: ${roll} in ${denominator}. No monster appears.` };
  }

  const candidates = (options.allowUnlit ? unlitEdgeCandidates(state, options.origin || state.player) : visibleEdgeCandidates(state))
    .filter(tile => !state.characters?.some(character => character.x === tile.x && character.y === tile.y));
  const tile = rng.pick(candidates);
  if (!tile) {
    return { spawned: false, message: "Wandering monster check passed, but no visible edge square was available." };
  }

  const crypt = state.rooms.some(room => room.id === tile.roomId && room.crypt === true);
  const eligible = crypt ? monsterTable.filter(monster => isUndeadMonster(monster) &&
    (monster?.["Monster Name"] || monster?.name)) : monsterTable;
  if (crypt && !eligible.length) return { spawned: false, message: 'No eligible undead encounter for this crypt.' };
  const details = monsterDetails(rng, eligible);
  chance.spawnedCount += 1;
  const entity = {
    id: `wandering-monster-${chance.spawnedCount}`,
    type: ENTITY_TYPES.MONSTER,
    subtype: "wandering-foe",
    x: tile.x,
    y: tile.y,
    roomId: tile.roomId,
    visible: true,
    defeated: false,
    wandering: true,
    ...details
  };
  state.entities.push(entity);
  return {
    spawned: true,
    entity,
    message: `Wandering monster appears at the edge of torchlight: ${entity.name}.`
  };
}
