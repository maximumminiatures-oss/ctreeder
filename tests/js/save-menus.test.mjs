import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSaveMenus } from '../../S3_content/src/save-menus.js';

let dom;
let calls;
let handler;
let state;
let session;
let shared;
let statuses;
let names;
let loaded;
let partyLoads;
let adapters;

const savedCharacter = (id, name, lineageId) => ({ id, name, revision: 2, lineageId,
  character_json: { id: `runtime-${id}`, lineageId, name, gear: [] } });
const savedParty = () => ({ id: 8, name: 'Night Watch', revision: 3, character_count: 2,
  party_json: { name: 'Night Watch', characters: [{ id: 'wizard', summon: null },
    { id: 'disc', summon: { kind: 'floating-disc', casterId: 'wizard', remainingMs: 1300 } }],
  timers: { torchElapsedMs: 1234, lastTickAt: 77 }, arcaneTime: { elapsedMs: 53 }, partyAssets: { gold: 12 } } });

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), 'Expected async UI state was not reached');
}
const byLabel = label => [...document.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === label);
const currentDialog = label => byLabel(label);
const press = (node, key) => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
function check(label, value = true) {
  const node = byLabel(label);
  assert.ok(node, label);
  assert.equal(node.disabled, false, label);
  node.checked = value;
  node.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function action(dialogLabel, text) {
  return [...currentDialog(dialogLabel).querySelectorAll('button')].find(node => node.textContent === text);
}
function menus(overrides = {}) { return createSaveMenus({ ...adapters, ...overrides }); }
function proposal(extra = {}) {
  return { id: 'vote-1', action: 'save_party', status: 'pending', name: 'Night Watch',
    initiatorMemberId: 'other', requiredMemberIds: ['me', 'other'], acceptedMemberIds: ['other'],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString(), ...extra };
}

test.beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body><button id="launcher">Open</button></body></html>', { url: 'http://localhost/site/' });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  calls = []; statuses = []; names = []; loaded = []; partyLoads = [];
  state = { characters: [{ id: 'existing', lineageId: 'hero-1' }], partyName: 'The Party', level: 2,
    timers: { torchElapsedMs: 6000, lastTickAt: 123 }, arcaneTime: { crawlRemainderMs: 1500 }, partyAssets: { gold: 3 } };
  session = { authenticated: true, id: 'room-1', current_player_id: 'me', players: [{ id: 'me', display_name: 'Me' }, { id: 'other', display_name: 'Friend' }] };
  shared = false;
  handler = () => json({ results: [] });
  globalThis.fetch = async (path, options = {}) => {
    if (path === '/api/session') return json({ csrf_token: 'test-csrf' });
    const call = { path: String(path), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, headers: options.headers };
    calls.push(call);
    return handler(call);
  };
  adapters = {
    getState: () => state, getSession: () => session, isSharedRoom: () => shared,
    loadCharacter: async record => { loaded.push(record); state.characters.push(record.character_json); },
    onPartyLoaded: async snapshot => { partyLoads.push(snapshot); },
    onPartyNameChanged: async name => { names.push(name); state.partyName = name; },
    onStatus: text => statuses.push(text),
    applyRoomState: async view => { state = view.state_json; session = { ...session, ...view }; },
    roomRequest: async () => { throw new Error('Unexpected room request'); }
  };
});
test.afterEach(() => dom.window.close());

test('Enter saves a bounded party projection with complete companion timers and awaits naming callback', async () => {
  state.characters.push({ id: 'disc', lineageId: 'disc', summon: { kind: 'floating-disc', remainingMs: 555 } });
  state.tiles = [{ secret: true }]; state.groupAction = { id: 'not-saved' };
  const named = deferred();
  handler = call => json({ id: 8, revision: 1, name: call.body.name, party_json: call.body.party_json }, 201);
  const ui = menus({ onPartyNameChanged: async name => { names.push(name); await named.promise; } });
  await ui.openSaveParty();
  const input = byLabel('Party name');
  assert.equal(document.activeElement, input);
  assert.equal(input.value, 'The Party');
  input.value = '  New Name  '; press(input, 'Enter');
  await until(() => names.length === 1);
  assert.ok(currentDialog('Save Party'));
  const call = calls[0];
  assert.equal(call.path, '/api/parties'); assert.equal(call.method, 'POST');
  assert.equal(call.headers.get('X-CSRFToken'), 'test-csrf');
  assert.equal(call.body.name, 'New Name');
  assert.deepEqual(call.body.party_json.timers, state.timers);
  assert.deepEqual(call.body.party_json.arcaneTime, state.arcaneTime);
  assert.equal(call.body.party_json.characters[1].summon.remainingMs, 555);
  assert.equal(call.body.party_json.tiles, undefined); assert.equal(call.body.party_json.groupAction, undefined);
  named.resolve(); await until(() => !currentDialog('Save Party'));
});

