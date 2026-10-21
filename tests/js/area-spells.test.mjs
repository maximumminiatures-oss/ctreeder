import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AREA_CRITICAL_CHOICES, WEB_BURN_FADE_MS, castAreaSpell, resolveAreaSpell,
  areaSpellPlacement, activeAreaSpells, areaSpellVisuals, advanceAreaSpells,
  isFixedObject, fixedObjectAt, applyKnock, isSilenced, silenceBlocksAction,
  noiseIsSilenced, silenceStealthSuccess, syncAreaSpellConditions,
  isRestrainedByWeb, webStepBlock, escapeWeb, igniteWebsAt
} from '../../S3_content/src/area-spells.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

const check = natural => modifier => ({ roll: natural, total: natural + modifier, modifier });
const cell = (state, x, y) => state.tiles[y * state.map.width + x];
function scene() {
  return {
    map: { width: 32, height: 24 },
    tiles: Array.from({ length: 32 * 24 }, (_, i) => ({ x: i % 32, y: Math.floor(i / 32), type: 'floor', roomId: 'r', meta: {} })),
    rooms: [{ id: 'r', x: 0, y: 0, width: 32, height: 24 }], halls: [], decor: {},
    characters: [{ id: 'wizard', name: 'Wizard', className: 'Wizard', stats: { INT: 14, STR: 10 },
      hp: 20, maxHitPoints: 20, x: 10, y: 10, gear: [], colorValue: '#347abc', spellsKnown: 'Silence, Web, Knock, Fixed Object' }],
    entities: [], player: { x: 10, y: 10 }, visibility: { visibleNow: new Set(), exploredEver: new Set() }
  };
}
function cast(state, spell, natural = 12) {
  const caster = state.characters[0];
  castAreaSpell(state, caster, spell, { checkRoll: check(natural), random: () => .9 });
  return caster;
}
function place(state, spell = 'web', point = { x: 10, y: 10 }, natural = 12) {
  const caster = cast(state, spell, natural);
  if (natural === 20) resolveAreaSpell(state, caster, { choice: 'area' });
  return resolveAreaSpell(state, caster, { ...point, confirmed: true }).zone;
}
function monster(id, x = 10, y = 10, extra = {}) {
  return { id, type: 'monster', name: 'Orc', x, y, hp: 20, S: 2, ...extra };
}
function crossing(state) {
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
    upperCrossings: [{ x: 10, y: 10 }, { x: 11, y: 10 }], portals: [] }];
}

test('Tier 2 casting uses DC 12, wizard modifiers and ordinary failure/loss rules', () => {
  const state = scene(), caster = state.characters[0];
  const result = castAreaSpell(state, caster, 'Web', { checkRoll: check(10) });
  assert.equal(result.succeeded, true);
  assert.equal(result.check.total, 12);
  assert.equal(caster.pendingSpell.phase, 'placement');
  assert.throws(() => castAreaSpell(state, caster, 'silence'), /pending/);
  caster.pendingSpell = null;
  const failed = castAreaSpell(state, caster, 'silence', { checkRoll: check(9) });
  assert.equal(failed.succeeded, false);
  assert.ok(caster.failedSpellKeys.includes('silence'));
  assert.throws(() => castAreaSpell(state, caster, 'silence'), /unavailable/);
  assert.throws(() => castAreaSpell(state, caster, 'unknown'), /Unknown/);
});

test('natural 1 uses the existing tier 1-2 mishap table; natural 20 offers only exported choices', () => {
  const state = scene(), caster = state.characters[0];
  const failure = castAreaSpell(state, caster, 'web', { checkRoll: check(1), random: () => .1 });
  assert.equal(failure.succeeded, false);
  assert.ok(failure.mishaps.length > 0);
  assert.equal(failure.mishaps[0].name, 'Explosion');
  caster.failedSpellKeys = [];
  castAreaSpell(state, caster, 'web', { checkRoll: check(20) });
  assert.equal(caster.pendingSpell.phase, 'critical');
  assert.throws(() => resolveAreaSpell(state, caster, { choice: 'duration' }), /valid critical/);
  assert.deepEqual(AREA_CRITICAL_CHOICES.web, [['area', '12 x 12 Area']]);
  resolveAreaSpell(state, caster, { choice: 'area' });
  assert.equal(caster.pendingSpell.phase, 'placement');
  assert.equal(caster.pendingSpell.size, 12);
});

