import test from 'node:test';
import assert from 'node:assert/strict';
import { beginLuckEvent, captureLuckChange, finishLuckEvent, checkLuckEvent,
  consumeLuck, grantLuckToken, isLuckResolution, LUCK_HISTORY_LIMIT, LuckError } from '../../S3_content/src/luck.js';
import { castMagicMissile } from '../../S3_content/src/magic-missile.js';
import { setCharacterHp } from '../../S3_content/src/characters.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

const pc = id => ({ id, name: id, hp: 10, maxHitPoints: 10, x: 1, y: 1, stats: { CON: 10 }, raw: {} });
const foe = () => ({ id: 'orc', type: 'monster', hp: 15, x: 2, y: 1 });
const ref = (id, collection = 'characters') => ({ collection, id });
function fixture() {
  const state = { characters: [pc('a'), pc('b')], entities: [foe()],
    tiles: [['floor', 'wall']], visibility: { exploredEver: new Set(['1,1']) },
    timers: { torchElapsedMs: 100 }, combat: { turn: 1 } };
  grantLuckToken(state, 'a');
  return state;
}
function event(state, options = {}) {
  return beginLuckEvent(state, { kind: 'party-attack', actor: ref('b'),
    target: ref('orc', 'entities'), roll: 3, modifier: 2, dc: 12, ...options });
}
function missedAttack(state, options = {}) {
  const pending = event(state, options);
  finishLuckEvent(state, pending, { succeeded: false });
  return pending;
}
const reroll = (state, roll, applyOutcome = () => {}, options = {}) => consumeLuck(state, {
  ownerId: 'a', rollD20: () => roll, applyOutcome, ...options
});

test('latest unfavorable roll from any party member remains after favorable later rolls', () => {
  const state = fixture();
  const first = missedAttack(state);
  const favorable = event(state, { roll: 18 });
  assert.equal(finishLuckEvent(state, favorable, { succeeded: true }), null);
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).event.id, first.id);
  const result = reroll(state, 15, (draft, info) => {
    assert.equal(info.actor.id, 'b');
    if (info.succeeded) info.target.hp -= 4;
  });
  assert.equal(result.favorable, true);
  assert.equal(state.entities[0].hp, 11);
  assert.equal(state.characters[0].luckTokens, 0);
  assert.equal(state.characters[0].raw.luckTokens, 0);
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).reason, 'no-token');
});

test('rerolled attack resolves at current target position without movement/range rewind', () => {
  const state = fixture();
  missedAttack(state);
  state.entities[0].x = 90;
  state.entities[0].y = 80;
  state.characters[1].x = 40;
  const originalMap = state.tiles, originalFoe = state.entities[0], other = state.characters[0];
  reroll(state, 12, (draft, info) => {
    assert.equal(info.target.x, 90);
    assert.equal(info.actor.x, 40);
    info.target.hp -= 6;
  });
  assert.equal(state.entities[0], originalFoe);
  assert.equal(state.tiles, originalMap);
  assert.equal(state.characters[0], other);
  assert.equal(originalFoe.hp, 9);
  assert.equal(originalFoe.x, 90);
});

test('only 20 unfavorable contexts retained; favorable rolls do not evict contexts', () => {
  const state = fixture();
  for (let i = 0; i < 30; i++) missedAttack(state, { context: { attack: i } });
  for (let i = 0; i < 30; i++) finishLuckEvent(state, event(state), { succeeded: true });
  assert.equal(state.luckJournal.events.length, LUCK_HISTORY_LIMIT);
  assert.equal(state.luckJournal.events[0].context.attack, 10);
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).event.context.attack, 29);
});

test('nested events use roll order, not the order outcomes finish', () => {
  const state = fixture();
  const earlier = event(state), later = event(state, { kind: 'save', target: null, dc: 15 });
  finishLuckEvent(state, later, { succeeded: false });
  finishLuckEvent(state, earlier, { succeeded: false });
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).event.id, later.id);
});

test('one-token maximum and single reroll per event even when replacement awarded', () => {
  const state = fixture();
  assert.equal(grantLuckToken(state, 'a'), false);
  assert.equal(state.characters[0].luckTokens, 1);
  const older = missedAttack(state), newer = missedAttack(state);
  const result = reroll(state, 3);
  assert.equal(result.replacementToken, true);
  assert.equal(result.eventId, newer.id);
  assert.equal(state.characters[0].luckTokens, 1);
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).event.id, older.id);
  reroll(state, 3);
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).reason, 'no-event');
});