test('empty names and empty parties never submit; server moderation errors stay visible', async () => {
  const ui = menus(); await ui.openSaveParty();
  byLabel('Party name').value = ' '; press(byLabel('Party name'), 'Enter');
  assert.equal(calls.length, 0);
  assert.match(currentDialog('Save Party').textContent, /Enter a party name/);
  byLabel('Party name').value = 'A'; state.characters = []; press(byLabel('Party name'), 'Enter');
  assert.equal(calls.length, 0);
  state.characters = [{ id: 'one' }];
  handler = () => json({ error: 'invalid_party', message: 'Please choose another party name.' }, 400);
  press(byLabel('Party name'), 'Enter');
  await until(() => statuses.length);
  assert.match(currentDialog('Save Party').textContent, /Please choose another/);
  assert.equal(names.length, 0);
});

test('unauthenticated library/save actions explain sign in without invoking callbacks', async () => {
  session.authenticated = false;
  const ui = menus(); await ui.openLoadCharacters();
  assert.match(currentDialog('Load Characters').textContent, /Sign in/);
  assert.equal(calls.length, 0);
  await ui.openSaveParty(); press(byLabel('Party name'), 'Enter');
  await until(() => statuses.length > 1);
  assert.equal(calls.length, 0);
});

test('existing lineages and alternative selected versions are disabled; loads are sequential', async () => {
  const records = [savedCharacter(1, 'Old Hero', 'hero-1'), savedCharacter(2, 'Wizard', 'wizard'),
    savedCharacter(3, 'Older Wizard', 'wizard'), savedCharacter(4, 'Fighter', 'fighter')];
  handler = call => call.path.includes('?') ? json({ results: records }) : json(records.find(record => call.path.endsWith(`/${record.id}`)));
  const first = deferred();
  const ui = menus({ loadCharacter: async record => { loaded.push(record); if (record.id === 2) await first.promise; state.characters.push(record.character_json); } });
  await ui.openLoadCharacters();
  assert.equal(byLabel('Load Old Hero').disabled, true);
  check('Load Wizard'); assert.equal(byLabel('Load Older Wizard').disabled, true);
  check('Load Fighter'); action('Load Characters', 'Load selected (2)').click();
  await until(() => loaded.length === 1);
  assert.equal(calls.some(call => call.path === '/api/characters/4'), false);
  first.resolve(); await until(() => !currentDialog('Load Characters'));
  assert.deepEqual(loaded.map(record => record.id), [2, 4]);
  assert.equal(loaded[0].revision, 2); assert.equal(loaded[0].character_json.name, 'Wizard');
});

test('deselecting one version re-enables its alternatives and capacity bounds selection', async () => {
  state.characters = Array.from({ length: 15 }, (_, i) => ({ id: `existing-${i}` }));
  handler = () => json({ results: [savedCharacter(1, 'A', 'a'), savedCharacter(2, 'A old', 'a'), savedCharacter(3, 'B', 'b')] });
  await menus().openLoadCharacters();
  check('Load A'); assert.equal(byLabel('Load A old').disabled, true);
  check('Load A', false); assert.equal(byLabel('Load A old').disabled, false);
  check('Load A old'); check('Load B');
  assert.equal(action('Load Characters', 'Load selected (2)').disabled, true);
});

test('a lineage loaded while the chooser was open is checked again before import', async () => {
  const record = savedCharacter(1, 'A', 'a');
  handler = call => call.path.includes('?') ? json({ results: [record] }) : json(record);
  await menus().openLoadCharacters(); check('Load A');
  state.characters.push({ id: 'new-runtime', lineageId: 'a' });
  action('Load Characters', 'Load selected (1)').click();
  await until(() => statuses.length);
  assert.equal(loaded.length, 0); assert.equal(byLabel('Load A').disabled, true);
  assert.match(statuses[0], /Only one version/);
});

