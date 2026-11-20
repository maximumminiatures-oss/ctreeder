import { highestMagicSaleValue, isMagicItem } from './magic-items.js';
import { SeededRng } from './rng.js';
import { ensureMonsterGear } from './companions.js';
import { monsterScore } from './encounters.js';
import { getUsedGearSlots } from './characters.js';
import { createTreasureDetails, createTableTreasureDetails, printedEquipmentUnitValue, applyPrintedEquipmentValue, setTreasurePileValue } from './treasure.js';
import { seedLeprechaunGold, isLeprechaun } from './leprechaun.js';
import { coffinGear, isVampire } from './supernatural-traits.js';
import { routeOf } from './underpasses.js';

const cp = value => Math.max(0, Math.round((Number(value) || 0) * 100));
const units = item => item.treasureItem ? 1 : Math.max(1, Number(item.totalUnits ?? item.quantity ?? 1) || 1);
const coinCopper = coins => (Number(coins?.gold) || 0) * 100 + (Number(coins?.silver) || 0) * 10 + (Number(coins?.copper) || 0);
const treasures = state => state.entities.filter(e => e.type === 'treasure' && !e.collected);
const monsters = state => state.entities.filter(e => e.type === 'monster' && !e.defeated && !e.conjuredCreature);
// Authored table adjectives such as 'enchanted' are not catalog magic records.
const fixedMagic = item => isMagicItem(item && {...item,name:''});
function carriedSlots(gear) {
  const coinCount = gear.filter(item => item.coinBreakdown).reduce((n,item) => n + Object.values(item.coinBreakdown).reduce((a,b) => a + Number(b || 0),0),0);
  return getUsedGearSlots(gear.filter(item => !item.coinBreakdown),{useStoredSlots:true}) + Math.max(0,Math.ceil((coinCount-100)/100));
}


// Beta(1,4) on [4000,6000] has mean 4400. This shapes generation only;
// it never exchanges, reprices or replenishes wealth in a running game.
export function rollFloorWealthTarget(level, rng) {
  return Math.round(Math.max(1, Number(level) || 1) * (4000 + 2000 * (1 - (1 - Math.min(1, Math.max(0, rng.nextFloat()))) ** .25)) * 100) / 100;
}
export function floorWealthTarget(seed, level) {
  const rng = new SeededRng(Number(seed) + 91873);
  for (let i = 0; i < 8; i++) rng.next();
  return rollFloorWealthTarget(level, rng);
}

export function inventoryWealthCopper(item) {
  if (item.coinBreakdown) return coinCopper(item.coinBreakdown);
  const magic = highestMagicSaleValue(item);
  if (magic !== null) return cp(magic);
  const printed = printedEquipmentUnitValue(item);
  return cp((printed ?? item.value ?? item.costGp ?? item.cost ?? 0) * units(item));
}
function eligible(item, kind) {
  return Boolean(isMagicItem(item) || item?.foolsGold || item?.coinBreakdown || item?.treasureItem ||
    !item && !['gear', 'weapon', 'armor', 'dropped-equipment'].includes(kind));
}
function trapped(state, entity) {
  return state.entities.some(e => e.type === 'trap' && !e.disarmed && !e.triggered &&
    e.targetType === 'treasure' && e.targetEntityId === entity.id);
}
function concealed(entity) {
  return entity.visible === false && entity.revealed !== true && Number.isFinite(entity.searchDc) && entity.searchDc > 0;
}
function entryList(state) {
  const entries = treasures(state).map(entity => ({ entity, item: entity.gearItem,
    copper: entity.coinBreakdown ? coinCopper(entity.coinBreakdown) : entity.gearItem ? inventoryWealthCopper(entity.gearItem) : cp(entity.value),
    eligible: eligible(entity.gearItem, entity.kind),
    challenged: concealed(entity) || trapped(state, entity) || Boolean(entity.generationSecretGate),
    mutable: !entity.generationFixedValue && !fixedMagic(entity.gearItem) &&
      !(entity.gearItem && printedEquipmentUnitValue(entity.gearItem) !== null) }));
  for (const monster of monsters(state)) for (const item of (monster.gear || ensureMonsterGear(monster))) entries.push({
    monster, item, copper: inventoryWealthCopper(item), eligible: eligible(item), challenged: true,
    mutable: item.generationMutable === true && !fixedMagic(item) && !item.coinBreakdown });
  return entries;
}

