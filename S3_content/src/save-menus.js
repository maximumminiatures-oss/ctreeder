import { apiFetch, readApiResponse } from './api.js';

const SNAPSHOT_FIELDS = ['partyAssets', 'timers', 'arcaneTime', 'activeCharacterId', 'spellClock', 'roundClock', 'gameClock'];

function element(tag, text = null, className = null) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, handler, label = text) {
  const node = element('button', text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', handler);
  return node;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function lineage(record) {
  return record?.lineageId || record?.character_json?.lineageId || record?.character_json?.id || null;
}

function partySnapshot(state, name) {
  const snapshot = { schema_version: 1, name, partyName: name, characters: copy(state?.characters || []) };
  for (const key of SNAPSHOT_FIELDS) if (state?.[key] !== undefined) snapshot[key] = copy(state[key]);
  return snapshot;
}

async function requestJSON(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await readApiResponse(await apiFetch(path, { ...options, signal: controller.signal }));
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The save server took too long to respond. Please retry.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function loadStyles() {
  if (document.querySelector('link[data-sd-save-menus]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../save-menus.css', import.meta.url).href;
  link.dataset.sdSaveMenus = '';
  document.head.append(link);
}

function dialog(title, onClose = () => {}) {
  const previousFocus = document.activeElement;
  const root = element('dialog', null, 'sd-save-menus');
  root.dataset.sdSaveMenu = '';
  root.setAttribute('aria-label', title);
  root.setAttribute('aria-modal', 'true');
  root.tabIndex = -1;
  const header = element('header');
  const heading = element('h2', title);
  const content = element('fieldset');
  const body = element('div', null, 'sd-save-menus-body');
  const error = element('p', '', 'sd-save-menus-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const footer = element('footer');
  content.append(body, error, footer);
  const panel = {
    root, body, footer, error, busy: false,
    active: () => root.isConnected,
    message(text) { error.textContent = text; error.hidden = !text; },
    setBusy(value) {
      panel.busy = value; content.disabled = value; close.disabled = value; root.setAttribute('aria-busy', String(value));
      if (root.isConnected && !root.contains(document.activeElement)) root.focus();
    },
    close() {
      if (panel.busy || !root.isConnected) return;
      if (typeof root.close === 'function') root.close();
      root.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      onClose();
    }
  };
  const close = button('X', () => panel.close(), `Close ${title}`);
  close.className = 'sd-save-menus-close';
  header.append(heading, close);
  root.append(header, content);
  root.addEventListener('cancel', event => { event.preventDefault(); panel.close(); });
  root.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.close(); }
  });
  document.body.append(root);
  if (typeof root.showModal === 'function') root.showModal();
  else root.setAttribute('open', '');
  close.focus();
  return panel;
}

/**
 * Action adapters may return promises and are awaited. Adapters doing async
 * work must recheck the current room/session before committing a replacement.
 * getState(): current live state, synchronously; never a serialized room copy.
 * getSession(): account session or room view (sync/async). Shared views need
 *   id, current_player_id, players:[{id,display_name}], authenticated.
 * isSharedRoom(): boolean, synchronously.
 * roomRequest(id, 'group-action', {action,name? | action,vote_id,accept}):
 *   parsed room view, matching multiplayer.js; NOT a Fetch Response.
 * applyRoomState(view): hydrate/apply the returned room view before resolving.
 * loadCharacter(record): accepts GET /api/characters/<id>'s complete record;
 *   imports/places one character, refreshes getState(), throws on failure.
 * onPartyLoaded(party_json): replaces/places the local party, retaining timers;
 *   must rebase timers.lastTickAt to now rather than count time spent offline.
 * onPartyNameChanged(name): updates the visible heading/state; no persistence.
 * onStatus(message): optional synchronous notification; receives no HTML.
 *
 * REST: parties POST {name,party_json}; GET list {results:[id,name,revision,
 * character_count,created_at,updated_at]}; GET detail adds party_json; DELETE
 * body {revision}. Character list adds lineageId; detail adds character_json.
 * Group proposals live at state.groupAction (or roomView.group_action): id,
 * action, status, initiatorMemberId, requiredMemberIds, acceptedMemberIds,
 * createdAt, expiresAt, name?, reason?, result?. Initiation counts as Yes.
 * A completed save only renames the current party; it never loads/replaces it.
 * Shared party replacement is intentionally blocked: no load_party consensus
 * endpoint exists. Callers must not bypass this with another adapter.
 * Call syncConsensus() after room updates AND after leaving/switching rooms.
 */
export function createSaveMenus({ getState, getSession = () => null, isSharedRoom = () => false,
  roomRequest, applyRoomState = () => {}, loadCharacter, onPartyLoaded,
  onPartyNameChanged = () => {}, onStatus = () => {} }) {
  let menu = null;
  let consensus = null;
  let consensusId = null;
  let consensusSignature = null;
  let dismissedVote = null;
  let syncVersion = 0;
  const completedVotes = new Set();
  loadStyles();

  function status(text) { onStatus(text); }
  function fail(panel, error) {
    if (!panel.active()) return;
    const message = error?.message || 'The request could not be completed.';
    if (error?.code === 'room_changed') { panel.setBusy(false); panel.close(); status(message); return; }
    panel.message(message);
    status(message);
  }
  function openMenu(title) {
    if (menu?.busy) return null;
    menu?.close();
    const current = dialog(title, () => { if (menu === current) menu = null; });
    menu = current;
    return current;
  }
  async function confirmation(text, title = 'Confirm') {
    return new Promise(resolve => {
      let answer = false;
      const panel = dialog(title, () => resolve(answer));
      panel.body.append(element('p', text));
      panel.footer.append(button('No', () => panel.close()), button('Yes', () => { answer = true; panel.close(); }));
    });
  }
  function currentLineages() {
    return new Set((getState()?.characters || []).map(char => char.lineageId || char.id).filter(Boolean));
  }
  async function authenticated() {
    const session = await getSession();
    if (session?.authenticated === false) throw new Error('Sign in to use your saved characters and parties.');
    return session;
  }
  async function requireRoom(id) {
    const current = await getSession();
    if (!isSharedRoom() || current?.id !== id) {
      const error = new Error('The dungeon changed. Reopen the menu to continue.');
      error.code = 'room_changed';
      throw error;
    }
  }

  async function openSaveParty() {
    const panel = openMenu('Save Party');
    if (!panel) return;
    const label = element('label', 'Party name');
    const input = element('input');
    input.type = 'text'; input.maxLength = 80; input.required = true;
    input.value = getState()?.partyName || 'The Party';
    input.setAttribute('aria-label', 'Party name');
    label.append(input); panel.body.append(label);
    const submit = async () => {
      if (panel.busy || !panel.active()) return;
      const name = input.value.trim();
      if (!name) { panel.message('Enter a party name.'); input.focus(); return; }
      if (!(getState()?.characters || []).length) { panel.message('Add at least one character first.'); return; }
      panel.setBusy(true); panel.message('');
      try {
        const session = await authenticated();
        if (!panel.active()) return;
        if (isSharedRoom()) {
          if (!session?.id || !roomRequest) throw new Error('Reconnect to the dungeon before saving its party.');
          await requireRoom(session.id);
          const result = await roomRequest(session.id, 'group-action', { action: 'save_party', name });
          await requireRoom(session.id);
          await applyRoomState(result);
          panel.setBusy(false); panel.close();
          await syncConsensus();
        } else {
          const saved = await requestJSON('/api/parties', { method: 'POST', body: JSON.stringify({ name, party_json: partySnapshot(getState(), name) }) });
          await onPartyNameChanged(saved.name);
          status(`Saved ${saved.name}.`);
          panel.setBusy(false); panel.close();
        }
      } catch (error) { fail(panel, error); }
      finally { if (panel.active()) panel.setBusy(false); }
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void submit(); } });
    panel.footer.append(button('Cancel', () => panel.close()), button('Save Party', () => void submit()));
    input.focus();
  }

  async function openLibrary(kind) {
    const characters = kind === 'characters';
    const panel = openMenu(characters ? 'Load Characters' : 'Load Party');
    if (!panel) return;
    const selected = new Set();
    const loadedLineages = new Set();
    let records = [];
    const controls = new Map();
    const list = element('div', null, 'sd-save-menus-list');
    const empty = element('p', 'Loading saves...');
    panel.body.append(empty, list);
    const loadSelected = characters ? button('Load selected', () => void importSelected()) : null;
    panel.footer.append(button('Close', () => panel.close()));
    if (loadSelected) { loadSelected.disabled = true; panel.footer.append(loadSelected); }

    function updateSelection() {
      if (!loadSelected) return;
      const existing = new Set([...currentLineages(), ...loadedLineages]);
      const selectedVersions = new Map();
      for (const record of records) if (selected.has(record.id) && lineage(record)) {
        const key = lineage(record);
        if (existing.has(key) || selectedVersions.has(key)) selected.delete(record.id);
        else selectedVersions.set(key, record.id);
      }
      for (const record of records) {
        const control = controls.get(record.id);
        if (!control) continue;
        const key = lineage(record);
        const present = Boolean(key && existing.has(key));
        const otherVersion = Boolean(key && selectedVersions.has(key) && selectedVersions.get(key) !== record.id);
        control.checkbox.disabled = present || otherVersion;
        control.checkbox.checked = selected.has(record.id);
        control.note.textContent = present ? 'Already in party' : otherVersion ? 'Another version selected' : '';
        control.note.hidden = !control.note.textContent;
      }
      const capacity = Math.max(0, 16 - (getState()?.characters || []).length);
      loadSelected.disabled = !selected.size || selected.size > capacity;
      loadSelected.textContent = selected.size ? `Load selected (${selected.size})` : 'Load selected';
      loadSelected.title = selected.size > capacity ? `There is room for ${capacity} more characters.` : '';
    }
    function render() {
      if (!panel.active()) return;
      list.replaceChildren();
      controls.clear();
      empty.textContent = records.length ? '' : 'No saved ' + (characters ? 'characters.' : 'parties.');
      empty.hidden = records.length > 0;
      const existing = new Set([...currentLineages(), ...loadedLineages]);
      for (const record of records) {
        const row = element('div', null, 'sd-save-menus-row');
        const name = element('span', record.name, 'sd-save-menus-name');
        name.title = record.name;
        if (characters) {
          const label = element('label');
          const checkbox = element('input'); checkbox.type = 'checkbox';
          checkbox.setAttribute('aria-label', `Load ${record.name}`);
          const duplicate = lineage(record) && existing.has(lineage(record));
          if (duplicate) selected.delete(record.id);
          checkbox.disabled = Boolean(duplicate); checkbox.checked = selected.has(record.id);
          checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(record.id) : selected.delete(record.id); updateSelection(); });
          label.append(checkbox, name);
          const note = element('span', '', 'sd-save-menus-note');
          note.hidden = true;
          label.append(note);
          controls.set(record.id, { checkbox, note });
          row.append(label);
        } else {
          const info = element('div');
          info.append(name, element('span', `${record.character_count ?? 0} members`, 'sd-save-menus-note'));
          const load = button('Load', () => void importParty(record), `Load ${record.name}`);
          load.disabled = isSharedRoom();
          if (load.disabled) load.title = 'Leave multiplayer before replacing your party.';
          row.append(info, load);
        }
        row.append(button('Delete', () => void remove(record), `Delete ${record.name}`));
        list.append(row);
      }
      if (!characters && isSharedRoom()) {
        empty.hidden = false;
        empty.textContent = 'Leave multiplayer before replacing your party.';
      }
      updateSelection();
    }
    async function refresh() {
      const response = await requestJSON(`/api/${kind}${characters ? '?limit=100' : ''}`);
      records = Array.isArray(response.results) ? response.results : [];
      const ids = new Set(records.map(record => record.id));
      for (const id of selected) if (!ids.has(id)) selected.delete(id);
      render();
    }
    async function remove(record) {
      if (panel.busy) return;
      panel.setBusy(true);
      try {
        const accepted = await confirmation(`Delete the saved ${characters ? 'character' : 'party'} "${record.name}"?`, 'Delete Save');
        if (!accepted || !panel.active()) return;
        await requestJSON(`/api/${kind}/${encodeURIComponent(record.id)}`, { method: 'DELETE', body: JSON.stringify({ revision: record.revision }) });
        selected.delete(record.id);
        await refresh();
        status(`Deleted ${record.name}.`);
      } catch (error) {
        if (error.status === 409 && panel.active()) {
          try { await refresh(); } catch { /* Preserve the original conflict message. */ }
        }
        fail(panel, error);
      }
      finally { if (panel.active()) panel.setBusy(false); }
    }
    async function importSelected() {
      if (panel.busy || !selected.size) return;
      panel.setBusy(true); panel.message('');
      let count = 0;
      try {
        if (typeof loadCharacter !== 'function') throw new Error('Character loading is not available.');
        for (const id of [...selected]) {
          if ((getState()?.characters || []).length >= 16) throw new Error('The party already contains 16 members.');
          const record = await requestJSON(`/api/characters/${encodeURIComponent(id)}`);
          const key = lineage(record);
          if (key && (currentLineages().has(key) || loadedLineages.has(key))) throw new Error(`Only one version of ${record.name} can be loaded.`);
          await loadCharacter(record);
          if (key) loadedLineages.add(key);
          selected.delete(id); count += 1;
        }
        status(`Loaded ${count} ${count === 1 ? 'character' : 'characters'}.`);
        panel.setBusy(false); panel.close();
      } catch (error) {
        render();
        fail(panel, new Error(`${count ? `Loaded ${count} ${count === 1 ? 'character' : 'characters'}. ` : ''}${error.message}`));
      } finally { if (panel.active()) panel.setBusy(false); }
    }
    async function importParty(record) {
      if (panel.busy) return;
      if (isSharedRoom()) { panel.message('Leave multiplayer before replacing your party.'); return; }
      panel.setBusy(true); panel.message('');
      try {
        const result = await requestJSON(`/api/parties/${encodeURIComponent(record.id)}`);
        if (typeof onPartyLoaded !== 'function') throw new Error('Party loading is not available.');
        const accepted = await confirmation(`Load "${result.name}" and replace the current party?`, 'Load Saved Party');
        if (!accepted || !panel.active()) return;
        if (isSharedRoom()) throw new Error('Leave multiplayer before replacing your party.');
        await onPartyLoaded(copy(result.party_json));
        await onPartyNameChanged(result.name);
        status(`Loaded ${result.name}.`);
        panel.setBusy(false); panel.close();
      } catch (error) { fail(panel, error); }
      finally { if (panel.active()) panel.setBusy(false); }
    }
    try { await authenticated(); if (panel.active()) await refresh(); }
    catch (error) { empty.hidden = true; fail(panel, error); }
  }

  async function syncConsensus() {
    const version = ++syncVersion;
    const session = await getSession();
    if (version !== syncVersion) return;
    const state = getState();
    // Revision-only polls can carry newer consensus metadata without a state body.
    const proposal = session && Object.hasOwn(session, 'group_action') ? session.group_action
      : state && Object.hasOwn(state, 'groupAction') ? state.groupAction : session?.state_json?.groupAction;
    if (!isSharedRoom() || !proposal || !session?.id) {
      if (consensus && !consensus.busy) consensus.close();
      return;
    }
    if (proposal.status === 'completed' && !completedVotes.has(proposal.id)) {
      completedVotes.add(proposal.id);
      if (proposal.action === 'save_party') {
        await onPartyNameChanged(proposal.name || proposal.result?.name);
        status(`Saved ${proposal.name || proposal.result?.name || 'party'}.`);
      } else if (proposal.action === 'descend') status(proposal.result?.message || `Descended to dungeon level ${proposal.result?.level}.`);
    }
    if (proposal.status !== 'pending') {
      if (consensus && !consensus.busy) consensus.close();
      if (proposal.status === 'cancelled' && !completedVotes.has(proposal.id)) {
        completedVotes.add(proposal.id);
        status(proposal.reason === 'declined' ? 'Group action declined.' : 'Group confirmation cancelled. Please start it again.');
      }
      return;
    }
    const memberId = session.current_player_id;
    if (!proposal.requiredMemberIds?.includes(memberId) || dismissedVote === proposal.id) return;
    if (consensus?.busy) return;
    if (consensusId !== proposal.id || !consensus?.active()) {
      consensus?.close();
      const panel = dialog(proposal.action === 'save_party' ? 'Save Party Confirmation' : 'Descend Confirmation', () => {
        dismissedVote = proposal.id;
        if (consensus === panel) { consensus = null; consensusId = null; consensusSignature = null; }
      });
      consensus = panel; consensusId = proposal.id;
    }
    const panel = consensus;
    const signature = JSON.stringify([proposal, session.players, state?.level]);
    if (consensusSignature === signature) return;
    consensusSignature = signature;
    panel.body.replaceChildren(); panel.footer.replaceChildren(); panel.message('');
    panel.body.append(element('p', proposal.action === 'save_party' ? `Save the current party as "${proposal.name}"?` : `Descend to dungeon level ${(state?.level || 1) + 1}?`));
    const accepted = proposal.acceptedMemberIds || [];
    panel.body.append(element('p', `${accepted.length} of ${proposal.requiredMemberIds.length} players confirmed.`));
    const names = new Map((session.players || []).map(player => [player.id, player.display_name]));
    const waiting = proposal.requiredMemberIds.filter(id => !accepted.includes(id)).map(id => names.get(id) || 'Player');
    if (waiting.length) panel.body.append(element('p', `Waiting for ${waiting.join(', ')}.`));
    const vote = async accept => {
      if (panel.busy) return;
      panel.setBusy(true); panel.message('');
      try {
        await requireRoom(session.id);
        const result = await roomRequest(session.id, 'group-action', { action: proposal.action, vote_id: proposal.id, accept });
        await requireRoom(session.id);
        await applyRoomState(result);
        panel.setBusy(false);
        await syncConsensus();
      } catch (error) { fail(panel, error); }
      finally { if (panel.active()) panel.setBusy(false); }
    };
    if (!accepted.includes(memberId)) panel.footer.append(button('Yes', () => void vote(true)));
    panel.footer.append(button('No', () => void vote(false)));
  }

  return { openSaveParty, openLoadParty: () => openLibrary('parties'), openLoadCharacters: () => openLibrary('characters'), syncConsensus };
}
