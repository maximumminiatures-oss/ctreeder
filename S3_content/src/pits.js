import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { hasGrit } from './class-progression.js';
import { isIncorporeal, isSleeping, wakeCreature } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { getTile } from './state-schema.js';
import { sameRoute, routeOf } from './underpasses.js';

const key = (x, y) => `${x},${y}`;
const adjacent = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
const alive = creature => creature && !creature.dead && !creature.slain && !creature.defeated && !creature.leftPeacefully && Number(creature.hp) > 0;
export const isPit = entity => entity?.subtype === 'arcane-sinkhole' || entity?.subtype === 'pit' || entity?.pit === true ||
  entity?.type === 'trap' && entity.targetType === 'tile' && /\bpit\b/i.test(entity.name || '');
export const pitIsOpen = pit => isPit(pit) && (pit.subtype === 'arcane-sinkhole' || pit.subtype === 'pit' || pit.triggered === true);
export const pitIsKnown = pit => isPit(pit) && (pitIsOpen(pit) || pit.revealed === true && !pit.disarmed);
export const avoidsFalling = creature => isFloatingDisc(creature) || isIncorporeal(creature) ||
  /\bfly(?:ing)?\b/i.test([creature?.movement, creature?.companion?.source?.movement, ...(creature?.tags || [])].join(' '));

export function pitContains(pit, x, y) {
  if (Array.isArray(pit.cells)) return pit.cells.some(cell => cell.x === x && cell.y === y);
  if (pit.subtype === 'arcane-sinkhole') return Math.hypot(x - pit.x, y - pit.y) <= (Number(pit.radius) || 0);
  return x >= pit.x && y >= pit.y && x < pit.x + Math.max(1, Number(pit.width) || 1) && y < pit.y + Math.max(1, Number(pit.height) || 1);
}

export function pitCells(state, pit) {
  if (Array.isArray(pit.cells)) return pit.cells;
  return (state.tiles || []).filter(tile => tile.type === 'floor' && pitContains(pit, tile.x, tile.y)).map(tile => ({ x: tile.x, y: tile.y }));
}

export function knownPitAt(state, x, y, creature = null) {
  if (creature && avoidsFalling(creature)) return null;
  return (state.entities || []).find(pit => pitIsKnown(pit) && (!creature || sameRoute(state, pit, creature)) && pitContains(pit, x, y)) || null;
}

export function pitAdjacent(state, pit, creature, canStep = () => true) {
  return sameRoute(state, pit, creature) && !pitContains(pit, creature.x, creature.y) && pitCells(state, pit).some(cell => adjacent(cell, creature) &&
    canStep(creature.x, creature.y, cell.x, cell.y));
}

