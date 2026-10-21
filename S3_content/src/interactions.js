import { DOOR_STATES, ENTITY_TYPES, FEATURE_NAMES, TILE_TYPES } from "./constants.js";
import { getTile } from "./state-schema.js";
import { canCrossReviewedGeometry } from "./reviewed-layouts.js";
import { SeededRng } from "./rng.js";
import { isTileVisible, recomputeVisibility, revealTrapAtPlayer } from "./visibility.js";
import { isFeatureCurrentlyVisible } from './monster-perception.js';
import { isDarkvisionCharacter } from './darkvision.js';
import { getCharacterCoinBagSlots, getCharacterGearFreeSlots, normalizeCharacterState, setActiveCharacter } from "./characters.js";
import { createTreasureDetails, formatTreasureValue } from "./treasure.js";
import { canCrossOrganicEdge, isOrganicMovementBlockingTile } from "./organic-tiles.js";
import { isInnerWallBlockingTile } from "./inner-walls.js";
import { isAngledWallMovementBlockingTile } from "./angled-walls.js";
import { concealedMimic } from './companions.js';
import { isInvisible } from './concealment.js';
import { queueFallingDamage, canCastFeatherFall } from './falling.js';
import { isIncorporeal, isSleeping, isProne, phaseStepAllowed } from './conditions.js';
import { isRaving } from './arcane-effects.js';
import { checkSinkholeFall } from './higher-mishaps.js';
import { isPit, knownPitAt, openPit } from './pits.js';
import { routeStep, routeOf, routeAt, sameRoute } from './underpasses.js';
import { isTileIlluminated } from './light-geometry.js';
import { fixedObjectAt, webStepBlock } from './area-spells.js';
import { transformationMovementRules } from './transformation-spells.js';
import { isStatueAsset, hasFixedSolidMovement, getReviewedTileRule, reviewedTileMovementSegments } from './reviewed-tile-rules.js';

const LOCK_DC_VALUES = Object.freeze([8, 10, 12, 15]);
const DEFAULT_INVENTORY_SLOTS = 10;
const MONSTER_LOOT_DROP_CHANCE = 0.75;
const MAX_COIN_VALUE = 9999999;
const WORTHLESS_FEATURE_NAMES = new Set(FEATURE_NAMES.map((name) => String(name || "").toLowerCase()));

function isWorthlessFeature(entity) {
  if (entity?.worthlessLoot === true || entity?.corpseLoot === true) {
    return true;
  }
  if (entity?.type !== ENTITY_TYPES.FEATURE) {
    return false;
  }
  const name = String(entity?.name || "").toLowerCase();
  return entity?.subtype === "room-feature" && WORTHLESS_FEATURE_NAMES.has(name);
}

function ensureInventory(state) {
  if (!state.inventory) {
    state.inventory = {
      baseSlots: DEFAULT_INVENTORY_SLOTS,
      bonusSlots: 0,
      usedSlots: 0
    };
  }
  state.inventory.baseSlots = Math.max(0, Number(state.inventory.baseSlots ?? DEFAULT_INVENTORY_SLOTS) || DEFAULT_INVENTORY_SLOTS);
  state.inventory.bonusSlots = Math.max(0, Number(state.inventory.bonusSlots ?? 0) || 0);
  state.inventory.usedSlots = Math.max(0, Number(state.inventory.usedSlots ?? 0) || 0);
  return state.inventory;
}

function getInventoryCapacity(state) {
  const inventory = ensureInventory(state);
  return inventory.baseSlots + inventory.bonusSlots;
}

function getItemSlots(item) {
  const slots = Number(item?.slots ?? 1);
  return Number.isFinite(slots) && slots > 0 ? Math.ceil(slots) : 1;
}

function getItemBonusSlots(item) {
  const bonusSlots = Number(item?.bonusSlots ?? 0);
  return Number.isFinite(bonusSlots) && bonusSlots > 0 ? Math.ceil(bonusSlots) : 0;
}

function getLootValueLabel(item) {
  return item?.priceless === true ? "priceless" : formatTreasureValue(item?.value ?? 0);
}

function getCoinValueInCopper(coinBreakdown = {}) {
  return Math.max(0, Number(coinBreakdown.gold || 0)) * 100
    + Math.max(0, Number(coinBreakdown.silver || 0)) * 10
    + Math.max(0, Number(coinBreakdown.copper || 0));
}

function normalizeCoinBreakdownFromEntity(entity) {
  if (entity?.coinBreakdown) {
    return {
      gold: Math.max(0, Math.floor(Number(entity.coinBreakdown.gold || 0) || 0)),
      silver: Math.max(0, Math.floor(Number(entity.coinBreakdown.silver || 0) || 0)),
      copper: Math.max(0, Math.floor(Number(entity.coinBreakdown.copper || 0) || 0))
    };
  }
  if (String(entity?.kind || entity?.subtype || "").toLowerCase() !== "coin-cache") {
    return null;
  }
  const valueCp = Math.max(0, Math.round((Number(entity?.value) || 0) * 100));
  const name = String(entity?.name || "").toLowerCase();
  if (/\bc\.?p\.?\b|copper/.test(name)) {
    return { gold: 0, silver: 0, copper: valueCp };
  }
  if (/\bs\.?p\.?\b|silver/.test(name)) {
    return { gold: 0, silver: Math.floor(valueCp / 10), copper: valueCp % 10 };
  }
  return {
    gold: Math.floor(valueCp / 100),
    silver: Math.floor((valueCp % 100) / 10),
    copper: valueCp % 10
  };
}

function getTreasureSlotCost(entity) {
  if (isWorthlessFeature(entity)) {
    return 1;
  }
  if (entity?.gearItem) {
    return Math.max(1, Number(entity.gearItem.slots ?? entity.slots ?? 1) || 1);
  }
  const kind = String(entity?.kind || entity?.treasureKind || "").toLowerCase();
  if (kind === "gems") {
    return 0;
  }
  if (kind === "chainmail") {
    return 2;
  }
  if (kind === "platemail") {
    return 3;
  }
  return 1;
}

function clampCoinValue(value) {
  return Math.max(0, Math.min(MAX_COIN_VALUE, Math.floor(Number(value) || 0)));
}

function getCoinCountFromBreakdown(coinBreakdown = {}) {
  return Math.max(0, Number(coinBreakdown.gold || 0))
    + Math.max(0, Number(coinBreakdown.silver || 0))
    + Math.max(0, Number(coinBreakdown.copper || 0));
}

function getCoinPickupSlotCost(character, coinBreakdown = {}) {
  const beforeSlots = getCharacterCoinBagSlots(character);
  const afterMoney = {
    gold: Number(character?.gold || 0) + Number(coinBreakdown.gold || 0),
    silver: Number(character?.silver || 0) + Number(coinBreakdown.silver || 0),
    copper: Number(character?.copper || 0) + Number(coinBreakdown.copper || 0)
  };
  return Math.max(0, getCharacterCoinBagSlots(afterMoney) - beforeSlots);
}

function recomputeInventory(state) {
  const inventory = ensureInventory(state);
  inventory.usedSlots = state.lootLog.entries.reduce((total, entry) => total + getItemSlots(entry), 0);
  inventory.bonusSlots = state.lootLog.entries.reduce((total, entry) => total + getItemBonusSlots(entry), 0);
  return inventory;
}

function getActiveCarrier(state) {
  if (!Array.isArray(state?.characters) || !state.characters.length) {
    return null;
  }
  return state.characters.find((character) => character.id === state.activeCharacterId) || state.characters[0] || null;
}

function getTreasureXpAward(valueGp) {
  const value = Number(valueGp) || 0;
  if (value <= 50) return 0;
  if (value <= 500) return 1;
  if (value <= 1500) return 2;
  if (value <= 3000) return 3;
  if (value < 5000) return 4;
  return 5;
}

