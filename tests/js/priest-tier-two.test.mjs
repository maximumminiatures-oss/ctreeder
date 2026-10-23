import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { syncAreaSpellConditions } from '../../S3_content/src/area-spells.js';
import { PRIEST_TIER_TWO_SPELLS, PRIEST_TIER_TWO_CHOICES, castPriestTierTwoSpell, resolvePriestTierTwoSpell,
  isPriestTierTwoFocus, maintainPriestTierTwoFocus, cleanupPriestTierTwoFocus, endPriestTierTwoFocus,
  advancePriestTierTwoFocus, advancePriestTierTwoRounds, cleansingWeaponDice, priestTierTwoPresentation } from '../../S3_content/src/priest-tier-two.js';

function scene() {
  const state = createEmptyDungeonState(7); state.map = { width: 24, height: 16 };
  state.tiles = Array.from({ length: 384 }, (_, i) => ({ x: i % 24, y: Math.floor(i / 24), type: 'floor', roomId: 'room', meta: {} }));
  state.rooms = [{ id: 'room', x: 0, y: 0, width: 24, height: 16 }];
  const caster = { id: 'priest', name: 'Priest', className: 'Priest', level: 3, hp: 30, maxHitPoints: 30,
    x: 3, y: 3, roomId: 'room', routeId: '', lightRadius: 30, stats: { WIS: 14, INT: 3 }, raw: {},
    gear: [{ name: 'Mace', type: 'weapon', equipped: true }], languages: 'Common, Celestial', bonuses: [] };
  const ally = { id: 'ally', name: 'Ally', hp: 20, maxHitPoints: 20, x: 4, y: 4, roomId: 'room', routeId: '', raw: {},
    gear: [{ name: 'Longsword', type: 'weapon', equipped: true }], languages: 'Common' };
  const foe = { id: 'foe', type: 'monster', name: 'Bandit', hp: 50, x: 6, y: 3, roomId: 'room', routeId: '', visible: true, languages: ['Common'], tags: ['humanoid'] };
  const second = { ...foe, id: 'second', name: 'Guard', x: 7, tags: ['undead'], languages: ['Common'] };
  state.characters = [caster, ally]; state.entities = [foe, second];
  state.activeCharacterId = caster.id; Object.assign(state.player, { x: 3, y: 3, routeId: '', roomId: 'room', torchLit: false });
  recomputeVisibility(state); return { state, caster, ally, foe, second };
}
const check = (roll, total) => modifier => ({ roll, modifier, total: total ?? roll + modifier });
const cast = (ctx, spell, roll = 12, extra = {}) => castPriestTierTwoSpell(ctx.state, ctx.caster, spell, { checkRoll: check(roll), ...extra });
const resolve = (ctx, selection, options = {}) => resolvePriestTierTwoSpell(ctx.state, ctx.caster, selection, options);
function focused(ctx, spell = 'Blind/Deafen', mode = 'blind', targetId = 'foe') {
  cast(ctx, spell);
  if (spell === 'Blind/Deafen') resolve(ctx, { mode });
  return resolve(ctx, { targetId });
}

test('Tier 2 priest keys, exact critical choices, WIS bonuses, and DC12 casting use deterministic RNG', () => {
  assert.deepEqual([...PRIEST_TIER_TWO_SPELLS], ['augury', 'bless', 'blind deafen', 'cleansing weapon', 'smite', 'zone of truth']);
  assert.deepEqual(PRIEST_TIER_TWO_CHOICES.bless.map(([key]) => key), ['targets']);
  assert.deepEqual(PRIEST_TIER_TWO_CHOICES['blind deafen'].map(([key]) => key), ['targets', 'both']);
  assert.deepEqual(PRIEST_TIER_TWO_CHOICES['cleansing weapon'].map(([key]) => key), ['duration', 'dice']);
  const ctx = scene(); ctx.caster.bonuses.push({ name: 'Spellcasting', bonusName: 'Spellcasting', bonusTo: 'priest spellcasting checks', bonusAmount: 1 });
  const result = castPriestTierTwoSpell(ctx.state, ctx.caster, 'Smite', { rng: () => .4 });
  assert.equal(result.check.roll, 9); assert.equal(result.check.modifier, 3); assert.equal(result.check.total, 12); assert.equal(result.succeeded, true);
  const a = scene(), b = scene();
  assert.deepEqual(castPriestTierTwoSpell(a.state, a.caster, 'Bless', { rng: new SeededRng(123) }),
    castPriestTierTwoSpell(b.state, b.caster, 'Bless', { rng: new SeededRng(123) }));
});