test('wizard casting disadvantage follows tier-2 effects and cancels advantage', () => {
  const state = scene(), caster = state.characters[0];
  caster.wizardEffects = [{ type: 'unstable', tier: 2, rounds: 2 }];
  let mode;
  castAreaSpell(state, caster, 'web', { checkRoll: (modifier, options) => {
    mode = options; return check(12)(modifier);
  }, advantage: true });
  assert.deepEqual(mode, { doubleRoll: false, disadvantage: false });
});

test('placement centers even-sized areas and does not mutate authoritative state before confirmation', () => {
  const state = scene(), caster = cast(state, 'silence');
  const before = structuredClone(state);
  const result = resolveAreaSpell(state, caster, { x: 10, y: 10 });
  assert.deepEqual(state, before);
  assert.equal(result.requiresConfirmation, true);
  assert.deepEqual(result.preview, { x: 7, y: 7, width: 6, height: 6, anchor: { x: 10, y: 10 }, routeId: '',
    spell: 'silence', outlineColor: '#347abc', fill: '#ffffff', fillOpacity: .1, exploredOnly: true });
  const { zone } = resolveAreaSpell(state, caster, { x: 10, y: 10, confirmed: true });
  assert.equal(state.areaSpells.length, 1);
  assert.equal(caster.focusSpell.areaId, zone.id);
  assert.equal(caster.pendingSpell, null);
  assert.ok(isSilenced(state, { x: 7, y: 7 }));
  assert.ok(!isSilenced(state, { x: 13, y: 10 }));
});

test('critical placement uses 12x12, tests clicked center range rather than northwest corner, and physical LOS', () => {
  const state = scene(), caster = cast(state, 'web', 20);
  resolveAreaSpell(state, caster, { choice: 'area' });
  assert.deepEqual(areaSpellPlacement(state, caster, { x: 0, y: 10 }), {
    x: -6, y: 4, width: 12, height: 12, anchor: { x: 0, y: 10 }, routeId: ''
  });
  assert.throws(() => areaSpellPlacement(state, caster, { x: 23, y: 10 }), /center/);
  assert.throws(() => areaSpellPlacement(state, caster, { x: 12.5, y: 10 }), /center/);
  for (let y = 0; y < state.map.height; y++) cell(state, 11, y).type = 'wall';
  assert.throws(() => areaSpellPlacement(state, caster, { x: 12, y: 10 }), /line of sight/);
});

test('Fixed Object locks floor treasure for five rounds, restores its block flag, and leaves the item in place', () => {
  for (const original of [undefined, false, true]) {
    const state = scene(), caster = cast(state, 'fixed object');
    const item = { id: 'item', type: 'treasure', name: 'Stone', x: 11, y: 10, weightPounds: 3 };
    if (original !== undefined) item.blocksMovement = original;
    state.entities.push(item);
    resolveAreaSpell(state, caster, { targetId: item.id });
    assert.equal(item.fixedObject.rounds, 5);
    assert.equal(item.blocksMovement, true);
    assert.equal(fixedObjectAt(state, item), item);
    advanceAreaSpells(state, 4);
    assert.ok(isFixedObject(item));
    advanceAreaSpells(state, 1);
    assert.equal(isFixedObject(item), false);
    assert.equal(item.blocksMovement, original);
    assert.equal(Object.hasOwn(item, 'blocksMovement'), original !== undefined);
    assert.equal(state.entities[0], item);
  }
});

test('Fixed Object critical lasts ten rounds and carried stacks drop exactly one independent item', () => {
  const state = scene(), caster = cast(state, 'fixed object', 20);
  caster.gear = [{ name: 'Dagger', instanceId: 'dagger-stack', quantity: 2, totalUnits: 2, equipped: true, weight: 1 }];
  resolveAreaSpell(state, caster, { choice: 'duration' });
  const { entity } = resolveAreaSpell(state, caster, { gearIndex: 0, x: 11, y: 10 });
  assert.equal(entity.fixedObject.rounds, 10);
  assert.equal(entity.subtype, 'dropped-equipment');
  assert.equal(entity.gearItem.quantity, 1);
  assert.equal(entity.gearItem.equipped, false);
  assert.notEqual(entity.gearItem.instanceId, caster.gear[0].instanceId);
  assert.equal(caster.gear[0].totalUnits, 1);
});