function awardTreasureExperience(state, entity) {
  const xp = getTreasureXpAward(entity?.value);
  if (!xp || !Array.isArray(state?.characters)) {
    return 0;
  }
  for (const character of state.characters) {
    if (Number(character?.hp) < 1 || character.dead === true || character.slain === true) {
      continue;
    }
    character.XP = Math.max(0, Number(character.XP || 0) + xp);
    character.raw = character.raw || {};
    character.raw.XP = character.XP;
    character.raw.xp = character.XP;
  }
  return xp;
}

function createWorthlessLootEntity(state, feature, name = feature?.name) {
  const loot = {
    id: `worthless-loot-${state.entities.length}-${Date.now()}`,
    type: ENTITY_TYPES.TREASURE,
    subtype: "worthless-loot",
    kind: "worthless-loot",
    name,
    x: feature.x,
    y: feature.y,
    routeId: routeOf(state, feature),
    roomId: feature.roomId,
    visible: true,
    revealed: true,
    collected: false,
    value: 0,
    slots: 1,
    bonusSlots: 0,
    priceless: false,
    description: "Worthless loot.",
    worthlessLoot: true,
    sourceFeatureId: feature.id
  };
  state.entities.push(loot);
  feature.collected = true;
  feature.visible = false;
  return loot;
}

function findEntityAt(state, x, y) {
  return state.entities.find((entity) => {
    if (!sameRoute(state, entity, state.player)) return false;
    if (entity.x !== x || entity.y !== y) {
      return false;
    }
    if (entity.type === ENTITY_TYPES.MONSTER && entity.defeated) {
      return false;
    }
    if (entity.type === ENTITY_TYPES.TREASURE && entity.collected) {
      return false;
    }
    if (entity.type === ENTITY_TYPES.FEATURE && entity.collected) {
      return false;
    }
    if (entity.type === ENTITY_TYPES.TRAP && !entity.visible) {
      return false;
    }
    return entity.visible !== false;
  });
}

function getDoorTiles(door) {
  if (door.wallSide === "east") {
    return {
      hall: { x: door.x, y: door.y },
      room: { x: door.x - 1, y: door.y }
    };
  }
  if (door.wallSide === "west") {
    return {
      hall: { x: door.x, y: door.y },
      room: { x: door.x + 1, y: door.y }
    };
  }
  if (door.wallSide === "south") {
    return {
      hall: { x: door.x, y: door.y },
      room: { x: door.x, y: door.y - 1 }
    };
  }
  return {
    hall: { x: door.x, y: door.y },
    room: { x: door.x, y: door.y + 1 }
  };
}

function sameTile(a, b) {
  return a?.x === b?.x && a?.y === b?.y;
}

export function getDoorBetween(state, fromX, fromY, toX, toY, routeId = null) {
  const from = { x: fromX, y: fromY };
  const to = { x: toX, y: toY };
  return state.entities.find((entity) => {
    if (entity.subtype !== "door" || routeId !== null && routeOf(state, entity) !== routeId) {
      return false;
    }
    const { hall, room } = getDoorTiles(entity);
    return (sameTile(from, hall) && sameTile(to, room)) || (sameTile(from, room) && sameTile(to, hall));
  }) || null;
}

function findDoorTouchingTile(state, x, y) {
  return state.entities.find((entity) => {
    if (entity.subtype !== "door") {
      return false;
    }
    const { hall, room } = getDoorTiles(entity);
    return (hall.x === x && hall.y === y) || (room.x === x && room.y === y);
  }) || null;
}

export function getDoorAt(state, x, y) {
  return findDoorTouchingTile(state, x, y);
}

function isDoorPassable(door) {
  return door?.doorState === DOOR_STATES.OPEN ||
    door?.doorState === "gone" ||
    door?.gone === true ||
    door?.destroyed === true;
}

function findBlockingDoorAtTile(state, x, y, routeId = null) {
  return state.entities.find((entity) => (
    entity.subtype === "door" &&
    (routeId === null || routeOf(state, entity) === routeId) &&
    !isDoorPassable(entity) &&
    entity.x === x &&
    entity.y === y
  )) || null;
}

function findActiveTrapForTarget(state, targetType, targetEntityId = null) {
  return state.entities.find((entity) => {
    return (
      entity.type === ENTITY_TYPES.TRAP &&
      !entity.triggered &&
      !entity.disarmed &&
      entity.targetType === targetType &&
      (targetEntityId === null || entity.targetEntityId === targetEntityId)
    );
  });
}

function pickLockDc() {
  return LOCK_DC_VALUES[Math.floor(Math.random() * LOCK_DC_VALUES.length)];
}

function ensureDoorLockDcs(door) {
  if (!door.lockPickDc) {
    door.lockPickDc = pickLockDc();
  }
  if (!door.breakDc) {
    door.breakDc = pickLockDc();
  }
  return {
    pickDc: door.lockPickDc,
    breakDc: door.breakDc
  };
}

export function setDoorState(door, nextState) {
  delete door.transition;
  door.doorState = nextState;
  if (nextState === DOOR_STATES.OPEN) {
    door.everOpened = true;
  }
}

function clearLockedDoorAction(state) {
  state.lockedDoorAction = null;
}

function isDoorLocked(state, door) {
  return door.doorState === DOOR_STATES.LOCKED && (state.sharedRoom === true || state.characters?.length > 0);
}

function setLockedDoorAction(state, door) {
  const dcs = ensureDoorLockDcs(door);
  state.lockedDoorAction = {
    doorId: door.id,
    pickDc: dcs.pickDc,
    breakDc: dcs.breakDc
  };
  return state.lockedDoorAction;
}

function revealSecretDoor(door, state = null) {
  if (!door || door.secret !== true) {
    return false;
  }
  door.secretFound = true;
  door.revealed = true;
  door.visible = true;
  if (state && !door.secretFoundSide) {
    const side = door.hallDirection || door.wallSide;
    const vertical = side === 'east' || side === 'west';
    door.secretFoundSide = vertical
      ? { x: side === 'east' ? -1 : 1, y: 0 }
      : { x: 0, y: side === 'south' ? -1 : 1 };
    const room = getTile(state, state.player.x, state.player.y)?.roomId;
    if (room !== door.roomId) {
      door.secretFoundSide.x *= -1;
      door.secretFoundSide.y *= -1;
    }
    door.secretFoundRoomId = room;
  }
  return true;
}

export function getPendingLockedDoorAction(state) {
  const action = state?.lockedDoorAction;
  if (!action?.doorId) {
    return null;
  }
  const door = state.entities.find((entity) => entity.id === action.doorId && entity.subtype === "door");
  if (!door || !isDoorLocked(state, door)) {
    clearLockedDoorAction(state);
    return null;
  }
  const dcs = ensureDoorLockDcs(door);
  return {
    doorId: door.id,
    pickDc: dcs.pickDc,
    breakDc: dcs.breakDc
  };
}

function lockedDoorResult(state, door) {
  state.darkness.pendingDoorKey = null;
  if (revealSecretDoor(door)) {
    recomputeVisibility(state);
  }
  return {
    moved: false,
    message: "Locked.",
    darknessMessage: "Locked.",
    lockedDoor: setLockedDoorAction(state, door)
  };
}