test('advantage rolls two dice; ordinary cast failure loses only the spell and natural one also requires priest penance', () => {
  const ctx = scene(); let values = [0, .999];
  const result = castPriestTierTwoSpell(ctx.state, ctx.caster, 'Bless', { rng: () => values.shift(), advantage: true });
  assert.equal(result.check.checkMode, 'advantage'); assert.equal(result.check.roll, 20); assert.equal(ctx.caster.pendingSpell.phase, 'critical');
  const failed = scene(); assert.equal(cast(failed, 'smite', 2).succeeded, false);
  assert.deepEqual(failed.caster.failedSpellKeys, ['smite']); assert.equal(failed.caster.spellPenance, undefined);
  assert.throws(() => cast(failed, 'smite'), /unavailable/);
  const critical = scene(); cast(critical, 'Bless', 1, { checkRoll: check(1, 100) });
  assert.deepEqual(critical.caster.spellPenance, { bless: { paid: false } });
  assert.equal(critical.caster.pendingSpell, undefined);
});

test('Bless reaches self and all eight adjacent squares, but not through walls or closed doors', () => {
  for (const [dx, dy] of [[0, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
    const ctx = scene(); ctx.ally.x = 3 + dx; ctx.ally.y = 3 + dy;
    cast(ctx, 'Bless'); resolve(ctx, { targetId: dx || dy ? 'ally' : 'priest' });
    const target = dx || dy ? ctx.ally : ctx.caster;
    assert.equal(target.luckTokens, 1); assert.equal(target.raw.luckTokens, 1);
  }
  const wall = scene(); wall.state.tiles[3 * 24 + 4].type = 'wall'; cast(wall, 'Bless');
  assert.throws(() => resolve(wall, { targetId: 'ally' }), /touch range/);
  const door = scene(); door.ally.y = 3;
  door.state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 4, y: 3, doorState: 'closed' });
  cast(door, 'Bless'); assert.throws(() => resolve(door, { targetId: 'ally' }), /touch range/);
});

test('Bless rejects existing tokens without consuming targeting and critical grants two distinct creatures exactly one token each', () => {
  const ctx = scene(); ctx.ally.luckTokens = 1; cast(ctx, 'Bless', 20);
  assert.equal(priestTierTwoPresentation(ctx.state, ctx.caster).message, 'Choose a critical effect.');
  assert.throws(() => resolve(ctx, { choice: 'range' }), /valid critical/);
  resolve(ctx, { choice: 'targets' });
  assert.throws(() => resolve(ctx, { targetId: 'ally' }), /already has/);
  assert.equal(ctx.caster.pendingSpell.remaining, 2);
  ctx.ally.luckTokens = 0;
  resolve(ctx, { targetId: 'priest' });
  assert.throws(() => resolve(ctx, { targetId: 'priest' }), /different living/);
  resolve(ctx, { targetId: 'ally' });
  assert.equal(ctx.caster.luckTokens, 1); assert.equal(ctx.ally.luckTokens, 1); assert.equal(ctx.caster.pendingSpell, null);
  const legacy = scene(); legacy.ally.luckToken = false; legacy.ally.luckTokens = 0; legacy.ally.raw.luckToken = true;
  cast(legacy, 'Bless'); resolve(legacy, { targetId: 'ally' });
  assert.equal(legacy.ally.luckTokens, 1, 'a stale raw token cannot override an explicitly spent current token');
});

test('Cleansing Weapon enchants only a touched equipped weapon, preserves other magic, and uses undead bonus dice', () => {
  const ctx = scene(), weapon = ctx.ally.gear[0];
  weapon.holyWeapon = { rounds: 5, bonus: 1 }; weapon.magic = { bonus: 2, identified: true };
  cast(ctx, 'Cleansing Weapon'); resolve(ctx, { targetId: 'ally' });
  assert.equal(cleansingWeaponDice(weapon, ctx.foe), '1d4');
  assert.equal(cleansingWeaponDice(weapon, ctx.second), '1d6');
  assert.equal(cleansingWeaponDice(weapon, { companion: { source: { tags: ['undead'] } } }), '1d6');
  assert.equal(cleansingWeaponDice(weapon, undefined), '1d4');
  assert.equal(weapon.cleansingWeapon.damageType, 'radiant');
  assert.deepEqual(weapon.holyWeapon, { rounds: 5, bonus: 1 }); assert.equal(weapon.magic.bonus, 2);
  advancePriestTierTwoRounds(ctx.state, 5);
  assert.equal(cleansingWeaponDice(weapon, ctx.foe), ''); assert.equal(weapon.magic.bonus, 2); assert.equal(weapon.holyWeapon.bonus, 1);
  const invalid = scene(); invalid.ally.gear[0].equipped = false; cast(invalid, 'Cleansing Weapon');
  assert.throws(() => resolve(invalid, { targetId: 'ally' }), /equipped weapon/);
});

