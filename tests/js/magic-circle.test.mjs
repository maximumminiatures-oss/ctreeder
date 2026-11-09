import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAGIC_CIRCLE, MAGIC_CIRCLE_TAGS, MAGIC_CIRCLE_SIZE, magicCircleBounds, activeMagicCircles,
  magicCircleContains, canCrossCircleBoundary, circleBlocksHostileAction, circleBlocksMentalControl,
  castMagicCircle, resolveMagicCircle, maintainMagicCircle, magicCirclePresentation, magicCircleVisuals,
  syncMagicCircles, cleanupMagicCircles, endMagicCircle
} from '../../S3_content/src/magic-circle.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';
import { buildMonsterCompanion } from '../../S3_content/src/companions.js';
import { SPELL_TEMPLATE_ART, spellTemplateFits } from '../../S3_content/src/spell-template-art.js';

const check = natural => modifier => ({ roll: natural, total: natural + modifier, modifier });
const at = (x, y, routeId = '') => ({ x, y, routeId });
const monster = (id, tags = ['undead'], extra = {}) => ({ id, type: 'monster', name: id, hp: 20, ...at(4, 8), tags, ...extra });
function scene() {
  const state = createEmptyDungeonState(31);
  state.map = { width: 20, height: 20 };
  state.tiles = Array.from({ length: 400 }, (_, index) => ({ x: index % 20, y: Math.floor(index / 20), type: 'floor', roomId: 'r', meta: {} }));
  state.rooms = [{ id: 'r', x: 7, y: 7, width: 3, height: 3 }];
  state.characters = [{ id: 'wizard', name: 'Wizard', className: 'Wizard', ancestry: 'Human', level: 5,
    hp: 30, maxHitPoints: 30, stats: { STR: 10, DEX: 10, CON: 10, INT: 14, WIS: 18, CHA: 10 },
    ...at(8, 8), roomId: 'r', spellsKnown: 'Magic Circle', colorValue: '#13579b', gear: [], raw: {} }];
  state.entities = [];
  state.areaSpells = [];
  state.player = at(8, 8);
  state.visibility = { visibleNow: new Set(), exploredEver: new Set(state.tiles.map(tile => `${tile.x},${tile.y}`)) };
  return { state, caster: state.characters[0] };
}
function circle(state, caster = state.characters[0], tags = ['undead'], natural = tags.length === 2 ? 20 : 11) {
  castMagicCircle(state, caster, { checkRoll: check(natural) });
  let result;
  for (const option of tags) result = resolveMagicCircle(state, caster, { option });
  return result.zone;
}
function crossing(state) {
  state.underpasses = [{ id: 'lower', lowerCells: [at(4, 8), at(5, 8), at(8, 8), at(9, 8), at(12, 8)],
    upperCrossings: [at(4, 8), at(5, 8), at(8, 8), at(9, 8), at(12, 8)], portals: [] }];
}
const reload = state => hydrateDungeonState(JSON.parse(JSON.stringify(serializeDungeonState(state))));

test('Tier 3 uses DC 13 INT plus wizard bonuses, not WIS; initial ordinary failure loses the spell', () => {
  const { state, caster } = scene();
  const failed = castMagicCircle(state, caster, { checkRoll: check(10) });
  assert.equal(failed.check.total, 12);
  assert.equal(failed.succeeded, false);
  assert.deepEqual(failed.mishaps, []);
  assert.deepEqual(caster.failedSpellKeys, [MAGIC_CIRCLE]);
  assert.deepEqual(caster.raw.failedSpellKeys, [MAGIC_CIRCLE]);
  assert.throws(() => castMagicCircle(state, caster), /unavailable/);
  caster.failedSpellKeys = [];
  caster.bonuses = [{ name: '+1 spellcasting', bonusTo: 'wizard spells', bonusAmount: 1 }];
  const success = castMagicCircle(state, caster, { checkRoll: check(10) });
  assert.equal(success.check.modifier, 3);
  assert.equal(success.check.total, 13);
  assert.equal(success.succeeded, true);
  assert.equal(caster.pendingSpell.maxTags, 1);
  assert.throws(() => castMagicCircle(state, caster), /pending/);
});