for (const kind of ['party-attack', 'save', 'cast', 'monster-attack']) {
  test(`${kind}: natural replacement die and exact same die award one token`, () => {
    for (const roll of [kind === 'monster-attack' ? 1 : 20, 7]) {
      const state = fixture();
      const pending = event(state, { kind, roll: 7 });
      finishLuckEvent(state, pending, { succeeded: kind === 'monster-attack' });
      const result = reroll(state, roll);
      assert.equal(result.replacementToken, true);
      assert.equal(state.characters[0].luckTokens, 1);
    }
  });
}

test('monster hit becomes miss and refunds HP, death, focus loss, and negative conditions', () => {
  const state = fixture(), victim = state.characters[1];
  victim.focusSpell = { name: 'detect magic' };
  const pending = event(state, { kind: 'monster-attack', actor: ref('orc', 'entities'), target: ref('b'), roll: 18 });
  captureLuckChange(state, pending, ref('b'), ['hp', 'raw', 'dyingRounds', 'dead', 'slain', 'focusSpell', 'conditions']);
  setCharacterHp(victim, 0);
  victim.conditions.poisoned = true;
  finishLuckEvent(state, pending, { succeeded: true });
  assert.equal(victim.hp, 0);
  assert.equal(victim.focusSpell, null);
  const result = reroll(state, 2, (draft, info) => {
    assert.equal(info.succeeded, false);
    assert.equal(info.target.hp, 10);
    assert.deepEqual(info.target.focusSpell, { name: 'detect magic' });
  });
  assert.equal(result.favorable, true);
  assert.equal(victim.hp, 10);
  assert.deepEqual(victim.focusSpell, { name: 'detect magic' });
  assert.equal(victim.dyingRounds, undefined);
  assert.equal(victim.conditions, undefined);
});

test('failed save restores only captured position/condition while preserving other actors and clock', () => {
  const state = fixture(), victim = state.characters[1];
  const pending = event(state, { kind: 'save', target: null, modifier: 0, dc: 15 });
  captureLuckChange(state, pending, ref('b'), ['x', 'y', 'routeId', 'conditions.prone']);
  victim.x = 7; victim.y = 8; victim.routeId = 'pit'; victim.conditions = { prone: true };
  finishLuckEvent(state, pending, { succeeded: false });
  state.characters[0].hp = 3;
  state.timers.torchElapsedMs = 1000;
  reroll(state, 16);
  assert.deepEqual([victim.x, victim.y, victim.routeId, victim.conditions], [1, 1, undefined, undefined]);
  assert.equal(state.characters[0].hp, 3);
  assert.equal(state.timers.torchElapsedMs, 1000);
});

test('failed spell loss is undone and existing spell resolver uses injected reroll once', () => {
  const state = fixture(), wizard = state.characters[1];
  wizard.stats = { INT: 14 };
  const pending = event(state, { kind: 'cast', target: null, roll: 3, modifier: 2, dc: 11,
    context: { spell: 'magic missile' } });
  captureLuckChange(state, pending, ref('b'), ['failedSpellKeys', 'pendingSpell']);
  const original = castMagicMissile(state, wizard, { rollCheck: () => ({ roll: 3, total: 5, modifier: 2 }) });
  finishLuckEvent(state, pending, { succeeded: original.succeeded });
  assert.deepEqual(wizard.failedSpellKeys, ['magic missile']);
  let checks = 0;
  reroll(state, 15, (draft, info) => {
    assert.equal(info.actor.failedSpellKeys, undefined);
    const cast = castMagicMissile(draft, info.actor, { rollCheck: () => { checks++; return info.check; } });
    assert.equal(cast.succeeded, true);
  });
  assert.equal(checks, 1);
  assert.equal(wizard.pendingSpell.phase, 'targeting');
  assert.equal(wizard.failedSpellKeys, undefined);
});

test('a still-unfavorable reroll reapplies outcome once, not in addition to old damage', () => {
  const state = fixture();
  const pending = event(state, { kind: 'monster-attack', actor: ref('orc', 'entities'), target: ref('b'), roll: 18 });
  captureLuckChange(state, pending, ref('b'), ['hp']);
  state.characters[1].hp -= 4;
  finishLuckEvent(state, pending, { succeeded: true });
  const result = reroll(state, 15, (draft, info) => { if (info.succeeded) info.target.hp -= 2; });
  assert.equal(result.favorable, false);
  assert.equal(state.characters[1].hp, 8);
});