test('Cleansing Weapon critical doubles duration or bonus dice, never range; dropped, monster, and corpse gear expire', () => {
  for (const choice of ['duration', 'dice']) {
    const ctx = scene(); cast(ctx, 'Cleansing Weapon', 20);
    assert.throws(() => resolve(ctx, { choice: 'range' }), /valid critical/);
    resolve(ctx, { choice }); resolve(ctx, { targetId: 'ally' });
    const weapon = ctx.ally.gear[0];
    assert.equal(weapon.cleansingWeapon.rounds, choice === 'duration' ? 10 : 5);
    assert.equal(cleansingWeaponDice(weapon, ctx.second), choice === 'dice' ? '2d6' : '1d6');
  }
  const ctx = scene(), item = () => ({ cleansingWeapon: { rounds: 1, diceCount: 1 } });
  const dropped = item(), native = item(), corpse = item();
  ctx.foe.gear = [native]; ctx.state.entities.push({ gearItem: dropped }, { characterCorpse: { gear: [corpse] } });
  advancePriestTierTwoRounds(ctx.state);
  for (const weapon of [dropped, native, corpse]) assert.equal(weapon.cleansingWeapon, undefined);
});

test('Smite automatically deals radiant damage once, exposes notification callbacks, and reports defeat without duplicate HP mutation', () => {
  const ctx = scene(); ctx.foe.hp = 2; let damageCalls = 0, defeatCalls = 0;
  cast(ctx, 'Smite');
  const result = resolve(ctx, { targetId: 'foe' }, { rng: () => .5,
    onDamage: (target, damage, context) => { damageCalls++; assert.equal(target.hp, 0); assert.equal(damage, 4); assert.equal(context.damageType, 'radiant'); },
    onDefeat: target => { defeatCalls++; target.defeated = true; } });
  assert.equal(result.hits[0].damage, 4); assert.equal(result.hits[0].hpLost, 2);
  assert.equal(result.hits[0].damageApplied, true); assert.equal(result.hits[0].defeatHandled, true);
  assert.equal(damageCalls, 1); assert.equal(defeatCalls, 1);
  assert.throws(() => resolve(ctx, { targetId: 'foe' }), /No Tier 2/);
});

test('Smite critical offers 2d6, 1d12, two sequential distinct targets, or twelve-square range', () => {
  for (const [choice, count, sides] of [['double-dice', 2, 6], ['larger-die', 1, 12], ['range', 1, 6]]) {
    const ctx = scene(); if (choice === 'range') ctx.foe.x = 15;
    cast(ctx, 'Smite', 20); resolve(ctx, { choice });
    const hit = resolve(ctx, { targetId: 'foe' }, { rng: () => .999 }).hits[0];
    assert.equal(hit.diceCount, count); assert.equal(hit.diceSides, sides); assert.equal(hit.damage, count * sides);
  }
  const ctx = scene(); cast(ctx, 'Smite', 20); resolve(ctx, { choice: 'targets' });
  assert.equal(resolve(ctx, { targetId: 'foe' }, { rng: () => 0 }).remaining, 1);
  assert.throws(() => resolve(ctx, { targetId: 'foe' }), /different living/);
  resolve(ctx, { targetId: 'second' }, { rng: () => 0 });
  assert.equal(ctx.foe.hp, 49); assert.equal(ctx.second.hp, 49); assert.equal(ctx.caster.pendingSpell, null);
});

test('ranged priest targets require circular range, visibility, route agreement, and unobstructed line of sight', () => {
  for (const variant of ['distance', 'wall', 'hidden', 'route']) {
    const ctx = scene();
    if (variant === 'distance') { ctx.foe.x = 9; ctx.foe.y = 4; }
    if (variant === 'wall') ctx.state.tiles[3 * 24 + 4].type = 'wall';
    if (variant === 'hidden') ctx.foe.stealthState = { attempted: true, revealed: false };
    if (variant === 'route') {
      ctx.state.underpasses = [{ id: 'lower', lowerCells: [{ x: 6, y: 3 }], upperCrossings: [{ x: 6, y: 3 }], portals: [] }];
      ctx.foe.routeId = 'lower';
    }
    recomputeVisibility(ctx.state); cast(ctx, 'Smite');
    assert.throws(() => resolve(ctx, { targetId: 'foe' }), /visible target/);
    assert.equal(ctx.foe.hp, 50);
  }
});

