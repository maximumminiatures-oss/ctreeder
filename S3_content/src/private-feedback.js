// Viewer scope is local and non-serialized; authoritative state retains full history.
export function canReadFeedback(state, entry) {
  return !entry?.privateCharacterId || !(state?.viewerCharacterIds instanceof Set) ||
    state.viewerCharacterIds.has(entry.privateCharacterId);
}
