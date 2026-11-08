import test from 'node:test';
import assert from 'node:assert/strict';
import { TIER_THREE_SPELLS, TIER_THREE_CHOICES, castTierThreeSpell, resolveTierThreeSpell,
  tierThreePresentation, tierThreeCells, applyTierThreeBlast } from '../../S3_content/src/tier-three-spells.js';
import { setCharacterDamageListener } from '../../S3_content/src/characters.js';
import { setOrganicTileMeta } from '../../S3_content/src/organic-tiles.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';

const check = roll => modifier => ({ roll, modifier, total: roll + modifier });
const cell = (state, x, y) => state.tiles[y * state.map.width + x];
const monster = (id, x, y, extra = {}) => ({ id, name: id, type: 'monster', x, y, hp: 100, ...extra });
function scene() {
  return { map: { width: 40, height: 32 },
    tiles: Array.from({ length: 40 * 32 }, (_, index) => ({ x: index % 40, y: Math.floor(index / 40), type: 'floor', meta: {} })),
    rooms: [], halls: [], decor: {}, entities: [], player: { x: 10, y: 10 },
    visibility: { visibleNow: new Set(), exploredEver: new Set() },
    characters: [{ id: 'wizard', name: 'Wizard', className: 'Wizard', x: 10, y: 10, hp: 100, maxHitPoints: 100,
      stats: { INT: 14, CON: 10 }, gear: [], colorValue: '#347abc', spellsKnown: 'Fireball, Lightning Bolt' }] };
}
function cast(state, spell = 'fireball', natural = 11) {
  const caster = state.characters[0];
  castTierThreeSpell(state, caster, spell, { checkRoll: check(natural), random: () => .9 });
  return caster;
}
const release = (state, caster, point = { x: 10, y: 10 }, options = {}) =>
  resolveTierThreeSpell(state, caster, { ...point, confirmed: true }, { random: () => .99, ...options });
const hitIds = result => result.hits.map(hit => hit.id).sort();
function crossing(state) {
  const cells = Array.from({ length: 15 }, (_, i) => ({ x: 8 + i, y: 10 }));
  state.underpasses = [{ id: 'lower', lowerCells: cells, upperCrossings: cells, portals: [], artVersion: 2 }];
}

test('exports only Fireball and Lightning Bolt and their approved critical choices', () => {
  assert.deepEqual([...TIER_THREE_SPELLS], ['fireball', 'lightning bolt']);
  assert.deepEqual(TIER_THREE_CHOICES.fireball.map(([key]) => key), ['damage', 'area']);
  assert.deepEqual(TIER_THREE_CHOICES['lightning bolt'].map(([key]) => key), ['damage', 'range']);
});

test('both spells cast first with DC 13 INT, preserve class bonuses, and lose failed spells', () => {
  for (const spell of TIER_THREE_SPELLS) {
    const state = scene(), caster = state.characters[0];
    const failed = castTierThreeSpell(state, caster, spell, { checkRoll: check(10) });
    assert.equal(failed.check.total, 12); assert.equal(failed.succeeded, false);
    assert.equal(failed.pendingSpell, null); assert.equal(caster.pendingSpell, undefined);
    assert.deepEqual(caster.failedSpellKeys, [spell]); assert.deepEqual(failed.mishaps, []);
    assert.match(failed.message, /DC 13/);
    assert.throws(() => castTierThreeSpell(state, caster, spell), /unavailable/);
    caster.failedSpellKeys = [];
    const success = castTierThreeSpell(state, caster, spell, { checkRoll: check(11) });
    assert.equal(success.succeeded, true); assert.equal(success.critical, false);
    assert.equal(success.check.total, 13); assert.equal(success.pendingSpell, caster.pendingSpell);
    assert.equal(caster.hp, 100); assert.equal(caster.pendingSpell.tier, 3);
    assert.throws(() => castTierThreeSpell(state, caster, spell), /pending/);
    caster.pendingSpell = null;
    caster.bonuses = [{ bonusName: 'Spellcasting', bonusAmount: 1 }];
    assert.equal(castTierThreeSpell(state, caster, spell, { rollCheck: check(10) }).check.total, 13);
  }
});