test('Blind/Deafen chooses one sense, has no direct spellcasting prohibition, and deafening requests one immediate Focus check', () => {
  const ctx = scene(); ctx.foe.focusSpell = { spell: 'protection from evil' }; let distracted = 0;
  cast(ctx, 'Blind/Deafen'); assert.equal(ctx.caster.pendingSpell.phase, 'options');
  assert.throws(() => resolve(ctx, { mode: 'both' }), /blind or deaf/);
  resolve(ctx, { option: 'deaf' });
  const result = resolve(ctx, { targetId: 'foe' }, { onDistractFocus: target => { distracted++; assert.equal(target, ctx.foe); } });
  assert.equal(distracted, 1); assert.equal(result.events[0].handled, true);
  assert.equal(ctx.foe.conditions.deafened.casterId, ctx.caster.id); assert.equal(ctx.foe.conditions.blind, undefined);
  assert.equal(ctx.foe.focusSpell.spell, 'protection from evil', 'the parent resolves the requested Focus check');
});

test('Blind/Deafen critical targets two creatures with one sense or one creature with both senses', () => {
  const both = scene(); cast(both, 'Blind/Deafen', 20); resolve(both, { choice: 'both' }); resolve(both, { targetId: 'foe' });
  assert.equal(both.foe.conditions.blind.casterId, 'priest'); assert.equal(both.foe.conditions.deafened.casterId, 'priest');
  const two = scene(); cast(two, 'Blind/Deafen', 20); resolve(two, { choice: 'targets' }); resolve(two, { mode: 'blind' });
  resolve(two, { targetId: 'foe' }); resolve(two, { targetId: 'second' });
  assert.ok(two.foe.conditions.blind); assert.ok(two.second.conditions.blind); assert.equal(two.second.conditions.deafened, undefined);
});

test('Focus failure ends its sourced blindness/deafness without ordinary spell loss; natural one also loses the spell and requires penance', () => {
  const ctx = scene(); focused(ctx);
  const result = maintainPriestTierTwoFocus(ctx.state, ctx.caster, { checkRoll: check(2) });
  assert.equal(result.succeeded, false); assert.equal(ctx.foe.conditions.blind, undefined); assert.equal(ctx.caster.focusSpell, null);
  assert.equal(ctx.caster.failedSpellKeys, undefined);
  focused(ctx, 'Blind/Deafen', 'deaf'); maintainPriestTierTwoFocus(ctx.state, ctx.caster, { checkRoll: check(1, 99) });
  assert.equal(ctx.foe.conditions.deafened, undefined); assert.deepEqual(ctx.caster.failedSpellKeys, ['blind deafen']);
  assert.deepEqual(ctx.caster.spellPenance, { 'blind deafen': { paid: false } });
});

test('overlapping priest conditions preserve other casters and restore prior unrelated conditions after cleanup', () => {
  const ctx = scene(); const base = { source: 'permanent curse' }; ctx.foe.conditions = { blind: base };
  focused(ctx);
  const other = { ...structuredClone(ctx.caster), id: 'other', raw: {}, pendingSpell: null, focusSpell: null };
  ctx.state.characters.push(other);
  castPriestTierTwoSpell(ctx.state, other, 'Blind/Deafen', { checkRoll: check(12) });
  resolvePriestTierTwoSpell(ctx.state, other, { mode: 'blind' }); resolvePriestTierTwoSpell(ctx.state, other, { targetId: 'foe' });
  endPriestTierTwoFocus(ctx.state, ctx.caster);
  assert.equal(ctx.foe.conditions.blind.casterId, 'other');
  other.focusSpell = null; cleanupPriestTierTwoFocus(ctx.state);
  assert.deepEqual(ctx.foe.conditions.blind, base); assert.equal(ctx.foe.conditions.priestTierTwoSenses, undefined);
});

