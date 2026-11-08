import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

async function withRandom(values, fn) {
  const original = Math.random;
  const sequence = Array.isArray(values) ? values : [values];
  let calls = 0;
  Math.random = () => sequence[Math.min(calls++, sequence.length - 1)];
  try { return { value: await fn(), calls }; } finally { Math.random = original; }
}

function scene({ combat = true } = {}) {
  return {
    seed: 123, level: 1, map: { width: 7, height: 7 }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: 49 }, (_, i) => ({ x: i % 7, y: Math.floor(i / 7), type: 'floor', roomId: 'room' })),
    rooms: [{ id: 'room', x: 0, y: 0, width: 7, height: 7 }],
    visibility: { exploredEver: Array.from({ length: 49 }, (_, i) => `${i % 7},${Math.floor(i / 7)}`) },
    entities: [{ id: 'stairs', type: 'stairs', subtype: 'up', x: 2, y: 2, roomId: 'room' },
      { id: 'foe', type: 'monster', name: 'Foe', hp: 100, maxHp: 100, ac: 12, x: 5, y: 2,
        roomId: 'room', hostile: combat, attitude: combat ? 'combat' : 'neutral', attitudeChecked: true,
        visible: true, attack: '1 claw +0 (1d4)' }],
    characters: [
      { id: 'actor', name: 'Actor', className: 'Thief', ancestry: 'Human', level: 1,
        stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
        hp: 20, maxHitPoints: 20, x: 2, y: 2, roomId: 'room', stealthed: true,
        equipmentInitialized: true, gear: [{ name: 'Rope', slots: 1 }] },
      { id: 'friend', name: 'Friend', className: 'Fighter', ancestry: 'Human', stats: { STR: 10, WIS: 10 },
        hp: 20, maxHitPoints: 20, x: 3, y: 2, roomId: 'room', equipmentInitialized: true,
        gear: [{ name: 'Dagger +2', type: 'weapon', equipped: true, slots: 1, instanceId: 'magic-dagger',
          attackBonus: 2, damage: '1d4+2', magic: { kind: 'weapon', bonus: 2 } }, { name: 'Rations', quantity: 2 }] }
    ],
    player: { x: 2, y: 2, roomId: 'room', torchLit: false, lightSource: '', lightRadius: 0 },
    activeCharacterId: 'actor', rollHistory: [],
    timers: { torchElapsedMs: 12345, torchDurationMs: 3600000, lightEverLit: false,
      actualElapsedMs: 12345, lastTickAt: Date.now() },
    combat: { active: combat, round: 1, turnIndex: 0, movementRemaining: 6, actionUsed: false,
      turnOrder: [{ type: 'character', id: 'actor' }, { type: 'character', id: 'friend' }, { type: 'monster', id: 'foe' }],
      playerOrderIds: ['actor', 'friend'], monsterIds: ['foe'] }
  };
}

const actor = state => state.characters.find(character => character.id === 'actor');
const friend = state => state.characters.find(character => character.id === 'friend');
const command = (state, type, extra = {}) => executeGameCommand(state, { type, character_id: 'actor', ...extra });
async function normalized(state) {
  return (await withRandom(.5, () => command(state, 'normalize'))).value.state_json;
}
async function begin(state) {
  const before = structuredClone(state.rollHistory);
  const { value, calls } = await withRandom(0, () => command(state, 'steal'));
  assert.equal(calls, 0, 'opening steal must not roll');
  assert.equal(value.state_json.combat.actionUsed, false);
  assert.equal(actor(value.state_json).pendingSteal.phase, 'targeting');
  assert.equal(Object.hasOwn(actor(value.state_json).pendingSteal, 'check'), false);
  assert.deepEqual(value.state_json.rollHistory, before);
  return value.state_json;
}

test('runtime opening and cancelling steal leaves action, rolls and both inventories untouched', async () => {
  const state = await normalized(scene());
  const inventories = state.characters.map(character => structuredClone(character.gear));
  const pending = await begin(state);
  const { value, calls } = await withRandom(0, () => command(pending, 'steal_cancel'));
  assert.equal(calls, 0);
  assert.equal(value.state_json.combat.actionUsed, false);
  assert.equal(actor(value.state_json).pendingSteal, null);
  assert.deepEqual(value.state_json.rollHistory, state.rollHistory);
  assert.deepEqual(value.state_json.characters.map(character => character.gear), inventories);
});

