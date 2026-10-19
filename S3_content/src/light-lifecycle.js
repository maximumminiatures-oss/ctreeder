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