test('natural one fails even with a high total and uses tier-three mishaps, not tier-one misfires', () => {
  const state = scene(), caster = state.characters[0];
  const result = castTierThreeSpell(state, caster, 'fireball', {
    rollCheck: () => ({ roll: 1, total: 99 }), random: () => (9 - .5) / 12
  });
  assert.equal(result.succeeded, false); assert.equal(result.critical, false);
  assert.equal(result.mishaps[0].roll, 9);
  assert.ok(caster.wizardEffects.some(effect => effect.type === 'spell-tier-ban' && effect.tier === 3));
  assert.equal(caster.pendingSpell, undefined);
});

test('casting respects spell locks, tier bans, Silence and tier-three advantage mode', () => {
  for (const setup of [caster => { caster.spellLocks = { fireball: { remainingMs: 100 } }; },
    caster => { caster.wizardEffects = [{ type: 'spell-tier-ban', tier: 3, untilRest: true }]; }]) {
    const state = scene(); setup(state.characters[0]);
    assert.throws(() => cast(state), /unavailable/);
  }
  const state = scene(), caster = state.characters[0];
  caster.focusSpell = { spell: 'silence', areaId: 'silence' };
  state.areaSpells = [{ id: 'silence', spell: 'silence', casterId: caster.id, routeId: '', x: 9, y: 9, width: 3, height: 3 }];
  assert.throws(() => cast(state), /impossible/);
  state.areaSpells = [];
  caster.wizardEffects = [{ type: 'unstable', maxTier: 3, rounds: 10 }];
  let mode;
  castTierThreeSpell(state, caster, 'fireball', { advantage: true,
    rollCheck: (modifier, options) => { mode = options; return check(11)(modifier); } });
  assert.deepEqual(mode, { doubleRoll: false, disadvantage: false });
});

test('only the initial natural twenty accepts one approved critical choice', () => {
  for (const spell of TIER_THREE_SPELLS) {
    const state = scene(), caster = cast(state, spell, 20);
    assert.equal(caster.pendingSpell.phase, 'critical');
    assert.equal(tierThreeCells(state, caster, { x: 11, y: 10 }).length, 0);
    assert.equal(tierThreePresentation(state, caster).choices.length, 2);
    for (const choice of ['normal', 'duration', 'two-d6', spell === 'fireball' ? 'range' : 'area'])
      assert.throws(() => resolveTierThreeSpell(state, caster, { choice }), /valid critical/);
    assert.throws(() => release(state, caster), /valid critical/);
    resolveTierThreeSpell(state, caster, { choice: 'damage' });
    assert.throws(() => resolveTierThreeSpell(state, caster, { choice: 'damage' }), /initial critical/);
    assert.ok(tierThreePresentation(state, caster).area);
    assert.equal(caster.pendingSpell.diceCount, spell === 'fireball' ? 8 : 6);
    const result = release(state, caster, { x: 11, y: 10 }, { diceCount: 99, radius: 99, range: 99 });
    assert.equal(result.rolls.length, spell === 'fireball' ? 8 : 6);
    assert.equal(result.range, 12);
    const normal = scene(), normalCaster = cast(normal, spell);
    assert.throws(() => resolveTierThreeSpell(normal, normalCaster, { choice: 'damage' }), /initial critical/);
  }
});

test('Fireball is a centered 7x7 Chebyshev blast, sharing 4d6 across caster, allies and enemies', () => {
  const state = scene(), caster = cast(state);
  state.characters.push({ id: 'ally', name: 'Ally', x: 13, y: 13, hp: 100, maxHitPoints: 100 });
  state.characters.push({ id: 'disc', x: 10, y: 10, hp: 1, summon: { kind: 'floating-disc' } });
  state.entities.push(monster('corner', 7, 7), monster('outside', 14, 10), monster('dead', 10, 10, { defeated: true }));
  let rolls = 0;
  const result = release(state, caster, undefined, { random: () => { rolls++; return .99; } });
  assert.equal(result.cells.length, 49); assert.equal(rolls, 4); assert.equal(result.damage, 24);
  assert.deepEqual(hitIds(result), ['ally', 'corner', 'wizard']);
  assert.ok(result.hits.every(hit => hit.damage === 24 && hit.defeated === false));
  assert.equal(caster.hp, 76); assert.equal(caster.raw.hp, 76); assert.equal(caster.pendingSpell, null);
});