test('numeric compensation preserves subsequent damage/healing instead of restoring an old HP snapshot', () => {
  const state = fixture();
  const pending = event(state, { kind: 'monster-attack', actor: ref('orc', 'entities'), target: ref('b'), roll: 18 });
  captureLuckChange(state, pending, ref('b'), ['hp'], { mode: 'compensate', min: 0, max: 10 });
  state.characters[1].hp = 6;
  finishLuckEvent(state, pending, { succeeded: true });
  state.characters[1].hp -= 2;
  reroll(state, 2);
  assert.equal(state.characters[1].hp, 8);
});

test('later guarded conflicts refuse atomically, without spending token or selecting an older roll', () => {
  const state = fixture();
  missedAttack(state);
  const pending = event(state, { kind: 'save', target: null });
  captureLuckChange(state, pending, ref('b'), ['x']);
  state.characters[1].x = 5;
  finishLuckEvent(state, pending, { succeeded: false });
  state.characters[1].x = 6;
  const before = structuredClone(state);
  const eligible = checkLuckEvent(state, { ownerId: 'a' });
  assert.equal(eligible.reason, 'conflict');
  assert.equal(eligible.event.id, pending.id);
  assert.throws(() => reroll(state, 20), error => error.code === 'conflict');
  assert.deepEqual(state, before);
});

test('missing original target refuses without spending token; no opportunistic new target', () => {
  const state = fixture();
  missedAttack(state);
  state.entities = [];
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).reason, 'conflict');
  assert.throws(() => reroll(state, 20), LuckError);
  assert.equal(state.characters[0].luckTokens, 1);
});

test('entity lifecycle restores a slain character and removes unchanged corpse aftermath', () => {
  const state = fixture();
  const pending = event(state, { kind: 'monster-attack', actor: ref('orc', 'entities'), target: ref('b'), roll: 18 });
  captureLuckChange(state, pending, ref('b'), [], { lifecycle: true });
  captureLuckChange(state, pending, ref('corpse-b', 'entities'), [], { lifecycle: true });
  state.characters.pop();
  state.entities.push({ id: 'corpse-b', type: 'feature', characterCorpse: { ...pc('b'), hp: 0, dead: true } });
  finishLuckEvent(state, pending, { succeeded: true });
  reroll(state, 2);
  assert.equal(state.characters.find(item => item.id === 'b').hp, 10);
  assert.equal(state.entities.some(item => item.id === 'corpse-b'), false);
});

test('dead token owner can spend their own token to undo their death', () => {
  const state = fixture();
  const pending = event(state, { kind: 'monster-attack', actor: ref('orc', 'entities'), target: ref('a'), roll: 18 });
  captureLuckChange(state, pending, ref('a'), [], { lifecycle: true });
  captureLuckChange(state, pending, ref('corpse-a', 'entities'), [], { lifecycle: true });
  const dead = state.characters.shift();
  state.entities.push({ id: 'corpse-a', type: 'feature', characterCorpse: { ...dead, hp: 0, dead: true } });
  finishLuckEvent(state, pending, { succeeded: true });
  reroll(state, 1);
  const restored = state.characters.find(item => item.id === 'a');
  assert.equal(restored.hp, 10);
  assert.equal(restored.luckTokens, 1);
});

test('changed or looted aftermath prevents silently deleting a later interaction', () => {
  const state = fixture();
  const pending = event(state, { kind: 'cast', target: null });
  captureLuckChange(state, pending, ref('hazard', 'entities'), [], { lifecycle: true });
  state.entities.push({ id: 'hazard', x: 3, y: 4, looted: false });
  finishLuckEvent(state, pending, { succeeded: false });
  state.entities[1].looted = true;
  assert.throws(() => reroll(state, 20), error => error.code === 'conflict');
  assert.equal(state.entities[1].looted, true);
});

test('new aftermath requires explicit createdEntities and supports declared additional affected actors', () => {
  const state = fixture();
  state.entities.push({ id: 'skeleton', hp: 4 });
  missedAttack(state, { scope: [ref('skeleton', 'entities')] });
  reroll(state, 20, draft => {
    draft.entities[0].hp = 0;
    draft.entities[1].hp = 0;
    draft.entities.push({ id: 'new-corpse', type: 'feature' });
    return { createdEntities: [ref('new-corpse', 'entities')] };
  });
  assert.equal(state.entities[1].hp, 0);
  assert.equal(state.entities.at(-1).id, 'new-corpse');
});

