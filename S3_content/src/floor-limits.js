export const MAX_FLOOR_MONSTERS = 40;
export const MAX_FLOOR_FEATURES = 200;
const REMAINS = new Set(['corpse-loot', 'character-corpse', 'ash-pile', 'turned-ash', 'grave-dust']);

export function livingFloorMonsters(state) {
  return (state.entities || []).filter(entity => entity.type === 'monster' && !entity.defeated &&
    !entity.recruited && !entity.joinedParty && Number(entity.hp ?? 1) > 0);
}

export function trimDisposableRemains(state) {
  const features = (state.entities || []).filter(entity => entity.type === 'feature' || REMAINS.has(entity.subtype));
  const excess = Math.max(0, features.length - MAX_FLOOR_FEATURES);
  if (!excess) return 0;
  const removable = features.filter(entity => REMAINS.has(entity.subtype));
  const removed = new Set(removable.slice(0, excess).map(entity => entity.id));
  state.entities = state.entities.filter(entity => !removed.has(entity.id));
  // A dead stat block is only needed while its corpse still has a gameplay use.
  const referenced = new Set(state.entities.map(entity => entity.sourceMonsterId).filter(Boolean));
  const retiredSources = new Set(removable.filter(entity => removed.has(entity.id)).map(entity => entity.sourceMonsterId).filter(Boolean));
  state.entities = state.entities.filter(entity => !(entity.type === 'monster' && entity.defeated &&
    retiredSources.has(entity.id) && !referenced.has(entity.id)));
  return removed.size;
}