test('natural 1 loses the spell and uses the higher tier mishap table', () => {
  const { state, caster } = scene();
  const result = castMagicCircle(state, caster, { rollCheck: check(1), random: () => .99 });
  assert.equal(result.succeeded, false);
  assert.equal(result.mishaps[0].tier, 3);
  assert.equal(result.mishaps[0].name, 'Uncontained channeling');
  assert.deepEqual(caster.failedSpellKeys, [MAGIC_CIRCLE]);
  assert.equal(caster.focusSpell, null);
  assert.equal(activeMagicCircles(state).length, 0);
});

test('initial natural 20 requires two distinct approved tags; later twenties never add choices', () => {
  const { state, caster } = scene();
  const result = castMagicCircle(state, caster, { checkRoll: check(20) });
  assert.equal(result.critical, true);
  let presentation = magicCirclePresentation(state, caster);
  assert.equal(presentation.maxTags, 2);
  assert.equal(presentation.options.length, 14);
  assert.equal(presentation.choices, undefined);
  assert.throws(() => resolveMagicCircle(state, caster, { option: 'humanoid' }), /approved/);
  assert.throws(() => resolveMagicCircle(state, caster, { option: 'human' }), /approved/);
  resolveMagicCircle(state, caster, { option: 'devil' });
  assert.equal(activeMagicCircles(state).length, 0);
  presentation = magicCirclePresentation(state, caster);
  assert.equal(presentation.options.find(option => option.key === 'fiend').disabled, true);
  assert.throws(() => resolveMagicCircle(state, caster, { option: 'demon' }), /different/);
  const { zone } = resolveMagicCircle(state, caster, { option: 'elemental' });
  assert.deepEqual(zone.tags, ['fiend', 'primordial']);
  assert.equal(caster.pendingSpell, null);
  assert.equal(magicCirclePresentation(state, caster), null);
  const before = structuredClone(zone);
  const focus = maintainMagicCircle(state, caster, { checkRoll: check(20), reason: 'next round' });
  assert.equal(focus.succeeded, true);
  assert.equal(focus.critical, undefined);
  assert.deepEqual(zone, before);
  assert.equal(caster.focusSpell.focusedRounds, 1);
  assert.equal(caster.pendingSpell, null);
  assert.throws(() => resolveMagicCircle(state, caster, { option: 'undead' }), /No Magic Circle/);
});

test('one tag is standard, initial location is fixed, and a small room does not clip the 7x7 square', () => {
  const { state, caster } = scene();
  castMagicCircle(state, caster, { checkRoll: check(11) });
  const beforePresentation = structuredClone(state);
  assert.deepEqual(magicCirclePresentation(state, caster).preview, { ...magicCircleBounds(at(8, 8)), spell: MAGIC_CIRCLE });
  assert.deepEqual(state, beforePresentation);
  caster.x = 15; caster.y = 15;
  const { zone } = resolveMagicCircle(state, caster, { option: 'undead', x: 15, y: 15 });
  assert.deepEqual([zone.x, zone.y, zone.width, zone.height], [5, 5, 7, 7]);
  assert.deepEqual(zone.anchor, { x: 8, y: 8 });
  assert.equal(MAGIC_CIRCLE_SIZE, 7);
  assert.equal(caster.focusSpell.areaId, zone.id);
  assert.equal(zone.sourceModule, 'magic-circle');
  assert.equal(zone.rounds, undefined);
  assert.equal(state.areaSpells[0], zone);
  for (const point of [at(5, 5), at(11, 11), at(11, 5)]) assert.equal(magicCircleContains(state, zone, point), true);
  for (const point of [at(4, 5), at(12, 8), at(8, 12)]) assert.equal(magicCircleContains(state, zone, point), false);
  assert.equal(magicCircleVisuals(state)[0].clipCells.length, 49);
  caster.x = 1; caster.y = 1;
  maintainMagicCircle(state, caster, { checkRoll: check(11) });
  assert.deepEqual(zone.anchor, { x: 8, y: 8 });
});

test('every approved broad family gates entry/exit but allows movement within the circle', () => {
  for (const [tag] of MAGIC_CIRCLE_TAGS) {
    const { state, caster } = scene(), chosen = monster('chosen', [tag]);
    circle(state, caster, [tag]);
    assert.equal(canCrossCircleBoundary(state, chosen, at(4, 8), at(5, 8)), false, tag);
    assert.equal(canCrossCircleBoundary(state, chosen, at(5, 8), at(4, 8)), false, tag);
    assert.equal(canCrossCircleBoundary(state, chosen, at(5, 8), at(6, 8)), true, tag);
    assert.equal(canCrossCircleBoundary(state, chosen, at(4, 8), at(4, 9)), true, tag);
    assert.equal(canCrossCircleBoundary(state, monster('other', []), at(4, 8), at(5, 8)), true, tag);
  }
});