export function auditStartingWealth(state) {
  const entries = entryList(state);
  const total = entries.reduce((n, e) => n + e.copper, 0);
  const eligibleTotal = entries.reduce((n, e) => n + (e.eligible ? e.copper : 0), 0);
  const challengedTotal = entries.reduce((n, e) => n + (e.challenged ? e.copper : 0), 0);
  return { totalGp: total / 100, treasureCoinsMagicGp: eligibleTotal / 100, challengedGp: challengedTotal / 100,
    ordinaryEquipmentGp: (total - eligibleTotal) / 100,
    carriedGp: entries.reduce((n, e) => n + (e.monster ? e.copper : 0), 0) / 100,
    eligibleShare: total ? eligibleTotal / total : 0, challengedShare: total ? challengedTotal / total : 0 };
}
function groundEntity(state, loot, point, extra = {}) {
  const entity = { id: `initial-wealth-${state.entities.length}`, type: 'treasure', subtype: loot.kind || 'treasure',
    ...structuredClone(loot), x: point.x, y: point.y, roomId: point.roomId, routeId: routeOf(state, point),
    visible: false, revealed: false, collected: false, searchDc: loot.searchDc || 12, ...extra };
  state.entities.push(entity);
  return entity;
}
function treasureGear(loot) {
  if (loot.gearItem) return structuredClone(loot.gearItem);
  return { name: loot.name, type: 'sundry', treasureItem: true, treasureKind: loot.kind,
    quantity: 1, totalUnits: 1, slots: loot.slots ?? 1, bonusSlots: loot.bonusSlots ?? 0,
    value: loot.value, description: loot.description || '',
    ...(loot.coinBreakdown ? { coinBreakdown: structuredClone(loot.coinBreakdown) } : { generationMutable: true }) };
}
function priceInventory(item) {
  const printed = printedEquipmentUnitValue(item);
  if (printed !== null) item.value = printed;
  else if (item.value == null && item.costGp != null) item.value = Number(item.costGp) || 0;
}

// Materialize initial rewards once. Runtime death/steal/charm transfer these items.
// Wandering monsters and legacy saves retain their existing reward path.
export function prepareStartingWealth(state, rng) {
  for (const monster of monsters(state)) {
    if (monster.startingWealthAllocated) continue;
    monster.startingWealthAllocated = true;
    const gear = ensureMonsterGear(monster);
    for (const item of gear) priceInventory(item);
    if (isLeprechaun(monster)) {
      seedLeprechaunGold(state, monster, (item, point) => groundEntity(state,
        { name: item.name, value: item.value, slots: item.slots, kind: 'magic', gearItem: item }, point,
        { visible: true, revealed: true, generationFixedValue: true }), () => rng.nextFloat());
      const gold = monster.genuineGold;
      const pouch = { name: `${gold} GP`, type: 'sundry', quantity: 1, totalUnits: 1, value: gold,
        slots: Math.max(0, Math.ceil((gold - 100) / 100)), coinBreakdown: { gold, silver: 0, copper: 0 } };
      const capacity = Math.max(1, monsterScore(monster, 'S'));
      if (carriedSlots([...gear, pouch]) + (monster.shoesCreated ? 0 : 1) <= capacity) gear.push(pouch);
      else groundEntity(state, { name:pouch.name, kind:'coin-cache', value:gold, slots:pouch.slots,
        coinBreakdown:pouch.coinBreakdown }, monster, {generationFixedValue:true});
      monster.genuineGoldAllocated = true;
      if (!monster.shoesCreated) { gear.push({ name: 'Little Shoes', quantity: 1, slots: 1, type: 'sundry' }); monster.shoesCreated = true; }
    }
    if (isVampire(monster) && !monster.coffinPlaced) {
      const point = state.tiles.find(t => t.roomId === monster.roomId && t.type === 'floor' &&
        Math.hypot(t.x - monster.x, t.y - monster.y) >= 1 && routeOf(state, t) === routeOf(state, monster) &&
        !state.entities.some(e => e.x === t.x && e.y === t.y && e.blocksMovement)) || monster;
      groundEntity(state, { name: 'Coffin', value: 10, slots: 5, kind: 'gear', gearItem: coffinGear() }, point,
        { visible: true, revealed: true, generationFixedValue: true });
      monster.coffinPlaced = true;
    }
    if (!isLeprechaun(monster) && rng.nextFloat() < .75) {
      const loot = createTreasureDetails({...state,level:Math.max(1,Number(monster.level ?? state.level ?? 1) || 1)}, rng), item = treasureGear(loot);
      priceInventory(item);
      const capacity = Math.max(1, monsterScore(monster, 'S'));
      if (carriedSlots([...gear, item]) <= capacity) gear.push(item);
      else groundEntity(state, loot, monster);
    }
    monster.carriedGear = gear;
  }
  for (const entity of treasures(state)) applyPrintedEquipmentValue(entity);
  return auditStartingWealth(state);
}

