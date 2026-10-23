// Shadowdark core rules, printed pages 35-37. Keep legacy supply IDs stable.
export const SHOP_CATEGORIES = Object.freeze([
  { id: 'basic', label: 'BASIC GEAR' },
  { id: 'armor', label: 'ARMOR' },
  { id: 'weapons', label: 'WEAPONS' }
]);

function item(category, id, name, cost, currency, slots = 1, extra = {}) {
  return Object.freeze({ category, id, name, cost, currency, slots,
    costCopper: cost * ({ gp: 100, sp: 10, cp: 1 }[currency]),
    costLabel: `${cost} ${currency}`, ...extra });
}

export const STARTING_ROOM_SHOP_ITEMS = Object.freeze([
  item('basic', 'arrows', 'Arrows', 1, 'gp', 1, { quantity: 20, gear: { ammoType: 'arrows' } }),
  item('basic', 'backpack', 'Backpack', 2, 'gp'),
  item('basic', 'caltrops', 'Caltrops (one bag)', 5, 'sp'),
  item('basic', 'crossbow-bolts', 'Crossbow bolts', 1, 'gp', 1, { quantity: 20, gear: { ammoType: 'bolts' } }),
  item('basic', 'crowbar', 'Crowbar', 5, 'sp'),
  item('basic', 'flask-or-bottle', 'Flask or bottle', 3, 'sp'),
  item('basic', 'flint-and-steel', 'Flint and steel', 5, 'sp'),
  item('basic', 'grappling-hook', 'Grappling hook', 1, 'gp'),
  item('basic', 'iron-spikes', 'Iron spikes', 1, 'gp', 1, { quantity: 10 }),
  item('basic', 'lantern', 'Lantern', 5, 'gp'),
  item('basic', 'mirror', 'Mirror', 10, 'gp'),
  item('basic', 'oil-flask', 'Oil, flask', 5, 'sp'),
  item('basic', 'pole', 'Pole', 5, 'sp'),
  item('basic', 'rations', 'Rations', 5, 'sp', 1, { quantity: 3 }),
  item('basic', 'rope', "Rope, 60'", 1, 'gp'),
  item('basic', 'torch', 'Torch', 5, 'sp'),
  item('armor', 'leather-armor', 'Leather armor', 10, 'gp', 1, { type: 'armor', gear: { ac: 11 }, information: 'AC 11 + DEX modifier.' }),
  item('armor', 'chainmail', 'Chainmail', 60, 'gp', 2, { type: 'armor', gear: { ac: 13 }, information: 'AC 13 + DEX modifier. Two gear slots; disadvantage on stealth and swimming.' }),
  item('armor', 'plate-mail', 'Plate mail', 130, 'gp', 3, { type: 'armor', gear: { ac: 15 }, information: 'AC 15. Three gear slots; no swimming and disadvantage on stealth.' }),
  item('armor', 'shield', 'Shield', 10, 'gp', 1, { type: 'armor', information: '+2 AC while equipped; occupies one hand.' }),
  item('armor', 'mithral-chainmail', 'Mithral chainmail', 240, 'gp', 1, { type: 'armor', gear: { ac: 13 }, information: 'AC 13 + DEX modifier. One gear slot; no stealth or swimming penalty.' }),
  item('armor', 'mithral-plate-mail', 'Mithral plate mail', 520, 'gp', 2, { type: 'armor', gear: { ac: 15 }, information: 'AC 15. Two gear slots; no stealth or swimming penalty.' }),
  item('weapons', 'bastard-sword', 'Bastard sword', 10, 'gp', 2, { type: 'weapon', gear: { damage: '1d8', versatileDamage: '1d10', properties: 'V' } }),
  item('weapons', 'club', 'Club', 5, 'cp', 1, { type: 'weapon', gear: { damage: '1d4' } }),
  item('weapons', 'crossbow', 'Crossbow', 8, 'gp', 1, { type: 'weapon', gear: { damage: '1d6', properties: '2H, L', ammoType: 'bolts' } }),
  item('weapons', 'dagger', 'Dagger', 1, 'gp', 1, { type: 'weapon', gear: { damage: '1d4', properties: 'F, Th' } }),
  item('weapons', 'greataxe', 'Greataxe', 10, 'gp', 2, { type: 'weapon', gear: { damage: '1d8', versatileDamage: '1d10', properties: 'V' } }),
  item('weapons', 'greatsword', 'Greatsword', 12, 'gp', 2, { type: 'weapon', gear: { damage: '1d12', properties: '2H' } }),
  item('weapons', 'javelin', 'Javelin', 5, 'sp', 1, { type: 'weapon', gear: { damage: '1d4', properties: 'Th' } }),
  item('weapons', 'longbow', 'Longbow', 8, 'gp', 1, { type: 'weapon', gear: { damage: '1d8', properties: '2H', ammoType: 'arrows' } }),
  item('weapons', 'longsword', 'Longsword', 9, 'gp', 1, { type: 'weapon', gear: { damage: '1d8' } }),
  item('weapons', 'mace', 'Mace', 5, 'gp', 1, { type: 'weapon', gear: { damage: '1d6' } }),
  item('weapons', 'shortbow', 'Shortbow', 6, 'gp', 1, { type: 'weapon', gear: { damage: '1d4', properties: '2H', ammoType: 'arrows' } }),
  item('weapons', 'shortsword', 'Shortsword', 7, 'gp', 1, { type: 'weapon', gear: { damage: '1d6' } }),
  item('weapons', 'spear', 'Spear', 5, 'sp', 1, { type: 'weapon', gear: { damage: '1d6', properties: 'Th' } }),
  item('weapons', 'staff', 'Staff', 5, 'sp', 1, { type: 'weapon', gear: { damage: '1d4', properties: '2H' } }),
  item('weapons', 'warhammer', 'Warhammer', 10, 'gp', 1, { type: 'weapon', gear: { damage: '1d10', properties: '2H' } })
]);

export function createShopGearItem(config) {
  if (!Number.isInteger(config?.costCopper) || config.costCopper <= 0) throw new Error('This item has no fixed purchase price.');
  const quantity = config.quantity || 1;
  return {
    instanceId: `shop-${config.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    gearId: `shop-${config.id}`, name: config.name, type: config.type || 'sundry',
    quantity, totalUnits: quantity, slots: config.slots,
    cost: config.cost, currency: config.currency, costGp: config.costCopper / 100 / quantity,
    ...structuredClone(config.gear || {}), equipped: false
  };
}
