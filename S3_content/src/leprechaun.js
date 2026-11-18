import { routeOf } from './underpasses.js';

export const isLeprechaun = creature => creature?.type === 'monster' && /^leprechaun$/i.test(creature.name);
const worthless = ['Dead Bird', 'Broken Chair', 'Pile of Leaves', 'Broken Bottle', 'Old Boot'];
export function seedLeprechaunGold(state, source, drop, random = Math.random) {
  if (!isLeprechaun(source) || source.foolsGoldCreated) return;
  source.foolsGoldCreated = true;
  source.genuineGold = 100 * (1 + Math.floor(random() * 8));
  const expiresAt = (state.arcaneTime?.elapsedMs || 0) + (1 + Math.floor(random() * 24)) * 3600000;
  drop({ name: '400 GP', type: 'sundry', treasureItem: true, treasureKind: 'trade good', value: 400,
    slots: 1, quantity: 1, totalUnits: 1,
    foolsGold: { expiresAt, remainder: worthless[Math.floor(random() * worthless.length)] } }, source);
}

export function expireLeprechaunGold(state) {
  let changed = false;
  const now = state.arcaneTime?.elapsedMs || 0;
  const expire = item => {
    if (!item?.foolsGold || now < item.foolsGold.expiresAt) return false;
    Object.assign(item, { name: item.foolsGold.remainder, value: 0, costGp: 0,
      description: 'Worthless salvage.', treasureKind: 'worthless-loot' });
    delete item.foolsGold;
    return true;
  };
  for (const entity of state.entities || []) if (!entity.collected && expire(entity.gearItem)) {
    Object.assign(entity, { name: entity.gearItem.name, description: entity.gearItem.description, value: 0, worthlessLoot: true });
    changed = true;
  }
  for (const actor of state.characters || []) if ((actor.gear || []).filter(expire).length) {
    if (actor.raw) actor.raw.gear = structuredClone(actor.gear);
    changed = true;
  }
  return changed;
}

export function leprechaunTreasure(state, source) {
  const gold = source.genuineGold || 100 * (1 + Math.floor(Math.random() * 8));
  const loot = { id: source.id + ':gold', type: 'treasure', subtype: 'monster-loot', kind: 'coins',
    x: source.x, y: source.y, routeId: routeOf(state, source), roomId: source.roomId,
    name: gold + ' GP', value: gold, coinBreakdown: { gold, silver: 0, copper: 0 }, visible: true, revealed: true };
  state.entities.push(loot);
  return loot;
}
