import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRuntimeLuckToken, syncRuntimeLuckTokens, grantRuntimeLuckToken, checkRuntimeLuckEvent,
  consumeRuntimeLuck, startRuntimeLuckEvent, finishRuntimeLuckEvent, startLuckSave,
  finishLuckSave, resolveLuckSave, createLuckOutcomeResolver
} from '../../S3_content/src/luck-runtime.js';
import { resolvePitSave } from '../../S3_content/src/pits.js';
import { queueFallingDamage, resolveFallingDamage } from '../../S3_content/src/falling.js';
import { applyHigherMishap } from '../../S3_content/src/higher-mishaps.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

function scene() {
  return { map: { width: 8, height: 8 }, tiles: Array.from({ length: 64 }, (_, i) => ({
    x: i % 8, y: Math.floor(i / 8), type: 'floor', roomId: 'r', meta: {}
  })), rooms: [{ id: 'r', x: 0, y: 0, width: 8, height: 8 }], decor: {},
  characters: [{ id: 'pc', name: 'Wizard', className: 'Wizard', hp: 20, maxHitPoints: 20, stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    x: 3, y: 3, roomId: 'r', routeId: '', luckToken: true, gear: [], raw: { hp: 20 } }],
  entities: [{ id: 'pit', type: 'trap', subtype: 'pit', x: 3, y: 3, width: 1, height: 1, triggered: true }],
  activeCharacterId: 'pc', player: { x: 3, y: 3, roomId: 'r', routeId: '' },
  timers: { torchElapsedMs: 100 }, visibility: { exploredEver: new Set(), visibleNow: new Set() } };
}
const check = roll => modifier => ({ roll, modifier, total: roll + modifier });
const reroll = (state, roll, options = {}) => consumeRuntimeLuck(state, { ownerId: 'pc', rollD20: () => roll,
  applyOutcome: (draft, info) => resolveLuckSave(draft, info, { resolvePitSave }), ...options });

test('token bridge supports normalized booleans, legacy counts and explicit spent values over stale raw mirrors', () => {
  for (const [character, expected] of [
    [{ luckToken: true }, true], [{ luckTokens: 1 }, true], [{ raw: { luckToken: true } }, true],
    [{ luckToken: false, raw: { luckToken: true, luckTokens: 1 } }, false],
    [{ luckTokens: 0, raw: { luckToken: true, luckTokens: 1 } }, false],
    [{ luckToken: true, luckTokens: 0 }, false], [{ luckToken: false, luckTokens: 1 }, false]
  ]) assert.equal(hasRuntimeLuckToken(character), expected);
  const state = scene(); syncRuntimeLuckTokens(state);
  assert.equal(state.characters[0].luckTokens, 1);
  assert.equal(state.characters[0].raw.luckToken, true);
  let grants = 0;
  grantRuntimeLuckToken(state, 'pc', { grantLuckToken: (_state, id) => { grants++; assert.equal(id, 'pc'); return false; } });
  assert.equal(grants, 1); assert.equal(state.characters[0].luckToken, true);
});

test('generic actor capture restores HP, negative conditions and spell loss using a draft callback', () => {
  const state = scene(), actor = state.characters[0];
  const event = startRuntimeLuckEvent(state, { kind: 'cast', actor, roll: check(2)(0), dc: 12 });
  actor.failedSpellKeys = ['web']; actor.pendingSpell = null; actor.conditions = { blind: true }; actor.hp = 14;
  finishRuntimeLuckEvent(state, event, { succeeded: false });
  const result = consumeRuntimeLuck(state, { ownerId: actor.id, rollD20: () => 15,
    applyOutcome: createLuckOutcomeResolver({ cast: (draft, info) => {
      assert.notEqual(info.actor, actor); assert.equal(info.actor.hp, 20);
      assert.equal(info.actor.failedSpellKeys, undefined); info.actor.pendingSpell = { spell: 'web', phase: 'placement' };
    } }) });
  assert.equal(result.succeeded, true); assert.equal(actor.hp, 20); assert.equal(actor.luckToken, false);
  assert.equal(actor.raw.luckTokens, 0); assert.equal(actor.pendingSpell.spell, 'web');
});

