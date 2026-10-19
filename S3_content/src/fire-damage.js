import { matchesTreasureTypeName } from './treasure.js';
import { isMagicItem } from './magic-items.js';

const list = value => Array.isArray(value) ? value.join(' ') : String(value || '');
const words = value => String(value || '').toLowerCase().replace(/[-_]/g, ' ');

export function treasureFireResponse(entity) {
  if (entity?.type !== 'treasure' || entity.collected || entity.fireDamage || entity.gearItem?.fireDamage) return null;
  const item = entity.gearItem || {};
  const name = words(entity.name || item.name);
  if (/^charred\b/.test(name) || name === 'ash pile') return null;
  const category = words([entity.kind, entity.treasureKind, item.kind, item.type, item.treasureKind, list(entity.tags), list(item.tags)].join(' '));
  const material = words([name, entity.description, item.description, entity.material, item.material].join(' '));
  const magical = isMagicItem(entity) || isMagicItem(item) || entity.magical === true || entity.isMagical === true || entity.magicItem || item.magical === true ||
    item.isMagical === true || item.magicItem || /\b(?:magic|magical|enchanted|wondrous item)\b/.test(category + ' ' + name);
  if (magical || entity.coinBreakdown || /\b(?:coin|coins|coin cache|gems?|weapon|dagger)\b/.test(category) ||
      /\b(?:sword|longsword|shortsword|greatsword|dagger|knife|shiv|dirk|kukri|cutlass|tanto|kris|wakizashi|stiletto|cleaver|spear|javelin|staff|club|mace|axe|greataxe|warhammer|polearm|halberd|crossbow|longbow|shortbow|arrows?|bolts?|sling)\b/.test(name)) return null;
  if (/\b(?:rations?|oil)\b/.test(name)) return null;
  if (/\b(?:instrument|herbs?)\b/.test(category) || matchesTreasureTypeName(name, 'instrument')) return /\bherbs?\b/.test(category) ? 'ash' : 'charred';
  if (/\b(?:books?|scrolls?|rope)\b/.test(category) || /\b(?:books?|tomes?|scrolls?|rope)\b/.test(name)) return 'ash';
  const clothing = /\bclothing\b/.test(category) || (!/\bjewels?|jewelry\b/.test(category) && matchesTreasureTypeName(name, 'clothing'));
  if (/\b(?:wood|wooden|ironwood|leather|leathery|leatherbound|hide|padded|hardened cloth)\b/.test(material)) {
    return clothing ? 'ash' : 'charred';
  }
  if (/\b(?:steel|iron|bronze|copper|silver|gold|mithral|metal|bone armor)\b/.test(material)) return null;
  if (/\b(?:gems?|jewels?|jewelry|chainmail|platemail|armor|armour)\b/.test(category) && !/\bleather\b/.test(category)) return null;
  if (/\b(?:clothing|books?|scrolls?|rope)\b/.test(category) ||
      /\b(?:books?|tomes?|scrolls?|rope)\b/.test(name) || matchesTreasureTypeName(name, 'clothing')) return 'ash';
  if (/\bleather\b/.test(category)) return 'charred';
  return null;
}

export function applyFireToTreasure(entity) {
  const response = treasureFireResponse(entity);
  if (!response) return null;
  const originalName = entity.name, originalValue = Math.max(0, Number(entity.value) ||
    Number(entity.gearItem?.value ?? entity.gearItem?.costGp ?? entity.gearItem?.cost) || 0);
  entity.fireDamage = { response, originalName, originalValue };
  if (response === 'charred') {
    entity.name = 'charred ' + originalName;
    entity.value = originalValue / 2;
    if (entity.gearItem) {
      entity.gearItem.name = 'charred ' + entity.gearItem.name;
      entity.gearItem.value = Math.max(0, Number(entity.gearItem.value ?? entity.gearItem.costGp ?? originalValue) || 0) / 2;
      entity.gearItem.fireDamage = { ...entity.fireDamage };
    }
  } else {
    entity.name = 'ash pile';
    entity.value = 0;
    entity.kind = 'worthless-loot';
    entity.slots = 0;
    entity.bonusSlots = 0;
    entity.priceless = false;
    entity.worthlessLoot = true;
    entity.flammable = false;
    if (entity.subtype === 'dropped-equipment') entity.subtype = 'burned-remains';
    delete entity.gearItem;
    delete entity.coinBreakdown;
  }
  return originalName + (response === 'charred' ? ' is charred; value halved.' : ' is reduced to an ash pile.');
}