test('Fireball area critical is centered 13x13 with 4d6, not doubled damage or casting range', () => {
  const state = scene(), caster = cast(state, 'fireball', 20);
  resolveTierThreeSpell(state, caster, { choice: 'area' });
  assert.equal(tierThreePresentation(state, caster).area.size, 13);
  assert.throws(() => release(state, caster, { x: 23, y: 10 }), /range/);
  const result = release(state, caster);
  assert.equal(result.cells.length, 169); assert.equal(result.rolls.length, 4);
  assert.ok(result.cells.some(cell => cell.x === 4 && cell.y === 4));
});

test('preview and generic modal are non-damaging until explicit true confirmation; dismiss works in every phase', () => {
  const state = scene(), caster = cast(state), before = structuredClone(state);
  const view = tierThreePresentation(state, caster);
  assert.equal(view.title, 'Fireball'); assert.equal(view.area.size, 7);
  assert.equal(view.area.routeId, ''); assert.equal(view.id, 'wizard:fireball:');
  const preview = resolveTierThreeSpell(state, caster, { x: 12, y: 10, confirmed: 'true' });
  assert.equal(preview.requiresConfirmation, true);
  assert.deepEqual(preview.preview.cells, tierThreeCells(state, caster, { x: 12, y: 10 }));
  assert.deepEqual(state, before);
  resolveTierThreeSpell(state, caster, { dismiss: true });
  assert.equal(caster.pendingSpell, null); assert.equal(tierThreePresentation(state, caster), null);
  assert.deepEqual(tierThreeCells(state, caster, { x: 12, y: 10 }), []);
  cast(state, 'lightning bolt', 20);
  resolveTierThreeSpell(state, caster, { dismiss: true });
  assert.equal(caster.pendingSpell, null);
});

test('Fireball Far12 aiming is circular and allows dark unexplored squares and concealed occupants', () => {
  const state = scene(), caster = cast(state);
  state.entities.push(monster('hidden', 22, 10, { stealthed: true, visible: false }));
  assert.throws(() => release(state, caster, { x: 22, y: 11 }), /range/);
  assert.deepEqual(tierThreeCells(state, caster, { x: 22, y: 11 }), []);
  const result = release(state, caster, { x: 22, y: 10 });
  assert.deepEqual(hitIds(result), ['hidden']);
  assert.equal(state.visibility.visibleNow.size, 0); assert.equal(state.visibility.exploredEver.size, 0);
});

test('Lightning clicked one square away always extends the full twelve-square thin ray', () => {
  const state = scene(), caster = cast(state, 'lightning bolt');
  state.entities.push(monster('near', 11, 10), monster('far', 22, 10), monster('beyond', 23, 10), monster('side', 15, 11));
  state.characters.push({ id: 'ally', name: 'Ally', x: 18, y: 10, hp: 100, maxHitPoints: 100 });
  assert.ok(tierThreePresentation(state, caster).area);
  const preview = tierThreeCells(state, caster, { x: 11, y: 10 });
  assert.equal(preview.length, 12); assert.deepEqual(preview.at(-1), { x: 22, y: 10, routeId: '' });
  const result = release(state, caster, { x: 11, y: 10 });
  assert.deepEqual(result.cells, preview); assert.deepEqual(hitIds(result), ['ally', 'far', 'near']);
  assert.equal(result.damage, 18); assert.equal(result.rolls.length, 3); assert.equal(caster.hp, 100);
});

test('Lightning extrapolates arbitrary click directions, obeys circular range and clips at the map edge', () => {
  const state = scene(), caster = cast(state, 'lightning bolt');
  for (const point of [{ x: 12, y: 11 }, { x: 11, y: 12 }, { x: 9, y: 9 }]) {
    const cells = tierThreeCells(state, caster, point);
    assert.ok(cells.length > Math.max(Math.abs(point.x - 10), Math.abs(point.y - 10)));
    assert.ok(cells.every(cell => Math.hypot(cell.x - 10, cell.y - 10) <= 12));
    assert.equal(new Set(cells.map(cell => `${cell.x},${cell.y}`)).size, cells.length);
  }
  assert.deepEqual(tierThreeCells(state, caster, { x: 39, y: 10 }), tierThreeCells(state, caster, { x: 11, y: 10 }));
  assert.equal(tierThreeCells(state, caster, { x: 9, y: 10 }).at(-1).x, 0);
  assert.throws(() => release(state, caster, caster), /direction/);
  assert.equal(caster.hp, 100);
});