test('chosen creatures initially inside are trapped without changing conditions, morale or their ability to move inside', () => {
  const { state, caster } = scene();
  const trapped = monster('trapped', ['undead'], { ...at(5, 5), conditions: { incorporeal: true }, hostile: true });
  const human = { id: 'human', name: 'Human', ancestry: 'Human', className: 'Fighter', hp: 20, ...at(5, 5), raw: {} };
  state.entities.push(trapped); state.characters.push(human);
  const beforeTrapped = structuredClone(trapped), beforeHuman = structuredClone(human);
  circle(state, caster);
  assert.equal(canCrossCircleBoundary(state, trapped, at(5, 5), at(4, 4)), false);
  assert.equal(canCrossCircleBoundary(state, trapped, at(5, 5), at(6, 6)), true);
  assert.equal(canCrossCircleBoundary(state, human, at(5, 5), at(4, 4)), true);
  assert.equal(circleBlocksHostileAction(state, human, caster), false);
  assert.deepEqual(trapped, beforeTrapped);
  assert.deepEqual(human, beforeHuman);
  assert.equal(human.moraleFlight, undefined);
});

test('long paths cannot tunnel across the square; exterior paths and exact corner grazes are allowed', () => {
  const { state, caster } = scene(), chosen = monster('chosen');
  circle(state, caster);
  for (const [from, to] of [[at(0, 8), at(19, 8)], [at(8, 0), at(8, 19)],
    [at(0, 0), at(19, 19)], [at(-1000000000, 8), at(1000000000, 8)]])
    assert.equal(canCrossCircleBoundary(state, chosen, from, to), false);
  for (const [from, to] of [[at(0, 4), at(19, 4)], [at(0, 8), at(8, 0)],
    [at(4, 5), at(5, 4)], [at(4, 4), at(4, 4)], [at(8, 8), at(8, 8)]])
    assert.equal(canCrossCircleBoundary(state, chosen, from, to), true);
});

test('hostile attacks/spells and possession/compulsion/beguiling protect anyone inside, even against a trapped attacker', () => {
  const { state, caster } = scene();
  circle(state, caster);
  const attacker = monster('attacker');
  const targets = [caster, monster('enemy-inside', ['fiend'], at(5, 5)), { id: 'friend', ancestry: 'Human', ...at(11, 11) }];
  for (const target of targets) {
    assert.equal(circleBlocksHostileAction(state, attacker, target), true);
    assert.equal(circleBlocksHostileAction(state, attacker, target, { hostile: false }), false);
    assert.equal(circleBlocksHostileAction(state, attacker, target, { hostile: false, mentalControl: true }), true);
    for (const action of ['possess', 'compel', 'beguile'])
      assert.equal(circleBlocksMentalControl(state, attacker, target), true, action);
  }
  attacker.x = 8;
  assert.equal(circleBlocksHostileAction(state, attacker, caster), true);
  assert.equal(circleBlocksHostileAction(state, attacker, at(12, 8)), false);
  assert.equal(circleBlocksMentalControl(state, attacker, at(12, 8)), false);
  assert.equal(circleBlocksHostileAction(state, monster('unselected', ['fey']), caster), false);
  const snapshot = structuredClone(state);
  circleBlocksHostileAction(state, attacker, caster); circleBlocksMentalControl(state, attacker, caster);
  assert.deepEqual(state, snapshot);
});

test('summoned undead source tags apply even when the companion has human ancestry; ordinary humans stay unaffected', () => {
  const { state, caster } = scene();
  circle(state, caster);
  const companion = buildMonsterCompanion(monster('skeleton', ['undead'], { gear: [], languages: [] }), { kind: 'summoned' });
  companion.ancestry = 'Human'; state.characters.push(companion);
  assert.equal(canCrossCircleBoundary(state, companion, at(4, 8), at(5, 8)), false);
  assert.equal(circleBlocksHostileAction(state, companion, caster), true);
  assert.equal(circleBlocksMentalControl(state, companion, caster), true);
  assert.equal(companion.moraleFlight, undefined);
  assert.equal(canCrossCircleBoundary(state, caster, at(5, 8), at(4, 8)), true);
});