function findStumbleEntityAt(state, x, y) {
  return state.entities.find((entity) => {
    if (!sameRoute(state, entity, state.player)) return false;
    if (entity.x !== x || entity.y !== y || entity.subtype === "door") {
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

function revealAndTriggerTrap(trap,state) {
  const target=state?.characters?.find(character=>character.id===state.activeCharacterId);
  trap.targetCharacterId=target?.id||null;
  trap.attackDisadvantage=isInvisible(target);
  trap.revealed = true;
  trap.visible = true;
  trap.triggered = true;
  trap.wasSprung = true;
  if (isPit(trap)) {
    const affectedState = { ...state,
      characters: (state.characters || []).filter(character => !transformationMovementRules(state, character).crossesPits),
      entities: state.entities.filter(entity => entity.type !== ENTITY_TYPES.MONSTER || !transformationMovementRules(state, entity).crossesPits) };
    const falls = openPit(affectedState, trap, { check: rollCheck,
      canStep: (x, y, nx, ny) => canMoveBetweenTiles(state, x, y, nx, ny, { ignorePits: true }).ok,
      queueFall: (character, event) => { if (!canCastFeatherFall(character)) return false; queueFallingDamage(character, event); return true; } });
    for (const fall of falls) {
      const monster = state.entities.find(entity => entity.id === fall.id && entity.type === ENTITY_TYPES.MONSTER);
      if (monster && monster.hp <= 0 && !monster.defeated) defeatMonster(state, monster);
    }
    return { trap, trapSprung: true, message: `${trap.name} opens. ${falls.map(fall => fall.passed ? 'A creature reaches the rim safely.' : `${fall.pending ? 'Feather Fall is available before' : fall.damage} falling damage.`).join(' ')}` };
  }
  if (target && /falling/i.test([trap.damageType, ...(trap.tags || []), trap.effect].join(' ')) && canCastFeatherFall(target)) {
    queueFallingDamage(target, { sourceId: trap.id, manual: true });
  }
  return {
    trap,
    trapSprung: true,
    message: `${trap.name}. Trigger: ${trap.trigger}. Effect: ${trap.effect}.`
  };
}

function addFeature(state, x, y, roomId, name) {
  state.entities.push({
    id: `feature-${state.entities.length}-${Date.now()}`,
    type: ENTITY_TYPES.FEATURE,
    subtype: "room-feature",
    name,
    x,
    y,
    roomId,
    routeId: routeOf(state, state.player),
    visible: true,
    worthlessLoot: WORTHLESS_FEATURE_NAMES.has(String(name || "").toLowerCase()) || /^dead\s+/i.test(String(name || ""))
  });
}

function isBlockingPillarAt(state, x, y) {
  const columns = Array.isArray(state.decor?.columns) ? state.decor.columns : [];
  return columns.some((column) => (
    column?.blocksMovement === true &&
    String(column.placement || "center") === "center" &&
    Number(column.x) === x &&
    Number(column.y) === y
  ));
}

function decorBlocksTile(placement, x, y) {
  if (!placement?.blocksMovement) {
    return false;
  }
  if (Array.isArray(placement.blocks)) {
    return placement.blocks.some((block) => (
      Number(block?.x) === x &&
      Number(block?.y) === y
    ));
  }
  const left = Number(placement.x);
  const top = Number(placement.y);
  const width = Math.max(1, Math.round(Number(placement.widthTiles) || 1));
  const height = Math.max(1, Math.round(Number(placement.heightTiles) || 1));
  return x >= left && y >= top && x < left + width && y < top + height;
}

function isBlockingPlacedDecorAt(state, x, y) {
  const blockers = [
    ...(Array.isArray(state.decor?.wells) ? state.decor.wells : [])
  ];
  return blockers.some((placement) => decorBlocksTile(placement, x, y));
}

function placementPose(placement) {
  return { x: placement.x, y: placement.y, w: placement.gridWidthTiles || 1, h: placement.gridHeightTiles || 1,
    turn: placement.rotationTurns || 0, flipX: placement.flipX, flipY: placement.flipY };
}

function placementContains(placement, x, y) {
  const pose = placementPose(placement), width = pose.turn % 2 ? pose.h : pose.w, height = pose.turn % 2 ? pose.w : pose.h;
  return x >= pose.x && y >= pose.y && x < pose.x + width && y < pose.y + height;
}

function movementGeometryState(state, creature, toX, toY) {
  if (!transformationMovementRules(state, creature).passesStatues) return state;
  const statues = (state.decor?.reviewed || []).filter(placement => isStatueAsset(placement.assetKey) && sameRoute(state, creature, placement));
  if (!statues.length) return state;
  const removed = new Set(statues), counts = new Map();
  const segmentKey = segment => segment.map(point => point.map(value => Number(value).toFixed(7)).join(',')).sort().join('|');
  for (const statue of statues) for (const segment of reviewedTileMovementSegments(statue.assetKey, placementPose(statue))) {
    const key = segmentKey(segment); counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Remove only this artwork's segments, preserving duplicate wall/pillar edges.
  const reviewedMovement = (state.decor?.reviewedMovement || []).filter(segment => {
    const key = segmentKey(segment), count = counts.get(key) || 0;
    if (!count) return true;
    counts.set(key, count - 1); return false;
  });
  const reviewed = state.decor.reviewed.filter(placement => !removed.has(placement));
  const tile = getTile(state, toX, toY);
  const statueCell = statues.some(placement => placementContains(placement, toX, toY));
  const otherSolid = reviewed.some(placement => sameRoute(state, creature, placement) && placementContains(placement, toX, toY) &&
    (hasFixedSolidMovement(placement.assetKey) || getReviewedTileRule(placement.assetKey)?.kind === 'blocks' || placement.movement === true));
  let tiles = state.tiles;
  if (tile?.meta?.layoutBlocks && statueCell && !otherSolid) {
    tiles = state.tiles.slice();
    tiles[toY * state.map.width + toX] = { ...tile, meta: { ...tile.meta, layoutBlocks: false } };
  }
  return { ...state, tiles, decor: { ...state.decor, reviewed, reviewedMovement } };
}

function fixedMovementBlock(state, x, y, routeId) {
  return fixedObjectAt(state, { x, y, routeId }) ? 'A fixed object blocks the way.' : '';
}

function isWalkable(state, tile, options = {}) {
  if (!tile) {
    return { ok: false, message: "Blocked by stone wall." };
  }
  const creature = state.underpasses?.length ? { ...options.creature,
    routeId: options.routeId ?? routeAt(state, tile.x, tile.y, options.creature?.routeId ?? state.player?.routeId) } : options.creature;
  const fixedBlock = fixedMovementBlock(state, tile.x, tile.y, options.routeId ?? routeOf(state, creature || state.player));
  if (fixedBlock) return { ok: false, message: fixedBlock };
  if (!options.ignorePits && !transformationMovementRules(state, creature).crossesPits && knownPitAt(state, tile.x, tile.y, creature)) return { ok: false, message: 'A revealed pit blocks movement.' };
  if (creature?.routeId && tile.type === TILE_TYPES.FLOOR) return { ok: true, message: 'Moved.' };
  if (isOrganicMovementBlockingTile(tile)) {
    return { ok: false, message: "Blocked by a cave wall." };
  }
  if (isInnerWallBlockingTile(tile)) {
    return { ok: false, message: "Blocked by an inner wall." };
  }
  if (isAngledWallMovementBlockingTile(tile)) {
    return { ok: false, message: "Blocked by an angled wall." };
  }
  if (isBlockingPillarAt(state, tile.x, tile.y)) {
    return { ok: false, message: "Blocked by a pillar." };
  }
  if (isBlockingPlacedDecorAt(state, tile.x, tile.y)) {
    return { ok: false, message: "Blocked." };
  }
  if (tile.type === TILE_TYPES.FLOOR) {
    return { ok: true, message: "Moved." };
  }
  return { ok: false, message: "Blocked by stone wall." };
}

function checkOrganicStep(state, fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const fromTile = getTile(state, fromX, fromY);
  const toTile = getTile(state, toX, toY);
  if (!canCrossOrganicEdge(fromTile, toTile, dx, dy)) {
    return { ok: false, message: "Blocked by a cave wall." };
  }
  return { ok: true, message: "Moved." };
}

export function canMoveBetweenTiles(state, fromX, fromY, toX, toY, options = {}) {
  const step = options.ignoreUnderpasses ? { routeId: options.routeId || '' } : routeStep(state,
    { x: fromX, y: fromY, routeId: options.routeId ?? options.creature?.routeId ?? routeOf(state, { x: fromX, y: fromY }) }, { x: toX, y: toY }, { phase: isIncorporeal(options.creature) });
  if (!step) return { ok: false, message: 'These passages cross on separate levels.' };
  if (isIncorporeal(options.creature)) return { ok: phaseStepAllowed(state, fromX, fromY, toX, toY), message: 'Incorporeal movement.' };
  const webBlock = options.creature && webStepBlock(state, { ...options.creature, x: fromX, y: fromY,
    routeId: options.routeId ?? routeOf(state, options.creature) });
  if (webBlock) return { ok: false, message: webBlock };
  const geometry = movementGeometryState(state, options.creature, toX, toY);
  if (!canCrossReviewedGeometry(geometry,fromX,fromY,toX,toY, { x: fromX, y: fromY, routeId: options.routeId ?? options.creature?.routeId ?? routeOf(state, { x: fromX, y: fromY }) })) return {ok:false,message:'Blocked by terrain.'};
  const tile = getTile(state, toX, toY);
  const door = getDoorBetween(state, fromX, fromY, toX, toY, step.routeId);
  if (options.ignoreClosedDoors !== true && door && !isDoorPassable(door)) {
    return { ok: false, message: "Blocked by a door." };
  }

  const blockingDoor = options.ignoreDoorTile === true || options.ignoreClosedDoors === true ? null : findBlockingDoorAtTile(state, toX, toY, step.routeId);
  if (blockingDoor) {
    return { ok: false, message: "Blocked by a door." };
  }

  const walkable = isWalkable(state, tile, { ...options, routeId: step.routeId });
  if (!walkable.ok) {
    return walkable;
  }

  return { ...checkOrganicStep(state, fromX, fromY, toX, toY), routeId: step.routeId,
    passesCreatures: transformationMovementRules(state, options.creature).passesCreatures };
}

export function addMonsterLootDrop(state, monster, options = {}) {
  const dropChance = monster?.wandering === true ? 0.5 : MONSTER_LOOT_DROP_CHANCE;
  if (options.force !== true && Math.random() >= dropChance) {
    return null;
  }
  const level = Math.max(1, Number(monster.level ?? state.level ?? 1) || 1);
  const rngSeed = (Number(state.seed) || 0)
    + (level * 97)
    + (Number(monster.x) || 0) * 17
    + (Number(monster.y) || 0) * 31
    + state.entities.length * 13;
  const rng = new SeededRng(rngSeed);
  const treasure = createTreasureDetails({ ...state, level }, rng);
  const loot = {
    id: `monster-loot-${state.entities.length}-${Date.now()}`,
    type: ENTITY_TYPES.TREASURE,
    subtype: "monster-loot",
    kind: treasure.kind,
    x: monster.x,
    y: monster.y,
    routeId: routeOf(state, monster),
    roomId: monster.roomId,
    visible: true,
    revealed: true,
    collected: false,
    name: treasure.name,
    value: treasure.value,
    searchDc: treasure.searchDc ?? 0,
    slots: treasure.slots ?? 1,
    bonusSlots: treasure.bonusSlots ?? 0,
    priceless: treasure.priceless === true,
    description: options.description || treasure.description || "Coins, oddments, or useful salvage dropped by a defeated monster."
  };
  if (treasure.coinBreakdown) {
    loot.coinBreakdown = JSON.parse(JSON.stringify(treasure.coinBreakdown));
  }
  state.entities.push(loot);
  return loot;
}

export function defeatMonster(state, monster, options = {}) {
  if (!monster || monster.type !== ENTITY_TYPES.MONSTER || monster.defeated === true) {
    return { defeated: false, message: "Monster not found." };
  }
  monster.defeated = true;
  monster.disguiseRevealed = true;
  monster.hp = 0;
  const corpseName = options.ash ? 'ash pile' : `Dead ${monster.name || "monster"}`;
  state.entities.push({
    id: `corpse-${state.entities.length}-${Date.now()}`,
    type: ENTITY_TYPES.TREASURE,
    subtype: options.ash ? 'turned-ash' : "corpse-loot",
    kind: options.ash ? 'remains' : "worthless-loot",
    name: corpseName,
    x: monster.x,
    y: monster.y,
    routeId: routeOf(state, monster),
    roomId: monster.roomId,
    visible: true,
    revealed: true,
    collected: false,
    value: options.ash ? .01 : 0,
    slots: 1,
    bonusSlots: 0,
    priceless: false,
    description: "The remains of a defeated monster.",
    corpseLoot: !options.ash,
    monsterName: options.ash ? '' : monster.name || "monster"
  });
  const loot = addMonsterLootDrop(state, monster);
  for(const [index,item]of(monster.carriedGear||[]).entries())state.entities.push({id:`slain-gear-${monster.id}-${index}`,type:ENTITY_TYPES.TREASURE,
    subtype:'dropped-equipment',kind:'gear',name:item.name,x:monster.x,y:monster.y,roomId:monster.roomId,visible:true,value:Number(item.value)||0,
    gearItem:{...item,bound:false,equipped:false},slots:item.slots??1});
  monster.carriedGear=[];
  return {
    defeated: true,
    corpseName,
    loot,
    message: loot
      ? `Monster defeated: ${corpseName}. It dropped ${loot.name}.`
      : `Monster defeated: ${corpseName}.`
  };
}

function openClosedDoorFromMovement(state, door) {
  if (!door || isDoorLocked(state, door) || ![DOOR_STATES.CLOSED, DOOR_STATES.LOCKED].includes(door.doorState)) {
    return null;
  }

  revealSecretDoor(door);
  const trap = findActiveTrapForTarget(state, "door", door.id);
  setDoorState(door, DOOR_STATES.OPEN);
  clearLockedDoorAction(state);
  recomputeVisibility(state);

  if (trap) {
    const result = revealAndTriggerTrap(trap,state);
    return { moved: false, trapSprung: true, message: `You've run into a trapped door! ${result.message}` };
  }

  return { moved: false, message: "Door opened. Move again to pass through." };
}

function checkPlayerSinkhole(state, tile) {
  const creature = state.characters?.find(character => character.id === state.activeCharacterId);
  if (!creature) return;
  Object.assign(creature, { x: tile.x, y: tile.y, roomId: tile.roomId, routeId: state.player.routeId });
  if (transformationMovementRules(state, creature).crossesPits) return;
  checkSinkholeFall(state, creature, { queueFall: (target, event) => {
    if (!canCastFeatherFall(target)) return false; queueFallingDamage(target, event); return true;
  } });
}

function revealMovementTrap(state, creature) {
  const rules = transformationMovementRules(state, creature);
  if (rules.ignoresFloorTraps) return null;
  return revealTrapAtPlayer(rules.crossesPits ? { ...state, entities: state.entities.filter(entity => !isPit(entity)) } : state);
}

function moveToTileInDarkness(state, tile) {
  const step = routeStep(state, state.player, tile);
  state.darkness.pendingDoorKey = null;
  clearLockedDoorAction(state);
  state.player.x = tile.x;
  state.player.y = tile.y;
  state.player.roomId = tile.roomId;
  state.player.routeId = step?.routeId ?? state.player.routeId;
  checkPlayerSinkhole(state, tile);

  const creature = state.characters?.find(character => character.id === state.activeCharacterId);
  const tileTrap = revealMovementTrap(state, creature);
  if (tileTrap) {
    const result = revealAndTriggerTrap(tileTrap, state);
    return {
      moved: true,
      trapSprung: true,
      message: `you've set off a trap! ${result.message}`,
      darknessMessage: "you've set off a trap!"
    };
  }

  if (transformationMovementRules(state, creature).levitating) return { moved: true, message: 'Levitated through darkness.' };

  const entity = findStumbleEntityAt(state, tile.x, tile.y);
  if (!entity) {
    return { moved: true, message: "Moved through darkness." };
  }

  entity.visible = true;
  entity.revealed = true;
  entity.darknessRevealed = true;

  if (entity.type === ENTITY_TYPES.TREASURE) {
    const trap = findActiveTrapForTarget(state, "treasure", entity.id);
    if (trap) {
      const result = revealAndTriggerTrap(trap,state);
      return {
        moved: true,
        trapSprung: true,
        message: `You've stumbled onto a trapped ${entity.name || "treasure"}! ${result.message}`,
        darknessMessage: `You've stumbled onto a trapped ${entity.name || "treasure"}!`
      };
    }
  }

  const name = entity.name || entity.subtype || entity.type || "object";
  return {
    moved: true,
    message: `You've stumbled onto a ${name}.`,
    darknessMessage: `You've stumbled onto a ${name}.`
  };
}

function movePlayerInDarkness(state, dx, dy) {
  const nextX = state.player.x + dx;
  const nextY = state.player.y + dy;
  const tile = getTile(state, nextX, nextY);
  const door = getDoorBetween(state, state.player.x, state.player.y, nextX, nextY, routeOf(state, state.player));

  if (door) {
    if (isDoorPassable(door)) {
      const walkable = isWalkable(state, tile, { creature: state.characters?.find(character => character.id === state.activeCharacterId) });
      if (!walkable.ok) {
        const message = walkable.message === "Blocked by a pillar." ? "You've run into a pillar!" : "You've run into a wall!";
        return { moved: false, message, darknessMessage: message };
      }
      const organicStep = checkOrganicStep(state, state.player.x, state.player.y, nextX, nextY);
      if (!organicStep.ok) {
        return { moved: false, message: organicStep.message, darknessMessage: organicStep.message };
      }
      return moveToTileInDarkness(state, tile);
    }

    const trap = findActiveTrapForTarget(state, "door", door.id);
    if (trap) {
      revealSecretDoor(door);
      const result = revealAndTriggerTrap(trap,state);
      setDoorState(door, DOOR_STATES.OPEN);
      state.darkness.pendingDoorKey = null;
      return {
        moved: false,
        trapSprung: true,
        message: `you've run into a trapped door! ${result.message}`,
        darknessMessage: "you've run into a trapped door!"
      };
    }

    if (state.darkness.pendingDoorKey !== door.id) {
      state.darkness.pendingDoorKey = door.id;
      revealSecretDoor(door);
      return { moved: false, message: "you've run into a door.", darknessMessage: "you've run into a door." };
    }

    if (isDoorLocked(state, door)) {
      return lockedDoorResult(state, door);
    }

    revealSecretDoor(door);
    setDoorState(door, DOOR_STATES.OPEN);
    clearLockedDoorAction(state);
    state.darkness.pendingDoorKey = null;
    return { moved: false, message: "door open", darknessMessage: "door open" };
  }

  const blockingDoor = findBlockingDoorAtTile(state, nextX, nextY, routeOf(state, state.player));
  if (blockingDoor) {
    const trap = findActiveTrapForTarget(state, "door", blockingDoor.id);
    if (trap) {
      revealSecretDoor(blockingDoor);
      const result = revealAndTriggerTrap(trap,state);
      setDoorState(blockingDoor, DOOR_STATES.OPEN);
      state.darkness.pendingDoorKey = null;
      return {
        moved: false,
        trapSprung: true,
        message: `you've run into a trapped door! ${result.message}`,
        darknessMessage: "you've run into a trapped door!"
      };
    }
    if (isDoorLocked(state, blockingDoor)) {
      return lockedDoorResult(state, blockingDoor);
    }
    if (state.darkness.pendingDoorKey === blockingDoor.id && !isDoorPassable(blockingDoor)) {
      revealSecretDoor(blockingDoor);
      setDoorState(blockingDoor, DOOR_STATES.OPEN);
      clearLockedDoorAction(state);
      state.darkness.pendingDoorKey = null;
      return { moved: false, message: "door open", darknessMessage: "door open" };
    }
    state.darkness.pendingDoorKey = blockingDoor.id;
    revealSecretDoor(blockingDoor);
    return { moved: false, message: "you've run into a door.", darknessMessage: "you've run into a door." };
  }

  const walkable = isWalkable(state, tile, { creature: state.characters?.find(character => character.id === state.activeCharacterId) });
  if (!walkable.ok) {
    state.darkness.pendingDoorKey = null;
    const message = walkable.message === "Blocked by a pillar." ? "You've run into a pillar!" : "You've run into a wall!";
    return { moved: false, message, darknessMessage: message };
  }

  const organicStep = checkOrganicStep(state, state.player.x, state.player.y, nextX, nextY);
  if (!organicStep.ok) {
    state.darkness.pendingDoorKey = null;
    return { moved: false, message: organicStep.message, darknessMessage: organicStep.message };
  }

  return moveToTileInDarkness(state, tile);
}

export function movePlayer(state, dx, dy, options = {}) {
  const creature = state.characters?.find(character => character.id === state.activeCharacterId);
  const step = routeStep(state, { ...state.player, routeId: creature?.routeId ?? state.player.routeId }, { x: state.player.x + dx, y: state.player.y + dy }, { phase: isIncorporeal(creature) });
  if (!step) return { moved: false, message: 'These passages cross on separate levels.' };
  const finish = result => { if (result.moved && creature) creature.routeId = state.player.routeId; return result; };
  if (isRaving(creature)) return { moved: false, message: 'Mad raving prevents movement.' };
  if (creature?.conditions?.sinkhole && !isIncorporeal(creature)) return { moved: false, message: 'Climb out of the sinkhole before moving.' };
  if (isSleeping(creature, state)) return { moved: false, message: 'Sleeping creatures cannot move.' };
  if (isProne(creature, state)) return { moved: false, message: 'Stand up before moving.' };
  const webBlock = creature && webStepBlock(state, creature);
  if (webBlock) return { moved: false, message: webBlock };
  if (isIncorporeal(creature)) {
    const x = state.player.x + dx, y = state.player.y + dy;
    if (!phaseStepAllowed(state, state.player.x, state.player.y, x, y)) return { moved: false, message: 'Outside the dungeon.' };
    Object.assign(state.player, { x, y, routeId: step.routeId, roomId: getTile(state, x, y)?.roomId ?? null });
    if (!options.deferVisibility) recomputeVisibility(state);
    return finish({ moved: true, message: 'Moved through solid terrain.' });
  }
  const fixedBlock = fixedMovementBlock(state, state.player.x + dx, state.player.y + dy, step.routeId);
  if (fixedBlock) return { moved: false, message: fixedBlock };
  const hiddenDoor = getDoorBetween(state, state.player.x, state.player.y, state.player.x + dx, state.player.y + dy, step.routeId)
    || findBlockingDoorAtTile(state, state.player.x + dx, state.player.y + dy, step.routeId);
  if (hiddenDoor?.holdPortal?.rounds > 0) return { moved: false, message: 'Hold Portal seals this door. Click it to try forcing it open.' };
  if (hiddenDoor?.secret === true && !hiddenDoor.secretFound && !hiddenDoor.revealed) {
    return { moved: false, message: 'Blocked by a wall.' };
  }
  const geometry = movementGeometryState(state, creature, state.player.x + dx, state.player.y + dy);
  if (!canCrossReviewedGeometry(geometry, state.player.x, state.player.y, state.player.x + dx, state.player.y + dy, state.player)) {
    return { moved: false, message: "Blocked by terrain." };
  }
  if (!isDarkvisionCharacter(creature) && !isTileIlluminated(state, state.player.x, state.player.y, state.player)) {
    return finish(movePlayerInDarkness(state, dx, dy));
  }

  const nextX = state.player.x + dx;
  const nextY = state.player.y + dy;
  const tile = getTile(state, nextX, nextY);
  const door = getDoorBetween(state, state.player.x, state.player.y, nextX, nextY, step.routeId);

  if (door && !isDoorPassable(door)) {
    revealSecretDoor(door);
    if (isDoorLocked(state, door)) {
      return lockedDoorResult(state, door);
    }
    if (door.doorState === DOOR_STATES.CLOSED || door.doorState === DOOR_STATES.LOCKED) {
      return openClosedDoorFromMovement(state, door);
    }
    return { moved: false, message: "Blocked by a door." };
  }

  const blockingDoor = findBlockingDoorAtTile(state, nextX, nextY, step.routeId);
  if (blockingDoor) {
    revealSecretDoor(blockingDoor);
    if (isDoorLocked(state, blockingDoor)) {
      return lockedDoorResult(state, blockingDoor);
    }
    if (blockingDoor.doorState === DOOR_STATES.CLOSED || blockingDoor.doorState === DOOR_STATES.LOCKED) {
      return openClosedDoorFromMovement(state, blockingDoor);
    }
    return { moved: false, message: "Blocked by a door." };
  }

  const walkable = isWalkable(state, tile, { creature });
  if (!walkable.ok) {
    return { moved: false, message: walkable.message };
  }

  const organicStep = checkOrganicStep(state, state.player.x, state.player.y, nextX, nextY);
  if (!organicStep.ok) {
    return { moved: false, message: organicStep.message };
  }

  state.player.x = nextX;
  state.player.y = nextY;
  state.player.roomId = tile.roomId;
  state.player.routeId = step.routeId;
  checkPlayerSinkhole(state, tile);
  clearLockedDoorAction(state);
  if (options.deferVisibility !== true) recomputeVisibility(state);
  const trap = revealMovementTrap(state, creature);
  if (trap) {
    const result = revealAndTriggerTrap(trap,state);
    return {
      moved: true,
      trapSprung: result.trapSprung,
      message: result.message
    };
  }
  return finish({ moved: true, message: walkable.message });
}

function getClickTarget(state, x, y) {
  const doorAt = findDoorTouchingTile(state, x, y);
  const clickedDoor = doorAt && sameRoute(state, doorAt, state.player) ? doorAt : null;
  const doorTiles = clickedDoor ? getDoorTiles(clickedDoor) : null;
  const clickedVisibleDoor = clickedDoor && (
    isTileVisible(state, doorTiles.hall.x, doorTiles.hall.y) ||
    isTileVisible(state, doorTiles.room.x, doorTiles.room.y)
  );
  if (!clickedVisibleDoor && !isTileVisible(state, x, y, state.player)) {
    return { message: "That tile is hidden by darkness." };
  }

  const clickedEntity = findEntityAt(state, x, y);
  const entity = clickedEntity?.subtype === "door"
    ? clickedEntity
    : clickedEntity || clickedDoor;
  if (!entity) {
    return { message: "No interactive token on that tile." };
  }
  return { entity };
}

function resolveDoorClick(state, door, options) {
  if (door?.subtype !== "door" || (door.secret === true && !door.secretFound && !door.revealed)) return null;
  if (!state.characters?.length) return { door, character: null };
  const turn = state.combat?.active ? state.combat.turnOrder?.[state.combat.turnIndex] : null;
  const candidates = state.characters.filter(character => {
    if (!sameRoute(state, character, door)) return false;
    if (character.dead || character.slain || Number(character.dyingRounds || 0) > 0 || !(Number(character.hp) > 0)) return false;
    if (isSleeping(character, state) || isIncorporeal(character)) return false;
    if (character.x == null || character.y == null ||
      Math.max(Math.abs(Number(character.x) - door.x), Math.abs(Number(character.y) - door.y)) > 1 ||
      !Number.isFinite(Number(character.x)) || !Number.isFinite(Number(character.y))) return false;
    if (state.combat?.active && (turn?.type !== "character" || turn.id !== character.id)) return false;
    if (options.characterId != null && character.id !== options.characterId) return false;
    return !options.canUseCharacter || options.canUseCharacter(character);
  });
  const character = candidates.find(candidate => candidate.id === state.activeCharacterId) || candidates[0] || null;
  return { door, character, message: character ? "" : "Move an available character next to the door first." };
}

export function getDoorClickContext(state, x, y, options = {}) {
  return resolveDoorClick(state, getClickTarget(state, x, y).entity, options);
}

export function clickEntity(state, x, y, options = {}) {
  const target = getClickTarget(state, x, y);
  if (!target.entity) return target;
  const entity = target.entity;

  if (entity.subtype === "door") {
    if (entity.secret === true && !entity.secretFound && !entity.revealed) return { message: 'No interactive token on that tile.' };
    const context = resolveDoorClick(state, entity, options);
    if (context.message) return { message: context.message };
    if (context.character) {
      // Establish the actor before opening, lock handling, or any trap side effects.
      setActiveCharacter(state, context.character.id);
      Object.assign(state.player, { x: Number(context.character.x), y: Number(context.character.y),
        routeId: routeOf(state, context.character),
        roomId: context.character.roomId ?? getTile(state, Number(context.character.x), Number(context.character.y))?.roomId });
    }
    revealSecretDoor(entity);
    if (entity.holdPortal?.rounds > 0) return { message: 'Hold Portal seals this door. It must be forced open.' };
    const trap = findActiveTrapForTarget(state, "door", entity.id);
    if (trap && entity.doorState !== DOOR_STATES.OPEN) {
      const result = revealAndTriggerTrap(trap,state);
      setDoorState(entity, DOOR_STATES.OPEN);
      recomputeVisibility(state);
      return { trapSprung: true, message: `You've run into a trapped door! ${result.message}` };
    }
    if (isDoorLocked(state, entity)) {
      return lockedDoorResult(state, entity);
    }
    setDoorState(entity, entity.doorState === DOOR_STATES.OPEN ? DOOR_STATES.CLOSED : DOOR_STATES.OPEN);
    clearLockedDoorAction(state);
    recomputeVisibility(state);
    return {
      message: entity.doorState === DOOR_STATES.OPEN ? "Door opened." : "Door closed."
    };
  }

  if (entity.type === ENTITY_TYPES.MONSTER) {
    return defeatMonster(state, entity);
  }

  if (entity.type === ENTITY_TYPES.TREASURE) {
    if (!state.characters?.length) return { message: "import or load a character to pick up treasure." };
    return collectLoot(state, entity.id);
  }

  if (entity.type === ENTITY_TYPES.TRAP) {
    entity.revealed = true;
    entity.visible = true;
    return { message: "Trap manually revealed." };
  }

  if (entity.type === ENTITY_TYPES.FEATURE && isWorthlessFeature(entity)) {
    const loot = createWorthlessLootEntity(state, entity, entity.name || "worthless loot");
    return { message: `${loot.name} can be picked up from the room loot panel.` };
  }

  return { message: `Feature: ${entity.name || "unknown feature"}.` };
}

export function getRoomLoot(state) {
  const playerX = Number(state.player?.x);
  const playerY = Number(state.player?.y);
  const hasPlayerTile = Number.isFinite(playerX) && Number.isFinite(playerY);
  const playerTile = hasPlayerTile ? getTile(state, playerX, playerY) : null;
  const currentRoomId = state.player?.roomId || playerTile?.roomId || null;
  const currentHallId = playerTile?.hallId || null;
  if (!currentRoomId && !currentHallId && !hasPlayerTile) {
    return [];
  }
  return state.entities.filter((entity) => {
    if (!sameRoute(state, entity, state.player)) return false;
    return (
      (
        entity.type === ENTITY_TYPES.TREASURE || concealedMimic(entity) ||
        (entity.type === ENTITY_TYPES.FEATURE && isWorthlessFeature(entity))
      ) &&
      !entity.collected &&
      entity.visible !== false &&
      partyInLootArea(state, entity) && isFeatureCurrentlyVisible(state, entity)
    );
  }).map(entity=>concealedMimic(entity)?{...entity,type:ENTITY_TYPES.TREASURE,name:'Treasure',kind:'unknown',value:0}:entity);
}

export function partyInLootArea(state, entity) {
  const tile = getTile(state, entity.x, entity.y);
  return (state.characters || []).some(character => !character.dead && !character.slain && sameRoute(state, character, entity) &&
    (tile?.roomId ? getTile(state, character.x, character.y)?.roomId === tile.roomId :
      tile?.hallId ? getTile(state, character.x, character.y)?.hallId === tile.hallId : character.x === entity.x && character.y === entity.y));
}

export function partyCanReachLoot(state, entity) {
  return Boolean(entity && (state.characters || []).some(character => !character.dead && !character.slain && !isSleeping(character, state) &&
    !isIncorporeal(character) && transformationMovementRules(state, character).canPickUpGear && (Number(character.hp) > 0 || character.summon?.kind === 'floating-disc') &&
    sameRoute(state, character, entity) && Math.max(Math.abs(character.x - entity.x), Math.abs(character.y - entity.y)) <= 1 &&
    canMoveBetweenTiles(state, character.x, character.y, entity.x, entity.y, { creature: character, ignorePits: true }).ok));
}

export function collectLoot(state, lootId) {
  const entity = state.entities.find((candidate) => candidate.id === lootId);
  const character = getActiveCarrier(state);
  if (character && !transformationMovementRules(state, character).canPickUpGear) return { collected: 0, message: 'Levitating characters cannot pick up gear.' };
  if (entity?.fixedObject?.rounds > 0) return { collected: 0, message: 'That object is fixed in place.' };
  if (state.characters?.length && !partyCanReachLoot(state, entity)) return { collected: 0, message: 'Move a party member beside this item to pick it up.' };
  if (entity && !sameRoute(state, entity, state.player)) return { collected: 0, message: 'That item is in a different passage.' };
  if(concealedMimic(entity)) {
    if(!state.characters?.length)return {collected:0,message:'Import or load a character to pick up treasure.'};
    state.pendingAmbush={monsterId:entity.id,targetId:state.activeCharacterId};
    return {collected:0,interrupted:true,message:'The treasure attacks!'};
  }
  if (!entity || entity.collected || (entity.type !== ENTITY_TYPES.TREASURE && entity.type !== ENTITY_TYPES.FEATURE)) {
    return { collected: 0, message: "Loot item not found." };
  }
  const collectable = entity.type === ENTITY_TYPES.TREASURE
    ? entity
    : isWorthlessFeature(entity)
      ? createWorthlessLootEntity(state, entity, entity.name || "worthless loot")
      : null;
  if (!collectable) {
    return { collected: 0, message: "Loot item not found." };
  }

  const trap = findActiveTrapForTarget(state, "treasure", collectable.id);
  if (trap) {
    const result = revealAndTriggerTrap(trap,state);
    return {
      collected: 0,
      interrupted: true,
      message: result.message
    };
  }

  if (!character) {
    return { collected: 0, message: "Select a character to carry treasure." };
  }

  const coinBreakdown = normalizeCoinBreakdownFromEntity(collectable);
  if (coinBreakdown) {
    collectable.coinBreakdown = coinBreakdown;
  }
  const itemSlots = getTreasureSlotCost(collectable);
  const requiredSlots = coinBreakdown
    ? getCoinPickupSlotCost(character, coinBreakdown)
    : itemSlots;
  if (getCharacterGearFreeSlots(character) < requiredSlots) {
    return {
      collected: 0,
      noFreeSlots: true,
      message: "No free slots."
    };
  }

  collectable.collected = true;
  state.recentTreasurePickup={characterId:character.id,x:collectable.x,y:collectable.y};
  const treasureName = collectable.corpseLoot && collectable.monsterName
    ? `pieces of ${collectable.monsterName}`
    : collectable.name || "treasure";
  if (coinBreakdown) {
    character.gold = clampCoinValue(Number(character.gold || 0) + Number(coinBreakdown.gold || 0));
    character.silver = clampCoinValue(Number(character.silver || 0) + Number(coinBreakdown.silver || 0));
    character.copper = clampCoinValue(Number(character.copper || 0) + Number(coinBreakdown.copper || 0));
    character.raw = character.raw || {};
    character.raw.gold = character.gold;
    character.raw.silver = character.silver;
    character.raw.copper = character.copper;
    normalizeCharacterState(state);
    return {
      collected: 1,
      message: `Got: ${treasureName} (${getCoinValueInCopper(coinBreakdown)} cp).`
    };
  }

  character.gear = Array.isArray(character.gear) ? character.gear : [];
  const gearItem = collectable.gearItem
    ? JSON.parse(JSON.stringify(collectable.gearItem))
    : {
      name: treasureName,
      quantity: 1,
      totalUnits: 1,
      value: Math.max(0, Number(collectable.value) || 0),
      slots: itemSlots,
      bonusSlots: getItemBonusSlots(collectable),
      priceless: collectable.priceless === true,
      description: collectable.description || "",
      treasureItem: true,
      treasureKind: collectable.kind || collectable.subtype || "treasure",
      worthlessLoot: collectable.worthlessLoot === true,
      corpseLoot: collectable.corpseLoot === true,
      monsterName: collectable.monsterName || ""
    };
  character.gear.push({
    id: collectable.id,
    ...gearItem,
    name: collectable.gearItem ? (gearItem.name || treasureName) : treasureName,
    quantity: Number(gearItem.quantity || gearItem.totalUnits || 1) || 1,
    totalUnits: Number(gearItem.totalUnits || gearItem.quantity || 1) || 1,
    value: Math.max(0, Number(gearItem.value ?? collectable.value) || 0),
    slots: itemSlots,
    bonusSlots: getItemBonusSlots(collectable),
    priceless: collectable.priceless === true,
    description: collectable.description || gearItem.description || "",
    treasureItem: !collectable.gearItem,
    treasureKind: collectable.kind || collectable.subtype || "treasure",
    worthlessLoot: collectable.worthlessLoot === true || gearItem.worthlessLoot === true,
    corpseLoot: collectable.corpseLoot === true || gearItem.corpseLoot === true,
    monsterName: collectable.monsterName || gearItem.monsterName || "",
    ...(collectable.fireDamage ? { fireDamage: JSON.parse(JSON.stringify(collectable.fireDamage)) } : {})
  });
  normalizeCharacterState(state);
  return {
    collected: 1,
    message: `Got: ${treasureName} (${getLootValueLabel(collectable)}).`
  };
}

export function collectRoomLoot(state) {
  const loot = getRoomLoot(state).filter((entity) => entity.subtype !== "dropped-equipment");
  let totalValue = 0;
  let collected = 0;

  for (const entity of loot) {
    const result = collectLoot(state, entity.id);
    if (result.interrupted) {
      return result;
    }
    if (result.collected) {
      collected += 1;
      totalValue += Number(entity.value) || 0;
    }
  }

  if (!collected) {
    return { collected: 0, message: "No revealed treasure in view." };
  }
  return {
    collected,
    message: `Got ${collected} item${collected === 1 ? "" : "s"} (${formatTreasureValue(totalValue)} total).`
  };
}

export function dropLootAtPlayer(state, lootId) {
  const character = getActiveCarrier(state);
  if (!character || !Array.isArray(character.gear)) {
    return { message: "No carried treasure to leave." };
  }
  const index = character.gear.findIndex((item) => String(item?.id || "") === String(lootId));
  if (index === -1) {
    return { message: "Loot item not found." };
  }
  const [entry] = character.gear.splice(index, 1);
  character.raw = character.raw || {};
  if (entry.treasureItem) {
    state.entities.push({
      id: `${entry.id}-dropped-${Date.now()}`,
      type: ENTITY_TYPES.TREASURE,
      subtype: "dropped-loot",
      name: entry.name,
      kind: entry.treasureKind || "treasure",
      x: state.player.x,
      y: state.player.y,
      routeId: routeOf(state, state.player),
      roomId: state.player.roomId,
      hallId: getTile(state, state.player.x, state.player.y)?.hallId || null,
      visible: true,
      value: entry.value,
      slots: getItemSlots(entry),
      bonusSlots: getItemBonusSlots(entry),
      priceless: entry.priceless === true,
      description: entry.description || "",
      collected: false,
      worthlessLoot: entry.worthlessLoot === true,
      corpseLoot: entry.corpseLoot === true,
      monsterName: entry.monsterName || ""
    });
    return { message: `Left ${entry.name} (${getLootValueLabel(entry)}).` };
  }
  character.gear.splice(index, 0, entry);
  return { message: "That item cannot be left here." };
}

export function getInventorySummary(state) {
  const inventory = ensureInventory(state);
  return {
    usedSlots: inventory.usedSlots,
    bonusSlots: inventory.bonusSlots,
    capacity: getInventoryCapacity(state)
  };
}

export function toggleTorch(state) {
  state.player.torchLit = !state.player.torchLit;
  recomputeVisibility(state);
  return { torchLit: state.player.torchLit };
}

export function getRoomTraps(state) {
  return state.entities.filter((entity) => {
    return (
      entity.type === ENTITY_TYPES.TRAP &&
      entity.revealed &&
      sameRoute(state, entity, state.player) &&
      entity.roomId === state.player.roomId
    );
  });
}

export function rollCheck(modifier, options = {}) {
  const firstRoll = Math.floor(Math.random() * 20) + 1;
  const usesPairedRoll = options.doubleRoll === true || options.disadvantage === true;
  const secondRoll = usesPairedRoll ? Math.floor(Math.random() * 20) + 1 : null;
  const roll = secondRoll === null
    ? firstRoll
    : options.disadvantage === true
      ? Math.min(firstRoll, secondRoll)
      : Math.max(firstRoll, secondRoll);
  const normalizedModifier = Math.max(-99, Math.min(99, Number(modifier) || 0));
  return {
    roll,
    firstRoll,
    secondaryRoll: secondRoll,
    checkMode: options.disadvantage === true ? "disadvantage" : options.doubleRoll === true ? "advantage" : "normal",
    modifier: normalizedModifier,
    total: roll + normalizedModifier
  };
}

function isSearchCandidate(entity, roomId) {
  if (entity.roomId !== roomId) {
    return false;
  }
  if (entity.subtype === "door" && entity.secret === true) {
    return entity.secretFound !== true;
  }
  if (entity.type === ENTITY_TYPES.TRAP) {
    return !entity.revealed && !entity.triggered && !entity.disarmed;
  }
  if (entity.type === ENTITY_TYPES.TREASURE) {
    return entity.visible === false && !entity.collected;
  }
  return false;
}

export function searchForTraps(state, modifier, options = {}) {
  if (!isTileIlluminated(state, state.player.x, state.player.y, state.player)) {
    return {
      roll: 0,
      modifier: 0,
      total: 0,
      found: [],
      message: "Searching impossible in total darkness.",
      darknessMessage: "Searching impossible in total darkness."
    };
  }

  const check = rollCheck(modifier, options);
  const candidates = state.entities.filter((entity) => sameRoute(state, entity, state.player) &&
    isSearchCandidate(entity, state.player.roomId) && isTileIlluminated(state, entity.x, entity.y, entity));

  const found = candidates.filter((entity) => check.total >= (entity.searchDc ?? entity.dc));
  let foundSecretDoor = false;
  for (const entity of found) {
    if (entity.subtype === "door" && entity.secret === true) {
      revealSecretDoor(entity, state);
      foundSecretDoor = true;
    } else {
      entity.revealed = true;
      entity.visible = true;
    }
  }
  if (foundSecretDoor) {
    recomputeVisibility(state);
  }

  return {
    ...check,
    found,
    message: found.length
      ? `Search ${check.total} revealed: ${found.map((entity) => {
          if (entity.type === ENTITY_TYPES.TRAP) {
            return `${entity.name} (trigger: ${entity.trigger}; effect: ${entity.effect})`;
          }
          if (entity.subtype === "door" && entity.secret === true) {
            return "secret door";
          }
          return `${entity.name} (${formatTreasureValue(entity.value)})`;
        }).join("; ")}` 
      : `Search ${check.total}: no hidden traps or treasure found.`
  };
}

export function disarmTrap(state, trapId, modifier, options = {}) {
  const trap = state.entities.find((entity) => entity.id === trapId && entity.type === ENTITY_TYPES.TRAP);
  if (!trap || !sameRoute(state, trap, state.player) || !trap.revealed || trap.triggered || trap.disarmed) {
    return {
      ...rollCheck(modifier, options),
      disarmed: false,
      triggered: false,
      message: "No active revealed trap to disarm."
    };
  }

  const check = rollCheck(modifier, options);
  if (check.total >= trap.dc) {
    const trapIndex = state.entities.findIndex((entity) => entity.id === trap.id);
    if (trapIndex !== -1) {
      state.entities.splice(trapIndex, 1);
    }
    addFeature(state, trap.x, trap.y, trap.roomId, `broken ${trap.name}`);
    return {
      ...check,
      disarmed: true,
      triggered: false,
      message: `disarmed: ${trap.name}. A broken ${trap.name} remains.`
    };
  }

  if (check.total > trap.dc - 5) {
    return {
      ...check,
      disarmed: false,
      triggered: false,
      message: "Failed to disarm. Try again?"
    };
  }

  const result = revealAndTriggerTrap(trap,state);
  return {
    ...check,
    disarmed: false,
    triggered: true,
    trapSprung: result.trapSprung,
    message: result.message
  };
}

export function attemptLockedDoor(state, method, modifier = 0, options = {}) {
  const requestedDoor = method === 'break' && options.doorId ? state.entities.find(entity => entity.id === options.doorId && entity.subtype === 'door') : null;
  const requestedDcs = requestedDoor ? ensureDoorLockDcs(requestedDoor) : null;
  const action = requestedDoor ? { doorId: requestedDoor.id, pickDc: requestedDcs.pickDc, breakDc: requestedDcs.breakDc } : getPendingLockedDoorAction(state);
  if (!action) {
    return {
      ...rollCheck(modifier, options),
      opened: false,
      message: "No locked door selected."
    };
  }

  const door = state.entities.find((entity) => entity.id === action.doorId && entity.subtype === "door");
  if (door && !sameRoute(state, door, state.player)) return { opened: false, message: 'That door is in a different passage.' };
  const dc = method === "break" ? action.breakDc : action.pickDc;
  const check = rollCheck(modifier, options);
  if (check.total < dc) {
    return {
      ...check,
      opened: false,
      dc,
      method,
      lockedDoor: action,
      message: `${method === "break" ? "Break" : "Pick lock"} ${check.total} vs DC ${dc}: failed.`
    };
  }

  const trap = findActiveTrapForTarget(state, "door", door?.id);
  if (method === "break") {
    const doorIndex = state.entities.findIndex((entity) => entity.id === action.doorId && entity.subtype === "door");
    if (doorIndex !== -1) {
      state.entities.splice(doorIndex, 1);
    }
  } else {
    setDoorState(door, DOOR_STATES.OPEN);
  }
  clearLockedDoorAction(state);
  recomputeVisibility(state);

  if (trap) {
    const result = revealAndTriggerTrap(trap,state);
    return {
      ...check,
      opened: true,
      destroyed: method === "break",
      dc,
      method,
      trapSprung: true,
      message: `${method === "break" ? "Door broken open" : "Lock picked"}. You've run into a trapped door! ${result.message}`
    };
  }

  return {
    ...check,
    opened: true,
    destroyed: method === "break",
    dc,
    method,
    message: `${method === "break" ? "Door broken open" : "Lock picked"}. Door open.`
  };
}