test('Lightning range critical reaches twenty-four squares and still rolls only 3d6', () => {
  const state = scene(), caster = cast(state, 'lightning bolt', 20);
  resolveTierThreeSpell(state, caster, { choice: 'range' });
  const result = release(state, caster, { x: 11, y: 10 });
  assert.equal(result.cells.length, 24); assert.equal(result.cells.at(-1).x, 34);
  assert.equal(result.rolls.length, 3); assert.equal(result.damage, 18);
});

test('walls truncate Lightning with no restart beyond them and reject through-wall aiming', () => {
  const state = scene(), caster = cast(state, 'lightning bolt');
  cell(state, 14, 10).type = 'wall';
  state.entities.push(monster('before', 13, 10), monster('behind', 15, 10), monster('on-wall', 14, 10));
  assert.throws(() => release(state, caster, { x: 15, y: 10 }), /line of sight/);
  const result = release(state, caster, { x: 11, y: 10 });
  assert.deepEqual(hitIds(result), ['before']); assert.equal(result.cells.at(-1).x, 13);
});

test('closed doors stop Lightning; open doors permit it, independently of creature occupancy', () => {
  for (const doorState of ['closed', 'open']) {
    const state = scene(), caster = cast(state, 'lightning bolt');
    state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 14, y: 10,
      wallSide: 'east', orientation: 'vertical', doorState }, monster('behind', 16, 10));
    const result = release(state, caster, { x: 11, y: 10 });
    assert.equal(result.hits.some(hit => hit.id === 'behind'), doorState === 'open');
    if (doorState === 'closed') assert.ok(result.cells.every(cell => cell.x <= 14));
  }
});

test('Fireball line of effect starts at impact, never flood fills around corners or closed doors', () => {
  for (const blocker of ['wall', 'door']) {
    const state = scene(), caster = cast(state);
    if (blocker === 'wall') cell(state, 12, 10).type = 'wall';
    else state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 12, y: 10,
      wallSide: 'east', orientation: 'vertical', doorState: 'closed' });
    state.entities.push(monster('blocked', 13, 10), monster('clear', 10, 13));
    const result = release(state, caster);
    assert.ok(!hitIds(result).includes('blocked')); assert.ok(hitIds(result).includes('clear'));
  }
  const state = scene(), caster = cast(state);
  cell(state, 12, 10).type = 'wall';
  state.entities.push(monster('beyond-caster-wall', 14, 10));
  const result = release(state, caster, { x: 13, y: 12 });
  assert.ok(hitIds(result).includes('beyond-caster-wall'), 'blast checks impact-to-target, not caster-to-target');
});

test('reviewed organic artwork shadows block aiming, Fireball splash, and Lightning extension', () => {
  for (const spell of TIER_THREE_SPELLS) {
    const state = scene(), caster = cast(state, spell);
    setOrganicTileMeta(cell(state, 12, 10), 'org-blocks-NWxNExSExSWxNxExSxWx.png');
    state.entities.push(monster('shadowed', 13, 10));
    assert.throws(() => release(state, caster, { x: 13, y: 10 }), /line of sight/);
    const result = release(state, caster, { x: spell === 'fireball' ? 10 : 11, y: 10 });
    assert.ok(!hitIds(result).includes('shadowed'));
    assert.ok(!result.cells.some(cell => cell.x === 13 && cell.y === 10));
  }
});