test('failed resolution is atomic including token aliases and raw property absence', () => {
  const state = scene(), actor = state.characters[0];
  const event = startLuckSave(state, actor, check(2)(0), { dc: 15, context: { saveType: 'custom' } });
  finishLuckSave(state, event, actor, { passed: false });
  delete actor.luckTokens; delete actor.raw.luckTokens;
  const before = structuredClone(state);
  assert.throws(() => reroll(state, 18), /No resolver/);
  assert.deepEqual(state, before);
  assert.ok(checkRuntimeLuckEvent(state, { ownerId: 'pc' }).ok);
});

test('failed pit save journals damage and prone/pit conditions; successful reroll restores actor and chooses a safe rim', () => {
  const state = scene(), actor = state.characters[0], pit = state.entities[0];
  actor.focusSpell = { spell: 'detect magic' };
  const fall = resolvePitSave(state, pit, actor, { check: check(2), random: () => .5 });
  assert.equal(fall.damage, 12); assert.equal(actor.hp, 8); assert.equal(actor.conditions.sinkhole, 'pit');
  assert.equal(state.luckJournal.events.length, 1);
  const sourceState = structuredClone(pit);
  state.timers.torchElapsedMs = 300;
  const result = reroll(state, 17);
  assert.equal(result.succeeded, true); assert.equal(actor.hp, 20);
  assert.equal(actor.conditions?.sinkhole, undefined); assert.equal(actor.conditions?.prone, undefined);
  assert.notDeepEqual([actor.x, actor.y], [3, 3]);
  assert.equal(state.player.x, actor.x); assert.equal(state.player.y, actor.y);
  assert.deepEqual(pit, sourceState); assert.equal(state.timers.torchElapsedMs, 300);
});

test('a still-failed pit reroll reapplies original damage exactly once without rolling new damage', () => {
  const state = scene(), actor = state.characters[0];
  resolvePitSave(state, state.entities[0], actor, { check: check(2), random: () => .5 });
  actor.hp -= 2; actor.raw.hp -= 2;
  const result = reroll(state, 4);
  assert.equal(result.succeeded, false);
  assert.equal(actor.hp, 6); assert.equal(actor.raw.hp, 6);
  assert.equal(actor.conditions.sinkhole, 'pit');
  assert.deepEqual(actor.lastPitFall.rolls, [4, 4, 4]);
});

test('delayed falling damage merges into the original save and survives save/load', () => {
  const state = scene(), actor = state.characters[0];
  resolvePitSave(state, state.entities[0], actor, { check: check(2), random: () => .5, queueFall: queueFallingDamage });
  assert.equal(actor.hp, 20); assert.equal(actor.pendingFall.luckEventId, state.luckJournal.events[0].id);
  let loaded = hydrateDungeonState(serializeDungeonState(state));
  resolveFallingDamage(loaded, loaded.characters[0], false);
  assert.equal(loaded.characters[0].hp, 8);
  assert.equal(loaded.luckJournal.events.length, 1);
  loaded = hydrateDungeonState(serializeDungeonState(loaded));
  assert.deepEqual(checkRuntimeLuckEvent(loaded, { ownerId: 'pc' }).conflicts, []);
  reroll(loaded, 17);
  assert.equal(loaded.characters[0].hp, 20);
  assert.equal(loaded.characters[0].conditions?.sinkhole, undefined);
  assert.equal(loaded.characters[0].pendingFall, undefined);
});

test('a successful save does not enter the unfavorable journal, and monsters do not gain party save events', () => {
  const state = scene(), actor = state.characters[0];
  resolvePitSave(state, state.entities[0], actor, { check: check(18) });
  assert.equal(state.luckJournal.events.length, 0);
  const orc = { id: 'orc', type: 'monster', name: 'Orc', x: 3, y: 3, hp: 12, D: 1 };
  state.entities.push(orc);
  resolvePitSave(state, state.entities[0], orc, { check: check(2), random: () => 0 });
  assert.equal(state.luckJournal.events.length, 0);
});

