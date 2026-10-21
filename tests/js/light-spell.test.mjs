import test from 'node:test';
import assert from 'node:assert/strict';
import { castLight, resolveLight, validateLightTarget, lightSpellSources, LIGHT_TARGET_PROMPT } from '../../S3_content/src/light-spell.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { canAimAtSquare, pendingSpellAllowsCommand } from '../../S3_content/src/targeting.js';
import { hasLiveTimedLight, advanceTorchTime, TORCH_DURATION_MS } from '../../S3_content/src/timers.js';
import { collectLightSources } from '../../S3_content/src/light-geometry.js';

function scene(className = 'Wizard') {
  const caster = { id: 'caster', name: 'Caster', className, hp: 12, maxHitPoints: 12, x: 3, y: 3, routeId: '',
    stats: { INT: 14, WIS: 16 }, gear: [], lightRadius: 0, equipmentInitialized: true };
  const state = { map: { width: 16, height: 16 }, tiles: Array.from({ length: 256 }, (_, i) => ({ x: i % 16, y: Math.floor(i / 16), type: 'floor', meta: {} })),
    characters: [caster], activeCharacterId: caster.id, entities: [], player: { x: 3, y: 3, torchLit: false }, rooms: [], decor: {},
    combat: { active: true, actionUsed: true }, timers: { torchElapsedMs: 12345, torchDurationMs: TORCH_DURATION_MS, lastTickAt: 1000 },
    visibility: { visibleNow: new Set(), exploredEver: new Set() } };
  return { state, caster };
}
const check = value => modifier => ({ roll: value, total: value + modifier, modifier, firstRoll: value });
const cast = (state, caster, value = 12) => castLight(state, caster, { rollCheck: check(value) });

test('successful Light waits for targeting, gives the exact prompt, and never rolls or spends an action twice', () => {
  const { state, caster } = scene(); let rolls = 0;
  const result = castLight(state, caster, { rollCheck: modifier => { rolls++; return check(12)(modifier); } });
  assert.equal(result.prompt, 'Pick target token, item, monster or blank square.');
  assert.equal(result.prompt, LIGHT_TARGET_PROMPT); assert.equal(caster.pendingSpell.phase, 'targeting');
  assert.equal(state.combat.actionUsed, true); assert.equal(caster.lightRadius, 0);
  assert.equal(state.timers.torchElapsedMs, 12345); assert.equal(state.entities.length, 0);
  assert.throws(() => castLight(state, caster, { rollCheck: () => { rolls++; throw new Error('should not roll'); } }), /pending/);
  assert.equal(rolls, 1);
  assert.equal(pendingSpellAllowsCommand(caster, 'move'), true);
  assert.equal(pendingSpellAllowsCommand(caster, 'spell', 'Light'), true);
  resolveLight(state, caster, { targetId: caster.id });
  assert.equal(caster.lightSpellLit, true); assert.equal(caster.lightRadius, 6);
  assert.equal(state.combat.actionUsed, true); assert.equal(caster.pendingSpell, null);
  assert.equal(state.timers.torchElapsedMs, 0);
  assert.throws(() => resolveLight(state, caster, { targetId: caster.id }), /no Light/);
});

test('normal and critical Light keep the baseline six-square radius and one-hour global timer', () => {
  for (const className of ['Wizard', 'Priest']) for (const roll of [12, 20]) {
    const { state, caster } = scene(className); const result = cast(state, caster, roll);
    assert.equal(result.critical, roll === 20); assert.equal(caster.pendingSpell.phase, 'targeting');
    assert.equal(result.check.modifier, className === 'Wizard' ? 2 : 3);
    resolveLight(state, caster, { x: 4, y: 4 });
    assert.equal(state.entities[0].lightRadius, 6); assert.equal(state.timers.torchDurationMs, TORCH_DURATION_MS);
    assert.equal(state.player.torchLit, false, 'stationary light does not create phantom caster illumination');
  }
});

test('Light failure uses normal wizard loss/mishaps and priest penance without creating illumination', () => {
  for (const className of ['Wizard', 'Priest']) {
    const { state, caster } = scene(className);
    const result = castLight(state, caster, { rollCheck: check(1), random: () => .1 });
    assert.equal(result.succeeded, false); assert.deepEqual(caster.failedSpellKeys, ['light']);
    assert.ok(!caster.pendingSpell); assert.equal(state.entities.length, 0); assert.equal(caster.lightRadius, 0);
    if (className === 'Priest') assert.deepEqual(caster.spellPenance.light, { paid: false });
    else assert.equal(result.mishaps.length, 1);
    assert.throws(() => cast(state, caster), /unavailable/);
  }
});