test('Fixed Object rejects heavy/distant objects and invalid factory output without inventory mutation', () => {
  const state = scene(), caster = cast(state, 'fixed object');
  caster.gear = [{ name: 'Anvil', weight: 6 }, { name: 'Dagger', weight: 1 }];
  assert.throws(() => resolveAreaSpell(state, caster, { gearIndex: 0 }), /five pounds/);
  assert.throws(() => resolveAreaSpell(state, caster, { gearIndex: 1, x: 15, y: 10 }), /touch/);
  const before = structuredClone(state);
  assert.throws(() => resolveAreaSpell(state, caster, { gearIndex: 1 }, { createDroppedItem: () => null }), /could not be placed/);
  assert.deepEqual(state, before);
  const outcome = resolveAreaSpell(state, caster, { gearIndex: 1 }, { createDroppedItem: (gearItem, point) => ({
    id: 'custom', type: 'treasure', name: gearItem.name, gearItem, ...point
  }) });
  assert.equal(outcome.entity.id, 'custom');
  assert.equal(caster.gear.length, 1);
});

test('fixing a carried light transfers illumination without duplicating it on the carrier', () => {
  for (const name of ['Torch', 'Lantern']) {
    const state = scene(), caster = cast(state, 'fixed object');
    caster.gear = [{ name, quantity: 2, totalUnits: 2, instanceId: 'light', lit: true, equipped: true }];
    caster.lightSource = name.toLowerCase();
    const { entity } = resolveAreaSpell(state, caster, { gearIndex: 0 });
    assert.equal(entity.lightSource, name.toLowerCase());
    assert.equal(entity.lightRadius, name === 'Lantern' ? 12 : 6);
    assert.equal(entity.gearItem.lit, true);
    assert.equal(caster.gear[0].lit, false);
    assert.equal(caster.gear[0].equipped, false);
    assert.equal(caster.lightSource, '');
  }
});

function roomAndHallScene() {
  const state = scene();
  state.rooms = [{ id: 'r', x: 1, y: 1, width: 4, height: 4 }, { id: 's', x: 9, y: 1, width: 4, height: 4 }];
  for (const tile of state.tiles) Object.assign(tile, { type: 'wall', roomId: null });
  for (const room of state.rooms) for (let y = room.y; y < room.y + room.height; y++)
    for (let x = room.x; x < room.x + room.width; x++) Object.assign(cell(state, x, y), { type: 'floor', roomId: room.id });
  for (let x = 5; x <= 8; x++) Object.assign(cell(state, x, 2), { type: 'floor', hallId: 'h' });
  Object.assign(state.characters[0], { x: 3, y: 2 });
  state.entities = [
    { id: 'trap-r', type: 'trap', x: 2, y: 2, roomId: 'r' },
    { id: 'chest-r', type: 'treasure', subtype: 'chest', name: 'Chest', x: 3, y: 3, roomId: 'r', locked: true },
    { id: 'door-r', type: 'feature', subtype: 'door', doorKind: 'secret', secret: true, x: 5, y: 2, hallId: 'h',
      doorState: 'closed', locked: true, holdPortal: { rounds: 10 } },
    { id: 'trap-door', type: 'trap', targetEntityId: 'door-r', x: 5, y: 2 },
    monster('mimic', 2, 3, { name: 'Mimic', roomId: 'r', mimicDisguise: true }),
    { id: 'trap-h', type: 'trap', x: 7, y: 2 },
    { id: 'door-s', type: 'feature', subtype: 'door', x: 8, y: 2, hallId: 'h', doorState: 'closed' },
    { id: 'trap-s', type: 'trap', x: 10, y: 2, roomId: 's' }
  ];
  return state;
}

test('Knock affects room traps, chests, mimics and boundary secrets, but not the far room', () => {
  const state = roomAndHallScene(), caster = state.characters[0];
  caster.stealthed = true; caster.invisibility = { rounds: 3 };
  let checks = 0, reveals = 0;
  const result = castAreaSpell(state, caster, 'knock', { checkRoll: check(12), random: () => .49,
    wanderingCheck: () => checks++, onMimicRevealed: () => reveals++ });
  assert.ok(result.revealed.includes('trap-r'));
  assert.ok(result.revealed.includes('trap-door'));
  assert.ok(!result.revealed.includes('trap-s'));
  assert.ok(!result.revealed.includes('trap-h'));
  assert.equal(state.entities.find(e => e.id === 'chest-r').opened, true);
  const door = state.entities.find(e => e.id === 'door-r');
  assert.equal(door.secretFound, true); assert.equal(door.doorState, 'open');
  assert.equal(door.locked, false); assert.equal(door.holdPortal, undefined);
  assert.equal(state.entities.find(e => e.id === 'trap-r').triggered, undefined);
  assert.equal(state.entities.find(e => e.id === 'mimic').disguiseRevealed, true);
  assert.equal(reveals, 1); assert.equal(checks, 1);
  assert.equal(caster.stealthed, false); assert.equal(caster.invisibility.rounds, 3);
  assert.equal(caster.pendingSpell, null);
});