function hideTreasure(entity, rng) {
  entity.visible = false; entity.revealed = false;
  entity.searchDc = Number(entity.searchDc) > 0 ? entity.searchDc : rng.nextInt(8, 14);
}
function assignValue(entry, copper) {
  if (entry.entity) { setTreasurePileValue(entry.entity, copper / 100); entry.copper = entry.entity.coinBreakdown ? coinCopper(entry.entity.coinBreakdown) : cp(entry.entity.value); }
  else { entry.item.value = copper / 100 / units(entry.item); entry.copper = inventoryWealthCopper(entry.item); }
}
function distribute(entries, copper) {
  if (!entries.length) return copper === 0;
  // Leave a non-coin table result last to absorb cents without changing any pouch's denomination.
  entries.sort((a, b) => Number(!a.entity?.coinBreakdown) - Number(!b.entity?.coinBreakdown));
  const weight = entries.reduce((n, e) => n + Math.max(1, e.copper), 0);
  let remaining = copper, remainingWeight = weight;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], w = Math.max(1, e.copper);
    let amount = i === entries.length - 1 ? remaining : Math.floor(remaining * w / remainingWeight);
    if (e.entity?.coinBreakdown) {
      const denomination = e.entity.coinBreakdown.gold ? 100 : e.entity.coinBreakdown.silver ? 10 : 1;
      amount = Math.max(denomination, Math.floor(amount / denomination) * denomination);
    }
    if (amount < 1 || amount > remaining) return false;
    assignValue(e, amount); remaining -= e.copper; remainingWeight -= w;
  }
  return remaining === 0;
}

export class FloorWealthAllocationError extends Error {}
export function finalizeStartingWealth(state, rng, { targetGp, secretGated = () => false, easyPoint } = {}) {
  const level = Math.max(1, Number(state.level) || 1);
  const target = cp(targetGp ?? floorWealthTarget(state.seed, level));
  const minimum = level * 400000, maximum = level * 600000;
  if (target < minimum || target > maximum) throw new FloorWealthAllocationError('Floor wealth target is outside its limits.');
  // Never count an ordinary visible room as secret-gated merely because it has a secret door.
  for (const entity of treasures(state)) {
    entity.generationSecretGate = secretGated(entity);
    if (!entity.generationFixedValue && !entity.generationSecretGate && !trapped(state, entity)) hideTreasure(entity, rng);
  }
  let entries = entryList(state);
  const fixed = entries.filter(e => !e.mutable);
  const fixedTotal = fixed.reduce((n, e) => n + e.copper, 0);
  const ordinary = entries.filter(e => !e.eligible).reduce((n, e) => n + e.copper, 0);
  if (fixedTotal >= target || ordinary > target * .2) throw new FloorWealthAllocationError('Fixed starting wealth cannot fit this floor budget.');
  const freeFixed = fixed.filter(e => !e.challenged).reduce((n, e) => n + e.copper, 0);
  const easyBudget = Math.round(target * .1) - freeFixed;
  if (easyBudget < 1) throw new FloorWealthAllocationError('Fixed unchallenged wealth exceeds this floor allocation.');
  const points = treasures(state).filter(e => !secretGated(e));
  const point = easyPoint || points.find(e => !trapped(state, e)) || state.player;
  const easy = groundEntity(state, createTableTreasureDetails(state, rng), point,
    { visible: true, revealed: true, searchDc: 0, generationSecretGate: false, groundTreasure: true });
  const hardBudget = target - fixedTotal - easyBudget;
  let hard = entries.filter(e => e.mutable);
  if (hardBudget < hard.length) throw new FloorWealthAllocationError('Insufficient variable treasure budget.');
  // All-fixed floors and all-coin variable floors still need a table result for exact cent accounting.
  if (!hard.some(e => !e.entity?.coinBreakdown)) {
    const location = treasures(state).find(e => e.id !== easy.id) || state.player;
    groundEntity(state, createTableTreasureDetails(state, rng), location);
    hard = entryList(state).filter(e => e.mutable && e.entity !== easy);
  }
  const easyEntry = entryList(state).find(e => e.entity === easy);
  assignValue(easyEntry, easyBudget);
  if (!distribute(hard, hardBudget)) throw new FloorWealthAllocationError('Unable to assign exact physical treasure values.');
  const audit = auditStartingWealth(state);
  if (cp(audit.totalGp) !== target || audit.eligibleShare < .8 || Math.abs(audit.challengedShare - .9) > .00001)
    throw new FloorWealthAllocationError(`Starting wealth audit failed: ${JSON.stringify({targetGp:target/100,...audit})}`);
  state.generation.treasureTargetGp = target / 100;
  state.generation.treasureActualGp = audit.totalGp;
  state.generation.startingWealth = { version: 1, valuation: 'highest-possible-sale-value', minimumGp: minimum / 100, expectedGp: level * 4400,
    maximumGp: maximum / 100, targetGp: target / 100, ...audit };
  return state.generation.startingWealth;
}