test('partial import failure retains successful characters and allows retry of the remainder', async () => {
  const records = [savedCharacter(1, 'A', 'a'), savedCharacter(2, 'B', 'b'), savedCharacter(3, 'C', 'c')];
  handler = call => call.path.includes('?') ? json({ results: records }) : json(records.find(record => call.path.endsWith(`/${record.id}`)));
  let fail = true;
  const ui = menus({ loadCharacter: async record => {
    if (record.id === 2 && fail) throw new Error('Import refused.');
    loaded.push(record); state.characters.push(record.character_json);
  } });
  await ui.openLoadCharacters(); for (const name of ['A', 'B', 'C']) check(`Load ${name}`);
  action('Load Characters', 'Load selected (3)').click();
  await until(() => statuses.length);
  assert.deepEqual(loaded.map(record => record.id), [1]); assert.equal(byLabel('Load A').disabled, true);
  assert.equal(calls.some(call => call.path === '/api/characters/3'), false);
  assert.match(statuses[0], /Loaded 1 character.*Import refused/);
  fail = false; action('Load Characters', 'Load selected (2)').click();
  await until(() => !currentDialog('Load Characters'));
  assert.deepEqual(loaded.map(record => record.id), [1, 2, 3]);
});

test('delete confirms, sends revision, refreshes the list, and never removes a current character', async () => {
  let deleted = false;
  handler = call => {
    if (call.method === 'DELETE') { deleted = true; return json({ id: 1, revision: 3 }); }
    return json({ results: deleted ? [] : [savedCharacter(1, 'Saved Hero', 'hero-1')] });
  };
  await menus().openLoadCharacters(); byLabel('Delete Saved Hero').click();
  await until(() => currentDialog('Delete Save'));
  action('Delete Save', 'Yes').click();
  await until(() => deleted && !byLabel('Delete Saved Hero'));
  assert.deepEqual(calls.find(call => call.method === 'DELETE').body, { revision: 2 });
  assert.equal(state.characters.length, 1); assert.equal(loaded.length, 0);
});

test('delete cancellation does not send DELETE and errors leave the library open', async () => {
  handler = call => call.method === 'DELETE' ? json({ message: 'Reload this save.', error: 'revision_conflict' }, 409)
    : json({ results: [savedCharacter(1, 'A', 'a')] });
  await menus().openLoadCharacters(); byLabel('Delete A').click();
  await until(() => currentDialog('Delete Save')); action('Delete Save', 'No').click();
  await until(() => currentDialog('Load Characters').getAttribute('aria-busy') === 'false');
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
  byLabel('Delete A').click(); await until(() => currentDialog('Delete Save')); action('Delete Save', 'Yes').click();
  await until(() => statuses.length);
  assert.match(currentDialog('Load Characters').textContent, /Reload this save/);
});

test('party loading requires explicit replacement confirmation and awaits the full snapshot callback', async () => {
  const saved = savedParty();
  handler = call => call.path === '/api/parties' ? json({ results: [saved] }) : json(saved);
  const pending = deferred();
  const ui = menus({ onPartyLoaded: async data => { partyLoads.push(data); await pending.promise; } });
  await ui.openLoadParty(); byLabel('Load Night Watch').click();
  await until(() => currentDialog('Load Saved Party'));
  assert.equal(partyLoads.length, 0); assert.match(currentDialog('Load Saved Party').textContent, /replace the current party/);
  action('Load Saved Party', 'Yes').click(); await until(() => partyLoads.length);
  assert.deepEqual(partyLoads[0], saved.party_json); assert.ok(currentDialog('Load Party'));
  assert.equal(names.length, 0);
  pending.resolve(); await until(() => !currentDialog('Load Party'));
  assert.deepEqual(names, ['Night Watch']);
});

test('declining a party replacement leaves all state untouched', async () => {
  const saved = savedParty(); handler = call => call.path === '/api/parties' ? json({ results: [saved] }) : json(saved);
  await menus().openLoadParty(); byLabel('Load Night Watch').click();
  await until(() => currentDialog('Load Saved Party')); action('Load Saved Party', 'No').click();
  await until(() => currentDialog('Load Party').getAttribute('aria-busy') === 'false');
  assert.equal(partyLoads.length, 0); assert.equal(names.length, 0);
});