test('Knock hall flood fill includes adjacent doors and their traps, not room interiors', () => {
  const state = roomAndHallScene(), caster = state.characters[0];
  Object.assign(caster, { x: 6, y: 2 });
  const result = applyKnock(state, caster, { random: () => .5 });
  assert.ok(result.revealed.includes('trap-h'));
  assert.ok(result.revealed.includes('trap-door'));
  assert.deepEqual(new Set(result.opened), new Set(['door-r', 'door-s']));
  assert.ok(!result.revealed.includes('trap-r'));
  assert.ok(!result.revealed.includes('trap-s'));
  assert.equal(result.wanderingTriggered, false);
});

test('Knock critical options reduce chance or add a twelve-square through-wall area', () => {
  const state = roomAndHallScene(), caster = cast(state, 'knock', 20);
  let called = 0;
  const result = resolveAreaSpell(state, caster, { choice: 'range' }, { random: () => .9, wanderingCheck: () => called++ });
  assert.ok(result.revealed.includes('trap-s'));
  assert.equal(result.chance, .5); assert.equal(called, 0);
  const other = roomAndHallScene();
  cast(other, 'knock', 20);
  assert.equal(resolveAreaSpell(other, other.characters[0], { choice: 'quiet' }, { random: () => .25 }).wanderingTriggered, false);
  assert.equal(applyKnock(other, other.characters[0], { choice: 'quiet', random: () => .249 }).wanderingTriggered, true);
});

test('Silence blocks spells and sound abilities, not bat physical attacks; blindness is source tracked', () => {
  const state = scene();
  const bat = monster('bat', 10, 10, { name: 'Giant Bat' });
  const vrock = monster('vrock', 11, 10, { name: 'Vrock' });
  state.entities.push(bat, vrock);
  state.characters.push({ id: 'thief', name: 'Thief', className: 'Thief', x: 11, y: 10, hp: 10 });
  place(state, 'silence');
  assert.deepEqual(bat.conditions.blind, { source: 'silence', areaIds: [state.areaSpells[0].id] });
  assert.equal(silenceBlocksAction(state, bat, { attack: 'Bite +3 (1d6)' }), '');
  assert.match(silenceBlocksAction(state, vrock, { attack: 'Screech' }), /sound/);
  assert.equal(silenceBlocksAction(state, vrock, { attack: 'Claw +3' }), '');
  assert.match(silenceBlocksAction(state, vrock, { attack: 'Spell: Fireball' }), /Spellcasting/);
  assert.match(silenceBlocksAction(state, vrock, { attack: { name: 'Fireball', description: 'Spell' } }), /Spellcasting/);
  assert.ok(silenceStealthSuccess(state, state.characters[1]));
  assert.equal(silenceStealthSuccess(state, state.characters[0]), false);
  assert.ok(noiseIsSilenced(state, bat));
  assert.throws(() => castAreaSpell(state, state.characters[0], 'web'), /impossible/);
  bat.x = 15; syncAreaSpellConditions(state);
  assert.equal(bat.conditions.blind, undefined);
  bat.x = 10; bat.conditions.blind = { source: 'curse', rounds: 8 }; syncAreaSpellConditions(state);
  assert.equal(bat.conditions.blind.source, 'curse');
  state.characters[0].focusSpell = null; syncAreaSpellConditions(state);
  assert.equal(bat.conditions.blind.source, 'curse');
  assert.equal(isSilenced(state, vrock), false);
});

test('Silence focus ends on death, sleep or replacement and cleans up only its own blindness', () => {
  for (const ending of ['death', 'sleep', 'replacement']) {
    const state = scene(), caster = state.characters[0], bat = monster('bat', 10, 10, { name: 'Bat' });
    state.entities.push(bat); place(state, 'silence');
    if (ending === 'death') caster.hp = 0;
    if (ending === 'sleep') caster.conditions = { sleeping: { source: 'sleep' } };
    if (ending === 'replacement') caster.focusSpell = { spell: 'detect magic' };
    advanceAreaSpells(state);
    assert.equal(state.areaSpells.length, 0);
    assert.equal(bat.conditions.blind, undefined);
    assert.equal(bat.conditions.silenceAreas, undefined);
  }
});

