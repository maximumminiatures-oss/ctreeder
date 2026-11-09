import { isAnimatedDead } from './animate-dead.js';

const living = actor => actor && !actor.dead && !actor.slain;
const casterId = actor => actor.companion.controllerCharacterId;

// A surviving caster rolls for its group; orphaned undead still enter combat.
export function animatedDeadInitiativeCharacters(state, candidates) {
  const available = new Set(candidates.filter(living).map(actor => actor.id));
  const represented = new Set();
  return candidates.filter(actor => {
    if (!living(actor)) return false;
    if (!isAnimatedDead(actor)) return true;
    const owner = casterId(actor);
    if (available.has(owner) || represented.has(owner)) return false;
    represented.add(owner);
    return true;
  });
}

export function animatedDeadPlayerEntries(state, orderIds) {
  const actors = new Map((state.characters || []).map(actor => [actor.id, actor]));
  const children = new Map();
  for (const actor of actors.values()) {
    if (!isAnimatedDead(actor) || !living(actor)) continue;
    const list = children.get(casterId(actor)) || [];
    list.push(actor);
    children.set(casterId(actor), list);
  }
  const result = [], added = new Set();
  const add = actor => {
    if (!living(actor) || added.has(actor.id)) return;
    added.add(actor.id);
    result.push({ type: 'character', id: actor.id });
  };
  const roots = new Set(orderIds.filter(id => !isAnimatedDead(actors.get(id))));
  for (const id of orderIds) {
    const actor = actors.get(id);
    const owner = isAnimatedDead(actor) ? casterId(actor) : id;
    if (isAnimatedDead(actor) && roots.has(owner)) continue;
    if (!isAnimatedDead(actor)) add(actor);
    for (const child of children.get(owner) || []) add(child);
  }
  return result;
}

// Insert new summons without restarting or reordering an in-progress turn.
export function insertAnimatedDeadTurns(state) {
  const combat = state.combat;
  if (!combat?.active) return;
  const current = combat.turnOrder[combat.turnIndex];
  const present = new Set(combat.turnOrder.map(entry => entry.id));
  for (const actor of state.characters || []) {
    if (!isAnimatedDead(actor) || !living(actor) || present.has(actor.id)) continue;
    const owner = casterId(actor);
    const allowed = !combat.surpriseRound || (combat.surpriseParticipantIds || []).includes(actor.id) ||
      current?.id === owner;
    if (!allowed) continue;
    const siblings = new Set((state.characters || []).filter(member => isAnimatedDead(member) && casterId(member) === owner).map(member => member.id));
    let index = combat.turnOrder.findIndex(entry => entry.type === 'character' && entry.id === owner);
    index = Math.max(index, combat.turnOrder.findLastIndex(entry => entry.type === 'character' && siblings.has(entry.id)));
    if (index < 0) index = combat.turnOrder.findLastIndex(entry => entry.type === 'character');
    combat.turnOrder.splice(index + 1, 0, { type: 'character', id: actor.id });
    if (!combat.playerOrderIds.includes(owner) && !combat.playerOrderIds.some(id => siblings.has(id))) combat.playerOrderIds.push(actor.id);
    present.add(actor.id);
  }
  if (current) combat.turnIndex = combat.turnOrder.findIndex(entry => entry.type === current.type && entry.id === current.id);
}