test('higher mishap CON/WIS failures journal source effects; success undoes them and failure reuses the same effect', () => {
  for (const [number, tier] of [[6, 3], [10, 3], [9, 5]]) {
    for (const roll of [3, 18]) {
      const state = scene(), actor = state.characters[0];
      actor.focusSpell = { spell: 'detect magic' };
      applyHigherMishap(state, actor, 'web', number, { tier, random: () => .5, saveCheckRoll: check(2) });
      const effects = structuredClone(actor.wizardEffects), stats = structuredClone(actor.stats);
      assert.equal(state.luckJournal.events.length, 1);
      reroll(state, roll);
      if (roll === 18) {
        assert.equal(actor.wizardEffects, undefined);
        assert.equal(actor.stats.CON, 10); assert.equal(actor.stats.WIS, 10);
        assert.equal(actor.focusSpell.spell, 'detect magic');
      } else { assert.deepEqual(actor.wizardEffects, effects); assert.deepEqual(actor.stats, stats); }
    }
  }
});

test('cross-route pit fall can reroll safely without deleting lower-route topology or another actor', () => {
  const state = scene(), actor = state.characters[0], pit = state.entities[0];
  state.underpasses = [{ id: 'lower', kind: 'pit-tunnel', lowerCells: [{ x: 3, y: 3 }], upperCrossings: [], portals: [] }];
  pit.lowerRouteId = 'lower';
  state.characters.push({ id: 'other', x: 6, y: 6, hp: 9, maxHitPoints: 9 });
  resolvePitSave(state, pit, actor, { check: check(2), random: () => 0 });
  assert.equal(actor.routeId, 'lower');
  const underpasses = state.underpasses;
  reroll(state, 18);
  assert.equal(actor.routeId, ''); assert.equal(state.underpasses, underpasses);
  assert.equal(state.characters[1].hp, 9);
});

test('a changed pit outcome refuses atomically and does not spend a normalized boolean token', () => {
  const state = scene(), actor = state.characters[0];
  resolvePitSave(state, state.entities[0], actor, { check: check(2), random: () => 0 });
  actor.conditions.poisoned = true;
  const before = structuredClone(state);
  assert.throws(() => reroll(state, 18), /conflict/);
  assert.deepEqual(state, before); assert.equal(actor.luckToken, true);
});

test('a successful pit reroll reverses delayed Feather Fall loss or source flags without casting Feather Fall again', () => {
  for (const natural of [2, 12]) {
    const state = scene(), actor = state.characters[0], pit = state.entities[0];
    actor.spellsKnown = 'Feather Fall';
    resolvePitSave(state, pit, actor, { check: check(2), random: () => .5, queueFall: queueFallingDamage });
    resolveFallingDamage(state, actor, true, { checkRoll: check(natural) });
    assert.equal(actor.hp, natural === 12 ? 20 : 8);
    if (natural === 12) assert.equal(pit.fallingDamageNegated, true);
    else assert.ok(actor.failedSpellKeys.includes('feather fall'));
    reroll(state, 18);
    assert.equal(actor.hp, 20);
    assert.equal(actor.failedSpellKeys, undefined);
    assert.equal(pit.fallingDamageNegated, undefined);
    assert.equal(pit.featherFallTargetId, undefined);
  }
});

test('a lethal pit outcome restores HP, Focus and death timer on success and reuses the same death timer on failure', () => {
  for (const natural of [3, 18]) {
    const state = scene(), actor = state.characters[0];
    actor.hp = actor.raw.hp = 3; actor.focusSpell = { spell: 'detect magic' };
    resolvePitSave(state, state.entities[0], actor, { check: check(2), random: () => .5 });
    const deathTimer = actor.dyingRounds;
    assert.equal(actor.hp, 0); assert.equal(actor.focusSpell, null);
    reroll(state, natural);
    assert.equal(actor.hp, natural === 18 ? 3 : 0);
    if (natural === 18) {
      assert.equal(actor.dyingRounds, undefined);
      assert.equal(actor.focusSpell.spell, 'detect magic');
    } else assert.equal(actor.dyingRounds, deathTimer);
  }
});

test('save hooks do not recursively journal when the parent calls the core draft resolver', () => {
  const state = scene(), actor = state.characters[0];
  resolvePitSave(state, state.entities[0], actor, { check: check(2), random: () => 0 });
  const sequence = state.luckJournal.sequence;
  reroll(state, 18);
  assert.equal(state.luckJournal.sequence, sequence);
  assert.equal(state.luckJournal.events.length, 1);
  assert.equal(state.luckJournal.events[0].used, true);
});