test('touch includes diagonals in darkness but rejects blocked corners, walls and closed doors without spending pending Light', () => {
  const { state, caster } = scene(); cast(state, caster);
  assert.equal(canAimAtSquare(state, caster, { x: 4, y: 4 }, 1), true);
  assert.equal(validateLightTarget(state, caster, { x: 4, y: 4 }).kind, 'square');
  for (const square of [{ x: 5, y: 3 }, { x: 3.5, y: 3 }, { x: -1, y: 3 }, { x: 4, y: 4, routeId: 'other' }])
    assert.throws(() => resolveLight(state, caster, square), /touch range/);
  state.tiles[3 * 16 + 4].type = 'wall';
  assert.throws(() => resolveLight(state, caster, { x: 4, y: 3 }), /touch range/);
  assert.throws(() => resolveLight(state, caster, { x: 4, y: 4 }), /touch range/);
  state.tiles[3 * 16 + 4].type = 'floor';
  state.entities.push({ id: 'door', type: 'feature', subtype: 'door', x: 4, y: 3, orientation: 'vertical', internal: true, doorState: 'closed' });
  assert.throws(() => resolveLight(state, caster, { x: 4, y: 4 }), /touch range/);
  assert.equal(caster.pendingSpell.phase, 'targeting'); assert.equal(state.timers.torchElapsedMs, 12345);
});

test('character and monster attachment follow current positions, never leaving stationary duplicate lights', () => {
  for (const monster of [false, true]) {
    const { state, caster } = scene();
    const target = { id: 'target', name: 'Target', type: monster ? 'monster' : undefined, x: 4, y: 4, routeId: '', hp: 10, gear: [] };
    if (monster) state.entities.push(target); else state.characters.push(target);
    cast(state, caster); resolveLight(state, caster, { targetId: target.id });
    assert.equal(lightSpellSources(state).length, 1);
    Object.assign(target, { x: 8, y: 6 });
    assert.deepEqual(lightSpellSources(state).map(source => [source.x, source.y]), [[8, 6]]);
    assert.equal(hasLiveTimedLight(state), true);
  }
});

test('carried gear follows its holder and keeps its light when dropped, transferred or restored', () => {
  const { state, caster } = scene(); const item = { instanceId: 'dagger', name: 'Dagger' }; caster.gear.push(item);
  cast(state, caster); resolveLight(state, caster, { characterId: caster.id, gearIndex: 0 });
  assert.equal(item.lightSpellLit, true); assert.ok(!caster.lightSpellLit);
  Object.assign(caster, { x: 6, y: 6 });
  assert.deepEqual(lightSpellSources(state).map(source => [source.x, source.y]), [[6, 6]]);
  caster.gear = []; state.entities.push({ id: 'drop', subtype: 'dropped-equipment', x: 5, y: 5, gearItem: item });
  assert.deepEqual(lightSpellSources(state).map(source => [source.x, source.y]), [[5, 5]]);
  const restored = hydrateDungeonState(serializeDungeonState(state));
  assert.equal(restored.entities[0].gearItem.lightSpellLit, true);
  assert.deepEqual(lightSpellSources(restored).map(source => [source.x, source.y]), [[5, 5]]);
});

test('a pending Light survives save/load without relighting, resetting time or requiring another cast', () => {
  const { state, caster } = scene(); cast(state, caster);
  const restored = hydrateDungeonState(serializeDungeonState(state)), wizard = restored.characters[0];
  assert.equal(wizard.pendingSpell.spell, 'light'); assert.equal(wizard.pendingSpell.phase, 'targeting');
  assert.equal(restored.timers.torchElapsedMs, 12345); assert.equal(wizard.lightSpellLit, false);
  resolveLight(restored, wizard, { targetId: wizard.id });
  assert.equal(wizard.pendingSpell, null); assert.equal(wizard.lightRadius, 6);
  assert.equal(restored.timers.torchElapsedMs, 0); assert.equal(restored.combat.actionUsed, true);
});

test('floor items and blank squares are lit without moving the caster; collected sources stop emitting', () => {
  const { state, caster } = scene();
  state.entities.push({ id: 'treasure', name: 'Chest', type: 'treasure', x: 4, y: 3 });
  cast(state, caster); resolveLight(state, caster, { targetId: 'treasure' });
  assert.equal(state.entities[0].lightSpellLit, true);
  state.entities[0].collected = true; assert.equal(lightSpellSources(state).length, 0);
  cast(state, caster); const result = resolveLight(state, caster, { x: 3, y: 4 });
  Object.assign(caster, { x: 10, y: 10 });
  assert.equal(result.kind, 'square'); assert.deepEqual(lightSpellSources(state).map(source => [source.x, source.y]), [[3, 4]]);
  assert.equal(advanceTorchTime(state, TORCH_DURATION_MS).expired, true);
  assert.equal(hasLiveTimedLight(state), false); assert.deepEqual(lightSpellSources(state), []);
  assert.ok(!state.entities.some(entity => entity.subtype === 'spell-light'));
});

test('Light cannot cross an underpass floor even at identical or diagonal coordinates', () => {
  const { state, caster } = scene();
  state.underpasses = [{ id: 'lower', artVersion: 2, lowerCells: [{ x: 3, y: 3 }, { x: 4, y: 3 }],
    upperCrossings: [{ x: 3, y: 3 }, { x: 4, y: 3 }], portals: [], art: [] }];
  state.entities.push({ id: 'lower-monster', type: 'monster', x: 3, y: 3, routeId: 'lower', hp: 10 });
  cast(state, caster);
  assert.throws(() => resolveLight(state, caster, { targetId: 'lower-monster' }), /same floor/);
  assert.throws(() => resolveLight(state, caster, { x: 4, y: 3, routeId: 'lower' }), /same floor/);
  assert.equal(caster.pendingSpell.phase, 'targeting');
});