test('shared party loading is disabled, including a session that changes during confirmation', async () => {
  const saved = savedParty(); handler = call => call.path === '/api/parties' ? json({ results: [saved] }) : json(saved);
  shared = true;
  const ui = menus(); await ui.openLoadParty(); assert.equal(byLabel('Load Night Watch').disabled, true);
  assert.equal(byLabel('Delete Night Watch').disabled, false);
  shared = false; await ui.openLoadParty(); byLabel('Load Night Watch').click();
  await until(() => currentDialog('Load Saved Party')); shared = true; action('Load Saved Party', 'Yes').click();
  await until(() => statuses.length);
  assert.equal(partyLoads.length, 0); assert.match(statuses[0], /Leave multiplayer/);
});

test('shared saves use group-action, apply parsed views, and show the frozen electorate', async () => {
  shared = true;
  const requests = [];
  const ui = menus({ roomRequest: async (...args) => {
    requests.push(args); return { ...session, state_json: { ...state, groupAction: proposal({ initiatorMemberId: 'me', acceptedMemberIds: ['me'] }) } };
  } });
  await ui.openSaveParty(); press(byLabel('Party name'), 'Enter');
  await until(() => currentDialog('Save Party Confirmation'));
  assert.deepEqual(requests, [['room-1', 'group-action', { action: 'save_party', name: 'The Party' }]]);
  assert.equal(calls.length, 0);
  assert.match(currentDialog('Save Party Confirmation').textContent, /1 of 2 players confirmed/);
  assert.match(currentDialog('Save Party Confirmation').textContent, /Waiting for Friend/);
  assert.equal(action('Save Party Confirmation', 'Yes'), undefined);
});

test('a guest votes yes once; completed saves rename but never replace the party', async () => {
  shared = true; session.authenticated = false; state.groupAction = proposal();
  const requests = [];
  const ui = menus({ roomRequest: async (...args) => {
    requests.push(args); return { ...session, state_json: { ...state, groupAction: proposal({ status: 'completed', acceptedMemberIds: ['me', 'other'], result: { party_id: 8 } }) } };
  } });
  await ui.syncConsensus(); action('Save Party Confirmation', 'Yes').click();
  await until(() => !currentDialog('Save Party Confirmation'));
  assert.deepEqual(requests, [['room-1', 'group-action', { action: 'save_party', vote_id: 'vote-1', accept: true }]]);
  assert.deepEqual(names, ['Night Watch']); assert.equal(partyLoads.length, 0);
  await ui.syncConsensus(); assert.deepEqual(names, ['Night Watch']);
});

test('decline cancels a proposal and shared descend uses the same vote schema', async () => {
  shared = true; state.groupAction = proposal({ action: 'descend' });
  let request;
  const ui = menus({ roomRequest: async (...args) => {
    request = args; return { ...session, state_json: { ...state, groupAction: { ...state.groupAction, status: 'cancelled', reason: 'declined' } } };
  } });
  await ui.syncConsensus(); assert.match(currentDialog('Descend Confirmation').textContent, /level 3/);
  action('Descend Confirmation', 'No').click(); await until(() => !currentDialog('Descend Confirmation'));
  assert.deepEqual(request, ['room-1', 'group-action', { action: 'descend', vote_id: 'vote-1', accept: false }]);
  assert.equal(partyLoads.length, 0); assert.equal(names.length, 0);
  assert.match(statuses[0], /declined/);
});

test('consensus does not prompt non-voters, and closes on expiry or departure', async () => {
  shared = true; state.groupAction = proposal({ requiredMemberIds: ['other'] });
  const ui = menus(); await ui.syncConsensus(); assert.equal(document.querySelectorAll('dialog').length, 0);
  state.groupAction = proposal(); await ui.syncConsensus(); assert.ok(currentDialog('Save Party Confirmation'));
  state.groupAction = { ...state.groupAction, status: 'cancelled', reason: 'expired' }; await ui.syncConsensus();
  assert.equal(document.querySelectorAll('dialog').length, 0);
  state.groupAction = proposal({ id: 'next' }); await ui.syncConsensus(); shared = false; await ui.syncConsensus();
  assert.equal(document.querySelectorAll('dialog').length, 0);
});

test('vote errors remain retryable and no unconfirmed callbacks run', async () => {
  shared = true; state.groupAction = proposal();
  const ui = menus({ roomRequest: async () => { throw new Error('Vote server unavailable.'); } });
  await ui.syncConsensus(); action('Save Party Confirmation', 'Yes').click();
  await until(() => statuses.length);
  assert.match(currentDialog('Save Party Confirmation').textContent, /Vote server unavailable/);
  assert.equal(action('Save Party Confirmation', 'Yes').disabled, false);
  assert.equal(partyLoads.length, 0); assert.equal(names.length, 0);
});