test('upper and lower creatures, treasure, Web and previews remain separate at identical coordinates', () => {
  for (const spell of TIER_THREE_SPELLS) for (const routeId of ['', 'lower']) {
    const state = scene(); crossing(state);
    const caster = state.characters[0]; caster.routeId = routeId; cast(state, spell);
    const otherRoute = routeId ? '' : 'lower';
    state.entities.push(monster('same', 11, 10, { routeId }), monster('other', 11, 10, { routeId: otherRoute }),
      { id: 'rope', type: 'treasure', name: 'Rope', x: 11, y: 10, routeId: otherRoute });
    state.areaSpells = [{ id: 'web', spell: 'web', x: 10, y: 10, width: 3, height: 1, routeId: otherRoute, rounds: 5 }];
    assert.throws(() => release(state, caster, { x: 11, y: 10, routeId: otherRoute }), /same route/);
    const result = release(state, caster, { x: 11, y: 10, routeId });
    assert.ok(result.cells.every(cell => cell.routeId === routeId));
    assert.ok(hitIds(result).includes('same')); assert.ok(!hitIds(result).includes('other'));
    assert.equal(state.entities.find(entity => entity.id === 'rope').name, 'Rope');
    assert.equal(state.areaSpells[0].rounds, 5);
  }
});