test('circles only protect the cast route; route-changing entry/escape is still blocked', () => {
  const { state, caster } = scene(); crossing(state);
  const zone = circle(state, caster), chosen = monster('chosen');
  assert.equal(canCrossCircleBoundary(state, chosen, at(4, 8, 'lower'), at(5, 8, 'lower')), true);
  assert.equal(canCrossCircleBoundary(state, chosen, at(8, 8), at(9, 8, 'lower')), false);
  assert.equal(canCrossCircleBoundary(state, chosen, at(4, 8, 'lower'), at(5, 8)), false);
  assert.equal(magicCircleContains(state, zone, at(8, 8, 'lower')), false);
  assert.equal(circleBlocksHostileAction(state, { ...chosen, routeId: 'lower' }, caster), false);
  assert.equal(circleBlocksMentalControl(state, chosen, at(8, 8, 'lower')), false);
  endMagicCircle(state, caster);
  caster.routeId = 'lower';
  const lower = circle(state, caster);
  assert.equal(lower.routeId, 'lower');
  assert.equal(canCrossCircleBoundary(state, chosen, at(4, 8), at(5, 8)), true);
  assert.equal(canCrossCircleBoundary(state, chosen, at(4, 8, 'lower'), at(5, 8, 'lower')), false);
  assert.equal(circleBlocksHostileAction(state, { ...chosen, routeId: 'lower' }, caster), true);
  assert.deepEqual(magicCircleVisuals(state, { isExplored: () => true })[0].clipCells.map(point => point.x), [5, 8, 9]);
});

test('ordinary Focus failure ends protection without losing Magic Circle, while a natural 1 loses it and triggers a mishap', () => {
  for (const natural of [10, 1]) {
    const { state, caster } = scene(); circle(state, caster);
    caster.failedSpellKeys = ['sleep'];
    const result = maintainMagicCircle(state, caster, { checkRoll: check(natural), random: () => .99 });
    assert.equal(result.succeeded, false);
    assert.equal(caster.focusSpell, null);
    assert.equal(caster.raw.focusSpell, null);
    assert.deepEqual(activeMagicCircles(state), []);
    assert.deepEqual(state.areaSpells, []);
    assert.equal(circleBlocksHostileAction(state, monster('attacker'), caster), false);
    assert.equal(caster.failedSpellKeys.includes(MAGIC_CIRCLE), natural === 1);
    assert.equal(caster.failedSpellKeys.includes('sleep'), true);
    assert.equal(result.mishaps.length > 0, natural === 1);
    if (natural === 1) assert.equal(result.mishaps[0].tier, 3);
    else assert.equal(castMagicCircle(state, caster, { checkRoll: check(11) }).succeeded, true);
  }
});

test('Focus uses the same wizard advantage/disadvantage and a later twenty cannot expand a standard circle', () => {
  const { state, caster } = scene();
  caster.wizardEffects = [{ type: 'unstable', tier: 3, rounds: 2 }];
  let mode;
  const rolled = natural => (modifier, options) => { mode = options; return check(natural)(modifier); };
  castMagicCircle(state, caster, { checkRoll: rolled(11), advantage: true });
  assert.deepEqual(mode, { doubleRoll: false, disadvantage: false });
  const { zone } = resolveMagicCircle(state, caster, { option: 'undead' });
  maintainMagicCircle(state, caster, { checkRoll: rolled(20), reason: 'damage' });
  assert.deepEqual(mode, { doubleRoll: false, disadvantage: true });
  assert.deepEqual(zone.tags, ['undead']);
  assert.equal(zone.width, 7);
  assert.equal(caster.pendingSpell, null);
  assert.equal(caster.focusSpell.focusedRounds, 0);
});

test('death, sleep, unconsciousness, changed Focus and missing caster clean up only owned circles', () => {
  for (const invalidate of [
    ({ caster }) => { caster.hp = 0; }, ({ caster }) => { caster.dead = true; },
    ({ caster }) => { caster.conditions = { sleeping: true }; },
    ({ caster }) => { caster.conditions = { unconscious: true }; },
    ({ caster }) => { caster.focusSpell = { spell: 'illusion', id: 'different', illusionIds: [] }; },
    ({ state }) => { state.characters = []; }
  ]) {
    const fixture = scene(), { state, caster } = fixture;
    circle(state, caster);
    const web = { id: 'other-area', spell: 'web', rounds: 5, ...at(8, 8), width: 6, height: 6 };
    state.areaSpells.push(web);
    invalidate(fixture);
    assert.deepEqual(activeMagicCircles(state), []);
    assert.equal(cleanupMagicCircles(state), true);
    assert.deepEqual(state.areaSpells, [web]);
    assert.equal(syncMagicCircles(state), false);
    if (caster.focusSpell?.spell === 'illusion') assert.equal(caster.focusSpell.id, 'different');
    else if (state.characters.length) assert.equal(caster.focusSpell, null);
  }
});

