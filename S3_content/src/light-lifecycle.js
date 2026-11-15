import { handItemKind, syncEquipmentLight } from './equipment.js';

export function resetBurningLights(state) {
  for (const character of state.characters || []) {
    character.gear = (character.gear || []).filter(item => {
      if (!item.lit) return true;
      const kind = handItemKind(item);
      if (kind === 'lantern') { item.lit = false; item.covered = false; }
      if (kind !== 'torch') return true;
      const count = Math.max(1, Number(item.totalUnits ?? item.quantity) || 1);
      if (count <= 1) return false;
      item.quantity = item.totalUnits = count - 1; item.lit = false;
      return true;
    });
    syncEquipmentLight(character);
    character.raw ||= {}; character.raw.gear = structuredClone(character.gear);
  }
  state.entities = (state.entities || []).filter(entity => {
    if (entity.subtype !== 'dropped-equipment' || entity.collected || !(entity.gearItem?.lit || entity.lightSource)) return true;
    if (handItemKind(entity.gearItem) === 'torch') return false;
    if (handItemKind(entity.gearItem) === 'lantern') {
      entity.gearItem.lit = false; delete entity.lightSource; delete entity.lightRadius;
    }
    return true;
  });
}

export function burningTorchCount(holder) {
  if (holder.collected || holder.defeated) return 0;
  if (holder.subtype === 'dropped-equipment') {
    return Number(holder.lightSource === 'torch' || holder.gearItem?.lit && handItemKind(holder.gearItem) === 'torch');
  }
  return (holder.gear || []).filter(item => item.lit && handItemKind(item) === 'torch').length ||
    Number(holder.lightSource === 'torch' && holder.lightRadius > 0);
}

export function extinguishTorches(holders) {
  let count = 0;
  for (const holder of holders) {
    const lit = burningTorchCount(holder);
    if (!lit) continue;
    count += lit;
    if (holder.subtype === 'dropped-equipment') {
      if (holder.gearItem) holder.gearItem.lit = false;
      delete holder.lightSource;
      delete holder.lightRadius;
      continue;
    }
    for (const item of holder.gear || []) {
      if (item.lit && handItemKind(item) === 'torch') item.lit = false;
    }
    syncEquipmentLight(holder);
    if (holder.raw) holder.raw.gear = structuredClone(holder.gear || []);
  }
  return count;
}

export function releaseUnequippedTorches(character, previouslyEquipped, drop, random = Math.random) {
  for (const item of previouslyEquipped) {
    if (item.equipped || handItemKind(item) !== 'torch' || !character.gear.includes(item)) continue;
    const dropped = { ...item, quantity: 1, totalUnits: 1, equipped: false };
    if (dropped.lit && random() < .5) dropped.lit = false;
    const count = Math.max(1, Number(item.totalUnits ?? item.quantity) || 1);
    if (count === 1) character.gear.splice(character.gear.indexOf(item), 1);
    else { item.quantity = item.totalUnits = count - 1; item.lit = false; }
    drop(dropped);
  }
  syncEquipmentLight(character);
}