test('ending priest blindness never restores a cached Silence source after its area expired or the creature left it', () => {
  for (const reason of ['expired', 'outside', 'still active']) {
    const ctx = scene(); ctx.foe.name = 'Stingbat';
    const wizard = { ...structuredClone(ctx.caster), id: 'wizard', className: 'Wizard', raw: {}, focusSpell: { spell: 'silence', areaId: 'silence' } };
    ctx.state.characters.push(wizard);
    ctx.state.areaSpells = [{ id: 'silence', casterId: 'wizard', spell: 'silence', x: 5, y: 2, width: 3, height: 3 }];
    syncAreaSpellConditions(ctx.state);
    assert.equal(ctx.foe.conditions.blind.source, 'silence');
    focused(ctx);
    if (reason === 'expired') wizard.focusSpell = null;
    if (reason === 'outside') ctx.foe.x = 12;
    syncAreaSpellConditions(ctx.state);
    assert.equal(ctx.foe.conditions.blind.source, 'blind deafen');
    endPriestTierTwoFocus(ctx.state, ctx.caster);
    if (reason === 'still active') assert.equal(ctx.foe.conditions.blind.source, 'silence');
    else assert.equal(ctx.foe.conditions.blind, undefined);
  }
});

test('casting a different Focus spell ends priest conditions even if the new casting fails; non-Focus spells preserve Focus', () => {
  const ctx = scene(); focused(ctx);
  cast(ctx, 'Bless'); assert.ok(ctx.foe.conditions.blind); resolve(ctx, { targetId: 'priest' });
  cast(ctx, 'Zone of Truth', 2);
  assert.equal(ctx.foe.conditions.blind, undefined); assert.equal(ctx.caster.focusSpell, null);
});

test('death, sleep, external Focus replacement, and target death clean priest-owned senses without changing unrelated effects', () => {
  for (const reason of ['death', 'sleep', 'external', 'target']) {
    const ctx = scene(); focused(ctx);
    ctx.foe.conditions.prone = true;
    if (reason === 'death') ctx.caster.hp = 0;
    if (reason === 'sleep') ctx.caster.conditions = { sleeping: true };
    if (reason === 'external') ctx.caster.focusSpell = { spell: 'detect magic' };
    if (reason === 'target') ctx.foe.hp = 0;
    cleanupPriestTierTwoFocus(ctx.state);
    assert.equal(ctx.foe.conditions.blind, undefined); assert.equal(ctx.foe.conditions.prone, true);
  }
});

test('Focus natural twenties never create critical choices and turn keys prevent same-round double maintenance', () => {
  const ctx = scene(); ctx.state.combat = { active: true, round: 1 }; focused(ctx);
  assert.equal(maintainPriestTierTwoFocus(ctx.state, ctx.caster, { checkRoll: () => { throw new Error('duplicate'); } }).skipped, true);
  ctx.state.combat.round = 2;
  const result = maintainPriestTierTwoFocus(ctx.state, ctx.caster, { checkRoll: check(20) });
  assert.equal(result.succeeded, true); assert.equal(ctx.caster.pendingSpell, null); assert.equal(ctx.caster.focusSpell.critical, false);
  assert.equal(advancePriestTierTwoFocus(ctx.state, 1, { checkRoll: () => { throw new Error('combat global tick'); } }).length, 0);
  assert.ok(isPriestTierTwoFocus(ctx.caster.focusSpell));
});

test('Augury delegates guidance for the chosen action; a critical requests only clearer explanation, not another mechanical effect', () => {
  for (const roll of [12, 20]) {
    const ctx = scene(); cast(ctx, 'Augury', roll);
    assert.equal(ctx.caster.pendingSpell.phase, 'options'); let calls = 0;
    const result = resolve(ctx, { question: 'open-door' }, { auguryAssessment: (state, caster, question, pending) => {
      calls++; assert.equal(state, ctx.state); assert.equal(caster, ctx.caster); assert.equal(question, 'open-door');
      return pending.critical ? { answer: 'woe', explanation: 'A dangerous creature waits beyond the door.' } : 'Woe.';
    } });
    assert.equal(calls, 1); assert.equal(result.clearerExplanation, roll === 20); assert.equal(ctx.caster.pendingSpell, null);
    if (roll === 20) assert.match(result.explanation, /dangerous creature/);
  }
});

test('Zone of Truth requires a monster sharing a language, stays outside combat, and permits companion monster targets', () => {
  const combat = scene(); combat.state.combat.active = true; assert.throws(() => cast(combat, 'Zone of Truth'), /outside combat/);
  const ctx = scene(); cast(ctx, 'Zone of Truth');
  assert.throws(() => resolve(ctx, { targetId: 'ally' }), /monster target/);
  ctx.foe.languages = ['Goblin']; assert.throws(() => resolve(ctx, { targetId: 'foe' }), /shared language/);
  ctx.foe.languages = ['Common']; resolve(ctx, { targetId: 'foe' }); assert.equal(ctx.caster.pendingSpell, null);
  const companion = scene(); companion.ally.companion = { kind: 'friendly', source: { languages: ['Common'] } };
  cast(companion, 'Zone of Truth'); resolve(companion, { targetId: 'ally' });
  assert.equal(companion.caster.focusSpell.targetIds[0], 'ally');
});

