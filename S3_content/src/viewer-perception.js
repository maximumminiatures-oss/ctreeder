import { isBlind } from "./conditions.js";

export function controlledCharacters(state) {
  const ids =
    state.viewerCharacterIds instanceof Set ? state.viewerCharacterIds : null;
  return (state.characters || []).filter(
    (character) => !ids || ids.has(character.id),
  );
}

export function currentViewerCombatant(state) {
  if (!state.combat?.active) return null;
  const entry = state.combat.turnOrder?.[state.combat.turnIndex];
  if (entry?.type !== "character") return null;
  return (
    controlledCharacters(state).find(
      (character) => character.id === entry.id,
    ) || null
  );
}

// Permanent terrain memory uses all controlled observers. The active character's
// combat view can be blind or have darkvision without changing that memory.
export function creatureObservers(state, { viewer = null } = {}) {
  if (viewer) return [viewer];
  const active = currentViewerCombatant(state);
  return active ? [active] : controlledCharacters(state);
}

export function blindDungeonView(state) {
  const active = currentViewerCombatant(state);
  if (active) return isBlind(active);
  const party = controlledCharacters(state).filter(
    (character) =>
      !character.dead && !character.slain && Number(character.hp) > 0,
  );
  return party.length > 0 && party.every(isBlind);
}

// Only the selected monster lends its darkvision to creature display outside combat.
// Explicit per-creature AI queries keep using that creature's own eyes.
export function creatureDarkvisionObservers(state, options = {}) {
  const observers = creatureObservers(state, options);
  if (options.viewer || state.combat?.active) return observers;
  const selected =
    state.activeCharacterId ||
    (controlledCharacters(state).length === 1
      ? controlledCharacters(state)[0].id
      : null);
  return observers.filter((observer) => observer.id === selected);
}