test('Fireball reuses treasure and flammable-object rules without touching carried gear or protected items', () => {
  const state = scene(), caster = cast(state);
  caster.gear = [{ name: 'Rope' }];
  const treasure = (id, name, extra = {}) => ({ id, type: 'treasure', name, value: 10, x: 11, y: 10, ...extra });
  state.entities.push(treasure('rope', 'Rope'), treasure('wood', 'Wooden shield'), treasure('magic', 'Magic scroll', { magical: true }),
    treasure('coins', 'Gold coins', { kind: 'coins' }), treasure('gems', 'Gem', { kind: 'gems' }),
    treasure('collected', 'Book', { collected: true }),
    { id: 'curtain', type: 'feature', name: 'Curtain', flammable: true, x: 11, y: 10 });
  const result = release(state, caster);
  assert.equal(state.entities[0].name, 'ash pile'); assert.equal(state.entities[1].value, 5);
  assert.deepEqual(state.entities.slice(2, 6).map(entity => entity.fireDamage), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(caster.gear, [{ name: 'Rope' }]); assert.deepEqual(result.ignited, ['Curtain']);
  assert.equal(result.damagedTreasure.length, 2);
});

test('fire touching an empty Web cell ignites it once and merges individual Web hits for parent processing', () => {
  const state = scene(), caster = cast(state);
  state.entities.push(monster('splash', 12, 10), monster('web-only', 17, 10, { hp: 1 }));
  state.areaSpells = [{ id: 'web', spell: 'web', casterId: caster.id, routeId: '', x: 12, y: 10, width: 6, height: 1, rounds: 5 }];
  const result = release(state, caster, undefined, { random: () => 0, now: 1234 });
  assert.deepEqual(result.webIgnitions, ['web']); assert.equal(state.areaSpells[0].burnedAt, 1234);
  assert.equal(result.webHits.length, 2);
  assert.equal(result.hits.find(hit => hit.id === 'splash').damage, 5);
  assert.equal(result.hits.find(hit => hit.id === 'splash').webDamage, 1);
  assert.equal(result.hits.find(hit => hit.id === 'web-only').defeated, true);
  assert.equal(state.entities[1].defeated, undefined);
});

test('Lightning never ignites Web or treasure', () => {
  const state = scene(), caster = cast(state, 'lightning bolt');
  state.entities.push({ id: 'rope', type: 'treasure', name: 'Rope', x: 11, y: 10 });
  state.areaSpells = [{ id: 'web', spell: 'web', x: 11, y: 10, width: 3, height: 1, rounds: 5 }];
  const result = release(state, caster, { x: 11, y: 10 });
  assert.deepEqual(result.damagedTreasure, []); assert.deepEqual(result.webIgnitions, []);
  assert.equal(state.areaSpells[0].rounds, 5); assert.equal(state.entities[0].name, 'Rope');
});

test('resistance halves damage once on characters and monsters, wakes sleepers, and reports actual HP loss', () => {
  for (const spell of TIER_THREE_SPELLS) {
    const state = scene(), caster = cast(state, spell);
    const damageType = spell === 'fireball' ? 'fire' : 'lightning';
    const gear = [{ name: 'Ward', equipped: true, magic: { resistance: damageType } }];
    state.characters.push({ id: 'ally', name: 'Ally', x: 11, y: 10, hp: 100, maxHitPoints: 100, gear,
      conditions: { sleeping: { source: 'sleep' } } });
    state.entities.push(monster('resistant', 12, 10, { gear: structuredClone(gear), conditions: { sleeping: true } }),
      monster('low-hp', 13, 10, { hp: 2 }));
    let listenerSource;
    setCharacterDamageListener(() => { listenerSource = state.lastDamageSourceId; });
    let result;
    try { result = release(state, caster, { x: 11, y: 10 }, { random: () => 0 }); }
    finally { setCharacterDamageListener(null); }
    const expected = Math.floor(result.damage / 2);
    assert.equal(result.hits.find(hit => hit.id === 'ally').damage, expected);
    assert.equal(result.hits.find(hit => hit.id === 'resistant').damage, expected);
    assert.equal(result.hits.find(hit => hit.id === 'low-hp').damage, 2);
    assert.equal(result.hits.find(hit => hit.id === 'low-hp').defeated, true);
    assert.equal(state.entities[1].defeated, undefined);
    assert.equal(listenerSource, caster.id);
    assert.equal(state.characters[1].conditions.sleeping, undefined);
    assert.equal(state.entities[0].conditions.sleeping, undefined);
    assert.equal(state.entities[0].conditions.prone, true);
  }
});

test('Web callback also uses shared elemental resistance and reports the resisted HP loss', () => {
  const state = scene(), caster = cast(state);
  state.entities.push(monster('web-only', 17, 10, {
    gear: [{ equipped: true, magic: { resistance: 'fire' } }], conditions: { sleeping: true }
  }));
  state.areaSpells = [{ id: 'web', casterId: 'other-caster', spell: 'web', x: 13, y: 10, width: 5, height: 1, rounds: 5 }];
  const result = release(state, caster, undefined, { random: () => .99 });
  assert.equal(result.webHits[0].damage, 3); assert.equal(state.entities[0].hp, 97);
  assert.equal(state.lastDamageSourceId, 'other-caster');
});

test('pending critical and placement settings survive real dungeon serialization on both routes', () => {
  for (const [spell, choice] of [['fireball', 'area'], ['fireball', 'damage'], ['lightning bolt', 'range'], ['lightning bolt', 'damage']]) {
    let state = scene(); crossing(state); state.characters[0].routeId = 'lower'; cast(state, spell, 20);
    state = hydrateDungeonState(serializeDungeonState(state));
    let caster = state.characters[0];
    assert.equal(tierThreePresentation(state, caster).choices.length, 2);
    resolveTierThreeSpell(state, caster, { choice });
    state = hydrateDungeonState(serializeDungeonState(state)); caster = state.characters[0];
    const point = { x: 11, y: 10, routeId: 'lower' }, preview = tierThreeCells(state, caster, point);
    const result = release(state, caster, point);
    assert.deepEqual(result.cells, preview); assert.equal(caster.pendingSpell, null);
    assert.equal(result.diceCount, choice === 'damage' ? (spell === 'fireball' ? 8 : 6) : (spell === 'fireball' ? 4 : 3));
    assert.ok(result.cells.every(cell => cell.routeId === 'lower'));
  }
});

test('direct forced API uses numeric overrides without casting or changing an existing pending spell', () => {
  const state = scene(), caster = cast(state, 'fireball', 20), pending = structuredClone(caster.pendingSpell);
  const result = applyTierThreeBlast(state, caster, 'fireball', { x: 10, y: 10 }, { diceCount: 2, diceSides: 8, radius: 1, random: () => .99 });
  assert.equal(result.damage, 16); assert.equal(result.cells.length, 9);
  assert.deepEqual(caster.pendingSpell, pending); assert.equal(caster.failedSpellKeys, undefined);
  const lightning = applyTierThreeBlast(state, caster, 'lightning bolt', caster, { range: 3, random: () => 0 });
  assert.deepEqual(lightning.cells, [11, 12, 13].map(x => ({ x, y: 10, routeId: '' })));
  assert.deepEqual(caster.pendingSpell, pending);
  assert.throws(() => applyTierThreeBlast(state, caster, 'fireball', caster, { radius: -1 }), /Invalid/);
});