for (const invalid of ['world', 'unrelated-actor', 'undeclared-state', 'undeclared-created', 'reorder', 'journal']) {
  test(`resolver ${invalid} mutation is rejected atomically`, () => {
    const state = fixture();
    state.entities.push({ id: 'unrelated', hp: 9 });
    missedAttack(state);
    const before = structuredClone(state);
    assert.throws(() => reroll(state, 20, draft => {
      if (invalid === 'world') draft.tiles[0][0] = 'pit';
      if (invalid === 'unrelated-actor') draft.entities[1].hp = 1;
      if (invalid === 'undeclared-state') draft.timers.torchElapsedMs = 0;
      if (invalid === 'undeclared-created') draft.entities.push({ id: 'new', hp: 1 });
      if (invalid === 'reorder') draft.characters.reverse();
      if (invalid === 'journal') draft.luckJournal.events = [];
    }), error => error.code === 'outside-scope');
    assert.deepEqual(state, before);
  });
}

test('explicit bounded state paths undo and resolve only those fields', () => {
  const state = fixture();
  const pending = event(state, { kind: 'save', target: null, statePaths: ['combat.turn'] });
  captureLuckChange(state, pending, { collection: 'state' }, ['combat.turn']);
  state.combat.turn = 2;
  finishLuckEvent(state, pending, { succeeded: false });
  reroll(state, 20, draft => { assert.equal(draft.combat.turn, 1); draft.combat.turn = 3; });
  assert.equal(state.combat.turn, 3);
});

test('callback exceptions, async callbacks, invalid dice and recursive consumption do not mutate live state', () => {
  for (const mode of ['throw', 'async', 'invalid-die', 'recursive']) {
    const state = fixture();
    missedAttack(state);
    const before = structuredClone(state);
    assert.throws(() => reroll(state, mode === 'invalid-die' ? 21 : 20, draft => {
      draft.entities[0].hp = 0;
      if (mode === 'throw') throw new Error('resolver failed');
      if (mode === 'async') return Promise.resolve();
      if (mode === 'recursive') reroll(state, 20);
    }));
    assert.deepEqual(state, before);
  }
});

test('captured events survive a JSON roundtrip without retaining a map snapshot', () => {
  const state = fixture();
  const pending = event(state, { kind: 'save', target: null });
  captureLuckChange(state, pending, ref('b'), ['hp']);
  state.characters[1].hp = 7;
  finishLuckEvent(state, pending, { succeeded: false });
  const text = JSON.stringify(state.luckJournal);
  assert.equal(text.includes('tiles'), false);
  assert.equal(text.includes('torchElapsedMs'), false);
  state.luckJournal = JSON.parse(text);
  reroll(state, 20);
  assert.equal(state.characters[1].hp, 10);
});

test('oversized contexts, unsafe paths, invalid refs, overlaps, and whole-map captures are rejected', () => {
  const state = fixture();
  assert.throws(() => event(state, { context: { giant: 'x'.repeat(9000) } }), LuckError);
  const pending = event(state);
  assert.throws(() => captureLuckChange(state, pending, ref('b'), ['__proto__.polluted']), LuckError);
  assert.throws(() => captureLuckChange(state, pending, ref('b'), ['id']), LuckError);
  assert.throws(() => captureLuckChange(state, pending, { collection: 'tiles', id: 'b' }, ['hp']), LuckError);
  assert.throws(() => captureLuckChange(state, pending, { collection: 'state' }, ['tiles']), LuckError);
  assert.throws(() => captureLuckChange(state, pending, { collection: 'state' }, [], { lifecycle: true }), LuckError);
  captureLuckChange(state, pending, ref('b'), ['raw']);
  assert.throws(() => captureLuckChange(state, pending, ref('b'), ['raw.hp']), LuckError);
  assert.equal({}.polluted, undefined);
});

test('single Luck die replaces paired advantage/disadvantage roll, retaining original modifier and DC', () => {
  const state = fixture();
  const pending = event(state, { roll: { roll: 3, firstRoll: 3, secondaryRoll: 2, modifier: 4 }, modifier: 4, dc: 15 });
  finishLuckEvent(state, pending, { succeeded: false });
  const result = reroll(state, 12);
  assert.equal(result.check.secondaryRoll, null);
  assert.equal(result.check.total, 16);
  assert.equal(result.succeeded, true);
});