test('Knock noise callbacks are suppressed when their origin is in Silence', () => {
  const state = scene(), caster = state.characters[0];
  place(state, 'silence');
  let calls = 0;
  const result = applyKnock(state, caster, { random: () => 0, wanderingCheck: () => calls++ });
  assert.equal(result.noiseSuppressed, true); assert.equal(result.wanderingTriggered, false); assert.equal(calls, 0);
});

test('Web restrains living allies, caster and monsters, but not discs or incorporeal creatures', () => {
  const state = scene(), caster = state.characters[0];
  state.entities.push(monster('orc'), monster('ghost', 11, 10, { conditions: { incorporeal: true } }));
  state.characters.push({ id: 'disc', x: 10, y: 10, hp: 1, summon: { kind: 'floating-disc' } });
  const zone = place(state);
  assert.deepEqual(caster.conditions.webs, [zone.id]);
  assert.ok(isRestrainedByWeb(state, state.entities[0]));
  assert.ok(webStepBlock(state, caster));
  assert.equal(isRestrainedByWeb(state, state.entities[1]), false);
  assert.equal(isRestrainedByWeb(state, state.characters[1]), false);
  assert.equal(zone.rounds, 5);
});

test('Web escape uses the original total, costs one action, supports STR Grit and resets on reentry', () => {
  const state = scene(), caster = state.characters[0];
  caster.bonuses = [{ name: 'Grit', bonusName: 'Strength' }];
  const zone = place(state);
  let mode;
  const fail = escapeWeb(state, caster, { rollCheck: (modifier, options) => { mode = options; return { roll: 13, total: 13, modifier }; } });
  assert.equal(fail.actionCost, 1); assert.equal(fail.escaped, false);
  assert.equal(mode.doubleRoll, true);
  const success = escapeWeb(state, caster, { rollCheck: () => ({ roll: 14, total: 14 }) });
  assert.equal(success.escaped, true); assert.equal(zone.castingTotal, 14);
  assert.equal(webStepBlock(state, caster), '');
  caster.x = 12; syncAreaSpellConditions(state);
  assert.equal(isRestrainedByWeb(state, caster), false);
  caster.x = 13; syncAreaSpellConditions(state);
  assert.deepEqual(zone.escapedIds, []);
  caster.x = 12; syncAreaSpellConditions(state);
  assert.equal(isRestrainedByWeb(state, caster), true);
});

test('Web expiry removes only web-specific condition sources', () => {
  const state = scene(), caster = state.characters[0];
  caster.conditions = { paralyzed: true };
  place(state); advanceAreaSpells(state, 5);
  assert.equal(state.areaSpells.length, 0);
  assert.deepEqual(caster.conditions, { paralyzed: true });
  assert.throws(() => escapeWeb(state, caster), /cannot attempt/);
});

test('any fire point ignites the whole Web once, rolls damage individually, and preserves a saved fade timestamp', () => {
  const state = scene();
  state.entities.push(monster('orc', 12, 12), monster('outside', 14, 14));
  const zone = place(state);
  const rolls = [0, .99];
  const result = igniteWebsAt(state, { x: 7, y: 7 }, { now: 1000, random: () => rolls.shift() });
  assert.deepEqual(result.ignited, [zone.id]);
  assert.deepEqual(result.hits.map(hit => hit.roll), [1, 6]);
  assert.equal(state.characters[0].hp, 19); assert.equal(state.entities[0].hp, 14);
  assert.equal(state.entities[1].hp, 20);
  assert.equal(isRestrainedByWeb(state, state.characters[0]), false);
  assert.equal(activeAreaSpells(state).length, 0);
  assert.deepEqual(igniteWebsAt(state, { x: 7, y: 7 }), { ignited: [], hits: [] });
  const loaded = JSON.parse(JSON.stringify(state));
  const visual = areaSpellVisuals(loaded, { now: 1750, isExplored: () => true })[0];
  assert.equal(visual.fill, '#ff0000'); assert.equal(visual.opacity, .5);
  advanceAreaSpells(loaded, 0, { now: 1000 + WEB_BURN_FADE_MS });
  assert.equal(loaded.areaSpells.length, 0);
});