test('Zone questions are stored on Focus, can be hidden/reopened without a roll, and renew once per successful round rather than per damage check', () => {
  const ctx = scene(); focused(ctx, 'Zone of Truth');
  const focus = ctx.caster.focusSpell;
  assert.equal(focus.questionAvailable, true); assert.equal(ctx.caster.pendingSpell, null);
  resolve(ctx, { dismiss: true }); assert.equal(priestTierTwoPresentation(ctx.state, ctx.caster), null); assert.equal(focus.questionAvailable, true);
  const reused = cast(ctx, 'Zone of Truth', 1, { checkRoll: () => { throw new Error('reopening does not reroll'); } });
  assert.equal(reused.reused, true); assert.equal(reused.actionCost, 0); assert.equal(priestTierTwoPresentation(ctx.state, ctx.caster).question, true);
  let calls = 0;
  const options = { answerQuestion: (state, caster, target, question, stored) => {
    calls++; assert.equal(target.id, 'foe'); assert.equal(question, 'motive'); assert.equal(stored, focus); return 'The bandit wants gold.';
  } };
  resolve(ctx, { question: 'motive' }, options);
  assert.equal(calls, 1); assert.equal(focus.questionAvailable, false); assert.equal(focus.questionsAsked, 1);
  assert.throws(() => resolve(ctx, { question: 'motive' }, options), /Maintain Focus/);
  maintainPriestTierTwoFocus(ctx.state, ctx.caster, { reason: 'damage', checkRoll: check(20) });
  assert.equal(focus.questionAvailable, false); assert.equal(ctx.caster.pendingSpell, null);
  maintainPriestTierTwoFocus(ctx.state, ctx.caster, { checkRoll: check(20) });
  assert.equal(focus.questionAvailable, true); assert.equal(focus.questionOpen, true); assert.equal(ctx.caster.pendingSpell, null);
  ctx.caster.pendingSpell = { spell: 'magic missile', phase: 'targeting' };
  resolve(ctx, { question: 'motive' }, options);
  assert.equal(ctx.caster.pendingSpell.spell, 'magic missile', 'asking does not erase another readied spell');
});

test('Zone critical range doubles to twelve, out-of-range questions reject without consuming availability, and combat ends it', () => {
  const ctx = scene(); ctx.foe.x = 15; cast(ctx, 'Zone of Truth', 20); resolve(ctx, { choice: 'range' }); resolve(ctx, { targetId: 'foe' });
  ctx.foe.x = 16;
  assert.throws(() => resolve(ctx, { question: 'motive' }), /visible target/);
  assert.equal(ctx.caster.focusSpell.questionAvailable, true);
  ctx.state.combat.active = true; cleanupPriestTierTwoFocus(ctx.state); assert.equal(ctx.caster.focusSpell, null);
});

test('pending critical choices, source conditions, weapon duration, and Zone question state survive real save/load', () => {
  let ctx = scene(); cast(ctx, 'Smite', 20);
  let restored = hydrateDungeonState(serializeDungeonState(ctx.state));
  resolvePriestTierTwoSpell(restored, restored.characters[0], { choice: 'double-dice' });
  const hit = resolvePriestTierTwoSpell(restored, restored.characters[0], { targetId: 'foe' }, { rng: () => 0 }).hits[0];
  assert.equal(hit.damage, 2);
  ctx = scene(); focused(ctx); restored = hydrateDungeonState(serializeDungeonState(ctx.state));
  assert.equal(restored.entities[0].conditions.blind.casterId, 'priest');
  restored.characters[0].focusSpell = null; cleanupPriestTierTwoFocus(restored); assert.equal(restored.entities[0].conditions.blind, undefined);
  ctx = scene(); focused(ctx, 'Zone of Truth'); resolve(ctx, { question: 'motive' });
  restored = hydrateDungeonState(serializeDungeonState(ctx.state));
  assert.equal(restored.characters[0].focusSpell.questionsAsked, 1); assert.equal(restored.characters[0].focusSpell.questionAvailable, false);
});