test('dispel/removal, cancellation and multiple caster lifetimes remain independent', () => {
  const { state, caster } = scene();
  const other = { ...structuredClone(caster), id: 'other', name: 'Other', ...at(14, 14) };
  state.characters.push(other);
  const first = circle(state, caster), second = circle(state, other, ['fiend']);
  state.areaSpells = state.areaSpells.filter(zone => zone.id !== first.id);
  syncMagicCircles(state);
  assert.equal(caster.focusSpell, null);
  assert.deepEqual(activeMagicCircles(state), [second]);
  castMagicCircle(state, caster, { checkRoll: check(20) });
  resolveMagicCircle(state, caster, { option: 'undead' });
  assert.equal(syncMagicCircles(state), false, 'a pending second tag retains Focus');
  const cancelled = resolveMagicCircle(state, caster, { dismiss: true });
  assert.equal(cancelled.actionCost, 0);
  assert.equal(caster.focusSpell, null);
  assert.equal(caster.pendingSpell, null);
  assert.deepEqual(activeMagicCircles(state), [second]);
  assert.equal(endMagicCircle(state, other), 1);
  assert.equal(maintainMagicCircle(state, other), null);
});

test('unconscious/silenced maintenance ends without rolling, losing the spell or generating critical choices', () => {
  for (const silenced of [false, true]) {
    const { state, caster } = scene(); circle(state, caster);
    if (silenced) {
      const other = { ...structuredClone(caster), id: 'silencer', focusSpell: { spell: 'silence', areaId: 'silence' } };
      state.characters.push(other);
      state.areaSpells.push({ id: 'silence', casterId: other.id, spell: 'silence', x: 8, y: 8, width: 6, height: 6, routeId: '' });
    } else caster.conditions = { unconscious: true };
    const result = maintainMagicCircle(state, caster, { checkRoll: () => { throw new Error('must not roll'); } });
    assert.equal(result.succeeded, false);
    assert.deepEqual(result.mishaps, []);
    assert.equal(caster.failedSpellKeys?.includes(MAGIC_CIRCLE) || false, false);
    assert.deepEqual(activeMagicCircles(state), []);
  }
});

test('casting rejects pending actions, unconscious casters, tier locks and Silence before rolling', () => {
  for (const setup of [
    caster => { caster.pendingSpell = { spell: 'web' }; }, caster => { caster.hp = 0; },
    caster => { caster.spellLocks = { [MAGIC_CIRCLE]: { remainingMs: 100 } }; },
    caster => { caster.wizardEffects = [{ type: 'spell-tier-ban', tier: 3, rounds: 2 }]; }
  ]) {
    const { state, caster } = scene(); setup(caster);
    assert.throws(() => castMagicCircle(state, caster, { checkRoll: () => { assert.fail('must not roll'); } }), /pending|conscious|unavailable/);
  }
  const { state, caster } = scene();
  const silencer = { ...structuredClone(caster), id: 'silencer', focusSpell: { spell: 'silence', areaId: 'silence' } };
  state.characters.push(silencer);
  state.areaSpells.push({ id: 'silence', spell: 'silence', casterId: silencer.id, x: 5, y: 5, width: 6, height: 6, routeId: '' });
  assert.throws(() => castMagicCircle(state, caster), /Silence/);
});