test('fire damage callback is per target and reports defeats for parent integration', () => {
  const state = scene(); state.entities.push(monster('orc', 10, 10, { hp: 2 })); place(state);
  const metadata = [], defeated = [];
  const result = igniteWebsAt(state, { x: 10, y: 10 }, { random: () => .99,
    applyDamage: (target, damage, info) => { target.hp = Math.max(0, target.hp - damage); metadata.push(info); },
    onDefeat: target => defeated.push(target.id) });
  assert.equal(result.hits.length, 2); assert.deepEqual(defeated, ['orc']);
  assert.ok(metadata.every(info => info.damageType === 'fire' && info.sourceId === 'wizard'));
});

test('area effects, fixed objects, fire and previews keep upper and lower routes separate', () => {
  const state = scene(); crossing(state);
  state.entities.push(monster('lower-orc', 10, 10, { routeId: 'lower' }));
  state.characters[0].routeId = '';
  const zone = place(state);
  assert.equal(zone.routeId, '');
  assert.equal(isRestrainedByWeb(state, state.entities[0]), false);
  assert.deepEqual(igniteWebsAt(state, { x: 10, y: 10, routeId: 'lower' }), { ignited: [], hits: [] });
  assert.throws(() => areaSpellPlacement(state, state.characters[0], { x: 10, y: 10, routeId: 'lower' }), /same route/);
  state.entities.push({ id: 'fixed-lower', type: 'treasure', x: 10, y: 10, routeId: 'lower', fixedObject: { rounds: 5 } });
  assert.equal(fixedObjectAt(state, state.characters[0]), null);
});

test('visual descriptors use normalized geometry and clip both fill and outline to explored cells', () => {
  const state = scene(); place(state);
  state.visibility.exploredEver = new Set(['7,7', '10,10', '0,0']);
  const before = structuredClone(state);
  const [visual] = areaSpellVisuals(state);
  assert.deepEqual(visual.rect, { x: 7, y: 7, width: 6, height: 6 });
  assert.deepEqual(visual.clipCells, [{ x: 7, y: 7, routeId: '' }, { x: 10, y: 10, routeId: '' }]);
  assert.equal(visual.fillOpacity, .1); assert.equal(visual.outlineColor, '#347abc');
  assert.deepEqual(state, before);
});

test('Silence and Web timers, Focus links and escaped IDs survive real dungeon serialization', () => {
  const state = scene(), caster = state.characters[0];
  const web = place(state);
  escapeWeb(state, caster, { rollCheck: () => ({ roll: 20, total: 20 }) });
  const silence = place(state, 'silence', { x: 20, y: 10 }, 20);
  let loaded = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(loaded.characters[0].focusSpell.areaId, silence.id);
  assert.equal(loaded.areaSpells.find(zone => zone.id === web.id).rounds, 5);
  assert.equal(isRestrainedByWeb(loaded, loaded.characters[0]), false);
  assert.equal(isSilenced(loaded, { x: 20, y: 10 }), true);
  igniteWebsAt(loaded, { x: 10, y: 10 }, { now: 1000, random: () => 0 });
  loaded = hydrateDungeonState(serializeDungeonState(loaded));
  assert.equal(loaded.areaSpells.find(zone => zone.id === web.id).burnedAt, 1000);
  assert.equal(areaSpellVisuals(loaded, { now: 1100, isExplored: () => true }).find(visual => visual.id === web.id).fill, '#ff0000');
});

test('overlapping Web escape compares each original DC without granting immunity to a different Web', () => {
  const state = scene(), caster = state.characters[0];
  const first = place(state);
  const second = place(state); second.castingTotal = 18;
  const result = escapeWeb(state, caster, { rollCheck: () => ({ roll: 15, total: 15 }) });
  assert.deepEqual(result.escapedIds, [first.id]);
  assert.equal(result.escaped, false);
  assert.deepEqual(caster.conditions.webs, [second.id]);
  advanceAreaSpells(state, 5);
  assert.equal(isRestrainedByWeb(state, caster), false);
});

test('Silence critical remains 12x12 and recasting clears source conditions from its old Focus', () => {
  const state = scene(), caster = state.characters[0];
  const bat = monster('bat', 20, 10, { name: 'Bat' }); state.entities.push(bat);
  const old = place(state, 'silence', { x: 20, y: 10 }, 20);
  assert.equal(old.width, 12); assert.equal(old.x, 14);
  assert.equal(bat.conditions.blind.source, 'silence');
  castAreaSpell(state, caster, 'silence', { checkRoll: check(2) });
  assert.equal(bat.conditions.blind, undefined);
  assert.equal(isSilenced(state, bat), false);
});
