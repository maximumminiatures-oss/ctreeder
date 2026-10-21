import { setCharacterHp } from './characters.js';
import { castWizardTierOne } from './wizard-tier-one.js';
import { blocksSpellTier, forgottenSpells } from './arcane-effects.js';
import { continueLuckSave } from './luck-runtime.js';

function knownFeatherFall(character) {
  return String(character.spellsKnown || '').split(/,\s*/).some(name => /^feather fall$/i.test(name)) &&
    !(character.failedSpellKeys || []).includes('feather fall') && !(character.spellLocks?.['feather fall']?.remainingMs > 0);
}
const featherScrollIndex = character => (character.gear || []).findIndex(item => ['scroll','wand'].includes(item.magic?.kind) &&
  !item.magic.disabledUntilRest && /^feather fall$/i.test(item.magic.spellName) && item.magic.classes?.includes('wizard'));
export function canCastFeatherFall(character) {
  return /wizard/i.test(character?.className || '') && !blocksSpellTier(character, 1) && !forgottenSpells(character).has('feather fall') &&
    (knownFeatherFall(character) || featherScrollIndex(character) >= 0);
}
// Trap damage is still manual. Future falling features can supply authoritative damage.
export function queueFallingDamage(character, { sourceId, damage = null, manual = true } = {}) {
  character.pendingFall = { sourceId, damage: Number.isFinite(damage) ? Math.max(0, damage) : null, manual, negated: false };
  return character.pendingFall;
}
export function resolveFallingDamage(state, character, attempt, options = {}) {
  return continueLuckSave(state, character, () => resolvePendingFallingDamage(state, character, attempt, options));
}
function resolvePendingFallingDamage(state, character, attempt, options = {}) {
  const event = character.pendingFall;
  if (!event) throw new Error('This character is not falling.');
  if (typeof attempt !== 'boolean') throw new Error('Choose yes or no for Feather Fall.');
  if (attempt && !canCastFeatherFall(character)) throw new Error('Feather Fall is unavailable.');
  let cast = null;
  if (attempt) {
    const scrollIndex = knownFeatherFall(character) ? -1 : featherScrollIndex(character);
    const oldFailures = [...(character.failedSpellKeys || [])], oldLock = character.spellLocks?.['feather fall'];
    const item = character.gear[scrollIndex], wand = item?.magic?.kind === 'wand';
    if (scrollIndex >= 0) {
      if (!wand) character.gear[scrollIndex] = { name: 'Blank paper', slots: 1, quantity: 1, totalUnits: 1, value: 1, type: 'sundry' };
      character.failedSpellKeys = (character.failedSpellKeys || []).filter(key => key !== 'feather fall');
      if (character.spellLocks) delete character.spellLocks['feather fall'];
    }
    try { cast = castWizardTierOne(state, character, 'feather fall', options); }
    finally {
      if (scrollIndex >= 0) {
        character.failedSpellKeys = [...new Set([...oldFailures, ...(character.failedSpellKeys || []).filter(key => key !== 'feather fall')])];
        if (oldLock) character.spellLocks['feather fall'] = oldLock;
        else if (character.spellLocks) delete character.spellLocks['feather fall'];
      }
    }
    if (wand && cast?.check?.roll === 1) character.gear = character.gear.filter(gear => gear !== item);
    else if (wand && !cast?.succeeded) item.magic.disabledUntilRest = true;
  }
  if (!event.negated && !event.manual && event.damage != null) setCharacterHp(character, character.hp - event.damage);
  const source = state.entities.find(entity => entity.id === event.sourceId);
  if (source && event.negated) {
    source.fallingDamageNegated = true;
    source.featherFallTargetId = character.id;
  }
  character.pendingFall = null;
  return { ...cast, message: cast?.message || `${character.name} falls${event.manual ? '; resolve falling damage manually' : ` and takes ${event.damage || 0} falling damage`}.` };
}
