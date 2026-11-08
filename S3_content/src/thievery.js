import { ensureMonsterGear, transferredMonsterGear } from './companions.js';
import { monsterModifier } from './encounters.js';
import { canTargetAtRange } from './targeting.js';
import { abilityScoreModifier } from './characters.js';
import { isFloatingDisc } from './floating-disc.js';
import { isIllusionCreature } from './illusion-geometry.js';

export function findStealTarget(state, id) {
  if (id == null) return null;
  return (state.characters || []).find(character => character.id === id) ||
    (state.entities || []).find(entity => entity.type === 'monster' && entity.id === id) || null;
}

export function validStealTarget(state, thief, target) {
  if (!thief || !target || target.id == null || target.id === thief.id ||
      target.dead || target.slain || target.defeated || target.leftPeacefully || Number(target.hp) <= 0 ||
      isFloatingDisc(target) || isIllusionCreature(target)) return false;
  const party = (state.characters || []).includes(target);
  if (!party && !(target.type === 'monster' && (state.entities || []).includes(target))) return false;
  return canTargetAtRange(state, thief, target, 1, party
    ? { requireLight: false, directAttack: false } : { directAttack: true });
}

export function stealableGear(source) {
  const gear = source.type === 'monster' ? ensureMonsterGear(source) : source.gear || [];
  return gear.map((item, index) => ({ item, index })).filter(({ item }) => !item.bound &&
    !(item.equipped && (item.type === 'armor' || /\b(?:armor|leather|chainmail|plate|padded|hide)\b/i.test(item.name))));
}

export function selectStealTarget(state, thief, source) {
  const pending = thief.pendingSteal;
  if (!(pending?.check?.total >= 15) || !validStealTarget(state, thief, source))
    throw new Error('Choose an adjacent creature to steal from.');
  const dc = 10 + ((state.characters || []).includes(source)
    ? abilityScoreModifier(source.stats?.WIS) : monsterModifier(source, 'W'));
  if (pending.check.total < dc) { thief.pendingSteal = null; return { message: `${thief.name} cannot steal unnoticed (${pending.check.total} vs DC ${dc}).` }; }
  pending.targetId = source.id; pending.phase = 'gear';
  if (!stealableGear(source).length) { thief.pendingSteal = null; return { message: `${source.name} has no gear that can be stolen.` }; }
  return { message: `Choose one item to steal from ${source.name}.` };
}

export function takeStolenItem(state, thief, index) {
  const source = findStealTarget(state, thief.pendingSteal?.targetId);
  if (!validStealTarget(state, thief, source)) throw new Error('The target is no longer within reach.');
  const entry = stealableGear(source).find(entry => entry.index === index);
  if (!entry) throw new Error('That gear cannot be stolen.');
  const item = source.gear.splice(index, 1)[0];
  item.equipped = false;
  if (source.type === 'monster') {
    source.carriedGear = source.gear;
    if (!source.gear.some(other => other.name.toLowerCase() === item.name.toLowerCase()))
      source.stolenGearNames = [...(source.stolenGearNames || []), item.name.toLowerCase()];
  }
  if (source.raw) source.raw.gear = structuredClone(source.gear);
  thief.pendingSteal = null;
  return { item: item.nativeMonsterWeapon ? transferredMonsterGear(item) : item, monster: source };
}
