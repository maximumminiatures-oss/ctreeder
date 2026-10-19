import { nativeGear } from './companions.js';
import { monsterModifier } from './encounters.js';
import { canTargetAtRange } from './targeting.js';

export function stealableGear(monster) {
  monster.gear ||= nativeGear(monster);
  return monster.gear.map((item, index) => ({ item, index })).filter(({ item }) =>
    !(item.equipped && (item.type === 'armor' || /\b(?:armor|leather|chainmail|plate|padded|hide)\b/i.test(item.name))));
}

export function selectStealTarget(state, thief, monster) {
  const pending = thief.pendingSteal;
  if (!pending || pending.check.total < 15 || !monster || monster.type !== 'monster' || monster.defeated ||
      !canTargetAtRange(state, thief, monster, 1, { directAttack: true })) throw new Error('Choose an adjacent visible monster.');
  const dc = 10 + monsterModifier(monster, 'W');
  if (pending.check.total < dc) { thief.pendingSteal = null; return { message: `${thief.name} cannot steal unnoticed (${pending.check.total} vs DC ${dc}).` }; }
  pending.targetId = monster.id; pending.phase = 'gear';
  if (!stealableGear(monster).length) { thief.pendingSteal = null; return { message: `${monster.name} has no gear that can be stolen.` }; }
  return { message: `Choose one item to steal from ${monster.name}.` };
}

export function takeStolenItem(state, thief, index) {
  const monster = state.entities.find(entity => entity.id === thief.pendingSteal?.targetId);
  if (!monster || !canTargetAtRange(state, thief, monster, 1, { directAttack: true })) throw new Error('The monster is no longer within reach.');
  const entry = stealableGear(monster).find(entry => entry.index === index);
  if (!entry) throw new Error('That gear cannot be stolen.');
  const item = monster.gear.splice(index, 1)[0];
  item.equipped = false;
  if (!monster.gear.some(other => other.name.toLowerCase() === item.name.toLowerCase()))
    monster.stolenGearNames = [...(monster.stolenGearNames || []), item.name.toLowerCase()];
  thief.pendingSteal = null;
  return { item, monster };
}
