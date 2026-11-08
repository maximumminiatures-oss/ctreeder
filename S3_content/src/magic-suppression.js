const isObject = value => value !== null && typeof value === 'object';
const positiveRounds = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const isScroll = object => [object?.magic?.kind, object?.type].some(kind => String(kind || '').toLowerCase() === 'scroll');
const hasMagic = object => Boolean(object.magic || object.magical || object.magicLock || object.magicalLock || object.magicallyLocked ||
  (Array.isArray(object.tags) ? object.tags : String(object.tags || '').split(','))
    .some(tag => /^magic(?: items?| gear| treasure)?$/i.test(String(tag).trim())) ||
  /\b(?:magic|magical|enchanted)\b/i.test(object.name || ''));

export function isMagicSuppressed(object) {
  return isObject(object) && !isScroll(object) && positiveRounds(object.magicSuppression?.rounds) > 0;
}

function suppressedName(object, originalName) {
  const kind = String(object.magic?.kind || object.type || '').toLowerCase();
  if (kind === 'potion') return 'Potion of No Effect';
  if (kind === 'wand') return 'non-magical wand';
  if (['feature', 'trap', 'door', 'treasure', 'monster'].includes(kind) ||
    ['trap', 'door'].includes(object.subtype)) return originalName;
  const baseName = object.baseName || String(originalName || '')
    .replace(/^(?:(?:magic|magical|enchanted)\s+|\+\d+\s*)+/i, '')
    .replace(/\s*\+\d+$/, '').trim();
  return `non-magical ${baseName || 'item'}`;
}

export function suppressMagic(object, rounds = 10) {
  rounds = positiveRounds(rounds);
  if (!isObject(object) || !rounds || isScroll(object)) return false;
  // Treasure/drop wrappers carry a transferable item as well as a display name.
  if (isObject(object.gearItem) && object.gearItem !== object) {
    const changed = suppressMagic(object.gearItem, rounds);
    if (!isMagicSuppressed(object.gearItem)) return false;
    const previous = positiveRounds(object.magicSuppression?.rounds);
    const originalName = object.magicSuppression?.originalName ?? object.name;
    object.magicSuppression = { rounds: Math.max(previous, rounds), originalName };
    object.name = object.gearItem.name;
    return changed || previous < rounds;
  }
  if (!hasMagic(object)) return false;
  const previous = positiveRounds(object.magicSuppression?.rounds);
  const originalName = object.magicSuppression?.originalName ?? object.name;
  object.magicSuppression = { rounds: Math.max(previous, rounds), originalName };
  object.name = suppressedName(object, originalName);
  return previous < rounds;
}

// Only live holdings: raw imports and other historical snapshots are not clocks.
const holdingKeys = ['characters', 'entities', 'monsters', 'gear', 'carriedGear', 'gearItem',
  'droppedGear', 'treasure', 'treasures', 'magicItems', 'features', 'traps', 'doors', 'corpses', 'corpseGear', 'characterCorpse'];
function walkHoldings(state, visit) {
  const seen = new WeakSet();
  function walk(object) {
    if (!isObject(object) || seen.has(object)) return;
    seen.add(object);
    if (Array.isArray(object)) {
      for (const entry of object) walk(entry);
      return;
    }
    visit(object);
    for (const key of holdingKeys) walk(object[key]);
  }
  walk(state);
}

export function advanceMagicSuppression(state, rounds = 1) {
  rounds = positiveRounds(rounds);
  if (!rounds) return false;
  let changed = false;
  walkHoldings(state, object => {
    if (!isMagicSuppressed(object)) return;
    changed = true;
    object.magicSuppression.rounds -= rounds;
    if (object.magicSuppression.rounds <= 0) {
      object.name = object.magicSuppression.originalName;
      delete object.magicSuppression;
    }
  });
  return changed;
}

export function hasMagicSuppression(state) {
  let found = false;
  walkHoldings(state, object => { found ||= isMagicSuppressed(object); });
  return found;
}