test('runtime adjacent party click in darkness commits advantage/action; take transfers one enchanted item and both raw mirrors', async () => {
  let state = await begin(await normalized(scene()));
  const thiefGear = structuredClone(actor(state).gear);
  const sourceGear = structuredClone(friend(state).gear);
  assert.equal(state.visibility.visibleNow.includes('3,2'), false, 'the party target is unlit');
  const selected = await withRandom([0, .7], () => command(state, 'steal_target', { target_id: 'friend' }));
  state = selected.value.state_json;
  assert.equal(selected.calls, 2, 'exactly one advantage check');
  assert.equal(state.combat.actionUsed, true);
  assert.deepEqual(actor(state).pendingSteal.check, {
    roll: 15, firstRoll: 1, secondaryRoll: 15, checkMode: 'advantage', modifier: 0, total: 15
  });
  assert.equal(actor(state).pendingSteal.phase, 'gear');
  assert.equal(actor(state).pendingSteal.targetId, 'friend');
  assert.deepEqual(actor(state).gear, thiefGear);
  assert.deepEqual(friend(state).gear, sourceGear);
  const history = state.rollHistory;
  assert.equal(history.length, 1);
  assert.match(history[0].detail, /advantage.*\(1\)\(15\).*15 vs DC 15/);
  const taken = await withRandom(0, () => command(state, 'steal_take', { gear_index: 0 }));
  state = taken.value.state_json;
  assert.equal(taken.calls, 0, 'taking an item must not reroll');
  assert.equal(state.combat.actionUsed, true);
  assert.equal(actor(state).pendingSteal, null);
  assert.deepEqual(actor(state).gear, [...thiefGear, { ...sourceGear[0], equipped: false }]);
  assert.deepEqual(friend(state).gear, sourceGear.slice(1));
  for (const character of state.characters) assert.deepEqual(character.raw.gear, character.gear);
  const saved = await normalized(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(actor(saved).gear, actor(state).gear);
  assert.deepEqual(friend(saved).gear, friend(state).gear);
  assert.deepEqual(saved.rollHistory, state.rollHistory, 'structured history and detailed hovers survive save/load');
});

for (const invalid of ['missing', 'self', 'far', 'other-route']) {
  test(`runtime ${invalid} steal click neither rolls nor spends an action`, async () => {
    const initial = scene();
    let targetId = 'friend';
    if (invalid === 'missing') targetId = 'missing';
    if (invalid === 'self') targetId = 'actor';
    if (invalid === 'far') friend(initial).x = 5;
    if (invalid === 'other-route') {
      friend(initial).routeId = 'lower';
      initial.underpasses = [{ id: 'lower', lowerCells: [{ x: 3, y: 2 }],
        upperCrossings: [{ x: 3, y: 2 }], portals: [] }];
    }
    const state = await begin(await normalized(initial));
    const before = structuredClone(state);
    const rejected = await withRandom(0, () => assert.rejects(
      command(state, 'steal_target', { target_id: targetId }), /adjacent creature/));
    assert.equal(rejected.calls, 0);
    assert.deepEqual(state, before, 'rejection must not mutate the supplied state');
    const cancelled = await withRandom(0, () => command(state, 'steal_cancel'));
    assert.equal(cancelled.calls, 0);
    assert.equal(cancelled.value.state_json.combat.actionUsed, false);
    assert.deepEqual(cancelled.value.state_json.rollHistory, before.rollHistory);
  });
}

for (const success of [false, true]) {
  test(`runtime cancelling after a completed ${success ? 'successful' : 'failed'} steal check never refunds the action or rolls again`, async () => {
    const state = await begin(await normalized(scene()));
    const selected = await withRandom(success ? .7 : 0, () => command(state, 'steal_target', { target_id: 'friend' }));
    assert.equal(selected.calls, 2);
    assert.equal(selected.value.state_json.combat.actionUsed, true);
    const before = selected.value.state_json;
    const cancelled = await withRandom(0, () => command(before, 'steal_cancel'));
    assert.equal(cancelled.calls, 0);
    assert.equal(cancelled.value.state_json.combat.actionUsed, true);
    assert.equal(actor(cancelled.value.state_json).pendingSteal, null);
    assert.deepEqual(cancelled.value.state_json.rollHistory, before.rollHistory);
    assert.deepEqual(cancelled.value.state_json.characters.map(character => character.gear), before.characters.map(character => character.gear));
  });
}

function lightingScene(source, { combat = false, priorLight = false, ambient = false } = {}) {
  const state = scene({ combat });
  Object.assign(actor(state), { className: 'Fighter', stealthed: false,
    gear: [{ name: source === 'torch' ? 'Torch' : 'Lantern', lit: false, equipped: false },
      { name: 'Oil flask', quantity: 3, totalUnits: 3 }, { name: 'Flint and steel' }] });
  friend(state).gear = ambient ? [{ name: 'Torch', equipped: true, lit: true }] : [];
  state.timers.lightEverLit = priorLight;
  return state;
}

const units = (character, pattern) => character.gear.filter(item => pattern.test(item.name))
  .reduce((sum, item) => sum + Number(item.totalUnits ?? item.quantity ?? 1), 0);
const lightCommand = (state, source, reset) => command(state, 'light', { source, gear_index: 0, reset_timer: reset });

test('committing another action cancels uncommitted Steal targeting without refunding that action', async () => {
  const initial = lightingScene('torch', { combat: true });
  Object.assign(actor(initial), { className: 'Thief', stealthed: true });
  const pending = await begin(await normalized(initial));
  const { value } = await withRandom(.7, () => lightCommand(pending, 'torch', false));
  assert.equal(value.state_json.combat.actionUsed, true);
  assert.equal(actor(value.state_json).pendingSteal, null);
  assert.equal(value.state_json.rollHistory.length, 1);
  assert.equal(value.state_json.rollHistory[0].label, 'Light Torch');
});

function assertLit(state, source, before, reset) {
  const character = actor(state);
  const item = character.gear.find(item => item.name === (source === 'torch' ? 'Torch' : 'Lantern'));
  assert.equal(item.lit, true);
  assert.equal(item.equipped, true);
  assert.equal(character.lightSource, source);
  assert.equal(character.lightRadius, source === 'torch' ? 6 : 12);
  assert.equal(state.player.torchLit, true);
  assert.equal(state.timers.lightEverLit, true);
  assert.equal(state.timers.torchElapsedMs, reset || !before.timers.lightEverLit ? 0 : before.timers.torchElapsedMs);
  assert.equal(state.timers.torchDurationMs, before.timers.torchDurationMs);
  assert.equal(state.timers.actualElapsedMs, before.timers.actualElapsedMs);
  assert.equal(units(character, /oil/i), units(actor(before), /oil/i) - (source === 'lantern' ? 1 : 0));
  assert.equal(units(character, source === 'torch' ? /^torch/i : /lantern/i), 1);
  assert.deepEqual(character.raw.gear, character.gear);
}

for (const source of ['torch', 'lantern']) {
  test(`runtime ${source} normal exploration ticks advance the light timer without spending more supplies`, async () => {
    const initial = await normalized(lightingScene(source));
    const lit = (await withRandom(0, () => lightCommand(initial, source, false))).value.state_json;
    const now = Date.now;
    let result;
    Date.now = () => 1800000000000;
    try { result = await command(lit, 'tick', { elapsed_ms: 1000 }); } finally { Date.now = now; }
    assert.equal(result.state_json.timers.torchElapsedMs, lit.timers.torchElapsedMs + 1000);
    assert.equal(result.state_json.timers.actualElapsedMs, lit.timers.actualElapsedMs + 1000);
    assert.deepEqual(actor(result.state_json).gear, actor(lit).gear);
    assert.deepEqual(result.state_json.rollHistory, lit.rollHistory);
  });
  for (const priorLight of [false, true]) {
    for (const reset of [false, true]) {
      test(`runtime ${source} outside combat has no DEX roll at low RNG (prior=${priorLight}, reset=${reset})`, async () => {
        const state = await normalized(lightingScene(source, { priorLight }));
        const { value, calls } = await withRandom(0, () => lightCommand(state, source, reset));
        assert.equal(calls, 0, 'outside-combat lighting must not roll even in darkness');
        assert.equal(value.state_json.combat.actionUsed, false);
        assert.deepEqual(value.state_json.rollHistory, state.rollHistory);
        assertLit(value.state_json, source, state, reset);
      });
    }
  }
  for (const context of ['first-light', 'dark-relight', 'ambient-light']) {
    for (const success of [false, true]) {
      test(`runtime ${source} in combat checks DC 12 and spends the action on ${success ? 'success' : 'failure'} (${context})`, async () => {
        const state = await normalized(lightingScene(source, { combat: true,
          priorLight: context !== 'first-light', ambient: context === 'ambient-light' }));
        const { value, calls } = await withRandom(success ? .55 : .5, () => lightCommand(state, source, false));
        const after = value.state_json;
        assert.equal(calls, 2, 'non-thief lighting always rolls at disadvantage in combat');
        assert.equal(after.combat.actionUsed, true);
        assert.equal(after.rollHistory.length, state.rollHistory.length + 1);
        const entry = after.rollHistory[0];
        assert.equal(entry.label, source === 'torch' ? 'Light Torch' : 'Light Lantern');
        assert.match(entry.detail, success ? /12 vs DC 12: success/ : /11 vs DC 12: failed/);
        assert.ok(entry.rollCard, 'combat lighting must retain a roll card');
        assert.equal(entry.characterId, 'actor');
        if (success) assertLit(after, source, state, false);
        else {
          assert.match(value.message, /11 vs DC 12: failed/);
          assert.deepEqual(actor(after).gear, actor(state).gear, 'failed lighting cannot spend inventory or oil');
          assert.deepEqual(actor(after).raw.gear, actor(state).raw.gear);
          assert.equal(actor(after).lightSource, actor(state).lightSource);
          assert.equal(after.timers.torchElapsedMs, state.timers.torchElapsedMs);
          assert.equal(after.timers.lightEverLit, state.timers.lightEverLit);
        }
      });
    }
  }
}