test('collector includes stationary, monster, floor-item and carried-item Light sources', () => {
  for (const kind of ['square', 'monster', 'item', 'gear']) {
    const { state, caster } = scene();
    const target = { id: 'target', type: kind === 'monster' ? 'monster' : 'treasure', x: 4, y: 3, routeId: '', hp: 10 };
    if (['monster', 'item'].includes(kind)) state.entities.push(target);
    if (kind === 'gear') caster.gear.push({ instanceId: 'dagger', name: 'Dagger' });
    cast(state, caster);
    resolveLight(state, caster, kind === 'square' ? { x: 4, y: 3 } : kind === 'gear' ? { characterId: caster.id, gearIndex: 0 } : { targetId: target.id });
    const sources = collectLightSources(state);
    assert.equal(sources.length, 1, kind);
    assert.deepEqual(sources[0], { x: kind === 'gear' ? 3 : 4, y: 3, radius: 6, routeId: '' });
  }
});

test('collector uses visual positions for attached monster/gear lights and deduplicates character lights', () => {
  const { state, caster } = scene();
  const monster = { id: 'monster', type: 'monster', x: 4, y: 3, routeId: '', hp: 10 };
  state.entities.push(monster); cast(state, caster); resolveLight(state, caster, { targetId: monster.id });
  Object.assign(monster, { x: 7, y: 3, visualX: 6.25, visualY: 3.1 });
  assert.deepEqual(collectLightSources(state).map(source => [source.x, source.y]), [[6.25, 3.1]]);
  monster.lightSpellLit = false; delete monster.lightSource; delete monster.lightRadius;
  caster.gear.push({ instanceId: 'dagger', name: 'Dagger' });
  cast(state, caster); resolveLight(state, caster, { characterId: caster.id, gearIndex: 0 });
  Object.assign(caster, { visualX: 3.5, visualY: 3.2 });
  assert.deepEqual(collectLightSources(state).map(source => [source.x, source.y]), [[3.5, 3.2]]);
  cast(state, caster); resolveLight(state, caster, { targetId: caster.id }); state.player.torchLit = false;
  assert.equal(collectLightSources(state).length, 1, 'gear/character sources at the same visual position merge');
  caster.lightRadius = 12;
  assert.deepEqual(collectLightSources(state).map(source => source.radius), [12], 'six-square magic source is redundant inside an existing lantern');
});

test('shared viewers see attached monster light only while it reaches their route and position', () => {
  const { state, caster } = scene(); state.sharedRoom = true; state.viewerCharacterIds = new Set([caster.id]);
  const monster = { id: 'monster', type: 'monster', x: 4, y: 3, routeId: '', hp: 10 };
  state.entities.push(monster); cast(state, caster); resolveLight(state, caster, { targetId: monster.id });
  assert.equal(collectLightSources(state).length, 1);
  monster.x = 14; assert.deepEqual(collectLightSources(state), []);
  monster.x = 4;
  state.underpasses = [{ id: 'lower', artVersion: 2, lowerCells: [{ x: 3, y: 3 }, { x: 4, y: 3 }],
    upperCrossings: [{ x: 3, y: 3 }, { x: 4, y: 3 }], portals: [], art: [] }];
  monster.routeId = 'lower'; assert.deepEqual(collectLightSources(state), []);
  delete state.viewerCharacterIds;
  assert.equal(collectLightSources(state)[0].routeId, 'lower');
});

test('expiry clears all supported attached Light flags and removes their collected illumination', () => {
  const { state, caster } = scene();
  caster.gear.push({ name: 'Dagger', lightSpellLit: true }); caster.lightSpellLit = true;
  state.entities.push(
    { id: 'monster', type: 'monster', hp: 10, x: 4, y: 3, lightSpellLit: true, lightSource: 'light-spell', lightRadius: 6, gear: [{ name: 'Staff', lightSpellLit: true }] },
    { id: 'item', type: 'treasure', x: 3, y: 4, lightSpellLit: true, lightSource: 'light-spell', lightRadius: 6 },
    { id: 'drop', subtype: 'dropped-equipment', x: 4, y: 4, gearItem: { name: 'Dagger', lightSpellLit: true } });
  assert.equal(collectLightSources(state).length, 4);
  advanceTorchTime(state, TORCH_DURATION_MS);
  assert.equal(caster.lightSpellLit, false); assert.equal(caster.gear[0].lightSpellLit, false);
  assert.ok(state.entities.every(entity => entity.lightSpellLit === false && !entity.lightRadius));
  assert.equal(state.entities[0].gear[0].lightSpellLit, false);
  assert.equal(state.entities[2].gearItem.lightSpellLit, false);
  assert.deepEqual(collectLightSources(state), []);
});