test('repeated real save/load and normalization preserve circle geometry, source tags, Focus and raw mirrors', () => {
  let { state, caster } = scene();
  crossing(state);
  caster.routeId = 'lower';
  const zone = circle(state, caster, ['undead', 'fiend']);
  const expected = structuredClone(zone);
  state.raw = { areaSpells: structuredClone(state.areaSpells) };
  const companion = buildMonsterCompanion(monster('skeleton', ['undead'], { gear: [], languages: [] }), { kind: 'summoned' });
  companion.ancestry = 'Human'; state.characters.push(companion);
  for (let pass = 0; pass < 3; pass++) {
    normalizeCharacterState(state);
    state = reload(state); caster = state.characters[0];
    assert.equal(syncMagicCircles(state), false);
    assert.deepEqual(activeMagicCircles(state), [expected]);
    assert.deepEqual(caster.raw.focusSpell, caster.focusSpell);
    assert.notEqual(caster.raw.focusSpell, caster.focusSpell);
    assert.deepEqual(state.raw.areaSpells, state.areaSpells);
    assert.equal(canCrossCircleBoundary(state, state.characters[1], at(4, 8, 'lower'), at(5, 8, 'lower')), false);
    assert.equal(state.characters[1].ancestry, 'Human');
  }
  maintainMagicCircle(state, caster, { checkRoll: check(10) });
  state = reload(state);
  assert.deepEqual(state.areaSpells, []);
  assert.deepEqual(state.raw.areaSpells, []);
  assert.equal(state.characters[0].focusSpell, null);
});

test('pending critical selection survives save/load without rerolling or moving its cast anchor', () => {
  let { state, caster } = scene();
  castMagicCircle(state, caster, { checkRoll: check(20) });
  resolveMagicCircle(state, caster, { option: 'fiend' });
  state = reload(state); caster = state.characters[0];
  caster.x = 15;
  assert.equal(syncMagicCircles(state), false);
  assert.deepEqual(caster.pendingSpell.tags, ['fiend']);
  assert.equal(caster.pendingSpell.maxTags, 2);
  const result = maintainMagicCircle(state, caster, { checkRoll: check(20) });
  assert.equal(result.critical, undefined);
  const { zone } = resolveMagicCircle(state, caster, { option: 'undead' });
  assert.deepEqual(zone.anchor, { x: 8, y: 8 });
  assert.deepEqual(zone.tags, ['fiend', 'undead']);
});

test('visual geometry is bounded to 49 cells, not room/floor bounds, and uses the original artwork contract', () => {
  const { state, caster } = scene();
  caster.x = caster.y = 0;
  const zone = circle(state, caster);
  assert.deepEqual([zone.x, zone.y, zone.width, zone.height], [-3, -3, 7, 7]);
  state.tiles.forEach(tile => { tile.type = 'wall'; tile.roomId = null; });
  let calls = 0;
  const [visual] = magicCircleVisuals(state, { isExplored: () => { calls++; return true; } });
  assert.equal(calls, 16);
  assert.equal(visual.clipCells.length, 16);
  assert.deepEqual(visual.rect, { x: -3, y: -3, width: 7, height: 7 });
  assert.equal(spellTemplateFits(visual.spell, visual.rect), true);
  assert.equal(SPELL_TEMPLATE_ART[MAGIC_CIRCLE].path, './assets/mqgic-circle.png');
  assert.deepEqual(magicCircleVisuals(state, { isExplored: () => false })[0].clipCells, []);
  state.map = { width: 1000000000, height: 1000000000 };
  calls = 0;
  magicCircleVisuals(state, { isExplored: () => { calls++; return true; } });
  assert.ok(calls <= 49);
  zone.width = 1000000000;
  assert.deepEqual(magicCircleVisuals(state), []);
  assert.equal(syncMagicCircles(state), true);
});

test('geometry rejects nonfinite/fractional inputs and ignores malformed saved areas without unbounded scans', () => {
  const { state, caster } = scene(), chosen = monster('chosen');
  const zone = circle(state, caster);
  for (const bad of [at(NaN, 0), at(Infinity, 0), at(0, -Infinity), at(.5, 0), at(Number.MAX_VALUE, 0), null]) {
    assert.equal(canCrossCircleBoundary(state, chosen, at(0, 0), bad), false);
    assert.equal(magicCircleContains(state, zone, bad), false);
    assert.throws(() => magicCircleBounds(bad), /valid cast location/);
  }
  for (const bad of [at(Number.MAX_SAFE_INTEGER, 0), at(0, Number.MIN_SAFE_INTEGER)])
    assert.throws(() => magicCircleBounds(bad), /valid cast location/);
  zone.x = Infinity;
  assert.deepEqual(activeMagicCircles(state), []);
  assert.deepEqual(magicCircleVisuals(state), []);
  assert.equal(syncMagicCircles(state), true);
  assert.equal(caster.focusSpell, null);
});