test('text is never HTML, keyboard events stay in the menu, and styling is loaded only once', async () => {
  const name = '<img src=x onerror=alert(1)>';
  handler = () => json({ results: [savedCharacter(1, name, 'a')] });
  const ui = menus(); await ui.openLoadCharacters();
  assert.equal(document.querySelectorAll('img,script').length, 0);
  assert.match(currentDialog('Load Characters').textContent, /<img/);
  let gameKey = false;
  document.addEventListener('keydown', () => { gameKey = true; });
  press(byLabel(`Load ${name}`), 'ArrowDown'); assert.equal(gameKey, false);
  press(currentDialog('Load Characters'), 'Escape'); assert.equal(currentDialog('Load Characters'), undefined);
  await ui.openSaveParty(); menus(); assert.equal(document.querySelectorAll('link[data-sd-save-menus]').length, 1);
});

test('a late library response cannot reopen or overwrite a newer menu', async () => {
  const pending = deferred(); handler = () => pending.promise;
  const ui = menus(); const opening = ui.openLoadCharacters();
  await until(() => calls.length);
  await ui.openSaveParty(); pending.resolve(json({ results: [savedCharacter(1, 'Late', 'late')] }));
  await opening;
  assert.ok(currentDialog('Save Party')); assert.equal(currentDialog('Load Characters'), undefined);
  assert.equal(byLabel('Load Late'), undefined);
});

test('unchanged consensus polls preserve buttons, focus and a failed vote message', async () => {
  shared = true; state.groupAction = proposal();
  const ui = menus({ roomRequest: async () => { throw new Error('Try again.'); } });
  await ui.syncConsensus();
  const yes = action('Save Party Confirmation', 'Yes');
  yes.focus(); await ui.syncConsensus();
  assert.equal(action('Save Party Confirmation', 'Yes'), yes);
  assert.equal(document.activeElement, yes);
  yes.click(); await until(() => statuses.length);
  await ui.syncConsensus();
  assert.equal(action('Save Party Confirmation', 'Yes'), yes);
  assert.match(currentDialog('Save Party Confirmation').textContent, /Try again/);
});

test('an older async session lookup cannot reopen a stale consensus', async () => {
  shared = true; state.groupAction = proposal();
  const pending = deferred();
  let first = true;
  const ui = menus({ getSession: () => { if (first) { first = false; return pending.promise; } return session; } });
  const old = ui.syncConsensus();
  state.groupAction = null;
  await ui.syncConsensus(); pending.resolve(session); await old;
  assert.equal(document.querySelectorAll('dialog').length, 0);
});

test('fresh revision-only consensus metadata overrides an old pending state', async () => {
  shared = true; state.groupAction = proposal();
  const ui = menus(); await ui.syncConsensus();
  session.group_action = { ...state.groupAction, status: 'cancelled', reason: 'expired' };
  await ui.syncConsensus();
  assert.equal(document.querySelectorAll('dialog').length, 0);
});

test('a vote response cannot restore a room after leaving or switching rooms', async () => {
  shared = true; state.groupAction = proposal();
  const pending = deferred();
  let applied = false;
  const ui = menus({ roomRequest: () => pending.promise, applyRoomState: () => { applied = true; } });
  await ui.syncConsensus(); action('Save Party Confirmation', 'Yes').click();
  await new Promise(resolve => setImmediate(resolve));
  session = { ...session, id: 'different-room' };
  pending.resolve({ id: 'room-1', state_json: { groupAction: proposal({ status: 'completed' }) } });
  await until(() => statuses.length);
  assert.equal(applied, false); assert.equal(document.querySelectorAll('dialog').length, 0);
  assert.match(statuses[0], /dungeon changed/);
});

test('shared save responses cannot reopen an old room after leaving', async () => {
  shared = true;
  const pending = deferred();
  let requested = false, applied = false;
  const ui = menus({ roomRequest: () => { requested = true; return pending.promise; }, applyRoomState: () => { applied = true; } });
  await ui.openSaveParty(); press(byLabel('Party name'), 'Enter');
  await until(() => requested);
  shared = false;
  pending.resolve({ id: 'room-1', state_json: { groupAction: proposal() } });
  await until(() => statuses.length);
  assert.equal(applied, false); assert.equal(document.querySelectorAll('dialog').length, 0);
  assert.equal(names.length, 0);
});