test('saving throws use their threshold rather than natural-20/1 automatic attack rules by default', () => {
  const state = fixture();
  missedAttack(state, { kind: 'save', dc: 30, modifier: 0 });
  const result = reroll(state, 20);
  assert.equal(result.succeeded, false);
  assert.equal(result.replacementToken, true);
});

test('optional undefined runtime fields serialize as missing rather than breaking lifecycle capture', () => {
  const state = fixture();
  state.characters[1].optional = undefined;
  const pending = event(state, { kind: 'save', target: null });
  captureLuckChange(state, pending, ref('b'), [], { lifecycle: true });
  state.characters[1].hp = 4;
  state.characters[1].newOptional = undefined;
  finishLuckEvent(state, pending, { succeeded: false });
  reroll(state, 20);
  assert.equal(state.characters[1].hp, 10);
  assert.equal(state.characters[1].optional, undefined);
});

test('indexed array paths are rejected so gear cannot be converted into an object', () => {
  const state = fixture();
  state.characters[1].gear = [{ name: 'dagger', equipped: true }];
  const pending = event(state);
  assert.throws(() => captureLuckChange(state, pending, ref('b'), ['gear.0.equipped']), error => error.code === 'invalid-path');
  assert.equal(Array.isArray(state.characters[1].gear), true);
});

test('builders cannot capture or finish against a different dungeon', () => {
  const state = fixture(), other = fixture();
  const pending = event(state);
  assert.throws(() => captureLuckChange(other, pending, ref('b'), ['hp']), error => error.code === 'closed-event');
  assert.throws(() => finishLuckEvent(other, pending, { succeeded: false }), error => error.code === 'closed-event');
});

test('integration can suppress new journal hooks during a Luck resolution', () => {
  const state = fixture();
  missedAttack(state);
  assert.equal(isLuckResolution(state), false);
  reroll(state, 20, draft => {
    assert.equal(isLuckResolution(state), true);
    assert.equal(isLuckResolution(draft), true);
    assert.throws(() => event(draft), error => error.code === 'busy');
  });
  assert.equal(isLuckResolution(state), false);
});

test('resolver cannot mutate immutable roll context before the atomic commit', () => {
  const state = fixture();
  missedAttack(state);
  const before = structuredClone(state);
  assert.throws(() => reroll(state, 20, (draft, info) => {
    draft.entities[0].hp = 0;
    info.event.id = 'missing';
  }), TypeError);
  assert.deepEqual(state, before);
});

test('rehydrated malicious field paths and malformed records fail closed without prototype writes', () => {
  for (const mode of ['prototype', 'whole-world', 'bad-snapshot', 'duplicate', 'favorable']) {
    const state = fixture();
    missedAttack(state);
    const record = state.luckJournal.events[0];
    if (mode === 'prototype' || mode === 'whole-world') record.patches.push({
      ref: { collection: 'state' }, path: [mode === 'prototype' ? '__proto__' : 'tiles', 'polluted'],
      before: { exists: false }, after: { exists: false }, mode: 'guard'
    });
    if (mode === 'bad-snapshot') record.patches.push({ ref: ref('b'), path: ['hp'], before: { exists: true }, after: { exists: false }, mode: 'guard' });
    if (mode === 'duplicate') state.luckJournal.events.push(structuredClone(record));
    if (mode === 'favorable') record.succeeded = true;
    const before = structuredClone(state);
    assert.equal(checkLuckEvent(state, { ownerId: 'a' }).ok, false);
    assert.throws(() => reroll(state, 20), LuckError);
    assert.deepEqual(state, before);
    assert.equal({}.polluted, undefined);
  }
});

test('boolean luckToken survives real normalization/save/load and an explicit spent false overrides stale mirrors', () => {
  let state = fixture();
  missedAttack(state);
  state = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(state.characters[0].luckToken, true);
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).ok, true);
  reroll(state, 15);
  assert.equal(state.characters[0].luckToken, false);
  state.characters[0].raw.luckToken = true;
  state.characters[0].luckTokens = 1;
  assert.equal(checkLuckEvent(state, { ownerId: 'a' }).reason, 'no-token');
});