export function safePitRim(state, pit, creature, { canStep = () => true, prefer = creature } = {}) {
  if (!pit) return null;
  const upper = { ...creature, routeId: routeOf(state, pit) };
  const step = (x, y, nx, ny) => canStep(x, y, nx, ny, upper);
  const cells = pitCells(state, pit), occupied = new Set(), candidates = new Map();
  for (const other of [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')]) {
    if (other.id !== creature.id && sameRoute(state, other, upper) && !isFloatingDisc(other) && !isIncorporeal(other) && !other.conditions?.sinkhole &&
        !other.dead && !other.slain && !other.defeated && !other.leftPeacefully) occupied.add(key(other.x, other.y));
  }
  for (const cell of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = cell.x + dx, y = cell.y + dy, tile = getTile(state, x, y);
    if (!tile || pitContains(pit, x, y)) continue;
    const entry = candidates.get(key(x, y)) || { tile, approaches: [] };
    entry.approaches.push(cell); candidates.set(key(x, y), entry);
  }
  return [...candidates.values()].filter(({ tile, approaches }) => tile.type === 'floor' && !knownPitAt(state, tile.x, tile.y) &&
    !occupied.has(key(tile.x, tile.y)) &&
    !(state.entities || []).some(entity => entity.type === 'trap' && entity.revealed && !entity.disarmed && !entity.triggered && entity.x === tile.x && entity.y === tile.y) &&
    step(tile.x, tile.y, tile.x, tile.y) && approaches.some(cell => step(cell.x, cell.y, tile.x, tile.y)))
    .map(entry => entry.tile)
    .sort((a, b) => Math.hypot(a.x - prefer.x, a.y - prefer.y) - Math.hypot(b.x - prefer.x, b.y - prefer.y) || a.y - b.y || a.x - b.x)[0] || null;
}

function relocate(state, creature, tile, routeId = routeOf(state, creature)) {
  Object.assign(creature, { x: tile.x, y: tile.y, roomId: tile.roomId ?? null });
  creature.routeId = routeId;
  if (state.activeCharacterId === creature.id) Object.assign(state.player, { x: tile.x, y: tile.y, roomId: tile.roomId ?? null, routeId });
}

export function pitAtBottom(state, creature) {
  return (state.entities || []).find(pit => pitIsOpen(pit) && (pit.id === creature?.conditions?.sinkhole ||
    pit.lowerRouteId && pit.lowerRouteId === routeOf(state, creature) && pitContains(pit, creature.x, creature.y))) || null;
}

export function ropeDescents(state, creature, { canStep = () => true } = {}) {
  if (!alive(creature) || creature.dyingRounds > 0 || creature.conditions?.sinkhole || isSleeping(creature, state) ||
      creature.conditions?.paralyzed || isIncorporeal(creature) || isFloatingDisc(creature) ||
      !(creature.gear || []).some(item => /\brope\b/i.test(item.name || '') && Number(item.totalUnits ?? item.quantity ?? 1) > 0)) return [];
  return (state.entities || []).filter(pit => pitIsOpen(pit) && pitAdjacent(state, pit, creature,
    (x, y, nx, ny) => canStep(x, y, nx, ny, creature))).filter(pit => descentCell(state, pit, creature, canStep));
}

function descentCell(state, pit, creature, canStep) {
  return pitCells(state, pit).filter(cell => adjacent(cell, creature) && canStep(creature.x, creature.y, cell.x, cell.y, creature) &&
    ![...(state.characters || []), ...(state.entities || []).filter(item => item.type === 'monster')].some(other =>
      other.id !== creature.id && alive(other) && other.x === cell.x && other.y === cell.y &&
      (pit.lowerRouteId ? routeOf(state, other) === pit.lowerRouteId : other.conditions?.sinkhole === pit.id)))
    .sort((a, b) => Math.hypot(a.x - creature.x, a.y - creature.y) - Math.hypot(b.x - creature.x, b.y - creature.y))[0];
}

export function descendWithRope(state, creature, pitId, options = {}) {
  const pit = ropeDescents(state, creature, options).find(item => item.id === pitId);
  if (!pit) throw new Error('Climbing down requires rope and a free adjacent pit entrance.');
  const cell = descentCell(state, pit, creature, options.canStep || (() => true));
  creature.conditions ||= {};
  delete creature.lastPitAscent;
  if (pit.lowerRouteId) { delete creature.conditions.sinkhole; relocate(state, creature, cell, pit.lowerRouteId); }
  else { creature.conditions.sinkhole = pit.id; relocate(state, creature, cell); }
  return { pit, message: `${creature.name} climbs down using rope, without falling damage.` };
}

export function escapePit(state, creature, pit, options = {}) {
  const destination = safePitRim(state, pit, creature, options);
  if (!destination) throw new Error('There is no free, safe square beside this pit.');
  relocate(state, creature, destination, routeOf(state, pit));
  creature.lastPitAscent = { pitId: pit.id, x: destination.x, y: destination.y };
  delete creature.conditions.sinkhole;
  delete creature.conditions.prone;
  delete creature.conditions.pitLedge;
  return destination;
}

export function fallIntoPit(state, pit, creature, { random = Math.random, queueFall } = {}) {
  if (!alive(creature) || avoidsFalling(creature) || creature.conditions?.sinkhole) return null;
  const rolls = Array.from({ length: 3 }, () => Math.floor(random() * 6) + 1);
  const damage = rolls.reduce((sum, roll) => sum + roll, 0), hpBefore = Number(creature.hp);
  creature.conditions ||= {};
  creature.conditions.prone = true;
  creature.conditions.sinkhole = pit.id;
  if (pit.lowerRouteId) {
    delete creature.conditions.sinkhole;
    relocate(state, creature, creature, pit.lowerRouteId);
  }
  delete creature.conditions.pitLedge;
  const event = { sourceId: pit.id, damage, manual: false };
  const party = (state.characters || []).includes(creature);
  const pending = party && queueFall?.(creature, event);
  if (!pending) {
    if (party) setCharacterHp(creature, Number(creature.hp) - damage, { sourceId: pit.id });
    else { creature.hp = Math.max(0, Number(creature.hp) - damage); wakeCreature(creature, state); }
  }
  creature.lastPitFall = { pitId: pit.id, rolls, damage, hpBefore, hpAfter: Number(creature.hp), pending: Boolean(pending) };
  return { id: creature.id, passed: false, ...creature.lastPitFall };
}

export function resolvePitSave(state, pit, creature, { check, canStep, ...options } = {}) {
  if (!alive(creature) || avoidsFalling(creature) || creature.conditions?.sinkhole) return null;
  const party = (state.characters || []).includes(creature);
  const save = check(party ? abilityScoreModifier(creature.stats?.DEX) : Number(creature.D) || 0,
    { doubleRoll: party && hasGrit(creature, 'DEX') });
  if (save.total >= 15) {
    const destination = safePitRim(state, pit, creature, { canStep });
    if (destination) relocate(state, creature, destination);
    else {
      // A crowded/fully collapsed map may have no legal rim: keep a safe ledge, never teleport into a wall.
      creature.conditions ||= {}; creature.conditions.pitLedge = pit.id;
    }
    return { id: creature.id, passed: true, check: save, destination: destination && { x: destination.x, y: destination.y } };
  }
  return { ...fallIntoPit(state, pit, creature, options), check: save };
}

export function openPit(state, pit, options = {}) {
  pit.pit = true; pit.triggered = true; pit.revealed = true; pit.visible = true; pit.wasSprung = true;
  pit.depthFeet = 30;
  pit.originalEffect ??= pit.effect;
  pit.effect = 'DC 15 DEX or 3d6 falling damage and prone. DC 15 STR and an action to climb out; an adjacent ally with rope can rescue automatically.';
  pit.damageType = 'falling';
  if (!pit.cells) pit.cells = pitCells(state, pit);
  const affected = [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')]
    .filter(creature => sameRoute(state, pit, creature) && pitContains(pit, creature.x, creature.y));
  return affected.map(creature => resolvePitSave(state, pit, creature, options)).filter(Boolean);
}

export function climbFromPit(state, creature, { check, canStep } = {}) {
  const pit = pitAtBottom(state, creature);
  if (!pit) throw new Error('This creature is not in a pit.');
  if (!safePitRim(state, pit, creature, { canStep })) throw new Error('There is no free, safe square beside this pit.');
  const party = (state.characters || []).includes(creature);
  const roll = check(party ? abilityScoreModifier(creature.stats?.STR) : Number(creature.S) || 0,
    { doubleRoll: party && hasGrit(creature, 'STR') });
  if (roll.total >= 15) escapePit(state, creature, pit, { canStep });
  return { check: roll, escaped: roll.total >= 15, message: `${creature.name} tries to climb out: ${roll.total} vs DC 15; ${roll.total >= 15 ? 'escaped' : 'failed'}.` };
}

export function ropeRescues(state, helper, { canStep } = {}) {
  if (!alive(helper) || helper.conditions?.sinkhole || isSleeping(helper, state) || isIncorporeal(helper) || isFloatingDisc(helper) ||
      !(helper.gear || []).some(item => /\brope\b/i.test(item.name || '') && Number(item.totalUnits ?? item.quantity ?? 1) > 0)) return [];
  return (state.characters || []).flatMap(target => {
    if (!alive(target) || target.dyingRounds > 0 || isSleeping(target, state)) return [];
    const pit = pitAtBottom(state, target);
    if (!pit || !pitAdjacent(state, pit, helper, canStep) || !safePitRim(state, pit, target, { canStep, prefer: helper })) return [];
    return [{ pit, target }];
  });
}

export function rescueWithRope(state, helper, targetId, options = {}) {
  const rescue = ropeRescues(state, helper, options).find(option => option.target.id === targetId);
  if (!rescue) throw new Error('Rope rescue requires rope, a safe adjacent helper, and a conscious character in the pit.');
  escapePit(state, rescue.target, rescue.pit, { ...options, prefer: helper });
  return { target: rescue.target, message: `${helper.name} uses rope to help ${rescue.target.name} climb out of the pit.` };
}

export function pushTargets(state, character, { canStep, canSee = () => true } = {}) {
  if (!alive(character) || character.conditions?.sinkhole || isIncorporeal(character) || isFloatingDisc(character)) return [];
  const fighter = /\bfighter\b/i.test(character.className || character.class || '');
  return (state.entities || []).filter(monster => monster.type === 'monster' && alive(monster) && !avoidsFalling(monster) &&
    !monster.conditions?.sinkhole && sameRoute(state, character, monster) && adjacent(character, monster) && canSee(monster) &&
    (fighter || isSleeping(monster, state) || Boolean(monster.conditions?.paralyzed)) &&
    (!canStep || canStep(character.x, character.y, monster.x, monster.y)))
    .flatMap(monster => (state.entities || []).filter(pit => pitIsOpen(pit) && pitAdjacent(state, pit, monster, canStep)).map(pit => ({
      pit, monster, automatic: isSleeping(monster, state) || Boolean(monster.conditions?.paralyzed)
    })));
}

export function pushIntoPit(state, character, monsterId, pitId, { check, ...options } = {}) {
  const option = pushTargets(state, character, options).find(item => item.monster.id === monsterId && item.pit.id === pitId);
  if (!option) throw new Error('That monster cannot be pushed into this pit.');
  const roll = option.automatic ? null : check(abilityScoreModifier(character.stats?.STR), { doubleRoll: hasGrit(character, 'STR') });
  const succeeded = option.automatic || roll.total >= (Number(option.monster.ac ?? option.monster.AC) || 10);
  if (succeeded) {
    const cell = pitCells(state, option.pit).filter(cell => adjacent(cell, option.monster) &&
      (!options.canStep || options.canStep(option.monster.x, option.monster.y, cell.x, cell.y)))
      .sort((a, b) => Math.hypot(b.x - character.x, b.y - character.y) - Math.hypot(a.x - character.x, a.y - character.y))[0];
    relocate(state, option.monster, cell);
    const fall = fallIntoPit(state, option.pit, option.monster, options);
    return { check: roll, succeeded, monster: option.monster, fall,
      message: `${character.name} pushes ${option.monster.name} into the pit${roll ? `: ${roll.total} vs AC ${option.monster.ac ?? option.monster.AC}` : ' automatically'}; 3d6 = (${fall.rolls.join(' + ')}) = ${fall.damage} falling damage. ${option.monster.name}: ${fall.hpBefore} to ${fall.hpAfter} HP.` };
  }
  return { check: roll, succeeded, monster: option.monster, message: `${character.name} fails to push ${option.monster.name}: ${roll.total} vs AC ${option.monster.ac ?? option.monster.AC}.` };
}

export const PIT_ASSET_KEYS = ['pit-1x1', 'pit-n', 'pit-e', 'pit-s', 'pit-w', 'pit-nw', 'pit-ne', 'pit-se', 'pit-sw'];
export function pitArt(state, pit) {
  const cells = pitCells(state, pit), set = new Set(cells.map(cell => key(cell.x, cell.y)));
  return cells.map(cell => {
    const sides = ['n', 'e', 's', 'w'].filter((side, index) => {
      const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][index];
      return !set.has(key(cell.x + dx, cell.y + dy));
    });
    const corner = [['n', 'w', 'nw'], ['n', 'e', 'ne'], ['s', 'e', 'se'], ['s', 'w', 'sw']].find(([a, b]) => sides.includes(a) && sides.includes(b));
    return { ...cell, sides, asset: sides.length === 4 ? 'pit-1x1' : sides.length === 1 ? `pit-${sides[0]}` :
      sides.length === 2 && corner ? `pit-${corner[2]}` : null };
  });
}
